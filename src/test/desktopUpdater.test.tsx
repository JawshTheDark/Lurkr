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
  compareSemver,
  DesktopUpdater,
  parseSha256Sums,
  selectReleaseAsset,
  type ReleaseAssetInfo,
  type UpdaterFetch,
} from '../../electron/updater';
import { DesktopUpdaterPanel } from '../components/DesktopUpdaterPanel';
import type { UpdateStateSnapshot } from '../api';
import { useUpdaterStore } from '../stores/updater';
import { useToastsStore } from '../stores/toasts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, Math.ceil(bytes.byteLength / 2)));
      controller.enqueue(bytes.subarray(Math.ceil(bytes.byteLength / 2)));
      controller.close();
    },
  });
}

function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

describe('DesktopUpdater & platform release matching', () => {
  const tempDirs: string[] = [];

  const makeTempDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lurkr-updater-test-'));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('compares semantic versions and parses SHA256SUMS.txt accurately', () => {
    expect(compareSemver('v2.6.4', '2.6.3')).toBeGreaterThan(0);
    expect(compareSemver('2.7.0', '2.6.9')).toBeGreaterThan(0);
    expect(compareSemver('2.6.4', '2.6.4-rc.1')).toBeGreaterThan(0);
    expect(compareSemver('v2.6.3', '2.6.3')).toBe(0);
    expect(compareSemver('2.6.2', '2.6.3')).toBeLessThan(0);

    const parsed = parseSha256Sums(
      [
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  Lurkr-2.6.4.AppImage',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb *Lurkr-2.6.4-win-x64-setup.exe',
      ].join('\n'),
    );
    expect(parsed['Lurkr-2.6.4.AppImage']).toBe('a'.repeat(64));
    expect(parsed['Lurkr-2.6.4-win-x64-setup.exe']).toBe('b'.repeat(64));
  });

  it('selects matching release assets for Windows, macOS, and Linux install modes', () => {
    const assets: ReleaseAssetInfo[] = [
      { name: 'Lurkr-2.6.4.AppImage', downloadUrl: 'https://example.com/appimage', size: 100 },
      { name: 'lurker-react-client-2.6.4.tar.gz', downloadUrl: 'https://example.com/tar', size: 100 },
      { name: 'Lurkr-2.6.4-win-x64-setup.exe', downloadUrl: 'https://example.com/win64', size: 100 },
      { name: 'Lurkr-2.6.4-win-arm64-setup.exe', downloadUrl: 'https://example.com/winarm', size: 100 },
      { name: 'Lurkr-2.6.4-win-x64-portable.exe', downloadUrl: 'https://example.com/winport', size: 100 },
      { name: 'Lurkr-2.6.4-mac-universal.dmg', downloadUrl: 'https://example.com/macdmg', size: 100 },
      { name: 'Lurkr-2.6.4-mac-universal.zip', downloadUrl: 'https://example.com/maczip', size: 100 },
    ];

    expect(
      selectReleaseAsset({
        platform: 'win32',
        arch: 'arm64',
        execPath: 'C:\\Users\\alice\\AppData\\Local\\Programs\\Lurkr\\Lurkr.exe',
        env: {},
        assets,
      }),
    ).toMatchObject({ installMode: 'win-nsis', asset: { name: 'Lurkr-2.6.4-win-arm64-setup.exe' } });

    expect(
      selectReleaseAsset({
        platform: 'win32',
        arch: 'x64',
        execPath: 'C:\\Temp\\Lurkr.exe',
        env: { PORTABLE_EXECUTABLE_FILE: 'D:\\Lurkr-portable.exe' },
        assets,
      }),
    ).toMatchObject({ installMode: 'win-portable', asset: { name: 'Lurkr-2.6.4-win-x64-portable.exe' } });

    expect(
      selectReleaseAsset({
        platform: 'darwin',
        arch: 'arm64',
        execPath: '/Applications/Lurkr.app/Contents/MacOS/Lurkr',
        env: {},
        assets,
        writableCheck: () => true,
      }),
    ).toMatchObject({ installMode: 'mac-zip', asset: { name: 'Lurkr-2.6.4-mac-universal.zip' } });

    expect(
      selectReleaseAsset({
        platform: 'darwin',
        arch: 'arm64',
        execPath: '/Applications/Lurkr.app/Contents/MacOS/Lurkr',
        env: {},
        assets,
        writableCheck: () => false,
      }),
    ).toMatchObject({ installMode: 'mac-dmg', asset: { name: 'Lurkr-2.6.4-mac-universal.dmg' } });

    expect(
      selectReleaseAsset({
        platform: 'linux',
        arch: 'x64',
        execPath: '/tmp/.mount_Lurkr/lurkr',
        env: { APPIMAGE: '/home/alice/Applications/Lurkr.AppImage' },
        assets,
        writableCheck: () => true,
      }),
    ).toMatchObject({ installMode: 'linux-appimage', asset: { name: 'Lurkr-2.6.4.AppImage' } });

    expect(
      selectReleaseAsset({
        platform: 'linux',
        arch: 'x64',
        execPath: '/home/alice/.local/opt/lurkr/lurkr',
        env: {},
        assets,
        writableCheck: () => true,
      }),
    ).toMatchObject({ installMode: 'linux-tar', asset: { name: 'lurker-react-client-2.6.4.tar.gz' } });
  });

  it('checks GitHub release, verifies SHA256SUMS.txt, downloads update, and replaces AppImage atomically', async () => {
    const dir = makeTempDir();
    const updatesDir = path.join(dir, 'updates');
    const appImagePath = path.join(dir, 'Lurkr.AppImage');
    fs.writeFileSync(appImagePath, Buffer.from('OLD_APPIMAGE_BYTES'));

    const newAppImageBytes = new Uint8Array(Buffer.from('NEW_VERIFIED_APPIMAGE_BINARY_DATA_V264'));
    const expectedHash = sha256Hex(newAppImageBytes);

    const fetchMock: UpdaterFetch = vi.fn(async (url: string) => {
      if (url.includes('/releases/latest')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tag_name: 'v2.6.4',
            name: 'Lurkr v2.6.4',
            body: 'Added desktop auto-updater and nick-aligned previews.',
            html_url: 'https://github.com/JawshTheDark/Lurkr/releases/tag/v2.6.4',
            published_at: '2026-11-19T19:00:00Z',
            assets: [
              {
                name: 'Lurkr-2.6.4.AppImage',
                browser_download_url: 'https://github.com/JawshTheDark/Lurkr/releases/download/v2.6.4/Lurkr-2.6.4.AppImage',
                size: newAppImageBytes.byteLength,
              },
              {
                name: 'SHA256SUMS.txt',
                browser_download_url: 'https://github.com/JawshTheDark/Lurkr/releases/download/v2.6.4/SHA256SUMS.txt',
                size: 120,
              },
            ],
          }),
          text: async () => '',
          body: null,
          headers: new Headers(),
        };
      }
      if (url.endsWith('SHA256SUMS.txt')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => `${expectedHash}  Lurkr-2.6.4.AppImage\n`,
          body: null,
          headers: new Headers(),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '',
        body: makeStream(newAppImageBytes),
        headers: new Headers({ 'content-length': String(newAppImageBytes.byteLength) }),
      };
    });

    const relaunchAndQuit = vi.fn();
    const updater = new DesktopUpdater({
      currentVersion: '2.6.3',
      updatesDir,
      platform: 'linux',
      arch: 'x64',
      execPath: '/tmp/.mount_Lurkr/lurkr',
      env: { APPIMAGE: appImagePath },
      fetchImpl: fetchMock,
      relaunchAndQuit,
    });

    const checked = await updater.checkForUpdates();
    expect(checked.status).toBe('available');
    expect(checked.latestVersion).toBe('2.6.4');
    expect(checked.assetName).toBe('Lurkr-2.6.4.AppImage');

    const downloaded = await updater.downloadUpdate();
    expect(downloaded.status).toBe('downloaded');
    expect(downloaded.sha256Verified).toBe(true);
    expect(downloaded.percent).toBe(100);

    await updater.installUpdate();
    expect(fs.readFileSync(appImagePath, 'utf8')).toBe('NEW_VERIFIED_APPIMAGE_BINARY_DATA_V264');
    expect(relaunchAndQuit).toHaveBeenCalledWith(appImagePath);
  });

  it('rejects tampered downloads when SHA-256 checksum does not match', async () => {
    const dir = makeTempDir();
    const appImagePath = path.join(dir, 'Lurkr.AppImage');
    fs.writeFileSync(appImagePath, Buffer.from('OLD'));

    const payload = new Uint8Array(Buffer.from('CORRUPTED_BYTES'));
    const fetchMock: UpdaterFetch = vi.fn(async (url: string) => {
      if (url.includes('/releases/latest')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tag_name: 'v2.6.4',
            assets: [
              {
                name: 'Lurkr-2.6.4.AppImage',
                browser_download_url: 'https://github.com/JawshTheDark/Lurkr/releases/download/v2.6.4/Lurkr-2.6.4.AppImage',
                size: payload.byteLength,
              },
              {
                name: 'SHA256SUMS.txt',
                browser_download_url: 'https://github.com/JawshTheDark/Lurkr/releases/download/v2.6.4/SHA256SUMS.txt',
                size: 100,
              },
            ],
          }),
          text: async () => '',
          body: null,
          headers: new Headers(),
        };
      }
      if (url.endsWith('SHA256SUMS.txt')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => `${'f'.repeat(64)}  Lurkr-2.6.4.AppImage\n`,
          body: null,
          headers: new Headers(),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '',
        body: makeStream(payload),
        headers: new Headers({ 'content-length': String(payload.byteLength) }),
      };
    });

    const updater = new DesktopUpdater({
      currentVersion: '2.6.3',
      updatesDir: path.join(dir, 'updates'),
      platform: 'linux',
      arch: 'x64',
      execPath: '/tmp/.mount_Lurkr/lurkr',
      env: { APPIMAGE: appImagePath },
      fetchImpl: fetchMock,
    });

    await updater.checkForUpdates();
    const res = await updater.downloadUpdate();
    expect(res.status).toBe('error');
    expect(res.error).toMatch(/Checksum mismatch/i);
    expect(fs.existsSync(path.join(dir, 'updates', 'Lurkr-2.6.4.AppImage'))).toBe(false);
  });
});

