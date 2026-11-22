// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { useSyncExternalStore } from 'react';
import { resolveWsBaseUrl } from '../api';
import { registerSocketSenders, type AckResult } from './socketBus';
import { WS_CLOSE_SESSION_REVOKED } from '../shared/wsCloseCodes';
import { isChannelTarget } from '../shared/channels';
import { seenEventCursor, setSeenEventCursor } from '../lib/seenEventCursor';
import { bufferClosed, applyBufferRenamed } from '../lib/bufferLifecycle';
import { previewableEventTexts } from '../utils/previewEvents';
import { makeClientId } from '../utils/clientId';
import { primePreviews } from '../hooks/useLinkPreview';
import { notifyForEvent } from './notifier';
import { useAuthStore } from '../stores/auth';
import { useAvatarSetsStore } from '../stores/avatarSets';
import { useBookmarksStore } from '../stores/bookmarks';
import { useBuffersStore, newestHeldId, resetNamesAsked } from '../stores/buffers';
import { useChanlistStore } from '../stores/chanlist';
import { useChannelNotifyStore } from '../stores/channelNotify';
import { useConfigStore } from '../stores/config';
import { useDataExportStore } from '../stores/dataExport';
import { useDccStore } from '../stores/dcc';
import { useDraftStore } from '../stores/drafts';
import { useFavoritesStore } from '../stores/favorites';
import { useHighlightRulesStore } from '../stores/highlightRules';
import { useHighlightsStore } from '../stores/highlights';
import { useIgnoresStore } from '../stores/ignores';
import { useInputHistoryStore } from '../stores/inputHistory';
import { useNetworksStore } from '../stores/networks';
import { useNickNotesStore } from '../stores/nickNotes';
import { useNicklistCollapseStore } from '../stores/nicklistCollapse';
import { usePinsStore } from '../stores/pins';
import { useReactionsStore } from '../stores/reactions';
import { useRedactionsStore } from '../stores/redactions';
import { useRelayBotsStore } from '../stores/relayBots';
import { useSettingsStore } from '../stores/settings';
import { useThemesStore } from '../stores/themes';
import { useThreadsStore } from '../stores/threads';
import { useToastsStore } from '../stores/toasts';
import { useUploadsStore } from '../stores/uploads';
import { useWhoisStore } from '../stores/whois';
import { useAliasesStore } from '../stores/aliases';
import { useE2eChannelsStore } from '../stores/e2eChannels';

type AckResolver = (result: AckResult) => void;

const PROTOCOL_VERSION = 2;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_STABLE_MS = 60_000;
const ACK_TIMEOUT_MS = 8000;
const HIDDEN_RESNAPSHOT_MS = 30_000;
const LIVENESS_PROBE_TIMEOUT_MS = 10_000;

let socket: WebSocket | null = null;
let socketListeners: AbortController | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let socketOpenedAt: number | null = null;
let hiddenSince: number | null = null;
let visibilityWired = false;
let livenessProbeTimer: ReturnType<typeof setTimeout> | null = null;
let lastMessageAt = 0;
let isConnected = false;

const connectedListeners = new Set<() => void>();
const openHandlers = new Set<() => void>();
const ircEventListeners = new Set<(event: any) => void>();
const pendingAcks = new Map<string, AckResolver>();
const dccOfferToasts = new Map<string, number>();
const serverHistoryDepth = new Map<number, number>();
const serverVersionProbeSent = new Set<number>();

function setConnected(val: boolean): void {
  if (isConnected === val) return;
  isConnected = val;
  for (const l of connectedListeners) l();
}

export function getSocketConnected(): boolean {
  return isConnected;
}

export function useSocketConnected(): boolean {
  return useSyncExternalStore(
    (cb) => {
      connectedListeners.add(cb);
      return () => connectedListeners.delete(cb);
    },
    getSocketConnected,
    () => false,
  );
}

export function onIrcEvent(listener: (event: any) => void): () => void {
  ircEventListeners.add(listener);
  return () => ircEventListeners.delete(listener);
}

export function onSocketOpen(handler: () => void): () => void {
  openHandlers.add(handler);
  return () => openHandlers.delete(handler);
}

function nextReconnectDelay(): number {
  const capped = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
  return Math.round(capped * (0.75 + Math.random() * 0.5));
}

function wsUrl(): string {
  const base = resolveWsBaseUrl();
  const params = new URLSearchParams({ v: String(PROTOCOL_VERSION) });
  const since = seenEventCursor();
  if (since > 0) params.set('since', String(since));
  return `${base}?${params}`;
}

function trackSeenId(eventId: unknown): void {
  if (typeof eventId === 'number' && eventId > seenEventCursor()) {
    setSeenEventCursor(eventId);
  }
}

