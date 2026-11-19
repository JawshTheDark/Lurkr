// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { mimeMatchesKind, type UploadKind } from '../shared/uploadKinds';
import { UPLOADS_RESTRICTED } from '../shared/accountRestrictions';
import { useAuthStore } from './auth';
import { api, apiMultipart } from '../api';
import { uploadInChunks } from '../lib/chunkedUpload';
import { makeClientId } from '../utils/clientId';
import { isWebmFile } from '../utils/uploaders';

const insertListeners = new Set<(url: string) => void>();
const insertCountListeners = new Set<() => void>();

export function onInsertUrl(cb: (url: string) => void): () => void {
  insertListeners.add(cb);
  for (const l of insertCountListeners) l();
  return () => {
    const removed = insertListeners.delete(cb);
    for (const l of insertCountListeners) l();
    return removed;
  };
}

export function subscribeCanInsert(cb: () => void): () => void {
  insertCountListeners.add(cb);
  return () => insertCountListeners.delete(cb);
}

export function getCanInsert(): boolean {
  return insertListeners.size > 0;
}

function emitInsert(url: string) {
  for (const cb of insertListeners) {
    try {
      cb(url);
    } catch {
      /* ignore */
    }
  }
}

const FAILURE_VISIBLE_MS = 10_000;
const PAGE_SIZE = 50;
const FAVORITES_LIMIT = 200;
const UPLOAD_MENU_LIMIT = 24;
const lateThumbnails = new Map<number, string>();

function withLateThumbnails(items: UploadItem[]): UploadItem[] {
  if (lateThumbnails.size === 0) return items;
  return items.map((item) => {
    if (item.thumbnail_url || item.removed) return item;
    const late = lateThumbnails.get(item.id);
    return late ? { ...item, thumbnail_url: late } : item;
  });
}

export type { UploadKind };
export type UploadMenuMode = 'favorites' | 'recent';
export type UploadPhase = 'uploading' | 'processing' | 'sending';

export interface UploadCurrent {
  token: string;
  phase: UploadPhase;
  progress: number;
  sentPercent: number | null;
  destination: string | null;
  filename: string | null;
}

export interface UploadProgressFrame {
  token: string;
  phase: 'processing' | 'sending';
  percent: number | null;
  destination: string | null;
}

export interface UploadItem {
  id: number;
  url: string;
  filename: string | null;
  mime: string | null;
  thumbnail_url?: string;
  removed?: boolean;
  can_delete?: boolean;
  favorite?: boolean;
}

function uploadsUrl({
  q,
  kind,
  before,
  favorites,
  limit = PAGE_SIZE,
}: {
  q?: string;
  kind?: UploadKind | null;
  before?: number | null;
  favorites?: boolean;
  limit?: number;
}): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before != null) params.set('before', String(before));
  if (q) params.set('q', q);
  if (kind) params.set('kind', kind);
  if (favorites) params.set('favorites', '1');
  return `/api/uploads?${params}`;
}

interface UploadsState {
  current: UploadCurrent | null;
  failedAt: number | null;
  failedMessage: string;
  chunkBytes: number | null;
  ceilingBytes: number | null;

  recent: UploadItem[];
  cursor: number | null;
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  listError: string;

  query: string;
  kind: UploadKind | null;
  favoritesOnly: boolean;
  generation: number;

  menuItems: UploadItem[];
  menuMode: UploadMenuMode;
  menuPreferredMode: UploadMenuMode;
  menuLoading: boolean;
  menuError: string;
  menuGeneration: number;

  setLimits: (opts: { chunkBytes?: number | null; ceilingBytes?: number | null }) => void;
  favoritesTruncated: () => boolean;
  upload: (
    file: File | Blob,
    filename?: string | null,
    opts?: { avatar?: boolean; insert?: boolean },
  ) => Promise<any>;
  applyProgress: (frame: UploadProgressFrame) => void;
  applyThumbnail: (frame: { uploadId?: number; thumbnail_url?: string }) => void;
  uploadText: (content: string, filename?: string) => Promise<any>;
  matchesFilters: (row: UploadItem) => boolean;
  setFilters: (opts: {
    query?: string;
    kind?: UploadKind | null;
    favoritesOnly?: boolean;
  }) => Promise<void>;
  loadRecent: () => Promise<void>;
  loadMore: () => Promise<void>;
  remove: (id: number) => Promise<void>;
  forget: (id: number) => Promise<void>;
  dropLocally: (id: number) => void;
  loadMenu: (mode?: UploadMenuMode) => Promise<boolean>;
  selectMenuMode: (mode: UploadMenuMode) => Promise<void>;
  openMenu: () => Promise<void>;
  setFavorite: (id: number, favorite: boolean) => Promise<void>;
  requestInsert: (url: string) => void;
  reset: () => void;
}

