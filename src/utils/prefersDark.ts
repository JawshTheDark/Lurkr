// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { useSyncExternalStore } from 'react';

const query =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

let current = query ? query.matches : true;
const listeners = new Set<() => void>();

query?.addEventListener('change', (e) => {
  current = e.matches;
  for (const l of listeners) l();
});

export function getPrefersDark(): boolean {
  return current;
}

export function subscribePrefersDark(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrefersDark(): boolean {
  return useSyncExternalStore(subscribePrefersDark, getPrefersDark, () => true);
}