function dccOfferKey(networkId: number, from: string): string {
  return `${networkId}::${from.toLowerCase()}`;
}

function dismissDccOfferToast(key: string): void {
  const id = dccOfferToasts.get(key);
  if (id === undefined) return;
  dccOfferToasts.delete(key);
  useToastsStore.getState().dismiss(id);
}

function retireStaleDccOfferToasts(snapshot: any[]): void {
  const pending = new Set<string>();
  for (const net of snapshot || []) {
    for (const nick of net?.dccChatOffers ?? []) pending.add(dccOfferKey(net.networkId, nick));
  }
  for (const key of dccOfferToasts.keys()) {
    if (!pending.has(key)) dismissDccOfferToast(key);
  }
}

function armLivenessProbe(): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const probed = socket;
  const sentAt = Date.now();
  if (livenessProbeTimer) clearTimeout(livenessProbeTimer);
  livenessProbeTimer = setTimeout(() => {
    livenessProbeTimer = null;
    if (socket === probed && socket.readyState === WebSocket.OPEN && lastMessageAt < sentAt) {
      socket.close();
    }
  }, LIVENESS_PROBE_TIMEOUT_MS);
}

function primeEventPreviews(
  events: unknown,
  fallbackNetworkId?: number | string | null,
  fallbackTarget?: string | null,
): void {
  if (!Array.isArray(events) || events.length === 0) return;
  const config = useConfigStore.getState();
  if (!config.features.linkPreviews) return;
  const settings = useSettingsStore.getState();
  const toggles = {
    inlineMedia: settings.effective('chat.inline_media.enabled') === true,
    linkPreviews: settings.effective('chat.link_previews.enabled') === true,
  };
  if (!toggles.inlineMedia && !toggles.linkPreviews) return;
  primePreviews(previewableEventTexts(events, fallbackNetworkId, fallbackTarget), toggles);
}

function applySnapshot(snapshot: any[], globalIgnores: any[] = []): void {
  const networks = useNetworksStore.getState();
  const buffers = useBuffersStore.getState();
  networks.applySnapshot(snapshot);
  usePinsStore.getState().applySnapshot(snapshot);
  useNicklistCollapseStore.getState().applySnapshot(snapshot);
  useChannelNotifyStore.getState().applySnapshot(snapshot);
  useE2eChannelsStore.getState().applySnapshot(snapshot);
  useIgnoresStore.getState().applySnapshot(snapshot, globalIgnores);
  useNickNotesStore.getState().applySnapshot(snapshot);
  useRelayBotsStore.getState().applySnapshot(snapshot);
  retireStaleDccOfferToasts(snapshot);

  useHighlightRulesStore.getState().fetchAll().catch(() => {});
  useAliasesStore.getState().load();
  useThemesStore.getState().fetchAll().catch(() => {});
  useAvatarSetsStore.getState().fetchAll().catch(() => {});

  for (const net of snapshot || []) {
    for (const ch of net.channels || []) {
      const normalized = (ch.members || []).map((m: any) =>
        typeof m === 'string'
          ? { nick: m, modes: [], away: false }
          : { nick: m.nick, modes: m.modes || [], away: !!m.away, user: m.user, host: m.host, account: m.account },
      );
      if (ch.membersPending) {
        buffers.clearMembers(net.networkId, ch.name);
      } else {
        buffers.setMembers(net.networkId, ch.name, normalized, 'full');
      }
      buffers.setJoined(net.networkId, ch.name, ch.joined !== false);
      if (ch.topic !== undefined) {
        buffers.setTopic(net.networkId, ch.name, ch.topic, {
          setBy: ch.topicSetBy ?? null,
          setAt: ch.topicSetAt ?? null,
        });
      }
      if (ch.modes !== undefined) {
        buffers.setChannelModes(net.networkId, ch.name, ch.modes, ch.modeParams, ch.createdAt);
      }
      if (ch.metadata !== undefined) {
        buffers.setChannelMetadata(net.networkId, ch.name, ch.metadata);
      }
    }
  }
}

function takeLive(event: any): { news: boolean; shown: boolean } {
  const outcome = useBuffersStore.getState().pushLive(event);
  return { news: outcome === 'shown' || outcome === 'detached', shown: outcome === 'shown' };
}

