// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { useNetworksStore } from './networks';
import { useToastsStore } from './toasts';
import { socketSend } from '../services/socketBus';
import { seenEventCursor } from '../lib/seenEventCursor';
import { SYSTEM_KEY } from '../lib/virtualBuffers';
import { setUnreadDividerShown, unreadDividerShown } from '../lib/unreadDivider';
import { historyCountBy } from '../lib/historyPaging';
export { historyCountBy };
import { isChannelTarget, isDccChatTarget } from '../shared/channels';

const MAX_PER_BUFFER = 500;
const MAX_MERGE_ROWS = 250;
const MAX_SPEAKERS = 128;
const TYPING_DURATIONS: Record<string, number> = { active: 6000, paused: 30000 };
const PENDING_JOIN_TIMEOUT = 10000;
const PENDING_OPEN_TIMEOUT = 10000;

const NAMES_RETRY_COOLDOWN_MS = 8000;
const namesAsked = new Map<string, number>();
export function resetNamesAsked(): void {
  namesAsked.clear();
}
export function clearNamesAskedForChannel(networkId: number | string | null, target: string): void {
  if (networkId == null || !target) return;
  namesAsked.delete(`${networkId}::${target.toLowerCase()}`);
}
export function clearNamesAskedForNetwork(networkId: number | string | null): void {
  if (networkId == null) return;
  const prefix = `${networkId}::`;
  for (const k of Array.from(namesAsked.keys())) {
    if (k.startsWith(prefix)) namesAsked.delete(k);
  }
}

const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingJoins = new Map<string, ReturnType<typeof setTimeout>>();
const pendingOpens = new Map<string, ReturnType<typeof setTimeout>>();
const keyById = new Map<number, string>();

let historyTokenCounter = 0;
function nextHistoryToken(): number {
  historyTokenCounter += 1;
  return historyTokenCounter;
}

export function bufferKeyForId(bufferId: number): string | undefined {
  return keyById.get(bufferId);
}

export function bufferKey(networkId: number | string | null, target: string): string {
  return networkId == null ? target : `${networkId}::${target}`;
}

function joinKey(networkId: number | string, channel: string): string {
  return `${networkId}::${channel.toLowerCase()}`;
}

function typingKey(networkId: number | string | null, target: string, nick: string): string {
  return `${networkId}::${target}::${nick.toLowerCase()}`;
}

function clearTypingTimer(networkId: number | string | null, target: string, nick: string) {
  const k = typingKey(networkId, target, nick);
  const id = typingTimers.get(k);
  if (id) {
    clearTimeout(id);
    typingTimers.delete(k);
  }
}

export interface BufferMember {
  nick: string;
  modes: string[];
  away: boolean;
  user?: string | null;
  host?: string | null;
  account?: string | null;
}

export interface TypingEntry {
  nick: string;
  state: string;
  expiresAt: number;
  userhost: string | null;
}

export interface SpeakerEntry {
  nick: string;
  lastTime: number;
}

export interface BufferMessage {
  id?: number | null;
  networkId: number | null;
  target: string;
  type: string;
  nick?: string;
  body?: string;
  createdAt?: string;
  sentTo?: { target: string; text: string };
  [key: string]: unknown;
}

export type BufferKind = 'channel' | 'dm' | 'dcc' | 'server' | 'system';

export interface ChannelMetadataEntry {
  displayName?: string;
  avatarUrl?: string | null;
}

export interface Buffer {
  id?: number;
  networkId: number | null;
  kind: BufferKind;
  target: string;
  messages: BufferMessage[];
  members: BufferMember[];
  membersKnown: 'none' | 'partial' | 'full';
  topic: string | null;
  joined: boolean;
  unread: number;
  highlighted: number;
  highlightsCapped: boolean;
  lastReadId: number;
  dividerAfterId: number | null;
  clearedBeforeId: number;
  clearedAt: string | null;
  typing: Record<string, TypingEntry>;
  oldestId: number | null;
  newestId: number | null;
  hasMoreOlder: boolean;
  hasMoreNewer: boolean;
  loadingHistory: boolean;
  speakers: Record<string, SpeakerEntry>;
  detached: boolean;
  liveDuringDetach: number;
  pendingHistoryToken: number | null;
  pendingRefetch: boolean;
  unseeded: boolean;
  liveTailId?: number | null;
  modes?: string;
  modeParams?: Record<string, string>;
  createdAt?: string | null;
  topicSetBy?: string | null;
  topicSetAt?: string | null;
  metadata?: ChannelMetadataEntry;
}

function deriveKind(networkId: number | null, target: string): BufferKind {
  if (networkId == null) return 'system';
  if (isChannelTarget(target)) return 'channel';
  if (target.startsWith(':server:')) return 'server';
  if (isDccChatTarget(target)) return 'dcc';
  return 'dm';
}

export function newestHeldId(messages: BufferMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const id = messages[i]?.id;
    if (typeof id === 'number') return id;
  }
  return 0;
}

/**
 * Keep an around-anchor slice bounded to `max` rows while centering around the
 * target message instead of dropping older context before it.
 */
export function windowAroundAnchor(
  events: BufferMessage[],
  anchorId: unknown,
  max: number,
): { events: BufferMessage[]; trimmedOlder: boolean; trimmedNewer: boolean } {
  if (events.length <= max) return { events, trimmedOlder: false, trimmedNewer: false };
  const idx = typeof anchorId === 'number' ? events.findIndex((e) => e.id === anchorId) : -1;
  if (idx === -1) return { events: events.slice(-max), trimmedOlder: true, trimmedNewer: false };
  const half = Math.floor(max / 2);
  let start = Math.max(0, idx - half);
  const end = Math.min(events.length, start + max);
  start = Math.max(0, end - max);
  return {
    events: events.slice(start, end),
    trimmedOlder: start > 0,
    trimmedNewer: end < events.length,
  };
}

