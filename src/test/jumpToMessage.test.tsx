// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HighlightsModal } from '../components/HighlightsModal';
import { BookmarksModal } from '../components/BookmarksModal';
import { SearchModal } from '../components/SearchModal';
import { ToastsOverlay } from '../components/ToastsOverlay';
import { MessageList } from '../components/MessageList';
import { registerAllSessionResets } from '../stores/registerResets';
import { resetSession } from '../stores/sessionReset';
import { useBuffersStore, windowAroundAnchor, type BufferMessage } from '../stores/buffers';
import { useBookmarksStore } from '../stores/bookmarks';
import { useDesktopUiStore } from '../stores/desktopUi';
import { useHighlightsStore } from '../stores/highlights';
import { useNetworksStore } from '../stores/networks';
import { useSearchStore } from '../stores/search';
import { useToastsStore } from '../stores/toasts';
import { registerSocketSenders } from '../services/socketBus';
import { resetPendingJump } from '../lib/jumpToMessage';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
registerAllSessionResets();

function makeMessage(
  id: number,
  nick: string,
  text: string,
  extra: Partial<BufferMessage> = {},
): BufferMessage {
  return {
    id,
    networkId: 1,
    target: '#lurker',
    type: 'message',
    nick,
    text,
    time: `2026-11-25T10:${String(id % 60).padStart(2, '0')}:00Z`,
    ...extra,
  };
}

