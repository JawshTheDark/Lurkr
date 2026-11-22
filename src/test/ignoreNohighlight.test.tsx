// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IgnoreModal } from '../components/IgnoreModal';
import { MemberList } from '../components/MemberList';
import { MessageList } from '../components/MessageList';
import { dispatchSlashCommand } from '../lib/commands/dispatch';
import { notifyForEvent } from '../services/notifier';
import { registerSocketSenders } from '../services/socketBus';
import { useBuffersStore } from '../stores/buffers';
import { useChannelNotifyStore } from '../stores/channelNotify';
import { useIgnoresStore } from '../stores/ignores';
import { useNetworksStore } from '../stores/networks';
import { useRelayBotsStore } from '../stores/relayBots';
import { useSettingsStore } from '../stores/settings';
import { useToastsStore } from '../stores/toasts';
import { SettingsView } from '../views/SettingsView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('NOHIGHLIGHT ignore option & runtime enforcement', () => {
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

    useNetworksStore.getState().reset();
    useBuffersStore.getState().reset();
    useIgnoresStore.getState().reset();
    useChannelNotifyStore.getState().reset();
    useToastsStore.setState({ items: [] });
    useSettingsStore.setState({
      values: {
        'notifications.sound.enabled': false,
        'notifications.desktop.enabled': false,
      },
    } as any);

    useNetworksStore.setState({
      networks: [{ id: 1, name: 'TestNet', host: 'irc.example.net', port: 6697, nick: 'Jawsh', tls: true }],
      states: {
        1: { networkId: 1, channels: ['#lobby'], state: 'connected', nick: 'Jawsh', userModes: 'i' },
      },
    });
    useBuffersStore.getState().ensure(1, '#lobby', 10);
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    container.remove();
  });

  it('creates a NOHIGHLIGHT-only rule when ALL is toggled off and preserves it across edit', () => {
    root = createRoot(container);
    act(() => {
      root!.render(
        React.createElement(IgnoreModal, {
          open: true,
          networkId: null,
          onClose: () => {},
        }),
      );
    });

    const maskInput = container.querySelector('input[aria-label="Ignore mask"]') as HTMLInputElement;
    const allChip = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'ALL',
    )!;
    const noHlCheckbox = container.querySelector(
      '[data-testid="ignore-nohighlight-checkbox"]',
    ) as HTMLInputElement;

    expect(noHlCheckbox).not.toBeNull();
    expect(allChip.getAttribute('aria-pressed')).toBe('true');

    act(() => {
      setInputValue(maskInput, 'bob');
      allChip.click();
      noHlCheckbox.click();
    });

    expect(allChip.getAttribute('aria-pressed')).toBe('false');
    expect(noHlCheckbox.checked).toBe(true);

    const form = maskInput.closest('form')!;
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(sent).toContainEqual({
      type: 'add-ignore',
      networkId: null,
      mask: 'bob',
      channels: null,
      pattern: null,
      patternKind: 'substr',
      levels: ['NOHIGHLIGHT'],
      isExcept: false,
      expiresAt: null,
    });

    // Seed saved rule and verify Edit round-trip does NOT silently add ALL
    act(() => {
      useIgnoresStore.setState({
        global: [
          {
            id: 42,
            mask: 'bob',
            channels: null,
            pattern: null,
            patternKind: 'substr',
            levels: ['NOHIGHLIGHT'],
            isExcept: false,
            expiresAt: null,
            createdAt: '2026-11-21T00:00:00Z',
          },
        ],
      });
    });

    const editBtn = container.querySelector('button[aria-label="Edit ignore rule"]') as HTMLButtonElement;
    act(() => {
      editBtn.click();
    });

    expect(allChip.getAttribute('aria-pressed')).toBe('false');
    expect(noHlCheckbox.checked).toBe(true);

    sent = [];
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(sent).toEqual([
      { type: 'remove-ignore', networkId: null, id: 42 },
      {
        type: 'add-ignore',
        networkId: null,
        mask: 'bob',
        channels: null,
        pattern: null,
        patternKind: 'substr',
        levels: ['NOHIGHLIGHT'],
        isExcept: false,
        expiresAt: null,
      },
    ]);
  });

  it('refuses unscoped NOHIGHLIGHT-only rule and shows Ignores in SettingsView', () => {
    root = createRoot(container);
    act(() => {
      root!.render(
        React.createElement(MemoryRouter, null, React.createElement(SettingsView)),
      );
    });

    const navBtn = Array.from(container.querySelectorAll('nav button')).find((b) =>
      b.textContent?.includes('Ignore Rules'),
    ) as HTMLButtonElement;
    expect(navBtn).toBeDefined();
    act(() => {
      navBtn.click();
    });

    const noHlCheckbox = container.querySelector(
      '[data-testid="ignore-nohighlight-checkbox"]',
    ) as HTMLInputElement;
    const allChip = Array.from(container.querySelectorAll('main button')).find(
      (b) => b.textContent?.trim() === 'ALL',
    ) as HTMLButtonElement;
    const form = noHlCheckbox.closest('form')!;

    act(() => {
      allChip.click();
      noHlCheckbox.click();
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(sent).toEqual([]);
    expect(container.textContent).toContain('silence every highlight');
  });

  it('supports /ignore <nick> NOHIGHLIGHT and -network via dispatchSlashCommand', async () => {
    await act(async () => {
      await dispatchSlashCommand('/ignore bob NOHIGHLIGHT', 1, '#lobby');
      await dispatchSlashCommand('/ignore -network -time 1h alice NOHILIGHT', 1, '#lobby');
    });

    expect(sent[0]).toMatchObject({
      type: 'add-ignore',
      networkId: null,
      mask: 'bob',
      levels: ['NOHIGHLIGHT'],
    });
    expect(sent[1]).toMatchObject({
      type: 'add-ignore',
      networkId: 1,
      mask: 'alice',
      levels: ['NOHIGHLIGHT'],
    });
    expect(typeof sent[1].expiresAt).toBe('string');
  });

  it('suppresses highlight tint in MessageList and highlight notifications in notifier for NOHIGHLIGHT', () => {
    const buf = useBuffersStore.getState().ensure(1, '#lobby', 10);
    buf.messages = [
      {
        id: 101,
        networkId: 1,
        target: '#lobby',
        type: 'message',
        nick: 'bob',
        matched: true,
        text: 'hey Jawsh look at this',
        time: '2026-11-21T12:00:00Z',
      },
    ];

    root = createRoot(container);
    act(() => {
      root!.render(
        React.createElement(MessageList, {
          buffer: buf,
          onOpenReactionPicker: () => {},
        }),
      );
    });

    expect(container.querySelectorAll('.msg-highlight').length).toBe(1);

    // Enable NOHIGHLIGHT rule for bob -> message stays visible, highlight tint disappears
    act(() => {
      useIgnoresStore.setState({
        global: [
          {
            id: 7,
            mask: 'bob',
            channels: null,
            pattern: null,
            patternKind: 'substr',
            levels: ['NOHIGHLIGHT'],
            isExcept: false,
            expiresAt: null,
            createdAt: '2026-11-21T00:00:00Z',
          },
        ],
      });
    });

    expect(container.textContent).toContain('hey Jawsh look at this');
    expect(container.querySelectorAll('.msg-highlight').length).toBe(0);

    // Highlight toast notification is also suppressed for NOHIGHLIGHT sender, allowed for others
    notifyForEvent({
      id: 102,
      networkId: 1,
      target: '#lobby',
      type: 'message',
      nick: 'bob',
      matched: true,
      text: 'hey Jawsh ping',
    });
    expect(useToastsStore.getState().items.length).toBe(0);

    notifyForEvent({
      id: 103,
      networkId: 1,
      target: '#lobby',
      type: 'message',
      nick: 'carol',
      matched: true,
      text: 'hey Jawsh real ping',
    });
    expect(useToastsStore.getState().items.length).toBe(1);
  });

  it('auto-clears ALL when checking NOHIGHLIGHT directly so relay bots are not added as ALL+NOHIGHLIGHT', () => {
    root = createRoot(container);
    act(() => {
      root!.render(
        React.createElement(MemoryRouter, null, React.createElement(SettingsView)),
      );
    });

    const navBtn = Array.from(container.querySelectorAll('nav button')).find((b) =>
      b.textContent?.includes('Ignore Rules'),
    ) as HTMLButtonElement;
    act(() => {
      navBtn.click();
    });

    const maskInput = container.querySelector('input[aria-label="Ignore mask"]') as HTMLInputElement;
    const noHlCheckbox = container.querySelector(
      '[data-testid="ignore-nohighlight-checkbox"]',
    ) as HTMLInputElement;
    const allChip = Array.from(container.querySelectorAll('main button')).find(
      (b) => b.textContent?.trim() === 'ALL',
    ) as HTMLButtonElement;
    const form = maskInput.closest('form')!;

    expect(allChip.getAttribute('aria-pressed')).toBe('true');

    // Checking NOHIGHLIGHT without clicking ALL first must auto-clear ALL
    act(() => {
      setInputValue(maskInput, 'LurkerBot');
      noHlCheckbox.click();
    });

    expect(noHlCheckbox.checked).toBe(true);
    expect(allChip.getAttribute('aria-pressed')).toBe('false');

    // Unchecking NOHIGHLIGHT with no level chips selected restores ALL
    act(() => {
      noHlCheckbox.click();
    });
    expect(allChip.getAttribute('aria-pressed')).toBe('true');

    // Re-checking NOHIGHLIGHT clears ALL again; submitting sends ['NOHIGHLIGHT'] only
    act(() => {
      noHlCheckbox.click();
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(sent).toContainEqual({
      type: 'add-ignore',
      networkId: null,
      mask: 'LurkerBot',
      channels: null,
      pattern: null,
      patternKind: 'substr',
      levels: ['NOHIGHLIGHT'],
      isExcept: false,
      expiresAt: null,
    });
  });

  it('keeps relay bots visible in MemberList under NOHIGHLIGHT, hides under ALL+NOHIGHLIGHT, matches full userhost, and never hides self nick', () => {
    useRelayBotsStore.getState().reset();
    try {
      useNetworksStore.setState({
        networks: [{ id: 1, name: 'LurkerNet', host: 'irc.example', port: 6697, nick: 'Jawsh', tls: true }],
        states: {
          1: { networkId: 1, channels: ['#lobby'], state: 'connected', nick: 'Jawsh' },
        },
        activeKey: '1::#lobby',
      });
      useBuffersStore.getState().ensure(1, '#lobby', 10);
      useBuffersStore.getState().setMembers(1, '#lobby', [
        { nick: 'LurkerBot', user: 'relay', host: 'bot.example', modes: ['v'], away: false },
        { nick: 'Jawsh', user: 'jawsh', host: 'self.example', modes: [], away: false },
        { nick: 'Troll', user: 'troll', host: 'bad.example', modes: [], away: false },
      ]);
      useRelayBotsStore.getState().applySnapshot([
        { networkId: 1, relayBots: [{ nick: 'LurkerBot', pattern: '' }] },
      ]);

      useIgnoresStore.setState({
        global: [
          {
            id: 1,
            mask: 'LurkerBot',
            channels: null,
            pattern: null,
            patternKind: 'substr',
            levels: ['NOHIGHLIGHT'],
            isExcept: false,
            expiresAt: null,
            createdAt: '2026-11-21T00:00:00Z',
          },
          {
            id: 2,
            mask: 'Troll!*@bad.example',
            channels: null,
            pattern: null,
            patternKind: 'substr',
            levels: ['ALL'],
            isExcept: false,
            expiresAt: null,
            createdAt: '2026-11-21T00:00:00Z',
          },
          {
            id: 3,
            mask: '*!*@self.example',
            channels: null,
            pattern: null,
            patternKind: 'substr',
            levels: ['ALL'],
            isExcept: false,
            expiresAt: null,
            createdAt: '2026-11-21T00:00:00Z',
          },
        ],
      });

      root = createRoot(container);
      act(() => {
        root!.render(React.createElement(MemberList, { networkId: 1, target: '#lobby' }));
      });

      // Relay bot under NOHIGHLIGHT-only stays visible with its relay badge;
      // Troll!*@bad.example matches full nick!user@host; self nick Jawsh stays visible.
      expect(container.textContent).toContain('LurkerBot');
      expect(container.querySelector('[data-testid="member-relay-badge"]')?.textContent).toBe('relay');
      expect(container.textContent).not.toContain('Troll');
      expect(container.textContent).toContain('Jawsh');

      // An accidental ALL + NOHIGHLIGHT rule hides the relay bot from MemberList
      act(() => {
        useIgnoresStore.setState({
          global: [
            {
              id: 1,
              mask: 'LurkerBot',
              channels: null,
              pattern: null,
              patternKind: 'substr',
              levels: ['ALL', 'NOHIGHLIGHT'],
              isExcept: false,
              expiresAt: null,
              createdAt: '2026-11-21T00:00:00Z',
            },
          ],
        });
      });

      expect(container.textContent).not.toContain('LurkerBot');
    } finally {
      useRelayBotsStore.getState().reset();
    }
  });
});
