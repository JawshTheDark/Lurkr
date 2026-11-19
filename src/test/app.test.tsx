// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { App } from '../App';
import { setServerUrl } from '../api';
import { useAuthStore } from '../stores/auth';
import { useBuffersStore } from '../stores/buffers';
import { useConfigStore } from '../stores/config';
import { useNetworksStore } from '../stores/networks';
import { resetSession } from '../stores/sessionReset';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

function makeMockDesktopBridge() {
  return {
    isElectron: true,
    platform: 'linux',
    getConfig: vi.fn(async () => ({
      serverUrl: 'http://localhost:3000',
      allowSelfSigned: false,
    })),
    setConfig: vi.fn(async (next: Partial<{ serverUrl: string; allowSelfSigned: boolean }>) => ({
      serverUrl: next.serverUrl || '',
      allowSelfSigned: !!next.allowSelfSigned,
    })),
    setBadge: vi.fn(async () => {}),
    notify: vi.fn(async () => {}),
    openExternal: vi.fn(async () => {}),
    onNavigate: vi.fn(() => () => {}),
  };
}

describe('App boot sequence', () => {
  const originalFetch = globalThis.fetch;
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.location.hash = '#/';
    setServerUrl('');
    resetSession();
    useAuthStore.setState({
      user: null,
      checked: false,
      error: null,
      setupStatus: null,
    });
    useConfigStore.setState({
      checked: false,
      edition: 'standalone',
      features: { linkPreviews: false, bouncer: false, dcc: false },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
    delete (window as unknown as { lurkerDesktop?: unknown }).lurkerDesktop;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('exits Loading Lurkr... and renders LoginView with server config when server is unreachable', async () => {
    window.lurkerDesktop = makeMockDesktopBridge();

    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;

    root = createRoot(container);
    await act(async () => {
      root!.render(React.createElement(App));
    });

    // Wait for async boot(), navigate, and LoginView effects to settle
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    const text = container.textContent ?? '';
    expect(text).not.toContain('Loading Lurkr...');
    expect(text).toContain('Sign in to your IRC bouncer');
    expect(text).toContain('Lurker Server URL');
  });

  it('transitions from LoginView into ChatView with active buffer and SettingsView without render crashes', async () => {
    window.lurkerDesktop = makeMockDesktopBridge();

    let loggedIn = false;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/config')) {
        return new Response(
          JSON.stringify({
            edition: 'standalone',
            features: { linkPreviews: false, bouncer: false, dcc: false },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/api/auth/setup-status')) {
        return new Response(JSON.stringify({ needsSetup: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/api/auth/login/password')) {
        loggedIn = true;
        return new Response(
          JSON.stringify({ user: { id: 1, username: 'alice', role: 'admin' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/api/auth/me')) {
        if (!loggedIn) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({ user: { id: 1, username: 'alice', role: 'admin' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/api/settings/bootstrap')) {
        return new Response(JSON.stringify({ values: {}, themes: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/api/networks')) {
        return new Response(
          JSON.stringify({
            networks: [
              { id: 1, name: 'Libera', host: 'irc.libera.chat', port: 6697, nick: 'alice', tls: true },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    root = createRoot(container);
    await act(async () => {
      root!.render(React.createElement(App));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(container.textContent).toContain('Sign in to your IRC bouncer');

    await act(async () => {
      await useAuthStore.getState().loginWithPassword({ username: 'alice', password: 'secret' });
      window.location.hash = '#/';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    expect(container.textContent).toContain('Select a channel or conversation');
    expect(container.textContent).not.toContain('Something went wrong');

    // Activate a channel buffer with messages and members to exercise MessageList/MessageInput/MemberList/StatusBar
    await act(async () => {
      useBuffersStore.getState().ensure(1, '#general', 10);
      useBuffersStore.getState().appendHistory(
        1,
        '#general',
        [
          {
            id: 1,
            networkId: 1,
            target: '#general',
            type: 'message',
            nick: 'bob',
            text: 'hello world',
            time: '2026-11-13T18:00:00.000Z',
          },
        ],
        false,
      );
      useBuffersStore.getState().setMembers(1, '#general', [
        { nick: 'alice', modes: ['o'], away: false },
        { nick: 'bob', modes: [], away: false },
      ]);
      useNetworksStore.getState().setActive(1, '#general');
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(container.textContent).toContain('#general');
    expect(container.textContent).toContain('hello world');
    expect(container.textContent).not.toContain('Something went wrong');

    // Navigate to SettingsView
    await act(async () => {
      window.location.hash = '#/settings';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(container.textContent).toContain('Settings');
    expect(container.textContent).not.toContain('Something went wrong');
  });
});