describe('Jump to message context & origin glow', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let sent: Record<string, unknown>[] = [];
  let scrolledIds: string[] = [];
  const origScrollIntoView = Element.prototype.scrollIntoView;

  beforeEach(() => {
    vi.useFakeTimers();
    resetSession();
    resetPendingJump();
    sent = [];
    scrolledIds = [];
    registerSocketSenders(
      (payload) => {
        sent.push(payload);
        return true;
      },
      async () => ({ ok: true }),
    );
    Element.prototype.scrollIntoView = function () {
      const id = this.getAttribute('data-msg-id');
      if (id) scrolledIds.push(id);
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    useNetworksStore.setState({
      networks: [
        { id: 1, name: 'Libera.Chat', host: 'irc.libera.chat', port: 6697, nick: 'Jawsh', tls: true },
      ],
      states: {
        1: { networkId: 1, channels: ['#lurker', '#other'], state: 'connected', nick: 'Jawsh' },
      },
      loaded: true,
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container.remove();
    Element.prototype.scrollIntoView = origScrollIntoView;
    resetPendingJump();
    resetSession();
    vi.useRealTimers();
  });

  it('loads context around an older highlight when clicked, centers it, and glows for ~3.2s', async () => {
    // Seed active #other and open #lurker holding newer tail messages [200, 201].
    useBuffersStore.getState().replaceBacklog(
      1,
      '#other',
      [makeMessage(300, 'alice', 'talking in other', { target: '#other' })],
      [],
      null,
      true,
    );
    useBuffersStore.getState().replaceBacklog(
      1,
      '#lurker',
      [makeMessage(200, 'bob', 'latest msg 1'), makeMessage(201, 'bob', 'latest msg 2')],
      [],
      null,
      true,
      { hasMoreOlder: true },
    );
    useBuffersStore.getState().activate(1, '#other');

    useHighlightsStore.setState({
      items: [
        {
          id: 42,
          kind: 'highlight',
          networkId: 1,
          target: '#lurker',
          nick: 'fabricionaweb',
          type: 'message',
          text: 'Jawsh: check context around here',
          createdAt: '2026-11-25T09:15:00Z',
        },
      ],
      loaded: true,
      loading: false,
      hasMore: false,
    });

    const onClose = vi.fn();
    const TestHarness: React.FC<{ modalOpen: boolean }> = ({ modalOpen }) => {
      const active = useBuffersStore((s) => {
        const key = useNetworksStore.getState().activeKey;
        return key ? s.buffers[key] : null;
      });
      useNetworksStore((s) => s.activeKey);
      return (
        <>
          {active && <MessageList buffer={active} onOpenReactionPicker={() => {}} />}
          <HighlightsModal open={modalOpen} onClose={onClose} />
        </>
      );
    };

    root = createRoot(container);
    act(() => {
      root!.render(<TestHarness modalOpen />);
    });

    const btn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('fabricionaweb'),
    );
    expect(btn).toBeTruthy();

    act(() => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useNetworksStore.getState().activeKey).toBe('1::#lurker');

    // Re-render closed modal just like ChatView would
    act(() => {
      root!.render(<TestHarness modalOpen={false} />);
    });

    const aroundReq = sent.find((p) => p.type === 'history' && p.mode === 'around');
    expect(aroundReq).toBeDefined();
    expect(aroundReq).toMatchObject({
      type: 'history',
      mode: 'around',
      networkId: 1,
      target: '#lurker',
      anchorId: 42,
      limit: 100,
    });
    expect(typeof aroundReq!.token).toBe('number');
    // Must not have fired a redundant latest hydration
    expect(sent.filter((p) => p.type === 'history' && p.mode === 'latest')).toHaveLength(0);

    // Server returns surrounding slice [40..44] around anchor 42
    act(() => {
      useBuffersStore.getState().applyAroundSlice(1, '#lurker', {
        token: aroundReq!.token,
        anchorId: 42,
        hasMoreOlder: true,
        hasMoreNewer: true,
        events: [
          makeMessage(40, 'amiantos', 'earlier line 1'),
          makeMessage(41, 'slakker', 'earlier line 2'),
          makeMessage(42, 'fabricionaweb', 'Jawsh: check context around here', { matched: true } as any),
          makeMessage(43, 'Jawsh', 'reply after'),
          makeMessage(44, 'amiantos', 'followup after'),
        ],
      });
    });

    expect(container.textContent).toContain('earlier line 1');
    expect(container.textContent).toContain('reply after');
    expect(container.textContent).toContain('Return to present');

    const row42 = container.querySelector('[data-msg-id="42"]');
    expect(row42).toBeTruthy();
    expect(scrolledIds).toContain('42');
    expect(row42!.classList.contains('msg-jump-glow')).toBe(true);

    // Glow stays visible for a couple seconds before cleanly clearing
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(container.querySelector('[data-msg-id="42"]')!.classList.contains('msg-jump-glow')).toBe(
      true,
    );

    act(() => {
      vi.advanceTimersByTime(1800);
    });
    expect(container.querySelector('[data-msg-id="42"]')!.classList.contains('msg-jump-glow')).toBe(
      false,
    );
  });

  it('fast-paths in-memory highlights, bookmarks (messageId), search hits, toasts, and reply quotes', () => {
    useBuffersStore.getState().replaceBacklog(
      1,
      '#lurker',
      [
        makeMessage(10, 'amiantos', 'original message for reply & clear', { msgid: 'm10' }),
        makeMessage(11, 'd3fc0n', 'bookmarked snippet'),
        makeMessage(12, 'slakker', 'searchable text hit'),
        makeMessage(13, 'lurkerbot', 'toast mention hit', { matched: true } as any),
        makeMessage(14, 'Jawsh', 'replying to amiantos', {
          replyTo: {
            msgid: 'm10',
            parent: { id: 10, nick: 'amiantos', type: 'message', text: 'original message', userhost: null, self: false },
          },
        } as any),
      ],
      [],
      null,
      true,
    );
    // Simulate /clear hiding message 10 from live view
    useBuffersStore.getState().applyClearedState(1, '#lurker', { clearedBeforeId: 10 });
    useBuffersStore.getState().activate(1, '#lurker');

    useBookmarksStore.setState({
      items: [
        {
          id: 999, // bookmark row id must NOT be jumped to — item.messageId (11) must be used!
          messageId: 11,
          networkId: 1,
          target: '#lurker',
          nick: 'd3fc0n',
          type: 'message',
          text: 'bookmarked snippet',
          createdAt: '2026-11-25T10:11:00Z',
          bookmarkedAt: '2026-11-25T10:12:00Z',
        },
      ],
      loaded: true,
    });

    useSearchStore.setState({
      open: true,
      query: 'searchable',
      results: [
        {
          id: 12,
          networkId: 1,
          target: '#lurker',
          nick: 'slakker',
          text: 'searchable text hit',
          createdAt: '2026-11-25T10:12:00Z',
        },
      ],
    });

    useToastsStore.getState().push({
      kind: 'highlight',
      title: 'lurkerbot in #lurker',
      body: 'toast mention hit',
      networkId: 1,
      target: '#lurker',
      messageId: 13,
    });

    const Harness: React.FC = () => {
      const active = useBuffersStore((s) => s.buffers['1::#lurker']);
      return (
        <>
          {active && <MessageList buffer={active} onOpenReactionPicker={() => {}} />}
          <BookmarksModal open onClose={() => {}} />
          <SearchModal />
          <ToastsOverlay />
        </>
      );
    };

    root = createRoot(container);
    act(() => {
      root!.render(<Harness />);
    });

    // 1. Bookmark click jumps to messageId 11 (not 999) without fetching history
    const bmBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('bookmarked snippet'),
    );
    act(() => {
      bmBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(sent.filter((p) => p.type === 'history')).toHaveLength(0);
    expect(container.querySelector('[data-msg-id="11"]')!.classList.contains('msg-jump-glow')).toBe(
      true,
    );

    // 2. Search result click closes search and glows msg 12
    const searchBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('searchable text hit'),
    );
    act(() => {
      searchBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(useSearchStore.getState().open).toBe(false);
    expect(container.querySelector('[data-msg-id="12"]')!.classList.contains('msg-jump-glow')).toBe(
      true,
    );

    // 3. Toast click dismisses toast and glows msg 13
    const toastTitle = Array.from(container.querySelectorAll('strong')).find((el) =>
      el.textContent?.includes('lurkerbot in #lurker'),
    );
    act(() => {
      toastTitle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(useToastsStore.getState().items).toHaveLength(0);
    expect(container.querySelector('[data-msg-id="13"]')!.classList.contains('msg-jump-glow')).toBe(
      true,
    );

    // 4. Reply quote click on msg 14 detaches past /clear (clearedBeforeId=10) so msg 10 appears & glows
    const quoteEl = container.querySelector('[title="Jump to replied message"]');
    expect(quoteEl).toBeTruthy();
    act(() => {
      quoteEl!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(useBuffersStore.getState().buffers['1::#lurker'].detached).toBe(true);
    expect(container.querySelector('[data-msg-id="10"]')!.classList.contains('msg-jump-glow')).toBe(
      true,
    );
  });

  it('centers windowAroundAnchor and handles disconnected loadAround cleanly', () => {
    const events = Array.from({ length: 10 }, (_, idx) =>
      makeMessage(idx + 1, 'nick', `msg ${idx + 1}`),
    );
    const win = windowAroundAnchor(events, 5, 4);
    expect(win.events.map((m) => m.id)).toEqual([3, 4, 5, 6]);
    expect(win.trimmedOlder).toBe(true);
    expect(win.trimmedNewer).toBe(true);

    // Disconnected send should roll back loadingHistory & detached and return null
    registerSocketSenders(
      () => false,
      async () => ({ ok: false, error: 'offline' }),
    );
    useBuffersStore.getState().ensure(1, '#lurker', 12);
    const token = useBuffersStore.getState().loadAround(1, '#lurker', 50);
    expect(token).toBeNull();
    const buf = useBuffersStore.getState().buffers['1::#lurker'];
    expect(buf.loadingHistory).toBe(false);
    expect(buf.detached).toBe(false);
    expect(useDesktopUiStore.getState().pendingMessageJump).toBeNull();
  });
});
