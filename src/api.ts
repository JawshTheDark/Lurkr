// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

export interface ApiError extends Error {
  status?: number;
  data?: unknown;
}

export interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface DesktopAppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  userDataPath: string;
  configPath: string;
  sessionType: string;
}

export interface DesktopOperCapabilityFlags {
  canOper: boolean;
  canDeoper: boolean;
  canKill: boolean;
  canKline: boolean;
  canDline: boolean;
  canGline: boolean;
  canZline: boolean;
  canShun: boolean;
  canSpamfilter: boolean;
  canRehash: boolean;
  canBroadcast: boolean;
  canServerRouting: boolean;
  canUban: boolean;
  canDefcon: boolean;
  canModules: boolean;
  canDns: boolean;
  canPrivs: boolean;
}

export interface DesktopMenuState {
  loggedIn: boolean;
  isAdmin: boolean;
  dccEnabled: boolean;
  networkId: number | null;
  networkName: string;
  networkState: string;
  target: string;
  hasActiveBuffer: boolean;
  canCloseBuffer: boolean;
  isChannel: boolean;
  isAway: boolean;
  nick: string;
  isOper: boolean;
  operSoftwareLabel: string;
  operToolbarVisible: boolean;
  canRename?: boolean;
  showChannelList: boolean;
  showMemberList: boolean;
  activeThemeId: string;
  themes: Array<{ id: string; name: string }>;
  operCaps: DesktopOperCapabilityFlags;
}

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

export interface DesktopBridge {
  isElectron: boolean;
  platform: string;
  getConfig: () => Promise<{ serverUrl: string; allowSelfSigned: boolean }>;
  setConfig: (next: Partial<{ serverUrl: string; allowSelfSigned: boolean }>) => Promise<{
    serverUrl: string;
    allowSelfSigned: boolean;
  }>;
  getAppInfo?: () => Promise<DesktopAppInfo>;
  setBadge: (count: number) => Promise<void>;
  notify: (payload: { title: string; body: string; bufferPath?: string }) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  readClipboardImage?: () => Promise<{ data: Uint8Array; mime: string; filename: string } | null>;
  transcodeWebm?: (
    file: File,
  ) => Promise<
    | { ok: true; data: Uint8Array; mime: string; filename: string }
    | { ok: false; error: string; missingFfmpeg?: boolean }
  >;
  updateMenuState?: (state: DesktopMenuState) => Promise<void>;
  onMenuAction?: (cb: (payload: { action: string; arg?: string }) => void) => () => void;
  onNavigate: (cb: (path: string) => void) => () => void;
  previewCache?: {
    getOrFetchImage: (url: string) => Promise<CachedImageResult>;
    getMetaBatch: (urls: string[]) => Promise<Record<string, unknown>>;
    putMeta: (items: Array<Record<string, unknown>>) => Promise<void>;
    stats: () => Promise<EncryptedCacheStats>;
    clear: () => Promise<void>;
    configure: (opts: { enabled?: boolean; maxBytes?: number }) => Promise<EncryptedCacheStats>;
  };
}

declare global {
  interface Window {
    lurkerDesktop?: DesktopBridge;
  }
}

const SERVER_URL_KEY = 'lurker:serverUrl';
const AUTH_RECOVERY_FLAG = 'lurker:authRecoveryAttempted';

let cachedServerUrl = (() => {
  try {
    return (localStorage.getItem(SERVER_URL_KEY) || '').trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
})();

export function getServerUrl(): string {
  return cachedServerUrl;
}

export function setServerUrl(url: string): string {
  const normalized = url.trim().replace(/\/+$/, '');
  cachedServerUrl = normalized;
  try {
    if (normalized) localStorage.setItem(SERVER_URL_KEY, normalized);
    else localStorage.removeItem(SERVER_URL_KEY);
  } catch {
    /* ignore */
  }
  if (window.lurkerDesktop && normalized) {
    void window.lurkerDesktop.setConfig({ serverUrl: normalized });
  }
  return normalized;
}

export async function initDesktopServerUrl(): Promise<string> {
  if (!window.lurkerDesktop) return cachedServerUrl;
  try {
    const cfg = await window.lurkerDesktop.getConfig();
    if (cfg.serverUrl && !cachedServerUrl) {
      cachedServerUrl = cfg.serverUrl.trim().replace(/\/+$/, '');
      try {
        localStorage.setItem(SERVER_URL_KEY, cachedServerUrl);
      } catch {
        /* ignore */
      }
    } else if (cachedServerUrl && cfg.serverUrl !== cachedServerUrl) {
      await window.lurkerDesktop.setConfig({ serverUrl: cachedServerUrl });
    }
  } catch {
    /* ignore */
  }
  return cachedServerUrl;
}

/** Resolve a server-relative path like `/api/uploads/1/thumb` against the configured server URL. */
export function resolveServerUrl(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }
  const base = cachedServerUrl;
  if (!base) return url;
  // In Vite dev on localhost:5173, if serverUrl is set to something else, use it;
  // if serverUrl is empty, relative `/api/...` uses Vite proxy.
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
}

