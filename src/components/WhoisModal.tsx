// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  Bot,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  MessageSquare,
  Pencil,
  Radio,
  RefreshCw,
  Send,
  Shield,
  ShieldBan,
  ShieldOff,
  Trash2,
  User,
} from 'lucide-react';
import { AppModal } from './AppModal';
import { LinkedText } from './LinkedText';
import { openExternalUrl, resolveExternalHref } from '../lib/externalUrl';
import type { PrefixMode } from '../shared/channelModes';
import { useBuffersStore } from '../stores/buffers';
import { useConfigStore } from '../stores/config';
import { useDccStore } from '../stores/dcc';
import { type IgnoreEntry, useIgnoresStore } from '../stores/ignores';
import {
  isNetworkOper,
  type PeerPresenceEntry,
  useNetworksStore,
} from '../stores/networks';
import { useNickNotesStore } from '../stores/nickNotes';
import { useOperStore } from '../stores/oper';
import { useRelayBotsStore } from '../stores/relayBots';
import { normalizeWhoisChannels, useWhoisStore, type WhoisResult } from '../stores/whois';
import { prefixClass, splitChannelToken } from '../utils/memberPrefix';
import { resolveThemedNickColor } from '../lib/nickTheme';
import { isPeerAway, isPeerOffline, isPeerOnline } from '../utils/peerPresence';

const EMPTY_IGNORES: IgnoreEntry[] = [];
const SUBTLE_BORDER = 'color-mix(in srgb, var(--fg) 14%, var(--border))';
const CARD_STYLE: React.CSSProperties = {
  background: 'var(--bg)',
  border: `1px solid ${SUBTLE_BORDER}`,
};
const BUTTON_STYLE: React.CSSProperties = {
  background: 'var(--bg)',
  border: `1px solid ${SUBTLE_BORDER}`,
  color: 'var(--fg)',
};

const TIER_COLOR_VAR: Record<string, string> = {
  'mode-owner': 'var(--member-owner)',
  'mode-admin': 'var(--member-admin)',
  'mode-op': 'var(--member-op)',
  'mode-halfop': 'var(--member-halfop)',
  'mode-voice': 'var(--member-voice)',
};

type BadgeTone = 'good' | 'warn' | 'bad' | 'accent' | 'neutral';

const TONE_STYLES: Record<BadgeTone, React.CSSProperties> = {
  good: {
    background: 'color-mix(in srgb, var(--good) 14%, var(--bg-soft))',
    border: '1px solid color-mix(in srgb, var(--good) 40%, transparent)',
    color: 'var(--good)',
  },
  warn: {
    background: 'color-mix(in srgb, var(--warn) 14%, var(--bg-soft))',
    border: '1px solid color-mix(in srgb, var(--warn) 40%, transparent)',
    color: 'var(--warn)',
  },
  bad: {
    background: 'color-mix(in srgb, var(--bad) 14%, var(--bg-soft))',
    border: '1px solid color-mix(in srgb, var(--bad) 40%, transparent)',
    color: 'var(--bad)',
  },
  accent: {
    background: 'color-mix(in srgb, var(--accent) 16%, var(--bg-soft))',
    border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)',
    color: 'var(--accent)',
  },
  neutral: {
    background: 'var(--bg-soft)',
    border: `1px solid ${SUBTLE_BORDER}`,
    color: 'var(--fg-muted)',
  },
};

function formatDuration(secondsRaw: number | string | undefined, includeSeconds = true): string | null {
  if (secondsRaw == null) return null;
  const total = typeof secondsRaw === 'number' ? secondsRaw : Number(secondsRaw);
  if (!Number.isFinite(total) || total < 0) return null;
  const s = Math.floor(total);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  if (includeSeconds ? parts.length === 0 || secs > 0 : parts.length === 0) {
    parts.push(`${secs}s`);
  }
  return parts.join(' ');
}

function formatSignonTime(
  tsRaw: number | undefined,
): { formatted: string; relative: string | null } | null {
  if (typeof tsRaw !== 'number' || !Number.isFinite(tsRaw) || tsRaw <= 0) return null;
  const ms = tsRaw < 1_000_000_000_000 ? tsRaw * 1000 : tsRaw;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const ageSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  const relative = ageSec >= 60 ? formatDuration(ageSec, false) : null;
  return { formatted: d.toLocaleString(), relative };
}

