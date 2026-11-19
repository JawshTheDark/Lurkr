// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChatView } from '../views/ChatView';
import { ScrollingTopic } from '../components/ScrollingTopic';
import { useAuthStore } from '../stores/auth';
import { useNetworksStore } from '../stores/networks';
import { useBuffersStore } from '../stores/buffers';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Channel header & hover-scrolling topic', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    useAuthStore.setState({ user: { id: 1, username: 'jawsh', role: 'admin' }, checked: true });
    useNetworksStore.getState().reset();
    useBuffersStore.getState().reset();
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    container.remove();
  });

  it('keeps the full channel name non-shrinking ahead of a long topic', () => {
    useNetworksStore.setState({
      networks: [
        { id: 1, name: 'LurkerNet', host: 'irc.example.org', port: 6697, tls: true, nick: 'Jawsh' },
      ],
      states: {
        1: { networkId: 1, state: 'connected', nick: 'Jawsh', channels: ['#lobby'], userModes: 'iw' },
      },
    });
    const buf = useBuffersStore.getState().ensure(1, '#lobby', 10);
    useBuffersStore.getState().setTopic(
      1,
      '#lobby',
      'Lurker.Chat Lobby | Anything goes in lobby, #lurker for lurker, #bots for LLM bots, #amiantos for updates',
    );
    void buf;
    useBuffersStore.getState().activate(1, '#lobby');

    root = createRoot(container);
    act(() => {
      root!.render(
        React.createElement(MemoryRouter, null, React.createElement(ChatView)),
      );
    });

    const chanName = container.querySelector('[data-testid="header-channel-name"]') as HTMLElement;
    const topicEl = container.querySelector('[data-testid="channel-topic"]') as HTMLElement;
    expect(chanName).toBeTruthy();
    expect(chanName.textContent).toBe('#lobby');
    expect(chanName.className).toContain('shrink-0');
    expect(chanName.className).toContain('whitespace-nowrap');
    expect(topicEl).toBeTruthy();
    expect(topicEl.className).toContain('flex-1');
    expect(topicEl.className).toContain('min-w-0');
  });

  it('activates marquee scrolling when hovering an overflowing topic and supports wheel scrub', () => {
    const longTopic =
      'Lurker.Chat Lobby | Anything goes in lobby, #lurker for lurker, #bots for LLM bots';

    root = createRoot(container);
    act(() => {
      root!.render(
        React.createElement(ScrollingTopic, { topic: longTopic, networkId: 1 }),
      );
    });

    const viewport = container.querySelector('[data-testid="channel-topic"]') as HTMLDivElement;
    const track = viewport.querySelector('span.topic-scroll-track') as HTMLSpanElement;

    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 180 });
    Object.defineProperty(track, 'scrollWidth', { configurable: true, value: 520 });

    expect(track.className).toContain('topic-scroll-track-idle');
    expect(track.className).not.toContain('topic-scroll-track-active');

    act(() => {
      viewport.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    expect(track.className).toContain('topic-scroll-track-active');
    expect(track.style.getPropertyValue('--topic-scroll-dist')).toBe('-352px');
    expect(Number.parseFloat(track.style.getPropertyValue('--topic-scroll-duration'))).toBeGreaterThan(3.5);

    act(() => {
      viewport.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }),
      );
    });
    expect(viewport.scrollLeft).toBe(120);

    act(() => {
      viewport.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    });
    expect(track.className).toContain('topic-scroll-track-idle');
    expect(viewport.scrollLeft).toBe(0);
  });

  it('does not animate a short topic that fits cleanly in the viewport', () => {
    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(ScrollingTopic, { topic: 'Short topic', networkId: 1 }));
    });

    const viewport = container.querySelector('[data-testid="channel-topic"]') as HTMLDivElement;
    const track = viewport.querySelector('span.topic-scroll-track') as HTMLSpanElement;

    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 400 });
    Object.defineProperty(track, 'scrollWidth', { configurable: true, value: 90 });

    act(() => {
      viewport.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(track.className).not.toContain('topic-scroll-track-active');
  });
});
