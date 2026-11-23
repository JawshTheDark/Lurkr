// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BufferList } from '../components/BufferList';
import { MemberList } from '../components/MemberList';
import { resetSession } from '../stores/sessionReset';
import { registerAllSessionResets } from '../stores/registerResets';
import { connectSocket, resetSocket } from '../services/socket';
import { useBuffersStore } from '../stores/buffers';
import { useChannelNotifyStore } from '../stores/channelNotify';
import { useConfigStore } from '../stores/config';
import { useFavoritesStore } from '../stores/favorites';
import { useIgnoresStore } from '../stores/ignores';
import { useNetworksStore } from '../stores/networks';
import { useNicklistCollapseStore } from '../stores/nicklistCollapse';
import { useNickNotesStore } from '../stores/nickNotes';
import { usePinsStore } from '../stores/pins';
import { seenEventCursor, setSeenEventCursor } from '../lib/seenEventCursor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
registerAllSessionResets();

describe('Upstream snapshot, favorites-changed & sidebar sync', () => {
  const origWebSocket = globalThis.WebSocket;
  let container: HTMLDivElement;
  let root: Root | null = null;
  let lastSocket: {
    sent: Record<string, unknown>[];
    emit: (ev: string, data?: unknown) => void;
  } | null = null;

  beforeEach(() => {
    resetSocket();
    resetSession();
    setSeenEventCursor(0);
    container = document.createElement('div');
    document.body.appendChild(container);
    useConfigStore.setState({
      checked: true,
      features: { linkPreviews: false, bouncer: true, dcc: false },
    });
    useNetworksStore.setState({
      networks: [
        { id: 1, name: 'Libera.Chat', host: 'irc.libera.chat', port: 6697, nick: 'Jawsh', tls: true },
      ],
      states: {
        1: { networkId: 1, channels: ['#lurker', '#lurker-spooky', '#pinned-chan'], state: 'connected', nick: 'Jawsh' },
      },
      loaded: true,
    });

    class MockWebSocket {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = MockWebSocket.OPEN;
      listeners = new Map<string, Array<(e?: any) => void>>();
      sent: Record<string, unknown>[] = [];
      constructor() {
        lastSocket = this;
        setTimeout(() => this.emit('open'), 0);
      }
      addEventListener(ev: string, cb: (e?: any) => void) {
        const list = this.listeners.get(ev) || [];
        list.push(cb);
        this.listeners.set(ev, list);
      }
      send(raw: string) {
        try {
          this.sent.push(JSON.parse(raw));
        } catch {
          /* ignore */
        }
      }
      close() {
        this.readyState = MockWebSocket.CLOSED;
      }
      emit(ev: string, data?: unknown) {
        for (const cb of this.listeners.get(ev) || []) {
          cb(data);
        }
      }
    }
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container.remove();
    resetSocket();
    resetSession();
    globalThis.WebSocket = origWebSocket;
  });

  it('loads server favorites-changed ({ favorites }), pins, ignores, notes, collapse, notify, and flat backlog read state', async () => {
    connectSocket();
    expect(lastSocket).not.toBeNull();
    const emitJson = (obj: unknown) =>
      lastSocket!.emit('message', { data: JSON.stringify(obj) });

    act(() => {
      emitJson({
        kind: 'snapshot',
        cursor: 900,
        networks: [
          {
            networkId: 1,
            name: 'Libera.Chat',
            state: 'connected',
            nick: 'Jawsh',
            pinned: ['#Pinned-Chan'],
            collapsedNicklists: { '#lurker': true },
            channelNotify: { '#lurker-spooky': { notifyAlways: true } },
            ignoredMasks: [
              {
                id: 7,
                mask: 'spam!*@*',
                levels: ['ALL'],
                channels: [],
                pattern: null,
                patternKind: 'substr',
                isExcept: false,
                expiresAt: null,
                createdAt: '2026-01-01T00:00:00Z',
              },
            ],
            nickNotes: [{ nick: 'd3fc0n', note: 'Tested favorites' }],
            channels: [
              { name: '#lurker', joined: true, members: [] },
              { name: '#lurker-spooky', joined: true, members: [] },
              { name: '#pinned-chan', joined: true, members: [] },
            ],
          },
        ],
        globalIgnores: [],
      });

      // Server connect-burst sends favorites BEFORE/BESIDE buffer shells using `{ favorites: [...] }`.
      emitJson({
        kind: 'favorites-changed',
        favorites: [
          { networkId: 1, target: '#lurker-spooky', bufferId: 12 },
          { networkId: 1, target: 'd3fc0n', bufferId: 13 },
        ],
      });

      // Fresh connect sends shell backlog frames with top-level unread/highlights/bufferId.
      emitJson({
        kind: 'backlog',
        networkId: 1,
        target: '#lurker-spooky',
        bufferId: 12,
        mode: 'shell',
        events: [],
        joined: true,
        lastReadId: 100,
        unread: 4,
        highlights: 2,
        highlightsCapped: false,
        clearedBeforeId: 0,
        clearedAt: null,
        hasMoreOlder: true,
      });
      emitJson({
        kind: 'backlog',
        networkId: 1,
        target: 'd3fc0n',
        bufferId: 13,
        mode: 'shell',
        events: [],
        lastReadId: 50,
        unread: 1,
        highlights: 1,
        highlightsCapped: false,
        clearedBeforeId: 0,
        clearedAt: null,
        hasMoreOlder: true,
      });
      emitJson({
        kind: 'backlog',
        networkId: 1,
        target: '#pinned-chan',
        bufferId: 14,
        mode: 'shell',
        events: [],
        joined: true,
        lastReadId: 20,
        unread: 0,
        highlights: 0,
        hasMoreOlder: false,
      });
    });

    expect(seenEventCursor()).toBe(900);
    expect(useFavoritesStore.getState().entries).toHaveLength(2);
    expect(useFavoritesStore.getState().isFavorite(1, '#LURKER-SPOOKY')).toBe(true);
    expect(usePinsStore.getState().isPinned(1, '#pinned-chan')).toBe(true);
    expect(useNicklistCollapseStore.getState().isCollapsed(1, '#lurker')).toBe(true);
    expect(useChannelNotifyStore.getState().levelFor(1, '#lurker-spooky')).toBe('all');
    expect(useIgnoresStore.getState().forNetwork(1)).toHaveLength(1);
    expect(useNickNotesStore.getState().forNick(1, 'd3fc0n')).toBe('Tested favorites');

    const favBuf = useBuffersStore.getState().buffers['1::#lurker-spooky'];
    expect(favBuf?.unread).toBe(4);
    expect(favBuf?.highlighted).toBe(2);

    root = createRoot(container);
    await act(async () => {
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

    const text = container.textContent || '';
    expect(text).toContain('Friends');
    expect(text).toContain('Favorites');
    expect(text).toContain('d3fc0n');
    expect(text).toContain('#lurker-spooky');
    expect(text).toContain('#pinned-chan');
    // Favorites should be deduplicated out of the network tree (#lurker-spooky appears once).
    expect(text.match(/#lurker-spooky/g)).toHaveLength(1);
    const netText = text.slice(text.lastIndexOf('Libera.Chat'));
    expect(netText).not.toContain('#lurker-spooky');
    // Pinned channel sorts ahead of non-pinned #lurker despite '#' vs 'p'.
    expect(netText.indexOf('#pinned-chan')).toBeLessThan(netText.indexOf('#lurker'));

    // Reorder favorites emits bufferIds array per upstream wsHub contract.
    act(() => {
      useFavoritesStore.getState().reorder([
        { networkId: 1, target: 'd3fc0n', bufferId: 13 },
        { networkId: 1, target: '#lurker-spooky', bufferId: 12 },
      ]);
    });
    expect(lastSocket!.sent).toContainEqual({
      type: 'reorder-favorites',
      bufferIds: [13, 12],
    });

    // Live frame updates with upstream field names (`masks`, `collapsed: boolean`, `notifyAlways`).
    act(() => {
      emitJson({ kind: 'ignore-list-updated', networkId: 1, masks: [] });
      emitJson({ kind: 'nicklist-collapsed-changed', networkId: 1, target: '#lurker', collapsed: false });
      emitJson({ kind: 'channel-notify-changed', networkId: 1, target: '#lurker-spooky', notifyAlways: false });
      emitJson({ kind: 'buffer-closed', networkId: 1, target: 'd3fc0n' });
    });

    expect(useIgnoresStore.getState().forNetwork(1)).toHaveLength(0);
    expect(useNicklistCollapseStore.getState().isCollapsed(1, '#lurker')).toBe(false);
    expect(useChannelNotifyStore.getState().levelFor(1, '#lurker-spooky')).toBe('default');
    expect(useFavoritesStore.getState().isFavorite(1, 'd3fc0n')).toBe(false);
  });

  it('loads and preserves MemberList across connecting state, provisional membersPending names, reconnect snapshot, member-update, and part', async () => {
    connectSocket();
    const emitJson = (obj: unknown) =>
      lastSocket!.emit('message', { data: JSON.stringify(obj) });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      emitJson({
        kind: 'snapshot',
        cursor: 900,
        networks: [
          {
            networkId: 1,
            name: 'Libera.Chat',
            state: 'connecting',
            nick: 'Jawsh',
            channels: [{ name: '#lurker', members: [], membersPending: true, joined: true }],
          },
        ],
      });
      emitJson({
        kind: 'backlog',
        networkId: 1,
        target: '#lurker',
        joined: true,
        hasMoreOlder: false,
        events: [
          {
            id: 901,
            networkId: 1,
            target: '#lurker',
            type: 'message',
            nick: 'amiantos',
            text: 'hi',
            time: '2026-11-22T00:00:00Z',
          },
        ],
      });
    });

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(MemberList, { networkId: 1, target: '#lurker' }));
    });

    // Not connected yet -> must not show Loading forever or poison namesAsked
    expect(container.textContent).toContain('0 members');
    expect(container.textContent).not.toContain('Loading members…');
    expect(lastSocket!.sent.filter((p) => p.type === 'names')).toHaveLength(0);

    // Network reaches connected -> Loading members… displays and MemberList requests names
    act(() => {
      emitJson({ kind: 'irc', type: 'state', networkId: 1, state: 'connected', nick: 'Jawsh' });
    });
    expect(container.textContent).toContain('Loading members…');
    expect(lastSocket!.sent.filter((p) => p.type === 'names')).toEqual([
      { type: 'names', networkId: 1, target: '#lurker' },
    ]);

    // Provisional partial names (membersPending: true) renders partial list without marking full
    act(() => {
      emitJson({
        kind: 'irc',
        type: 'names',
        networkId: 1,
        target: '#lurker',
        membersPending: true,
        members: [{ nick: 'Jawsh', modes: [], away: false }],
      });
    });
    expect(container.textContent).toContain('1+ members (loading…)');
    expect(container.textContent).toContain('Jawsh');

    // Empty provisional frame does not wipe held partial list
    act(() => {
      emitJson({
        kind: 'irc',
        type: 'names',
        networkId: 1,
        target: '#lurker',
        membersPending: true,
        members: [],
      });
    });
    expect(container.textContent).toContain('Jawsh');

    // Authoritative 366 / full names settles member list as full
    act(() => {
      emitJson({
        kind: 'irc',
        type: 'names',
        networkId: 1,
        target: '#lurker',
        members: [
          { nick: 'Jawsh', modes: ['o'], away: false },
          { nick: 'amiantos', modes: [], away: false },
        ],
      });
    });
    expect(container.textContent).toContain('2 members');
    expect(container.textContent).toContain('amiantos');

    // Reconnect snapshot with membersPending: true preserves already-held full list
    act(() => {
      emitJson({
        kind: 'snapshot',
        networks: [
          {
            networkId: 1,
            name: 'Libera.Chat',
            state: 'connected',
            nick: 'Jawsh',
            channels: [{ name: '#lurker', members: [], membersPending: true, joined: true }],
          },
        ],
      });
    });
    expect(container.textContent).toContain('2 members');
    expect(container.textContent).toContain('amiantos');

    // Upstream member-update ({ member: { nick, modes, away } }) updates held member
    act(() => {
      emitJson({
        kind: 'irc',
        type: 'member-update',
        networkId: 1,
        target: '#lurker',
        member: { nick: 'amiantos', modes: ['v'], away: true },
      });
    });
    const updatedAmiantos = useBuffersStore
      .getState()
      .buffers['1::#lurker']?.members.find((m) => m.nick === 'amiantos');
    expect(updatedAmiantos?.away).toBe(true);
    expect(updatedAmiantos?.modes).toEqual(['v']);

    // channel-parted ignores unknown channels and clears held channel cleanly without stuck Loading
    act(() => {
      emitJson({ kind: 'irc', type: 'channel-parted', networkId: 1, target: '#never-visited' });
      emitJson({ kind: 'irc', type: 'channel-parted', networkId: 1, target: '#lurker' });
    });
    expect(useBuffersStore.getState().buffers['1::#never-visited']).toBeUndefined();
    expect(container.textContent).toContain('0 members');
    expect(container.textContent).not.toContain('Loading members…');
  });
});
