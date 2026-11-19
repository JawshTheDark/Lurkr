// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { socketSendWithAck } from '../services/socketBus';
import type { PendingReply } from './replies';
import type { DraftReply } from '../shared/replies';
import { replyExcerpt } from '../utils/replyText';

const FLUSH_DEBOUNCE_MS = 500;

function key(networkId: number | string, target: string) {
  return `${networkId}::${target}`;
}

function splitKey(k: string): { networkId: number; target: string } | null {
  const at = k.indexOf('::');
  const networkId = Number(k.slice(0, at));
  if (at <= 0 || !Number.isInteger(networkId)) return null;
  return { networkId, target: k.slice(at + 2) };
}

function replyRef(
  reply: PendingReply | undefined,
): { messageId: number; addressed: boolean } | null {
  return reply ? { messageId: reply.messageId, addressed: !!reply.addressed } : null;
}

export function pendingReplyFrom(
  reply: DraftReply | null | undefined,
): PendingReply | null {
  if (!reply?.parent) return null;
  return {
    messageId: reply.messageId,
    nick: reply.parent.nick,
    type: reply.parent.type,
    text: replyExcerpt(reply.parent.text || ''),
    self: reply.parent.self,
    addressed: reply.addressed,
  };
}

type BufferRef = { networkId: number | string; target: string };
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, BufferRef>();
const version = new Map<string, number>();
const inFlight = new Map<string, number>();
const unconfirmed = new Map<string, BufferRef>();
const baseRev = new Map<string, number>();
const typedAt = new Map<string, number>();
let composingKey: string | null = null;

function touch(k: string): void {
  version.set(k, (version.get(k) ?? 0) + 1);
  typedAt.set(k, Date.now());
}

const revOf = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

function guardFor(k: string): { base?: number; age: number } {
  const base = baseRev.get(k);
  const typed = typedAt.get(k);
  return {
    ...(base === undefined ? {} : { base }),
    age: typed === undefined ? 0 : Math.max(0, Date.now() - typed),
  };
}

interface DraftsState {
  drafts: Record<string, string>;
  replies: Record<string, PendingReply>;
  forBuffer: (networkId: number | string, target: string) => string;
  hasDraft: (networkId: number | string, target: string) => boolean;
  replyForKey: (k: string | null | undefined) => PendingReply | null;
  seed: (list: any[]) => void;
  applyRemote: (payload: {
    networkId: number | string;
    target: string;
    body?: string;
    reply?: DraftReply | null;
    rev?: number;
  }) => void;
  setDraft: (networkId: number | string, target: string, body: string) => void;
  setReplyForKey: (k: string, reply: PendingReply | null) => void;
  flush: (networkId: number | string, target: string) => void;
  flushAll: () => void;
  beginComposing: (networkId: number | string, target: string) => void;
  endComposing: (networkId: number | string, target: string) => void;
  dropBuffer: (networkId: number | string | null, target: string) => void;
  rekeyBuffer: (networkId: number | string | null, from: string, to: string) => void;
  resetTimers: () => void;
  reset: () => void;
}

