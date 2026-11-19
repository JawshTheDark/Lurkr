// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { socketSend } from '../services/socketBus';
import { idFor } from './buffers';

interface NicklistCollapseState {
  byNetwork: Record<number | string, string[]>;
  isCollapsed: (networkId: number | string, target: string) => boolean;
  setNetwork: (networkId: number | string, list: string[]) => void;
  applySnapshot: (networks: any[]) => void;
  toggle: (networkId: number | string, target: string) => void;
  dropBuffer: (networkId: number | string | null, target: string) => void;
  rekeyBuffer: (networkId: number | string | null, from: string, to: string) => void;
  reset: () => void;
}

export const useNicklistCollapseStore = create<NicklistCollapseState>((set, get) => ({
  byNetwork: {},
  isCollapsed: (networkId, target) => (get().byNetwork[networkId] || []).includes(target),
  setNetwork: (networkId, list) =>
    set((s) => ({
      byNetwork: { ...s.byNetwork, [networkId]: Array.isArray(list) ? [...list] : [] },
    })),
  applySnapshot: (networks) => {
    const next: Record<number | string, string[]> = {};
    for (const n of networks || []) {
      if (n?.networkId != null) next[n.networkId] = [...(n.nicklistCollapsed || [])];
    }
    set({ byNetwork: next });
  },
  toggle: (networkId, target) => {
    const collapsed = !get().isCollapsed(networkId, target);
    socketSend({
      type: 'set-nicklist-collapsed',
      networkId,
      target,
      bufferId: idFor(networkId, target),
      collapsed,
    });
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