function maybeInspectServerBuffer(
  nid: number | null,
  target: string,
  events: any[],
  payload: any,
): void {
  if (nid == null) return;
  const networks = useNetworksStore.getState();
  if (!isChannelTarget(target) && !target.startsWith(':')) {
    networks.noteServiceTargets(nid, [target]);
  }
  if (target !== `:server:${nid}`) return;

  if (events.length > 0) {
    networks.ingestServerEvents(nid, events);
  }

  const netState = useNetworksStore.getState().states[nid];
  if (netState?.state !== 'connected') return;

  const profile = useNetworksStore.getState().profiles[nid];
  if (profile?.ircd !== 'unknown' && profile?.capsKnown) return;

  const depth = serverHistoryDepth.get(nid);
  if (payload.kind === 'backlog' && events.length === 0 && depth === undefined) {
    serverHistoryDepth.set(nid, 0);
    send({ type: 'history', networkId: nid, target, mode: 'latest', limit: 200 });
    return;
  }

  const curDepth = depth ?? 0;
  if (
    payload.hasMoreOlder &&
    events.length > 0 &&
    typeof events[0]?.id === 'number' &&
    curDepth < 3
  ) {
    serverHistoryDepth.set(nid, curDepth + 1);
    send({
      type: 'history',
      networkId: nid,
      target,
      mode: 'before',
      beforeId: events[0].id,
      limit: 200,
    });
    return;
  }

  if (profile?.ircd === 'unknown' && !serverVersionProbeSent.has(nid)) {
    serverVersionProbeSent.add(nid);
    send({ type: 'raw', networkId: nid, line: 'VERSION' });
  }
}

