import { create } from 'zustand';
import type { DesktopBridge, EncryptedCacheStats } from '../api';
import type { LinkPreview } from '../hooks/useLinkPreview';

export const PREVIEW_CACHE_MAX_MB_OPTIONS = [50, 100, 250, 500, 1024] as const;

const SETTINGS_STORAGE_KEY = 'lurkr.previewCache.v1';
const DEFAULT_MAX_MB = 250;
const DEFAULT_META_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FETCH_BYTES = 25 * 1024 * 1024;
const MAX_BLOB_URLS = 200;

const IDB_NAME = 'lurkr-encrypted-preview-cache';
const IDB_VERSION = 1;
const IDB_KEY_STORE = 'keys';
const IDB_ENTRY_STORE = 'entries';

export type PreviewCacheBackendKind = 'desktop' | 'webcrypto' | 'none';

export interface PreviewCacheSettings {
  enabled: boolean;
  maxMb: number;
  clearOnLogout: boolean;
}

interface PreviewCacheStoreState extends PreviewCacheSettings {
  setEnabled: (enabled: boolean) => void;
  setMaxMb: (maxMb: number) => void;
  setClearOnLogout: (clearOnLogout: boolean) => void;
}

function clampMaxMb(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_MAX_MB;
  return Math.max(10, Math.min(4096, Math.round(num)));
}

function loadSettings(): PreviewCacheSettings {
  const defaults: PreviewCacheSettings = {
    enabled: true,
    maxMb: DEFAULT_MAX_MB,
    clearOnLogout: false,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PreviewCacheSettings>;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : defaults.enabled,
      maxMb: clampMaxMb(parsed.maxMb),
      clearOnLogout:
        typeof parsed.clearOnLogout === 'boolean'
          ? parsed.clearOnLogout
          : defaults.clearOnLogout,
    };
  } catch {
    return defaults;
  }
}

function saveSettings(settings: PreviewCacheSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore storage quota / private mode failures */
  }
}

function getDesktopPreviewCache(): DesktopBridge['previewCache'] | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.lurkerDesktop?.previewCache;
}

function syncDesktopBridgeConfig(settings: PreviewCacheSettings): void {
  const desktop = getDesktopPreviewCache();
  if (!desktop?.configure) return;
  void desktop
    .configure({
      enabled: settings.enabled,
      maxBytes: settings.maxMb * 1024 * 1024,
    })
    .catch(() => {
      /* ignore desktop sync errors on teardown */
    });
}

const initialSettings = loadSettings();
syncDesktopBridgeConfig(initialSettings);

export const useEncryptedPreviewCacheStore = create<PreviewCacheStoreState>((set, get) => ({
  ...initialSettings,
  setEnabled: (enabled) => {
    const next: PreviewCacheSettings = {
      enabled,
      maxMb: get().maxMb,
      clearOnLogout: get().clearOnLogout,
    };
    saveSettings(next);
    set({ enabled });
    syncDesktopBridgeConfig(next);
    if (!enabled) {
      revokeMemoryPreviewUrls();
    }
  },
  setMaxMb: (maxMb) => {
    const clamped = clampMaxMb(maxMb);
    const next: PreviewCacheSettings = {
      enabled: get().enabled,
      maxMb: clamped,
      clearOnLogout: get().clearOnLogout,
    };
    saveSettings(next);
    set({ maxMb: clamped });
    syncDesktopBridgeConfig(next);
    if (getPreviewCacheBackendKind() === 'webcrypto') {
      void pruneIndexedDbCache(clamped * 1024 * 1024);
    }
  },
  setClearOnLogout: (clearOnLogout) => {
    const next: PreviewCacheSettings = {
      enabled: get().enabled,
      maxMb: get().maxMb,
      clearOnLogout,
    };
    saveSettings(next);
    set({ clearOnLogout });
  },
}));

export function getPreviewCacheBackendKind(): PreviewCacheBackendKind {
  if (getDesktopPreviewCache()) return 'desktop';
  if (
    typeof window !== 'undefined' &&
    typeof window.indexedDB !== 'undefined' &&
    Boolean(window.crypto?.subtle)
  ) {
    return 'webcrypto';
  }
  return 'none';
}

