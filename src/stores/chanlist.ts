// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { socketSend } from '../services/socketBus';

export interface ChanlistEntry {
  channel: string;
  users: number;
  topic: string;
}

export interface NetworkChanlist {
  status: 'idle' | 'loading' | 'ready' | 'error';
  channels: ChanlistEntry[];
  total: number;
  error?: string;
}

interface ChanlistState {
  byNetwork: Record<number, NetworkChanlist>;
  forNetwork: (networkId: number) => NetworkChanlist;
  request: (networkId: number, refresh?: boolean) => void;
  applyState: (payload: {
    networkId: number;
    status: NetworkChanlist['status'];
    total?: number;
    error?: string;
  }) => void;
  applyResult: (payload: { networkId: number; channels: ChanlistEntry[]; total?: number }) => void;
  onStart: (networkId: number) => void;
  onProgress: (networkId: number, channels: ChanlistEntry[]) => void;
  onEnd: (networkId: number, total?: number) => void;
  reset: () => void;
}

export const EMPTY_CHANLIST: NetworkChanlist = { status: 'idle', channels: [], total: 0 };

export const useChanlistStore = create<ChanlistState>((set, get) => ({
  byNetwork: {},
  forNetwork: (networkId) => get().byNetwork[networkId] || EMPTY_CHANLIST,
  request: (networkId, refresh = false) => {
    set((s) => ({
      byNetwork: {
        ...s.byNetwork,
        [networkId]: {
          ...(s.byNetwork[networkId] || EMPTY_CHANLIST),
          status: 'loading',
          error: undefined,
        },
      },
    }));
    socketSend({ type: 'list-channels', networkId, refresh });
  },
  applyState: ({ networkId, status, total, error }) =>
    set((s) => {
      const prev = s.byNetwork[networkId] || EMPTY_CHANLIST;
      return {
        byNetwork: {
          ...s.byNetwork,
          [networkId]: { ...prev, status, total: total ?? prev.total, error },
        },
      };
    }),
  applyResult: ({ networkId, channels, total }) =>
    set((s) => ({
      byNetwork: {
        ...s.byNetwork,
        [networkId]: {
          status: 'ready',
          channels: channels || [],
          total: total ?? channels?.length ?? 0,
        },
      },
    })),
  onStart: (networkId) =>
    set((s) => ({
      byNetwork: {
        ...s.byNetwork,
        [networkId]: { status: 'loading', channels: [], total: 0 },
      },
    })),
  onProgress: (networkId, channels) =>
    set((s) => {
      const prev = s.byNetwork[networkId] || EMPTY_CHANLIST;
      const merged = [...prev.channels, ...(channels || [])];
      return {
        byNetwork: {
          ...s.byNetwork,
          [networkId]: { ...prev, status: 'loading', channels: merged, total: merged.length },
        },
      };
    }),
  onEnd: (networkId, total) =>
    set((s) => {
      const prev = s.byNetwork[networkId] || EMPTY_CHANLIST;
      return {
        byNetwork: {
          ...s.byNetwork,
          [networkId]: { ...prev, status: 'ready', total: total ?? prev.channels.length },
        },
      };
    }),
  reset: () => set({ byNetwork: {} }),
}));