function handleIrcEvent(event: any): void {
  const networks = useNetworksStore.getState();
  const buffers = useBuffersStore.getState();
  const toasts = useToastsStore.getState();

  trackSeenId(event.id);
  if (typeof event.networkId === 'number') {
    useReactionsStore.getState().noteFromEvents([event], event.networkId);
    useRedactionsStore.getState().noteFromEvents([event], event.networkId);
    useBookmarksStore.getState().noteFromEvents([event], event.networkId);
    if (event.nick) {
      networks.noteServiceTargets(event.networkId, [event.nick]);
    }
    if (
      event.target === `:server:${event.networkId}` &&
      (event.type === 'motd' ||
        event.type === 'notice' ||
        event.type === 'error' ||
        event.type === 'system')
    ) {
      networks.ingestServerEvents(event.networkId, [event]);
    }
  }

  let isNews = false;
  switch (event.type) {
    case 'state':
      networks.applyState(event);
      if (
        typeof event.networkId === 'number' &&
        (event.state === 'connecting' || event.state === 'disconnected')
      ) {
        serverHistoryDepth.delete(event.networkId);
        serverVersionProbeSent.delete(event.networkId);
      }
      break;
    case 'message':
    case 'action': {
      const res = takeLive(event);
      isNews = res.news;
      if (res.news) {
        if (event.replyTo?.root) {
          useThreadsStore.getState().applyLiveEvent(event);
        }
        if (event.target && event.nick && event.networkId != null) {
          buffers.recordSpeaker(event.networkId, event.target, event.nick, Date.now());
        }
        const isDmMsg = !isChannelTarget(event.target);
        const ignoreVerdict =
          event.networkId != null
            ? useIgnoresStore.getState().evaluate(Number(event.networkId), {
                nick: event.nick || '',
                userhost: event.userhost || null,
                target: event.target || '',
                text: event.text || '',
                type: event.type || 'message',
                isDm: isDmMsg,
              })
            : { hide: false, nohilight: false, nonotify: false };
        const effectiveMatch = !!event.matched && !ignoreVerdict.nohilight;
        if (!ignoreVerdict.hide && (effectiveMatch || (isDmMsg && !event.self))) {
          useHighlightsStore.getState().prepend({
            id: event.id,
            kind: effectiveMatch ? 'highlight' : 'dm',
            networkId: event.networkId,
            target: event.target,
            nick: event.nick,
            type: event.type,
            text: event.text,
            createdAt: event.time || new Date().toISOString(),
          });
        }
        if (!event.replay) notifyForEvent(event);
      }
      if (res.shown) primeEventPreviews([event]);
      break;
    }
    case 'notice': {
      const res = takeLive(event);
      isNews = res.news;
      if (res.news && !event.replay && event.matched) notifyForEvent(event);
      if (res.shown) primeEventPreviews([event]);
      break;
    }
    case 'join': {
      const res = takeLive(event);
      isNews = res.news;
      if (res.news && event.nick && event.target) {
        buffers.addMember(event.networkId, event.target, event.nick, {
          user: event.user,
          host: event.host,
          account: event.account,
        });
      }
      break;
    }
    case 'part':
    case 'quit': {
      const res = takeLive(event);
      isNews = res.news;
      if (res.news && event.nick && event.target) {
        buffers.removeMember(event.networkId, event.target, event.nick);
      }
      break;
    }
    case 'kick': {
      const res = takeLive(event);
      isNews = res.news;
      if (res.news && event.kicked && event.target) {
        buffers.removeMember(event.networkId, event.target, event.kicked);
        if (networks.isOwnNick(event.networkId, event.kicked)) {
          buffers.setJoined(event.networkId, event.target, false);
        }
      }
      break;
    }
    case 'nick': {
      const res = takeLive(event);
      isNews = res.news;
      const oldNick = event.oldNick || event.nick;
      if (res.news && oldNick && event.newNick && event.target) {
        buffers.renameMember(event.networkId, event.target, oldNick, event.newNick);
      }
      break;
    }
    case 'own-nick':
      networks.applyOwnNick(event);
      break;
    case 'topic': {
      const res = takeLive(event);
      isNews = res.news;
      if (res.news && event.target) {
        buffers.setTopic(event.networkId, event.target, event.topic ?? null, {
          setBy: event.nick ?? null,
          setAt: event.time ?? null,
        });
      }
      break;
    }
    case 'channel-topic':
      if (event.target) {
        buffers.setTopic(event.networkId, event.target, event.topic ?? null, {
          setBy: event.setBy ?? null,
          setAt: event.setAt ?? null,
        });
      }
      break;
    case 'mode': {
      const res = takeLive(event);
      isNews = res.news;
      break;
    }
    case 'channel-modes':
      if (event.target) {
        buffers.setChannelModes(
          event.networkId,
          event.target,
          event.modes || '',
          event.modeParams,
          event.createdAt,
        );
      }
      break;
    case 'mode-spec':
      networks.applyModeSpec(event);
      break;
    case 'react-support':
      networks.applyReactSupport(event);
      break;
    case 'line-budget':
      networks.applyLineBudget(event);
      break;
    case 'lag':
      networks.applyLag(event);
      break;
    case 'send-queue':
      networks.applySendQueue(event);
      break;
    case 'send-pending':
      networks.applySendPending(event);
      break;
    case 'send-pending-done':
      networks.applySendPendingDone(event);
      break;
    case 'usermode':
      networks.applyUserMode(event);
      if (
        typeof event.networkId === 'number' &&
        /[oO]/.test(String(event.modes || '')) &&
        networks.states[event.networkId]?.state === 'connected' &&
        networks.profiles[event.networkId]?.ircd === 'unknown' &&
        !serverVersionProbeSent.has(event.networkId)
      ) {
        serverVersionProbeSent.add(event.networkId);
        send({ type: 'raw', networkId: event.networkId, line: 'VERSION' });
      }
      break;
    case 'away-state':
      networks.applyAwayState(event);
      break;
    case 'chghost':
      if (event.nick && event.target) {
        buffers.updateMember(event.networkId, event.target, event.nick, {
          user: event.user,
          host: event.host,
        });
      }
      break;
    case 'names':
      if (event.target && Array.isArray(event.members)) {
        buffers.setMembers(
          event.networkId,
          event.target,
          event.members,
          event.partial ? 'partial' : 'full',
        );
      }
      break;
    case 'member-update':
      if (event.target && event.nick) {
        buffers.updateMember(event.networkId, event.target, event.nick, event.patch || event);
      }
      break;
    case 'user-metadata':
      networks.applyUserMetadata(event.networkId, event.nick, event.values ?? null);
      break;
    case 'channel-metadata':
      buffers.setChannelMetadata(event.networkId, event.target, event.values ?? undefined);
      break;
    case 'peer-account':
      networks.applyPeerAccount(
        event.networkId,
        event.nick,
        typeof event.account === 'string' ? event.account : null,
      );
      break;
    case 'channel-joined': {
      const channel = event.channel || event.target;
      if (channel) {
        buffers.setJoined(event.networkId, channel, true);
        if (buffers.confirmPendingJoin(event.networkId, channel)) {
          buffers.activate(event.networkId, channel);
        }
      }
      break;
    }
    case 'join-error': {
      const channel = event.channel || event.target;
      if (channel) buffers.cancelPendingJoin(event.networkId, channel);
      toasts.push({
        title: `Could not join ${channel || 'channel'}`,
        body: event.reason || event.text || 'Join failed',
        kind: 'error',
      });
      break;
    }
    case 'invite':
      takeLive(event);
      if (event.channel && event.nick) {
        toasts.push({
          title: `Invite to ${event.channel}`,
          body: `${event.nick} invited you to ${event.channel}`,
          kind: 'notify',
          ttlMs: 12000,
          action: {
            label: 'Join',
            tone: 'good',
            onClick: () => buffers.joinOrActivate(event.networkId, event.channel),
          },
        });
      }
      break;
    case 'callerid-blocked':
      takeLive(event);
      break;
    case 'dcc-chat-offer': {
      const key = dccOfferKey(event.networkId, event.from);
      dismissDccOfferToast(key);
      const id = toasts.push({
        title: 'DCC Chat Offer',
        body: `${event.from} wants to start a ${event.secure ? 'secure ' : ''}DCC chat`,
        kind: 'notify',
        ttlMs: 0,
        dismissible: false,
        actions: [
          {
            label: 'Accept',
            tone: 'good',
            onClick: () => {
              dccOfferToasts.delete(key);
              void useDccStore.getState().openChat({
                networkId: event.networkId,
                nick: event.from,
                passive: !!event.passive,
                secure: !!event.secure,
              });
            },
          },
          {
            label: 'Decline',
            tone: 'bad',
            onClick: () => {
              dccOfferToasts.delete(key);
            },
          },
          {
            label: 'Later',
            tone: 'muted',
            onClick: () => {
              dccOfferToasts.delete(key);
            },
          },
        ],
      });
      dccOfferToasts.set(key, id);
      break;
    }
    case 'dcc-chat-state':
      networks.applyDccChatState(event.networkId, event.nick, !!event.live, !!event.secure);
      break;
    case 'dcc-chat-offer-closed':
      dismissDccOfferToast(dccOfferKey(event.networkId, event.from));
      break;
    case 'channel-parted':
      if (event.channel || event.target) {
        buffers.setJoined(event.networkId, event.channel || event.target, false);
      }
      break;
    case 'typing':
      if (event.target && event.nick) {
        buffers.setTyping(
          event.networkId,
          event.target,
          event.nick,
          event.state || 'active',
          event.userhost ?? null,
        );
      }
      break;
    case 'peer-presence':
      networks.applyPeerPresence(event.networkId, event.nick, event);
      break;
    case 'system':
    case 'dcc':
    case 'e2e':
    case 'ctcp':
    case 'motd':
      takeLive(event);
      break;
    case 'error':
      if (event.target) takeLive(event);
      else {
        toasts.push({
          title: 'Error',
          body: event.text || event.message || 'Server error',
          kind: 'error',
        });
      }
      break;
    case 'whois_result': {
      const payload =
        event.whois && typeof event.whois === 'object'
          ? { ...(event.whois as Record<string, unknown>), networkId: event.networkId }
          : event;
      useWhoisStore.getState().applyResult(payload);
      break;
    }
    case 'chanlist-start':
      useChanlistStore.getState().onStart(event.networkId);
      break;
    case 'chanlist-progress':
      useChanlistStore.getState().onProgress(event.networkId, event.channels || []);
      break;
    case 'chanlist-end':
      useChanlistStore.getState().onEnd(event.networkId, event.total);
      break;
    default:
      break;
  }

  if (isNews || event.type === 'channel-topic' || event.type === 'channel-modes') {
    for (const l of ircEventListeners) {
      try {
        l(event);
      } catch {
        /* ignore */
      }
    }
  }
}

