// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  safeStorage,
  screen,
  session,
  shell,
} from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildApplicationMenu,
  DEFAULT_MENU_STATE,
  type DesktopMenuState,
} from './menu.js';
import { transcodeWebmFile, type TranscodeWebmRequest } from './transcode.js';
import { EncryptedPreviewCache } from './previewCache.js';
import { DesktopUpdater } from './updater.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.LURKER_DEV === '1';

function sanitizedDesktopEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Strip Electron/AppImage env overrides that can prevent system browsers/xdg-open from launching cleanly
  delete env.LD_LIBRARY_PATH;
  delete env.LD_PRELOAD;
  delete env.APPIMAGE;
  delete env.APPDIR;
  // Finder/Dock-launched macOS .app bundles inherit a minimal PATH without Homebrew/MacPorts binaries.
  if (process.platform === 'darwin') {
    const parts = (env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin').split(':').filter(Boolean);
    for (const extra of ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin']) {
      if (!parts.includes(extra)) parts.push(extra);
    }
    env.PATH = parts.join(':');
  }
  return env;
}

function spawnDetachedOpener(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, {
        detached: true,
        stdio: 'ignore',
        env: sanitizedDesktopEnv(),
      });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

async function openExternalSafe(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
  const normalized = parsed.toString();

  try {
    await shell.openExternal(normalized);
    return;
  } catch (err) {
    console.warn('[lurkr] shell.openExternal failed, trying desktop opener fallback:', err);
  }

  if (process.platform === 'linux') {
    const candidates: Array<[string, string[]]> = [
      ['xdg-open', [normalized]],
      ['gio', ['open', normalized]],
      ['kioclient', ['exec', normalized]],
      ['kioclient6', ['exec', normalized]],
    ];
    for (const [cmd, args] of candidates) {
      if (await spawnDetachedOpener(cmd, args)) return;
    }
  }
}

function isAppNavigationUrl(rawUrl: string): boolean {
  if (rawUrl.startsWith('file://')) return true;
  if (isDev && rawUrl.startsWith('http://localhost:5173')) return true;
  return false;
}

function resolveAppIcon(): string | undefined {
  const unpackedDirs = process.resourcesPath
    ? [
        path.join(process.resourcesPath, `app-${process.arch}.asar.unpacked`, 'dist'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'dist'),
      ]
    : [];
  const prodDist = path.join(__dirname, '../dist');
  const devPublic = path.join(__dirname, '../public');
  const names =
    process.platform === 'win32'
      ? ['lurker-icon.ico', 'lurker-icon-512.png']
      : ['lurker-icon-512.png'];

  for (const name of names) {
    for (const dir of [...unpackedDirs, prodDist, devPublic]) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

let cachedUnreadOverlay: Electron.NativeImage | null = null;
function getUnreadOverlayIcon(): Electron.NativeImage {
  if (cachedUnreadOverlay) return cachedUnreadOverlay;
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  const radius = 6.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - center, y - center);
      if (dist <= radius + 0.5) {
        const offset = (y * size + x) * 4;
        const alpha = dist <= radius - 0.5 ? 255 : Math.max(0, Math.round((radius + 0.5 - dist) * 255));
        // BGRA little-endian for Electron createFromBitmap (#ed6c89)
        buf[offset] = 0x89;
        buf[offset + 1] = 0x6c;
        buf[offset + 2] = 0xed;
        buf[offset + 3] = alpha;
      }
    }
  }
  cachedUnreadOverlay = nativeImage.createFromBitmap(buf, { width: size, height: size });
  return cachedUnreadOverlay;
}

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

interface DesktopConfig {
  serverUrl: string;
  allowSelfSigned: boolean;
  autoCheckUpdates?: boolean;
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'lurker-desktop.json');
}

function getWindowStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadConfig(): DesktopConfig {
  const fallback: DesktopConfig = {
    serverUrl: process.env.LURKER_SERVER_URL || '',
    allowSelfSigned: false,
    autoCheckUpdates: true,
  };
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<DesktopConfig>;
    return {
      serverUrl: typeof parsed.serverUrl === 'string' && parsed.serverUrl.trim()
        ? parsed.serverUrl.trim().replace(/\/+$/, '')
        : fallback.serverUrl,
      allowSelfSigned: Boolean(parsed.allowSelfSigned),
      autoCheckUpdates: parsed.autoCheckUpdates !== false,
    };
  } catch {
    return fallback;
  }
}