export const useDraftStore = create<DraftsState>((set, get) => ({
  drafts: {},
  replies: {},

  forBuffer: (networkId, target) => get().drafts[key(networkId, target)] || '',

  hasDraft: (networkId, target) => {
    const k = key(networkId, target);
    const body = get().drafts[k];
    return (typeof body === 'string' && body.length > 0) || !!get().replies[k];
  },

  replyForKey: (k) => (k && get().replies[k]) || null,

  seed: (list) => {
    const state = get();
    const next: Record<string, string> = {};
    const nextReplies: Record<string, PendingReply> = {};
    const nextRevs = new Map<string, number>();
    const keepRev = (k: string) => {
      const had = baseRev.get(k);
      if (had !== undefined) nextRevs.set(k, had);
    };
    const keep = (k: string) => {
      const existing = state.drafts[k];
      if (typeof existing === 'string' && existing.length > 0) next[k] = existing;
      if (state.replies[k]) nextReplies[k] = state.replies[k];
      keepRev(k);
    };
    const held = new Set<string>([
      ...pending.keys(),
      ...unconfirmed.keys(),
      ...(composingKey ? [composingKey] : []),
    ]);

    if (Array.isArray(list)) {
      for (const d of list) {
        if (!d) continue;
        const k = key(d.networkId, d.target);
        if (held.has(k)) {
          keep(k);
          continue;
        }
        if (typeof d.body === 'string' && d.body.length > 0) next[k] = d.body;
        const reply = pendingReplyFrom(d.reply);
        if (reply) nextReplies[k] = reply;
        const rev = revOf(d.rev);
        if (rev !== undefined) nextRevs.set(k, rev);
      }
    }
    for (const k of held) {
      if (next[k] != null || nextReplies[k]) continue;
      keep(k);
    }
    baseRev.clear();
    for (const [k, rev] of nextRevs) baseRev.set(k, rev);
    inFlight.clear();
    set({ drafts: next, replies: nextReplies });
    for (const [k, ref] of [...pending, ...unconfirmed]) {
      if (k !== composingKey && !flushTimers.has(k)) {
        pending.set(k, ref);
        get().flush(ref.networkId, ref.target);
      }
    }
  },

  applyRemote: ({ networkId, target, body, reply, rev }) => {
    const k = key(networkId, target);
    const r = revOf(rev);
    if (pending.has(k) || k === composingKey) {
      if (r !== undefined) baseRev.set(k, r);
      return;
    }
    if (r !== undefined) baseRev.set(k, r);
    unconfirmed.delete(k);
    set((s) => {
      const drafts = { ...s.drafts };
      const replies = { ...s.replies };
      if (typeof body === 'string' && body.length > 0) drafts[k] = body;
      else delete drafts[k];
      const parsedReply = pendingReplyFrom(reply);
      if (parsedReply) replies[k] = parsedReply;
      else delete replies[k];
      return { drafts, replies };
    });
  },

  setDraft: (networkId, target, body) => {
    const k = key(networkId, target);
    set((s) => {
      const drafts = { ...s.drafts };
      if (body && body.length > 0) drafts[k] = body;
      else delete drafts[k];
      return { drafts };
    });
    touch(k);
    unconfirmed.delete(k);
    pending.set(k, { networkId, target });
    const prev = flushTimers.get(k);
    if (prev) clearTimeout(prev);
    if (k === composingKey) return;
    flushTimers.set(
      k,
      setTimeout(() => {
        flushTimers.delete(k);
        get().flush(networkId, target);
      }, FLUSH_DEBOUNCE_MS),
    );
  },

  setReplyForKey: (k, reply) => {
    const parts = splitKey(k);
    if (!parts) return;
    set((s) => {
      const replies = { ...s.replies };
      if (reply) replies[k] = reply;
      else delete replies[k];
      return { replies };
    });
    touch(k);
    unconfirmed.delete(k);
    pending.set(k, parts);
    const prev = flushTimers.get(k);
    if (prev) clearTimeout(prev);
    flushTimers.set(
      k,
      setTimeout(() => {
        flushTimers.delete(k);
        get().flush(parts.networkId, parts.target);
      }, FLUSH_DEBOUNCE_MS),
    );
  },

  flush: (networkId, target) => {
    const k = key(networkId, target);
    const t = flushTimers.get(k);
    if (t) {
      clearTimeout(t);
      flushTimers.delete(k);
    }
    if (!pending.has(k) || inFlight.has(k)) return;
    const body = get().drafts[k] || '';
    const reply = replyRef(get().replies[k]);
    const sent = version.get(k) ?? 0;
    const payload =
      body.length > 0 || reply
        ? { type: 'draft-set', networkId: Number(networkId), target, body, reply, ...guardFor(k) }
        : { type: 'draft-clear', networkId: Number(networkId), target, ...guardFor(k) };

    inFlight.set(k, sent);
    void socketSendWithAck(payload).then((result) => {
      if (inFlight.get(k) !== sent) return;
      inFlight.delete(k);
      const rev = result.ok
        ? revOf((result.data as { rev?: unknown } | undefined)?.rev)
        : undefined;
      if (rev !== undefined) baseRev.set(k, rev);
      if (!pending.has(k)) return;
      if ((version.get(k) ?? 0) !== sent) {
        const gone = !result.ok && result.error === 'disconnected';
        if (!gone && !flushTimers.has(k) && k !== composingKey) {
          get().flush(networkId, target);
        }
        return;
      }
      if (!result.ok && result.error === 'disconnected') return;
      pending.delete(k);
      const holds = !!get().drafts[k] || !!get().replies[k];
      if (!result.ok && result.error !== 'stale' && holds) {
        unconfirmed.set(k, { networkId, target });
      }
    });
  },

  flushAll: () => {
    for (const { networkId, target } of Array.from(pending.values())) {
      get().flush(networkId, target);
    }
  },

  beginComposing: (networkId, target) => {
    composingKey = key(networkId, target);
  },

  endComposing: (networkId, target) => {
    const k = key(networkId, target);
    if (composingKey === k) composingKey = null;
    if (pending.has(k)) {
      const prev = flushTimers.get(k);
      if (prev) clearTimeout(prev);
      flushTimers.set(
        k,
        setTimeout(() => {
          flushTimers.delete(k);
          get().flush(networkId, target);
        }, FLUSH_DEBOUNCE_MS),
      );
    }
  },

  dropBuffer: (networkId, target) => {
    if (networkId == null) return;
    const k = key(networkId, target);
    const t = flushTimers.get(k);
    if (t) clearTimeout(t);
    flushTimers.delete(k);
    pending.delete(k);
    unconfirmed.delete(k);
    inFlight.delete(k);
    baseRev.delete(k);
    typedAt.delete(k);
    if (composingKey === k) composingKey = null;
    set((s) => {
      const drafts = { ...s.drafts };
      const replies = { ...s.replies };
      delete drafts[k];
      delete replies[k];
      return { drafts, replies };
    });
  },

  rekeyBuffer: (networkId, from, to) => {
    if (networkId == null) return;
    const fromKey = key(networkId, from);
    const toKey = key(networkId, to);
    const t = flushTimers.get(fromKey);
    if (t) {
      clearTimeout(t);
      flushTimers.delete(fromKey);
    }
    if (pending.has(fromKey)) {
      pending.delete(fromKey);
      pending.set(toKey, { networkId, target: to });
    }
    if (unconfirmed.has(fromKey)) {
      unconfirmed.delete(fromKey);
      unconfirmed.set(toKey, { networkId, target: to });
    }
    inFlight.delete(fromKey);
    const rev = baseRev.get(fromKey);
    baseRev.delete(fromKey);
    if (rev !== undefined) baseRev.set(toKey, rev);
    const typed = typedAt.get(fromKey);
    typedAt.delete(fromKey);
    if (typed !== undefined) typedAt.set(toKey, typed);
    if (composingKey === fromKey) composingKey = toKey;
    set((s) => {
      const drafts = { ...s.drafts };
      const replies = { ...s.replies };
      if (fromKey in drafts) {
        drafts[toKey] = drafts[fromKey];
        delete drafts[fromKey];
      }
      if (fromKey in replies) {
        replies[toKey] = replies[fromKey];
        delete replies[fromKey];
      }
      return { drafts, replies };
    });
  },

  resetTimers: () => {
    for (const t of flushTimers.values()) clearTimeout(t);
    flushTimers.clear();
    pending.clear();
    unconfirmed.clear();
    inFlight.clear();
    baseRev.clear();
    for (const k of version.keys()) touch(k);
    typedAt.clear();
    composingKey = null;
  },

  reset: () => {
    get().resetTimers();
    set({ drafts: {}, replies: {} });
  },
}));