function resolveExistingKey(
  buffers: Record<string, Buffer>,
  networkId: number | string | null,
  target: string,
): string | null {
  const exact = bufferKey(networkId, target);
  if (buffers[exact]) return exact;
  if (target.startsWith(':')) return null;
  const nid = Number(networkId);
  const lower = target.toLowerCase();
  for (const [k, b] of Object.entries(buffers)) {
    if (b.networkId === nid && b.target.toLowerCase() === lower) return k;
  }
  return null;
}

export function idFor(networkId: number | string | null, target: string): number | undefined {
  const buffers = useBuffersStore.getState().buffers;
  const k = resolveExistingKey(buffers, networkId, target);
  return k ? buffers[k].id : undefined;
}

function createEmptyBuffer(
  networkId: number | null,
  target: string,
  bufferId?: number | null,
): Buffer {
  return {
    ...(typeof bufferId === 'number' ? { id: bufferId } : {}),
    networkId,
    kind: deriveKind(networkId, target),
    target,
    messages: [],
    members: [],
    membersKnown: 'none',
    topic: null,
    joined: false,
    unread: 0,
    highlighted: 0,
    highlightsCapped: false,
    lastReadId: 0,
    dividerAfterId: null,
    clearedBeforeId: 0,
    clearedAt: null,
    typing: {},
    oldestId: null,
    newestId: null,
    hasMoreOlder: false,
    hasMoreNewer: false,
    loadingHistory: false,
    speakers: {},
    detached: false,
    liveDuringDetach: 0,
    pendingHistoryToken: null,
    pendingRefetch: false,
    unseeded: false,
    modes: '',
    modeParams: {},
  };
}

function capSpeakers(speakers: Record<string, SpeakerEntry>, ...keep: string[]): void {
  const keys = Object.keys(speakers);
  for (let excess = keys.length - MAX_SPEAKERS; excess > 0; excess--) {
    let oldestKey: string | null = null;
    for (const k of keys) {
      if (keep.includes(k) || !(k in speakers)) continue;
      if (oldestKey == null || speakers[k].lastTime < speakers[oldestKey].lastTime) oldestKey = k;
    }
    if (oldestKey == null) return;
    delete speakers[oldestKey];
  }
}

function recordBufferId(buf: Buffer, key: string, bufferId?: number | null): void {
  if (typeof bufferId !== 'number') return;
  buf.id = bufferId;
  keyById.set(bufferId, key);
}

function getOrCreateBuffer(
  buffers: Record<string, Buffer>,
  networkId: number | string | null,
  target: string,
  bufferId?: number | null,
): { key: string; buf: Buffer; isNew: boolean } {
  const nid = networkId == null ? null : Number(networkId);
  const existing = resolveExistingKey(buffers, nid, target);
  if (existing) {
    const buf = { ...buffers[existing] };
    recordBufferId(buf, existing, bufferId);
    return { key: existing, buf, isNew: false };
  }
  const key = bufferKey(nid, target);
  const buf = createEmptyBuffer(nid, target, bufferId);
  recordBufferId(buf, key, bufferId);
  return { key, buf, isNew: true };
}

function snapshotLiveTailId(buf: Buffer): number | null {
  const held = newestHeldId(buf.messages);
  if (held > 0) return held;
  if (buf.networkId == null) return null;
  const cursor = seenEventCursor();
  return cursor > 0 ? cursor : null;
}

