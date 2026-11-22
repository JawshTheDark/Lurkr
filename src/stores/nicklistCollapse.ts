// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { socketSend } from '../services/socketBus';
import { idFor } from './buffers';

interface NicklistCollapseState {
  byNetwork: Record<number | string, string[]>;
  isCollapsed: (networkId: number | string, target: string) => boolean;
  setNetwork: (networkId: number | string, list: string[]) => void;
  applyChange: (networkId: number | string, target: string, collapsed: boolean) => void;
  applySnapshot: (networks: any[]) => void;
  toggle: (networkId: number | string, target: string) => void;
  dropBuffer: (networkId: number | string | null, target: string) => void;
  rekeyBuffer: (networkId: number | string | null, from: string, to: string) => void;
  reset: () => void;
}

export const useNicklistCollapseStore = create<NicklistCollapseState>((set, get) => ({
  byNetwork: {},
  isCollapsed: (networkId, target) => {
    const lower = target.toLowerCase();
    return (get().byNetwork[networkId] || []).some((t) => t.toLowerCase() === lower);
  },
  setNetwork: (networkId, list) =>
    set((s) => ({
      byNetwork: { ...s.byNetwork, [networkId]: Array.isArray(list) ? [...list] : [] },
    })),
  applyChange: (networkId, target, collapsed) => {
    const lower = target.toLowerCase();
    set((s) => {
      const prev = s.byNetwork[networkId] || [];
      const filtered = prev.filter((t) => t.toLowerCase() !== lower);
      const nextList = collapsed ? [...filtered, target] : filtered;
      return { byNetwork: { ...s.byNetwork, [networkId]: nextList } };
    });
  },
  applySnapshot: (networks) => {
    const next: Record<number | string, string[]> = {};
    for (const n of networks || []) {
      if (n?.networkId == null) continue;
      if (Array.isArray(n.nicklistCollapsed)) {
        next[n.networkId] = [...n.nicklistCollapsed];
      } else if (n.collapsedNicklists && typeof n.collapsedNicklists === 'object') {
        next[n.networkId] = Object.entries(n.collapsedNicklists)
          .filter(([, v]) => Boolean(v))
          .map(([t]) => t);
      } else {
        next[n.networkId] = [];
      }
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
    const lower = target.toLowerCase();
    set((s) => {
      const list = s.byNetwork[networkId];
      if (!list?.some((t) => t.toLowerCase() === lower)) return s;
      return { byNetwork: { ...s.byNetwork, [networkId]: list.filter((t) => t.toLowerCase() !== lower) } };
    });
  },
  rekeyBuffer: (networkId, from, to) => {
    if (networkId == null) return;
    const fromL = from.toLowerCase();
    const toL = to.toLowerCase();
    set((s) => {
      const list = s.byNetwork[networkId];
      if (!list?.some((t) => t.toLowerCase() === fromL)) return s;
      const toExists = list.some((t) => t.toLowerCase() === toL);
      const updated = toExists
        ? list.filter((t) => t.toLowerCase() !== fromL)
        : list.map((t) => (t.toLowerCase() === fromL ? to : t));
      return { byNetwork: { ...s.byNetwork, [networkId]: updated } };
    });
  },
  reset: () => set({ byNetwork: {} }),
}));
