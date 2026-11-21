// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageInput } from '../components/MessageInput';
import { MessageList } from '../components/MessageList';
import { WhoisModal } from '../components/WhoisModal';
import { SettingsView } from '../views/SettingsView';
import { registerSocketSenders } from '../services/socketBus';
import { coerceSettingValue } from '../lib/commands/settings';
import { SLASH_COMMANDS } from '../lib/commands/dispatch';
import { usageHint, usageVerb } from '../lib/commands/usageHint';
import { subscribeErrorMessage } from '../lib/pushError';
import { GROUPS, REGISTRY } from '../shared/settingsRegistry';
import { useAliasesStore } from '../stores/aliases';
import { useAuthStore } from '../stores/auth';
import { useBuffersStore } from '../stores/buffers';
import { useConfigStore } from '../stores/config';
import { useDraftStore } from '../stores/drafts';
import { useNetworksStore } from '../stores/networks';
import { useRedactionsStore } from '../stores/redactions';
import { useSettingsStore } from '../stores/settings';
import { useWhoisStore } from '../stores/whois';
import { mediaKindForUrl } from '../utils/uploadHostMatch';
import { ACCEPTED_FILE_TYPES, isUploadableType } from '../utils/uploaders';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setTextareaValue(textarea: HTMLTextAreaElement, value: string, caret = value.length): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(textarea, value);
  textarea.setSelectionRange(caret, caret);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Lurker v2.7.2 & main parity', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let sent: Record<string, unknown>[];
  let acked: Record<string, unknown>[];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    sent = [];
    acked = [];

    registerSocketSenders(
      (payload) => {
        sent.push(payload);
        return true;
      },
      async (payload) => {
        acked.push(payload);
        return { ok: true };
      },
    );

    useNetworksStore.getState().reset();
    useBuffersStore.getState().reset();
    useDraftStore.getState().reset();
    useAliasesStore.setState({ aliases: [], loaded: true } as any);
    useRedactionsStore.getState().reset();
    useWhoisStore.getState().reset();
    useConfigStore.setState({
      checked: false,
      edition: 'standalone',
      features: { linkPreviews: false, bouncer: false, dcc: false },
    });
    useSettingsStore.setState({ values: {} } as any);
    useAuthStore.setState({
      user: {
        id: 1,
        username: 'jawsh',
        email: null,
        role: 'admin',
        status: 'active',
        isAdmin: true,
        features: { uploads: { maxBytes: 1024 * 1024 } },
      } as any,
    });

    useNetworksStore.setState({
      networks: [{ id: 1, name: 'TestNet', host: 'irc.example.net', port: 6697, nick: 'Jawsh', tls: true }],
      states: {
        1: {
          networkId: 1,
          channels: ['#lobby'],
          state: 'connected',
          nick: 'Jawsh',
          userModes: 'i',
          canReply: true,
          canAddReaction: true,
          canRedact: true,
        },
      },
    });
    useBuffersStore.getState().ensure(1, '#lobby', 10);
    useBuffersStore.getState().setMembers(1, '#lobby', [
      { nick: 'Jawsh', modes: ['o'], away: false },
      { nick: 'alice', modes: [], away: false },
      { nick: 'bob', modes: [], away: false },
    ]);
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    container.remove();
  });

  it('registers chat.notice_buffer (#1174) with choices private/auto/server defaulting to auto', () => {
    const opt = REGISTRY.find((o) => o.key === 'chat.notice_buffer');
    expect(opt).toBeDefined();
    expect(opt).toMatchObject({
      key: 'chat.notice_buffer',
      category: 'chat',
      group: 'notices',
      type: 'enum',
      choices: ['private', 'auto', 'server'],
      default: 'auto',
    });
    expect(GROUPS.notices).toBe('Notices');
    expect(useSettingsStore.getState().effective('chat.notice_buffer')).toBe('auto');
    expect(coerceSettingValue(opt!, 'private')).toEqual({ ok: true, value: 'private' });
    expect(coerceSettingValue(opt!, 'server')).toEqual({ ok: true, value: 'server' });
    expect(coerceSettingValue(opt!, 'bogus').ok).toBe(false);
  });

  it('allows deleting a kept sentTo notice in :server: using sentTo.target while hiding reply/react', () => {
    const serverBuf = useBuffersStore.getState().ensure(1, ':server:1', 1);
    serverBuf.messages = [
      {
        id: 701,
        networkId: 1,
        target: ':server:1',
        type: 'notice',
        nick: 'Jawsh',
        self: true,
        msgid: 'msgid-notice-701',
        text: '→ bob: hi bob',
        sentTo: { target: 'bob', text: 'hi bob' },
        time: '2026-11-21T12:00:00Z',
      },
      {
        id: 702,
        networkId: 1,
        target: ':server:1',
        type: 'notice',
        nick: 'NickServ',
        self: false,
        text: 'You are identified',
        time: '2026-11-21T12:00:01Z',
      },
    ];

    root = createRoot(container);
    act(() => {
      root!.render(
        React.createElement(MessageList, {
          buffer: serverBuf,
          onOpenReactionPicker: () => {},
        }),
      );
    });

    const replyBtns = container.querySelectorAll('button[title="Reply"]');
    const reactBtns = container.querySelectorAll('button[title="Add reaction"]');
    const deleteBtns = container.querySelectorAll('button[title="Delete message"]');
    expect(replyBtns.length).toBe(0);
    expect(reactBtns.length).toBe(0);
    expect(deleteBtns.length).toBe(1);

    act(() => {
      (deleteBtns[0] as HTMLButtonElement).click();
    });
    expect(sent).toContainEqual({
      type: 'redact',
      networkId: 1,
      target: 'bob',
      messageId: 701,
    });
  });

  it('supports v2.7.2 media/upload formats (.webm, .mkv, .ogg, .ogv, .opus, .spx, .flac, .wav)', () => {
    for (const token of [
      'video/webm',
      'video/x-matroska',
      'video/ogg',
      'audio/webm',
      'audio/ogg',
      'audio/opus',
      'audio/flac',
      'audio/wav',
      '.webm',
      '.mkv',
      '.mka',
      '.ogv',
      '.ogg',
      '.oga',
      '.opus',
      '.spx',
      '.flac',
      '.wav',
    ]) {
      expect(ACCEPTED_FILE_TYPES.split(',')).toContain(token);
    }

    expect(isUploadableType('video/x-matroska', 'clip.mkv')).toBe(true);
    expect(isUploadableType('', 'clip.mkv')).toBe(true);
    expect(isUploadableType('application/octet-stream', 'track.flac')).toBe(true);
    expect(isUploadableType('application/octet-stream', 'voice.opus')).toBe(true);
    expect(isUploadableType('application/pdf', 'doc.pdf')).toBe(false);
    expect(isUploadableType('', 'installer.dmg')).toBe(false);

    expect(mediaKindForUrl('https://x.test/a.webm')).toBe('video');
    expect(mediaKindForUrl('https://x.test/a.mkv')).toBe('video');
    expect(mediaKindForUrl('https://x.test/a.ogv')).toBe('video');
    expect(mediaKindForUrl('https://x.test/a.flac')).toBe('audio');
    expect(mediaKindForUrl('https://x.test/a.ogg')).toBe('audio');
    expect(mediaKindForUrl('https://x.test/a.opus')).toBe('audio');
    expect(mediaKindForUrl('https://x.test/a.wav')).toBe('audio');
  });

  it('computes command usageHint cleanly across arguments, caret positions, and aliases', () => {
    const line = (value: string, caret = value.length, aliases = []) => {
      const hint = usageHint(value, caret, SLASH_COMMANDS, aliases);
      return hint ? hint.parts.map((p) => (p.active ? `{${p.text}}` : p.text)).join(' ') : null;
    };

    expect(usageVerb('/ki')).toBeNull();
    expect(usageVerb('/kick bob')).toBe('kick');
    expect(usageVerb('//kick bob')).toBeNull();

    expect(line('/ki')).toBeNull();
    expect(line('/kick')).toBeNull();
    expect(line('/kick ')).toBe('/kick {<nick>} [reason]');
    expect(line('/kick bo')).toBe('/kick {<nick>} [reason]');
    expect(line('/kick bob ')).toBe('/kick <nick> {[reason]}');
    expect(line('/kick bob being rude')).toBe('/kick <nick> {[reason]}');
    expect(line('/kick bob spam', 8)).toBe('/kick {<nick>} [reason]');
    expect(line('/me waves')).toBe('/me {<action>}');
    expect(line('/join #ops secret extra')).toBe('/join <#channel> [key]');
    expect(line('/j2 ', 4, [{ name: 'j2', body: '/join' }] as any)).toBe('/join {<#channel>} [key]');
  });

  it('keeps the command usage line visible in MessageInput and dismisses it on Escape', async () => {
    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(MessageInput, { networkId: 1, target: '#lobby' }));
    });

    const textarea = container.querySelector('textarea')!;
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput.getAttribute('accept')).toBe(ACCEPTED_FILE_TYPES);

    // Absent while verb is being typed
    act(() => {
      setTextareaValue(textarea, '/kic');
    });
    expect(container.querySelector('[data-testid="command-usage-line"]')).toBeNull();

    // Visible and tracks argument when space follows verb
    act(() => {
      setTextareaValue(textarea, '/kick bo');
    });
    let usageEl = container.querySelector('[data-testid="command-usage-line"]');
    expect(usageEl).not.toBeNull();
    expect(usageEl!.querySelector('.active')?.textContent).toBe('<nick>');

    // Advances to [reason] and stays visible with no suggestions
    act(() => {
      setTextareaValue(textarea, '/kick bob spamming');
    });
    usageEl = container.querySelector('[data-testid="command-usage-line"]');
    expect(usageEl).not.toBeNull();
    expect(usageEl!.querySelector('.active')?.textContent).toBe('[reason]');

    // Follows caret move back onto <nick>
    act(() => {
      textarea.setSelectionRange(8, 8);
      textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }));
    });
    usageEl = container.querySelector('[data-testid="command-usage-line"]');
    expect(usageEl!.querySelector('.active')?.textContent).toBe('<nick>');

    // Escape dismisses usage line for this command
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[data-testid="command-usage-line"]')).toBeNull();

    // Stays dismissed while editing the same command
    act(() => {
      setTextareaValue(textarea, '/kick bob later');
    });
    expect(container.querySelector('[data-testid="command-usage-line"]')).toBeNull();

    // Switching to a new command brings it back
    act(() => {
      setTextareaValue(textarea, '/msg alice hi');
    });
    usageEl = container.querySelector('[data-testid="command-usage-line"]');
    expect(usageEl).not.toBeNull();
    expect(usageEl!.querySelector('.active')?.textContent).toBe('<message>');

    // Enter still sends cleanly when only the usage line is showing
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(acked).toContainEqual({
      type: 'send',
      networkId: 1,
      target: 'alice',
      text: 'hi',
    });
    expect(textarea.value).toBe('');
    expect(container.querySelector('[data-testid="command-usage-line"]')).toBeNull();
  });

  it('shows avatars lurker-previews note (#1380) once checked and formats push errors (#1379)', () => {
    root = createRoot(container);
    act(() => {
      root!.render(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(SettingsView),
        ),
      );
    });

    // Not checked yet -> absent
    expect(container.querySelector('[data-testid="avatars-need-previews-note"]')).toBeNull();

    act(() => {
      useConfigStore.setState({
        checked: true,
        features: { linkPreviews: false, bouncer: false, dcc: false },
      });
    });
    expect(container.querySelector('[data-testid="avatars-need-previews-note"]')?.textContent).toContain(
      'lurker-previews',
    );
    expect(container.textContent).toContain('Show avatars');

    act(() => {
      useConfigStore.setState({
        checked: true,
        features: { linkPreviews: true, bouncer: false, dcc: false },
      });
    });
    expect(container.querySelector('[data-testid="avatars-need-previews-note"]')).toBeNull();

    // Also shown in own WHOIS card when checked && !linkPreviews
    act(() => {
      useConfigStore.setState({
        checked: true,
        features: { linkPreviews: false, bouncer: false, dcc: false },
      });
      useWhoisStore.setState({
        open: true,
        networkId: 1,
        nick: 'Jawsh',
        loading: false,
        result: { networkId: 1, nick: 'Jawsh', user: 'jawsh', host: 'example.net' },
      });
      root!.render(React.createElement(WhoisModal));
    });
    expect(container.querySelector('[data-testid="whois-avatars-need-previews"]')?.textContent).toContain(
      'lurker-previews',
    );

    const abortErr = new DOMException('Registration failed - push service error', 'AbortError');
    expect(subscribeErrorMessage(abortErr)).toContain("couldn't reach its push service");
    expect(subscribeErrorMessage(abortErr)).toContain('DNS filter');
    expect(subscribeErrorMessage(abortErr, true)).toContain('Use Google services for push messaging');
    expect(subscribeErrorMessage(new DOMException('Permission denied', 'NotAllowedError'))).toBe(
      'Permission denied',
    );
  });
});
