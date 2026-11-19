// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { socketSend } from '../services/socketBus';
import { useBuffersStore, type BufferMessage } from './buffers';
import {
  THREAD_MAX_REPLIES,
  type BufferThread,
  type FollowedThread,
  type ReplyContext,
  type ThreadStats,
} from '../shared/replies';

export { THREAD_MAX_REPLIES };
export type { BufferThread, FollowedThread };

export interface ThreadMessage extends BufferMessage {
  id: number;
  msgid?: string;
  text?: string;
  time?: string;
  replyTo?: ReplyContext;
  thread?: ThreadStats;
}

export interface ThreadView {
  networkId: number;
  target: string;
  bufferId: number;
  rootMsgid: string;
  root: ThreadMessage | null;
  replies: ThreadMessage[];
  loading: boolean;
  truncated: boolean;
  token: number;
  sinceId: number;
}

export interface ThreadList {
  bufferId: number;
  threads: BufferThread[];
  loading: boolean;
  token: number;
}

export interface ThreadReplyTarget {
  messageId: number;
  nick: string;
  type: string;
  text: string;
  self: boolean;
}

let nextToken = 1;

export function threadKey(bufferId: number, rootMsgid: string): string {
  return `${bufferId}|${rootMsgid}`;
}

interface ThreadsState {
  followed: FollowedThread[];
  view: ThreadView | null;
  list: ThreadList | null;
  wantComposer: boolean;
  followedFor: (bufferId: number, rootMsgid: string) => FollowedThread | null;
  highlightedThreadsFor: (bufferId: number | null | undefined) => number;
  unreadFor: (bufferId: number, rootMsgid: string) => number;
  applyFollowed: (list: FollowedThread[]) => void;
  open: (bufferId: number, rootMsgid: string) => void;
  close: () => void;
  applyThread: (frame: {
    bufferId: number;
    rootMsgid: string;
    root: ThreadMessage | null;
    replies: ThreadMessage[];
    truncated?: boolean;
    token?: number;
  }) => void;
  openList: (bufferId: number) => void;
  closeList: () => void;
  applyThreads: (frame: {
    bufferId: number;
    threads: BufferThread[];
    token?: number;
  }) => void;
  applyLiveEvent: (event: ThreadMessage & { bufferId?: number }) => void;
  setWantComposer: (v: boolean) => void;
  reset: () => void;
}

export const useThreadsStore = create<ThreadsState>((set, get) => ({
  followed: [],
  view: null,
  list: null,
  wantComposer: false,

  followedFor: (bufferId, rootMsgid) =>
    get().followed.find((t) => t.bufferId === bufferId && t.rootMsgid === rootMsgid) ?? null,

  highlightedThreadsFor: (bufferId) =>
    bufferId == null
      ? 0
      : get().followed.filter((t) => t.bufferId === bufferId && t.unread > 0 && t.highlighted)
          .length,

  unreadFor: (bufferId, rootMsgid) =>
    get().followedFor(bufferId, rootMsgid)?.unread ?? 0,

  applyFollowed: (list) => set({ followed: Array.isArray(list) ? list : [] }),

  open: (bufferId, rootMsgid) => {
    const buffers = Object.values(useBuffersStore.getState().buffers);
    const buf = buffers.find((b) => b.id === bufferId);
    if (!buf || buf.networkId == null) {
      set({ view: null });
      return;
    }
    const token = nextToken++;
    const cur = get().view;
    const same = cur?.bufferId === bufferId && cur.rootMsgid === rootMsgid;
    set({
      view: {
        networkId: Number(buf.networkId),
        target: buf.target,
        bufferId,
        rootMsgid,
        root: same ? cur!.root : null,
        replies: same ? cur!.replies : [],
        loading: !same,
        truncated: same ? cur!.truncated : false,
        token,
        sinceId: same ? (cur!.replies.at(-1)?.id ?? 0) : 0,
      },
    });
    socketSend({ type: 'thread', bufferId, rootMsgid, token });
  },

  close: () => set({ view: null }),

  applyThread: (frame) => {
    const view = get().view;
    if (!view || view.bufferId !== frame.bufferId || view.rootMsgid !== frame.rootMsgid) return;
    if (frame.token != null && frame.token !== view.token) return;
    const liveExtras = view.replies.filter((r) => r.id > view.sinceId);
    const seen = new Set(frame.replies.map((r) => r.id));
    const merged = [...frame.replies, ...liveExtras.filter((r) => !seen.has(r.id))];
    set({
      view: {
        ...view,
        root: frame.root,
        replies: merged,
        loading: false,
        truncated: !!frame.truncated,
      },
    });
  },

  openList: (bufferId) => {
    const token = nextToken++;
    set({ list: { bufferId, threads: [], loading: true, token } });
    socketSend({ type: 'threads', bufferId, token });
  },

  closeList: () => set({ list: null }),

  applyThreads: (frame) => {
    const list = get().list;
    if (!list || list.bufferId !== frame.bufferId) return;
    if (frame.token != null && frame.token !== list.token) return;
    set({ list: { ...list, threads: frame.threads || [], loading: false } });
  },

  applyLiveEvent: (event) => {
    const view = get().view;
    if (!view || event.bufferId !== view.bufferId) return;
    const root = event.replyTo?.root;
    if (root !== view.rootMsgid) return;
    if (view.replies.some((r) => r.id === event.id)) return;
    set({ view: { ...view, replies: [...view.replies, event] } });
  },

  setWantComposer: (v) => set({ wantComposer: v }),

  reset: () => set({ followed: [], view: null, list: null, wantComposer: false }),
}));
