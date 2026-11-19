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
      if (n?.networkId != null && n.nickNotes) next[n.networkId] = { ...n.nickNotes };
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
