// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { recordVisit, stepIndex, type NavHistory } from '../utils/navHistory';

interface NavHistoryState {
  stack: string[];
  cursor: number;
  push: (key: string) => void;
  step: (delta: -1 | 1) => string | null;
  dropBuffer: (networkId: number | string | null, target: string) => void;
  rekeyBuffer: (networkId: number | string | null, from: string, to: string) => void;
  reset: () => void;
}

export const useNavHistoryStore = create<NavHistoryState>((set, get) => ({
  stack: [],
  cursor: -1,
  push: (key) =>
    set((s) => {
      const h: NavHistory = { stack: [...s.stack], index: s.cursor };
      if (!recordVisit(h, key)) return s;
      return { stack: h.stack, cursor: h.index };
    }),
  step: (delta) => {
    const s = get();
    const h: NavHistory = { stack: s.stack, index: s.cursor };
    const nextIdx = stepIndex(h, delta, () => true);
    if (nextIdx < 0) return null;
    set({ cursor: nextIdx });
    return s.stack[nextIdx] ?? null;
  },
  dropBuffer: (networkId, target) => {
    const k = networkId == null ? target : `${networkId}::${target}`;
    set((s) => {
      const stack = s.stack.filter((entry) => entry !== k);
      const cursor = Math.min(s.cursor, stack.length - 1);
      return { stack, cursor };
    });
  },
  rekeyBuffer: (networkId, from, to) => {
    const fromKey = networkId == null ? from : `${networkId}::${from}`;
    const toKey = networkId == null ? to : `${networkId}::${to}`;
    set((s) => ({
      stack: s.stack.map((k) => (k === fromKey ? toKey : k)),
    }));
  },
  reset: () => set({ stack: [], cursor: -1 }),
}));
