// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { api } from '../api';

export interface HighlightItem {
  id: number;
  kind?: 'highlight' | 'dm' | 'reaction' | 'always_notify';
  networkId: number;
  target: string;
  nick: string;
  type: string;
  text: string;
  createdAt: string;
  time?: string;
  reactionValue?: string;
  reactor?: string;
  [key: string]: unknown;
}

const PAGE_SIZE = 50;

interface HighlightsState {
  items: HighlightItem[];
  loading: boolean;
  hasMore: boolean;
  loaded: boolean;
  unread: number;
  fetchInitial: () => Promise<void>;
  fetchMore: () => Promise<void>;
  prepend: (item: HighlightItem) => void;
  markSeen: () => void;
  removeById: (id: number) => void;
  reset: () => void;
}

export const useHighlightsStore = create<HighlightsState>((set, get) => ({
  items: [],
  loading: false,
  hasMore: true,
  loaded: false,
  unread: 0,

  fetchInitial: async () => {
    set({ loading: true });
    try {
      const { items } = await api(`/api/highlights?limit=${PAGE_SIZE}`);
      const list = (items || []) as HighlightItem[];
      set({ items: list, hasMore: list.length === PAGE_SIZE, loaded: true });
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
      const { items } = await api(`/api/highlights?limit=${PAGE_SIZE}&before=${before}`);
      const list = (items || []) as HighlightItem[];
      set((cur) => ({
        items: [...cur.items, ...list],
        hasMore: list.length === PAGE_SIZE,
      }));
    } finally {
      set({ loading: false });
    }
  },

  prepend: (item) =>
    set((s) => {
      if (s.items.some((x) => x.id === item.id && x.kind === item.kind)) return s;
      return { items: [item, ...s.items], unread: s.unread + 1 };
    }),

  markSeen: () => set({ unread: 0 }),

  removeById: (id) =>
    set((s) => ({
      items: s.items.filter((it) => Number(it.id) !== id),
    })),

  reset: () => set({ items: [], loading: false, hasMore: true, loaded: false, unread: 0 }),
}));
