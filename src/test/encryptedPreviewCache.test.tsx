// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EncryptedPreviewCache,
  type SafeStorageAdapter,
} from '../../electron/previewCache';
import { MessageAttachment } from '../components/MessageAttachment';
import { MediaViewerModal } from '../components/MediaViewerModal';
import { EncryptedPreviewCachePanel } from '../components/EncryptedPreviewCachePanel';
import {
  clearPreviewCache,
  primePreviews,
  useLinkPreview,
} from '../hooks/useLinkPreview';
import { useMediaViewerStore } from '../hooks/useMediaViewer';
import {
  revokeMemoryPreviewUrls,
  useEncryptedPreviewCacheStore,
} from '../lib/encryptedPreviewCache';
import { useAuthStore } from '../stores/auth';
import { setServerUrl } from '../api';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makePngBytes(payload: string, totalLength = 256): Uint8Array {
  const buf = new Uint8Array(Math.max(totalLength, 16 + payload.length));
  // Valid PNG signature
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  const encoded = new TextEncoder().encode(payload);
  buf.set(encoded, 16);
  return buf;
}

function createMockSafeStorage(available = true): SafeStorageAdapter {
  const sealSecret = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText: string) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', sealSecret, iv);
      const body = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, body]);
    },
    decryptString: (encrypted: Buffer) => {
      const iv = encrypted.subarray(0, 12);
      const tag = encrypted.subarray(12, 28);
      const body = encrypted.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', sealSecret, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    },
  };
}

