// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { api } from '../api';

export interface BookmarkItem {
  id: number;
  messageId: number;
  networkId: number;
  target: string;
  nick: string;
  type: string;
  text: string;
  createdAt: string;
  bookmarkedAt: string;
  note?: string | null;
  [key: string]: unknown;
}

interface BookmarksState {
  bookmarkedIds: Record<number, boolean>;
  items: BookmarkItem[];
  loading: boolean;
  hasMore: boolean;
  loaded: boolean;
  isBookmarked: (messageId: number | string | null | undefined) => boolean;
  noteFromEvents: (
    events: Array<{ id?: number | string | null; bookmarked?: boolean }>,
    networkId: number | null | undefined,
  ) => void;
  applyRemote: (payload: { messageId: number; bookmarked: boolean }) => void;
  toggle: (messageId: number) => Promise<boolean>;
  fetchInitial: () => Promise<void>;
  fetchMore: () => Promise<void>;
  remove: (messageId: number) => Promise<void>;
  reset: () => void;
}

const PAGE_SIZE = 50;

export const useBookmarksStore = create<BookmarksState>((set, get) => ({
  bookmarkedIds: {},
  items: [],
  loading: false,
  hasMore: true,
  loaded: false,

  isBookmarked: (messageId) => (messageId != null ? !!get().bookmarkedIds[Number(messageId)] : false),

  noteFromEvents: (events, networkId) => {
    if (!Array.isArray(events) || networkId == null) return;
    set((s) => {
      const next = { ...s.bookmarkedIds };
      let changed = false;
      for (const e of events) {
        if (e?.id == null) continue;
        const id = Number(e.id);
        if (!Number.isFinite(id)) continue;
        if (e.bookmarked && !next[id]) {
          next[id] = true;
          changed = true;
        } else if (e.bookmarked === false && next[id]) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? { bookmarkedIds: next } : s;
    });
  },

  applyRemote: ({ messageId, bookmarked }) => {
    const id = Number(messageId);
    set((s) => {
      const next = { ...s.bookmarkedIds };
      if (bookmarked) next[id] = true;
      else delete next[id];
      return {
        bookmarkedIds: next,
        items: bookmarked ? s.items : s.items.filter((i) => Number(i.messageId ?? i.id) !== id),
      };
    });
  },

  toggle: async (messageId) => {
    const id = Number(messageId);
    const currently = !!get().bookmarkedIds[id];
    if (currently) {
      await api(`/api/bookmarks/${id}`, { method: 'DELETE' });
      get().applyRemote({ messageId: id, bookmarked: false });
      return false;
    }
    await api('/api/bookmarks', { method: 'POST', body: { messageId: id } });
    get().applyRemote({ messageId: id, bookmarked: true });
    return true;
  },

  fetchInitial: async () => {
    set({ loading: true });
    try {
      const { items } = await api(`/api/bookmarks?limit=${PAGE_SIZE}`);
      const list = (items || []) as BookmarkItem[];
      const ids = { ...get().bookmarkedIds };
      for (const it of list) ids[Number(it.messageId ?? it.id)] = true;
      set({ items: list, bookmarkedIds: ids, hasMore: list.length === PAGE_SIZE, loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  fetchMore: async () => {
    const s = get();
    if (s.loading || !s.hasMore || !s.items.length) return;
    set({ loading: true });
    try {
      const before = s.items[s.items.length - 1].id;
      const { items } = await api(`/api/bookmarks?limit=${PAGE_SIZE}&before=${before}`);
      const list = (items || []) as BookmarkItem[];
      set((cur) => ({
        items: [...cur.items, ...list],
        hasMore: list.length === PAGE_SIZE,
      }));
    } finally {
      set({ loading: false });
    }
  },

  remove: async (messageId) => {
    await api(`/api/bookmarks/${messageId}`, { method: 'DELETE' });
    get().applyRemote({ messageId, bookmarked: false });
  },

  reset: () => set({ bookmarkedIds: {}, items: [], loading: false, hasMore: true, loaded: false }),
}));