export function isEncryptedPreviewCacheActive(): boolean {
  return useEncryptedPreviewCacheStore.getState().enabled && getPreviewCacheBackendKind() !== 'none';
}

export function isCacheablePreviewUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  return url.startsWith('https://') || url.startsWith('http://');
}

// ---------------------------------------------------------------------------
// In-memory LRU cache of decrypted blob: URLs
// ---------------------------------------------------------------------------

const blobUrlCache = new Map<string, string>();
const inFlightImageLoads = new Map<string, Promise<string | null>>();

function revokeUrlSafely(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore in environments without URL.revokeObjectURL */
  }
}

export function peekCachedPreviewBlobUrl(rawUrl: string): string | null {
  const hit = blobUrlCache.get(rawUrl);
  if (!hit) return null;
  blobUrlCache.delete(rawUrl);
  blobUrlCache.set(rawUrl, hit);
  return hit;
}

function storeBlobUrl(rawUrl: string, blobUrl: string): void {
  const existing = blobUrlCache.get(rawUrl);
  if (existing && existing !== blobUrl) {
    revokeUrlSafely(existing);
    blobUrlCache.delete(rawUrl);
  }
  blobUrlCache.set(rawUrl, blobUrl);
  while (blobUrlCache.size > MAX_BLOB_URLS) {
    const oldestKey = blobUrlCache.keys().next().value;
    if (!oldestKey) break;
    const oldestUrl = blobUrlCache.get(oldestKey);
    blobUrlCache.delete(oldestKey);
    if (oldestUrl) revokeUrlSafely(oldestUrl);
  }
}

export function revokeMemoryPreviewUrls(): void {
  for (const url of blobUrlCache.values()) {
    revokeUrlSafely(url);
  }
  blobUrlCache.clear();
  inFlightImageLoads.clear();
}

// ---------------------------------------------------------------------------
// Web Crypto + IndexedDB AES-256-GCM fallback backend
// ---------------------------------------------------------------------------

interface IdBKeyRecord {
  id: string;
  key: CryptoKey;
}

interface IdBCacheEntry {
  id: string;
  kind: 'image' | 'meta';
  iv: Uint8Array<ArrayBuffer>;
  aad: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
  encryptedBytes: number;
  createdAt: number;
  lastAccessedAt: number;
  expiresAt: number;
}

let idbPromise: Promise<IDBDatabase> | null = null;
let cryptoKeyPromise: Promise<CryptoKey> | null = null;

function openIndexedDb(): Promise<IDBDatabase> {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_KEY_STORE)) {
        db.createObjectStore(IDB_KEY_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(IDB_ENTRY_STORE)) {
        const store = db.createObjectStore(IDB_ENTRY_STORE, { keyPath: 'id' });
        store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      idbPromise = null;
      reject(req.error ?? new Error('Failed to open IndexedDB preview cache'));
    };
  });
  return idbPromise;
}

function idbReq<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

async function getOrCreateWebCryptoKey(): Promise<CryptoKey> {
  if (cryptoKeyPromise) return cryptoKeyPromise;
  cryptoKeyPromise = (async () => {
    const db = await openIndexedDb();
    const txRead = db.transaction(IDB_KEY_STORE, 'readonly');
    const existing = (await idbReq(
      txRead.objectStore(IDB_KEY_STORE).get('master'),
    )) as IdBKeyRecord | undefined;
    if (existing?.key) return existing.key;

    const generated = await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const txWrite = db.transaction(IDB_KEY_STORE, 'readwrite');
    await idbReq(txWrite.objectStore(IDB_KEY_STORE).put({ id: 'master', key: generated }));
    return generated;
  })().catch((err) => {
    cryptoKeyPromise = null;
    throw err;
  });
  return cryptoKeyPromise;
}

