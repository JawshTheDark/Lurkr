// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useUploadsStore,
  onInsertUrl,
  getCanInsert,
} from '../stores/uploads';
import { useAuthStore } from '../stores/auth';
import * as apiModule from '../api';
import { isUploadableType, isWebmFile } from '../utils/uploaders';

describe('useUploadsStore', () => {
  const origDesktop = window.lurkerDesktop;

  beforeEach(() => {
    useUploadsStore.getState().reset();
    useAuthStore.setState({ user: { id: 1, username: 'jawsh', role: 'admin' }, checked: true });
  });

  afterEach(() => {
    window.lurkerDesktop = origDesktop;
    vi.restoreAllMocks();
  });

  it('tracks insert-URL listeners and canInsert state', () => {
    expect(getCanInsert()).toBe(false);
    const received: string[] = [];
    const unsub = onInsertUrl((url) => received.push(url));
    expect(getCanInsert()).toBe(true);
    unsub();
    expect(getCanInsert()).toBe(false);
  });

  it('filters upload items by kind, favorites, and query', async () => {
    const store = useUploadsStore.getState();
    await store.setFilters({ query: 'cat', kind: 'image', favoritesOnly: true }).catch(() => {});

    expect(
      useUploadsStore.getState().matchesFilters({
        id: 1,
        url: 'https://x.test/cat.png',
        filename: 'cat.png',
        mime: 'image/png',
        favorite: true,
      }),
    ).toBe(true);

    expect(
      useUploadsStore.getState().matchesFilters({
        id: 2,
        url: 'https://x.test/dog.mp4',
        filename: 'dog.mp4',
        mime: 'video/mp4',
        favorite: true,
      }),
    ).toBe(false);

    expect(
      useUploadsStore.getState().matchesFilters({
        id: 3,
        url: 'https://x.test/cat.png',
        filename: 'cat.png',
        mime: 'image/png',
        favorite: false,
      }),
    ).toBe(false);
  });

  it('updates upload progress from WebSocket frames', () => {
    useUploadsStore.setState({
      current: {
        token: 'tok-1',
        phase: 'uploading',
        progress: 100,
        sentPercent: null,
        destination: null,
        filename: 'photo.png',
      },
    });

    useUploadsStore.getState().applyProgress({
      token: 'tok-1',
      phase: 'sending',
      percent: 55,
      destination: 'S3',
    });

    const cur = useUploadsStore.getState().current;
    expect(cur?.phase).toBe('sending');
    expect(cur?.sentPercent).toBe(55);
    expect(cur?.destination).toBe('S3');
  });

  it('recognizes webm MIME and filename variants in uploadable checks', () => {
    expect(isWebmFile('video/webm', 'clip.webm')).toBe(true);
    expect(isWebmFile('video/webm;codecs=vp9,opus', 'clip.bin')).toBe(true);
    expect(isWebmFile('audio/webm', 'voice.webm')).toBe(true);
    expect(isWebmFile('', 'Screencast_20261118_115849.webm')).toBe(true);
    expect(isWebmFile('video/mp4', 'video.mp4')).toBe(false);
    expect(isUploadableType('', 'Screencast_20261118_115849.webm')).toBe(true);
    expect(isUploadableType('application/octet-stream', 'Screencast.webm')).toBe(true);
  });

  it('uploads .webm directly when the server accepts WebM without triggering ffmpeg conversion', async () => {
    const transcodeSpy = vi.fn();
    window.lurkerDesktop = {
      isElectron: true,
      platform: 'linux',
      getConfig: async () => ({ serverUrl: 'https://lurker.example', allowSelfSigned: false }),
      setConfig: async () => ({ serverUrl: 'https://lurker.example', allowSelfSigned: false }),
      setBadge: async () => {},
      notify: async () => {},
      openExternal: async () => {},
      onNavigate: () => () => {},
      transcodeWebm: transcodeSpy,
    };

    const webmBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
    const uploadSpy = vi.spyOn(apiModule, 'apiMultipart').mockImplementation(async (_url, fd) => {
      const uploaded = fd.get('image') as File;
      expect(uploaded.name).toBe('Screencast_20261118_115849.webm');
      expect(uploaded.type).toBe('video/webm');
      return {
        id: 98,
        url: 'https://lurker.example/uploads/Screencast_20261118_115849.webm',
        mime: 'video/webm',
        can_delete: true,
      };
    });

    const webmFile = new File([webmBytes], 'Screencast_20261118_115849.webm', {
      type: 'video/webm',
    });
    const result = await useUploadsStore.getState().upload(webmFile, webmFile.name, { insert: false });

    expect(transcodeSpy).not.toHaveBeenCalled();
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(result.url).toBe('https://lurker.example/uploads/Screencast_20261118_115849.webm');
  });

  it('falls back to Electron transcodeWebm when an older server refuses WebM with 415', async () => {
    const mp4Bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
    let observedPhaseDuringConvert: string | undefined;
    let observedDestDuringConvert: string | null | undefined;
    const transcodeSpy = vi.fn(async (inputFile: File) => {
      observedPhaseDuringConvert = useUploadsStore.getState().current?.phase;
      observedDestDuringConvert = useUploadsStore.getState().current?.destination;
      expect(inputFile.name).toBe('Screencast_20261118_115849.webm');
      return {
        ok: true as const,
        data: mp4Bytes,
        mime: 'video/mp4',
        filename: 'Screencast_20261118_115849.mp4',
      };
    });

    window.lurkerDesktop = {
      isElectron: true,
      platform: 'linux',
      getConfig: async () => ({ serverUrl: 'https://lurker.example', allowSelfSigned: false }),
      setConfig: async () => ({ serverUrl: 'https://lurker.example', allowSelfSigned: false }),
      setBadge: async () => {},
      notify: async () => {},
      openExternal: async () => {},
      onNavigate: () => () => {},
      transcodeWebm: transcodeSpy,
    };

    let attempt = 0;
    const uploadSpy = vi.spyOn(apiModule, 'apiMultipart').mockImplementation(async (_url, fd) => {
      attempt += 1;
      const uploaded = fd.get('image') as File;
      if (attempt === 1) {
        expect(uploaded.name).toBe('Screencast_20261118_115849.webm');
        const err = new Error('video/webm files are not accepted — Lurker takes ...') as apiModule.ApiError;
        err.status = 415;
        throw err;
      }
      expect(uploaded).toBeInstanceOf(File);
      expect(uploaded.name).toBe('Screencast_20261118_115849.mp4');
      expect(uploaded.type).toBe('video/mp4');
      expect(uploaded.size).toBe(mp4Bytes.byteLength);
      return {
        id: 99,
        url: 'https://lurker.example/uploads/Screencast_20261118_115849.mp4',
        mime: 'video/mp4',
        can_delete: true,
      };
    });

    const webmFile = new File([new Uint8Array([1, 2, 3, 4])], 'Screencast_20261118_115849.webm', {
      type: 'video/webm',
    });
    const result = await useUploadsStore.getState().upload(webmFile, webmFile.name, { insert: false });

    expect(transcodeSpy).toHaveBeenCalledTimes(1);
    expect(observedPhaseDuringConvert).toBe('processing');
    expect(observedDestDuringConvert).toBe('MP4');
    expect(uploadSpy).toHaveBeenCalledTimes(2);
    expect(result.url).toBe('https://lurker.example/uploads/Screencast_20261118_115849.mp4');
  });

  it('surfaces a clear error when server 415s WebM and Electron transcodeWebm reports ffmpeg missing', async () => {
    window.lurkerDesktop = {
      isElectron: true,
      platform: 'linux',
      getConfig: async () => ({ serverUrl: 'https://lurker.example', allowSelfSigned: false }),
      setConfig: async () => ({ serverUrl: 'https://lurker.example', allowSelfSigned: false }),
      setBadge: async () => {},
      notify: async () => {},
      openExternal: async () => {},
      onNavigate: () => () => {},
      transcodeWebm: async () => ({
        ok: false,
        missingFfmpeg: true,
        error: 'ffmpeg is not installed',
      }),
    };

    vi.spyOn(apiModule, 'apiMultipart').mockRejectedValueOnce(
      Object.assign(new Error('video/webm files are not accepted'), { status: 415 }),
    );

    const webmFile = new File([new Uint8Array([1, 2])], 'clip.webm', { type: 'video/webm' });
    await expect(
      useUploadsStore.getState().upload(webmFile, webmFile.name, { insert: false }),
    ).rejects.toThrow(/ffmpeg/i);
    expect(useUploadsStore.getState().failedMessage).toMatch(/ffmpeg/i);
    expect(useUploadsStore.getState().current).toBeNull();
  });
});