function handleMessage(raw: string): void {
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  if (!payload || typeof payload !== 'object') return;
  lastMessageAt = Date.now();

  const buffers = useBuffersStore.getState();
  const networks = useNetworksStore.getState();

  if (payload.kind === 'snapshot') {
    applySnapshot(payload.networks || [], payload.globalIgnores || []);
    if (Array.isArray(payload.favorites)) {
      useFavoritesStore.getState().apply(payload.favorites);
    }
    if (Array.isArray(payload.threads)) {
      useThreadsStore.getState().applyFollowed(payload.threads);
    }
    if (Array.isArray(payload.drafts)) {
      useDraftStore.getState().seed(payload.drafts);
    }
    if (Array.isArray(payload.inputHistory)) {
      useInputHistoryStore.getState().seed(payload.inputHistory);
    }
    if (payload.uploadChunkBytes !== undefined || payload.uploadCeilingBytes !== undefined) {
      useUploadsStore.getState().setLimits({
        chunkBytes: payload.uploadChunkBytes ?? null,
        ceilingBytes: payload.uploadCeilingBytes ?? null,
      });
    }
    useConfigStore
      .getState()
      .setJitsiUrl(typeof payload.jitsiUrl === 'string' ? payload.jitsiUrl : null);
    if (useConfigStore.getState().features.dcc) {
      void useDccStore.getState().fetchAll();
    }
    useReactionsStore.getState().resync();
    return;
  }

  if (payload.kind === 'backlog') {
    const nid = payload.networkId ?? null;
    const target = payload.target;
    if (!target) return;
    const events = payload.events || [];
    for (const e of events) trackSeenId(e?.id);
    if (nid != null) {
      useReactionsStore.getState().noteFromEvents(events, nid);
      useRedactionsStore.getState().noteFromEvents(events, nid);
      useBookmarksStore.getState().noteFromEvents(events, nid);
    }
    buffers.replaceBacklog(nid, target, events, payload.speakers, payload.readState, payload.joined, {
      reset: !!payload.reset,
      hasMoreOlder: payload.hasMoreOlder,
      bufferId: payload.bufferId,
    });
    maybeInspectServerBuffer(nid, target, events, payload);
    primeEventPreviews(events, nid, target);
    return;
  }

  if (payload.kind === 'history') {
    const nid = payload.networkId ?? null;
    const target = payload.target;
    if (!target) return;
    const events = payload.events || [];
    for (const e of events) trackSeenId(e?.id);
    if (nid != null) {
      useReactionsStore.getState().noteFromEvents(events, nid);
      useRedactionsStore.getState().noteFromEvents(events, nid);
      useBookmarksStore.getState().noteFromEvents(events, nid);
    }
    if (payload.mode === 'around') {
      buffers.applyAroundSlice(nid, target, payload);
    } else if (payload.mode === 'latest') {
      buffers.applyLatestReplace(nid, target, payload);
    } else if (payload.direction === 'newer' || payload.mode === 'after') {
      buffers.appendHistory(nid, target, events, !!payload.hasMoreNewer);
    } else {
      buffers.prependHistory(nid, target, events, !!payload.hasMoreOlder);
    }
    maybeInspectServerBuffer(nid, target, events, payload);
    primeEventPreviews(events, nid, target);
    return;
  }

  if (payload.kind === 'irc') {
    handleIrcEvent(payload.event || payload);
    return;
  }

  if (payload.kind === 'account-state') {
    const auth = useAuthStore.getState();
    if (typeof payload.paused === 'boolean') auth.setPaused(payload.paused);
    if (payload.restrictions) auth.setRestrictions(payload.restrictions);
    return;
  }

  if (payload.kind === 'settings') {
    useSettingsStore.getState().applyRemote({ changes: payload.changes, resets: payload.resets });
    if (payload.uploadCeilingBytes !== undefined) {
      useUploadsStore.getState().setLimits({ ceilingBytes: payload.uploadCeilingBytes });
    }
    if ('jitsiUrl' in payload) {
      useConfigStore
        .getState()
        .setJitsiUrl(typeof payload.jitsiUrl === 'string' ? payload.jitsiUrl : null);
    }
    return;
  }

  if (payload.kind === 'aliases-changed') {
    useAliasesStore.getState().applyServerChanged();
    return;
  }

  if (payload.kind === 'e2e-channels-changed') {
    useE2eChannelsStore.getState().applyChange(payload.networkId, payload.channels);
    return;
  }

  if (payload.kind === 'avatar-sets-changed') {
    useAvatarSetsStore.getState().fetchAll().catch(() => {});
    return;
  }

  if (payload.kind === 'themes-changed') {
    useThemesStore.getState().fetchAll().catch(() => {});
    return;
  }

  if (payload.kind === 'highlight-rules-changed') {
    useHighlightRulesStore.getState().fetchAll().catch(() => {});
    return;
  }

  if (payload.kind === 'read-state') {
    buffers.applyReadState(payload.networkId ?? null, payload.target, payload);
    return;
  }

  if (payload.kind === 'buffer-cleared') {
    buffers.applyClearedState(payload.networkId ?? null, payload.target, payload);
    return;
  }

  if (payload.kind === 'buffer-renamed') {
    applyBufferRenamed(payload);
    return;
  }

  if (payload.kind === 'buffer-closed') {
    bufferClosed(payload.networkId ?? null, payload.target);
    return;
  }

  if (payload.kind === 'input-history-added') {
    useInputHistoryStore.getState().add(payload.networkId, payload.target, payload.entry);
    return;
  }

  if (payload.kind === 'draft-snapshot') {
    useDraftStore.getState().seed(payload.drafts || []);
    return;
  }

  if (payload.kind === 'draft-updated') {
    useDraftStore.getState().applyRemote(payload);
    return;
  }

  if (payload.kind === 'chanlist-state') {
    useChanlistStore.getState().applyState(payload);
    return;
  }

  if (payload.kind === 'chanlist-result') {
    useChanlistStore.getState().applyResult(payload);
    return;
  }

  if (payload.kind === 'pins-changed') {
    usePinsStore.getState().setNetwork(payload.networkId, payload.pinned || []);
    return;
  }

  if (payload.kind === 'favorites-changed') {
    useFavoritesStore.getState().apply(payload.entries || []);
    return;
  }

  if (payload.kind === 'nicklist-collapsed-changed') {
    useNicklistCollapseStore.getState().setNetwork(payload.networkId, payload.collapsed || []);
    return;
  }

  if (payload.kind === 'channel-notify-changed') {
    useChannelNotifyStore.getState().setNetwork(payload.networkId, payload.levels || {});
    return;
  }

  if (payload.kind === 'ignore-list-updated') {
    useIgnoresStore.getState().applyUpdate(payload.networkId ?? null, payload.rules || []);
    return;
  }

  if (payload.kind === 'nick-note-updated') {
    useNickNotesStore.getState().applyUpdate(payload.networkId, payload.nick, payload.note ?? null);
    return;
  }

  if (payload.kind === 'relay-bot-updated') {
    useRelayBotsStore
      .getState()
      .applyUpdate(
        payload.networkId,
        Array.isArray(payload.bots) ? payload.bots : payload.nick,
        !!payload.marked,
        payload.pattern || '',
      );
    return;
  }

  if (payload.kind === 'dcc-transfer') {
    if (payload.transfer) useDccStore.getState().applyTransfer(payload.transfer);
    return;
  }

  if (payload.kind === 'dcc-file') {
    if (payload.file) useDccStore.getState().applyFile(payload.file);
    return;
  }

  if (payload.kind === 'dcc-file-deleted') {
    if (typeof payload.id === 'number') useDccStore.getState().applyFileDeleted(payload.id);
    return;
  }

  if (payload.kind === 'dcc-transfers-cleared') {
    useDccStore.getState().applyTransfersCleared();
    return;
  }

  if (payload.kind === 'reaction') {
    useReactionsStore.getState().applyFrame(payload);
    return;
  }

  if (payload.kind === 'message-redacted') {
    useRedactionsStore.getState().applyFrame(payload);
    return;
  }

  if (payload.kind === 'reactions-sync') {
    useReactionsStore.getState().applySync(payload);
    useRedactionsStore.getState().applySync(payload);
    return;
  }

  if (payload.kind === 'thread') {
    useThreadsStore.getState().applyThread(payload);
    return;
  }

  if (payload.kind === 'threads') {
    useThreadsStore.getState().applyThreads(payload);
    return;
  }

  if (payload.kind === 'threads-changed') {
    useThreadsStore.getState().applyFollowed(payload.threads || []);
    return;
  }

  if (payload.kind === 'bookmark-updated') {
    useBookmarksStore.getState().applyRemote(payload);
    return;
  }

  if (payload.kind === 'buffer-opened') {
    const buf = buffers.ensure(payload.networkId, payload.target, payload.bufferId);
    if (buffers.claimPendingOpen(payload.networkId, payload.target)) {
      buffers.activate(payload.networkId, buf.target);
    }
    return;
  }

  if (payload.kind === 'buffer-reopened') {
    buffers.ensure(payload.networkId, payload.target, payload.bufferId);
    return;
  }

  if (payload.kind === 'send-result') {
    const resolver = pendingAcks.get(payload.clientId);
    if (resolver) {
      pendingAcks.delete(payload.clientId);
      resolver({ ok: !!payload.ok, error: payload.error, data: payload.data });
    }
    return;
  }

  if (payload.kind === 'export') {
    if (payload.job) useDataExportStore.getState().applyFrame(payload.job);
    return;
  }

  if (payload.kind === 'error') {
    useToastsStore.getState().push({
      title: 'Error',
      body: payload.text || payload.message || 'Server error',
      kind: 'error',
    });
    return;
  }

  if (payload.kind === 'upload-progress') {
    useUploadsStore.getState().applyProgress(payload);
    return;
  }

  if (payload.kind === 'upload-thumbnail') {
    useUploadsStore.getState().applyThumbnail(payload);
    return;
  }

  // Fallback: check active buffer hydration
  void networks;
}

