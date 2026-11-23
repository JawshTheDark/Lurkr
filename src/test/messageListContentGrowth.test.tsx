import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageList } from '../components/MessageList';
import { useBuffersStore, type BufferMessage } from '../stores/buffers';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has neither layout nor ResizeObserver: record observers so the test can
// fire them the way the browser does when a row grows (a link preview card or
// an image arriving after its message).
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

const isObserved = (el: Element) => observers.some((o) => o.targets.has(el));

function fireResize(el: Element) {
  for (const o of observers) {
    if (o.targets.has(el)) {
      o.cb([{ target: el } as ResizeObserverEntry], o as unknown as ResizeObserver);
    }
  }
}

let nextId = 1;
function msg(text: string): BufferMessage {
  const id = nextId++;
  return {
    id,
    networkId: 1,
    target: '#lobby',
    type: 'message',
    nick: id % 2 ? 'alice' : 'bob',
    text,
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

describe('MessageList follows content that grows after its message renders', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let content = 0;
  const VIEWPORT = 400;
  const ROW_H = 20;
  const PREVIEW_H = 120;
  const savedRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;

  beforeEach(() => {
    observers.length = 0;
    nextId = 1;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    container = document.createElement('div');
    document.body.appendChild(container);
    useBuffersStore.setState({ buffers: {} });
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = savedRO;
  });

  function mount(): HTMLElement {
    const buf = useBuffersStore.getState().ensure(1, '#lobby', 10);
    buf.messages = Array.from({ length: 100 }, (_, i) => msg(`line ${i + 1}`));
    useBuffersStore.setState((s) => ({ buffers: { ...s.buffers } }));
    root = createRoot(container);
    act(() => root!.render(React.createElement(LiveList)));
    const el = container.querySelector('.message-list') as HTMLElement;
    content = 100 * ROW_H;
    let top = 0;
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => VIEWPORT });
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => content });
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = Math.max(0, Math.min(v, content - VIEWPORT));
      },
    });
    el.scrollTop = el.scrollHeight;
    act(() => el.dispatchEvent(new Event('scroll')));
    return el;
  }

  const gap = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;
  const newestRow = (el: HTMLElement) => el.lastElementChild as HTMLElement;

  function say(text: string) {
    content += ROW_H;
    act(() => {
      useBuffersStore.getState().pushLive(msg(text));
    });
  }

  // MutationObserver callbacks run as microtasks.
  const flushMutations = () => act(async () => {});

  it('re-pins when the newest row grows (a link preview card arrives)', async () => {
    const el = mount();
    say('check this https://example.com/');
    await flushMutations();
    expect(gap(el)).toBe(0);

    content += PREVIEW_H;
    act(() => fireResize(newestRow(el)));
    expect(gap(el)).toBe(0);
  });

  it('keeps following when a late scroll event sees the grown gap', () => {
    const el = mount();
    // The preview renders before the scroll event from the last pin is
    // dispatched (Chromium defers it to the next frame, which for a hidden or
    // occluded window can be much later): scrollTop has not moved, the gap is
    // large. This must not read as the user scrolling away.
    content += PREVIEW_H;
    act(() => el.dispatchEvent(new Event('scroll')));
    act(() => fireResize(newestRow(el)));
    expect(gap(el)).toBe(0);

    say('next message');
    expect(gap(el)).toBe(0);
  });

  it('does not move a view the user scrolled up', () => {
    const el = mount();
    el.scrollTop = el.scrollTop - 300;
    act(() => el.dispatchEvent(new Event('scroll')));
    const before = el.scrollTop;

    content += PREVIEW_H;
    act(() => fireResize(newestRow(el)));
    say('next message');
    expect(el.scrollTop).toBe(before);
  });

  it('observes rows added later and stops observing trimmed ones', async () => {
    const el = mount();
    const first = el.firstElementChild as HTMLElement;
    expect(isObserved(first)).toBe(true);

    say('a new row');
    await flushMutations();
    expect(isObserved(newestRow(el))).toBe(true);

    // Trim the oldest row, as the MAX_PER_BUFFER cap does.
    act(() =>
      useBuffersStore.setState((s) => {
        const key = Object.keys(s.buffers)[0];
        const b = s.buffers[key];
        return { buffers: { ...s.buffers, [key]: { ...b, messages: b.messages.slice(1) } } };
      }),
    );
    await flushMutations();
    expect(first.isConnected).toBe(false);
    expect(isObserved(first)).toBe(false);
  });
});
