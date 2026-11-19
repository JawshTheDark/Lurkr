// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { api } from '../api';
import { useNetworksStore } from './networks';
import { parseSearchQuery } from '../utils/searchQuery';

export interface SearchHit {
  id: number;
  networkId: number;
  target: string;
  nick: string;
  type?: string;
  text: string;
  time?: string;
  createdAt?: string;
  networkName?: string;
  userhost?: string | null;
  self?: boolean;
  replyTo?: any;
  redaction?: any;
  snippet?: string;
}

interface SearchState {
  open: boolean;
  query: string;
  networkId: number | null;
  target: string | null;
  results: SearchHit[];
  nextBefore: number | null;
  loading: boolean;
  hasMore: boolean;
  error: string;
  token: number;
  searched: boolean;
  lastUrl: string | null;
  openSearch: (opts?: { networkId?: number | null; target?: string | null; query?: string }) => void;
  closeSearch: () => void;
  search: (opts: {
    query: string;
    networkId?: number | null;
    target?: string | null;
  }) => Promise<void>;
  loadMore: () => Promise<void>;
  reset: () => void;
}

const PAGE_SIZE = 50;
let inflight: AbortController | null = null;

function buildSearchUrl(opts: {
  query: string;
  networkId: number | null;
  target: string | null;
  before: number | null;
}): string | null {
  const parsed = parseSearchQuery(opts.query);
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_SIZE));
  if (parsed.query) params.set('q', parsed.query);
  for (const nick of parsed.from) params.append('nick', nick);
  const target = opts.target || parsed.in || null;
  if (target) params.set('target', target);
  let networkId = opts.networkId;
  if (networkId == null && parsed.on) {
    const match = useNetworksStore
      .getState()
      .networks.find((n) => n.name.toLowerCase() === parsed.on.toLowerCase());
    if (match) networkId = match.id;
  }
  if (networkId != null) params.set('networkId', String(networkId));
  if (!parsed.query && !parsed.from.length && !target && networkId == null) {
    return null;
  }
  if (opts.before != null) params.set('before', String(opts.before));
  return `/api/search?${params.toString()}`;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  open: false,
  query: '',
  networkId: null,
  target: null,
  results: [],
  nextBefore: null,
  loading: false,
  hasMore: false,
  error: '',
  token: 0,
  searched: false,
  lastUrl: null,

  openSearch: ({ networkId = null, target = null, query } = {}) =>
    set((s) => ({
      open: true,
      networkId,
      target,
      ...(query !== undefined ? { query } : {}),
      results: query !== undefined ? [] : s.results,
    })),

  closeSearch: () => set({ open: false }),

  search: async ({ query, networkId = null, target = null }) => {
    const url = buildSearchUrl({ query, networkId, target, before: null });
    const prev = get();
    if (url !== null && prev.searched && !prev.error && url === prev.lastUrl) return;
    const token = prev.token + 1;
    inflight?.abort();
    if (!url) {
      set({
        query,
        networkId,
        target,
        token,
        lastUrl: null,
        results: [],
        nextBefore: null,
        hasMore: false,
        loading: false,
        searched: false,
        error: '',
      });
      return;
    }
    const controller = new AbortController();
    inflight = controller;
    set({
      query,
      networkId,
      target,
      token,
      lastUrl: url,
      results: [],
      nextBefore: null,
      hasMore: false,
      error: '',
      loading: true,
      searched: true,
    });
    try {
      const data = await api<{
        items?: SearchHit[];
        results?: SearchHit[];
        nextBefore?: number | null;
      }>(url, { signal: controller.signal });
      if (get().token !== token) return;
      const list = (data.items || data.results || []) as SearchHit[];
      const nextBefore =
        data.nextBefore !== undefined
          ? data.nextBefore
          : list.length === PAGE_SIZE
            ? list[list.length - 1]?.id ?? null
            : null;
      set({
        results: list,
        nextBefore,
        hasMore: nextBefore != null,
      });
    } catch (err: any) {
      if (get().token !== token || controller.signal.aborted) return;
      set({ error: err?.message || 'search failed', results: [], nextBefore: null, hasMore: false });
    } finally {
      if (get().token === token) set({ loading: false });
    }
  },

  loadMore: async () => {
    const s = get();
    if (s.loading || s.nextBefore == null) return;
    const url = buildSearchUrl({
      query: s.query,
      networkId: s.networkId,
      target: s.target,
      before: s.nextBefore,
    });
    if (!url) return;
    const token = s.token;
    set({ loading: true, error: '' });
    try {
      const data = await api<{
        items?: SearchHit[];
        results?: SearchHit[];
        nextBefore?: number | null;
      }>(url);
      if (get().token !== token) return;
      const list = (data.items || data.results || []) as SearchHit[];
      const nextBefore =
        data.nextBefore !== undefined
          ? data.nextBefore
          : list.length === PAGE_SIZE
            ? list[list.length - 1]?.id ?? null
            : null;
      set((cur) => {
        const seen = new Set(cur.results.map((r) => r.id));
        const merged = [...cur.results];
        for (const r of list) {
          if (!seen.has(r.id)) merged.push(r);
        }
        return {
          results: merged,
          nextBefore,
          hasMore: nextBefore != null,
        };
      });
    } catch (err: any) {
      if (get().token !== token) return;
      set({ error: err?.message || 'search failed' });
    } finally {
      if (get().token === token) set({ loading: false });
    }
  },

  reset: () => {
    inflight?.abort();
    inflight = null;
    set({
      open: false,
      query: '',
      networkId: null,
      target: null,
      results: [],
      nextBefore: null,
      loading: false,
      hasMore: false,
      error: '',
      searched: false,
      lastUrl: null,
    });
  },
}));
