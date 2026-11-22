import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageList } from '../components/MessageList';
import { useBuffersStore, type BufferMessage } from '../stores/buffers';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver: record observers so the test can fire them,
// the way the browser does when the composer below the list grows or shrinks.
type Observed = { cb: ResizeObserverCallback; targets: Set<Element> };
const observers: Observed[] = [];
class FakeResizeObserver {
  private rec: Observed;
  constructor(cb: ResizeObserverCallback) {
    this.rec = { cb, targets: new Set() };
    observers.push(this.rec);
  }
  observe(el: Element) {
    this.rec.targets.add(el);
  }
  unobserve(el: Element) {
    this.rec.targets.delete(el);
  }
  disconnect() {
    this.rec.targets.clear();
  }
}

function fireResize(el: Element) {
  for (const o of observers) {
    if (o.targets.has(el)) {
      o.cb([{ target: el } as ResizeObserverEntry], o as unknown as ResizeObserver);
    }
  }
}

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

const LiveList: React.FC = () => {
  const buf = useBuffersStore((s) =>
    Object.values(s.buffers).find((b) => b.networkId === 1 && b.target === '#lobby'),
  );
  if (!buf) return null;
  return React.createElement(MessageList, { buffer: buf, onOpenReactionPicker: () => {} });
};

describe('MessageList stays pinned when its viewport resizes', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let viewport = 400;
  const ROWS = 100;
  const ROW_H = 20;
  const savedRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;

  beforeEach(() => {
    observers.length = 0;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    container = document.createElement('div');
    document.body.appendChild(container);
    useBuffersStore.setState({ buffers: {} });
    viewport = 400;
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = savedRO;
  });

  function mount(): HTMLElement {
    const buf = useBuffersStore.getState().ensure(1, '#lobby', 10);
    buf.messages = Array.from({ length: ROWS }, (_, i) => msg(i + 1));
    useBuffersStore.setState((s) => ({ buffers: { ...s.buffers } }));
    root = createRoot(container);
    act(() => root!.render(React.createElement(LiveList)));
    const el = container.querySelector('.message-list') as HTMLElement;
    let top = 0;
    const max = () => ROWS * ROW_H - viewport;
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => viewport });
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => ROWS * ROW_H });
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = Math.max(0, Math.min(v, max()));
      },
    });
    el.scrollTop = el.scrollHeight;
    act(() => el.dispatchEvent(new Event('scroll')));
    return el;
  }

  const gap = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;

  it('keeps the newest message visible when the typing indicator shrinks the list', () => {
    const el = mount();
    expect(gap(el)).toBe(0);
    // Typing indicator appears in the composer: the list loses ~23px at the
    // bottom while scrollTop stays put (no scroll event fires).
    viewport -= 23;
    act(() => fireResize(el));
    expect(gap(el)).toBe(0);
  });

  it('does not move a scrolled-up view when the list resizes', () => {
    const el = mount();
    el.scrollTop = 300;
    act(() => el.dispatchEvent(new Event('scroll')));
    viewport -= 23;
    act(() => fireResize(el));
    expect(el.scrollTop).toBe(300);
  });

  it('cleans up its observer on unmount', () => {
    const el = mount();
    expect(observers.some((o) => o.targets.has(el))).toBe(true);
    act(() => root!.unmount());
    root = null;
    expect(observers.some((o) => o.targets.has(el))).toBe(false);
  });
});
