// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { socketSend } from '../services/socketBus';
import { parseRelayChain, type RelayParse } from '../shared/parseRelay';

export type RelayFormat = string;

function key(networkId: number | string, nick: string): string {
  return `${networkId}::${(nick || '').toLowerCase()}`;
}

export interface RelayBotEntry {
  nick: string;
  pattern: string;
}

export interface RelayBotLine {
  type?: string;
  nick?: string | null;
  self?: boolean;
  text?: string | null;
  body?: string | null;
}

interface RelayBotsState {
  byKey: Record<string, RelayBotEntry>;
  isRelay: (networkId: number | string | null | undefined, nick: string | null | undefined) => boolean;
  entryFor: (
    networkId: number | string | null | undefined,
    nick: string | null | undefined,
  ) => RelayBotEntry | null;
  unwrap: (networkId: number | string | null | undefined, line: RelayBotLine) => RelayParse | null;
  listForNetwork: (networkId: number) => RelayBotEntry[];
  applySnapshot: (networks: any[]) => void;
  applyUpdate: (
    networkId: number | string,
    nickOrBots: string | RelayBotEntry[],
    marked?: boolean,
    pattern?: string,
  ) => void;
  setRelay: (networkId: number | string, nick: string, marked: boolean, pattern?: string) => void;
  reset: () => void;
}

export const useRelayBotsStore = create<RelayBotsState>((set, get) => ({
  byKey: {},

  isRelay: (networkId, nick) => {
    if (networkId == null || !nick) return false;
    return !!get().byKey[key(networkId, nick)];
  },

  entryFor: (networkId, nick) => {
    if (networkId == null || !nick) return null;
    return get().byKey[key(networkId, nick)] || null;
  },

  unwrap: (networkId, line) => {
    if (networkId == null || line.type !== 'message' || line.self || !line.nick) return null;
    const byKey = get().byKey;
    const mark = (n: string) => byKey[key(networkId, n)];
    const outer = mark(line.nick);
    if (!outer) return null;
    const rawText = line.text ?? line.body ?? '';
    return parseRelayChain(rawText, outer.pattern || '', (inner) => {
      const m = mark(inner);
      return m ? m.pattern || '' : null;
    });
  },

  listForNetwork: (networkId) => {
    const prefix = `${networkId}::`;
    const out: RelayBotEntry[] = [];
    for (const [k, entry] of Object.entries(get().byKey)) {
      if (k.startsWith(prefix)) out.push({ nick: entry.nick, pattern: entry.pattern });
    }
    return out;
  },

  applySnapshot: (networks) => {
    const next: Record<string, RelayBotEntry> = {};
    for (const n of networks || []) {
      if (n?.networkId == null) continue;
      for (const entry of n.relayBots || []) {
        if (!entry?.nick) continue;
        next[key(n.networkId, entry.nick)] = {
          nick: entry.nick,
          pattern: entry.pattern || entry.format || '',
        };
      }
    }
    set({ byKey: next });
  },

  applyUpdate: (networkId, nickOrBots, marked, pattern = '') => {
    if (networkId == null) return;
    if (Array.isArray(nickOrBots)) {
      set((s) => {
        const prefix = `${networkId}::`;
        const next: Record<string, RelayBotEntry> = {};
        for (const [k, v] of Object.entries(s.byKey)) {
          if (!k.startsWith(prefix)) next[k] = v;
        }
        for (const entry of nickOrBots) {
          if (!entry?.nick) continue;
          next[key(networkId, entry.nick)] = { nick: entry.nick, pattern: entry.pattern || '' };
        }
        return { byKey: next };
      });
      return;
    }
    const nick = nickOrBots;
    if (!nick) return;
    const k = key(networkId, nick);
    set((s) => {
      const next = { ...s.byKey };
      if (marked) {
        next[k] = { nick, pattern: pattern || '' };
      } else {
        delete next[k];
      }
      return { byKey: next };
    });
  },

  setRelay: (networkId, nick, marked, pattern = '') => {
    if (!networkId || !nick) return;
    socketSend({ type: 'set-relay-bot', networkId: Number(networkId), nick, marked, pattern });
  },

  reset: () => set({ byKey: {} }),
}));