export const useUploadsStore = create<UploadsState>((set, get) => ({
  current: null,
  failedAt: null,
  failedMessage: '',
  chunkBytes: null,
  ceilingBytes: null,

  recent: [],
  cursor: null,
  hasMore: true,
  loaded: false,
  loading: false,
  listError: '',

  query: '',
  kind: null,
  favoritesOnly: false,
  generation: 0,

  menuItems: [],
  menuMode: 'favorites',
  menuPreferredMode: 'favorites',
  menuLoading: false,
  menuError: '',
  menuGeneration: 0,

  setLimits: ({ chunkBytes, ceilingBytes }) => {
    set((s) => ({
      chunkBytes: chunkBytes !== undefined ? chunkBytes : s.chunkBytes,
      ceilingBytes: ceilingBytes !== undefined ? ceilingBytes : s.ceilingBytes,
    }));
  },

  favoritesTruncated: () => get().favoritesOnly && get().recent.length >= FAVORITES_LIMIT,

  upload: async (
    file,
    filename = null,
    { avatar = false, insert = !avatar }: { avatar?: boolean; insert?: boolean } = {},
  ) => {
    if (!useAuthStore.getState().canUpload()) throw new Error(UPLOADS_RESTRICTED);
    if (get().current) return;
    const token = makeClientId();
    const initialName = filename || (file instanceof File ? file.name : null) || 'upload';
    const rawMime = file.type || '';
    const transcodeBridge = !avatar && isWebmFile(rawMime, initialName)
      ? window.lurkerDesktop?.transcodeWebm
      : undefined;
    set({
      current: {
        token,
        phase: 'uploading',
        progress: 0,
        sentPercent: null,
        destination: null,
        filename: filename || (file instanceof File ? file.name : null) || null,
      },
      failedAt: null,
      failedMessage: '',
    });

    const onProgress = (pct: number) => {
      set((s) => {
        if (!s.current) return s;
        const phase: UploadPhase =
          pct >= 100 && s.current.phase === 'uploading' ? 'processing' : s.current.phase;
        return {
          current: {
            ...s.current,
            progress: pct,
            phase,
          },
        };
      });
    };

    const sendToServer = async (uploadFile: File | Blob, name: string) => {
      const fd = new FormData();
      fd.append('progressToken', token);
      if (avatar) fd.append('purpose', 'avatar');
      fd.append('image', uploadFile, name);

      const chunkBytes = get().chunkBytes;
      return chunkBytes != null && uploadFile.size > chunkBytes
        ? await uploadInChunks(uploadFile, {
            purpose: avatar ? 'avatar' : 'upload',
            filename: name,
            progressToken: token,
            onProgress,
            onSent: () => onProgress(100),
          })
        : await apiMultipart('/api/uploads', fd, { onProgress });
    };

    try {
      let uploadFile: File | Blob = file;
      let name = initialName;
      let result: any;

      try {
        result = await sendToServer(uploadFile, name);
      } catch (err: any) {
        const canFallbackTranscode =
          !!transcodeBridge &&
          err?.status === 415 &&
          /not accepted/i.test(String(err?.message || ''));
        if (!canFallbackTranscode) throw err;

        set((s) =>
          s.current && s.current.token === token
            ? {
                current: {
                  ...s.current,
                  phase: 'processing',
                  progress: 0,
                  sentPercent: null,
                  destination:
                    rawMime.split(';')[0].trim().toLowerCase() === 'audio/webm' ? 'M4A' : 'MP4',
                },
              }
            : s,
        );

        const inputFile =
          file instanceof File
            ? file
            : new File([file], initialName, { type: rawMime || 'video/webm' });
        const converted = await transcodeBridge(inputFile);
        if (!converted.ok) {
          throw new Error(
            converted.missingFfmpeg
              ? 'WebM uploads require ffmpeg to convert to MP4 (ffmpeg not found)'
              : `WebM conversion failed: ${converted.error}`,
          );
        }
        const bytes = new Uint8Array(converted.data);
        name = converted.filename || initialName.replace(/\.webm$/i, '.mp4');
        uploadFile = new File([bytes], name, { type: converted.mime || 'video/mp4' });
        set((s) =>
          s.current && s.current.token === token
            ? {
                current: {
                  ...s.current,
                  phase: 'uploading',
                  progress: 0,
                  destination: null,
                  filename: name,
                },
              }
            : s,
        );
        result = await sendToServer(uploadFile, name);
      }

      if (insert) emitInsert(result.url);

      if (get().loaded) {
        const mime: string | null = result.mime ?? (uploadFile.type || null);
        const isImage = typeof mime === 'string' && mime.startsWith('image/');
        const thumbnail_url =
          result.thumbnail_url || (isImage ? `/api/uploads/${result.id}/thumb` : undefined);
        const row: UploadItem = {
          id: result.id,
          url: result.url,
          filename: name,
          mime,
          can_delete: !!result.can_delete,
          ...(thumbnail_url ? { thumbnail_url } : {}),
        };
        if (get().matchesFilters(row)) {
          set((s) => ({ recent: [row, ...s.recent] }));
        }
      }
      return result;
    } catch (err: any) {
      const failedAt = Date.now();
      set({
        failedAt,
        failedMessage: err?.message || 'upload failed',
      });
      setTimeout(() => {
        const s = get();
        if (s.failedAt && Date.now() - s.failedAt >= FAILURE_VISIBLE_MS - 50) {
          set({ failedAt: null, failedMessage: '' });
        }
      }, FAILURE_VISIBLE_MS);
      throw err;
    } finally {
      set({ current: null });
    }
  },

  applyProgress: (frame) => {
    const cur = get().current;
    if (!cur || !frame?.token || frame.token !== cur.token) return;
    if (cur.phase === 'sending' && frame.phase === 'processing') return;
    set({
      current: {
        ...cur,
        phase: frame.phase,
        destination: frame.destination || cur.destination,
        sentPercent: frame.phase === 'sending' ? (frame.percent ?? null) : null,
      },
    });
  },

  applyThumbnail: (frame) => {
    if (typeof frame?.uploadId !== 'number' || typeof frame.thumbnail_url !== 'string') return;
    lateThumbnails.set(frame.uploadId, frame.thumbnail_url);
    set((s) => ({
      recent: s.recent.map((u) =>
        u.id === frame.uploadId ? { ...u, thumbnail_url: frame.thumbnail_url } : u,
      ),
      menuItems: s.menuItems.map((u) =>
        u.id === frame.uploadId ? { ...u, thumbnail_url: frame.thumbnail_url } : u,
      ),
    }));
  },

  uploadText: async (content, filename = 'message.txt') => {
    const blob = new Blob([content], { type: 'text/plain' });
    return get().upload(blob, filename);
  },

  matchesFilters: (row) => {
    const s = get();
    if (s.favoritesOnly && !row.favorite) return false;
    if (s.kind && !mimeMatchesKind(row.mime, s.kind)) return false;
    if (!s.query) return true;
    return (row.filename || '').toLowerCase().includes(s.query.toLowerCase());
  },

  setFilters: async ({ query, kind, favoritesOnly }) => {
    set((s) => ({
      query: query !== undefined ? query : s.query,
      kind: kind !== undefined ? kind : s.kind,
      favoritesOnly: favoritesOnly !== undefined ? favoritesOnly : s.favoritesOnly,
      cursor: null,
      hasMore: true,
    }));
    await get().loadRecent();
  },

  loadRecent: async () => {
    const gen = get().generation + 1;
    set({ generation: gen, loading: true, listError: '' });
    try {
      const s = get();
      const { items } = await api(
        uploadsUrl({
          q: s.query,
          kind: s.kind,
          favorites: s.favoritesOnly,
          limit: s.favoritesOnly ? FAVORITES_LIMIT : PAGE_SIZE,
        }),
      );
      if (gen !== get().generation) return;
      const list = withLateThumbnails((items || []) as UploadItem[]);
      const favoritesOnly = get().favoritesOnly;
      set({
        recent: list,
        cursor: list.length ? list[list.length - 1].id : null,
        hasMore: favoritesOnly ? false : list.length === PAGE_SIZE,
        loaded: true,
      });
    } catch (e: any) {
      if (gen !== get().generation) return;
      set({ listError: e?.message || 'failed to load uploads' });
      throw e;
    } finally {
      if (gen === get().generation) set({ loading: false });
    }
  },

  loadMore: async () => {
    const s = get();
    if (s.loading || !s.hasMore || s.cursor == null) return;
    const gen = s.generation;
    set({ loading: true });
    try {
      const { items } = await api(
        uploadsUrl({
          q: s.query,
          kind: s.kind,
          favorites: s.favoritesOnly,
          before: s.cursor,
        }),
      );
      if (gen !== get().generation) return;
      const list = withLateThumbnails((items || []) as UploadItem[]);
      set((cur) => ({
        recent: [...cur.recent, ...list],
        cursor: list.length ? list[list.length - 1].id : cur.cursor,
        hasMore: list.length === PAGE_SIZE,
      }));
    } catch (e: any) {
      if (gen !== get().generation) return;
      set({ listError: e?.message || 'failed to load more' });
    } finally {
      if (gen === get().generation) set({ loading: false });
    }
  },

  remove: async (id) => {
    await api(`/api/uploads/${id}`, { method: 'DELETE' });
    get().dropLocally(id);
  },

  forget: async (id) => {
    await api(`/api/uploads/${id}/record`, { method: 'DELETE' });
    get().dropLocally(id);
  },

  dropLocally: (id) => {
    set((s) => ({
      recent: s.recent.filter((u) => u.id !== id),
      menuItems: s.menuItems.filter((u) => u.id !== id),
    }));
  },

  loadMenu: async (mode) => {
    const next = mode ?? get().menuMode;
    const gen = get().menuGeneration + 1;
    set({ menuGeneration: gen, menuLoading: true, menuError: '' });
    try {
      const { items } = await api(
        uploadsUrl({ favorites: next === 'favorites', limit: UPLOAD_MENU_LIMIT }),
      );
      if (gen !== get().menuGeneration) return false;
      set({
        menuItems: withLateThumbnails(((items || []) as UploadItem[]).filter((u) => !u.removed)),
        menuMode: next,
      });
    } catch (e: any) {
      if (gen !== get().menuGeneration) return false;
      set({ menuError: e?.message || 'failed to load uploads' });
    } finally {
      if (gen === get().menuGeneration) set({ menuLoading: false });
    }
    return gen === get().menuGeneration;
  },

  selectMenuMode: async (mode) => {
    set({ menuPreferredMode: mode });
    await get().loadMenu(mode);
  },

  openMenu: async () => {
    if (!(await get().loadMenu(get().menuPreferredMode))) return;
    const s = get();
    if (s.menuMode === 'favorites' && !s.menuItems.length && !s.menuError) {
      await get().loadMenu('recent');
    }
  },

  setFavorite: async (id, favorite) => {
    await api(`/api/uploads/${id}/favorite`, { method: favorite ? 'PUT' : 'DELETE' });
    set((s) => {
      const recentRow = s.recent.find((u) => u.id === id);
      const menuRow = s.menuItems.find((u) => u.id === id);
      let nextRecent = s.recent.map((u) => (u.id === id ? { ...u, favorite } : u));
      if (!favorite && s.favoritesOnly) {
        nextRecent = nextRecent.filter((u) => u.id !== id);
      }
      let nextMenu = s.menuItems.map((u) => (u.id === id ? { ...u, favorite } : u));
      if (s.menuMode === 'favorites') {
        if (favorite) {
          const known = recentRow ?? menuRow;
          if (known) {
            nextMenu = [{ ...known, favorite: true }, ...nextMenu.filter((u) => u.id !== id)];
          }
        } else {
          nextMenu = nextMenu.filter((u) => u.id !== id);
        }
      }
      return { recent: nextRecent, menuItems: nextMenu };
    });
  },

  requestInsert: (url) => emitInsert(url),

  reset: () => {
    lateThumbnails.clear();
    set({
      current: null,
      failedAt: null,
      failedMessage: '',
      recent: [],
      cursor: null,
      hasMore: true,
      loaded: false,
      loading: false,
      listError: '',
      query: '',
      kind: null,
      favoritesOnly: false,
      menuItems: [],
      menuMode: 'favorites',
      menuPreferredMode: 'favorites',
      menuLoading: false,
      menuError: '',
    });
  },
}));
