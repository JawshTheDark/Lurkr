// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface SafeStorageAdapter {
  isEncryptionAvailable: () => boolean;
  encryptString: (plainText: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
}

export interface FetchedImageResponse {
  ok: boolean;
  status: number;
  contentType: string;
  bytes: Uint8Array;
}

export type PreviewFetcher = (
  url: string,
  opts: { signal: AbortSignal },
) => Promise<FetchedImageResponse>;

export interface EncryptedCacheStats {
  backend: 'safeStorage+aes-256-gcm' | 'ephemeral-aes-256-gcm' | 'webcrypto+indexeddb';
  persistentKey: boolean;
  enabled: boolean;
  entryCount: number;
  imageCount: number;
  metaCount: number;
  totalBytes: number;
  maxBytes: number;
}

export interface CachedImageResult {
  ok: boolean;
  hit?: boolean;
  mime?: string;
  data?: Uint8Array;
  error?: string;
}

interface IndexEntry {
  kind: 'image' | 'meta';
  size: number;
  storedAt: number;
  lastAccessAt: number;
  expiresAt: number;
}

interface EnvelopeHeader {
  kind: 'image' | 'meta';
  url: string;
  mime: string;
  storedAt: number;
  expiresAt: number;
}

const MAGIC = Buffer.from('LPC1', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DEFAULT_MAX_BYTES = 250 * 1024 * 1024;
const MIN_MAX_BYTES = 10 * 1024 * 1024;
const MAX_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;

function entryId(kind: 'image' | 'meta', url: string): string {
  return crypto.createHash('sha256').update(`${kind}:${url}`).digest('hex');
}

function isHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function sniffImageMime(bytes: Uint8Array, headerMime: string): string | null {
  const cleanHeader = headerMime.split(';')[0].trim().toLowerCase();
  if (cleanHeader.startsWith('image/')) return cleanHeader;
  if (bytes.length >= 4) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
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
  }
  return null;
}

async function writeFileAtomic(filePath: string, data: Buffer): Promise<void> {
  const tmp = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.promises.writeFile(tmp, data, { mode: 0o600 });
  await fs.promises.rename(tmp, filePath);
}

export class EncryptedPreviewCache {
  private readonly cacheDir: string;
  private readonly entriesDir: string;
  private readonly keyPath: string;
  private readonly indexPath: string;
  private readonly safeStorage?: SafeStorageAdapter;
  private readonly fetcher?: PreviewFetcher;

  private masterKey: Buffer | null = null;
  private persistentKey = false;
  private enabled = true;
  private maxBytes = DEFAULT_MAX_BYTES;
  private index: Record<string, IndexEntry> = {};
  private initPromise: Promise<void> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private inFlightImages = new Map<string, Promise<CachedImageResult>>();

  constructor(opts: {
    cacheDir: string;
    safeStorage?: SafeStorageAdapter;
    fetcher?: PreviewFetcher;
    maxBytes?: number;
    enabled?: boolean;
  }) {
    this.cacheDir = opts.cacheDir;
    this.entriesDir = path.join(opts.cacheDir, 'entries');
    this.keyPath = path.join(opts.cacheDir, 'master.key.enc');
    this.indexPath = path.join(opts.cacheDir, 'index.enc');
    this.safeStorage = opts.safeStorage;
    this.fetcher = opts.fetcher;
    if (typeof opts.maxBytes === 'number' && Number.isFinite(opts.maxBytes)) {
      this.maxBytes = Math.min(MAX_MAX_BYTES, Math.max(MIN_MAX_BYTES, Math.round(opts.maxBytes)));
    }
    if (typeof opts.enabled === 'boolean') {
      this.enabled = opts.enabled;
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(fn, fn);
    this.writeChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initInternal();
    }
    return this.initPromise;
  }