async function sha256Bytes(input: string): Promise<Uint8Array<ArrayBuffer>> {
  const encoded = new TextEncoder().encode(input);
  const digest = await window.crypto.subtle.digest('SHA-256', encoded);
  return new Uint8Array(digest);
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function packImagePayload(contentType: string, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const mimeBytes = new TextEncoder().encode(contentType);
  const out = new Uint8Array(new ArrayBuffer(4 + mimeBytes.byteLength + bytes.byteLength));
  new DataView(out.buffer).setUint32(0, mimeBytes.byteLength, false);
  out.set(mimeBytes, 4);
  out.set(bytes, 4 + mimeBytes.byteLength);
  return out;
}

function unpackImagePayload(plainBuffer: ArrayBuffer): { contentType: string; bytes: Uint8Array<ArrayBuffer> } | null {
  if (plainBuffer.byteLength < 4) return null;
  const view = new DataView(plainBuffer);
  const mimeLen = view.getUint32(0, false);
  if (mimeLen <= 0 || mimeLen > 256 || 4 + mimeLen > plainBuffer.byteLength) return null;
  const mimeBytes = new Uint8Array(plainBuffer, 4, mimeLen);
  const contentType = new TextDecoder().decode(mimeBytes);
  const bytes = new Uint8Array(plainBuffer.slice(4 + mimeLen));
  return { contentType, bytes };
}

function sniffImageMime(bytes: Uint8Array, headerMime: string | null): string | null {
  const cleanHeader = headerMime ? headerMime.split(';')[0].trim().toLowerCase() : '';
  if (cleanHeader.startsWith('image/')) return cleanHeader;
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

async function encryptIdbEntry(
  keyInput: string,
  kind: 'image' | 'meta',
  plaintext: Uint8Array<ArrayBuffer>,
  expiresAt: number,
): Promise<void> {
  const [db, key, aad] = await Promise.all([
    openIndexedDb(),
    getOrCreateWebCryptoKey(),
    sha256Bytes(keyInput),
  ]);
  const id = bytesToHex(aad);
  const iv = new Uint8Array(new ArrayBuffer(12));
  window.crypto.getRandomValues(iv);
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    plaintext,
  );
  const now = Date.now();
  const record: IdBCacheEntry = {
    id,
    kind,
    iv,
    aad,
    data: ciphertext,
    encryptedBytes: ciphertext.byteLength + iv.byteLength + aad.byteLength,
    createdAt: now,
    lastAccessedAt: now,
    expiresAt,
  };
  const tx = db.transaction(IDB_ENTRY_STORE, 'readwrite');
  await idbReq(tx.objectStore(IDB_ENTRY_STORE).put(record));
  const maxBytes = useEncryptedPreviewCacheStore.getState().maxMb * 1024 * 1024;
  void pruneIndexedDbCache(maxBytes);
}

async function decryptIdbEntry(keyInput: string): Promise<{ record: IdBCacheEntry; plain: ArrayBuffer } | null> {
  const [db, key, aad] = await Promise.all([
    openIndexedDb(),
    getOrCreateWebCryptoKey(),
    sha256Bytes(keyInput),
  ]);
  const id = bytesToHex(aad);
  const tx = db.transaction(IDB_ENTRY_STORE, 'readonly');
  const record = (await idbReq(tx.objectStore(IDB_ENTRY_STORE).get(id))) as IdBCacheEntry | undefined;
  if (!record) return null;
  if (record.expiresAt > 0 && record.expiresAt <= Date.now()) {
    const delTx = db.transaction(IDB_ENTRY_STORE, 'readwrite');
    void idbReq(delTx.objectStore(IDB_ENTRY_STORE).delete(id)).catch(() => {});
    return null;
  }
  try {
    const plain = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv, additionalData: aad },
      key,
      record.data,
    );
    const touchTx = db.transaction(IDB_ENTRY_STORE, 'readwrite');
    record.lastAccessedAt = Date.now();
    void idbReq(touchTx.objectStore(IDB_ENTRY_STORE).put(record)).catch(() => {});
    return { record, plain };
  } catch {
    const delTx = db.transaction(IDB_ENTRY_STORE, 'readwrite');
    void idbReq(delTx.objectStore(IDB_ENTRY_STORE).delete(id)).catch(() => {});
    return null;
  }
}