interface BuffersStoreState {
  buffers: Record<string, Buffer>;
  byKey: (key: string) => Buffer | null;
  hasBuffer: (networkId: number | string | null, target: string) => boolean;
  findByTarget: (networkId: number | string | null, target: string) => Buffer | null;
  forNetwork: (networkId: number) => Buffer[];
  active: () => Buffer | null;
  ensure: (networkId: number | string | null, target: string, bufferId?: number | null) => Buffer;
  pushMessage: (event: BufferMessage) => boolean;
  pushLive: (event: BufferMessage) => 'shown' | 'replay' | 'detached' | 'none';
  replaceBacklog: (
    networkId: number | string | null,
    target: string,
    events: BufferMessage[],
    speakers: SpeakerEntry[] | undefined,
    readState: any,
    joined: boolean | undefined,
    opts?: { reset?: boolean; hasMoreOlder?: boolean; bufferId?: number | null },
  ) => void;
  prependHistory: (
    networkId: number | string | null,
    target: string,
    events: BufferMessage[],
    hasMoreOlder: boolean,
  ) => void;
  appendHistory: (
    networkId: number | string | null,
    target: string,
    events: BufferMessage[],
    hasMoreNewer: boolean,
  ) => void;
  detachForJump: (networkId: number | string | null, target: string) => void;
  loadAround: (
    networkId: number | string | null,
    target: string,
    messageId: number,
    limit?: number,
  ) => number | null;
  applyAroundSlice: (networkId: number | string | null, target: string, payload: any) => void;
  reattachToLive: (networkId: number | string | null, target: string, limit?: number) => boolean;
  ensureHydrated: (networkId: number | string | null, target: string) => void;
  failInFlightHistory: () => void;
  openBuffer: (networkId: number | string, target: string) => boolean;
  openDm: (networkId: number | string, nick: string) => void;
  claimPendingOpen: (networkId: number | string, target: string) => boolean;
  applyLatestReplace: (networkId: number | string | null, target: string, payload: any) => void;
  clearDetached: () => void;
  setLoadingHistory: (networkId: number | string | null, target: string, loading: boolean) => void;
  setMembers: (
    networkId: number | string,
    target: string,
    members: BufferMember[],
    kindOrOpts?: 'full' | 'partial' | { provisional?: boolean },
  ) => void;
  clearMembers: (networkId: number | string, target: string) => void;
  ensureMembers: (networkId: number | string | null, target: string) => boolean;
  setTopic: (
    networkId: number | string,
    target: string,
    topic: string | null,
    meta?: { setBy?: string | null; setAt?: string | null },
  ) => void;
  setChannelModes: (
    networkId: number | string,
    target: string,
    modes: string,
    modeParams?: Record<string, string>,
    createdAt?: string | null,
  ) => void;
  setChannelMetadata: (
    networkId: number | string,
    target: string,
    metadata: ChannelMetadataEntry | undefined,
  ) => void;
  removeMember: (networkId: number | string, target: string, nick: string) => void;
  addMember: (networkId: number | string, target: string, nick: string, extra?: Partial<BufferMember>) => void;
  updateMember: (
    networkId: number | string,
    target: string,
    nick: string,
    patch: Partial<BufferMember>,
  ) => void;
  renameMember: (
    networkId: number | string,
    target: string,
    oldNick: string,
    newNick: string,
  ) => void;
  recordSpeaker: (networkId: number | string, target: string, nick: string, time: number) => void;
  seedSpeakers: (networkId: number | string, target: string, list: SpeakerEntry[]) => void;
  drop: (networkId: number | string | null, target: string) => void;
  dropBuffer: (networkId: number | string | null, target: string) => void;
  rekeyBuffer: (networkId: number | string | null, from: string, to: string) => void;
  resetTimers: () => void;
  requestJoin: (networkId: number | string, channel: string) => void;
  confirmPendingJoin: (networkId: number | string, channel: string) => boolean;
  cancelPendingJoin: (networkId: number | string, channel: string) => void;
  joinOrActivate: (networkId: number | string, channel: string, key?: string) => boolean;
  joinOrToast: (networkId: number | string, target: string) => boolean;
  setJoined: (networkId: number | string, target: string, joined: boolean) => void;
  applyReadState: (networkId: number | string | null, target: string, payload: any) => void;
  applyClearedState: (networkId: number | string | null, target: string, payload: any) => void;
  clearBuffer: (networkId: number | string | null, target: string) => void;
  unclearBuffer: (networkId: number | string | null, target: string) => void;
  activate: (networkId: number | string | null, target: string, opts?: { skipHydrate?: boolean }) => void;
  setTyping: (
    networkId: number | string,
    target: string,
    nick: string,
    state: string,
    userhost?: string | null,
  ) => void;
  markAllRead: () => void;
  reset: () => void;
}

