// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { useDraftStore } from './drafts';

export interface PendingReply {
  messageId: number;
  nick: string;
  type: string;
  text: string;
  self?: boolean;
  addressed?: boolean;
}

interface RepliesState {
  forKey: (key: string | null | undefined) => PendingReply | null;
  start: (key: string, reply: PendingReply) => void;
  set: (key: string, reply: PendingReply | null) => void;
  markAddressed: (key: string, nick: string) => void;
  cancel: (key: string | null | undefined) => void;
}

export const useRepliesStore = create<RepliesState>(() => ({
  forKey: (key) => useDraftStore.getState().replyForKey(key),
  start: (key, reply) => {
    const prev = useDraftStore.getState().replyForKey(key);
    const addressed = !!reply.addressed || (!!prev?.addressed && prev.nick === reply.nick);
    useDraftStore.getState().setReplyForKey(key, { ...reply, addressed });
  },
  set: (key, reply) => {
    useDraftStore.getState().setReplyForKey(key, reply ? { ...reply } : null);
  },
  markAddressed: (key, nick) => {
    const reply = useDraftStore.getState().replyForKey(key);
    if (reply && reply.nick === nick) {
      useDraftStore.getState().setReplyForKey(key, { ...reply, addressed: true });
    }
  },
  cancel: (key) => {
    if (key) useDraftStore.getState().setReplyForKey(key, null);
  },
}));
