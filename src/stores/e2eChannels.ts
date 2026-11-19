// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { useBuffersStore } from './buffers';

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

interface E2eChannelsState {
  byNetwork: Record<number | string, string[]>;
  isEnabled: (networkId: number | string | null, target: string) => boolean;
  applySnapshot: (networks: any[]) => void;
  applyChange: (networkId: number | string, channels: unknown) => void;
  reset: () => void;
}

export const useE2eChannelsStore = create<E2eChannelsState>((set, get) => ({
  byNetwork: {},

  isEnabled: (networkId, target) => {
    if (networkId == null) return false;
    const names = get().byNetwork[networkId];
    if (!names?.length) return false;
    if (names.includes(target)) return true;
    const folded = target.toLowerCase();
    const buffers = useBuffersStore.getState().buffers;
    return names.some((name) => {
      if (name.toLowerCase() === folded) return true;
      const b = Object.values(buffers).find(
        (buf) => buf.networkId === Number(networkId) && buf.target.toLowerCase() === name.toLowerCase(),
      );
      return b?.target === target;
    });
  },

  applySnapshot: (networks) => {
    const next: Record<number | string, string[]> = {};
    for (const n of networks || []) {
      if (n?.networkId != null) next[n.networkId] = stringList(n.e2eChannels);
    }
    set({ byNetwork: next });
  },

  applyChange: (networkId, channels) => {
    set((s) => ({
      byNetwork: { ...s.byNetwork, [networkId]: stringList(channels) },
    }));
  },

  reset: () => set({ byNetwork: {} }),
}));
