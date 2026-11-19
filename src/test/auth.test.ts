// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAuthStore } from '../stores/auth';
import { setServerUrl } from '../api';

describe('useAuthStore.fetchMe', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    setServerUrl('http://localhost:3000');
    useAuthStore.setState({
      user: null,
      checked: false,
      error: null,
      setupStatus: null,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('marks auth checked and records error on network failure (does not hang on loading)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;

    const user = await useAuthStore.getState().fetchMe();

    expect(user).toBeNull();
    const state = useAuthStore.getState();
    expect(state.checked).toBe(true);
    expect(state.user).toBeNull();
    expect(state.error).toBeTruthy();
  });

  it('marks auth checked with null user and null error on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const user = await useAuthStore.getState().fetchMe();

    expect(user).toBeNull();
    const state = useAuthStore.getState();
    expect(state.checked).toBe(true);
    expect(state.user).toBeNull();
    expect(state.error).toBeNull();
  });

  it('populates user and marks auth checked on 200', async () => {
    const mockUser = { id: 1, username: 'alice', role: 'admin' as const };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: mockUser }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const user = await useAuthStore.getState().fetchMe();

    expect(user).toEqual(mockUser);
    const state = useAuthStore.getState();
    expect(state.checked).toBe(true);
    expect(state.user).toEqual(mockUser);
    expect(state.error).toBeNull();
  });
});
