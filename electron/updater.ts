// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_GITHUB_REPO = 'JawshTheDark/Lurkr';
export const DEFAULT_RELEASE_API_URL = `https://api.github.com/repos/${DEFAULT_GITHUB_REPO}/releases/latest`;
export const DEFAULT_RELEASES_PAGE_URL = `https://github.com/${DEFAULT_GITHUB_REPO}/releases`;

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';

export type InstallMode =
  | 'win-nsis'
  | 'win-portable'
  | 'mac-zip'
  | 'mac-dmg'
  | 'linux-appimage'
  | 'linux-tar'
  | 'manual';

export interface ReleaseAssetInfo {
  name: string;
  downloadUrl: string;
  size: number;
}

export interface ParsedReleaseInfo {
  version: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string | null;
  assets: ReleaseAssetInfo[];
}

export interface UpdateStateSnapshot {
  status: UpdaterStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  assetName: string | null;
  installMode: InstallMode;
  autoInstallSupported: boolean;
  sha256Verified: boolean;
  downloadedPath: string | null;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  autoCheck: boolean;
  checkedAt: number | null;
  error: string | null;
}

export type UpdaterFetch = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  body: ReadableStream<Uint8Array> | null;
  headers: { get: (name: string) => string | null };
}>;

export interface UpdaterDependencies {
  currentVersion: string;
  updatesDir: string;
  platform?: NodeJS.Platform;
  arch?: string;
  execPath?: string;
  env?: NodeJS.ProcessEnv;
  autoCheck?: boolean;
  feedUrl?: string;
  fetchImpl?: UpdaterFetch;
  onStateChange?: (state: UpdateStateSnapshot) => void;
  onPersistAutoCheck?: (enabled: boolean) => void;
  relaunchAndQuit?: (execPath?: string) => void;
  quitApp?: () => void;
  openPath?: (targetPath: string) => Promise<string>;
  showItemInFolder?: (targetPath: string) => void;
  openExternal?: (url: string) => Promise<void>;
}

interface SemverParts {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

function parseSemver(raw: string): SemverParts | null {
  const cleaned = (raw || '').trim().replace(/^v/i, '');
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || '',
  };
}

