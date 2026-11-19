// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

const resetCallbacks = new Set<() => void>();

export function registerSessionReset(cb: () => void): () => void {
  resetCallbacks.add(cb);
  return () => resetCallbacks.delete(cb);
}

export function resetSession(): void {
  for (const cb of resetCallbacks) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}
