// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { socketSend } from '../services/socketBus';

interface NickNotesState {
  byNetwork: Record<number, Record<string, string>>;
  forNick: (networkId: number | string | null | undefined, nick: string | null | undefined) => string;
  applySnapshot: (networks: any[]) => void;
  applyUpdate: (networkId: number, nick: string, note: string | null) => void;
  setNote: (networkId: number, nick: string, note: string) => void;
  reset: () => void;
}

export const useNickNotesStore = create<NickNotesState>((set, get) => ({
  byNetwork: {},
  forNick: (networkId, nick) => {
    if (networkId == null || !nick) return '';
    return get().byNetwork[Number(networkId)]?.[nick.toLowerCase()] ?? '';
  },
  applySnapshot: (networks) => {
    const next: Record<number, Record<string, string>> = {};
    for (const n of networks || []) {
      if (n?.networkId == null || !n.nickNotes) continue;
      if (Array.isArray(n.nickNotes)) {
        const map: Record<string, string> = {};
        for (const entry of n.nickNotes) {
          if (entry?.nick && entry.note) {
            map[String(entry.nick).toLowerCase()] = String(entry.note);
          }
        }
        next[n.networkId] = map;
      } else if (typeof n.nickNotes === 'object') {
        const map: Record<string, string> = {};
        for (const [k, v] of Object.entries(n.nickNotes)) {
          if (typeof v === 'string' && v) map[k.toLowerCase()] = v;
        }
        next[n.networkId] = map;
      }
    }
    set({ byNetwork: next });
  },
  applyUpdate: (networkId, nick, note) =>
    set((s) => {
      const m = { ...(s.byNetwork[networkId] || {}) };
      const k = nick.toLowerCase();
      if (note) m[k] = note;
      else delete m[k];
      return { byNetwork: { ...s.byNetwork, [networkId]: m } };
    }),
  setNote: (networkId, nick, note) => {
    socketSend({ type: 'set-nick-note', networkId, nick, note });
  },
  reset: () => set({ byNetwork: {} }),
}));
