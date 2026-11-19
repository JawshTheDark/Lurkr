// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageInput } from '../components/MessageInput';
import { ThreadPanel } from '../components/ThreadPanel';
import { useBuffersStore } from '../stores/buffers';
import { useDraftStore } from '../stores/drafts';
import { useNetworksStore } from '../stores/networks';
import { useReactionsStore } from '../stores/reactions';
import { useThreadsStore } from '../stores/threads';
import { useToastsStore } from '../stores/toasts';
import { registerSocketSenders, type AckResult } from '../services/socketBus';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Message sending & wsHub wire protocol', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let sent: Record<string, unknown>[];
  let acked: Record<string, unknown>[];
  let nextAckResult: AckResult;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    sent = [];
    acked = [];
    nextAckResult = { ok: true };

    registerSocketSenders(
      (payload) => {
        sent.push(payload);
        return true;
      },
      async (payload) => {
        acked.push(payload);
        return nextAckResult;
      },
    );

    useNetworksStore.getState().reset();
    useBuffersStore.getState().reset();
    useDraftStore.getState().reset();
    useToastsStore.setState({ items: [] });
    useThreadsStore.getState().reset();
    useReactionsStore.getState().reset();

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

  it('sends plain messages with wsHub type "send" and valid typing state frames', async () => {
    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(MessageInput, { networkId: 1, target: '#lobby' }));
    });

    const textarea = container.querySelector('textarea')!;
    act(() => {
      setTextareaValue(textarea, 'hello everyone');
    });

    // Typing frame must use `state: 'active'` (not `status`) per wsHub.ts
    expect(sent).toContainEqual({
      type: 'typing',
      networkId: 1,
      target: '#lobby',
      state: 'active',
    });

    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(acked.filter((f) => f.type === 'send')).toEqual([
      {
        type: 'send',
        networkId: 1,
        target: '#lobby',
        text: 'hello everyone',
      },
    ]);
    expect(sent).toContainEqual({
      type: 'typing',
      networkId: 1,
      target: '#lobby',
      state: 'done',
    });
    expect(textarea.value).toBe('');
  });

  it('restores unsent message text and surfaces a toast when the server rejects or times out', async () => {
    nextAckResult = { ok: false, error: 'not-connected' };

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(MessageInput, { networkId: 1, target: '#lobby' }));
    });

    const textarea = container.querySelector('textarea')!;
    act(() => {
      setTextareaValue(textarea, 'important draft');
    });

    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(textarea.value).toBe('important draft');
    expect(useToastsStore.getState().items.some((t) => t.body?.includes('not-connected'))).toBe(true);
  });

  it('blocks plain-text sends inside a :server buffer instead of sending to a server target', async () => {
    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(MessageInput, { networkId: 1, target: ':server:1' }));
    });

    const textarea = container.querySelector('textarea')!;
    act(() => {
      setTextareaValue(textarea, 'hello');
    });

    // Never emit typing events for pseudo server buffers
    expect(sent).toEqual([]);

    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(acked).toEqual([]);
    expect(useToastsStore.getState().items.some((t) => t.kind === 'error')).toBe(true);
  });

  it('sends integer replyTo from ThreadPanel and emits valid draft / unreact frames', async () => {
    useThreadsStore.setState({
      view: {
        networkId: 1,
        target: '#lobby',
        bufferId: 10,
        rootMsgid: 'msgid-root-1',
        root: {
          id: 555,
          networkId: 1,
          target: '#lobby',
          type: 'message',
          nick: 'Alice',
          text: 'Thread root',
        },
        replies: [],
        loading: false,
        truncated: false,
        token: 1,
        sinceId: 555,
      },
    });

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(ThreadPanel, {}));
    });

    const textarea = container.querySelector('textarea')!;
    act(() => {
      setTextareaValue(textarea, 'Thread reply body');
    });
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(acked).toEqual([
      {
        type: 'send',
        networkId: 1,
        target: '#lobby',
        text: 'Thread reply body',
        replyTo: 555,
      },
    ]);

    // Verify drafts flush uses acked draft-set / draft-clear (2.7+) and unreact uses react + remove:true
    await act(async () => {
      useDraftStore.getState().setDraft(1, '#lobby', 'saved text');
      useDraftStore.getState().flush(1, '#lobby');
      useDraftStore.getState().setDraft(1, '#lobby', '');
      useDraftStore.getState().flush(1, '#lobby');
      useNetworksStore.setState({
        states: {
          1: { networkId: 1, channels: ['#lobby'], state: 'connected', nick: 'Jawsh', canAddReaction: true, canRemoveReaction: true },
        },
      });
      useReactionsStore.getState().unreact(1, '#lobby', 555, '👍');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(acked).toContainEqual({
      type: 'draft-set',
      networkId: 1,
      target: '#lobby',
      body: 'saved text',
      reply: null,
      age: expect.any(Number),
    });
    expect(acked).toContainEqual({
      type: 'draft-clear',
      networkId: 1,
      target: '#lobby',
      age: expect.any(Number),
    });
    expect(sent).toContainEqual({
      type: 'react',
      networkId: 1,
      target: '#lobby',
      messageId: 555,
      value: '👍',
      remove: true,
    });
  });

  it('completes and cycles matching nicks (not selfNick) on Tab and Shift+Tab, and suggests matching nicks on @mention', async () => {
    useBuffersStore.getState().setMembers(1, '#lobby', [
      { nick: 'Jawsh', user: 'jawsh', host: 'me.net', modes: [], away: false },
      { nick: 'JawshBot', user: 'bot', host: 'bot.net', modes: [], away: false },
      { nick: 'Alice', user: 'alice', host: 'a.net', modes: [], away: false },
      { nick: 'Alina', user: 'alina', host: 'b.net', modes: [], away: false },
      { nick: 'Bob', user: 'bob', host: 'c.net', modes: [], away: false },
    ]);

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(MessageInput, { networkId: 1, target: '#lobby' }));
    });

    const textarea = container.querySelector('textarea')!;

    // 1. Tab completion at start of line appends ": " and excludes own nick 'Jawsh'
    act(() => {
      setTextareaValue(textarea, 'al');
      textarea.setSelectionRange(2, 2);
    });
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(textarea.value).toBe('Alice: ');

    // Second Tab cycles to Alina: (not Jawsh!)
    act(() => {
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(textarea.value).toBe('Alina: ');

    // Shift+Tab cycles back to Alice:
    act(() => {
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(textarea.value).toBe('Alice: ');

    // 2. Typing 'j' completes JawshBot (NOT selfNick 'Jawsh')
    act(() => {
      setTextareaValue(textarea, 'hello j');
      textarea.setSelectionRange(7, 7);
    });
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(textarea.value).toBe('hello JawshBot ');

    // And immediately hitting Enter sends the completed text (verifying textRef sync)
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(acked).toContainEqual({
      type: 'send',
      networkId: 1,
      target: '#lobby',
      text: 'hello JawshBot',
    });

    // 3. @mention autocomplete suggests Alice & Alina (NOT Jawsh)
    act(() => {
      setTextareaValue(textarea, 'ping @al');
      textarea.setSelectionRange(8, 8);
    });
    const mentionBtns = Array.from(container.querySelectorAll('button')).map((b) => b.textContent || '');
    expect(mentionBtns.join(' ')).toContain('Alice');
    expect(mentionBtns.join(' ')).toContain('Alina');
    expect(mentionBtns.join(' ')).not.toContain('JawshBot');
  });
});