function saveConfig(cfg: DesktopConfig): void {
  try {
    fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
    fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

function isRectVisibleOnDisplays(x: number, y: number, width: number, height: number): boolean {
  try {
    const displays = screen.getAllDisplays();
    return displays.some((d) => {
      const area = d.workArea;
      const overlapX = Math.min(x + width, area.x + area.width) - Math.max(x, area.x);
      const overlapY = Math.min(y + height, area.y + area.height) - Math.max(y, area.y);
      return overlapX >= 80 && overlapY >= 60;
    });
  } catch {
    return true;
  }
}

function loadWindowState(): WindowState {
  const fallback: WindowState = { width: 1280, height: 840 };
  try {
    const raw = fs.readFileSync(getWindowStatePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    const width = typeof parsed.width === 'number' && parsed.width >= 400 ? parsed.width : fallback.width;
    const height = typeof parsed.height === 'number' && parsed.height >= 300 ? parsed.height : fallback.height;
    const hasCoords = typeof parsed.x === 'number' && typeof parsed.y === 'number';
    const coordsVisible =
      hasCoords && isRectVisibleOnDisplays(parsed.x as number, parsed.y as number, width, height);
    return {
      width,
      height,
      x: coordsVisible ? parsed.x : undefined,
      y: coordsVisible ? parsed.y : undefined,
      isMaximized: Boolean(parsed.isMaximized),
    };
  } catch {
    return fallback;
  }
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const bounds = win.getBounds();
    const state: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: win.isMaximized(),
    };
    fs.mkdirSync(path.dirname(getWindowStatePath()), { recursive: true });
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

let mainWindow: BrowserWindow | null = null;
let desktopConfig: DesktopConfig = loadConfig();
let currentMenuState: DesktopMenuState = DEFAULT_MENU_STATE;
let pendingMenuAction: { action: string; arg?: string } | null = null;

function dispatchMenuAction(action: string, arg?: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingMenuAction = { action, arg };
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('lurker:menu-action', { action, arg });
}

function rebuildApplicationMenu(): void {
  const menu = buildApplicationMenu({
    state: currentMenuState,
    window: mainWindow,
    onAction: dispatchMenuAction,
    onOpenUserData: () => {
      void shell.openPath(app.getPath('userData'));
    },
  });
  Menu.setApplicationMenu(menu);
}

function matchesConfiguredServer(urlStr: string): boolean {
  if (!desktopConfig.serverUrl) return false;
  try {
    const target = new URL(urlStr);
    const configured = new URL(desktopConfig.serverUrl);
    if (target.host !== configured.host) return false;
    if (target.protocol === configured.protocol) return true;
    return (
      (configured.protocol === 'https:' && target.protocol === 'wss:') ||
      (configured.protocol === 'http:' && target.protocol === 'ws:')
    );
  } catch {
    return false;
  }
}

function normalizeSetCookieForDesktop(cookie: string, isSecureOrigin: boolean): string {
  if (!isSecureOrigin) {
    return cookie.replace(/;\s*SameSite=(Strict|Lax|None)/gi, '');
  }
  let updated = /;\s*SameSite=/i.test(cookie)
    ? cookie.replace(/;\s*SameSite=(Strict|Lax|None)/gi, '; SameSite=None')
    : `${cookie}; SameSite=None`;
  if (!/;\s*Secure(?:\s*;|$)/i.test(updated)) {
    updated = `${updated}; Secure`;
  }
  return updated;
}

function matchesEmbedOrigin(urlStr: string): string | null {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    const isYoutube =
      host === 'youtube-nocookie.com' ||
      host.endsWith('.youtube-nocookie.com') ||
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'ytimg.com' ||
      host.endsWith('.ytimg.com') ||
      host === 'googlevideo.com' ||
      host.endsWith('.googlevideo.com');
    if (isYoutube) {
      if (desktopConfig.serverUrl.startsWith('https://')) {
        try {
          return `${new URL(desktopConfig.serverUrl).origin}/`;
        } catch {
          // fall through
        }
      }
      return 'https://www.youtube.com/';
    }
    const isVimeo = host === 'player.vimeo.com' || host === 'vimeo.com' || host.endsWith('.vimeocdn.com');
    if (isVimeo) {
      if (desktopConfig.serverUrl.startsWith('https://')) {
        try {
          return `${new URL(desktopConfig.serverUrl).origin}/`;
        } catch {
          // fall through
        }
      }
      return 'https://player.vimeo.com/';
    }
    return null;
  } catch {
    return null;
  }
}

function setupNetworkBridge(): void {
  const ses = session.defaultSession;
  const originalOrigins = new Map<number, string>();

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    void (async () => {
      const headers = { ...details.requestHeaders };
      const embedRef = matchesEmbedOrigin(details.url);
      if (embedRef) {
        const curRef = headers['Referer'] || headers['referer'];
        if (!curRef || /^file:/i.test(String(curRef))) {
          delete headers['referer'];
          headers['Referer'] = embedRef;
        }
        const curOrigin = headers['Origin'] || headers['origin'];
        if (curOrigin && (/^file:/i.test(String(curOrigin)) || curOrigin === 'null')) {
          delete headers['origin'];
          headers['Origin'] = new URL(embedRef).origin;
        }
      }
      if (matchesConfiguredServer(details.url)) {
        const reqOrigin = headers['Origin'] || headers['origin'];
        if (reqOrigin) {
          originalOrigins.set(details.id, reqOrigin);
        }
        try {
          headers['Origin'] = new URL(desktopConfig.serverUrl).origin;
        } catch {
          // ignore
        }
        const hasCookieHeader = Object.keys(headers).some(
          (k) => k.toLowerCase() === 'cookie',
        );
        if (!hasCookieHeader) {
          try {
            const cookieUrl = details.url
              .replace(/^ws:/i, 'http:')
              .replace(/^wss:/i, 'https:');
            const cookies = await ses.cookies.get({ url: cookieUrl });
            if (cookies.length > 0) {
              headers['Cookie'] = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
            }
          } catch {
            // ignore cookie bridge lookup failures
          }
        }
      }
      callback({ requestHeaders: headers });
    })();
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    const reqOrigin = originalOrigins.get(details.id);
    originalOrigins.delete(details.id);

    if (!matchesConfiguredServer(details.url)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const headers = { ...(details.responseHeaders || {}) };
    const allowOrigin = reqOrigin || (isDev ? 'http://localhost:5173' : 'null');
    const isSecureOrigin =
      details.url.startsWith('https://') ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(details.url);
    const isHttp = /^https?:/i.test(details.url);

    // Remove conflicting CORS headers (case-insensitive)
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (
        isHttp &&
        (lower === 'access-control-allow-origin' ||
          lower === 'access-control-allow-credentials' ||
          lower === 'access-control-allow-headers' ||
          lower === 'access-control-allow-methods' ||
          lower === 'cross-origin-resource-policy')
      ) {
        delete headers[key];
      }
      // Allow cookies from self-hosted servers inside Electron file:// or localhost
      if (lower === 'set-cookie' && Array.isArray(headers[key])) {
        headers[key] = headers[key].map((cookie) =>
          normalizeSetCookieForDesktop(cookie, isSecureOrigin),
        );
      }
    }

    if (isHttp) {
      headers['Access-Control-Allow-Origin'] = [allowOrigin];
      headers['Access-Control-Allow-Credentials'] = ['true'];
      headers['Cross-Origin-Resource-Policy'] = ['cross-origin'];
      headers['Access-Control-Allow-Headers'] = [
        'Content-Type, Authorization, Upload-Offset, Accept, X-Requested-With',
      ];
      headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, PATCH, DELETE, OPTIONS'];
    }
    callback({ responseHeaders: headers });
  });

  ses.webRequest.onErrorOccurred((details) => {
    originalOrigins.delete(details.id);
  });
}