async function flushUi(ms = 20): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe('EncryptedPreviewCache (main-process AES-256-GCM storage)', () => {
  const tempDirs: string[] = [];

  const makeTempDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lurkr-enc-cache-test-'));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('encrypts image payloads and preview metadata on disk without plaintext leakage and survives reload', async () => {
    const cacheDir = makeTempDir();
    const safeStorage = createMockSafeStorage(true);
    const secretMarker = 'SECRET_PNG_PIXEL_DATA';
    const pngBytes = makePngBytes(secretMarker);
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      contentType: 'image/png',
      bytes: pngBytes,
    }));

    const imageUrl = 'https://cdn.example.com/private/secret-photo.png';
    const pageUrl = 'https://example.com/secret-article';

    const cache1 = new EncryptedPreviewCache({ cacheDir, safeStorage, fetcher });
    const first = await cache1.getOrFetchImage(imageUrl);
    expect(first.ok).toBe(true);
    expect(first.hit).toBe(false);
    expect(first.mime).toBe('image/png');
    expect(Buffer.from(first.data!).equals(Buffer.from(pngBytes))).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);

    await cache1.putMeta([
      {
        url: pageUrl,
        status: 'ok',
        kind: 'page',
        title: 'Secret Page Title',
        thumb: imageUrl,
      },
    ]);

    // Verify all files on disk are ciphertext without plaintext markers or URLs.
    const indexRaw = fs.readFileSync(path.join(cacheDir, 'index.enc'));
    expect(indexRaw.subarray(0, 4).toString('ascii')).toBe('LPC1');
    expect(indexRaw.toString('latin1')).not.toContain('secret-photo');
    expect(indexRaw.toString('latin1')).not.toContain('secret-article');

    const entryFiles = fs.readdirSync(path.join(cacheDir, 'entries'));
    expect(entryFiles.length).toBe(2);
    for (const fname of entryFiles) {
      expect(fname).toMatch(/^[a-f0-9]{64}\.enc$/);
      const raw = fs.readFileSync(path.join(cacheDir, 'entries', fname));
      expect(raw.subarray(0, 4).toString('ascii')).toBe('LPC1');
      expect(raw.toString('latin1')).not.toContain(secretMarker);
      expect(raw.toString('latin1')).not.toContain('Secret Page Title');
      expect(raw.toString('latin1')).not.toContain('secret-photo');
    }

    // Re-open with a fresh cache instance backed by the same safeStorage keyring: no network fetch!
    const cache2 = new EncryptedPreviewCache({ cacheDir, safeStorage, fetcher });
    const second = await cache2.getOrFetchImage(imageUrl);
    expect(second.ok).toBe(true);
    expect(second.hit).toBe(true);
    expect(Buffer.from(second.data!).equals(Buffer.from(pngBytes))).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const metaHits = await cache2.getMetaBatch([pageUrl, 'https://example.com/missing']);
    expect(metaHits[pageUrl]).toMatchObject({
      url: pageUrl,
      title: 'Secret Page Title',
    });
    expect(metaHits['https://example.com/missing']).toBeUndefined();

    const stats = await cache2.stats();
    expect(stats.backend).toBe('safeStorage+aes-256-gcm');
    expect(stats.persistentKey).toBe(true);
    expect(stats.imageCount).toBe(1);
    expect(stats.metaCount).toBe(1);
  });

  it('rejects tampered ciphertext via GCM auth tag and re-fetches cleanly', async () => {
    const cacheDir = makeTempDir();
    const safeStorage = createMockSafeStorage(true);
    const pngBytes = makePngBytes('ORIGINAL_AUTHENTIC_DATA');
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      contentType: 'image/png',
      bytes: pngBytes,
    }));

    const url = 'https://cdn.example.com/auth-check.png';
    const cache = new EncryptedPreviewCache({ cacheDir, safeStorage, fetcher });
    await cache.getOrFetchImage(url);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const [entryFile] = fs.readdirSync(path.join(cacheDir, 'entries'));
    const fullPath = path.join(cacheDir, 'entries', entryFile);
    const tampered = fs.readFileSync(fullPath);
    tampered[tampered.length - 3] ^= 0xff;
    fs.writeFileSync(fullPath, tampered);

    const recovered = await cache.getOrFetchImage(url);
    expect(recovered.ok).toBe(true);
    expect(recovered.hit).toBe(false);
    expect(Buffer.from(recovered.data!).equals(Buffer.from(pngBytes))).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('evicts least-recently-used images when encrypted bytes exceed maxBytes', async () => {
    const cacheDir = makeTempDir();
    const safeStorage = createMockSafeStorage(true);
    const fourMb = 4 * 1024 * 1024;
    const payloads: Record<string, Uint8Array> = {
      'https://cdn.example.com/a.png': makePngBytes('IMG_A', fourMb),
      'https://cdn.example.com/b.png': makePngBytes('IMG_B', fourMb),
      'https://cdn.example.com/c.png': makePngBytes('IMG_C', fourMb),
    };
    const fetchCounts: Record<string, number> = {};
    const fetcher = vi.fn(async (url: string) => {
      fetchCounts[url] = (fetchCounts[url] || 0) + 1;
      return {
        ok: true,
        status: 200,
        contentType: 'image/png',
        bytes: payloads[url],
      };
    });

    const maxBytes = 10 * 1024 * 1024; // 10 MB minimum cap
    const cache = new EncryptedPreviewCache({ cacheDir, safeStorage, fetcher, maxBytes });

    await cache.getOrFetchImage('https://cdn.example.com/a.png');
    await new Promise((r) => setTimeout(r, 8));
    await cache.getOrFetchImage('https://cdn.example.com/b.png');
    await new Promise((r) => setTimeout(r, 8));
    // Re-touch A so B becomes the least-recently-used item before fetching C.
    await cache.getOrFetchImage('https://cdn.example.com/a.png');
    await new Promise((r) => setTimeout(r, 8));
    await cache.getOrFetchImage('https://cdn.example.com/c.png');

    const stats = await cache.stats();
    expect(stats.imageCount).toBe(2);
    expect(stats.totalBytes).toBeLessThanOrEqual(maxBytes);

    // A and C should hit cache; B must have been evicted and re-fetched.
    const aHit = await cache.getOrFetchImage('https://cdn.example.com/a.png');
    const cHit = await cache.getOrFetchImage('https://cdn.example.com/c.png');
    const bRefetch = await cache.getOrFetchImage('https://cdn.example.com/b.png');
    expect(aHit.hit).toBe(true);
    expect(cHit.hit).toBe(true);
    expect(bRefetch.hit).toBe(false);
    expect(fetchCounts['https://cdn.example.com/a.png']).toBe(1);
    expect(fetchCounts['https://cdn.example.com/c.png']).toBe(1);
    expect(fetchCounts['https://cdn.example.com/b.png']).toBe(2);
  });

  it('rejects non-image payloads and wipes ephemeral-key cache files on dispose()', async () => {
    const cacheDir = makeTempDir();
    const safeStorage = createMockSafeStorage(false);
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('.html')) {
        return {
          ok: true,
          status: 200,
          contentType: 'text/html',
          bytes: new TextEncoder().encode('<html>not an image</html>'),
        };
      }
      return {
        ok: true,
        status: 200,
        contentType: 'image/png',
        bytes: makePngBytes('EPHEMERAL_OK'),
      };
    });

    const cache = new EncryptedPreviewCache({ cacheDir, safeStorage, fetcher });
    const rejected = await cache.getOrFetchImage('https://cdn.example.com/bad.html');
    expect(rejected.ok).toBe(false);

    const accepted = await cache.getOrFetchImage('https://cdn.example.com/good.png');
    expect(accepted.ok).toBe(true);

    const stats = await cache.stats();
    expect(stats.backend).toBe('ephemeral-aes-256-gcm');
    expect(stats.persistentKey).toBe(false);
    expect(stats.imageCount).toBe(1);

    await cache.dispose();
    expect(fs.readdirSync(path.join(cacheDir, 'entries'))).toEqual([]);
    expect(fs.existsSync(path.join(cacheDir, 'index.enc'))).toBe(false);
  });
});

