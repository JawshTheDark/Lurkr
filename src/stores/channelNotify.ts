// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { socketSend } from '../services/socketBus';
import { idFor } from './buffers';

export type ChannelNotifyLevel = 'default' | 'all' | 'mute';

interface ChannelNotifyState {
  byNetwork: Record<number | string, Record<string, ChannelNotifyLevel>>;
  levelFor: (networkId: number | string, target: string) => ChannelNotifyLevel;
  setNetwork: (networkId: number | string, map: Record<string, ChannelNotifyLevel>) => void;
  applyChange: (networkId: number | string, target: string, notifyAlways: boolean) => void;
  applySnapshot: (networks: any[]) => void;
  setLevel: (networkId: number | string, target: string, level: ChannelNotifyLevel) => void;
  dropBuffer: (networkId: number | string | null, target: string) => void;
  rekeyBuffer: (networkId: number | string | null, from: string, to: string) => void;
  reset: () => void;
}

function normalizeChannelNotifyMap(raw: unknown): Record<string, ChannelNotifyLevel> {
  const out: Record<string, ChannelNotifyLevel> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    if (v === 'default' || v === 'all' || v === 'mute') {
      out[lower] = v;
    } else if (v && typeof v === 'object' && 'notifyAlways' in v) {
      if ((v as { notifyAlways?: unknown }).notifyAlways) out[lower] = 'all';
    }
  }
  return out;
}

export const useChannelNotifyStore = create<ChannelNotifyState>((set, get) => ({
  byNetwork: {},
  levelFor: (networkId, target) => get().byNetwork[networkId]?.[target.toLowerCase()] ?? 'default',
  setNetwork: (networkId, map) =>
    set((s) => ({
      byNetwork: { ...s.byNetwork, [networkId]: normalizeChannelNotifyMap(map) },
    })),
  applyChange: (networkId, target, notifyAlways) => {
    const lower = target.toLowerCase();
    set((s) => {
      const m = { ...(s.byNetwork[networkId] || {}) };
      if (notifyAlways) m[lower] = 'all';
      else delete m[lower];
      return { byNetwork: { ...s.byNetwork, [networkId]: m } };
    });
  },
  applySnapshot: (networks) => {
    const next: Record<number | string, Record<string, ChannelNotifyLevel>> = {};
    for (const n of networks || []) {
      if (n?.networkId != null) next[n.networkId] = normalizeChannelNotifyMap(n.channelNotify);
    }
    set({ byNetwork: next });
  },
  setLevel: (networkId, target, level) => {
    socketSend({
      type: 'set-channel-notify-always',
      networkId,
      target,
      bufferId: idFor(networkId, target),
      notifyAlways: level === 'all',
    });
  },
  dropBuffer: (networkId, target) => {
    if (networkId == null) return;
    const lower = target.toLowerCase();
    set((s) => {
      const m = s.byNetwork[networkId];
      if (!m || !(lower in m)) return s;
      const next = { ...m };
      delete next[lower];
      return { byNetwork: { ...s.byNetwork, [networkId]: next } };
    });
  },
  rekeyBuffer: (networkId, from, to) => {
    if (networkId == null) return;
    const fromL = from.toLowerCase();
    const toL = to.toLowerCase();
    set((s) => {
      const m = s.byNetwork[networkId];
      if (!m || !(fromL in m)) return s;
      const next = { ...m };
      if (!(toL in next)) next[toL] = next[fromL];
      delete next[fromL];
      return { byNetwork: { ...s.byNetwork, [networkId]: next } };
    });
  },
  reset: () => set({ byNetwork: {} }),
}));
