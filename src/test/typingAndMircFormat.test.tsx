// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BufferList } from '../components/BufferList';
import { KeyboardHelpModal } from '../components/KeyboardHelpModal';
import { LinkedText } from '../components/LinkedText';
import { MessageInput } from '../components/MessageInput';
import { TypingIndicator } from '../components/TypingIndicator';
import { registerSocketSenders } from '../services/socketBus';
import { useAuthStore } from '../stores/auth';
import { useBuffersStore } from '../stores/buffers';
import { useDraftStore } from '../stores/drafts';
import { useIgnoresStore } from '../stores/ignores';
import { useNetworksStore } from '../stores/networks';
import { useSettingsStore } from '../stores/settings';
import {
  IRC_BOLD,
  IRC_COLOR,
  IRC_ITALIC,
  IRC_RESET,
  IRC_REVERSE,
  IRC_STRIKE,
  IRC_UNDERLINE,
  applyIrcControlAtSelection,
  formatMircColorCode,
  hasIrcFormatting,
  stripIrcFormatting,
} from '../utils/mircFormat';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Typing indicators, composer alignment & mIRC formatting', () => {
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
    useDraftStore.getState().reset();
    useIgnoresStore.getState().reset();
    useSettingsStore.setState({
      values: {},
      serverSettings: {
        'chat.send_typing_notifications': true,
        'chat.show_typing_notifications': true,
      },
    } as any);
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
        1: { networkId: 1, channels: ['#lobby'], state: 'connected', nick: 'Jawsh', userModes: 'i' },
      },
    });
    useBuffersStore.getState().ensure(1, '#lobby', 10);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    container.remove();
  });

  it('formats, wraps, detects, and strips mIRC control codes cleanly', () => {
    expect(formatMircColorCode(4)).toBe(`${IRC_COLOR}04`);
    expect(formatMircColorCode(4, 1)).toBe(`${IRC_COLOR}04,01`);
    expect(formatMircColorCode(null)).toBe(IRC_COLOR);

    const wrapped = applyIrcControlAtSelection({
      text: 'hello world',
      selectionStart: 6,
      selectionEnd: 11,
      openCode: IRC_BOLD,
    });
    expect(wrapped.text).toBe(`hello ${IRC_BOLD}world${IRC_BOLD}`);
    expect(wrapped.selectionStart).toBe(7);
    expect(wrapped.selectionEnd).toBe(12);

    // Protects trailing digits from merging into closing \x03
    const protectedColor = applyIrcControlAtSelection({
      text: 'red123',
      selectionStart: 0,
      selectionEnd: 3,
      openCode: `${IRC_COLOR}04`,
      closeCode: IRC_COLOR,
    });
    expect(protectedColor.text).toBe(`${IRC_COLOR}04red${IRC_COLOR}99,99123`);
    expect(hasIrcFormatting(protectedColor.text)).toBe(true);
    expect(stripIrcFormatting(protectedColor.text)).toBe('red123');
    expect(hasIrcFormatting('plain text')).toBe(false);
  });

  it('renders incoming active & paused typing indicators, filters self/ignored, and auto-expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(TypingIndicator, { networkId: 1, target: '#lobby' }));
    });
    expect(container.textContent).toBe('');

    act(() => {
      useBuffersStore.getState().setTyping(1, '#lobby', 'Jawsh', 'active');
      useBuffersStore.getState().setTyping(1, '#lobby', 'alice', 'active', 'alice@host');
    });
    expect(container.textContent).toContain('alice is typing');
    expect(container.querySelectorAll('.typing-dot-active').length).toBe(3);

    act(() => {
      useBuffersStore.getState().setTyping(1, '#lobby', 'bob', 'active', 'bob@host');
    });
    expect(container.textContent).toContain('alice and bob are typing');

    // Ignoring alice leaves bob only
    act(() => {
      useIgnoresStore.setState({
        global: [
          {
            id: 99,
            mask: 'alice!*@*',
            channels: null,
            pattern: null,
            patternKind: 'substr',
            levels: ['ALL'],
            isExcept: false,
            expiresAt: null,
            createdAt: '2026-11-19T00:00:00Z',
          },
        ],
      });
    });
    expect(container.textContent).toContain('bob is typing');

    // Transition to paused state
    act(() => {
      useBuffersStore.getState().setTyping(1, '#lobby', 'bob', 'paused', 'bob@host');
    });
    expect(container.textContent).toContain('bob paused typing');
    expect(container.querySelectorAll('.typing-dot-active').length).toBe(0);

    // Setting disables typing display
    act(() => {
      useSettingsStore.setState({
        values: { 'chat.show_typing_notifications': false },
      } as any);
    });
    expect(container.textContent).toBe('');

    // Re-enable and advance past paused expiration (30s for paused)
    act(() => {
      useSettingsStore.setState({ values: {} } as any);
    });
    expect(container.textContent).toContain('bob paused typing');

    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(container.textContent).toBe('');
  });

  it('shows typing dots on BufferList rows for non-self active typers', () => {
    act(() => {
      useBuffersStore.getState().setTyping(1, '#lobby', 'alice', 'active', 'alice@host');
    });

    root = createRoot(container);
    act(() => {
      root!.render(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(BufferList, {
            onOpenNetworkModal: () => {},
            onOpenJoinChannel: () => {},
            onOpenChannelList: () => {},
            onOpenSearch: () => {},
            onOpenUploads: () => {},
            onOpenHighlights: () => {},
            onOpenBookmarks: () => {},
          }),
        ),
      );
    });

    const dots = container.querySelector('[data-testid="buffer-typing-dots"]');
    expect(dots).not.toBeNull();
    expect(dots!.getAttribute('title')).toContain('alice typing');

    act(() => {
      useBuffersStore.getState().setTyping(1, '#lobby', 'alice', 'done');
    });
    expect(container.querySelector('[data-testid="buffer-typing-dots"]')).toBeNull();
  });

  it('emits outgoing active, paused after 4.5s idle, and done on clear/command/unmount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(MessageInput, { networkId: 1, target: '#lobby' }));
    });

    const textarea = container.querySelector('textarea')!;
    act(() => {
      setTextareaValue(textarea, 'hi');
    });
    expect(sent).toEqual([{ type: 'typing', networkId: 1, target: '#lobby', state: 'active' }]);

    // Idle 4.5s transitions to 'paused'
    act(() => {
      vi.advanceTimersByTime(4500);
    });
    expect(sent).toEqual([
      { type: 'typing', networkId: 1, target: '#lobby', state: 'active' },
      { type: 'typing', networkId: 1, target: '#lobby', state: 'paused' },
    ]);

    // Clearing composer emits 'done' immediately
    act(() => {
      setTextareaValue(textarea, '');
    });
    expect(sent).toEqual([
      { type: 'typing', networkId: 1, target: '#lobby', state: 'active' },
      { type: 'typing', networkId: 1, target: '#lobby', state: 'paused' },
      { type: 'typing', networkId: 1, target: '#lobby', state: 'done' },
    ]);

    // Typing again and unmounting before send emits 'done'
    act(() => {
      setTextareaValue(textarea, 'unsent draft');
    });
    expect(sent[sent.length - 1]).toEqual({
      type: 'typing',
      networkId: 1,
      target: '#lobby',
      state: 'active',
    });

    act(() => {
      root!.unmount();
      root = null;
    });
    expect(sent[sent.length - 1]).toEqual({
      type: 'typing',
      networkId: 1,
      target: '#lobby',
      state: 'done',
    });
  });

  it('keeps Upload, mIRC Format, Textarea, and Send controls uniformly aligned at 36px', () => {
    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(MessageInput, { networkId: 1, target: '#lobby' }));
    });

    const attachBtn = container.querySelector('button[aria-label="Attach or upload file"]') as HTMLButtonElement;
    const formatBtn = container.querySelector('button[aria-label="Text formatting and mIRC colors"]') as HTMLButtonElement;
    const sendBtn = container.querySelector('button[aria-label="Send message"]') as HTMLButtonElement;
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

    for (const btn of [attachBtn, formatBtn, sendBtn]) {
      expect(btn).not.toBeNull();
      expect(btn.style.height).toBe('36px');
      expect(btn.style.width).toBe('36px');
      expect(btn.className).toContain('h-9');
      expect(btn.className).toContain('w-9');
    }

    expect(textarea.style.display).toBe('block');
    expect(textarea.style.minHeight).toBe('36px');
    expect(textarea.style.padding).toBe('7px 12px');
    expect(textarea.style.lineHeight).toBe('20px');
  });

  it('supports mIRC keyboard shortcuts, color picker popover, live preview, and reverse rendering', () => {
    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(MessageInput, { networkId: 1, target: '#lobby' }));
    });

    const textarea = container.querySelector('textarea')!;
    act(() => {
      setTextareaValue(textarea, 'hello world');
    });

    // Select "world" (6..11) and apply Ctrl+B
    textarea.setSelectionRange(6, 11);
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(textarea.value).toBe(`hello ${IRC_BOLD}world${IRC_BOLD}`);

    // Open mIRC Color & Formatting Picker via Ctrl+Shift+K
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'K',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(container.textContent).toContain('mIRC Formatting');

    // Submit numeric FG,BG color code 04,01
    const quickInput = container.querySelector('input[aria-label="mIRC color code"]') as HTMLInputElement;
    expect(quickInput).not.toBeNull();
    act(() => {
      setInputValue(quickInput, '04,01');
    });
    const form = quickInput.closest('form')!;
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(textarea.value).toContain(`${IRC_COLOR}04,01`);

    // Live formatted preview bar appears cleanly
    const preview = container.querySelector('[data-testid="mirc-live-preview"]');
    expect(preview).not.toBeNull();
    expect(preview!.textContent).toContain('Preview');
    expect(preview!.textContent).toContain('world');

    // Additional shortcuts: Ctrl+I, Ctrl+U, Ctrl+Shift+S, Ctrl+Shift+R, Ctrl+O
    act(() => {
      setTextareaValue(textarea, 'test');
    });
    textarea.setSelectionRange(0, 4);
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(textarea.value).toBe(`${IRC_ITALIC}test${IRC_ITALIC}`);

    textarea.setSelectionRange(0, textarea.value.length);
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'u', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(textarea.value.startsWith(IRC_UNDERLINE)).toBe(true);

    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'R',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(textarea.value.endsWith(IRC_REVERSE)).toBe(true);

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'S',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(textarea.value).toContain(IRC_STRIKE);

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(textarea.value.endsWith(IRC_RESET)).toBe(true);

    // Clear button strips all mIRC control codes
    const clearBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Clear',
    )!;
    act(() => {
      clearBtn.click();
    });
    expect(hasIrcFormatting(textarea.value)).toBe(false);
    expect(container.querySelector('[data-testid="mirc-live-preview"]')).toBeNull();
  });

  it('renders reverse video (\\x16) and documents mIRC shortcuts in KeyboardHelpModal', () => {
    root = createRoot(container);
    act(() => {
      root!.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(LinkedText, {
            text: `${IRC_COLOR}04,01${IRC_REVERSE}inverted`,
            networkId: 1,
          }),
          React.createElement(KeyboardHelpModal, { open: true, onClose: () => {} }),
        ),
      );
    });

    const styledSpan = Array.from(container.querySelectorAll('span')).find(
      (s) => s.textContent === 'inverted',
    );
    expect(styledSpan).not.toBeNull();
    // Swapped FG/BG colors should both be set explicitly when \x16 is active
    expect(styledSpan!.style.color).not.toBe('');
    expect(styledSpan!.style.backgroundColor).not.toBe('');
    expect(styledSpan!.style.color).not.toBe(styledSpan!.style.backgroundColor);

    expect(container.textContent).toContain('Open mIRC Color & Formatting Picker');
    expect(container.textContent).toContain('Insert mIRC Bold / Italic / Underline formatting');
  });
});