async function pruneIndexedDbCache(maxBytes: number): Promise<void> {
  try {
    const db = await openIndexedDb();
    const tx = db.transaction(IDB_ENTRY_STORE, 'readonly');
    const all = (await idbReq(tx.objectStore(IDB_ENTRY_STORE).getAll())) as IdBCacheEntry[];
    const now = Date.now();
    const expiredIds: string[] = [];
    const live: IdBCacheEntry[] = [];
    let totalBytes = 0;

    for (const item of all) {
      if (item.expiresAt > 0 && item.expiresAt <= now) {
        expiredIds.push(item.id);
      } else {
        live.push(item);
        totalBytes += item.encryptedBytes;
      }
    }

    live.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    const evictIds = [...expiredIds];
    let idx = 0;
    while (totalBytes > maxBytes && idx < live.length) {
      evictIds.push(live[idx].id);
      totalBytes -= live[idx].encryptedBytes;
      idx += 1;
    }

    if (evictIds.length > 0) {
      const delTx = db.transaction(IDB_ENTRY_STORE, 'readwrite');
      const store = delTx.objectStore(IDB_ENTRY_STORE);
      for (const id of evictIds) {
        store.delete(id);
      }
    }
  } catch {
    /* ignore background prune errors */
  }
}

async function idbGetOrFetchImage(rawUrl: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string } | null> {
  const hit = await decryptIdbEntry(`img:${rawUrl}`);
  if (hit) {
    const unpacked = unpackImagePayload(hit.plain);
    if (unpacked) return unpacked;
  }

  const res = await fetch(rawUrl, { cache: 'no-store', credentials: 'include' });
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_FETCH_BYTES) return null;
  const bytes = new Uint8Array(buf);
  const contentType = sniffImageMime(bytes, res.headers.get('content-type'));
  if (!contentType) return null;

  const packed = packImagePayload(contentType, bytes);
  await encryptIdbEntry(`img:${rawUrl}`, 'image', packed, Date.now() + 7 * 24 * 60 * 60 * 1000);
  return { bytes, contentType };
}

// ---------------------------------------------------------------------------
// Unified public API
// ---------------------------------------------------------------------------

function makeBlobUrl(bytes: Uint8Array, contentType: string): string {
  const safeCopy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  safeCopy.set(bytes);
  const blob = new Blob([safeCopy], { type: contentType || 'application/octet-stream' });
  return URL.createObjectURL(blob);
}

/**
 * Fetches (or retrieves from encrypted storage) and decrypts a preview image,
 * returning an ephemeral in-memory `blob:` URL (never cached to plaintext HTTP disk cache).
 * Returns `null` if encrypted caching is disabled, unavailable, or fails (e.g. CORS in web).
 */
export async function resolveEncryptedPreviewImageUrl(rawUrl: string): Promise<string | null> {
  if (!isCacheablePreviewUrl(rawUrl) || !isEncryptedPreviewCacheActive()) {
    return null;
  }

  const memHit = peekCachedPreviewBlobUrl(rawUrl);
  if (memHit) return memHit;

  const existingFlight = inFlightImageLoads.get(rawUrl);
  if (existingFlight) return existingFlight;

  const task = (async (): Promise<string | null> => {
    try {
      const desktop = getDesktopPreviewCache();
      if (desktop) {
        const res = await desktop.getOrFetchImage(rawUrl);
        if (!res || !res.ok || !res.data || res.data.byteLength === 0) return null;
        const blobUrl = makeBlobUrl(res.data, res.mime || 'application/octet-stream');
        storeBlobUrl(rawUrl, blobUrl);
        return blobUrl;
      }

      if (getPreviewCacheBackendKind() === 'webcrypto') {
        const res = await idbGetOrFetchImage(rawUrl);
        if (!res) return null;
        const blobUrl = makeBlobUrl(res.bytes, res.contentType);
        storeBlobUrl(rawUrl, blobUrl);
        return blobUrl;
      }

      return null;
    } catch {
      return null;
    } finally {
      inFlightImageLoads.delete(rawUrl);
    }
  })();

  inFlightImageLoads.set(rawUrl, task);
  return task;
}