describe('DesktopUpdaterPanel UI integration', () => {
  const origDesktop = window.lurkerDesktop;
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    useToastsStore.getState().clear();
    useUpdaterStore.setState({ initialized: false, notifiedVersion: null });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
    window.lurkerDesktop = origDesktop;
  });

  it('drives check -> download -> install flow via window.lurkerDesktop.updater', async () => {
    let listener: ((s: UpdateStateSnapshot) => void) | null = null;
    let state: UpdateStateSnapshot = {
      status: 'idle',
      currentVersion: '2.6.3',
      latestVersion: null,
      releaseName: null,
      releaseNotes: null,
      releaseUrl: 'https://github.com/JawshTheDark/Lurkr/releases',
      publishedAt: null,
      assetName: null,
      installMode: 'win-nsis',
      autoInstallSupported: false,
      sha256Verified: false,
      downloadedPath: null,
      downloadedBytes: 0,
      totalBytes: 0,
      percent: 0,
      autoCheck: true,
      checkedAt: null,
      error: null,
    };

    const emit = (patch: Partial<UpdateStateSnapshot>) => {
      state = { ...state, ...patch };
      listener?.(state);
      return state;
    };

    const check = vi.fn(async () =>
      emit({
        status: 'available',
        latestVersion: '2.6.4',
        releaseName: 'Lurkr v2.6.4',
        assetName: 'Lurkr-2.6.4-win-x64-setup.exe',
        totalBytes: 2_097_152,
        autoInstallSupported: true,
      }),
    );
    const download = vi.fn(async () =>
      emit({
        status: 'downloaded',
        sha256Verified: true,
        downloadedBytes: 2_097_152,
        percent: 100,
        downloadedPath: 'C:\\Temp\\Lurkr-2.6.4-win-x64-setup.exe',
      }),
    );
    const install = vi.fn(async () => emit({ status: 'installing' }));

    window.lurkerDesktop = {
      isElectron: true,
      platform: 'win32',
      getConfig: async () => ({ serverUrl: '', allowSelfSigned: false }),
      setConfig: async (c) => ({ serverUrl: c.serverUrl ?? '', allowSelfSigned: false }),
      setBadge: async () => {},
      notify: async () => {},
      openExternal: async () => {},
      onNavigate: () => () => {},
      updater: {
        getState: async () => state,
        check,
        download,
        install,
        setAutoCheck: async (enabled) => emit({ autoCheck: enabled }),
        openReleasePage: async () => {},
        onState: (cb) => {
          listener = cb;
          return () => {
            listener = null;
          };
        },
      },
    };

    await act(async () => {
      root = createRoot(container);
      root.render(<DesktopUpdaterPanel />);
    });

    const checkBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Check for Updates'),
    )!;
    await act(async () => {
      checkBtn.click();
    });
    expect(check).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('v2.6.4');
    expect(useToastsStore.getState().items[0]?.title).toContain('v2.6.4');

    const dlBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Download Update'),
    )!;
    await act(async () => {
      dlBtn.click();
    });
    expect(download).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('SHA-256 Verified');

    const installBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Install & Restart'),
    )!;
    await act(async () => {
      installBtn.click();
    });
    expect(install).toHaveBeenCalledTimes(1);
  });
});
