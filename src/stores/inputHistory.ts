// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import type { PendingReply } from './replies';

export interface InputHistoryEntry {
  text: string;
  reply?: PendingReply | null;
}

const MAX_HISTORY = 100;

interface InputHistoryState {
  byBuffer: Record<string, InputHistoryEntry[]>;
  forBuffer: (networkId: number | string, target: string) => InputHistoryEntry[];
  seed: (items: Array<{ networkId: number; target: string; entries: InputHistoryEntry[] }>) => void;
  add: (networkId: number | string, target: string, entry: InputHistoryEntry) => void;
  reset: () => void;
}

export const useInputHistoryStore = create<InputHistoryState>((set, get) => ({
  byBuffer: {},
  forBuffer: (networkId, target) => get().byBuffer[`${networkId}::${target}`] || [],
  seed: (items) => {
    const next: Record<string, InputHistoryEntry[]> = {};
    for (const item of items || []) {
      if (item?.networkId != null && item.target) {
        next[`${item.networkId}::${item.target}`] = Array.isArray(item.entries)
          ? item.entries.slice(-MAX_HISTORY)
          : [];
      }
    }
    set({ byBuffer: next });
  },
  add: (networkId, target, entry) => {
    const k = `${networkId}::${target}`;
    set((s) => {
      const prev = s.byBuffer[k] || [];
      const next = [...prev, entry].slice(-MAX_HISTORY);
      return { byBuffer: { ...s.byBuffer, [k]: next } };
    });
  },
  reset: () => set({ byBuffer: {} }),
}));