function failAllPendingAcks(reason: string): void {
  for (const [id, resolve] of pendingAcks.entries()) {
    pendingAcks.delete(id);
    resolve({ ok: false, error: reason });
  }
}

export function send(payload: Record<string, unknown>): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  if (payload.type === 'history') armLivenessProbe();
  return true;
}

export function sendWithAck(payload: Record<string, unknown>): Promise<AckResult> {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.resolve({ ok: false, error: 'not connected' });
  }
  const clientId = makeClientId();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingAcks.delete(clientId)) {
        resolve({ ok: false, error: 'request timed out' });
      }
    }, ACK_TIMEOUT_MS);
    pendingAcks.set(clientId, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
    socket!.send(JSON.stringify({ ...payload, clientId }));
  });
}

registerSocketSenders(send, sendWithAck);

let previewToggleUnsub: (() => void) | null = null;

function currentPreviewToggles(): { inlineMedia: boolean; linkPreviews: boolean } {
  const featureOn = useConfigStore.getState().features.linkPreviews;
  const settings = useSettingsStore.getState();
  return {
    inlineMedia: featureOn && settings.effective('chat.inline_media.enabled') === true,
    linkPreviews: featureOn && settings.effective('chat.link_previews.enabled') === true,
  };
}

function reprimeAllLoadedBuffers(): void {
  const buffers = useBuffersStore.getState().buffers;
  for (const buf of Object.values(buffers)) {
    if (buf.messages.length > 0) {
      primeEventPreviews(buf.messages, buf.networkId, buf.target);
    }
  }
  const threadView = useThreadsStore.getState().view;
  if (threadView) {
    const threadEvents = [
      ...(threadView.root ? [threadView.root] : []),
      ...threadView.replies,
    ];
    if (threadEvents.length > 0) {
      primeEventPreviews(threadEvents, threadView.networkId, threadView.target);
    }
  }
}