  private async initInternal(): Promise<void> {
    await fs.promises.mkdir(this.entriesDir, { recursive: true, mode: 0o700 });

    const canSeal = Boolean(this.safeStorage?.isEncryptionAvailable());
    let loadedExistingKey = false;

    if (canSeal && this.safeStorage) {
      try {
        const sealed = await fs.promises.readFile(this.keyPath);
        const decoded = this.safeStorage.decryptString(sealed);
        const keyBuf = Buffer.from(decoded, 'base64');
        if (keyBuf.length === 32) {
          this.masterKey = keyBuf;
          this.persistentKey = true;
          loadedExistingKey = true;
        }
      } catch {
        loadedExistingKey = false;
      }

      if (!loadedExistingKey) {
        const freshKey = crypto.randomBytes(32);
        const sealed = this.safeStorage.encryptString(freshKey.toString('base64'));
        await writeFileAtomic(this.keyPath, sealed);
        this.masterKey = freshKey;
        this.persistentKey = true;
        // Key rotated or freshly created: purge prior unreadable ciphertext entries.
        await this.wipeEntriesFromDisk();
      }
    } else {
      this.masterKey = crypto.randomBytes(32);
      this.persistentKey = false;
      await this.wipeEntriesFromDisk();
    }

    if (loadedExistingKey) {
      await this.loadIndex();
      await this.pruneExpiredAndOverflow();
    } else {
      this.index = {};
      await this.saveIndex();
    }
  }