function createWindow(): void {
  const state = loadWindowState();
  const icon = resolveAppIcon();
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 380,
    minHeight: 520,
    title: 'Lurker',
    icon,
    backgroundColor: '#121316',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (state.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.on('maximize', rebuildApplicationMenu);
  mainWindow.on('unmaximize', rebuildApplicationMenu);
  mainWindow.on('always-on-top-changed', rebuildApplicationMenu);

  mainWindow.on('close', () => {
    if (mainWindow) saveWindowState(mainWindow);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    rebuildApplicationMenu();
  });

  mainWindow.webContents.once('did-finish-load', () => {
    if (!pendingMenuAction || !mainWindow || mainWindow.isDestroyed()) return;
    const queued = pendingMenuAction;
    pendingMenuAction = null;
    mainWindow.webContents.send('lurker:menu-action', queued);
  });

  if (isDev) {
    void mainWindow.loadURL('http://localhost:5173');
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
  rebuildApplicationMenu();
}

app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
  if (desktopConfig.allowSelfSigned && matchesConfiguredServer(url)) {
    event.preventDefault();
    callback(true);
    return;
  }
  callback(false);
});

app.setName('Lurker');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.lurker.desktop');
}
if (process.platform === 'linux') {
  (app as Electron.App & { setDesktopName?: (name: string) => void }).setDesktopName?.(
    'lurkr.desktop',
  );
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

if (
  process.platform === 'linux' &&
  !app.commandLine.hasSwitch('ozone-platform-hint') &&
  !app.commandLine.hasSwitch('ozone-platform')
) {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    focusMainWindow();
  });
}

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void openExternalSafe(url);
    }
    return { action: 'deny' };
  });

  contents.on('will-navigate', (navEvent, url) => {
    if (!isAppNavigationUrl(url) && /^https?:\/\//i.test(url)) {
      navEvent.preventDefault();
      void openExternalSafe(url);
    }
  });
});

