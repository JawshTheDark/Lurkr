// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { socketSend } from '../services/socketBus';
import { idFor } from './buffers';

interface PinsState {
  byNetwork: Record<number | string, string[]>;
  forNetwork: (networkId: number | string) => string[];
  isPinned: (networkId: number | string, target: string) => boolean;
  setNetwork: (networkId: number | string, pinned: string[]) => void;
  applySnapshot: (networks: any[]) => void;
  pin: (networkId: number | string, target: string) => void;
  unpin: (networkId: number | string, target: string) => void;
  reorder: (networkId: number | string, targets: string[]) => void;
  dropBuffer: (networkId: number | string | null, target: string) => void;
  rekeyBuffer: (networkId: number | string | null, from: string, to: string) => void;
  reset: () => void;
}

export const usePinsStore = create<PinsState>((set, get) => ({
  byNetwork: {},
  forNetwork: (networkId) => get().byNetwork[networkId] || [],
  isPinned: (networkId, target) => (get().byNetwork[networkId] || []).includes(target),
  setNetwork: (networkId, pinned) =>
    set((s) => ({
      byNetwork: { ...s.byNetwork, [networkId]: Array.isArray(pinned) ? [...pinned] : [] },
    })),
  applySnapshot: (networks) => {
    const next: Record<number | string, string[]> = {};
    for (const n of networks || []) {
      if (n?.networkId != null) next[n.networkId] = [...(n.pinned || [])];
    }
    set({ byNetwork: next });
  },
  pin: (networkId, target) => {
    socketSend({ type: 'pin-buffer', networkId, target, bufferId: idFor(networkId, target) });
  },
  unpin: (networkId, target) => {
    socketSend({ type: 'unpin-buffer', networkId, target, bufferId: idFor(networkId, target) });
  },
  reorder: (networkId, targets) => {
    socketSend({ type: 'reorder-pins', networkId, targets });
  },
  dropBuffer: (networkId, target) => {
    if (networkId == null) return;
    set((s) => {
      const list = s.byNetwork[networkId];
      if (!list?.includes(target)) return s;
      return { byNetwork: { ...s.byNetwork, [networkId]: list.filter((t) => t !== target) } };
    });
  },
  rekeyBuffer: (networkId, from, to) => {
    if (networkId == null) return;
    set((s) => {
      const list = s.byNetwork[networkId];
      if (!list?.includes(from)) return s;
      const updated = list.includes(to)
        ? list.filter((t) => t !== from)
        : list.map((t) => (t === from ? to : t));
      return { byNetwork: { ...s.byNetwork, [networkId]: updated } };
    });
  },
  reset: () => set({ byNetwork: {} }),
}));