function presenceInfo(
  peer: PeerPresenceEntry | null,
  result: WhoisResult | null,
): { state: 'online' | 'away' | 'offline'; label: string; color: string; awayText: string | null } {
  const resultAway = typeof result?.away === 'string' && result.away.trim() ? result.away.trim() : null;
  if (resultAway || isPeerAway(peer)) {
    const awayText = resultAway || peer?.awayMessage || null;
    return {
      state: 'away',
      label: 'Away',
      color: 'var(--warn)',
      awayText,
    };
  }
  if (isPeerOffline(peer) && !result) {
    return { state: 'offline', label: 'Offline', color: 'var(--fg-muted)', awayText: null };
  }
  if (isPeerOnline(peer) || (result && !result.error)) {
    return { state: 'online', label: 'Online', color: 'var(--good)', awayText: null };
  }
  return { state: 'offline', label: 'Unknown', color: 'var(--fg-muted)', awayText: null };
}

function prefixColorFor(prefixSymbols: string, prefixSpec: readonly PrefixMode[]): string | undefined {
  if (!prefixSymbols) return undefined;
  const match = prefixSpec.find((p) => p.symbol === prefixSymbols[0]);
  if (!match) return undefined;
  const cls = prefixClass([match.mode], prefixSpec);
  return cls ? TIER_COLOR_VAR[cls] : undefined;
}

function findDirectIgnoreRule(
  globalRules: IgnoreEntry[],
  netRules: IgnoreEntry[],
  networkId: number,
  nick: string,
): { networkId: number | null; entry: IgnoreEntry } | null {
  const lowerNick = nick.toLowerCase();
  const isDirectMask = (entry: IgnoreEntry) => {
    if (entry.isExcept || entry.pattern || (entry.channels && entry.channels.length > 0)) return false;
    const m = (entry.mask || '').toLowerCase();
    return m === lowerNick || m === `${lowerNick}!*@*`;
  };
  const netMatch = netRules.find(isDirectMask);
  if (netMatch) return { networkId, entry: netMatch };
  const globalMatch = globalRules.find(isDirectMask);
  if (globalMatch) return { networkId: null, entry: globalMatch };
  return null;
}

const StatusBadge: React.FC<{
  tone?: BadgeTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ tone = 'neutral', icon, children }) => (
  <span
    className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium"
    style={TONE_STYLES[tone]}
  >
    {icon}
    <span>{children}</span>
  </span>
);

const CopyButton: React.FC<{
  value: string;
  label: string;
  copied: boolean;
  onCopy: (val: string) => void;
}> = ({ value, label, copied, onCopy }) => (
  <button
    type="button"
    onClick={() => onCopy(value)}
    title={copied ? 'Copied!' : label}
    aria-label={label}
    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-opacity hover:opacity-100 opacity-80 shrink-0"
    style={{
      border: `1px solid ${SUBTLE_BORDER}`,
      background: 'var(--bg-soft)',
      color: copied ? 'var(--good)' : 'var(--fg-muted)',
    }}
  >
    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    <span>{copied ? 'Copied' : 'Copy'}</span>
  </button>
);

const SectionCard: React.FC<{
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, right, children }) => (
  <section className="rounded-lg p-3.5 space-y-2.5" style={CARD_STYLE}>
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-muted)] m-0">
        {title}
      </h3>
      {right}
    </div>
    {children}
  </section>
);

const DetailRow: React.FC<{
  label: string;
  mono?: boolean;
  children: React.ReactNode;
}> = ({ label, mono, children }) => (
  <div className="grid grid-cols-1 sm:grid-cols-[136px_1fr] gap-x-3 gap-y-0.5 items-baseline">
    <dt className="text-[12px] text-[var(--fg-muted)] font-medium">{label}</dt>
    <dd
      className={`text-[12.5px] text-[var(--fg)] break-words min-w-0 m-0 ${
        mono ? 'font-mono break-all' : ''
      }`}
    >
      {children}
    </dd>
  </div>
);

