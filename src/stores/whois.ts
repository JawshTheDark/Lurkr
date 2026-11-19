// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { socketSend } from '../services/socketBus';
import { dccChatPeer } from '../shared/channels';

export interface WhoisResult {
  networkId: number;
  nick: string;
  user?: string;
  ident?: string;
  host?: string;
  hostname?: string;
  realname?: string;
  real_name?: string;
  actual_username?: string;
  actual_hostname?: string;
  actual_ip?: string;
  asn?: string | number;
  server?: string;
  serverInfo?: string;
  server_info?: string;
  channels?: string[] | string;
  modes?: string;
  account?: string;
  registered_nick?: string;
  away?: string;
  idle?: number | string;
  signon?: number;
  logon?: number;
  secure?: boolean;
  certfp?: string;
  operator?: string;
  helpop?: string;
  bot?: string;
  special?: string[] | string;
  error?: string;
  fetchedAt?: number;
  [key: string]: unknown;
}

export function normalizeWhoisChannels(channels: string[] | string | undefined): string[] {
  if (Array.isArray(channels)) {
    return channels.map((c) => String(c).trim()).filter(Boolean);
  }
  if (typeof channels === 'string') {
    return channels
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }
  return [];
}

interface WhoisState {
  open: boolean;
  loading: boolean;
  refreshError: string | null;
  networkId: number | null;
  nick: string;
  result: WhoisResult | null;
  cache: Record<string, WhoisResult>;
  request: (networkId: number, nick: string) => void;
  applyResult: (result: unknown) => void;
  close: () => void;
  reset: () => void;
}

const WHOIS_TIMEOUT_MS = 15_000;
let whoisTimer: ReturnType<typeof setTimeout> | null = null;

function cacheKey(networkId: number, nick: string): string {
  return `${networkId}::${nick.toLowerCase()}`;
}

function clearWhoisTimer(): void {
  if (whoisTimer !== null) {
    clearTimeout(whoisTimer);
    whoisTimer = null;
  }
}

export const useWhoisStore = create<WhoisState>((set, get) => ({
  open: false,
  loading: false,
  refreshError: null,
  networkId: null,
  nick: '',
  result: null,
  cache: {},
  request: (networkId, rawNick) => {
    clearWhoisTimer();
    const nick = dccChatPeer(rawNick).trim();
    if (!nick) {
      set({
        open: true,
        loading: false,
        refreshError: null,
        networkId,
        nick: rawNick,
        result: { networkId, nick: rawNick, error: 'Invalid nickname' },
      });
      return;
    }

    const cached = get().cache[cacheKey(networkId, nick)];
    set({
      open: true,
      loading: true,
      refreshError: null,
      networkId,
      nick,
      result: cached && !cached.error ? cached : null,
    });
    const sent = socketSend({ type: 'raw', networkId, line: `WHOIS ${nick}` });
    if (!sent) {
      if (cached && !cached.error) {
        set({ loading: false, refreshError: 'Not connected to Lurker server' });
      } else {
        set({
          loading: false,
          refreshError: null,
          result: { networkId, nick, error: 'Not connected to Lurker server' },
        });
      }
      return;
    }

    whoisTimer = setTimeout(() => {
      whoisTimer = null;
      const cur = get();
      if (
        !cur.open ||
        !cur.loading ||
        cur.networkId !== networkId ||
        cur.nick.toLowerCase() !== nick.toLowerCase()
      ) {
        return;
      }
      if (cur.result && !cur.result.error) {
        set({
          loading: false,
          refreshError: `WHOIS refresh timed out for ${nick}`,
        });
      } else {
        set({
          loading: false,
          refreshError: null,
          result: { networkId, nick, error: `WHOIS request timed out for ${nick}` },
        });
      }
    }, WHOIS_TIMEOUT_MS);
  },
  applyResult: (payload) => {
    const cur = get();
    if (!cur.open) return;
    if (!payload || typeof payload !== 'object') return;

    const outer = payload as Record<string, unknown>;
    const inner =
      outer.whois && typeof outer.whois === 'object'
        ? (outer.whois as Record<string, unknown>)
        : outer;

    const netRaw = outer.networkId ?? inner.networkId;
    const networkId = typeof netRaw === 'number' ? netRaw : Number(netRaw);
    if (!Number.isFinite(networkId) || cur.networkId !== networkId) return;

    const rawNick = typeof inner.nick === 'string' ? inner.nick : typeof outer.nick === 'string' ? outer.nick : '';
    const nick = rawNick.trim() || cur.nick;
    if (cur.nick.toLowerCase() !== nick.toLowerCase()) {
      return;
    }

    clearWhoisTimer();

    const user =
      typeof inner.user === 'string'
        ? inner.user
        : typeof inner.ident === 'string'
          ? inner.ident
          : undefined;
    const host =
      typeof inner.host === 'string'
        ? inner.host
        : typeof inner.hostname === 'string'
          ? inner.hostname
          : undefined;
    const realname =
      typeof inner.realname === 'string'
        ? inner.realname
        : typeof inner.real_name === 'string'
          ? inner.real_name
          : undefined;
    const serverInfo =
      typeof inner.serverInfo === 'string'
        ? inner.serverInfo
        : typeof inner.server_info === 'string'
          ? inner.server_info
          : undefined;
    const channels = normalizeWhoisChannels(inner.channels as string[] | string | undefined);
    const signon =
      typeof inner.signon === 'number'
        ? inner.signon
        : typeof inner.logon === 'number'
          ? inner.logon
          : undefined;
    const asn =
      typeof inner.asn === 'string' || typeof inner.asn === 'number'
        ? String(inner.asn).trim() || undefined
        : undefined;

    const normalized: WhoisResult = {
      ...(inner as Partial<WhoisResult>),
      networkId,
      nick,
      ...(user !== undefined ? { user } : {}),
      ...(host !== undefined ? { host } : {}),
      ...(realname !== undefined ? { realname } : {}),
      ...(serverInfo !== undefined ? { serverInfo } : {}),
      ...(signon !== undefined ? { signon } : {}),
      ...(asn !== undefined ? { asn } : {}),
      channels,
      fetchedAt: Date.now(),
    };

    const nextCache = { ...cur.cache };
    const key = cacheKey(networkId, nick);
    if (normalized.error) {
      delete nextCache[key];
    } else {
      nextCache[key] = normalized;
    }

    set({ loading: false, refreshError: null, result: normalized, cache: nextCache });
  },
  close: () => {
    clearWhoisTimer();
    set({ open: false, loading: false, refreshError: null, result: null });
  },
  reset: () => {
    clearWhoisTimer();
    set({ open: false, loading: false, refreshError: null, networkId: null, nick: '', result: null, cache: {} });
  },
}));
