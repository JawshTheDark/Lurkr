// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { primePreviews, clearPreviewCache, type LinkPreview } from '../hooks/useLinkPreview';
import { MessageAttachments } from '../components/MessageAttachments';
import { useConfigStore } from '../stores/config';
import { useSettingsStore } from '../stores/settings';
import { useBuffersStore } from '../stores/buffers';
import { connectSocket, resetSocket } from '../services/socket';
import { setServerUrl } from '../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Link previews', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  const origFetch = globalThis.fetch;
  const origWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    clearPreviewCache();
    useConfigStore.getState().reset();
    useSettingsStore.getState().reset();
    useBuffersStore.getState().reset();
    setServerUrl('https://lurker.example.com');
  });

  afterEach(() => {
    resetSocket();
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    container.remove();
    globalThis.fetch = origFetch;
    globalThis.WebSocket = origWebSocket;
    setServerUrl('');
    clearPreviewCache();
    vi.useRealTimers();
  });

  it('POSTs to /api/link-preview/resolve, parses previews array, and renders images and page cards', async () => {
    useConfigStore.setState({
      edition: 'standalone',
      features: { linkPreviews: true, bouncer: true, dcc: false },
      checked: true,
    });
    useSettingsStore.setState({
      values: {
        'chat.inline_media.enabled': true,
        'chat.link_previews.enabled': true,
      },
      loaded: true,
    });

    const requests: Array<{ url: string; body: unknown }> = [];
    const mockPreviews: LinkPreview[] = [
      {
        url: 'https://img.example.org/pic.png',
        status: 'ok',
        kind: 'image',
        src: '/api/link-preview/media/img-tok',
      },
      {
        url: 'https://news.example.org/story',
        status: 'ok',
        kind: 'page',
        title: 'Lurker News Story',
        description: 'Detailed summary here',
        siteName: 'Example News',
        thumb: '/api/link-preview/media/thumb-tok',
      },
      {
        url: 'https://photo-only.example.org/post',
        status: 'ok',
        kind: 'page',
        thumb: '/api/link-preview/media/og-only-tok',
      },
    ];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(JSON.stringify({ previews: mockPreviews }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    root = createRoot(container);
    act(() => {
      root!.render(
        React.createElement(MessageAttachments, {
          text: 'see https://img.example.org/pic.png and https://news.example.org/story and https://photo-only.example.org/post',
        }),
      );
    });

    primePreviews(
      [
        'see https://img.example.org/pic.png and https://news.example.org/story and https://photo-only.example.org/post',
      ],
      { inlineMedia: true, linkPreviews: true },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://lurker.example.com/api/link-preview/resolve');
    expect(requests[0].body).toEqual({
      urls: [
        'https://img.example.org/pic.png',
        'https://news.example.org/story',
        'https://photo-only.example.org/post',
      ],
    });

    const imgs = Array.from(container.querySelectorAll('img')).map((el) => el.getAttribute('src'));
    expect(imgs).toContain('https://lurker.example.com/api/link-preview/media/img-tok');
    expect(imgs).toContain('https://lurker.example.com/api/link-preview/media/thumb-tok');
    expect(imgs).toContain('https://lurker.example.com/api/link-preview/media/og-only-tok');
    expect(container.textContent).toContain('Lurker News Story');
    expect(container.textContent).toContain('Detailed summary here');
    expect(container.textContent).toContain('photo-only.example.org');
  });

  it('recovers and retries URLs after transient failure or omitted server answers', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response('Upstream error', { status: 502 });
      }
      return new Response(
        JSON.stringify({
          previews: [
            {
              url: 'https://retry.example.org/page',
              status: 'ok',
              kind: 'page',
              title: 'Recovered Preview',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    primePreviews(['https://retry.example.org/page'], { inlineMedia: false, linkPreviews: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });
    expect(callCount).toBe(1);

    // Failed URL was not permanently wedged in `asked`, so a subsequent prime retries cleanly.
    primePreviews(['https://retry.example.org/page'], { inlineMedia: false, linkPreviews: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });
    expect(callCount).toBe(2);

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(MessageAttachments, { text: 'https://retry.example.org/page' }));
      useConfigStore.setState({
        features: { linkPreviews: true, bouncer: false, dcc: false },
        checked: true,
      });
      useSettingsStore.setState({
        values: { 'chat.link_previews.enabled': true },
        loaded: true,
      });
    });
    expect(container.textContent).toContain('Recovered Preview');
  });

  it('re-primes loaded buffers when settings and config load after backlog arrives', async () => {
    class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = MockWebSocket.OPEN;
      url: string;
      private listeners = new Map<string, Array<(e?: any) => void>>();
      constructor(url: string) {
        this.url = url;
      }
      addEventListener(ev: string, cb: (e?: any) => void) {
        const list = this.listeners.get(ev) || [];
        list.push(cb);
        this.listeners.set(ev, list);
      }
      send() {}
      close() {
        this.readyState = MockWebSocket.CLOSED;
      }
    }
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

    const requestedUrls: string[] = [];
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      requestedUrls.push(...(body.urls || []));
      return new Response(JSON.stringify({ previews: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    useBuffersStore.getState().replaceBacklog(
      1,
      '#lurker',
      [
        {
          id: 101,
          networkId: 1,
          target: '#lurker',
          type: 'message',
          nick: 'alice',
          text: 'check https://late-settings.example.org/demo',
          time: Date.now(),
        },
      ],
      [],
      null,
      true,
      { reset: true },
    );

    connectSocket();
    // Before config/settings arrive, nothing is requested yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });
    expect(requestedUrls).toEqual([]);

    // Once config & settings arrive asynchronously after backlog, loaded buffers auto-prime!
    act(() => {
      useConfigStore.setState({
        features: { linkPreviews: true, bouncer: false, dcc: false },
        checked: true,
      });
      useSettingsStore.setState({
        values: { 'chat.link_previews.enabled': true },
        loaded: true,
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });
    expect(requestedUrls).toEqual(['https://late-settings.example.org/demo']);
  });

  it('opens page, video-embed, and media file preview links externally via desktop bridge and falls back to window.open', async () => {
    const openedExternal: string[] = [];
    const openedWindow: string[] = [];
    const prevDesktop = window.lurkerDesktop;
    const prevWindowOpen = window.open;

    window.open = ((u?: string | URL) => {
      if (u) openedWindow.push(String(u));
      return null;
    }) as typeof window.open;

    window.lurkerDesktop = {
      isElectron: true,
      platform: 'linux',
      getConfig: async () => ({ serverUrl: 'https://lurker.example.com', allowSelfSigned: false }),
      setConfig: async () => ({ serverUrl: 'https://lurker.example.com', allowSelfSigned: false }),
      setBadge: async () => {},
      notify: async () => {},
      openExternal: async (u: string) => {
        openedExternal.push(u);
      },
      onNavigate: () => () => {},
    };

    try {
      useConfigStore.setState({
        features: { linkPreviews: true, bouncer: false, dcc: false },
        checked: true,
      });
      useSettingsStore.setState({
        values: {
          'chat.inline_media.enabled': true,
          'chat.link_previews.enabled': true,
        },
        loaded: true,
      });

      const previews: LinkPreview[] = [
        {
          url: 'https://docs.example.org/guide',
          status: 'ok',
          kind: 'page',
          title: 'Guide Page',
          description: 'Helpful guide',
        },
        {
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          status: 'ok',
          kind: 'video-embed',
          title: 'Sample Video',
          embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
          thumb: '/api/link-preview/media/yt-thumb',
        },
        {
          url: 'https://cdn.example.org/clip.mp4',
          status: 'ok',
          kind: 'video',
          title: 'clip.mp4',
          mime: 'video/mp4',
        },
      ];

      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ previews }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ) as typeof fetch;

      const text = previews.map((p) => p.url).join(' ');
      primePreviews([text], { inlineMedia: true, linkPreviews: true });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(80);
      });

      root = createRoot(container);
      act(() => {
        root!.render(React.createElement(MessageAttachments, { text }));
      });

      const links = Array.from(container.querySelectorAll('a'));
      expect(links.map((a) => a.getAttribute('href'))).toEqual([
        'https://docs.example.org/guide',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://cdn.example.org/clip.mp4',
      ]);

      for (const a of links) {
        expect(a.getAttribute('target')).toBe('_blank');
        await act(async () => {
          a.click();
          await Promise.resolve();
        });
      }

      expect(openedExternal).toEqual([
        'https://docs.example.org/guide',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://cdn.example.org/clip.mp4',
      ]);

      // Clicking "Play inline" activates the video-embed iframe with strict-origin-when-cross-origin
      const playBtn = container.querySelector('button[aria-label="Play Sample Video"]') as HTMLButtonElement;
      expect(playBtn).toBeTruthy();
      act(() => {
        playBtn.click();
      });
      const iframe = container.querySelector('iframe')!;
      expect(iframe).toBeTruthy();
      expect(iframe.getAttribute('src')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
      expect(iframe.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');

      // Verify rejection of desktop openExternal falls back cleanly to window.open
      window.lurkerDesktop.openExternal = async () => {
        throw new Error('desktop opener failed');
      };
      await act(async () => {
        links[0].click();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(openedWindow).toEqual(['https://docs.example.org/guide']);
    } finally {
      window.lurkerDesktop = prevDesktop;
      window.open = prevWindowOpen;
    }
  });
});
