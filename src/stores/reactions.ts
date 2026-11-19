// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { socketSend } from '../services/socketBus';
import { useBuffersStore } from './buffers';
import { tagSupport, useNetworksStore } from './networks';
import type { MessageReaction } from '../shared/reactions';

export interface ReactionGroup {
  value: string;
  nicks: string[];
  mine: boolean;
}

export interface ReactionFrame {
  networkId: number;
  bufferId: number;
  target: string;
  messageId: number;
  nick: string;
  value: string;
  self: boolean;
  remove: boolean;
  toSelf: boolean;
  time: string;
}

const sameNick = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const SYNC_PER_BUFFER = 200;
const SYNC_MAX_IDS = 5000;

interface ReactionsState {
  byMessage: Record<number, MessageReaction[]>;
  picker: {
    open: boolean;
    messageId: number | null;
    networkId: number | null;
    nick: string;
    text: string;
  };
  groupsFor: (messageId: number | string | null | undefined) => ReactionGroup[];
  noteFromEvents: (
    events: Array<{ id?: number | string | null; reactions?: MessageReaction[] }>,
    networkId: number | null | undefined,
  ) => void;
  applyFrame: (frame: ReactionFrame) => void;
  applySync: (frame: { reactions?: Record<string, MessageReaction[]> }) => void;
  resync: () => void;
  react: (networkId: number, target: string, messageId: number, value: string) => void;
  unreact: (networkId: number, target: string, messageId: number, value: string) => void;
  toggle: (networkId: number, target: string, messageId: number, value: string) => void;
  openPicker: (opts: { messageId: number; networkId: number; nick: string; text: string }) => void;
  closePicker: () => void;
  deleteForMessage: (id: number) => void;
  reset: () => void;
}

export const useReactionsStore = create<ReactionsState>((set, get) => ({
  byMessage: {},
  picker: { open: false, messageId: null, networkId: null, nick: '', text: '' },

  groupsFor: (messageId) => {
    if (messageId == null) return [];
    const list = get().byMessage[Number(messageId)];
    if (!list || list.length === 0) return [];
    const groups: ReactionGroup[] = [];
    for (const r of list) {
      let g = groups.find((x) => x.value === r.value);
      if (!g) {
        g = { value: r.value, nicks: [], mine: false };
        groups.push(g);
      }
      g.nicks.push(r.nick);
      if (r.self) g.mine = true;
    }
    return groups;
  },

  noteFromEvents: (events, networkId) => {
    if (!Array.isArray(events) || networkId == null) return;
    set((s) => {
      const next = { ...s.byMessage };
      let changed = false;
      for (const e of events) {
        if (e?.id == null) continue;
        const id = Number(e.id);
        if (!Number.isFinite(id)) continue;
        if (Array.isArray(e.reactions) && e.reactions.length) {
          next[id] = e.reactions;
          changed = true;
        } else if (id in next) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? { byMessage: next } : s;
    });
  },

  applyFrame: (frame) => {
    const id = Number(frame.messageId);
    if (!Number.isFinite(id)) return;
    set((s) => {
      const current = s.byMessage[id] ?? [];
      const same = (r: MessageReaction) => r.value === frame.value && sameNick(r.nick, frame.nick);
      const next = { ...s.byMessage };
      if (frame.remove) {
        const list = current.filter((r) =>
          frame.self ? !(r.self && r.value === frame.value) : !same(r),
        );
        if (list.length) next[id] = list;
        else delete next[id];
      } else if (!current.some(same)) {
        next[id] = [...current, { value: frame.value, nick: frame.nick, self: frame.self }];
      }
      return { byMessage: next };
    });
  },

  applySync: (frame) => {
    if (!frame.reactions) return;
    set((s) => {
      const next = { ...s.byMessage };
      for (const [k, list] of Object.entries(frame.reactions ?? {})) {
        const id = Number(k);
        if (!Number.isFinite(id)) continue;
        if (Array.isArray(list) && list.length) next[id] = list;
        else delete next[id];
      }
      return { byMessage: next };
    });
  },

  resync: () => {
    const ids: number[] = [];
    const buffers = Object.values(useBuffersStore.getState().buffers);
    for (const buf of buffers) {
      if (buf.networkId == null) continue;
      const tail = buf.messages.slice(-SYNC_PER_BUFFER);
      for (const m of tail) {
        if (typeof m.id === 'number') ids.push(m.id);
        if (ids.length >= SYNC_MAX_IDS) break;
      }
      if (ids.length >= SYNC_MAX_IDS) break;
    }
    if (ids.length) socketSend({ type: 'sync-reactions', messageIds: ids });
  },

  react: (networkId, target, messageId, value) => {
    const sup = tagSupport(useNetworksStore.getState().states[networkId]);
    if (!sup.react) return;
    socketSend({ type: 'react', networkId, target, messageId, value });
  },

  unreact: (networkId, target, messageId, value) => {
    const sup = tagSupport(useNetworksStore.getState().states[networkId]);
    if (!sup.unreact) return;
    socketSend({ type: 'react', networkId, target, messageId, value, remove: true });
  },

  toggle: (networkId, target, messageId, value) => {
    const mine = get()
      .groupsFor(messageId)
      .some((g) => g.value === value && g.mine);
    if (mine) get().unreact(networkId, target, messageId, value);
    else get().react(networkId, target, messageId, value);
  },

  openPicker: ({ messageId, networkId, nick, text }) =>
    set({ picker: { open: true, messageId, networkId, nick, text } }),

  closePicker: () =>
    set({ picker: { open: false, messageId: null, networkId: null, nick: '', text: '' } }),

  deleteForMessage: (id) =>
    set((s) => {
      if (!(id in s.byMessage)) return s;
      const next = { ...s.byMessage };
      delete next[id];
      return { byMessage: next };
    }),

  reset: () =>
    set({
      byMessage: {},
      picker: { open: false, messageId: null, networkId: null, nick: '', text: '' },
    }),
}));