app.whenReady().then(() => {
  desktopConfig = loadConfig();
  setupNetworkBridge();

  ipcMain.handle('lurker:get-config', () => desktopConfig);
  ipcMain.handle('lurker:set-config', (_event, next: Partial<DesktopConfig>) => {
    desktopConfig = {
      serverUrl:
        typeof next.serverUrl === 'string' && next.serverUrl.trim()
          ? next.serverUrl.trim().replace(/\/+$/, '')
          : desktopConfig.serverUrl,
      allowSelfSigned:
        typeof next.allowSelfSigned === 'boolean'
          ? next.allowSelfSigned
          : desktopConfig.allowSelfSigned,
      autoCheckUpdates:
        typeof next.autoCheckUpdates === 'boolean'
          ? next.autoCheckUpdates
          : desktopConfig.autoCheckUpdates,
    };
    saveConfig(desktopConfig);
    return desktopConfig;
  });
  ipcMain.handle('lurker:set-badge', (_event, count: number) => {
    const safeCount = Math.max(0, Math.floor(count || 0));
    try {
      if (process.platform === 'win32') {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setOverlayIcon(
            safeCount > 0 ? getUnreadOverlayIcon() : null,
            safeCount > 0 ? `${safeCount} unread` : '',
          );
        }
      } else {
        app.setBadgeCount(safeCount);
      }
    } catch {
      // ignore on unsupported platforms
    }
  });
  ipcMain.handle(
    'lurker:notify',
    (_event, payload: { title: string; body: string; bufferPath?: string }) => {
      if (!Notification.isSupported()) return;
      const n = new Notification({
        title: payload.title || 'Lurker',
        body: payload.body || '',
        icon: resolveAppIcon(),
      });
      n.on('click', () => {
        focusMainWindow();
        if (mainWindow && !mainWindow.isDestroyed() && payload.bufferPath) {
          mainWindow.webContents.send('lurker:navigate', payload.bufferPath);
        }
      });
      n.show();
    },
  );
  ipcMain.handle('lurker:open-external', async (_event, url: string) => {
    await openExternalSafe(url);
  });
  ipcMain.handle('lurker:read-clipboard-image', () => {
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    const png = img.toPNG();
    return {
      data: new Uint8Array(png),
      mime: 'image/png',
      filename: 'screenshot.png',
    };
  });
  ipcMain.handle('lurker:transcode-webm', (_event, req: TranscodeWebmRequest) =>
    transcodeWebmFile(req, sanitizedDesktopEnv()),
  );
  ipcMain.handle('lurker:get-app-info', () => ({
    name: 'Lurkr',
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    userDataPath: app.getPath('userData'),
    configPath: getConfigPath(),
    sessionType: process.env.XDG_SESSION_TYPE || '',
  }));
  ipcMain.handle('lurker:set-menu-state', (_event, nextState: DesktopMenuState) => {
    currentMenuState = nextState || DEFAULT_MENU_STATE;
    rebuildApplicationMenu();
  });

  const previewCache = new EncryptedPreviewCache({
    cacheDir: path.join(app.getPath('userData'), 'encrypted-preview-cache'),
    safeStorage,
    fetcher: async (url, { signal }) => {
      const MAX_FETCH_BYTES = 25 * 1024 * 1024;
      const resp = await session.defaultSession.fetch(url, {
        cache: 'no-store',
        credentials: 'include',
        signal,
      });
      const contentType = resp.headers.get('content-type') || '';
      const clHeader = Number(resp.headers.get('content-length') || 0);
      if (Number.isFinite(clHeader) && clHeader > MAX_FETCH_BYTES) {
        return { ok: false, status: 413, contentType, bytes: new Uint8Array(0) };
      }
      if (!resp.ok) {
        return { ok: false, status: resp.status, contentType, bytes: new Uint8Array(0) };
      }
      const reader = resp.body?.getReader();
      if (!reader) {
        const arr = new Uint8Array(await resp.arrayBuffer());
        return { ok: true, status: resp.status, contentType, bytes: arr };
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > MAX_FETCH_BYTES) {
            await reader.cancel().catch(() => {});
            return { ok: false, status: 413, contentType, bytes: new Uint8Array(0) };
          }
          chunks.push(value);
        }
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
      return { ok: true, status: resp.status, contentType, bytes: merged };
    },
  });

  ipcMain.handle('lurker:preview-cache-get-image', (_event, url: string) =>
    previewCache.getOrFetchImage(url),
  );
  ipcMain.handle('lurker:preview-cache-get-meta-batch', (_event, urls: string[]) =>
    previewCache.getMetaBatch(Array.isArray(urls) ? urls : []),
  );
  ipcMain.handle(
    'lurker:preview-cache-put-meta',
    (_event, items: Array<Record<string, unknown>>) =>
      previewCache.putMeta(Array.isArray(items) ? items : []),
  );
  ipcMain.handle('lurker:preview-cache-stats', () => previewCache.stats());
  ipcMain.handle('lurker:preview-cache-clear', () => previewCache.clear());
  ipcMain.handle(
    'lurker:preview-cache-configure',
    (_event, opts: { enabled?: boolean; maxBytes?: number }) => previewCache.configure(opts || {}),
  );

  const updater = new DesktopUpdater({
    currentVersion: app.getVersion(),
    updatesDir: path.join(app.getPath('userData'), 'updates'),
    autoCheck: desktopConfig.autoCheckUpdates !== false,
    fetchImpl: (url, init) =>
      session.defaultSession.fetch(url, {
        cache: 'no-store',
        headers: init?.headers,
        signal: init?.signal,
      }),
    onStateChange: (snapshot) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('lurker:updater-state', snapshot);
      }
    },
    onPersistAutoCheck: (enabled) => {
      desktopConfig = { ...desktopConfig, autoCheckUpdates: enabled };
      saveConfig(desktopConfig);
    },
    relaunchAndQuit: (targetExecPath) => {
      if (targetExecPath) {
        app.relaunch({ execPath: targetExecPath });
      } else {
        app.relaunch();
      }
      app.exit(0);
    },
    quitApp: () => {
      app.exit(0);
    },
    openPath: (targetPath) => shell.openPath(targetPath),
    showItemInFolder: (targetPath) => shell.showItemInFolder(targetPath),
    openExternal: (url) => openExternalSafe(url),
  });

  ipcMain.handle('lurker:updater-state', () => updater.getState());
  ipcMain.handle('lurker:updater-check', () => updater.checkForUpdates());
  ipcMain.handle('lurker:updater-download', () => updater.downloadUpdate());
  ipcMain.handle('lurker:updater-install', () => updater.installUpdate());
  ipcMain.handle('lurker:updater-set-auto-check', (_event, enabled: boolean) =>
    updater.setAutoCheck(Boolean(enabled)),
  );
  ipcMain.handle('lurker:updater-open-release', () => updater.openReleasePage());

  app.on('will-quit', () => {
    void previewCache.dispose();
  });

  rebuildApplicationMenu();
  if (process.platform === 'darwin') {
    try {
      const dockIcon = resolveAppIcon();
      if (dockIcon) app.dock?.setIcon(dockIcon);
    } catch {
      // ignore dock icon failures
    }
  }
  createWindow();

  if (
    desktopConfig.autoCheckUpdates !== false &&
    !isDev &&
    process.env.LURKR_DISABLE_UPDATE_CHECK !== '1'
  ) {
    setTimeout(() => {
      void updater.checkForUpdates();
    }, 6_000).unref();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
