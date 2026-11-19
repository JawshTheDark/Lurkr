// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { useReactionsStore } from './reactions';
import { useDraftStore } from './drafts';
import type { Redaction } from '../shared/redaction';

export interface RedactedFrame {
  networkId: number;
  bufferId: number;
  target: string;
  messageId: number;
  by: string;
  reason?: string;
  self: boolean;
  time: string;
}

interface RedactionsState {
  byMessage: Record<number, Redaction>;
  get: (
    message: { id?: number | string | null; redaction?: Redaction } | null | undefined,
  ) => Redaction | undefined;
  noteFromEvents: (
    events: Array<{ id?: number | string | null; redaction?: Redaction }>,
    networkId: number | null | undefined,
  ) => void;
  applyFrame: (frame: RedactedFrame) => void;
  applySync: (frame: { redactions?: Record<string, Redaction> }) => void;
  noteDeleted: (id: number, redaction: Redaction) => void;
  reset: () => void;
}

export const useRedactionsStore = create<RedactionsState>((set, get) => ({
  byMessage: {},

  get: (message) => {
    if (!message || message.id == null) return undefined;
    const id = Number(message.id);
    return (Number.isFinite(id) ? get().byMessage[id] : undefined) ?? message.redaction;
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
        if (e.redaction) {
          next[id] = e.redaction;
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
    const redaction: Redaction = { by: frame.by, time: frame.time };
    if (frame.reason) redaction.reason = frame.reason;
    get().noteDeleted(id, redaction);
  },

  applySync: (frame) => {
    for (const [key, redaction] of Object.entries(frame.redactions ?? {})) {
      const id = Number(key);
      if (Number.isFinite(id) && redaction) get().noteDeleted(id, redaction);
    }
  },

  noteDeleted: (id, redaction) => {
    set((s) => ({ byMessage: { ...s.byMessage, [id]: redaction } }));
    const reactions = useReactionsStore.getState();
    reactions.deleteForMessage(id);
    if (reactions.picker.open && Number(reactions.picker.messageId) === id) {
      reactions.closePicker();
    }
    const drafts = useDraftStore.getState();
    for (const [key, reply] of Object.entries(drafts.replies)) {
      if (reply && Number(reply.messageId) === id) drafts.setReplyForKey(key, null);
    }
  },

  reset: () => set({ byMessage: {} }),
}));