export const useBuffersStore = create<BuffersStoreState>((set, get) => ({
  buffers: {},

  byKey: (key) => get().buffers[key] || null,

  hasBuffer: (networkId, target) =>
    resolveExistingKey(get().buffers, networkId, target) !== null,

  findByTarget: (networkId, target) => {
    const key = resolveExistingKey(get().buffers, networkId, target);
    return key ? get().buffers[key] : null;
  },

  forNetwork: (networkId) => {
    const nid = Number(networkId);
    return Object.values(get().buffers).filter((b) => b.networkId === nid);
  },

  active: () => {
    const activeKey = useNetworksStore.getState().activeKey;
    return activeKey ? get().buffers[activeKey] || null : null;
  },

  ensure: (networkId, target, bufferId) => {
    const state = get();
    const { key, buf, isNew } = getOrCreateBuffer(state.buffers, networkId, target, bufferId);
    if (isNew || (typeof bufferId === 'number' && state.buffers[key]?.id !== bufferId)) {
      set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
    }
    return buf;
  },

  pushMessage: (event) => get().pushLive(event) === 'shown',

  pushLive: (event) => {
    if (!event.target) return 'none';
    const state = get();
    const { key, buf } = getOrCreateBuffer(
      state.buffers,
      event.networkId,
      event.target,
      typeof (event as any).bufferId === 'number' ? (event as any).bufferId : undefined,
    );

    if (buf.detached) {
      if (event.id != null) {
        if (event.id <= (buf.liveTailId ?? 0)) return 'replay';
        buf.liveTailId = event.id;
      }
      buf.liveDuringDetach += 1;
      if (!event.replay && event.nick && buf.typing[event.nick.toLowerCase()]) {
        clearTypingTimer(buf.networkId, buf.target, event.nick);
        const typing = { ...buf.typing };
        delete typing[event.nick.toLowerCase()];
        buf.typing = typing;
      }
      set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
      return 'detached';
    }

    const prevMaxId = newestHeldId(buf.messages);
    if (event.id != null && event.id <= prevMaxId) return 'replay';

    const messages = [...buf.messages, event];
    if (messages.length > MAX_PER_BUFFER) {
      messages.splice(0, messages.length - MAX_PER_BUFFER);
      buf.oldestId = messages[0]?.id ?? buf.oldestId;
      buf.hasMoreOlder = true;
    }
    buf.messages = messages;
    if (buf.oldestId == null && event.id != null) buf.oldestId = event.id;
    if (event.id != null) buf.newestId = event.id;

    if (event.id != null) {
      const isActive = useNetworksStore.getState().activeKey === bufferKey(buf.networkId, buf.target);
      if (isActive) {
        if (buf.dividerAfterId != null) {
          const listSays = buf.unseeded
            ? null
            : unreadDividerShown(bufferKey(buf.networkId, buf.target));
          const noBoundary = listSays === null ? buf.dividerAfterId >= prevMaxId : !listSays;
          if (noBoundary) buf.dividerAfterId = event.id;
        }
        if (event.id > buf.lastReadId) {
          buf.lastReadId = event.id;
          socketSend({
            type: 'mark-read',
            bufferId: buf.id,
            networkId: buf.networkId,
            target: buf.target,
            messageId: event.id,
          });
        }
      }
    }

    if (!event.replay && event.nick && buf.typing[event.nick.toLowerCase()]) {
      clearTypingTimer(buf.networkId, buf.target, event.nick);
      const typing = { ...buf.typing };
      delete typing[event.nick.toLowerCase()];
      buf.typing = typing;
    }

    set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
    return 'shown';
  },

  replaceBacklog: (networkId, target, events, speakers, readState, joined, opts = {}) => {
    const state = get();
    const { key, buf } = getOrCreateBuffer(state.buffers, networkId, target, opts.bufferId);

    if (buf.detached) {
      for (const e of events) {
        if (e.id != null && e.id > (buf.liveTailId ?? 0)) buf.liveTailId = e.id;
      }
      set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
      if (speakers !== undefined) get().seedSpeakers(networkId as number, target, speakers);
      if (readState) get().applyReadState(networkId, target, readState);
      if (typeof joined === 'boolean') get().setJoined(networkId as number, target, joined);
      return;
    }

    const filtered = events.filter((e) => e.type !== 'away' && e.type !== 'back');
    const existingMaxId = newestHeldId(buf.messages);

    if (existingMaxId === 0 || opts.reset) {
      const sliced = filtered.slice(-MAX_PER_BUFFER);
      buf.messages = sliced;
      buf.oldestId = sliced[0]?.id ?? null;
      buf.newestId = sliced[sliced.length - 1]?.id ?? null;
      buf.hasMoreOlder = opts.hasMoreOlder ?? filtered.length > MAX_PER_BUFFER;
      buf.hasMoreNewer = false;
      buf.unseeded = sliced.length === 0 && !!opts.hasMoreOlder;
    } else {
      const fresh = filtered.filter((e) => e.id != null && e.id > existingMaxId);
      if (fresh.length) {
        const merged = [...buf.messages, ...fresh];
        if (merged.length > MAX_PER_BUFFER) {
          merged.splice(0, merged.length - MAX_PER_BUFFER);
          buf.oldestId = merged[0]?.id ?? buf.oldestId;
          buf.hasMoreOlder = true;
        }
        buf.messages = merged;
        buf.newestId = merged[merged.length - 1]?.id ?? buf.newestId;
      }
      if (opts.hasMoreOlder && buf.messages.length === 0) buf.unseeded = true;
    }

    if (typeof joined === 'boolean') buf.joined = joined;

    set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
    if (speakers !== undefined && networkId != null) get().seedSpeakers(networkId, target, speakers);
    if (readState) get().applyReadState(networkId, target, readState);
  },

  prependHistory: (networkId, target, events, hasMoreOlder) => {
    const state = get();
    const key = resolveExistingKey(state.buffers, networkId, target);
    if (!key) return;
    const buf = { ...state.buffers[key], loadingHistory: false };
    const filtered = events.filter((e) => e.type !== 'away' && e.type !== 'back');
    const seen = new Set(buf.messages.map((m) => m.id).filter((id) => id != null));
    const unique = filtered.filter((e) => e.id == null || !seen.has(e.id));
    let added = unique;
    let trimmed = false;
    if (added.length > MAX_MERGE_ROWS) {
      added = added.slice(added.length - MAX_MERGE_ROWS);
      trimmed = true;
    }
    const merged = [...added, ...buf.messages];
    buf.messages = merged;
    buf.oldestId = merged[0]?.id ?? buf.oldestId;
    if (buf.newestId == null) buf.newestId = merged[merged.length - 1]?.id ?? null;
    buf.hasMoreOlder = trimmed || hasMoreOlder;
    set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
  },

  appendHistory: (networkId, target, events, hasMoreNewer) => {
    const state = get();
    const key = resolveExistingKey(state.buffers, networkId, target);
    if (!key) return;
    const buf = { ...state.buffers[key], loadingHistory: false };
    const filtered = events.filter((e) => e.type !== 'away' && e.type !== 'back');
    const seen = new Set(buf.messages.map((m) => m.id).filter((id) => id != null));
    const unique = filtered.filter((e) => e.id == null || !seen.has(e.id));
    let added = unique;
    let trimmed = false;
    if (added.length > MAX_MERGE_ROWS) {
      added = added.slice(0, MAX_MERGE_ROWS);
      trimmed = true;
    }
    const merged = [...buf.messages, ...added];
    buf.messages = merged;
    buf.newestId = merged[merged.length - 1]?.id ?? buf.newestId;
    buf.hasMoreNewer = trimmed || hasMoreNewer;
    if (!buf.hasMoreNewer && buf.detached) {
      buf.detached = false;
      buf.liveDuringDetach = 0;
    }
    set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
  },

  detachForJump: (networkId, target) => {
    const state = get();
    const { key, buf } = getOrCreateBuffer(state.buffers, networkId, target);
    if (!buf.detached) {
      buf.liveTailId = snapshotLiveTailId(buf);
      buf.detached = true;
      buf.liveDuringDetach = 0;
    }
    set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
  },

  loadAround: (networkId, target, messageId, limit = 100) => {
    if (typeof target === 'string' && target.startsWith(':server:')) return null;
    const anchorId = Number(messageId);
    if (!Number.isInteger(anchorId) || anchorId <= 0) return null;
    const state = get();
    const { key, buf } = getOrCreateBuffer(state.buffers, networkId, target);
    const wasDetached = buf.detached;
    const prevLiveTailId = buf.liveTailId;
    const prevLiveDuringDetach = buf.liveDuringDetach;
    if (!wasDetached) {
      buf.liveTailId = snapshotLiveTailId(buf);
      buf.detached = true;
      buf.liveDuringDetach = 0;
    }
    const token = nextHistoryToken();
    buf.pendingHistoryToken = token;
    buf.loadingHistory = true;
    set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
    const sent = socketSend({
      type: 'history',
      mode: 'around',
      bufferId: buf.id,
      networkId: buf.networkId,
      target: buf.target,
      anchorId,
      limit,
      countBy: historyCountBy(),
      token,
    });
    if (!sent) {
      set((s) => {
        const cur = s.buffers[key];
        if (!cur) return s;
        return {
          buffers: {
            ...s.buffers,
            [key]: {
              ...cur,
              detached: wasDetached,
              liveTailId: prevLiveTailId,
              liveDuringDetach: prevLiveDuringDetach,
              pendingHistoryToken: null,
              loadingHistory: false,
            },
          },
        };
      });
      return null;
    }
    return token;
  },

  applyAroundSlice: (networkId, target, payload) => {
    const state = get();
    const key = resolveExistingKey(state.buffers, networkId, target);
    if (!key) return;
    const buf = { ...state.buffers[key] };
    if (buf.pendingHistoryToken != null && payload.token !== buf.pendingHistoryToken) return;
    buf.pendingHistoryToken = null;
    buf.loadingHistory = false;
    buf.pendingRefetch = false;
    const filtered = ((payload.events || []) as BufferMessage[]).filter(
      (e) => e.type !== 'away' && e.type !== 'back',
    );
    const win = windowAroundAnchor(filtered, payload.anchorId ?? null, MAX_PER_BUFFER);
    buf.messages = win.events;
    buf.oldestId = win.events[0]?.id ?? null;
    buf.newestId = win.events[win.events.length - 1]?.id ?? null;
    buf.hasMoreOlder = win.trimmedOlder || !!payload.hasMoreOlder;
    buf.hasMoreNewer = win.trimmedNewer || !!payload.hasMoreNewer;
    const hiddenByClear =
      buf.clearedBeforeId > 0 &&
      typeof payload.anchorId === 'number' &&
      payload.anchorId <= buf.clearedBeforeId;
    buf.detached = buf.hasMoreNewer || hiddenByClear;
    if (!buf.detached) buf.liveDuringDetach = 0;
    buf.unseeded = false;
    set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
  },

  reattachToLive: (networkId, target, limit = 200) => {
    const state = get();
    const { key, buf } = getOrCreateBuffer(state.buffers, networkId, target);
    const token = nextHistoryToken();
    buf.pendingHistoryToken = token;
    buf.loadingHistory = true;
    set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
    return socketSend({
      type: 'history',
      mode: 'latest',
      bufferId: buf.id,
      networkId: buf.networkId,
      target: buf.target,
      limit,
      countBy: historyCountBy(),
      token,
    });
  },

  ensureHydrated: (networkId, target) => {
    const state = get();
    const key = resolveExistingKey(state.buffers, networkId, target);
    const buf = key ? state.buffers[key] : null;
    if (!buf || buf.unseeded) {
      get().reattachToLive(networkId, target);
    }
  },

  failInFlightHistory: () => {
    set((s) => {
      let changed = false;
      const next = { ...s.buffers };
      for (const [k, b] of Object.entries(next)) {
        if (b.loadingHistory) {
          next[k] = {
            ...b,
            loadingHistory: false,
            pendingHistoryToken: null,
            pendingRefetch: b.unseeded || b.detached,
          };
          changed = true;
        }
      }
      return changed ? { buffers: next } : s;
    });
  },

  openBuffer: (networkId, target) => {
    const pKey = bufferKey(networkId, target).toLowerCase();
    const existing = pendingOpens.get(pKey);
    if (existing) clearTimeout(existing);
    pendingOpens.set(
      pKey,
      setTimeout(() => pendingOpens.delete(pKey), PENDING_OPEN_TIMEOUT),
    );
    return socketSend({ type: 'open-buffer', networkId: Number(networkId), target });
  },

  openDm: (networkId, nick) => {
    get().ensure(networkId, nick);
    get().activate(networkId, nick);
    get().openBuffer(networkId, nick);
  },

  claimPendingOpen: (networkId, target) => {
    const pKey = bufferKey(networkId, target).toLowerCase();
    const t = pendingOpens.get(pKey);
    if (!t) return false;
    clearTimeout(t);
    pendingOpens.delete(pKey);
    return true;
  },

  applyLatestReplace: (networkId, target, payload) => {
    const state = get();
    const { key, buf } = getOrCreateBuffer(state.buffers, networkId, target, payload.bufferId);
    if (payload.token != null && buf.pendingHistoryToken != null && buf.pendingHistoryToken !== payload.token) {
      return;
    }
    buf.pendingHistoryToken = null;
    buf.loadingHistory = false;
    buf.pendingRefetch = false;
    const filtered = ((payload.events || []) as BufferMessage[]).filter(
      (e) => e.type !== 'away' && e.type !== 'back',
    );
    buf.messages = filtered.slice(-MAX_PER_BUFFER);
    buf.oldestId = buf.messages[0]?.id ?? null;
    buf.newestId = buf.messages[buf.messages.length - 1]?.id ?? null;
    buf.hasMoreOlder = !!payload.hasMoreOlder;
    buf.hasMoreNewer = false;
    buf.detached = false;
    buf.liveDuringDetach = 0;
    buf.unseeded = false;
    if (typeof payload.joined === 'boolean') buf.joined = payload.joined;
    set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
    if (Array.isArray(payload.speakers) && networkId != null) {
      get().seedSpeakers(networkId, target, payload.speakers);
    }
    const readState =
      payload.readState ||
      ('unread' in payload || 'lastReadId' in payload || 'highlights' in payload || 'highlighted' in payload
        ? payload
        : null);
    if (readState) get().applyReadState(networkId, target, readState);
  },

  clearDetached: () => {
    set((s) => {
      const next = { ...s.buffers };
      for (const [k, b] of Object.entries(next)) {
        if (b.detached) next[k] = { ...b, detached: false, liveDuringDetach: 0 };
      }
      return { buffers: next };
    });
  },

  setLoadingHistory: (networkId, target, loading) => {
    const key = resolveExistingKey(get().buffers, networkId, target);
    if (!key) return;
    set((s) => ({
      buffers: { ...s.buffers, [key]: { ...s.buffers[key], loadingHistory: loading } },
    }));
  },

  setMembers: (networkId, target, members, kindOrOpts = 'full') => {
    const state = get();
    const { key, buf } = getOrCreateBuffer(state.buffers, networkId, target);
    const provisional =
      typeof kindOrOpts === 'object' ? !!kindOrOpts.provisional : kindOrOpts === 'partial';
    const normalized: BufferMember[] = (members || []).map((m: any) =>
      typeof m === 'string'
        ? { nick: m, modes: [], away: false }
        : {
            nick: m.nick,
            modes: m.modes || [],
            away: !!m.away,
            user: m.user,
            host: m.host,
            account: m.account,
          },
    );
    if (provisional) {
      if (buf.membersKnown === 'full') return;
      if (buf.membersKnown === 'partial' && normalized.length === 0) return;
      if (normalized.length === 0) return;
      const updated = { ...buf, members: normalized, membersKnown: 'partial' as const };
      set((s) => ({ buffers: { ...s.buffers, [key]: updated } }));
      return;
    }
    namesAsked.delete(`${Number(networkId)}::${buf.target.toLowerCase()}`);
    const updated = { ...buf, members: normalized, membersKnown: 'full' as const };
    set((s) => ({ buffers: { ...s.buffers, [key]: updated } }));
  },

  clearMembers: (networkId, target) => {
    const key = resolveExistingKey(get().buffers, networkId, target);
    if (!key) return;
    namesAsked.delete(`${Number(networkId)}::${target.toLowerCase()}`);
    set((s) => ({
      buffers: {
        ...s.buffers,
        [key]: { ...s.buffers[key], members: [], membersKnown: 'none' },
      },
    }));
  },

  ensureMembers: (networkId, target) => {
    if (networkId == null || !isChannelTarget(target)) return false;
    const key = resolveExistingKey(get().buffers, networkId, target);
    const buf = key ? get().buffers[key] : null;
    if (buf && (!buf.joined || buf.membersKnown === 'full')) return false;
    const netState = useNetworksStore.getState().states[Number(networkId)];
    if (netState && netState.state !== 'connected') return false;
    const askKey = `${Number(networkId)}::${(buf?.target ?? target).toLowerCase()}`;
    const lastAsked = namesAsked.get(askKey);
    if (lastAsked != null && Date.now() - lastAsked < NAMES_RETRY_COOLDOWN_MS) return false;
    const sent = socketSend({
      type: 'names',
      networkId: Number(networkId),
      ...(buf?.id != null ? { bufferId: buf.id } : {}),
      target: buf?.target ?? target,
    });
    if (sent) namesAsked.set(askKey, Date.now());
    return sent;
  },

  setTopic: (networkId, target, topic, meta) => {
    const state = get();
    const { key, buf } = getOrCreateBuffer(state.buffers, networkId, target);
    buf.topic = topic;
    if (meta) {
      if (meta.setBy !== undefined) buf.topicSetBy = meta.setBy;
      if (meta.setAt !== undefined) buf.topicSetAt = meta.setAt;
    }
    set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
  },

  setChannelModes: (networkId, target, modes, modeParams, createdAt) => {
    const state = get();
    const { key, buf } = getOrCreateBuffer(state.buffers, networkId, target);
    buf.modes = modes;
    if (modeParams !== undefined) buf.modeParams = modeParams;
    if (createdAt !== undefined) buf.createdAt = createdAt;
    set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
  },

  setChannelMetadata: (networkId, target, metadata) => {
    const state = get();
    const { key, buf } = getOrCreateBuffer(state.buffers, networkId, target);
    buf.metadata = metadata;
    set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
  },

  removeMember: (networkId, target, nick) => {
    const key = resolveExistingKey(get().buffers, networkId, target);
    if (!key) return;
    const lower = nick.toLowerCase();
    set((s) => ({
      buffers: {
        ...s.buffers,
        [key]: {
          ...s.buffers[key],
          members: s.buffers[key].members.filter((m) => m.nick.toLowerCase() !== lower),
        },
      },
    }));
  },

  addMember: (networkId, target, nick, extra) => {
    const state = get();
    const { key, buf } = getOrCreateBuffer(state.buffers, networkId, target);
    const lower = nick.toLowerCase();
    if (buf.members.some((m) => m.nick.toLowerCase() === lower)) return;
    buf.members = [
      ...buf.members,
      { nick, modes: extra?.modes ?? [], away: extra?.away ?? false, ...extra },
    ];
    set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
  },

  updateMember: (networkId, target, nick, patch) => {
    const key = resolveExistingKey(get().buffers, networkId, target);
    if (!key) return;
    const lower = nick.toLowerCase();
    set((s) => {
      const buf = s.buffers[key];
      const idx = buf.members.findIndex((m) => m.nick.toLowerCase() === lower);
      if (idx < 0) return s;
      const members = [...buf.members];
      members[idx] = { ...members[idx], ...patch };
      return { buffers: { ...s.buffers, [key]: { ...buf, members } } };
    });
  },

  renameMember: (networkId, target, oldNick, newNick) => {
    const key = resolveExistingKey(get().buffers, networkId, target);
    if (!key) return;
    const oldLower = oldNick.toLowerCase();
    set((s) => {
      const buf = s.buffers[key];
      const members = buf.members.map((m) =>
        m.nick.toLowerCase() === oldLower ? { ...m, nick: newNick } : m,
      );
      const speakers = { ...buf.speakers };
      if (speakers[oldLower]) {
        speakers[newNick.toLowerCase()] = { nick: newNick, lastTime: speakers[oldLower].lastTime };
        capSpeakers(speakers, oldLower, newNick.toLowerCase());
      }
      return { buffers: { ...s.buffers, [key]: { ...buf, members, speakers } } };
    });
  },

  recordSpeaker: (networkId, target, nick, time) => {
    const key = resolveExistingKey(get().buffers, networkId, target);
    if (!key || !nick) return;
    set((s) => {
      const buf = s.buffers[key];
      const speakers = { ...buf.speakers, [nick.toLowerCase()]: { nick, lastTime: time } };
      capSpeakers(speakers);
      return { buffers: { ...s.buffers, [key]: { ...buf, speakers } } };
    });
  },

  seedSpeakers: (networkId, target, list) => {
    const state = get();
    const { key, buf } = getOrCreateBuffer(state.buffers, networkId, target);
    const speakers = { ...buf.speakers };
    for (const item of list) {
      if (item?.nick) speakers[item.nick.toLowerCase()] = item;
    }
    capSpeakers(speakers);
    buf.speakers = speakers;
    set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
  },

  drop: (networkId, target) => {
    const key = resolveExistingKey(get().buffers, networkId, target);
    if (!key) return;
    set((s) => {
      const next = { ...s.buffers };
      const buf = next[key];
      if (buf?.id != null) keyById.delete(buf.id);
      delete next[key];
      return { buffers: next };
    });
  },

  dropBuffer: (networkId, target) => get().drop(networkId, target),

  rekeyBuffer: (networkId, from, to) => {
    const state = get();
    const fromKey = resolveExistingKey(state.buffers, networkId, from);
    if (!fromKey) return;
    const buf = { ...state.buffers[fromKey], target: to };
    const toKey = bufferKey(buf.networkId, to);
    if (buf.id != null) keyById.set(buf.id, toKey);
    set((s) => {
      const next = { ...s.buffers };
      delete next[fromKey];
      next[toKey] = buf;
      return { buffers: next };
    });
  },

  resetTimers: () => {
    for (const t of typingTimers.values()) clearTimeout(t);
    typingTimers.clear();
    for (const t of pendingJoins.values()) clearTimeout(t);
    pendingJoins.clear();
    for (const t of pendingOpens.values()) clearTimeout(t);
    pendingOpens.clear();
    keyById.clear();
    namesAsked.clear();
  },

  requestJoin: (networkId, channel) => {
    const jk = joinKey(networkId, channel);
    const existing = pendingJoins.get(jk);
    if (existing) clearTimeout(existing);
    pendingJoins.set(
      jk,
      setTimeout(() => pendingJoins.delete(jk), PENDING_JOIN_TIMEOUT),
    );
  },

  confirmPendingJoin: (networkId, channel) => {
    const jk = joinKey(networkId, channel);
    const t = pendingJoins.get(jk);
    if (!t) return false;
    clearTimeout(t);
    pendingJoins.delete(jk);
    return true;
  },

  cancelPendingJoin: (networkId, channel) => {
    const jk = joinKey(networkId, channel);
    const t = pendingJoins.get(jk);
    if (t) {
      clearTimeout(t);
      pendingJoins.delete(jk);
    }
  },

  joinOrActivate: (networkId, channel, key) => {
    const existing = resolveExistingKey(get().buffers, networkId, channel);
    const buf = existing ? get().buffers[existing] : null;
    if (buf && buf.joined) {
      get().activate(networkId, buf.target);
      return true;
    }
    get().requestJoin(networkId, channel);
    return socketSend({
      type: 'join',
      networkId: Number(networkId),
      channel,
      ...(key ? { key } : {}),
    });
  },

  joinOrToast: (networkId, target) => {
    const netState = useNetworksStore.getState().states[networkId];
    if (netState?.state !== 'connected') {
      useToastsStore.getState().push({
        title: 'Not connected',
        body: 'Connect to the network before joining channels.',
        kind: 'warn',
      });
      return false;
    }
    return get().joinOrActivate(networkId, target);
  },

  setJoined: (networkId, target, joined) => {
    const state = get();
    const { key, buf } = getOrCreateBuffer(state.buffers, networkId, target);
    buf.joined = joined;
    if (!joined) {
      buf.members = [];
      buf.membersKnown = 'none';
      clearNamesAskedForChannel(networkId, buf.target);
    }
    set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
  },

  applyReadState: (networkId, target, payload) => {
    const state = get();
    const { key, buf } = getOrCreateBuffer(state.buffers, networkId, target, payload?.bufferId);
    if (typeof payload.lastReadId === 'number') buf.lastReadId = payload.lastReadId;
    if (typeof payload.unread === 'number') buf.unread = payload.unread;
    const hl = typeof payload.highlighted === 'number' ? payload.highlighted : payload.highlights;
    if (typeof hl === 'number') buf.highlighted = hl;
    if (typeof payload.highlightsCapped === 'boolean') buf.highlightsCapped = payload.highlightsCapped;
    if (useNetworksStore.getState().activeKey === bufferKey(buf.networkId, buf.target)) {
      buf.unread = 0;
      buf.highlighted = 0;
      buf.highlightsCapped = false;
    }
    set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
  },

  applyClearedState: (networkId, target, payload) => {
    const state = get();
    const key = resolveExistingKey(state.buffers, networkId, target);
    if (!key) return;
    set((s) => ({
      buffers: {
        ...s.buffers,
        [key]: {
          ...s.buffers[key],
          clearedBeforeId: typeof payload.clearedBeforeId === 'number' ? payload.clearedBeforeId : 0,
          clearedAt: payload.clearedAt ?? null,
        },
      },
    }));
  },

  clearBuffer: (networkId, target) => {
    const key = resolveExistingKey(get().buffers, networkId, target);
    const buf = key ? get().buffers[key] : null;
    const maxId = buf ? newestHeldId(buf.messages) : 0;
    socketSend({
      type: 'clear-buffer',
      bufferId: buf?.id,
      networkId: buf ? buf.networkId : networkId,
      target: buf ? buf.target : target,
      beforeId: maxId,
    });
  },

  unclearBuffer: (networkId, target) => {
    const key = resolveExistingKey(get().buffers, networkId, target);
    const buf = key ? get().buffers[key] : null;
    socketSend({
      type: 'unclear-buffer',
      bufferId: buf?.id,
      networkId: buf ? buf.networkId : networkId,
      target: buf ? buf.target : target,
    });
  },

  activate: (networkId, target, opts) => {
    const state = get();
    const existingKey =
      networkId == null ? SYSTEM_KEY : resolveExistingKey(state.buffers, networkId, target);
    const canonicalTarget = existingKey ? state.buffers[existingKey].target : target;
    const { key, buf } = getOrCreateBuffer(state.buffers, networkId, canonicalTarget);

    if (buf.unread > 0 || buf.highlighted > 0) {
      buf.dividerAfterId = buf.lastReadId > 0 ? buf.lastReadId : null;
      buf.unread = 0;
      buf.highlighted = 0;
      buf.highlightsCapped = false;
    } else {
      buf.dividerAfterId = null;
    }
    setUnreadDividerShown(key, null);

    const maxId = newestHeldId(buf.messages);
    if (!buf.unseeded && maxId > buf.lastReadId) {
      buf.lastReadId = maxId;
      socketSend({
        type: 'mark-read',
        bufferId: buf.id,
        networkId: buf.networkId,
        target: buf.target,
        messageId: maxId,
      });
    }

    set((s) => ({ buffers: { ...s.buffers, [key]: buf } }));
    useNetworksStore.getState().setActive(buf.networkId, buf.target);

    const needsHydration = !opts?.skipHydrate && (buf.unseeded || buf.pendingRefetch);
    if (needsHydration) {
      get().reattachToLive(buf.networkId, buf.target);
    }
    if (!needsHydration && !buf.loadingHistory && buf.kind === 'channel' && buf.joined && buf.membersKnown !== 'full') {
      get().ensureMembers(buf.networkId, buf.target);
    }
  },

  setTyping: (networkId, target, nick, stateStr, userhost = null) => {
    const key = resolveExistingKey(get().buffers, networkId, target);
    if (!key) return;
    const lower = nick.toLowerCase();
    clearTypingTimer(networkId, get().buffers[key].target, nick);

    if (stateStr === 'done') {
      set((s) => {
        const buf = s.buffers[key];
        if (!buf?.typing[lower]) return s;
        const typing = { ...buf.typing };
        delete typing[lower];
        return { buffers: { ...s.buffers, [key]: { ...buf, typing } } };
      });
      return;
    }

    const dur = TYPING_DURATIONS[stateStr] ?? 6000;
    const expiresAt = Date.now() + dur;
    const canonicalTarget = get().buffers[key].target;
    const timer = setTimeout(() => {
      typingTimers.delete(typingKey(networkId, canonicalTarget, nick));
      set((s) => {
        const buf = s.buffers[key];
        if (!buf?.typing[lower]) return s;
        const typing = { ...buf.typing };
        delete typing[lower];
        return { buffers: { ...s.buffers, [key]: { ...buf, typing } } };
      });
    }, dur);
    typingTimers.set(typingKey(networkId, canonicalTarget, nick), timer);

    set((s) => {
      const buf = s.buffers[key];
      return {
        buffers: {
          ...s.buffers,
          [key]: {
            ...buf,
            typing: { ...buf.typing, [lower]: { nick, state: stateStr, expiresAt, userhost } },
          },
        },
      };
    });
  },

  markAllRead: () => {
    set((s) => {
      const next = { ...s.buffers };
      for (const [k, b] of Object.entries(next)) {
        if (b.unread > 0 || b.highlighted > 0) {
          const maxId = newestHeldId(b.messages);
          next[k] = {
            ...b,
            unread: 0,
            highlighted: 0,
            highlightsCapped: false,
            lastReadId: Math.max(b.lastReadId, maxId),
          };
          if (maxId > 0) {
            socketSend({
              type: 'mark-read',
              bufferId: b.id,
              networkId: b.networkId,
              target: b.target,
              messageId: maxId,
            });
          }
        }
      }
      return { buffers: next };
    });
  },

  reset: () => {
    get().resetTimers();
    set({ buffers: {} });
  },
}));
