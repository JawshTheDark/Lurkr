// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { describe, it, expect, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useBuffersStore, bufferKey, resetNamesAsked } from '../stores/buffers';
import { useNetworksStore } from '../stores/networks';
import { registerSocketSenders } from '../services/socketBus';
import { MessageList } from '../components/MessageList';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useBuffersStore', () => {
  beforeEach(() => {
    useBuffersStore.getState().reset();
    useNetworksStore.getState().reset();
    resetNamesAsked();
  });

  it('creates and retrieves buffers by networkId and target', () => {
    const buf = useBuffersStore.getState().ensure(1, '#lurker', 42);
    expect(buf.id).toBe(42);
    expect(buf.networkId).toBe(1);
    expect(buf.target).toBe('#lurker');
    expect(useBuffersStore.getState().buffers[bufferKey(1, '#lurker')]).toBeDefined();
  });

  it('appends messages and tracks history', () => {
    useBuffersStore.getState().ensure(1, '#lurker', 42);
    useBuffersStore.getState().appendHistory(
      1,
      '#lurker',
      [
        {
          id: 1001,
          networkId: 1,
          target: '#lurker',
          type: 'message',
          nick: 'alice',
          text: 'hi there',
          time: new Date().toISOString(),
        },
      ],
      false,
    );
    const buf = useBuffersStore.getState().buffers[bufferKey(1, '#lurker')];
    expect(buf.messages.some((m) => m.id === 1001)).toBe(true);
  });

  it('sends `names` with `target` (never `channel`) and retries after disconnect', () => {
    const sent: Record<string, unknown>[] = [];
    registerSocketSenders(
      () => false,
      async () => ({ ok: false }),
    );

    useBuffersStore.getState().ensure(1, '#lobby', 7);
    useBuffersStore.getState().setJoined(1, '#lobby', true);

    // Failed send must not mark namesAsked so subsequent connected activate retries cleanly.
    expect(useBuffersStore.getState().ensureMembers(1, '#lobby')).toBe(false);

    registerSocketSenders(
      (payload) => {
        sent.push(payload);
        return true;
      },
      async () => ({ ok: true }),
    );

    useBuffersStore.getState().activate(1, '#lobby');
    expect(sent).toEqual([{ type: 'names', networkId: 1, bufferId: 7, target: '#lobby' }]);
    expect(sent[0]).not.toHaveProperty('channel');

    // Deduplicated while already asked
    expect(useBuffersStore.getState().ensureMembers(1, '#lobby')).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('renders nick-change events using `nick` fallback when `oldNick` is omitted by server', () => {
    const buf = useBuffersStore.getState().ensure(1, '#lobby', 9);
    useBuffersStore.getState().appendHistory(
      1,
      '#lobby',
      [
        {
          id: 500,
          networkId: 1,
          target: '#lobby',
          type: 'nick',
          nick: 'darkmess1',
          newNick: 'darkmess',
          time: new Date().toISOString(),
        } as any,
      ],
      false,
    );
    const updated = useBuffersStore.getState().buffers[bufferKey(1, '#lobby')];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(MessageList, {
          buffer: updated || buf,
          onOpenReactionPicker: () => {},
        }),
      );
    });
    expect(container.textContent).toContain('darkmess1 is now known as darkmess');
    expect(container.textContent).not.toContain('undefined is now known as');
    act(() => root.unmount());
    container.remove();
  });
});
