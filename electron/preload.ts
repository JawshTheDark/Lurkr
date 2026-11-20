// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopMenuState, MenuActionPayload } from './menu.js';
import type { TranscodeWebmResult } from './transcode.js';
import type { CachedImageResult, EncryptedCacheStats } from './previewCache.js';
import type { UpdateStateSnapshot } from './updater.js';

export interface DesktopConfig {
  serverUrl: string;
  allowSelfSigned: boolean;
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

contextBridge.exposeInMainWorld('lurkerDesktop', {
  isElectron: true,
  platform: process.platform,
  getConfig: (): Promise<DesktopConfig> => ipcRenderer.invoke('lurker:get-config'),
  setConfig: (next: Partial<DesktopConfig>): Promise<DesktopConfig> =>
    ipcRenderer.invoke('lurker:set-config', next),
  getAppInfo: (): Promise<DesktopAppInfo> => ipcRenderer.invoke('lurker:get-app-info'),
  setBadge: (count: number): Promise<void> => ipcRenderer.invoke('lurker:set-badge', count),
  notify: (payload: { title: string; body: string; bufferPath?: string }): Promise<void> =>
    ipcRenderer.invoke('lurker:notify', payload),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('lurker:open-external', url),
  readClipboardImage: (): Promise<{ data: Uint8Array; mime: string; filename: string } | null> =>
    ipcRenderer.invoke('lurker:read-clipboard-image'),
  transcodeWebm: async (file: File): Promise<TranscodeWebmResult> => {
    let sourcePath = '';
    try {
      sourcePath = webUtils.getPathForFile(file) || '';
    } catch {
      sourcePath = '';
    }
    const payload = sourcePath
      ? { filename: file.name, mime: file.type, sourcePath }
      : {
          filename: file.name,
          mime: file.type,
          data: new Uint8Array(await file.arrayBuffer()),
        };
    return ipcRenderer.invoke('lurker:transcode-webm', payload);
  },
  updateMenuState: (state: DesktopMenuState): Promise<void> =>
    ipcRenderer.invoke('lurker:set-menu-state', state),
  onMenuAction: (cb: (payload: MenuActionPayload) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: MenuActionPayload) =>
      cb(payload);
    ipcRenderer.on('lurker:menu-action', handler);
    return () => ipcRenderer.removeListener('lurker:menu-action', handler);
  },
  onNavigate: (cb: (path: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, targetPath: string) => cb(targetPath);
    ipcRenderer.on('lurker:navigate', handler);
    return () => ipcRenderer.removeListener('lurker:navigate', handler);
  },
  previewCache: {
    getOrFetchImage: (url: string): Promise<CachedImageResult> =>
      ipcRenderer.invoke('lurker:preview-cache-get-image', url),
    getMetaBatch: (urls: string[]): Promise<Record<string, unknown>> =>
      ipcRenderer.invoke('lurker:preview-cache-get-meta-batch', urls),
    putMeta: (items: Array<Record<string, unknown>>): Promise<void> =>
      ipcRenderer.invoke('lurker:preview-cache-put-meta', items),
    stats: (): Promise<EncryptedCacheStats> => ipcRenderer.invoke('lurker:preview-cache-stats'),
    clear: (): Promise<void> => ipcRenderer.invoke('lurker:preview-cache-clear'),
    configure: (opts: { enabled?: boolean; maxBytes?: number }): Promise<EncryptedCacheStats> =>
      ipcRenderer.invoke('lurker:preview-cache-configure', opts),
  },
  updater: {
    getState: (): Promise<UpdateStateSnapshot> => ipcRenderer.invoke('lurker:updater-state'),
    check: (): Promise<UpdateStateSnapshot> => ipcRenderer.invoke('lurker:updater-check'),
    download: (): Promise<UpdateStateSnapshot> => ipcRenderer.invoke('lurker:updater-download'),
    install: (): Promise<UpdateStateSnapshot> => ipcRenderer.invoke('lurker:updater-install'),
    setAutoCheck: (enabled: boolean): Promise<UpdateStateSnapshot> =>
      ipcRenderer.invoke('lurker:updater-set-auto-check', enabled),
    openReleasePage: (): Promise<void> => ipcRenderer.invoke('lurker:updater-open-release'),
    onState: (cb: (state: UpdateStateSnapshot) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, snapshot: UpdateStateSnapshot) =>
        cb(snapshot);
      ipcRenderer.on('lurker:updater-state', handler);
      return () => ipcRenderer.removeListener('lurker:updater-state', handler);
    },
  },
});