export async function getCachedMetaBatch(urls: string[]): Promise<Record<string, LinkPreview>> {
  if (!urls.length || !isEncryptedPreviewCacheActive()) return {};

  const desktop = getDesktopPreviewCache();
  if (desktop) {
    try {
      const raw = await desktop.getMetaBatch(urls);
      return (raw ?? {}) as Record<string, LinkPreview>;
    } catch {
      return {};
    }
  }

  if (getPreviewCacheBackendKind() === 'webcrypto') {
    const out: Record<string, LinkPreview> = {};
    for (const url of urls) {
      try {
        const decrypted = await decryptIdbEntry(`meta:${url}`);
        if (!decrypted) continue;
        const parsed = JSON.parse(new TextDecoder().decode(decrypted.plain)) as LinkPreview;
        if (parsed && parsed.url === url && parsed.status === 'ok') {
          out[url] = parsed;
        }
      } catch {
        /* ignore corrupt/missing entry */
      }
    }
    return out;
  }

  return {};
}

export async function putCachedMeta(items: LinkPreview[]): Promise<void> {
  const okItems = items.filter((item) => item.status === 'ok' && typeof item.url === 'string');
  if (!okItems.length || !isEncryptedPreviewCacheActive()) return;

  const desktop = getDesktopPreviewCache();
  if (desktop) {
    try {
      await desktop.putMeta(okItems as unknown as Array<Record<string, unknown>>);
    } catch {
      /* ignore write error */
    }
    return;
  }

  if (getPreviewCacheBackendKind() === 'webcrypto') {
    const encoder = new TextEncoder();
    for (const item of okItems) {
      try {
        const bytes = encoder.encode(JSON.stringify(item));
        const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
        copy.set(bytes);
        const parsedExp = item.expiresAt ? Date.parse(item.expiresAt) : NaN;
        const expiresAt = Number.isFinite(parsedExp) ? parsedExp : Date.now() + DEFAULT_META_TTL_MS;
        await encryptIdbEntry(`meta:${item.url}`, 'meta', copy, expiresAt);
      } catch {
        /* ignore single entry failure */
      }
    }
  }
}

export async function getEncryptedCacheStats(): Promise<EncryptedCacheStats | null> {
  const { enabled, maxMb } = useEncryptedPreviewCacheStore.getState();
  const maxBytes = maxMb * 1024 * 1024;
  const desktop = getDesktopPreviewCache();

  if (desktop) {
    try {
      return await desktop.stats();
    } catch {
      /* fall through to empty status */
    }
  }

  if (getPreviewCacheBackendKind() === 'webcrypto') {
    try {
      const db = await openIndexedDb();
      const tx = db.transaction(IDB_ENTRY_STORE, 'readonly');
      const all = (await idbReq(tx.objectStore(IDB_ENTRY_STORE).getAll())) as IdBCacheEntry[];
      let imageCount = 0;
      let metaCount = 0;
      let totalBytes = 0;
      const now = Date.now();
      for (const item of all) {
        if (item.expiresAt > 0 && item.expiresAt <= now) continue;
        totalBytes += item.encryptedBytes;
        if (item.kind === 'image') imageCount += 1;
        else metaCount += 1;
      }
      return {
        backend: 'webcrypto+indexeddb',
        persistentKey: true,
        enabled,
        entryCount: imageCount + metaCount,
        imageCount,
        metaCount,
        totalBytes,
        maxBytes,
      };
    } catch {
      /* fall through */
    }
  }

  return null;
}

export async function clearEncryptedCache(): Promise<void> {
  revokeMemoryPreviewUrls();
  const desktop = getDesktopPreviewCache();
  if (desktop) {
    try {
      await desktop.clear();
    } catch {
      /* ignore */
    }
    return;
  }

  if (getPreviewCacheBackendKind() === 'webcrypto') {
    try {
      const db = await openIndexedDb();
      const tx = db.transaction(IDB_ENTRY_STORE, 'readwrite');
      await idbReq(tx.objectStore(IDB_ENTRY_STORE).clear());
    } catch {
      /* ignore */
    }
  }
}
