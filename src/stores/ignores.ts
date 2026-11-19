// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { socketSend } from '../services/socketBus';
import {
  compileIgnoreRules,
  evaluateIgnores,
  isMemberHidden,
  channelMutesUnread,
  type IgnoreRule,
  type IgnoreInput,
  type IgnoreVerdict,
} from '../utils/ignoreMatch';
import { isChannelTarget } from '../shared/channels';

export interface IgnoreEntry extends IgnoreRule {
  id: number;
  createdAt: string;
}

export interface IgnoreEntryWithNetwork extends IgnoreEntry {
  networkId: number | null;
}

const MUTE_LEVELS = new Set(['NOUNREAD', 'NONOTIFY']);
function isMuteOnlyLevels(levels: string[]): boolean {
  return levels.length > 0 && levels.every((l) => MUTE_LEVELS.has(l));
}

function findMuteRule(
  netList: IgnoreEntry[],
  globalList: IgnoreEntry[],
  networkId: number,
  scopeMatches: (e: IgnoreEntry) => boolean,
): IgnoreEntryWithNetwork | null {
  const ok = (e: IgnoreEntry) =>
    !e.mask && !e.pattern && !e.isExcept && scopeMatches(e) && isMuteOnlyLevels(e.levels);
  const net = netList.find(ok);
  if (net) return { ...net, networkId };
  const g = globalList.find(ok);
  return g ? { ...g, networkId: null } : null;
}

type Compiled = ReturnType<typeof compileIgnoreRules>;
const compiledCache = new WeakMap<object, Compiled>();
function compiledFor(list: IgnoreEntry[]): Compiled {
  let c = compiledCache.get(list);
  if (!c) {
    c = compileIgnoreRules(list);
    compiledCache.set(list, c);
  }
  return c;
}
const EMPTY: IgnoreEntry[] = [];
const mergedCache = new Map<number, { g: IgnoreEntry[]; n: IgnoreEntry[]; c: Compiled }>();
function mergedCompiled(globalList: IgnoreEntry[], netList: IgnoreEntry[], key: number): Compiled {
  const hit = mergedCache.get(key);
  if (hit && hit.g === globalList && hit.n === netList) return hit.c;
  let c: Compiled;
  if (globalList.length === 0) c = compiledFor(netList);
  else if (netList.length === 0) c = compiledFor(globalList);
  else c = [...compiledFor(globalList), ...compiledFor(netList)];
  mergedCache.set(key, { g: globalList, n: netList, c });
  return c;
}

interface IgnoresState {
  global: IgnoreEntry[];
  byNetwork: Record<number, IgnoreEntry[]>;
  forNetwork: (networkId: number) => IgnoreEntry[];
  all: () => IgnoreEntryWithNetwork[];
  evaluate: (networkId: number, input: IgnoreInput) => IgnoreVerdict;
  isMemberIgnored: (networkId: number, channel: string, input: { nick: string; userhost?: string | null }) => boolean;
  isChannelUnreadMuted: (networkId: number, channel: string) => boolean;
  bufferMuteRule: (networkId: number, target: string) => IgnoreEntryWithNetwork | null;
  networkMuteRule: (networkId: number) => IgnoreEntryWithNetwork | null;
  applySnapshot: (networks: any[], globalIgnores?: IgnoreEntry[]) => void;
  applyUpdate: (networkId: number | null, rules: IgnoreEntry[]) => void;
  add: (rule: Record<string, unknown>) => void;
  remove: (networkId: number | null, id: number) => void;
  reset: () => void;
}

export const useIgnoresStore = create<IgnoresState>((set, get) => ({
  global: [],
  byNetwork: {},

  forNetwork: (networkId) => get().byNetwork[networkId] || EMPTY,

  all: () => {
    const s = get();
    const out: IgnoreEntryWithNetwork[] = s.global.map((r) => ({ ...r, networkId: null }));
    for (const [nid, list] of Object.entries(s.byNetwork)) {
      const id = Number(nid);
      for (const r of list) out.push({ ...r, networkId: id });
    }
    return out;
  },

  evaluate: (networkId, input) => {
    const s = get();
    const compiled = mergedCompiled(s.global, s.byNetwork[networkId] || EMPTY, networkId);
    return evaluateIgnores(compiled, input);
  },

  isMemberIgnored: (networkId, channel, input) => {
    const s = get();
    const compiled = mergedCompiled(s.global, s.byNetwork[networkId] || EMPTY, networkId);
    return isMemberHidden(compiled, input.nick, input.userhost ?? null, channel);
  },

  isChannelUnreadMuted: (networkId, channel) => {
    const s = get();
    const compiled = mergedCompiled(s.global, s.byNetwork[networkId] || EMPTY, networkId);
    return channelMutesUnread(compiled, channel);
  },

  bufferMuteRule: (networkId, target) => {
    const s = get();
    const lower = target.toLowerCase();
    return findMuteRule(s.byNetwork[networkId] || EMPTY, s.global, networkId, (e) => {
      if (isChannelTarget(target)) {
        return Array.isArray(e.channels) && e.channels.length === 1 && e.channels[0].toLowerCase() === lower;
      }
      return (!e.channels || e.channels.length === 0) && false;
    });
  },

  networkMuteRule: (networkId) => {
    const s = get();
    return findMuteRule(
      s.byNetwork[networkId] || EMPTY,
      s.global,
      networkId,
      (e) => !e.channels || e.channels.length === 0,
    );
  },

  applySnapshot: (networks, globalIgnores = []) => {
    mergedCache.clear();
    const byNetwork: Record<number, IgnoreEntry[]> = {};
    for (const n of networks || []) {
      if (n?.networkId != null && Array.isArray(n.ignores)) {
        byNetwork[n.networkId] = n.ignores;
      }
    }
    set({ global: Array.isArray(globalIgnores) ? globalIgnores : [], byNetwork });
  },

  applyUpdate: (networkId, rules) => {
    if (networkId == null) {
      mergedCache.clear();
      set({ global: Array.isArray(rules) ? rules : [] });
    } else {
      mergedCache.delete(networkId);
      set((s) => ({
        byNetwork: { ...s.byNetwork, [networkId]: Array.isArray(rules) ? rules : [] },
      }));
    }
  },

  add: (rule) => socketSend({ type: 'add-ignore', ...rule }),
  remove: (networkId, id) => socketSend({ type: 'remove-ignore', networkId, id }),
  reset: () => {
    mergedCache.clear();
    set({ global: [], byNetwork: {} });
  },
}));