describe('Encrypted preview cache renderer integration', () => {
  const origDesktop = window.lurkerDesktop;
  const origFetch = globalThis.fetch;
  const origCreateObjectUrl = URL.createObjectURL;
  const origRevokeObjectUrl = URL.revokeObjectURL;
  let container: HTMLDivElement;
  let root: Root | null = null;
  let blobCounter = 0;

  beforeEach(() => {
    setServerUrl('https://lurker.example.com');
    container = document.createElement('div');
    document.body.appendChild(container);
    blobCounter = 0;
    URL.createObjectURL = vi.fn(() => {
      blobCounter += 1;
      return `blob:https://lurker.local/decrypted-${blobCounter}`;
    });
    URL.revokeObjectURL = vi.fn();
    useEncryptedPreviewCacheStore.setState({
      enabled: true,
      maxMb: 250,
      clearOnLogout: false,
    });
    clearPreviewCache();
    useMediaViewerStore.getState().close();
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
    revokeMemoryPreviewUrls();
    clearPreviewCache();
    window.lurkerDesktop = origDesktop;
    globalThis.fetch = origFetch;
    URL.createObjectURL = origCreateObjectUrl;
    URL.revokeObjectURL = origRevokeObjectUrl;
    vi.restoreAllMocks();
  });

  it('renders decrypted blob URLs in MessageAttachment and MediaViewerModal and hydrates metadata via desktop IPC', async () => {
    const png = makePngBytes('RENDERER_DECRYPTED_IMAGE');
    const cachedMeta: Record<string, Record<string, unknown>> = {
      'https://img.example.com/cat': {
        url: 'https://img.example.com/cat',
        status: 'ok',
        kind: 'image',
        src: 'https://img.example.com/cat.png',
        title: 'Cached Cat',
      },
    };
    const getOrFetchImage = vi.fn(async () => ({
      ok: true,
      hit: true,
      mime: 'image/png',
      data: png,
    }));
    const getMetaBatch = vi.fn(async (urls: string[]) => {
      const out: Record<string, Record<string, unknown>> = {};
      for (const u of urls) {
        if (cachedMeta[u]) out[u] = cachedMeta[u];
      }
      return out;
    });
    const putMeta = vi.fn(async () => {});
    const configure = vi.fn(async () => ({
      backend: 'safeStorage+aes-256-gcm' as const,
      persistentKey: true,
      enabled: true,
      entryCount: 2,
      imageCount: 1,
      metaCount: 1,
      totalBytes: 1024,
      maxBytes: 250 * 1024 * 1024,
    }));
    const clear = vi.fn(async () => {});
    const stats = vi.fn(async () => ({
      backend: 'safeStorage+aes-256-gcm' as const,
      persistentKey: true,
      enabled: true,
      entryCount: 2,
      imageCount: 1,
      metaCount: 1,
      totalBytes: 4096,
      maxBytes: 250 * 1024 * 1024,
    }));

    window.lurkerDesktop = {
      isElectron: true,
      platform: 'linux',
      getConfig: async () => ({ serverUrl: '', allowSelfSigned: false }),
      setConfig: async (c) => ({ serverUrl: c.serverUrl ?? '', allowSelfSigned: false }),
      setBadge: async () => {},
      notify: async () => {},
      openExternal: async () => {},
      onNavigate: () => () => {},
      previewCache: {
        getOrFetchImage,
        getMetaBatch,
        putMeta,
        stats,
        clear,
        configure,
      },
    };

    const fetchSpy = vi.fn(async () => new Response('[]', { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const Harness: React.FC = () => {
      useLinkPreview('https://img.example.com/cat');
      return (
        <div>
          <MessageAttachment url="https://img.example.com/cat" inlineMedia linkPreviews />
          <MediaViewerModal />
        </div>
      );
    };

    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
      primePreviews(['https://img.example.com/cat'], { inlineMedia: true, linkPreviews: true });
    });
    await flushUi(30);

    // Metadata cache hit should satisfy primePreviews without hitting /api/link-preview/resolve.
    expect(getMetaBatch).toHaveBeenCalledWith(['https://img.example.com/cat']);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Image should render via decrypted blob: URL and never put raw https:// URL on <img src>.
    expect(getOrFetchImage).toHaveBeenCalledWith('https://img.example.com/cat.png');
    const img = container.querySelector('.msg-attachment-image img') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('blob:https://lurker.local/decrypted-1');

    // Opening MediaViewerModal should immediately display the decrypted blob URL too.
    await act(async () => {
      img!.click();
    });
    await flushUi(15);

    const modalImgs = Array.from(container.querySelectorAll('img')).map((el) =>
      el.getAttribute('src'),
    );
    expect(modalImgs).toEqual([
      'blob:https://lurker.local/decrypted-1',
      'blob:https://lurker.local/decrypted-1',
    ]);
    const dlLink = container.querySelector('a[title="Download"]') as HTMLAnchorElement | null;
    expect(dlLink?.getAttribute('href')).toBe('blob:https://lurker.local/decrypted-1');
  });

  it('renders Settings panel stats, updates config toggles, and wipes cache on Clear or logout when enabled', async () => {
    const clear = vi.fn(async () => {});
    const configure = vi.fn(async (next: { enabled?: boolean; maxBytes?: number }) => ({
      backend: 'safeStorage+aes-256-gcm' as const,
      persistentKey: true,
      enabled: next.enabled ?? true,
      entryCount: 3,
      imageCount: 2,
      metaCount: 1,
      totalBytes: 2048,
      maxBytes: next.maxBytes ?? 250 * 1024 * 1024,
    }));
    const stats = vi.fn(async () => ({
      backend: 'safeStorage+aes-256-gcm' as const,
      persistentKey: true,
      enabled: true,
      entryCount: 3,
      imageCount: 2,
      metaCount: 1,
      totalBytes: 2048,
      maxBytes: 250 * 1024 * 1024,
    }));

    window.lurkerDesktop = {
      isElectron: true,
      platform: 'linux',
      getConfig: async () => ({ serverUrl: '', allowSelfSigned: false }),
      setConfig: async (c) => ({ serverUrl: c.serverUrl ?? '', allowSelfSigned: false }),
      setBadge: async () => {},
      notify: async () => {},
      openExternal: async () => {},
      onNavigate: () => () => {},
      previewCache: {
        getOrFetchImage: async () => ({ ok: false }),
        getMetaBatch: async () => ({}),
        putMeta: async () => {},
        stats,
        clear,
        configure,
      },
    };

    await act(async () => {
      root = createRoot(container);
      root.render(<EncryptedPreviewCachePanel />);
    });
    await flushUi(20);

    expect(container.textContent).toContain('AES-256-GCM (OS Keyring / DPAPI sealed)');
    expect(container.textContent).toContain('2 images');
    expect(container.textContent).toContain('1 previews');

    const clearBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Clear Cache'),
    );
    expect(clearBtn).toBeDefined();
    await act(async () => {
      clearBtn!.click();
    });
    await flushUi(20);
    expect(clear).toHaveBeenCalledTimes(1);

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    const clearOnLogoutCheckbox = checkboxes[1] as HTMLInputElement;
    await act(async () => {
      clearOnLogoutCheckbox.click();
    });
    expect(useEncryptedPreviewCacheStore.getState().clearOnLogout).toBe(true);

    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await useAuthStore.getState().logout();
    expect(clear).toHaveBeenCalledTimes(2);
  });
});