function wirePreviewToggleReprime(): void {
  if (previewToggleUnsub) return;
  let prev = currentPreviewToggles();
  const check = () => {
    const next = currentPreviewToggles();
    const gained = (next.inlineMedia && !prev.inlineMedia) || (next.linkPreviews && !prev.linkPreviews);
    prev = next;
    if (gained) reprimeAllLoadedBuffers();
  };
  const unsubSettings = useSettingsStore.subscribe(check);
  const unsubConfig = useConfigStore.subscribe(check);
  previewToggleUnsub = () => {
    unsubSettings();
    unsubConfig();
  };
}

function wireVisibility(): void {
  if (visibilityWired) return;
  visibilityWired = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenSince = Date.now();
    } else {
      const elapsed = hiddenSince ? Date.now() - hiddenSince : 0;
      hiddenSince = null;
      if (elapsed > HIDDEN_RESNAPSHOT_MS && socket && socket.readyState === WebSocket.OPEN) {
        send({ type: 'snapshot' });
        armLivenessProbe();
      }
    }
  });
}

export function connectSocket(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  wireVisibility();
  wirePreviewToggleReprime();
  resetNamesAsked();
  serverHistoryDepth.clear();
  serverVersionProbeSent.clear();

  const ac = new AbortController();
  socketListeners = ac;
  const ws = new WebSocket(wsUrl());
  socket = ws;

  ws.addEventListener(
    'open',
    () => {
      socketOpenedAt = Date.now();
      lastMessageAt = Date.now();
      setConnected(true);
      for (const h of openHandlers) {
        try {
          h();
        } catch {
          /* ignore */
        }
      }
      // Ensure active buffer is hydrated if needed
      const active = useBuffersStore.getState().active();
      if (active && (active.unseeded || active.pendingRefetch)) {
        useBuffersStore.getState().reattachToLive(active.networkId, active.target);
      }
    },
    { signal: ac.signal },
  );

  ws.addEventListener(
    'message',
    (e) => {
      if (typeof e.data === 'string') handleMessage(e.data);
    },
    { signal: ac.signal },
  );

  ws.addEventListener(
    'close',
    (e) => {
      if (livenessProbeTimer) {
        clearTimeout(livenessProbeTimer);
        livenessProbeTimer = null;
      }
      setConnected(false);
      socket = null;
      failAllPendingAcks('connection closed');
      useBuffersStore.getState().failInFlightHistory();

      if (e.code === WS_CLOSE_SESSION_REVOKED) {
        void useAuthStore.getState().logout();
        return;
      }

      const lasted = socketOpenedAt ? Date.now() - socketOpenedAt : 0;
      socketOpenedAt = null;
      if (lasted >= RECONNECT_STABLE_MS) reconnectAttempts = 0;
      else reconnectAttempts += 1;

      if (useAuthStore.getState().user) {
        const delay = nextReconnectDelay();
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connectSocket();
        }, delay);
      }
    },
    { signal: ac.signal },
  );
}

export function resetSocket(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (livenessProbeTimer) {
    clearTimeout(livenessProbeTimer);
    livenessProbeTimer = null;
  }
  socketListeners?.abort();
  socketListeners = null;
  previewToggleUnsub?.();
  previewToggleUnsub = null;
  if (socket) {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
    socket = null;
  }
  setConnected(false);
  reconnectAttempts = 0;
  socketOpenedAt = null;
  failAllPendingAcks('socket reset');
}

export function reconnectSocket(): void {
  resetSocket();
  connectSocket();
}

// Keep unused import check happy for newestHeldId
void newestHeldId;