export function resolveWsBaseUrl(): string {
  const base = cachedServerUrl;
  if (base) {
    try {
      const u = new URL(base);
      const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${u.host}/ws`;
    } catch {
      /* fallback */
    }
  }
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' || pathname.startsWith('/invite/') || pathname.startsWith('/recover/')
  );
}

export function shouldBounceToLogin(
  url: string,
  status: number,
  alreadyTried: boolean,
  pathname: string,
): boolean {
  if (status !== 401 || alreadyTried) return false;
  if (url.startsWith('/api/auth/') || url.startsWith('/_cp/')) return false;
  if (isPublicPath(pathname)) return false;
  return true;
}

const authFailureListeners = new Set<() => void>();
export function onAuthFailure(cb: () => void): () => void {
  authFailureListeners.add(cb);
  return () => authFailureListeners.delete(cb);
}

function bounceToLoginOnAuthFailure(url: string, status: number): void {
  let alreadyTried = false;
  try {
    alreadyTried = sessionStorage.getItem(AUTH_RECOVERY_FLAG) === '1';
  } catch {
    return;
  }
  const currentPath = window.location.hash
    ? window.location.hash.replace(/^#/, '')
    : window.location.pathname;
  if (!shouldBounceToLogin(url, status, alreadyTried, currentPath)) return;
  try {
    sessionStorage.setItem(AUTH_RECOVERY_FLAG, '1');
  } catch {
    /* ignore */
  }
  for (const cb of authFailureListeners) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}

export function clearAuthRecoveryGuard(): void {
  try {
    sessionStorage.removeItem(AUTH_RECOVERY_FLAG);
  } catch {
    /* ignore */
  }
}

export async function api<T = any>(
  url: string,
  { method = 'GET', body, headers, signal }: ApiRequestOptions = {},
): Promise<T> {
  const resolved = resolveServerUrl(url);
  const res = await fetch(resolved, {
    method,
    signal,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    bounceToLoginOnAuthFailure(url, res.status);
    const message = (data && data.error) || res.statusText || 'request failed';
    const err = new Error(message) as ApiError;
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

export interface MultipartOptions {
  onProgress?: (percent: number) => void;
}

export function apiMultipart<T = any>(
  url: string,
  formData: FormData,
  { onProgress }: MultipartOptions = {},
): Promise<T> {
  return apiSend<T>('POST', url, formData, {
    onProgress: (loaded, total) => {
      if (onProgress && total > 0) onProgress(Math.min(100, Math.round((loaded / total) * 100)));
    },
  });
}

export interface SendOptions {
  headers?: Record<string, string>;
  onProgress?: (loaded: number, total: number) => void;
  stallMs?: number;
}

export function apiSend<T = any>(
  method: string,
  url: string,
  body: FormData | Blob,
  { headers, onProgress, stallMs }: SendOptions = {},
): Promise<T> {
  const resolved = resolveServerUrl(url);
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, resolved, true);
    xhr.withCredentials = true;
    xhr.responseType = 'text';
    for (const [name, value] of Object.entries(headers ?? {})) xhr.setRequestHeader(name, value);
    let stalled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const armStall = () => {
      if (!stallMs) return;
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, stallMs);
    };
    xhr.addEventListener('loadend', () => clearTimeout(stallTimer));
    xhr.upload.addEventListener('progress', (e) => {
      armStall();
      if (!onProgress || !e.lengthComputable) return;
      onProgress(e.loaded, e.total);
    });
    xhr.addEventListener('load', () => {
      const text = xhr.responseText || '';
      let data: any = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T);
      } else {
        bounceToLoginOnAuthFailure(url, xhr.status);
        const message = (data && data.error) || xhr.statusText || 'upload failed';
        const err = new Error(message) as ApiError;
        err.status = xhr.status;
        err.data = data;
        reject(err);
      }
    });
    xhr.addEventListener('error', () => reject(new Error('network error')));
    xhr.addEventListener('abort', () =>
      reject(new Error(stalled ? 'network stalled' : 'upload aborted')),
    );
    xhr.send(body);
    armStall();
  });
}