const NoteSection: React.FC<{ networkId: number; nick: string }> = ({ networkId, nick }) => {
  const existingNote = useNickNotesStore(
    (s) => s.byNetwork[networkId]?.[nick.toLowerCase()] ?? '',
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setEditing(false);
    setDraft(existingNote || '');
  }, [networkId, nick, existingNote]);

  const startEdit = () => {
    setDraft(existingNote || '');
    setEditing(true);
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    useNickNotesStore.getState().setNote(networkId, nick, draft.trim());
    setEditing(false);
  };

  const clearNote = () => {
    useNickNotesStore.getState().setNote(networkId, nick, '');
    setDraft('');
    setEditing(false);
  };

  return (
    <SectionCard
      title="Personal Note"
      right={
        !editing ? (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] hover:opacity-90"
            style={BUTTON_STYLE}
          >
            <Pencil className="w-3 h-3" />
            <span>{existingNote ? 'Edit' : 'Add Note'}</span>
          </button>
        ) : null
      }
    >
      {editing ? (
        <form onSubmit={save} className="space-y-2">
          <textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Add a private note about ${nick}…`}
            className="w-full rounded-md px-2.5 py-2 text-[12.5px] text-[var(--fg)] focus:outline-none resize-y"
            style={{
              background: 'var(--bg-soft)',
              border: `1px solid ${SUBTLE_BORDER}`,
            }}
          />
          <div className="flex items-center justify-between gap-2">
            {existingNote ? (
              <button
                type="button"
                onClick={clearNote}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[var(--bad)] hover:opacity-85"
                style={{ border: '1px solid color-mix(in srgb, var(--bad) 35%, transparent)' }}
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear Note</span>
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded px-2.5 py-1 text-[11px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
                style={BUTTON_STYLE}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded px-3 py-1 text-[11px] font-semibold hover:opacity-90"
                style={{ background: 'var(--accent)', color: 'var(--bg)' }}
              >
                Save Note
              </button>
            </div>
          </div>
        </form>
      ) : existingNote ? (
        <p className="text-[12.5px] text-[var(--fg)] whitespace-pre-wrap break-words m-0">
          {existingNote}
        </p>
      ) : (
        <p className="text-[12px] text-[var(--fg-muted)] italic m-0">
          No private note saved for this user.
        </p>
      )}
    </SectionCard>
  );
};

export const WhoisModal: React.FC = () => {
  const open = useWhoisStore((s) => s.open);
  const loading = useWhoisStore((s) => s.loading);
  const refreshError = useWhoisStore((s) => s.refreshError);
  const nick = useWhoisStore((s) => s.nick);
  const networkId = useWhoisStore((s) => s.networkId);
  const result = useWhoisStore((s) => s.result);

  const netState = useNetworksStore((s) => (networkId != null ? s.states[networkId] : undefined));
  const networkName = useNetworksStore((s) =>
    networkId != null ? s.networks.find((n) => n.id === networkId)?.name : undefined,
  );
  const isOper = isNetworkOper(netState);
  const relayBotsByKey = useRelayBotsStore((s) => s.byKey);
  const buffers = useBuffersStore((s) => s.buffers);
  const globalIgnores = useIgnoresStore((s) => s.global);
  const netIgnores = useIgnoresStore((s) =>
    networkId != null ? s.byNetwork[networkId] || EMPTY_IGNORES : EMPTY_IGNORES,
  );
  const dccEnabled = useConfigStore((s) => s.features.dcc);
  const configChecked = useConfigStore((s) => s.checked);
  const linkPreviewsEnabled = useConfigStore((s) => s.features.linkPreviews);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolvedNick = result?.nick || nick;
  const user = result?.user || result?.ident;
  const host = result?.host || result?.hostname;
  const realname = result?.realname || result?.real_name;
  const serverInfo = result?.serverInfo || result?.server_info;

  const isSelf =
    networkId != null && useNetworksStore.getState().isOwnNick(networkId, resolvedNick);
  const isRelay =
    networkId != null &&
    Boolean(relayBotsByKey[`${networkId}::${resolvedNick.toLowerCase()}`]);

  const peer =
    networkId != null && resolvedNick
      ? useNetworksStore.getState().peerFor(networkId, resolvedNick)
      : null;
  const meta =
    networkId != null && resolvedNick
      ? useNetworksStore.getState().metadataFor(networkId, resolvedNick)
      : null;
  const knownAccount =
    networkId != null && resolvedNick
      ? useNetworksStore.getState().peerAccountFor(networkId, resolvedNick)
      : null;
  const prefixSpec =
    networkId != null
      ? useNetworksStore.getState().prefixFor(networkId)
      : useNetworksStore.getState().prefixFor(null);
  const dccLive =
    networkId != null &&
    useNetworksStore.getState().isDccChatLive(networkId, resolvedNick);
  const dccSecure =
    networkId != null &&
    useNetworksStore.getState().isDccChatSecure(networkId, resolvedNick);

  const avatarHref = useMemo(() => {
    const raw = meta?.avatarUrl?.trim();
    if (!raw) return null;
    const resolved = resolveExternalHref(raw);
    return /^https?:\/\//i.test(resolved) ? resolved : null;
  }, [meta?.avatarUrl]);

  useEffect(() => {
    setAvatarFailed(false);
  }, [networkId, resolvedNick, avatarHref]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = (id: string, value: string) => {
    try {
      void navigator.clipboard?.writeText?.(value);
    } catch {
      // Ignore clipboard permission denials in restricted contexts
    }
    setCopiedId(id);
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedId(null), 1800);
  };

  const fullHostmask =
    user || host ? `${resolvedNick}!${user || '*'}@${host || '*'}` : null;
  const userAtHost = user || host ? `${user || '?'}@${host || '?'}` : null;

  const ignoreState = useMemo(() => {
    if (networkId == null || !resolvedNick || isSelf) {
      return { ignored: false, removable: null };
    }
    const verdict = useIgnoresStore.getState().evaluate(networkId, {
      nick: resolvedNick,
      userhost: fullHostmask,
      target: resolvedNick,
      type: 'message',
      isDm: true,
      text: '',
    });
    const removable = findDirectIgnoreRule(globalIgnores, netIgnores, networkId, resolvedNick);
    return { ignored: verdict.hide, removable };
  }, [networkId, resolvedNick, isSelf, fullHostmask, globalIgnores, netIgnores]);

  const joinedChannels = useMemo(() => {
    const set = new Set<string>();
    if (networkId == null) return set;
    for (const buf of Object.values(buffers)) {
      if (buf.networkId === networkId && buf.joined && buf.target) {
        set.add(buf.target.toLowerCase());
      }
    }
    return set;
  }, [buffers, networkId]);

  const resolvedAccount = result?.account || result?.registered_nick || knownAccount || null;
  const idleFormatted = formatDuration(result?.idle);
  const signonInfo = formatSignonTime(result?.signon ?? result?.logon);
  const channels = normalizeWhoisChannels(result?.channels);
  const actualHostIp = [result?.actual_hostname, result?.actual_ip]
    .filter(Boolean)
    .join(' / ');
  const actualUsername =
    typeof result?.actual_username === 'string' && result.actual_username.trim()
      ? result.actual_username.trim()
      : null;
  const asn = result?.asn != null && String(result.asn).trim() ? String(result.asn).trim() : null;
  const specialLines = Array.isArray(result?.special)
    ? result.special.map((s) => String(s).trim()).filter(Boolean)
    : typeof result?.special === 'string' && result.special.trim()
      ? [result.special.trim()]
      : [];

  const presence = presenceInfo(peer, result);
  const userTint = resolveThemedNickColor(resolvedNick, isSelf) || 'var(--accent)';
  const homepageHref = useMemo(() => {
    const raw = meta?.homepage?.trim();
    if (!raw) return null;
    const resolved = resolveExternalHref(raw);
    return /^https?:\/\//i.test(resolved) ? resolved : null;
  }, [meta?.homepage]);

  const isNotFound =
    result?.error === 'not_found' || result?.error === 'no_such_nick';
  const showFooter =
    networkId != null &&
    Boolean(resolvedNick) &&
    result?.error !== 'Invalid nickname' &&
    (!loading || Boolean(result));

  const handleToggleIgnore = () => {
    if (networkId == null || !resolvedNick || isSelf) return;
    const store = useIgnoresStore.getState();
    if (ignoreState.removable) {
      store.remove(ignoreState.removable.networkId, ignoreState.removable.entry.id);
    } else if (!ignoreState.ignored) {
      store.add({ networkId, mask: `${resolvedNick}!*@*`, levels: ['ALL'] });
    }
  };

  const titleNode = (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className="truncate">WHOIS: {resolvedNick || nick}</span>
      {networkName && (
        <span
          className="rounded px-2 py-0.5 text-[11px] font-medium shrink-0"
          style={{
            background: 'var(--bg)',
            color: 'var(--fg-muted)',
            border: `1px solid ${SUBTLE_BORDER}`,
          }}
        >
          {networkName}
        </span>
      )}
      {loading && result && (
        <span className="inline-flex items-center gap-1 text-[11px] font-normal text-[var(--fg-muted)] shrink-0">
          <Loader2 className="w-3 h-3 animate-spin" />
          Refreshing
        </span>
      )}
    </div>
  );

  const footerNode = showFooter ? (
    <div className="flex flex-wrap items-center justify-between gap-2 w-full">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => useWhoisStore.getState().request(networkId, resolvedNick)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
          style={BUTTON_STYLE}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>

        {!isSelf && (
          <>
            <button
              type="button"
              onClick={() =>
                useRelayBotsStore.getState().setRelay(networkId, resolvedNick, !isRelay)
              }
              title={
                isRelay
                  ? 'Unmark relay bot'
                  : 'Mark as relay bot (parse relayed `<nick> message` lines)'
              }
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium hover:opacity-90"
              style={
                isRelay
                  ? TONE_STYLES.accent
                  : BUTTON_STYLE
              }
            >
              <Radio className="w-3.5 h-3.5" />
              <span>{isRelay ? 'Relay Bot' : 'Mark Relay'}</span>
            </button>

            <button
              type="button"
              onClick={handleToggleIgnore}
              disabled={ignoreState.ignored && !ignoreState.removable}
              title={
                ignoreState.ignored && !ignoreState.removable
                  ? 'Ignored by a broader pattern or channel rule (manage in Ignore Rules)'
                  : ignoreState.ignored
                    ? 'Remove ignore rule for this nick'
                    : `Ignore ${resolvedNick}!*@*`
              }
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
              style={ignoreState.ignored ? TONE_STYLES.bad : BUTTON_STYLE}
            >
              <ShieldOff className="w-3.5 h-3.5" />
              <span>{ignoreState.ignored ? 'Unignore' : 'Ignore'}</span>
            </button>

            {dccEnabled && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    useWhoisStore.getState().close();
                    void useDccStore.getState().openChat({ networkId, nick: resolvedNick });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium hover:opacity-90"
                  style={BUTTON_STYLE}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>DCC Chat</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useWhoisStore.getState().close();
                    useDccStore
                      .getState()
                      .openModal('files', { networkId, nick: resolvedNick, passive: false });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium hover:opacity-90"
                  style={BUTTON_STYLE}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>DCC Send…</span>
                </button>
              </>
            )}
          </>
        )}
      </div>

      {!isSelf && (
        <button
          type="button"
          onClick={() => {
            useBuffersStore.getState().openDm(networkId, resolvedNick);
            useWhoisStore.getState().close();
          }}
          className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold hover:opacity-90"
          style={{ background: 'var(--accent)', color: 'var(--bg)' }}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Message</span>
        </button>
      )}
    </div>
  ) : undefined;

  const hasIdentityDetails = Boolean(
    realname ||
      meta?.displayName ||
      meta?.pronouns ||
      meta?.status ||
      meta?.homepage ||
      resolvedAccount ||
      result?.registered_nick,
  );
  const hasConnectionDetails = Boolean(
    fullHostmask ||
      actualHostIp ||
      actualUsername ||
      asn ||
      result?.server ||
      result?.modes ||
      idleFormatted ||
      signonInfo ||
      result?.certfp ||
      specialLines.length > 0,
  );

  return (
    <AppModal
      open={open}
      onClose={() => useWhoisStore.getState().close()}
      title={titleNode}
      maxWidth="max-w-2xl"
      footer={footerNode}
    >
      {loading && !result && (
        <div className="flex flex-col items-center justify-center gap-2.5 py-10 text-sm text-[var(--fg-muted)]">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
          <span>Querying WHOIS...</span>
        </div>
      )}

      {!loading && result?.error && (
        <div className="space-y-4">
          <div
            className="rounded-lg p-4 space-y-2.5 text-sm"
            style={{
              background: 'color-mix(in srgb, var(--bad) 10%, var(--bg))',
              border: '1px solid color-mix(in srgb, var(--bad) 35%, transparent)',
            }}
          >
            <p className="m-0 font-medium text-[var(--bad)]">
              {isNotFound ? `${result.nick || nick} is not online` : result.error}
            </p>
            {networkId != null && result.error !== 'Invalid nickname' && (
              <p className="m-0 text-xs text-[var(--fg-muted)]">
                Try WHOWAS in the chat input to inspect recent signoff history, or refresh if they
                reconnected.
              </p>
            )}
          </div>

          {networkId != null && resolvedNick && result.error !== 'Invalid nickname' && (
            <NoteSection networkId={networkId} nick={resolvedNick} />
          )}
        </div>
      )}

      {result && !result.error && (
        <div className="space-y-3.5">
          {refreshError && (
            <div
              className="rounded-lg px-3 py-2 text-xs text-[var(--warn)]"
              style={{
                background: 'color-mix(in srgb, var(--warn) 10%, var(--bg))',
                border: '1px solid color-mix(in srgb, var(--warn) 35%, transparent)',
              }}
            >
              {refreshError} — showing last received details.
            </div>
          )}

          {/* Hero Identity Card */}
          <div className="rounded-lg p-4 flex items-start gap-4" style={CARD_STYLE}>
            <div className="relative shrink-0">
              {avatarHref && !avatarFailed ? (
                <img
                  src={avatarHref}
                  alt={resolvedNick}
                  onError={() => setAvatarFailed(true)}
                  className="w-13 h-13 rounded-full object-cover"
                  style={{ border: `1px solid ${SUBTLE_BORDER}` }}
                />
              ) : (
                <div
                  className="w-13 h-13 rounded-full flex items-center justify-center font-bold text-base select-none"
                  style={{
                    background: `color-mix(in srgb, ${userTint} 18%, var(--bg-soft))`,
                    border: `1px solid color-mix(in srgb, ${userTint} 45%, transparent)`,
                    color: userTint,
                  }}
                >
                  {resolvedNick ? resolvedNick[0].toUpperCase() : <User className="w-5 h-5" />}
                </div>
              )}
              <span
                title={presence.awayText ? `${presence.label}: ${presence.awayText}` : presence.label}
                className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full"
                style={{
                  background: presence.color,
                  border: '2px solid var(--bg)',
                }}
              />
            </div>

            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span
                    className="font-bold text-[16px] break-all"
                    style={{ color: userTint }}
                  >
                    {resolvedNick}
                  </span>
                  {meta?.displayName && meta.displayName !== resolvedNick && (
                    <span className="text-[13px] font-medium text-[var(--fg-muted)] break-words">
                      ({meta.displayName})
                    </span>
                  )}
                  {meta?.pronouns && (
                    <span
                      className="rounded px-1.5 py-0.5 text-[11px] text-[var(--fg-muted)]"
                      style={{
                        background: 'var(--bg-soft)',
                        border: `1px solid ${SUBTLE_BORDER}`,
                      }}
                    >
                      {meta.pronouns}
                    </span>
                  )}
                  <StatusBadge tone={presence.state === 'away' ? 'warn' : presence.state === 'online' ? 'good' : 'neutral'}>
                    {presence.label}
                  </StatusBadge>
                </div>
                {isSelf && configChecked && !linkPreviewsEnabled && (
                  <p
                    data-testid="whois-avatars-need-previews"
                    className="text-[11px] text-[var(--fg-muted)]"
                  >
                    To display avatars, you need <code>lurker-previews</code>.
                  </p>
                )}
              </div>

              {userAtHost && (
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-[12.5px] font-mono text-[var(--fg-muted)] break-all select-all">
                    {userAtHost}
                  </code>
                  <CopyButton
                    value={userAtHost}
                    label="Copy user@host"
                    copied={copiedId === 'userhost'}
                    onCopy={(v) => handleCopy('userhost', v)}
                  />
                </div>
              )}

              {presence.awayText && (
                <div
                  className="rounded-md px-2.5 py-1.5 text-xs break-words"
                  style={{
                    background: 'color-mix(in srgb, var(--warn) 10%, var(--bg-soft))',
                    border: '1px solid color-mix(in srgb, var(--warn) 35%, transparent)',
                    color: 'var(--warn)',
                  }}
                >
                  Away: {presence.awayText}
                </div>
              )}

              {(result.secure ||
                result.operator ||
                result.helpop ||
                result.bot ||
                result.registered_nick ||
                isRelay ||
                ignoreState.ignored ||
                dccLive ||
                isSelf) && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {result.secure && (
                    <StatusBadge tone="good" icon={<Shield className="w-3 h-3" />}>
                      Secure TLS
                    </StatusBadge>
                  )}
                  {result.operator && (
                    <StatusBadge tone="warn" icon={<ShieldBan className="w-3 h-3" />}>
                      {String(result.operator)}
                    </StatusBadge>
                  )}
                  {result.helpop && (
                    <StatusBadge tone="accent" icon={<Award className="w-3 h-3" />}>
                      {String(result.helpop)}
                    </StatusBadge>
                  )}
                  {result.bot && (
                    <StatusBadge tone="accent" icon={<Bot className="w-3 h-3" />}>
                      {String(result.bot)}
                    </StatusBadge>
                  )}
                  {result.registered_nick && (
                    <StatusBadge tone="good">Registered Nick</StatusBadge>
                  )}
                  {isRelay && (
                    <StatusBadge tone="accent" icon={<Radio className="w-3 h-3" />}>
                      Relay Bot
                    </StatusBadge>
                  )}
                  {ignoreState.ignored && (
                    <StatusBadge tone="bad" icon={<ShieldOff className="w-3 h-3" />}>
                      Ignored
                    </StatusBadge>
                  )}
                  {dccLive && (
                    <StatusBadge tone="good">
                      {dccSecure ? 'DCC Chat Live (Encrypted)' : 'DCC Chat Live'}
                    </StatusBadge>
                  )}
                  {isSelf && <StatusBadge tone="neutral">You</StatusBadge>}
                </div>
              )}
            </div>
          </div>

          {hasIdentityDetails && (
            <SectionCard title="Identity & Account">
              <dl className="space-y-2 m-0">
                {meta?.displayName && (
                  <DetailRow label="Display Name">{meta.displayName}</DetailRow>
                )}
                {realname && (
                  <DetailRow label="Realname">
                    <LinkedText text={realname} networkId={networkId} />
                  </DetailRow>
                )}
                {meta?.pronouns && <DetailRow label="Pronouns">{meta.pronouns}</DetailRow>}
                {meta?.status && <DetailRow label="Status">{meta.status}</DetailRow>}
                {meta?.homepage && (
                  <DetailRow label="Homepage">
                    {homepageHref ? (
                      <a
                        href={homepageHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
                            return;
                          }
                          e.preventDefault();
                          openExternalUrl(homepageHref);
                        }}
                        className="inline-flex items-center gap-1 underline break-all"
                        style={{ color: 'var(--link, var(--accent))' }}
                      >
                        <span>{meta.homepage}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    ) : (
                      meta.homepage
                    )}
                  </DetailRow>
                )}
                {resolvedAccount && (
                  <DetailRow label="Account">
                    <span>{resolvedAccount}</span>
                    {!result.account && !result.registered_nick && knownAccount && (
                      <span className="ml-1.5 text-[11px] text-[var(--fg-muted)]">(detected)</span>
                    )}
                  </DetailRow>
                )}
                {result.registered_nick && result.registered_nick !== resolvedAccount && (
                  <DetailRow label="Registered Nick">{String(result.registered_nick)}</DetailRow>
                )}
              </dl>
            </SectionCard>
          )}

          {hasConnectionDetails && (
            <SectionCard title="Connection & Session">
              <dl className="space-y-2 m-0">
                {fullHostmask && (
                  <DetailRow label="Hostmask" mono>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="select-all">{fullHostmask}</span>
                      <CopyButton
                        value={fullHostmask}
                        label="Copy hostmask"
                        copied={copiedId === 'hostmask'}
                        onCopy={(v) => handleCopy('hostmask', v)}
                      />
                    </div>
                  </DetailRow>
                )}
                {(actualHostIp || actualUsername) && (
                  <DetailRow label="Connected From" mono>
                    <span>
                      {actualUsername && actualHostIp
                        ? `${actualUsername} @ ${actualHostIp}`
                        : actualHostIp || actualUsername}
                    </span>
                  </DetailRow>
                )}
                {asn && <DetailRow label="ASN" mono>{asn}</DetailRow>}
                {result.server && (
                  <DetailRow label="Server">
                    {result.server}
                    {serverInfo ? ` (${serverInfo})` : ''}
                  </DetailRow>
                )}
                {result.modes && (
                  <DetailRow label="User Modes" mono>
                    {result.modes}
                  </DetailRow>
                )}
                {idleFormatted && <DetailRow label="Idle">{idleFormatted}</DetailRow>}
                {signonInfo && (
                  <DetailRow label="Signed On">
                    <span>{signonInfo.formatted}</span>
                    {signonInfo.relative && (
                      <span className="ml-1.5 text-[11px] text-[var(--fg-muted)]">
                        (up {signonInfo.relative})
                      </span>
                    )}
                  </DetailRow>
                )}
                {result.certfp && (
                  <DetailRow label="CertFP" mono>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="select-all">{result.certfp}</span>
                      <CopyButton
                        value={result.certfp}
                        label="Copy CertFP"
                        copied={copiedId === 'certfp'}
                        onCopy={(v) => handleCopy('certfp', v)}
                      />
                    </div>
                  </DetailRow>
                )}
                {specialLines.length > 0 && (
                  <DetailRow label="Server Notes">
                    <ul className="list-none p-0 m-0 space-y-0.5 text-[var(--fg-muted)]">
                      {specialLines.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </DetailRow>
                )}
              </dl>
            </SectionCard>
          )}

          {channels.length > 0 && (
            <SectionCard
              title={`Channels (${channels.length})`}
              right={
                <span className="text-[11px] text-[var(--fg-muted)]">
                  Click to open or join
                </span>
              }
            >
              <div className="flex flex-wrap gap-1.5">
                {channels.map((ch) => {
                  const { prefix, name } = splitChannelToken(ch, prefixSpec);
                  const isJoined = joinedChannels.has(name.toLowerCase());
                  const prefixColor = prefixColorFor(prefix, prefixSpec);
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => {
                        if (networkId == null) return;
                        useBuffersStore.getState().joinOrToast(networkId, name);
                        useWhoisStore.getState().close();
                      }}
                      title={isJoined ? `Switch to ${name}` : `Join ${name}`}
                      className="inline-flex items-center rounded-md px-2 py-1 text-xs font-mono hover:opacity-90 cursor-pointer"
                      style={{
                        background: isJoined
                          ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-soft))'
                          : 'var(--bg-soft)',
                        border: isJoined
                          ? '1px solid color-mix(in srgb, var(--accent) 40%, transparent)'
                          : `1px solid ${SUBTLE_BORDER}`,
                        color: 'var(--fg)',
                      }}
                    >
                      {prefix && (
                        <span className="font-bold" style={{ color: prefixColor || 'var(--accent)' }}>
                          {prefix}
                        </span>
                      )}
                      <span>{name}</span>
                    </button>
                  );
                })}
              </div>
            </SectionCard>
          )}

          {networkId != null && resolvedNick && (
            <NoteSection networkId={networkId} nick={resolvedNick} />
          )}

          {isOper && networkId != null && !isSelf && (
            <section
              className="rounded-lg p-3.5 space-y-2"
              style={{
                background: 'var(--bg)',
                border: '1px solid color-mix(in srgb, var(--warn) 30%, transparent)',
              }}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--warn)]">
                <ShieldBan className="w-3.5 h-3.5" /> Oper Actions
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(() => {
                  const targetNick = result.nick || nick;
                  const banTarget = result.actual_ip
                    ? `*!*@${result.actual_ip}`
                    : host
                      ? `*!*@${host}`
                      : `${targetNick}!*@*`;
                  const launchOper = (
                    prefill: Parameters<ReturnType<typeof useOperStore.getState>['openModal']>[0],
                  ) => {
                    useWhoisStore.getState().close();
                    useOperStore.getState().openModal({ networkId, ...prefill });
                  };
                  return (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          launchOper({ tab: 'users', userAction: 'KILL', targetNick })
                        }
                        className="rounded-md border border-red-500/40 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/15"
                      >
                        Kill…
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          launchOper({
                            tab: 'bans',
                            banType: 'GLINE',
                            banMask: banTarget,
                          })
                        }
                        className="rounded-md border border-red-500/40 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/15"
                      >
                        G-Line / Ban…
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          launchOper({
                            tab: 'bans',
                            banType: 'TEMPSHUN',
                            banMask: targetNick,
                          })
                        }
                        className="rounded-md px-2.5 py-1 text-xs hover:opacity-90"
                        style={BUTTON_STYLE}
                      >
                        Tempshun…
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          launchOper({ tab: 'users', userAction: 'CHGHOST', targetNick })
                        }
                        className="rounded-md px-2.5 py-1 text-xs hover:opacity-90"
                        style={BUTTON_STYLE}
                      >
                        ChgHost…
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          launchOper({ tab: 'users', userAction: 'SAJOIN', targetNick })
                        }
                        className="rounded-md px-2.5 py-1 text-xs hover:opacity-90"
                        style={BUTTON_STYLE}
                      >
                        SAJoin…
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          launchOper({ tab: 'users', userAction: 'SWHOIS', targetNick })
                        }
                        className="rounded-md px-2.5 py-1 text-xs hover:opacity-90"
                        style={BUTTON_STYLE}
                      >
                        SWHOIS…
                      </button>
                    </>
                  );
                })()}
              </div>
            </section>
          )}
        </div>
      )}
    </AppModal>
  );
};
