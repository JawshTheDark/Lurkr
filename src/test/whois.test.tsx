// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WhoisModal } from '../components/WhoisModal';
import { useBuffersStore } from '../stores/buffers';
import { useIgnoresStore } from '../stores/ignores';
import { useNetworksStore } from '../stores/networks';
import { useNickNotesStore } from '../stores/nickNotes';
import { useRelayBotsStore } from '../stores/relayBots';
import { useWhoisStore } from '../stores/whois';
import { registerSocketSenders } from '../services/socketBus';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('WHOIS store & modal', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let sent: Record<string, unknown>[];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    sent = [];
    registerSocketSenders(
      (payload) => {
        sent.push(payload);
        return true;
      },
      async () => ({ ok: true }),
    );
    useWhoisStore.getState().reset();
    useNetworksStore.getState().reset();
    useBuffersStore.getState().reset();
    useNickNotesStore.getState().reset();
    useIgnoresStore.getState().reset();
    useRelayBotsStore.getState().reset();
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    container.remove();
    useWhoisStore.getState().reset();
    useNetworksStore.getState().reset();
    useBuffersStore.getState().reset();
    useNickNotesStore.getState().reset();
    useIgnoresStore.getState().reset();
    useRelayBotsStore.getState().reset();
  });

  it('sends raw WHOIS without DCC prefix and renders server whois_result wrapper safely', () => {
    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(WhoisModal));
    });

    act(() => {
      useWhoisStore.getState().request(1, '=Jawsh');
    });

    expect(sent).toEqual([{ type: 'raw', networkId: 1, line: 'WHOIS Jawsh' }]);
    expect(container.textContent).toContain('Querying WHOIS...');

    // Server emits irc-framework `whois_result` with nested `whois` object and space-separated channels string.
    act(() => {
      useWhoisStore.getState().applyResult({
        type: 'whois_result',
        networkId: 1,
        whois: {
          nick: 'Jawsh',
          ident: 'jawsh',
          hostname: 'dev.example.org',
          real_name: 'Jawsh Developer',
          actual_hostname: 'real.isp.net',
          actual_ip: '203.0.113.10',
          server: 'irc.lurker.net',
          server_info: 'Lurker IRCv3',
          channels: '@#opers +#lurker',
          account: 'Jawsh',
          operator: 'is an IRC Operator',
          secure: true,
          idle: 125,
          logon: 1700000000,
        },
      });
    });

    expect(container.textContent).not.toContain('Querying WHOIS...');
    expect(container.textContent).toContain('jawsh@dev.example.org');
    expect(container.textContent).toContain('Jawsh Developer');
    expect(container.textContent).toContain('real.isp.net / 203.0.113.10');
    expect(container.textContent).toContain('irc.lurker.net (Lurker IRCv3)');
    expect(container.textContent).toContain('@#opers');
    expect(container.textContent).toContain('+#lurker');
    expect(container.textContent).toContain('is an IRC Operator');
    expect(container.textContent).toContain('Secure TLS');
  });

  it('shows immediate error if socket is disconnected and handles not_found cleanly', () => {
    registerSocketSenders(
      () => false,
      async () => ({ ok: false }),
    );
    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(WhoisModal));
    });

    act(() => {
      useWhoisStore.getState().request(1, 'OfflineUser');
    });
    expect(container.textContent).toContain('Not connected to Lurker server');

    registerSocketSenders(
      (payload) => {
        sent.push(payload);
        return true;
      },
      async () => ({ ok: true }),
    );

    act(() => {
      useWhoisStore.getState().request(1, 'GhostNick');
      useWhoisStore.getState().applyResult({
        networkId: 1,
        nick: 'GhostNick',
        error: 'not_found',
      });
    });
    expect(container.textContent).toContain('GhostNick is not online');
  });

  it('renders full non-truncated hostmasks, IRCv3 metadata, extended WHOIS fields, and copy buttons', () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    useNetworksStore.setState({
      networks: [
        {
          id: 1,
          name: 'Libera.Chat',
          host: 'irc.libera.chat',
          port: 6697,
          nick: 'Jawsh',
          tls: true,
        },
      ],
    });
    useNetworksStore.getState().applySnapshot([
      {
        networkId: 1,
        channels: [],
        state: 'connected',
        nick: 'Jawsh',
      },
    ]);
    useNetworksStore.getState().applyUserMetadata(1, 'amiantos', {
      displayName: 'Brad Root',
      pronouns: 'he/him',
      status: 'Building Lurker',
      homepage: 'https://bradroot.me',
      avatarUrl: 'https://bradroot.me/avatar.png',
    });

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(WhoisModal));
      useWhoisStore.getState().request(1, 'amiantos');
      useWhoisStore.getState().applyResult({
        type: 'whois_result',
        networkId: 1,
        whois: {
          nick: 'amiantos',
          ident: 'lu1',
          hostname: 'lurker/mothership/amiantos',
          real_name: 'https://bradroot.me',
          server: 'lead.libera.chat',
          server_info: 'Budapest, HU',
          channels: ['@+#lurker', '#ai'],
          account: 'amiantos',
          registered_nick: 'has identified for this nick',
          modes: '+Riwxz',
          asn: 'AS13335',
          certfp: 'abcdef0123456789abcdef0123456789',
          away: 'Grabbing coffee',
          secure: true,
        },
      });
    });

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.className).toContain('max-w-2xl');
    expect(container.textContent).toContain('lu1@lurker/mothership/amiantos');
    expect(container.textContent).toContain('amiantos!lu1@lurker/mothership/amiantos');
    expect(container.textContent).toContain('Brad Root');
    expect(container.textContent).toContain('he/him');
    expect(container.textContent).toContain('Building Lurker');
    expect(container.textContent).toContain('AS13335');
    expect(container.textContent).toContain('+Riwxz');
    expect(container.textContent).toContain('abcdef0123456789abcdef0123456789');
    expect(container.textContent).toContain('Away: Grabbing coffee');
    expect(container.textContent).toContain('Registered Nick');
    expect(container.textContent).toContain('Libera.Chat');

    const img = container.querySelector('img[alt="amiantos"]') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe('https://bradroot.me/avatar.png');

    const copyUserHostBtn = container.querySelector('button[aria-label="Copy user@host"]') as HTMLButtonElement | null;
    expect(copyUserHostBtn).not.toBeNull();
    act(() => {
      copyUserHostBtn!.click();
    });
    expect(writeText).toHaveBeenCalledWith('lu1@lurker/mothership/amiantos');

    const channelBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '@+#lurker',
    ) as HTMLButtonElement | undefined;
    expect(channelBtn).toBeDefined();
    act(() => {
      channelBtn!.click();
    });
    expect(sent).toContainEqual({ type: 'join', networkId: 1, channel: '#lurker' });
    expect(useWhoisStore.getState().open).toBe(false);
  });

  it('supports inline personal notes, ignore toggling, and WHOIS caching across reopens', () => {
    useNetworksStore.setState({
      networks: [
        {
          id: 1,
          name: 'LurkerNet',
          host: 'irc.example.com',
          port: 6697,
          nick: 'Jawsh',
          tls: true,
        },
      ],
    });
    useNetworksStore.getState().applySnapshot([
      {
        networkId: 1,
        channels: [],
        state: 'connected',
        nick: 'Jawsh',
      },
    ]);

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(WhoisModal));
      useWhoisStore.getState().request(1, 'PeerNick');
      useWhoisStore.getState().applyResult({
        networkId: 1,
        whois: {
          nick: 'PeerNick',
          ident: 'peer',
          hostname: 'example.com',
          server: 'irc.example.com',
        },
      });
    });

    // Save personal note
    const addNoteBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Add Note'),
    ) as HTMLButtonElement;
    act(() => {
      addNoteBtn.click();
    });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(textarea, 'Helpful maintainer');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Save Note'),
    ) as HTMLButtonElement;
    act(() => {
      saveBtn.click();
    });
    expect(sent).toContainEqual({
      type: 'set-nick-note',
      networkId: 1,
      nick: 'PeerNick',
      note: 'Helpful maintainer',
    });

    act(() => {
      useNickNotesStore.getState().applyUpdate(1, 'PeerNick', 'Helpful maintainer');
    });
    expect(container.textContent).toContain('Helpful maintainer');

    // Ignore & Unignore
    const ignoreBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Ignore',
    ) as HTMLButtonElement;
    act(() => {
      ignoreBtn.click();
    });
    expect(sent).toContainEqual({
      type: 'add-ignore',
      networkId: 1,
      rule: {
        mask: 'PeerNick!*@*',
        channels: null,
        pattern: null,
        patternKind: 'substr',
        levels: ['ALL'],
        isExcept: false,
        expiresAt: null,
      },
    });

    act(() => {
      useIgnoresStore.getState().applyUpdate(1, [
        {
          id: 42,
          mask: 'PeerNick!*@*',
          levels: ['ALL'],
          channels: [],
          pattern: null,
          patternKind: 'substr',
          isExcept: false,
          expiresAt: null,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ]);
    });
    const unignoreBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Unignore',
    ) as HTMLButtonElement | undefined;
    expect(unignoreBtn).toBeDefined();
    act(() => {
      unignoreBtn!.click();
    });
    expect(sent).toContainEqual({ type: 'remove-ignore', networkId: 1, id: 42 });

    // Close and reopen -> cached result displays immediately alongside Refreshing indicator
    act(() => {
      useWhoisStore.getState().close();
      useWhoisStore.getState().request(1, 'PeerNick');
    });
    expect(container.textContent).toContain('peer@example.com');
    expect(container.textContent).toContain('Refreshing');

    // no_such_nick invalidates stale cache and renders offline message
    act(() => {
      useWhoisStore.getState().applyResult({
        networkId: 1,
        nick: 'PeerNick',
        error: 'no_such_nick',
      });
    });
    expect(container.textContent).toContain('PeerNick is not online');
  });
});
