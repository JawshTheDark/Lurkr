// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageList } from '../components/MessageList';
import { MemberList } from '../components/MemberList';
import { dispatchSlashCommand } from '../lib/commands/dispatch';
import { api } from '../api';
import * as socketBus from '../services/socketBus';
import { resetSession } from '../stores/sessionReset';
import { useAliasesStore } from '../stores/aliases';
import { useBuffersStore } from '../stores/buffers';
import { useConfigStore } from '../stores/config';
import { useNetworksStore } from '../stores/networks';
import { useRelayBotsStore } from '../stores/relayBots';
import { useSettingsStore } from '../stores/settings';
import { useUploadsStore } from '../stores/uploads';
import { useSearchStore } from '../stores/search';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

describe('Relay / Janus bots & Lurker 2.7 parity', () => {
  const origFetch = globalThis.fetch;
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    resetSession();
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
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it('unwraps EyeBridge / Janus relay messages in MessageList and toggles marks via context menu', async () => {
    const sendSpy = vi.spyOn(socketBus, 'socketSend').mockImplementation(() => true);

    useNetworksStore.setState({
      networks: [{ id: 1, name: 'LurkerNet', host: 'irc.example', port: 6697, nick: 'Jawsh', tls: true }],
      states: {
        1: { networkId: 1, channels: ['#lurker'], state: 'connected', nick: 'Jawsh' },
      },
      activeKey: '1::#lurker',
    });

    const bufs = useBuffersStore.getState();
    const buf = bufs.ensure(1, '#lurker');
    useBuffersStore.setState({
      buffers: {
        ...useBuffersStore.getState().buffers,
        '1::#lurker': {
          ...buf,
          joined: true,
          messages: [
            {
              id: 10,
              networkId: 1,
              target: '#lurker',
              type: 'message',
              nick: 'EyeBridge',
              text: '[libera] <Ascathon> nn amiantos',
              time: '2026-11-18T02:47:00.000Z',
            },
          ],
        },
      },
    });

    useRelayBotsStore.getState().applySnapshot([
      {
        networkId: 1,
        relayBots: [{ nick: 'EyeBridge', pattern: '' }],
      },
    ]);

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MessageList
          buffer={useBuffersStore.getState().buffers['1::#lurker']}
          onOpenReactionPicker={() => {}}
        />,
      );
    });

    expect(container.textContent).toContain('<Ascathon>');
    expect(container.textContent).toContain('[libera]');
    expect(container.textContent).toContain('nn amiantos');
    expect(container.textContent).not.toContain('<EyeBridge>');

    // Pending send queue rows render dimmed
    await act(async () => {
      useNetworksStore.getState().applySendPending({
        networkId: 1,
        pending: {
          id: 'p1',
          target: '#lurker',
          kind: 'privmsg',
          text: 'queued hello',
          at: '2026-11-18T02:48:00.000Z',
        },
      });
    });
    await act(async () => {
      root!.render(
        <MessageList
          buffer={useBuffersStore.getState().buffers['1::#lurker']}
          onOpenReactionPicker={() => {}}
        />,
      );
    });
    expect(container.textContent).toContain('queued hello');
    expect(container.textContent).toContain('sending…');

    await act(async () => {
      useNetworksStore.getState().applySendPendingDone({ networkId: 1, pendingId: 'p1' });
      useRelayBotsStore.getState().applyUpdate(1, 'EyeBridge', false, '');
    });
    await act(async () => {
      root!.render(
        <MessageList
          buffer={useBuffersStore.getState().buffers['1::#lurker']}
          onOpenReactionPicker={() => {}}
        />,
      );
    });

    expect(container.textContent).toContain('<EyeBridge>');
    expect(container.textContent).not.toContain('queued hello');

    // Sending relay update emits 2.7 `set-relay-bot` wire schema
    useRelayBotsStore.getState().setRelay(1, 'EyeBridge', true);
    expect(sendSpy).toHaveBeenCalledWith({
      type: 'set-relay-bot',
      networkId: 1,
      nick: 'EyeBridge',
      marked: true,
      pattern: '',
    });
  });

  it('supports /relay, /alias + expansion, /say, /jitsi, and CAP-gated /rename', async () => {
    const sendSpy = vi.spyOn(socketBus, 'socketSend').mockImplementation(() => true);
    const ackSpy = vi.spyOn(socketBus, 'socketSendWithAck').mockResolvedValue({ ok: true });

    useNetworksStore.setState({
      networks: [{ id: 1, name: 'TestNet', host: 'irc.example', port: 6697, nick: 'Jawsh', tls: true }],
      states: {
        1: { networkId: 1, channels: ['#lobby'], state: 'connected', nick: 'Jawsh' },
      },
      profiles: {
        1: {
          ircd: 'ergo',
          ircdVersion: '2.15',
          services: 'ergo',
          negotiatedCaps: ['draft/channel-rename'],
          capsKnown: true,
          isupport: {},
          isupportKnown: true,
          availableUserModes: '',
          availableChanModes: '',
          availableModesKnown: false,
          snomask: '',
          operClass: null,
          operCapabilities: [],
          operCapabilitiesKnown: false,
          unsupportedCommands: [],
          absentServices: [],
          observedServices: [],
          roleplayEnabled: false,
          detectedAt: Date.now(),
        },
      },
    });
    useBuffersStore.getState().ensure(1, '#lobby');
    useConfigStore.getState().setJitsiUrl('https://meet.example.org');

    // /relay add
    await dispatchSlashCommand('/relay add EyeBridge', 1, '#lobby');
    expect(sendSpy).toHaveBeenCalledWith({
      type: 'set-relay-bot',
      networkId: 1,
      nick: 'EyeBridge',
      marked: true,
      pattern: '',
    });

    // /jitsi using instance jitsiUrl
    await dispatchSlashCommand('/jitsi standup', 1, '#lobby');
    expect(ackSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'send',
        networkId: 1,
        target: '#lobby',
        text: 'https://meet.example.org/lurker-standup',
      }),
    );

    // /rename with draft/channel-rename CAP
    await dispatchSlashCommand('/rename #newroom topic shift', 1, '#lobby');
    expect(ackSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'raw',
        networkId: 1,
        line: 'RENAME #lobby #newroom :topic shift',
      }),
    );

    // User alias expansion (/greet Bob -> /say hello Bob in #lobby)
    useAliasesStore.setState({
      aliases: [{ name: 'greet', body: '/say hello $1 in $channel' }],
      loaded: true,
    });
    await dispatchSlashCommand('/greet Bob', 1, '#lobby');
    expect(ackSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'send',
        networkId: 1,
        target: '#lobby',
        text: 'hello Bob in #lobby',
      }),
    );
  });

  it('handles 2.7 REST search { items, nextBefore }, peerAccounts, thumbnails, and layout renames', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/api/search')) {
        expect(url).toContain('q=hello');
        expect(url).toContain('nick=alice');
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 55,
                networkId: 1,
                target: '#lurker',
                nick: 'alice',
                text: 'hello 2.7',
                time: '2026-11-18T10:00:00.000Z',
              },
            ],
            nextBefore: 54,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    await useSearchStore.getState().search({ query: 'from:alice hello' });
    const searchSt = useSearchStore.getState();
    expect(searchSt.results).toHaveLength(1);
    expect(searchSt.results[0].text).toBe('hello 2.7');
    expect(searchSt.hasMore).toBe(true);
    expect(searchSt.nextBefore).toBe(54);

    // peer-account tracking
    useNetworksStore.getState().applyState({ networkId: 1, state: 'connected' });
    useNetworksStore.getState().applyPeerAccount(1, 'Bob', 'bob_acct');
    expect(useNetworksStore.getState().peerAccountFor(1, 'bob')).toBe('bob_acct');

    // late upload thumbnail frame
    useUploadsStore.setState({
      recent: [{ id: 9, url: '/u/clip.mp4', filename: 'clip.mp4', mime: 'video/mp4' }],
    });
    useUploadsStore.getState().applyThumbnail({ uploadId: 9, thumbnail_url: '/api/uploads/9/thumb' });
    expect(useUploadsStore.getState().recent[0].thumbnail_url).toBe('/api/uploads/9/thumb');

    // Settings key rename compatibility
    useSettingsStore.setState({
      values: { 'look.message.modern.group_gap': 4, 'look.message.layout': 'traditional' },
    });
    expect(useSettingsStore.getState().effective('look.message.compact.group_gap')).toBe(4);
    expect(useSettingsStore.getState().effective('look.message.layout')).toBe('traditional');
    void api;
  });

  it('positions the relay badge a clean gap after the nick instead of stretching to the far right edge', async () => {
    useNetworksStore.setState({
      networks: [{ id: 1, name: 'LurkerNet', host: 'irc.example', port: 6697, nick: 'Jawsh', tls: true }],
      states: {
        1: { networkId: 1, channels: ['#lurker'], state: 'connected', nick: 'Jawsh' },
      },
      activeKey: '1::#lurker',
    });
    useBuffersStore.getState().ensure(1, '#lurker');
    useBuffersStore.getState().setMembers(1, '#lurker', [
      { nick: 'LurkerBot', modes: ['v'], away: false },
    ]);
    useRelayBotsStore.getState().applySnapshot([
      { networkId: 1, relayBots: [{ nick: 'LurkerBot', pattern: '' }] },
    ]);

    root = createRoot(container);
    await act(async () => {
      root!.render(React.createElement(MemberList, { networkId: 1, target: '#lurker' }));
    });

    const badge = container.querySelector('[data-testid="member-relay-badge"]') as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('relay');
    expect(badge.style.marginLeft).toBe('6px');

    const nickEl = badge.previousElementSibling as HTMLElement;
    expect(nickEl.textContent).toBe('LurkerBot');
    expect(nickEl.style.flexGrow).toBe('0');
    expect(nickEl.style.flexShrink).toBe('1');
  });

  it('keeps MemberList filter box bounded with zero input padding, filters live, and clears via button or Escape', async () => {
    useNetworksStore.setState({
      networks: [{ id: 1, name: 'LurkerNet', host: 'irc.example', port: 6697, nick: 'Jawsh', tls: true }],
      states: {
        1: { networkId: 1, channels: ['#lurker', '#other'], state: 'connected', nick: 'Jawsh' },
      },
      activeKey: '1::#lurker',
    });
    useBuffersStore.getState().ensure(1, '#lurker');
    useBuffersStore.getState().ensure(1, '#other');
    useBuffersStore.getState().setMembers(1, '#lurker', [
      { nick: 'amiantos', modes: ['q'], away: false },
      { nick: 'Jawsh', modes: [], away: false },
      { nick: 'LurkerBot', modes: ['v'], away: false },
    ]);
    useBuffersStore.getState().setMembers(1, '#other', [
      { nick: 'alice', modes: [], away: false },
    ]);

    root = createRoot(container);
    await act(async () => {
      root!.render(React.createElement(MemberList, { networkId: 1, target: '#lurker' }));
    });

    const aside = container.querySelector('aside.member-list') as HTMLElement;
    expect(aside.style.width).toBe('100%');

    const filterBox = container.querySelector('[data-testid="member-filter-box"]') as HTMLElement;
    expect(filterBox.style.width).toBe('100%');
    expect(filterBox.style.minWidth).toMatch(/^0(px)?$/);

    const input = container.querySelector('input[aria-label="Filter members"]') as HTMLInputElement;
    expect(input.getAttribute('size')).toBe('1');
    expect(input.style.minWidth).toMatch(/^0(px)?$/);
    expect(input.style.padding).toMatch(/^0(px)?$/);
    expect(aside.textContent).toContain('3 members');

    const setValue = (val: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    await act(async () => {
      setValue('ami');
    });
    expect(aside.textContent).toContain('1 of 3 members');
    expect(aside.textContent).toContain('amiantos');
    expect(aside.textContent).not.toContain('Jawsh');

    const clearBtn = container.querySelector('button[aria-label="Clear member filter"]') as HTMLButtonElement;
    expect(clearBtn).not.toBeNull();
    await act(async () => {
      clearBtn.click();
    });
    expect(input.value).toBe('');
    expect(aside.textContent).toContain('3 members');

    await act(async () => {
      setValue('zzz');
    });
    expect(aside.textContent).toContain('0 of 3 members');
    expect(aside.textContent).toContain('No matching members');

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(input.value).toBe('');

    await act(async () => {
      setValue('jaw');
    });
    expect(input.value).toBe('jaw');
    await act(async () => {
      root!.render(React.createElement(MemberList, { networkId: 1, target: '#other' }));
    });
    expect(input.value).toBe('');
    expect(aside.textContent).toContain('1 member');
  });
});