/**
 * Returns > 0 if `a > b`, < 0 if `a < b`, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;

  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;

  if (!pa.prerelease && !pb.prerelease) return 0;
  if (!pa.prerelease) return 1;
  if (!pb.prerelease) return -1;

  const aIds = pa.prerelease.split('.');
  const bIds = pb.prerelease.split('.');
  const len = Math.max(aIds.length, bIds.length);
  for (let i = 0; i < len; i += 1) {
    const ai = aIds[i];
    const bi = bIds[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const diff = Number(ai) - Number(bi);
      if (diff !== 0) return diff;
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return 0;
}

export function parseSha256Sums(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of (content || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (!match) continue;
    const filename = path.basename(match[2].trim());
    out[filename] = match[1].toLowerCase();
  }
  return out;
}

function isWritablePath(targetPath: string): boolean {
  try {
    fs.accessSync(targetPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveMacAppBundlePath(execPath: string): string | null {
  const normalized = path.resolve(execPath);
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const idx = normalized.indexOf(marker);
  if (idx <= 0) return null;
  const appPath = normalized.slice(0, idx);
  return appPath.endsWith('.app') ? appPath : null;
}

function isAllowedRemoteUrl(rawUrl: string, allowCustomFeedHost?: string | null): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'https:') return true;
    if (allowCustomFeedHost && u.host === allowCustomFeedHost && u.protocol === 'http:') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export interface InstallSelection {
  asset: ReleaseAssetInfo | null;
  installMode: InstallMode;
  autoInstallSupported: boolean;
  targetPath: string | null;
}

export function selectReleaseAsset(opts: {
  platform: NodeJS.Platform;
  arch: string;
  execPath: string;
  env: NodeJS.ProcessEnv;
  assets: ReleaseAssetInfo[];
  writableCheck?: (p: string) => boolean;
}): InstallSelection {
  const writable = opts.writableCheck ?? isWritablePath;
  const findAsset = (predicates: Array<(name: string) => boolean>): ReleaseAssetInfo | null => {
    for (const pred of predicates) {
      const hit = opts.assets.find((a) => pred(a.name.toLowerCase()));
      if (hit) return hit;
    }
    return null;
  };

  if (opts.platform === 'win32') {
    const archTag = opts.arch === 'arm64' ? 'arm64' : 'x64';
    const portablePath = opts.env.PORTABLE_EXECUTABLE_FILE || '';
    if (portablePath) {
      const asset = findAsset([
        (n) => n.endsWith(`-win-${archTag}-portable.exe`),
        (n) => n.endsWith('-win-portable.exe'),
        (n) => n.endsWith(`-win-${archTag}-setup.exe`),
      ]);
      return {
        asset,
        installMode: 'win-portable',
        autoInstallSupported: Boolean(asset),
        targetPath: portablePath,
      };
    }
    const asset = findAsset([
      (n) => n.endsWith(`-win-${archTag}-setup.exe`),
      (n) => n.endsWith('-win-setup.exe'),
      (n) => n.endsWith(`-win-${archTag}.zip`),
    ]);
    return {
      asset,
      installMode: asset && asset.name.toLowerCase().endsWith('.exe') ? 'win-nsis' : 'manual',
      autoInstallSupported: Boolean(asset && asset.name.toLowerCase().endsWith('.exe')),
      targetPath: opts.execPath,
    };
  }

  if (opts.platform === 'darwin') {
    const bundlePath = resolveMacAppBundlePath(opts.execPath);
    const canSwapBundle = Boolean(bundlePath && writable(path.dirname(bundlePath)));
    if (canSwapBundle) {
      const zipAsset = findAsset([
        (n) => n.endsWith('-mac-universal.zip'),
        (n) => n.endsWith('.zip') && n.includes('mac'),
      ]);
      if (zipAsset) {
        return {
          asset: zipAsset,
          installMode: 'mac-zip',
          autoInstallSupported: true,
          targetPath: bundlePath,
        };
      }
    }
    const dmgAsset = findAsset([
      (n) => n.endsWith('-mac-universal.dmg'),
      (n) => n.endsWith('.dmg'),
      (n) => n.endsWith('-mac-universal.zip'),
    ]);
    return {
      asset: dmgAsset,
      installMode: dmgAsset?.name.toLowerCase().endsWith('.dmg') ? 'mac-dmg' : 'manual',
      autoInstallSupported: Boolean(dmgAsset?.name.toLowerCase().endsWith('.dmg')),
      targetPath: bundlePath || opts.execPath,
    };
  }

  if (opts.platform === 'linux') {
    const appImagePath = opts.env.APPIMAGE || '';
    if (appImagePath && writable(appImagePath) && writable(path.dirname(appImagePath))) {
      const appImageAsset = findAsset([(n) => n.endsWith('.appimage')]);
      if (appImageAsset) {
        return {
          asset: appImageAsset,
          installMode: 'linux-appimage',
          autoInstallSupported: true,
          targetPath: appImagePath,
        };
      }
    }

    const execDir = path.dirname(opts.execPath);
    const looksLikeLocalBundle =
      Boolean(execDir) &&
      !execDir.startsWith('/tmp/.mount_') &&
      path.basename(opts.execPath) === 'lurkr' &&
      writable(execDir) &&
      writable(path.dirname(execDir));
    if (looksLikeLocalBundle) {
      const tarAsset = findAsset([
        (n) => n.endsWith('.tar.gz') && !n.includes('sha256'),
      ]);
      if (tarAsset) {
        return {
          asset: tarAsset,
          installMode: 'linux-tar',
          autoInstallSupported: true,
          targetPath: execDir,
        };
      }
    }

    const fallbackAsset = findAsset([
      (n) => n.endsWith('.appimage'),
      (n) => n.endsWith('.tar.gz'),
    ]);
    return {
      asset: fallbackAsset,
      installMode: 'manual',
      autoInstallSupported: false,
      targetPath: opts.execPath,
    };
  }

  return {
    asset: null,
    installMode: 'manual',
    autoInstallSupported: false,
    targetPath: null,
  };
}

function findExtractedAppRoot(dir: string): string | null {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name === 'lurkr') {
      return dir;
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const nested = findExtractedAppRoot(path.join(dir, entry.name));
      if (nested) return nested;
    }
  }
  return null;
}

function parseGitHubRelease(raw: unknown): ParsedReleaseInfo {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const tag = String(obj.tag_name || '').trim();
  const version = tag.replace(/^v/i, '');
  if (!version) {
    throw new Error('GitHub release response is missing tag_name');
  }
  const assetsRaw = Array.isArray(obj.assets) ? obj.assets : [];
  const assets: ReleaseAssetInfo[] = assetsRaw
    .map((item) => {
      const a = (item ?? {}) as Record<string, unknown>;
      return {
        name: String(a.name || ''),
        downloadUrl: String(a.browser_download_url || ''),
        size: Number(a.size || 0),
      };
    })
    .filter((a) => a.name && a.downloadUrl);

  return {
    version,
    name: String(obj.name || `Lurkr v${version}`),
    body: String(obj.body || ''),
    htmlUrl: String(obj.html_url || `${DEFAULT_RELEASES_PAGE_URL}/tag/${tag}`),
    publishedAt: typeof obj.published_at === 'string' ? obj.published_at : null,
    assets,
  };
}

export class DesktopUpdater {
  private readonly deps: Required<
    Pick<
      UpdaterDependencies,
      'currentVersion' | 'updatesDir' | 'platform' | 'arch' | 'execPath' | 'env' | 'feedUrl'
    >
  > &
    UpdaterDependencies;

  private state: UpdateStateSnapshot;
  private latestRelease: ParsedReleaseInfo | null = null;
  private selected: InstallSelection | null = null;
  private checkPromise: Promise<UpdateStateSnapshot> | null = null;
  private downloadPromise: Promise<UpdateStateSnapshot> | null = null;

  constructor(deps: UpdaterDependencies) {
    this.deps = {
      platform: process.platform,
      arch: process.arch,
      execPath: process.execPath,
      env: process.env,
      feedUrl: deps.feedUrl || process.env.LURKR_UPDATE_FEED_URL || DEFAULT_RELEASE_API_URL,
      ...deps,
    };

    const initialSelection = selectReleaseAsset({
      platform: this.deps.platform,
      arch: this.deps.arch,
      execPath: this.deps.execPath,
      env: this.deps.env,
      assets: [],
    });

    this.state = {
      status: 'idle',
      currentVersion: this.deps.currentVersion,
      latestVersion: null,
      releaseName: null,
      releaseNotes: null,
      releaseUrl: DEFAULT_RELEASES_PAGE_URL,
      publishedAt: null,
      assetName: null,
      installMode: initialSelection.installMode,
      autoInstallSupported: false,
      sha256Verified: false,
      downloadedPath: null,
      downloadedBytes: 0,
      totalBytes: 0,
      percent: 0,
      autoCheck: deps.autoCheck !== false,
      checkedAt: null,
      error: null,
    };
  }

  getState(): UpdateStateSnapshot {
    return { ...this.state };
  }

  setAutoCheck(enabled: boolean): UpdateStateSnapshot {
    this.deps.onPersistAutoCheck?.(enabled);
    return this.updateState({ autoCheck: enabled });
  }

  private updateState(patch: Partial<UpdateStateSnapshot>): UpdateStateSnapshot {
    this.state = { ...this.state, ...patch };
    this.deps.onStateChange?.(this.getState());
    return this.getState();
  }

  private getFetch(): UpdaterFetch {
    if (this.deps.fetchImpl) return this.deps.fetchImpl;
    return (url, init) => fetch(url, init) as ReturnType<UpdaterFetch>;
  }

  private feedHost(): string | null {
    try {
      return new URL(this.deps.feedUrl).host;
    } catch {
      return null;
    }
  }

  async checkForUpdates(): Promise<UpdateStateSnapshot> {
    if (this.downloadPromise) return this.state;
    if (this.checkPromise) return this.checkPromise;

    this.checkPromise = (async () => {
      this.updateState({
        status: 'checking',
        error: null,
      });

      try {
        const res = await this.getFetch()(this.deps.feedUrl, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': `Lurkr/${this.deps.currentVersion}`,
          },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          throw new Error(`Update check failed (HTTP ${res.status})`);
        }
        const raw = await res.json();
        const release = parseGitHubRelease(raw);
        this.latestRelease = release;

        const selection = selectReleaseAsset({
          platform: this.deps.platform,
          arch: this.deps.arch,
          execPath: this.deps.execPath,
          env: this.deps.env,
          assets: release.assets,
        });
        this.selected = selection;

        const hasUpdate = compareSemver(release.version, this.deps.currentVersion) > 0;
        const alreadyDownloaded =
          hasUpdate &&
          selection.asset &&
          this.state.downloadedPath &&
          path.basename(this.state.downloadedPath) === selection.asset.name &&
          fs.existsSync(this.state.downloadedPath);

        return this.updateState({
          status: !hasUpdate
            ? 'up-to-date'
            : alreadyDownloaded
              ? 'downloaded'
              : 'available',
          latestVersion: release.version,
          releaseName: release.name,
          releaseNotes: release.body,
          releaseUrl: release.htmlUrl,
          publishedAt: release.publishedAt,
          assetName: selection.asset?.name ?? null,
          installMode: selection.installMode,
          autoInstallSupported: selection.autoInstallSupported,
          totalBytes: selection.asset?.size ?? 0,
          checkedAt: Date.now(),
          error: null,
          ...(alreadyDownloaded ? {} : { downloadedPath: null, downloadedBytes: 0, percent: 0, sha256Verified: false }),
        });
      } catch (err) {
        return this.updateState({
          status: 'error',
          checkedAt: Date.now(),
          error: err instanceof Error ? err.message : 'Unable to check for updates',
        });
      } finally {
        this.checkPromise = null;
      }
    })();

    return this.checkPromise;
  }

  async downloadUpdate(): Promise<UpdateStateSnapshot> {
    if (this.downloadPromise) return this.downloadPromise;
    if (!this.latestRelease) {
      await this.checkForUpdates();
    }
    const release = this.latestRelease;
    const selection = this.selected;
    if (!release || !selection?.asset) {
      return this.updateState({
        status: 'error',
        error: 'No matching release package found for this platform',
      });
    }
    if (compareSemver(release.version, this.deps.currentVersion) <= 0) {
      return this.updateState({ status: 'up-to-date' });
    }

    const asset = selection.asset;
    const allowedHost = this.feedHost();
    if (!isAllowedRemoteUrl(asset.downloadUrl, allowedHost)) {
      return this.updateState({
        status: 'error',
        error: 'Refusing insecure update download URL',
      });
    }

    this.downloadPromise = (async () => {
      await fs.promises.mkdir(this.deps.updatesDir, { recursive: true });
      const finalPath = path.join(this.deps.updatesDir, path.basename(asset.name));
      const tmpPath = `${finalPath}.${crypto.randomBytes(4).toString('hex')}.tmp`;

      this.updateState({
        status: 'downloading',
        assetName: asset.name,
        totalBytes: asset.size || 0,
        downloadedBytes: 0,
        percent: 0,
        sha256Verified: false,
        error: null,
      });

      try {
        const fetchFn = this.getFetch();
        let expectedSha256: string | null = null;
        const sumsAsset = release.assets.find((a) => a.name === 'SHA256SUMS.txt');
        if (sumsAsset && isAllowedRemoteUrl(sumsAsset.downloadUrl, allowedHost)) {
          const sumsRes = await fetchFn(sumsAsset.downloadUrl, {
            headers: { 'User-Agent': `Lurkr/${this.deps.currentVersion}` },
            signal: AbortSignal.timeout(15_000),
          });
          if (!sumsRes.ok) {
            throw new Error(`Failed to fetch SHA256SUMS.txt (HTTP ${sumsRes.status})`);
          }
          const sumsMap = parseSha256Sums(await sumsRes.text());
          expectedSha256 = sumsMap[asset.name] || null;
          if (!expectedSha256) {
            throw new Error(`SHA256SUMS.txt does not list ${asset.name}`);
          }
        }

        const res = await fetchFn(asset.downloadUrl, {
          headers: {
            Accept: 'application/octet-stream',
            'User-Agent': `Lurkr/${this.deps.currentVersion}`,
          },
          signal: AbortSignal.timeout(5 * 60_000),
        });
        if (!res.ok || !res.body) {
          throw new Error(`Failed to download ${asset.name} (HTTP ${res.status})`);
        }

        const headerLen = Number(res.headers.get('content-length') || 0);
        const totalBytes = headerLen > 0 ? headerLen : asset.size || 0;
        const hash = crypto.createHash('sha256');
        const out = fs.createWriteStream(tmpPath, { mode: 0o700 });
        let downloadedBytes = 0;
        let lastEmitAt = 0;

        try {
          const reader = res.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value || value.byteLength === 0) continue;
            hash.update(value);
            if (!out.write(value)) {
              await new Promise<void>((resolve) => out.once('drain', resolve));
            }
            downloadedBytes += value.byteLength;
            const now = Date.now();
            if (now - lastEmitAt >= 120) {
              lastEmitAt = now;
              const percent =
                totalBytes > 0 ? Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
              this.updateState({ downloadedBytes, totalBytes, percent });
            }
          }
          await new Promise<void>((resolve, reject) => {
            out.end(() => resolve());
            out.on('error', reject);
          });
        } catch (streamErr) {
          out.destroy();
          throw streamErr;
        }

        const actualSha256 = hash.digest('hex').toLowerCase();
        if (expectedSha256 && actualSha256 !== expectedSha256) {
          throw new Error(
            `Checksum mismatch for ${asset.name}: expected ${expectedSha256}, got ${actualSha256}`,
          );
        }

        if (fs.existsSync(finalPath)) {
          await fs.promises.rm(finalPath, { force: true });
        }
        await fs.promises.rename(tmpPath, finalPath);
        if (this.deps.platform !== 'win32') {
          await fs.promises.chmod(finalPath, 0o755).catch(() => {});
        }

        return this.updateState({
          status: 'downloaded',
          downloadedPath: finalPath,
          downloadedBytes,
          totalBytes: downloadedBytes || totalBytes,
          percent: 100,
          sha256Verified: Boolean(expectedSha256),
          error: null,
        });
      } catch (err) {
        await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
        return this.updateState({
          status: 'error',
          error: err instanceof Error ? err.message : 'Download failed',
        });
      } finally {
        this.downloadPromise = null;
      }
    })();

    return this.downloadPromise;
  }

  async installUpdate(): Promise<UpdateStateSnapshot> {
    if (this.state.status !== 'downloaded' || !this.state.downloadedPath || !this.selected) {
      return this.updateState({
        status: 'error',
        error: 'No downloaded update ready to install',
      });
    }

    const pkgPath = this.state.downloadedPath;
    const { installMode, targetPath } = this.selected;

    this.updateState({ status: 'installing', error: null });

    try {
      if (installMode === 'linux-appimage' && targetPath) {
        const tmpApp = `${targetPath}.new`;
        await fs.promises.copyFile(pkgPath, tmpApp);
        await fs.promises.chmod(tmpApp, 0o755);
        await fs.promises.rename(tmpApp, targetPath);
        this.deps.relaunchAndQuit?.(targetPath);
        return this.getState();
      }

      if (installMode === 'linux-tar' && targetPath) {
        const stageDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lurkr-update-stage-'));
        await execFileAsync('tar', ['-xzf', pkgPath, '-C', stageDir]);
        const newBundleDir = findExtractedAppRoot(stageDir);
        if (!newBundleDir) {
          throw new Error('Extracted update archive did not contain a lurkr binary');
        }
        const scriptPath = path.join(stageDir, 'apply-update.sh');
        const backupDir = `${targetPath}.bak-${process.pid}`;
        const relaunchBin = path.join(os.homedir(), '.local', 'bin', 'lurkr');
        const launchTarget = fs.existsSync(relaunchBin)
          ? relaunchBin
          : path.join(targetPath, 'lurkr');
        const script = [
          '#!/usr/bin/env bash',
          'set -euo pipefail',
          'for _ in $(seq 1 50); do',
          '  if ! kill -0 "$LURKR_PID" 2>/dev/null; then break; fi',
          '  sleep 0.2',
          'done',
          'mv "$LURKR_TARGET" "$LURKR_BACKUP"',
          'if mv "$LURKR_NEW" "$LURKR_TARGET"; then',
          '  rm -rf "$LURKR_BACKUP"',
          'else',
          '  mv "$LURKR_BACKUP" "$LURKR_TARGET" || true',
          '  exit 1',
          'fi',
          'nohup "$LURKR_LAUNCH" >/dev/null 2>&1 &',
          'rm -rf "$LURKR_STAGE"',
        ].join('\n');
        await fs.promises.writeFile(scriptPath, script, { mode: 0o700 });
        const helper = spawn('bash', [scriptPath], {
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            LURKR_PID: String(process.pid),
            LURKR_TARGET: targetPath,
            LURKR_NEW: newBundleDir,
            LURKR_BACKUP: backupDir,
            LURKR_STAGE: stageDir,
            LURKR_LAUNCH: launchTarget,
          },
        });
        helper.unref();
        this.deps.quitApp?.();
        return this.getState();
      }

      if (installMode === 'mac-zip' && targetPath) {
        const stageDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lurkr-mac-update-'));
        await execFileAsync('ditto', ['-x', '-k', pkgPath, stageDir]);
        const extractedApp = path.join(stageDir, 'Lurkr.app');
        if (!fs.existsSync(path.join(extractedApp, 'Contents', 'MacOS', 'Lurkr'))) {
          throw new Error('Extracted macOS archive does not contain Lurkr.app');
        }
        const scriptPath = path.join(stageDir, 'apply-update.sh');
        const backupApp = `${targetPath}.bak-${process.pid}`;
        const script = [
          '#!/usr/bin/env bash',
          'set -euo pipefail',
          'for _ in $(seq 1 50); do',
          '  if ! kill -0 "$LURKR_PID" 2>/dev/null; then break; fi',
          '  sleep 0.2',
          'done',
          'mv "$LURKR_TARGET" "$LURKR_BACKUP"',
          'if mv "$LURKR_NEW" "$LURKR_TARGET"; then',
          '  rm -rf "$LURKR_BACKUP"',
          'else',
          '  mv "$LURKR_BACKUP" "$LURKR_TARGET" || true',
          '  exit 1',
          'fi',
          'open -n "$LURKR_TARGET"',
          'rm -rf "$LURKR_STAGE"',
        ].join('\n');
        await fs.promises.writeFile(scriptPath, script, { mode: 0o700 });
        const helper = spawn('bash', [scriptPath], {
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            LURKR_PID: String(process.pid),
            LURKR_TARGET: targetPath,
            LURKR_NEW: extractedApp,
            LURKR_BACKUP: backupApp,
            LURKR_STAGE: stageDir,
          },
        });
        helper.unref();
        this.deps.quitApp?.();
        return this.getState();
      }

      if (installMode === 'win-nsis') {
        const installer = spawn(pkgPath, [], { detached: true, stdio: 'ignore' });
        installer.unref();
        this.deps.quitApp?.();
        return this.getState();
      }

      if (installMode === 'mac-dmg' && this.deps.openPath) {
        const openErr = await this.deps.openPath(pkgPath);
        if (openErr) throw new Error(openErr);
        return this.updateState({ status: 'downloaded' });
      }

      if (this.deps.showItemInFolder) {
        this.deps.showItemInFolder(pkgPath);
      } else if (this.deps.openPath) {
        await this.deps.openPath(path.dirname(pkgPath));
      }
      return this.updateState({ status: 'downloaded' });
    } catch (err) {
      return this.updateState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to apply update',
      });
    }
  }

  async openReleasePage(): Promise<void> {
    const url = this.state.releaseUrl || DEFAULT_RELEASES_PAGE_URL;
    await this.deps.openExternal?.(url);
  }
}
