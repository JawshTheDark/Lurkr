// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MessageList } from '../components/MessageList';
import { StatusBar } from '../components/StatusBar';
import { registerAllSessionResets } from '../stores/registerResets';
import { resetSession } from '../stores/sessionReset';
import { useBuffersStore, type BufferMessage } from '../stores/buffers';
import { useNetworksStore } from '../stores/networks';
import { useScrollStateStore } from '../stores/scrollState';
import { registerSocketSenders } from '../services/socketBus';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
registerAllSessionResets();

function makeMsg(id: number, nick = 'd3fc0n', text = `line ${id}`): BufferMessage {
  return {
    id,
    networkId: 1,
    target: '#lurker',
    type: 'message',
    nick,
    text,
    time: `2026-11-26T19:${String(id % 60).padStart(2, '0')}:00Z`,
  };
}

describe('Jump to Unread (StatusBar + MessageList)', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let sent: Record<string, unknown>[] = [];
  let scrolledClasses: string[] = [];
  const origScrollIntoView = Element.prototype.scrollIntoView;
  const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;

  beforeEach(() => {
    resetSession();
    sent = [];
    scrolledClasses = [];
    registerSocketSenders(
      (payload) => {
        sent.push(payload);
        return true;
      },
      async () => ({ ok: true }),
    );
    Element.prototype.scrollIntoView = function () {
      scrolledClasses.push(this.className || this.tagName);
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    useNetworksStore.setState({
      networks: [
        { id: 1, name: 'Libera.Chat', host: 'irc.libera.chat', port: 6697, nick: 'Jawsh', tls: true },
      ],
      states: {
        1: { networkId: 1, channels: ['#lurker'], state: 'connected', nick: 'Jawsh' },
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
    Element.prototype.getBoundingClientRect = origGetBoundingClientRect;
    resetSession();
  });

  it('surfaces Unread ↑ in StatusBar and floating Jump to unread when off-screen, and scrolls to divider', () => {
    // Seed 25 messages with lastReadId=10 (so divider sits before msg 11, above viewport).
    const msgs = Array.from({ length: 25 }, (_, i) => makeMsg(i + 1));
    // Remove message 10 to verify placement still lands right before msg 11 even if boundary filtered!
    const filteredMsgs = msgs.filter((m) => m.id !== 10);
    useBuffersStore.getState().replaceBacklog(1, '#lurker', filteredMsgs, [], {
      lastReadId: 10,
      unread: 15,
      highlighted: 0,
    }, true);
    useBuffersStore.getState().activate(1, '#lurker');

    Element.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('message-list')) {
        return { top: 100, bottom: 500, left: 0, right: 600, width: 600, height: 400 } as DOMRect;
      }
      if (this.classList.contains('unread-divider')) {
        return { top: -180, bottom: -160, left: 0, right: 600, width: 600, height: 20 } as DOMRect;
      }
      return { top: 100, bottom: 120, left: 0, right: 600, width: 600, height: 20 } as DOMRect;
    };

    const Harness: React.FC = () => {
      const buf = useBuffersStore((s) => s.buffers['1::#lurker']);
      return (
        <>
          {buf && <MessageList buffer={buf} onOpenReactionPicker={() => {}} />}
          <StatusBar />
        </>
      );
    };

    root = createRoot(container);
    act(() => {
      root!.render(<Harness />);
    });

    const divider = container.querySelector('.unread-divider');
    expect(divider).toBeTruthy();
    expect(divider!.nextElementSibling?.getAttribute('data-msg-id')).toBe('11');

    // StatusBar + MessageList jump controls are visible
    const sbBtn = container.querySelector('[data-testid="statusbar-jump-unread"]') as HTMLButtonElement;
    const pill = container.querySelector('[data-testid="jump-unread-pill"]') as HTMLDivElement;
    expect(sbBtn?.textContent).toBe('Unread ↑');
    expect(pill?.textContent).toContain('Jump to unread');

    // Clicking Unread ↑ scrolls divider into view and clears unread controls
    act(() => {
      sbBtn.click();
    });
    expect(scrolledClasses).toContain('unread-divider');
    expect(useScrollStateStore.getState().unreadAnchor).toBeNull();
    expect(container.querySelector('[data-testid="statusbar-jump-unread"]')).toBeNull();
    expect(container.querySelector('[data-testid="jump-unread-pill"]')).toBeNull();
  });

  it('loads around dividerAfterId when backlog >200 unread messages sit above loaded tail (#216)', async () => {
    const tailMsgs = Array.from({ length: 10 }, (_, i) => makeMsg(250 + i));
    useBuffersStore.getState().replaceBacklog(
      1,
      '#lurker',
      tailMsgs,
      [],
      { lastReadId: 10, unread: 249, highlighted: 0 },
      true,
      { hasMoreOlder: true },
    );
    useBuffersStore.getState().activate(1, '#lurker');

    Element.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('message-list')) {
        return { top: 100, bottom: 500, left: 0, right: 600, width: 600, height: 400 } as DOMRect;
      }
      if (this.classList.contains('unread-divider')) {
        return { top: 120, bottom: 140, left: 0, right: 600, width: 600, height: 20 } as DOMRect;
      }
      return { top: 200, bottom: 220, left: 0, right: 600, width: 600, height: 20 } as DOMRect;
    };

    const Harness: React.FC = () => {
      const buf = useBuffersStore((s) => s.buffers['1::#lurker']);
      return (
        <>
          {buf && <MessageList buffer={buf} onOpenReactionPicker={() => {}} />}
          <StatusBar />
        </>
      );
    };

    root = createRoot(container);
    act(() => {
      root!.render(<Harness />);
    });

    // Even when placeholder top divider sits inside viewport, >200 unread msgs keeps Unread ↑ armed!
    const jumpBtn = container
      .querySelector('[data-testid="jump-unread-pill"] button') as HTMLButtonElement;
    expect(jumpBtn).toBeTruthy();

    act(() => {
      jumpBtn.click();
    });

    const aroundReq = sent.find((p) => p.type === 'history' && p.mode === 'around');
    expect(aroundReq).toMatchObject({
      type: 'history',
      mode: 'around',
      networkId: 1,
      target: '#lurker',
      anchorId: 10,
    });

    // Server returns surrounding slice [8..12]
    act(() => {
      useBuffersStore.getState().applyAroundSlice(1, '#lurker', {
        token: aroundReq!.token,
        anchorId: 10,
        hasMoreOlder: true,
        hasMoreNewer: true,
        events: [makeMsg(8), makeMsg(9), makeMsg(10), makeMsg(11), makeMsg(12)],
      });
    });

    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });

    const divider = container.querySelector('.unread-divider');
    expect(divider).toBeTruthy();
    expect(divider!.nextElementSibling?.getAttribute('data-msg-id')).toBe('11');
    expect(scrolledClasses).toContain('unread-divider');
    expect(useScrollStateStore.getState().unreadAnchor).toBeNull();
  });

  it('hides jump controls when divider is already on-screen or dismissed, and keeps boundary pinned on pushLive', () => {
    const msgs = Array.from({ length: 5 }, (_, i) => makeMsg(i + 1));
    useBuffersStore.getState().replaceBacklog(
      1,
      '#lurker',
      msgs,
      [],
      { lastReadId: 2, unread: 3, highlighted: 0 },
      true,
    );
    useBuffersStore.getState().activate(1, '#lurker');

    Element.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('message-list')) {
        return { top: 100, bottom: 500, left: 0, right: 600, width: 600, height: 400 } as DOMRect;
      }
      if (this.classList.contains('unread-divider')) {
        return { top: 220, bottom: 240, left: 0, right: 600, width: 600, height: 20 } as DOMRect;
      }
      return { top: 250, bottom: 270, left: 0, right: 600, width: 600, height: 20 } as DOMRect;
    };

    const Harness: React.FC = () => {
      const buf = useBuffersStore((s) => s.buffers['1::#lurker']);
      return buf ? <MessageList buffer={buf} onOpenReactionPicker={() => {}} /> : null;
    };

    root = createRoot(container);
    act(() => {
      root!.render(<Harness />);
    });

    // Divider is in viewport -> no jump controls needed
    expect(container.querySelector('[data-testid="jump-unread-pill"]')).toBeNull();

    // Arrival of live message must keep dividerAfterId pinned at 2 since boundary is visible
    act(() => {
      useBuffersStore.getState().pushLive(makeMsg(6, 'alice', 'new live msg'));
    });
    expect(useBuffersStore.getState().buffers['1::#lurker'].dividerAfterId).toBe(2);
  });
});
