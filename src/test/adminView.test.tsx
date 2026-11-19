// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AdminView } from '../views/AdminView';
import { useAdminStore } from '../stores/admin';
import { useAuthStore } from '../stores/auth';
import { useConfigStore } from '../stores/config';
import * as apiModule from '../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('AdminView & useAdminStore', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    useAdminStore.getState().reset();
    useConfigStore.setState({
      edition: 'standalone',
      features: { linkPreviews: true, bouncer: true, dcc: true },
      checked: true,
    });
    useAuthStore.setState({
      user: { id: 1, username: 'jawsh', role: 'admin' },
      checked: true,
    });
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    container.remove();
    vi.restoreAllMocks();
  });

  it('renders users, invites, uploaders, networks, lockouts, storage, notifications, general, and dcc using real server schemas', async () => {
    const spy = vi.spyOn(apiModule, 'api').mockImplementation(async (url: string) => {
      if (url === '/api/admin/users') {
        return {
          users: [
            {
              id: 1,
              username: 'jawsh',
              role: 'admin',
              createdAt: '2026-01-01T00:00:00.000Z',
              lastSeenAt: '2026-11-18T12:00:00.000Z',
              isPaused: false,
              ident: null,
              effectiveIdent: 'jawsh',
              identConflict: false,
              restrictions: { networks: null, uploads: true },
              recoveryExpiresAt: null,
            },
            {
              id: 2,
              username: 'guest',
              role: 'user',
              createdAt: '2026-02-01T00:00:00.000Z',
              lastSeenAt: null,
              isPaused: true,
              ident: 'g1',
              effectiveIdent: 'g1',
              identConflict: true,
              restrictions: { networks: ['irc.libera.chat'], uploads: false },
              recoveryExpiresAt: '2026-11-19T00:00:00.000Z',
            },
          ],
          ident: { status: 'on', host: 'server' },
        };
      }
      if (url === '/api/admin/invites') {
        return {
          invites: [
            {
              token: 'tok-123',
              url: 'https://lurker.example/invite/tok-123',
              status: 'consumed',
              createdAt: '2026-11-01T00:00:00.000Z',
              expiresAt: '2026-11-08T00:00:00.000Z',
              usedAt: '2026-11-02T00:00:00.000Z',
              usedByUsername: 'guest',
              restrictions: { networks: null, uploads: true },
            },
          ],
        };
      }
      if (url === '/api/admin/uploaders') {
        return {
          uploaders: [
            {
              id: 10,
              driver: 'local',
              label: 'Local Disk',
              scope: 'instance',
              enabled: true,
              offeredToUsers: true,
              locked: false,
              isDefault: true,
              builtIn: true,
              config: {},
              secretsSet: {},
            },
          ],
          drivers: [
            { driver: 'local', label: 'Local Disk', configSchema: [], creatable: false },
          ],
          allowUserDefined: true,
          managed: false,
          maxUploadMb: 200,
        };
      }
      if (url === '/api/admin/networks') {
        return {
          presets: [
            {
              id: 5,
              name: 'Libera.Chat',
              host: 'irc.libera.chat',
              port: 6697,
              tls: true,
              saslLikelyRequired: false,
              channels: ['#lurker'],
              tags: ['oss'],
              users: 40000,
              channelCount: 20000,
              enabled: true,
              position: 0,
            },
          ],
          allowUserDefined: false,
        };
      }
      if (url === '/api/admin/push') {
        return {
          publicKey: 'PUBKEY',
          vapidSubject: { subject: 'mailto:admin@lurker.example', appleAccepts: true, ignored: null },
          transports: ['webpush'],
          relay: { url: 'https://push.lurker.chat', enabled: false, devices: 0, status: null },
        };
      }
      if (url === '/api/admin/presence') return { presence: [] };
      if (url === '/api/admin/push/log') return { log: [] };
      if (url.startsWith('/api/admin/storage')) {
        return {
          generatedAt: '2026-11-18T12:00:00.000Z',
          approxBytesPerRow: 256,
          database: { fileBytes: 2048, walBytes: 512, reclaimableBytes: 0 },
          ceilings: {
            maxLines: 50000,
            maxLinesState: 'set',
            maxEventHours: 168,
            maxEventHoursState: 'set',
            maxClosedBufferDays: null,
            maxClosedBufferDaysState: 'none',
          },
          users: [{ id: 1, username: 'jawsh', messageRows: 100, buffers: 3 }],
        };
      }
      if (url === '/api/admin/login-lockouts') {
        return {
          lockouts: [
            {
              source: 'bouncer',
              address: '203.0.113.9',
              retryAfter: 600,
              liftsAt: '2026-11-18T13:00:00.000Z',
            },
          ],
          policy: { maxFailures: 10, windowMinutes: 15, backoffMinutes: 15 },
        };
      }
      if (url === '/api/admin/general') return { jitsiUrl: 'https://meet.example' };
      if (url === '/api/admin/dcc') {
        return {
          enabled: true,
          directory: '/data/dcc',
          maxFileBytes: 104857600,
          allowPrivateHosts: false,
          freeDiskFloorBytes: 536870912,
          users: [
            {
              id: 1,
              username: 'jawsh',
              chat: true,
              receive: true,
              send: false,
              limitBytes: null,
              usedBytes: 1024,
            },
          ],
        };
      }
      return {};
    });

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(MemoryRouter, {}, React.createElement(AdminView)),
      );
      await flush();
    });

    // Users tab: real fields rendered, no fake Networks: 0
    expect(container.textContent).toContain('jawsh');
    expect(container.textContent).toContain('guest');
    expect(container.textContent).toContain('paused');
    expect(container.textContent).toContain('duplicate ident');
    expect(container.textContent).toContain('ident g1');
    expect(container.textContent).toContain('recovery pending');
    expect(container.textContent).not.toContain('Networks: 0');

    const clickTab = async (labelPrefix: string) => {
      const btn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.trim().startsWith(labelPrefix),
      );
      expect(btn).toBeTruthy();
      await act(async () => {
        btn!.click();
        await flush();
      });
    };

    await clickTab('Invites');
    expect(container.textContent).toContain('https://lurker.example/invite/tok-123');
    expect(container.textContent).toContain('joined as guest');
    expect(container.textContent).toContain('consumed');

    await clickTab('Uploaders');
    expect(container.textContent).toContain('Local Disk');
    expect(container.textContent).toContain('default');
    expect((container.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('200');

    await clickTab('Networks');
    expect(container.textContent).toContain('Libera.Chat');
    expect(container.textContent).toContain('irc.libera.chat:6697');
    expect(container.textContent).toContain('#lurker');

    await clickTab('Notifications');
    expect(container.textContent).toContain('PUBKEY');
    expect(container.textContent).toContain('Nobody is connected.');
    expect(container.textContent).toContain('Nothing in the last week.');

    await clickTab('Storage');
    expect(container.textContent).toContain('2.0 KB');
    expect(container.textContent).toContain('100 lines');

    await clickTab('Lockouts');
    expect(container.textContent).toContain('203.0.113.9');
    expect(container.textContent).toContain('bouncer');
    expect(container.textContent).toContain('10 failed logins');

    await clickTab('General');
    expect((container.querySelector('input[type="url"]') as HTMLInputElement).value).toBe(
      'https://meet.example',
    );

    await clickTab('DCC');
    expect(container.textContent).toContain('/data/dcc');
    expect(container.textContent).toContain('Chat: on');

    expect(spy).toHaveBeenCalled();
  });

  it('shows explicit empty states when lists are empty instead of blank containers', async () => {
    vi.spyOn(apiModule, 'api').mockImplementation(async (url: string) => {
      if (url === '/api/admin/users') return { users: [], ident: { status: 'off', host: 'server' } };
      if (url === '/api/admin/invites') return { invites: [] };
      if (url === '/api/admin/uploaders') {
        return { uploaders: [], drivers: [], allowUserDefined: true, managed: false, maxUploadMb: 200 };
      }
      if (url === '/api/admin/networks') return { presets: [], allowUserDefined: true };
      if (url === '/api/admin/login-lockouts') return { lockouts: [], policy: null };
      return {};
    });

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(MemoryRouter, {}, React.createElement(AdminView)),
      );
      await flush();
    });
    expect(container.textContent).toContain('No users.');

    const clickTab = async (name: string) => {
      const btn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.trim().startsWith(name),
      );
      await act(async () => {
        btn!.click();
        await flush();
      });
    };

    await clickTab('Invites');
    expect(container.textContent).toContain('No invites yet.');

    await clickTab('Uploaders');
    expect(container.textContent).toContain('No instance uploaders configured.');

    await clickTab('Networks');
    expect(container.textContent).toContain('No networks listed');

    await clickTab('Lockouts');
    expect(container.textContent).toContain('No addresses are locked out.');
  });
});
