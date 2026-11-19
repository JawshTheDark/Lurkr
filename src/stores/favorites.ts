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
  reorder: (entries: FavoriteEntry[]) => void;
  reset: () => void;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  entries: [],
  isFavorite: (networkId, target) => {
    const folded = target.toLowerCase();
    return get().entries.some(
      (e) => e.networkId === Number(networkId) && e.target.toLowerCase() === folded,
    );
  },
  favoriteKeys: () =>
    new Set(get().entries.map((e) => `${e.networkId}::${e.target.toLowerCase()}`)),
  sections: () => {
    const buffers = Object.values(useBuffersStore.getState().buffers);
    const friends: FavoriteEntry[] = [];
    const channels: FavoriteEntry[] = [];
    for (const e of get().entries) {
      const folded = e.target.toLowerCase();
      const buf = buffers.find(
        (b) => b.networkId === e.networkId && b.target.toLowerCase() === folded,
      );
      if (!buf) continue;
      if (buf.kind === 'server' || buf.kind === 'system') continue;
      const resolved = buf.target === e.target ? e : { ...e, target: buf.target };
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
  reorder: (entries) => {
    socketSend({ type: 'reorder-favorites', entries });
  },
  reset: () => set({ entries: [] }),
}));