  private async wipeEntriesFromDisk(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.entriesDir);
      await Promise.all(
        files.map((f) => fs.promises.rm(path.join(this.entriesDir, f), { force: true })),
      );
    } catch {
      // ignore missing entries directory
    }
    try {
      await fs.promises.rm(this.indexPath, { force: true });
    } catch {
      // ignore
    }
  }

  private encryptEnvelope(id: string, header: EnvelopeHeader, body: Uint8Array): Buffer {
    if (!this.masterKey) throw new Error('Master key not initialized');
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    cipher.setAAD(Buffer.from(id, 'utf8'));

    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    const lenPrefix = Buffer.allocUnsafe(4);
    lenPrefix.writeUInt32BE(headerBytes.length, 0);

    const enc1 = cipher.update(lenPrefix);
    const enc2 = cipher.update(headerBytes);
    const enc3 = cipher.update(body);
    const enc4 = cipher.final();
    const tag = cipher.getAuthTag();

    return Buffer.concat([MAGIC, iv, tag, enc1, enc2, enc3, enc4]);
  }

  private decryptEnvelope(
    id: string,
    raw: Buffer,
  ): { header: EnvelopeHeader; body: Uint8Array } | null {
    if (!this.masterKey) return null;
    if (raw.length < MAGIC.length + IV_BYTES + TAG_BYTES + 4) return null;
    if (!raw.subarray(0, MAGIC.length).equals(MAGIC)) return null;

    const ivStart = MAGIC.length;
    const tagStart = ivStart + IV_BYTES;
    const dataStart = tagStart + TAG_BYTES;
    const iv = raw.subarray(ivStart, tagStart);
    const tag = raw.subarray(tagStart, dataStart);
    const ciphertext = raw.subarray(dataStart);

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
      decipher.setAAD(Buffer.from(id, 'utf8'));
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      if (plain.length < 4) return null;
      const metaLen = plain.readUInt32BE(0);
      if (plain.length < 4 + metaLen) return null;
      const header = JSON.parse(plain.subarray(4, 4 + metaLen).toString('utf8')) as EnvelopeHeader;
      const body = new Uint8Array(plain.subarray(4 + metaLen));
      return { header, body };
    } catch {
      return null;
    }
  }

  private async loadIndex(): Promise<void> {
    try {
      const raw = await fs.promises.readFile(this.indexPath);
      const dec = this.decryptEnvelope('__index__', raw);
      if (!dec) {
        this.index = {};
        return;
      }
      const parsed = JSON.parse(Buffer.from(dec.body).toString('utf8')) as Record<string, IndexEntry>;
      this.index = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      this.index = {};
    }
  }

  private async saveIndex(): Promise<void> {
    const header: EnvelopeHeader = {
      kind: 'meta',
      url: 'lurkr://preview-cache/index',
      mime: 'application/json',
      storedAt: Date.now(),
      expiresAt: Date.now() + DEFAULT_TTL_MS,
    };
    const body = Buffer.from(JSON.stringify(this.index), 'utf8');
    const sealed = this.encryptEnvelope('__index__', header, body);
    await writeFileAtomic(this.indexPath, sealed);
  }

  private entryFile(id: string): string {
    return path.join(this.entriesDir, `${id}.enc`);
  }

  private async deleteEntry(id: string): Promise<void> {
    delete this.index[id];
    await fs.promises.rm(this.entryFile(id), { force: true }).catch(() => {});
  }

  private async pruneExpiredAndOverflow(): Promise<void> {
    const now = Date.now();
    let changed = false;

    for (const [id, entry] of Object.entries(this.index)) {
      if (entry.expiresAt > 0 && entry.expiresAt <= now) {
        await this.deleteEntry(id);
        changed = true;
      }
    }

    let total = 0;
    for (const entry of Object.values(this.index)) {
      total += entry.size;
    }

    if (total > this.maxBytes) {
      const sorted = Object.entries(this.index).sort(
        (a, b) => a[1].lastAccessAt - b[1].lastAccessAt,
      );
      for (const [id, entry] of sorted) {
        if (total <= this.maxBytes) break;
        await this.deleteEntry(id);
        total -= entry.size;
        changed = true;
      }
    }

    if (changed) {
      await this.saveIndex();
    }
  }

  async getOrFetchImage(rawUrl: string): Promise<CachedImageResult> {
    await this.ensureInit();
    if (!this.enabled) {
      return { ok: false, error: 'Encrypted preview cache disabled' };
    }
    if (!isHttpUrl(rawUrl)) {
      return { ok: false, error: 'Unsupported URL scheme' };
    }

    const existingFlight = this.inFlightImages.get(rawUrl);
    if (existingFlight) return existingFlight;

    const promise = this.getOrFetchImageInternal(rawUrl).finally(() => {
      this.inFlightImages.delete(rawUrl);
    });
    this.inFlightImages.set(rawUrl, promise);
    return promise;
  }

  private async getOrFetchImageInternal(url: string): Promise<CachedImageResult> {
    const id = entryId('image', url);
    const metaEntry = this.index[id];
    const now = Date.now();

    if (metaEntry && (metaEntry.expiresAt <= 0 || metaEntry.expiresAt > now)) {
      try {
        const raw = await fs.promises.readFile(this.entryFile(id));
        const dec = this.decryptEnvelope(id, raw);
        if (dec && dec.header.url === url && dec.header.kind === 'image' && dec.body.byteLength > 0) {
          void this.enqueue(async () => {
            if (this.index[id]) {
              this.index[id].lastAccessAt = Date.now();
              await this.saveIndex();
            }
          });
          return { ok: true, hit: true, mime: dec.header.mime, data: dec.body };
        }
      } catch {
        // Fall through to clean re-fetch
      }
      await this.enqueue(async () => {
        await this.deleteEntry(id);
        await this.saveIndex();
      });
    }

    if (!this.fetcher) {
      return { ok: false, error: 'No image fetcher available' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await this.fetcher(url, { signal: controller.signal });
      if (!resp.ok) {
        return { ok: false, error: `HTTP ${resp.status}` };
      }
      if (!resp.bytes || resp.bytes.byteLength === 0) {
        return { ok: false, error: 'Empty image response' };
      }
      if (resp.bytes.byteLength > MAX_ENTRY_BYTES) {
        return { ok: false, error: 'Image exceeds encrypted cache size cap' };
      }

      const mime = sniffImageMime(resp.bytes, resp.contentType);
      if (!mime) {
        return { ok: false, error: 'Response is not a supported image' };
      }

      const storedAt = Date.now();
      const expiresAt = storedAt + DEFAULT_TTL_MS;
      const header: EnvelopeHeader = {
        kind: 'image',
        url,
        mime,
        storedAt,
        expiresAt,
      };
      const sealed = this.encryptEnvelope(id, header, resp.bytes);

      await this.enqueue(async () => {
        await writeFileAtomic(this.entryFile(id), sealed);
        this.index[id] = {
          kind: 'image',
          size: sealed.byteLength,
          storedAt,
          lastAccessAt: storedAt,
          expiresAt,
        };
        await this.pruneExpiredAndOverflow();
        await this.saveIndex();
      });

      return { ok: true, hit: false, mime, data: resp.bytes };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : 'Image fetch failed' };
    } finally {
      clearTimeout(timer);
    }
  }

  async getMetaBatch(urls: string[]): Promise<Record<string, Record<string, unknown>>> {
    await this.ensureInit();
    if (!this.enabled || urls.length === 0) return {};

    const out: Record<string, Record<string, unknown>> = {};
    const now = Date.now();
    const touchedIds: string[] = [];

    for (const url of urls) {
      if (!isHttpUrl(url)) continue;
      const id = entryId('meta', url);
      const entry = this.index[id];
      if (!entry || (entry.expiresAt > 0 && entry.expiresAt <= now)) continue;
      try {
        const raw = await fs.promises.readFile(this.entryFile(id));
        const dec = this.decryptEnvelope(id, raw);
        if (!dec || dec.header.kind !== 'meta' || dec.header.url !== url) continue;
        const parsed = JSON.parse(Buffer.from(dec.body).toString('utf8')) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') {
          out[url] = parsed;
          touchedIds.push(id);
        }
      } catch {
        // Ignore corrupt entry
      }
    }

    if (touchedIds.length > 0) {
      void this.enqueue(async () => {
        const stamp = Date.now();
        for (const id of touchedIds) {
          if (this.index[id]) this.index[id].lastAccessAt = stamp;
        }
        await this.saveIndex();
      });
    }

    return out;
  }

  async putMeta(items: Array<Record<string, unknown>>): Promise<void> {
    await this.ensureInit();
    if (!this.enabled || items.length === 0) return;

    await this.enqueue(async () => {
      const now = Date.now();
      let changed = false;

      for (const item of items) {
        const url = typeof item?.url === 'string' ? item.url : '';
        if (!url || !isHttpUrl(url)) continue;
        const id = entryId('meta', url);
        const parsedExp =
          typeof item.expiresAt === 'string' ? Date.parse(item.expiresAt) : NaN;
        const expiresAt = Number.isFinite(parsedExp) ? parsedExp : now + DEFAULT_TTL_MS;
        const body = Buffer.from(JSON.stringify(item), 'utf8');
        if (body.byteLength > MAX_ENTRY_BYTES) continue;

        const header: EnvelopeHeader = {
          kind: 'meta',
          url,
          mime: 'application/json',
          storedAt: now,
          expiresAt,
        };
        const sealed = this.encryptEnvelope(id, header, body);
        await writeFileAtomic(this.entryFile(id), sealed);
        this.index[id] = {
          kind: 'meta',
          size: sealed.byteLength,
          storedAt: now,
          lastAccessAt: now,
          expiresAt,
        };
        changed = true;
      }

      if (changed) {
        await this.pruneExpiredAndOverflow();
        await this.saveIndex();
      }
    });
  }

  async configure(opts: { enabled?: boolean; maxBytes?: number }): Promise<EncryptedCacheStats> {
    await this.ensureInit();
    await this.enqueue(async () => {
      if (typeof opts.enabled === 'boolean') {
        this.enabled = opts.enabled;
      }
      if (typeof opts.maxBytes === 'number' && Number.isFinite(opts.maxBytes)) {
        this.maxBytes = Math.min(
          MAX_MAX_BYTES,
          Math.max(MIN_MAX_BYTES, Math.round(opts.maxBytes)),
        );
        await this.pruneExpiredAndOverflow();
      }
    });
    return this.stats();
  }

  async clear(): Promise<void> {
    await this.ensureInit();
    await this.enqueue(async () => {
      this.index = {};
      await this.wipeEntriesFromDisk();
      await fs.promises.mkdir(this.entriesDir, { recursive: true, mode: 0o700 });
      await this.saveIndex();
    });
  }

  async dispose(): Promise<void> {
    if (!this.persistentKey) {
      await this.enqueue(async () => {
        this.index = {};
        await this.wipeEntriesFromDisk();
      });
    }
  }

  async stats(): Promise<EncryptedCacheStats> {
    await this.ensureInit();
    let imageCount = 0;
    let metaCount = 0;
    let totalBytes = 0;
    for (const entry of Object.values(this.index)) {
      if (entry.kind === 'image') imageCount += 1;
      else metaCount += 1;
      totalBytes += entry.size;
    }
    return {
      backend: this.persistentKey ? 'safeStorage+aes-256-gcm' : 'ephemeral-aes-256-gcm',
      persistentKey: this.persistentKey,
      enabled: this.enabled,
      entryCount: imageCount + metaCount,
      imageCount,
      metaCount,
      totalBytes,
      maxBytes: this.maxBytes,
    };
  }
}
