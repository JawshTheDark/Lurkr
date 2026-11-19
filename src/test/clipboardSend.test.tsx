// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageInput } from '../components/MessageInput';
import { useAuthStore } from '../stores/auth';
import { useBuffersStore } from '../stores/buffers';
import { useUploadsStore } from '../stores/uploads';
import { useToastsStore } from '../stores/toasts';
import { useDraftStore } from '../stores/drafts';
import { registerSocketSenders } from '../services/socketBus';
import { ensureUploadFilename, pastedUploadFiles } from '../utils/uploaders';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makePasteEvent(opts: {
  items?: Array<{ kind: string; getAsFile: () => File | null }>;
  files?: File[];
  text?: string;
}): Event {
  const evt = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(evt, 'clipboardData', {
    value: {
      items: opts.items ?? [],
      files: opts.files ?? [],
      getData: (type: string) => (type === 'text/plain' ? opts.text ?? '' : ''),
    },
  });
  return evt;
}

describe('Clipboard screenshot paste & send', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let sentAcked: Record<string, unknown>[];
  const origUpload = useUploadsStore.getState().upload;
  const origLurkerDesktop = window.lurkerDesktop;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    sentAcked = [];

    registerSocketSenders(
      () => true,
      async (payload) => {
        sentAcked.push(payload);
        return { ok: true };
      },
    );

    useAuthStore.setState({
      user: { id: 1, username: 'jawsh', role: 'admin' },
      checked: true,
    });
    useBuffersStore.getState().reset();
    useBuffersStore.getState().ensure(1, '#test', 10);
    useDraftStore.getState().reset();
    useToastsStore.getState().clear();
    useUploadsStore.getState().reset();
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    container.remove();
    useUploadsStore.setState({ upload: origUpload });
    window.lurkerDesktop = origLurkerDesktop;
    useToastsStore.getState().clear();
  });

  it('extracts clipboard screenshots from items or files and supplies non-empty filenames', () => {
    expect(ensureUploadFilename('', 'image/png')).toBe('screenshot.png');
    expect(ensureUploadFilename('', 'image/jpeg')).toBe('screenshot.jpg');

    const unnamedPng = new File([new Uint8Array([137, 80, 78, 71])], '', { type: 'image/png' });
    const evFromFiles = makePasteEvent({ files: [unnamedPng] }) as ClipboardEvent;
    const files = pastedUploadFiles(evFromFiles);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('screenshot.png');

    const plainTextEv = makePasteEvent({ text: 'hello' }) as ClipboardEvent;
    expect(pastedUploadFiles(plainTextEv)).toEqual([]);
  });

  it('queues Enter/Send when a pasted clipboard screenshot is still uploading and sends automatically once uploaded', async () => {
    let resolveUpload!: (res: { id: number; url: string; mime: string; can_delete: boolean }) => void;
    const uploadSpy = vi.fn(
      () =>
        new Promise<{ id: number; url: string; mime: string; can_delete: boolean }>((resolve) => {
          resolveUpload = resolve;
        }),
    );
    useUploadsStore.setState({ upload: uploadSpy });

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(MessageInput, { networkId: 1, target: '#test' }));
    });

    const textarea = container.querySelector('textarea')!;
    const sendBtn = container.querySelector('button[title*="Send"]') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);

    const png = new File([new Uint8Array([1, 2, 3, 4])], 'image.png', { type: 'image/png' });
    const pasteEv = makePasteEvent({
      items: [{ kind: 'file', getAsFile: () => png }],
    });

    act(() => {
      textarea.dispatchEvent(pasteEv);
    });

    expect(pasteEv.defaultPrevented).toBe(true);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('image.png');
    expect(container.textContent).toContain('Uploading...');
    expect(sendBtn.disabled).toBe(false);

    // Hit Enter immediately before upload completes.
    const enterEv = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => {
      textarea.dispatchEvent(enterEv);
    });

    expect(enterEv.defaultPrevented).toBe(true);
    expect(container.textContent).toContain('Sending after upload...');
    expect(sentAcked).toHaveLength(0);

    await act(async () => {
      resolveUpload({
        id: 42,
        url: 'https://lurker.example/uploads/abc.png',
        mime: 'image/png',
        can_delete: true,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sentAcked.filter((f) => f.type === 'send')).toEqual([
      {
        type: 'send',
        networkId: 1,
        target: '#test',
        text: 'https://lurker.example/uploads/abc.png',
      },
    ]);
  });

  it('uses Electron native readClipboardImage fallback and combines typed caption on Send click', async () => {
    window.lurkerDesktop = {
      isElectron: true,
      platform: 'linux',
      getConfig: async () => ({ serverUrl: 'https://lurker.example', allowSelfSigned: false }),
      setConfig: async () => ({ serverUrl: 'https://lurker.example', allowSelfSigned: false }),
      setBadge: async () => {},
      notify: async () => {},
      openExternal: async () => {},
      readClipboardImage: async () => ({
        data: new Uint8Array([137, 80, 78, 71]),
        mime: 'image/png',
        filename: 'screenshot.png',
      }),
      onNavigate: () => () => {},
    };

    let resolveUpload!: (res: { id: number; url: string; mime: string; can_delete: boolean }) => void;
    const uploadSpy = vi.fn(
      () =>
        new Promise<{ id: number; url: string; mime: string; can_delete: boolean }>((resolve) => {
          resolveUpload = resolve;
        }),
    );
    useUploadsStore.setState({ upload: uploadSpy });

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(MessageInput, { networkId: 1, target: '#test' }));
    });

    const textarea = container.querySelector('textarea')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(textarea, 'look at this:');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Simulate Linux Electron paste where DOM clipboardData has no items/files and no plain text.
    const emptyPaste = makePasteEvent({ items: [], files: [], text: '' });
    await act(async () => {
      textarea.dispatchEvent(emptyPaste);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(emptyPaste.defaultPrevented).toBe(true);
    expect(uploadSpy).toHaveBeenCalledTimes(1);

    const sendBtn = container.querySelector('button[title*="Send"]') as HTMLButtonElement;
    act(() => {
      sendBtn.click();
    });

    await act(async () => {
      resolveUpload({
        id: 43,
        url: 'https://lurker.example/uploads/clip.png',
        mime: 'image/png',
        can_delete: true,
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sentAcked.filter((f) => f.type === 'send')).toEqual([
      {
        type: 'send',
        networkId: 1,
        target: '#test',
        text: 'look at this: https://lurker.example/uploads/clip.png',
      },
    ]);
  });

  it('aborts queued send and surfaces error when clipboard upload fails', async () => {
    let rejectUpload!: (err: Error) => void;
    const uploadSpy = vi.fn(
      () =>
        new Promise<{ id: number; url: string; mime: string; can_delete: boolean }>((_, reject) => {
          rejectUpload = reject;
        }),
    );
    useUploadsStore.setState({ upload: uploadSpy });

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(MessageInput, { networkId: 1, target: '#test' }));
    });

    const textarea = container.querySelector('textarea')!;
    const png = new File([new Uint8Array([1, 2, 3])], 'broken.png', { type: 'image/png' });
    act(() => {
      textarea.dispatchEvent(
        makePasteEvent({ items: [{ kind: 'file', getAsFile: () => png }] }),
      );
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });

    await act(async () => {
      rejectUpload(new Error('video/webm files are not accepted — Lurker takes mp4, mov, or images'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sentAcked).toHaveLength(0);
    expect(container.textContent).toContain('video/webm files are not accepted — Lurker takes mp4, mov, or images');
    const errEl = Array.from(container.querySelectorAll('div')).find((el) =>
      el.textContent === 'video/webm files are not accepted — Lurker takes mp4, mov, or images',
    );
    expect(errEl).toBeTruthy();
    expect(errEl?.className).not.toContain('truncate');
    expect(errEl?.getAttribute('title')).toBe(
      'video/webm files are not accepted — Lurker takes mp4, mov, or images',
    );
    expect(useToastsStore.getState().items.some((t) => t.title === 'Upload failed')).toBe(true);
  });
});
