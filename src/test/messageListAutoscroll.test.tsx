import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageList } from '../components/MessageList';
import { useBuffersStore, type BufferMessage } from '../stores/buffers';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CAP = 500; // MAX_PER_BUFFER in stores/buffers.ts

function msg(id: number): BufferMessage {
  return {
    id,
    networkId: 1,
    target: '#lobby',
    type: 'message',
    nick: id % 2 ? 'alice' : 'bob',
    text: `line ${id}`,
    time: new Date(Date.UTC(2026, 10, 21, 12, 0, 0) + id * 1000).toISOString(),
  } as BufferMessage;
}

// Subscribes to the store the same way ChatView does, so pushLive re-renders.
const LiveList: React.FC = () => {
  const buf = useBuffersStore((s) =>
    Object.values(s.buffers).find((b) => b.networkId === 1 && b.target === '#lobby'),
  );
  if (!buf) return null;
  return React.createElement(MessageList, { buffer: buf, onOpenReactionPicker: () => {} });
};

// jsdom has no layout: give the scroller a fake geometry that grows per row.
function fakeLayout(el: HTMLElement, rowCount: () => number) {
  let top = 0;
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 400 });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => rowCount() * 20 });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(v, rowCount() * 20 - 400));
    },
  });
}

describe('MessageList auto-scroll', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let nextId = 1;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    useBuffersStore.setState({ buffers: {} });
    nextId = 1;
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
  });

  function mountWith(count: number): HTMLElement {
    const buf = useBuffersStore.getState().ensure(1, '#lobby', 10);
    buf.messages = Array.from({ length: count }, () => msg(nextId++));
    useBuffersStore.setState((s) => ({ buffers: { ...s.buffers } }));
    root = createRoot(container);
    act(() => root!.render(React.createElement(LiveList)));
    const el = container.querySelector('.message-list') as HTMLElement;
    // Row count is driven by how many messages have ever been pushed, so the
    // content keeps growing taller even when the store trims to the cap.
    fakeLayout(el, () => nextId - 1);
    el.scrollTop = el.scrollHeight; // user is parked at the bottom
    act(() => el.dispatchEvent(new Event('scroll')));
    return el;
  }

  function pushLive() {
    act(() => {
      useBuffersStore.getState().pushLive(msg(nextId++));
    });
  }

  const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;

  it('follows new messages below the buffer cap', () => {
    const el = mountWith(50);
    pushLive();
    expect(atBottom(el)).toBe(0);
  });

  it('keeps following new messages once the buffer is full (length pinned at cap)', () => {
    const el = mountWith(CAP);
    pushLive();
    const held = Object.values(useBuffersStore.getState().buffers)[0].messages.length;
    expect(held).toBe(CAP);
    expect(atBottom(el)).toBe(0);
    pushLive();
    pushLive();
    expect(atBottom(el)).toBe(0);
  });

  it('does not yank the view when the user has scrolled up', () => {
    const el = mountWith(CAP);
    el.scrollTop = 0;
    act(() => el.dispatchEvent(new Event('scroll')));
    pushLive();
    expect(el.scrollTop).toBe(0);
  });
});
