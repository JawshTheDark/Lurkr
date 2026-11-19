// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { api } from '../api';
import { compileRules, matchEvent } from '../utils/highlightMatch';

export interface HighlightRule {
  id: number;
  enabled: boolean;
  pattern: string | null;
  mask?: string | null;
  channels?: string[] | null;
  kind: string;
  case_sensitive: boolean;
  createdAt?: string;
}

interface HighlightRulesState {
  rules: HighlightRule[];
  loaded: boolean;
  fetchAll: () => Promise<void>;
  create: (rule: Partial<HighlightRule>) => Promise<HighlightRule>;
  update: (id: number, patch: Partial<HighlightRule>) => Promise<HighlightRule>;
  remove: (id: number) => Promise<void>;
  matches: (input: {
    text: string;
    nick?: string | null;
    networkId?: number | null;
    channel?: string | null;
  }) => boolean;
  reset: () => void;
}

export const useHighlightRulesStore = create<HighlightRulesState>((set, get) => ({
  rules: [],
  loaded: false,
  fetchAll: async () => {
    const { rules } = await api('/api/highlight-rules');
    set({ rules: rules || [], loaded: true });
  },
  create: async (rule) => {
    const { rule: created } = await api('/api/highlight-rules', { method: 'POST', body: rule });
    set((s) => ({ rules: [...s.rules, created] }));
    return created;
  },
  update: async (id, patch) => {
    const { rule: updated } = await api(`/api/highlight-rules/${id}`, {
      method: 'PATCH',
      body: patch,
    });
    set((s) => ({ rules: s.rules.map((r) => (r.id === id ? updated : r)) }));
    return updated;
  },
  remove: async (id) => {
    await api(`/api/highlight-rules/${id}`, { method: 'DELETE' });
    set((s) => ({ rules: s.rules.filter((r) => r.id !== id) }));
  },
  matches: (input) => {
    const compiled = compileRules(get().rules);
    return matchEvent(
      {
        type: 'message',
        nick: input.nick ?? null,
        target: input.channel ?? '',
        text: input.text,
      },
      compiled,
    ).matched;
  },
  reset: () => set({ rules: [], loaded: false }),
}));
