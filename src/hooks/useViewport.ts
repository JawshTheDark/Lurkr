// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { useSyncExternalStore } from 'react';

const MOBILE_MAX_PX = 767;
const query =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(`(max-width: ${MOBILE_MAX_PX}px)`)
    : null;

let currentMobile = query ? query.matches : false;
const listeners = new Set<() => void>();

query?.addEventListener('change', (e) => {
  currentMobile = e.matches;
  for (const l of listeners) l();
});

export function isMobileViewport(): boolean {
  return currentMobile;
}

export function subscribeViewport(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useViewport(): { isMobile: boolean } {
  const isMobile = useSyncExternalStore(subscribeViewport, isMobileViewport, () => false);
  return { isMobile };
}
