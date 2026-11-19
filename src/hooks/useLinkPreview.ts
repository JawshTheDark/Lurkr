// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { useSyncExternalStore } from 'react';
import { api } from '../api';
import {
  getCachedMetaBatch,
  isEncryptedPreviewCacheActive,
  putCachedMeta,
  revokeMemoryPreviewUrls,
} from '../lib/encryptedPreviewCache';
import { previewableUrls, type PreviewToggles } from '../utils/previewUrls';

export type PreviewKind = 'image' | 'video' | 'audio' | 'page' | 'video-embed';

export interface LinkPreview {
  url: string;
  status: 'ok' | 'unavailable';
  kind?: PreviewKind;
  title?: string;
  description?: string;
  siteName?: string;
  author?: string;
  thumb?: string;
  thumbWidth?: number;
  thumbHeight?: number;
  src?: string;
  embedUrl?: string;
  mime?: string;
  expiresAt?: string;
}

const FLUSH_MS = 50;
const MAX_BATCH = 20;
const MAX_CACHE = 500;
const REASK_FLOOR_MS = 15_000;
const MAX_TRANSIENT_TTL_MS = 5 * 60_000;

const cache = new Map<string, LinkPreview | null>();
// Value is 0 while in-flight or settled without transient expiry, or epoch ms when retryable.
const asked = new Map<string, number>();
// Epoch ms when transient `unavailable` results should be re-requested automatically.
const retryAt = new Map<string, number>();
let queue = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let reaskTimer: ReturnType<typeof setTimeout> | null = null;
let revision = 0;
const listeners = new Set<() => void>();

function notify(): void {
  revision += 1;
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore listener errors */
    }
  }
}

function evictOverflow(): void {
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
    asked.delete(oldest);
    retryAt.delete(oldest);
  }
}

function scheduleReask(): void {
  if (reaskTimer !== null || retryAt.size === 0) return;
  let soonest = Infinity;
  for (const at of retryAt.values()) {
    if (at < soonest) soonest = at;
  }
  if (!Number.isFinite(soonest)) return;
  const delay = Math.max(250, soonest - Date.now());
  reaskTimer = setTimeout(runReask, delay);
}

function runReask(): void {
  reaskTimer = null;
  const now = Date.now();
  let queued = false;
  for (const [url, at] of retryAt.entries()) {
    if (at <= now) {
      retryAt.delete(url);
      asked.set(url, 0);
      queue.add(url);
      queued = true;
    }
  }
  if (queued && flushTimer === null) {
    flushTimer = setTimeout(() => void flushQueue(), FLUSH_MS);
  }
  scheduleReask();
}

function armTransientRetry(url: string, expiresAt?: string): void {
  const parsed = expiresAt ? Date.parse(expiresAt) : NaN;
  const now = Date.now();
  if (!Number.isFinite(parsed) || parsed - now > MAX_TRANSIENT_TTL_MS) {
    retryAt.delete(url);
    return;
  }
  const when = Math.max(now + REASK_FLOOR_MS, parsed);
  asked.set(url, when);
  retryAt.set(url, when);
}

async function flushQueue(): Promise<void> {
  flushTimer = null;
  if (queue.size === 0) return;
  const urls = Array.from(queue);
  queue = new Set();

  for (let i = 0; i < urls.length; i += MAX_BATCH) {
    const batch = urls.slice(i, i + MAX_BATCH);
    try {
      const res = await api<{ previews?: LinkPreview[] }>('/api/link-preview/resolve', {
        method: 'POST',
        body: { urls: batch },
      });
      const list = Array.isArray(res?.previews) ? res.previews : [];
      const answered = new Set<string>();
      const okItems: LinkPreview[] = [];
      let changed = false;

      for (const item of list) {
        if (!item || typeof item.url !== 'string') continue;
        answered.add(item.url);
        const prev = cache.get(item.url);
        cache.delete(item.url);
        cache.set(item.url, item);
        if (prev !== item) changed = true;

        if (item.status === 'ok') {
          retryAt.delete(item.url);
          const exp = item.expiresAt ? Date.parse(item.expiresAt) : NaN;
          asked.set(item.url, Number.isFinite(exp) ? exp : 0);
          okItems.push(item);
        } else {
          armTransientRetry(item.url, item.expiresAt);
        }
      }

      if (okItems.length > 0) {
        void putCachedMeta(okItems);
      }

      // Any URL omitted from the response stays retryable on the next prime instead of remaining wedged.
      for (const u of batch) {
        if (!answered.has(u)) {
          asked.delete(u);
          retryAt.delete(u);
        }
      }

      evictOverflow();
      scheduleReask();
      if (changed) notify();
    } catch {
      // Allow subsequent priming or scrollback revisit to retry after transport/server errors.
      for (const u of batch) {
        asked.delete(u);
        retryAt.delete(u);
      }
    }
  }
}

let cacheEpoch = 0;

function enqueueFlush(urls: string[]): void {
  if (urls.length === 0) return;
  for (const url of urls) queue.add(url);
  if (flushTimer === null) {
    flushTimer = setTimeout(() => void flushQueue(), FLUSH_MS);
  }
}

export function primePreviews(
  texts: Array<string | null | undefined>,
  toggles: PreviewToggles,
): void {
  if (!toggles.inlineMedia && !toggles.linkPreviews) return;
  const now = Date.now();
  const missing: string[] = [];

  for (const t of texts) {
    if (!t) continue;
    for (const url of previewableUrls(t, toggles)) {
      const askedUntil = asked.get(url);
      if (askedUntil !== undefined) {
        if (askedUntil === 0 || now < askedUntil) continue;
        asked.delete(url);
        retryAt.delete(url);
      }
      asked.set(url, 0);
      missing.push(url);
    }
  }

  if (missing.length === 0) return;

  if (!isEncryptedPreviewCacheActive()) {
    enqueueFlush(missing);
    return;
  }

  const epoch = cacheEpoch;
  void getCachedMetaBatch(missing)
    .then((hits) => {
      if (epoch !== cacheEpoch) return;
      const misses: string[] = [];
      let hydrated = false;
      for (const url of missing) {
        const hit = hits[url];
        if (hit && hit.status === 'ok') {
          cache.set(url, hit);
          const exp = hit.expiresAt ? Date.parse(hit.expiresAt) : NaN;
          asked.set(url, Number.isFinite(exp) ? exp : 0);
          hydrated = true;
        } else {
          misses.push(url);
        }
      }
      if (hydrated) notify();
      enqueueFlush(misses);
    })
    .catch(() => {
      if (epoch !== cacheEpoch) return;
      enqueueFlush(missing);
    });
}

export function clearPreviewCache(): void {
  cacheEpoch += 1;
  cache.clear();
  asked.clear();
  retryAt.clear();
  queue.clear();
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (reaskTimer !== null) {
    clearTimeout(reaskTimer);
    reaskTimer = null;
  }
  revokeMemoryPreviewUrls();
  notify();
}

export function getPreviewRevision(): number {
  return revision;
}

export function subscribePreviews(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useLinkPreview(url: string | null | undefined): LinkPreview | null {
  useSyncExternalStore(subscribePreviews, getPreviewRevision, getPreviewRevision);
  if (!url) return null;
  return cache.get(url) ?? null;
}
