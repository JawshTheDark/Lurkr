// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { socketSend } from '../services/socketBus';
import { idFor, useBuffersStore } from './buffers';
import { isChannelTarget } from '../shared/channels';

export interface FavoriteEntry {
  networkId: number;
  target: string;
  bufferId: number;
}

interface FavoritesState {
  entries: FavoriteEntry[];
  isFavorite: (networkId: number | string, target: string) => boolean;
  favoriteKeys: () => Set<string>;
  sections: () => { friends: FavoriteEntry[]; channels: FavoriteEntry[] };
  orderInjection: () => {
    friends: FavoriteEntry[];
    channels: FavoriteEntry[];
    excludeKeys: Set<string>;
  };
  apply: (entries: FavoriteEntry[]) => void;
  favorite: (networkId: number | string, target: string) => void;
  unfavorite: (networkId: number | string, target: string) => void;
  reorder: (entriesOrIds: number[] | FavoriteEntry[]) => void;
  dropBuffer: (networkId: number | string | null, target: string) => void;
  rekeyBuffer: (networkId: number | string | null, from: string, to: string) => void;
  reset: () => void;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  entries: [],
  isFavorite: (networkId, target) => {
    const folded = target.toLowerCase();
    return get().entries.some(
      (e) => Number(e.networkId) === Number(networkId) && e.target.toLowerCase() === folded,
    );
  },
  favoriteKeys: () =>
    new Set(get().entries.map((e) => `${Number(e.networkId)}::${e.target.toLowerCase()}`)),
  sections: () => {
    const buffers = Object.values(useBuffersStore.getState().buffers);
    const friends: FavoriteEntry[] = [];
    const channels: FavoriteEntry[] = [];
    for (const e of get().entries) {
      const folded = e.target.toLowerCase();
      const nid = Number(e.networkId);
      const buf = buffers.find(
        (b) => b.networkId === nid && b.target.toLowerCase() === folded,
      );
      if (!buf) continue;
      if (buf.kind === 'server' || buf.kind === 'system') continue;
      const resolved = buf.target === e.target && e.networkId === nid ? e : { ...e, networkId: nid, target: buf.target };
      if (isChannelTarget(buf.target)) channels.push(resolved);
      else friends.push(resolved);
    }
    return { friends, channels };
  },
  orderInjection: () => {
    const secs = get().sections();
    return { friends: secs.friends, channels: secs.channels, excludeKeys: get().favoriteKeys() };
  },
  apply: (entries) => set({ entries: Array.isArray(entries) ? [...entries] : [] }),
  favorite: (networkId, target) => {
    socketSend({
      type: 'favorite-buffer',
      networkId,
      target,
      bufferId: idFor(networkId, target),
    });
  },
  unfavorite: (networkId, target) => {
    socketSend({
      type: 'unfavorite-buffer',
      networkId,
      target,
      bufferId: idFor(networkId, target),
    });
  },
  reorder: (entriesOrIds) => {
    const bufferIds = (entriesOrIds || [])
      .map((item) => (typeof item === 'number' ? item : item?.bufferId))
      .filter((id): id is number => typeof id === 'number' && Number.isFinite(id));
    socketSend({ type: 'reorder-favorites', bufferIds });
  },
  dropBuffer: (networkId, target) => {
    if (networkId == null) return;
    const nid = Number(networkId);
    const folded = target.toLowerCase();
    set((s) => ({
      entries: s.entries.filter(
        (e) => !(Number(e.networkId) === nid && e.target.toLowerCase() === folded),
      ),
    }));
  },
  rekeyBuffer: (networkId, from, to) => {
    if (networkId == null) return;
    const nid = Number(networkId);
    const folded = from.toLowerCase();
    const toExists = get().isFavorite(nid, to);
    set((s) => ({
      entries: toExists
        ? s.entries.filter(
            (e) => !(Number(e.networkId) === nid && e.target.toLowerCase() === folded),
          )
        : s.entries.map((e) =>
            Number(e.networkId) === nid && e.target.toLowerCase() === folded
              ? { ...e, networkId: nid, target: to }
              : e,
          ),
    }));
  },
  reset: () => set({ entries: [] }),
}));
