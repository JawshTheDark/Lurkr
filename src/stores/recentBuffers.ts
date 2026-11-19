// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { api } from '../api';
import { recordRecent, type RecentBuffers } from '../utils/recentBuffers';

interface RecentBuffersState {
  keys: string[];
  record: (key: string) => void;
  rank: (key: string) => number;
  reset: () => void;
}

export const useRecentBuffersStore = create<RecentBuffersState>((set, get) => ({
  keys: [],
  record: (key) =>
    set((s) => {
      const r: RecentBuffers = { keys: [...s.keys] };
      if (!recordRecent(r, key)) return s;
      return { keys: r.keys };
    }),
  rank: (key) => {
    const idx = get().keys.indexOf(key);
    return idx === -1 ? Infinity : idx;
  },
  reset: () => set({ keys: [] }),
}));

export interface NetworkPreset {
  id: string;
  name: string;
  host: string;
  port: number;
  tls: boolean;
  [key: string]: unknown;
}

interface NetworkPresetsState {
  presets: NetworkPreset[];
  loaded: boolean;
  fetchAll: () => Promise<void>;
  reset: () => void;
}

export const useNetworkPresetsStore = create<NetworkPresetsState>((set, get) => ({
  presets: [],
  loaded: false,
  fetchAll: async () => {
    if (get().loaded) return;
    try {
      const { presets } = await api('/api/network-presets');
      set({ presets: presets || [], loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  reset: () => set({ presets: [], loaded: false }),
}));
