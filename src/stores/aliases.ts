// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { api } from '../api';
import type { Alias } from '../shared/aliases';

const path = (name: string): string => `/api/aliases/${encodeURIComponent(name)}`;
const byName = (a: Alias, b: Alias): number => a.name.localeCompare(b.name);

let inflight: Promise<void> | null = null;
let stale = false;
let session = 0;

const RETRY_AFTER_MS = [2_000, 10_000, 30_000];
let retryTimer: ReturnType<typeof setTimeout> | null = null;

interface AliasesState {
  aliases: Alias[];
  loaded: boolean;
  loading: boolean;
  error: string;
  find: (verb: string) => Alias | undefined;
  fetchAll: () => Promise<void>;
  settled: () => Promise<void>;
  load: (attempt?: number) => void;
  set: (name: string, body: string) => Promise<{ alias: Alias; created: boolean }>;
  update: (name: string, fields: { name?: string; body?: string }) => Promise<Alias>;
  remove: (name: string) => Promise<void>;
  reconcile: () => void;
  applyServerChanged: () => void;
  reset: () => void;
}

export const useAliasesStore = create<AliasesState>((set, get) => ({
  aliases: [],
  loaded: false,
  loading: false,
  error: '',

  find: (verb) => {
    const name = verb.replace(/^\//, '').toLowerCase();
    return get().aliases.find((a) => a.name === name);
  },

  fetchAll: () => {
    if (inflight) {
      stale = true;
      return inflight;
    }
    set({ loading: true, error: '' });
    const mine = session;
    const run = (async () => {
      try {
        do {
          stale = false;
          const { aliases } = await api<{ aliases?: Alias[] }>('/api/aliases');
          if (mine !== session) return;
          set({ aliases: aliases || [], loaded: true });
        } while (stale);
      } catch (e: any) {
        if (mine === session) {
          set({ error: e?.message || 'failed to load aliases' });
        }
        throw e;
      } finally {
        if (mine === session) {
          set({ loading: false });
          inflight = null;
        }
      }
    })();
    inflight = run;
    return run;
  },

  settled: () => {
    return get().loaded || !inflight ? Promise.resolve() : inflight.catch(() => {});
  },

  load: (attempt = 0) => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    get()
      .fetchAll()
      .catch(() => {
        const wait = RETRY_AFTER_MS[attempt];
        if (get().loaded || wait === undefined || retryTimer) return;
        retryTimer = setTimeout(() => get().load(attempt + 1), wait);
      });
  },

  set: async (name, body) => {
    const { alias, created } = await api<{ alias: Alias; created: boolean }>(path(name), {
      method: 'PUT',
      body: { body },
    });
    set((s) => ({
      aliases: [...s.aliases.filter((a) => a.name !== alias.name), alias].sort(byName),
    }));
    get().reconcile();
    return { alias, created };
  },

  update: async (name, fields) => {
    const { alias } = await api<{ alias: Alias }>(path(name), { method: 'PATCH', body: fields });
    set((s) => ({
      aliases: [...s.aliases.filter((a) => a.name !== name && a.name !== alias.name), alias].sort(
        byName,
      ),
    }));
    get().reconcile();
    return alias;
  },

  remove: async (name) => {
    await api(path(name), { method: 'DELETE' });
    set((s) => ({ aliases: s.aliases.filter((a) => a.name !== name) }));
    get().reconcile();
  },

  reconcile: () => {
    get()
      .fetchAll()
      .catch(() => {});
  },

  applyServerChanged: () => {
    get()
      .fetchAll()
      .catch(() => {});
  },

  reset: () => {
    session += 1;
    inflight = null;
    stale = false;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    set({ aliases: [], loaded: false, loading: false, error: '' });
  },
}));
