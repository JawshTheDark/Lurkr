// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  RotateCw,
  ShieldCheck,
} from 'lucide-react';
import { useUpdaterStore } from '../stores/updater';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeInstallMode(mode: string): string {
  switch (mode) {
    case 'win-nsis':
      return 'Windows NSIS installer';
    case 'win-portable':
      return 'Windows portable binary';
    case 'mac-zip':
      return 'macOS in-place app bundle';
    case 'mac-dmg':
      return 'macOS Universal DMG';
    case 'linux-appimage':
      return 'Linux AppImage self-update';
    case 'linux-tar':
      return 'Linux bundle self-update';
    default:
      return 'GitHub Releases package';
  }
}

export const DesktopUpdaterPanel: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const desktopAvailable = typeof window !== 'undefined' && Boolean(window.lurkerDesktop?.updater);
  const snapshot = useUpdaterStore((s) => s.snapshot);
  const init = useUpdaterStore((s) => s.init);
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);
  const downloadUpdate = useUpdaterStore((s) => s.downloadUpdate);
  const installUpdate = useUpdaterStore((s) => s.installUpdate);
  const setAutoCheck = useUpdaterStore((s) => s.setAutoCheck);
  const openReleasePage = useUpdaterStore((s) => s.openReleasePage);

  useEffect(() => {
    if (!desktopAvailable) return;
    return init();
  }, [desktopAvailable, init]);

  if (!desktopAvailable) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-muted)]">
        Desktop auto-updates are available when running the packaged Electron application.
      </div>
    );
  }

  const busy =
    snapshot.status === 'checking' ||
    snapshot.status === 'downloading' ||
    snapshot.status === 'installing';

  const installLabel =
    snapshot.installMode === 'mac-dmg'
      ? 'Open Installer (.dmg)'
      : snapshot.installMode === 'win-portable' || snapshot.installMode === 'manual'
        ? 'Open Downloaded File'
        : 'Install & Restart';

  return (
    <div
      className={`rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] ${
        compact ? 'p-3 space-y-2.5' : 'p-4 space-y-3'
      } text-xs`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
            <RefreshCw size={13} className={snapshot.status === 'checking' ? 'animate-spin' : ''} />
            <span>Desktop Software Updates</span>
            {snapshot.sha256Verified && (
              <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                <ShieldCheck size={11} />
                SHA-256 Verified
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            Installed <span className="font-mono text-[var(--text-primary)]">v{snapshot.currentVersion}</span>
            {snapshot.latestVersion && (
              <>
                {' · '}Latest{' '}
                <span className="font-mono text-[var(--text-primary)]">v{snapshot.latestVersion}</span>
              </>
            )}
            {' · '}
            <span>{describeInstallMode(snapshot.installMode)}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {snapshot.status === 'available' && (
            <button
              type="button"
              onClick={() => void downloadUpdate()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              <Download size={12} />
              Download Update
            </button>
          )}

          {snapshot.status === 'downloaded' && (
            <button
              type="button"
              onClick={() => void installUpdate()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              <RotateCw size={12} />
              {installLabel}
            </button>
          )}

          <button
            type="button"
            onClick={() => void checkForUpdates()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            <RefreshCw size={12} className={snapshot.status === 'checking' ? 'animate-spin' : ''} />
            {snapshot.status === 'checking' ? 'Checking…' : 'Check for Updates'}
          </button>

          <button
            type="button"
            onClick={() => void openReleasePage()}
            title="View release notes on GitHub"
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ExternalLink size={12} />
            Releases
          </button>
        </div>
      </div>

      {snapshot.status === 'up-to-date' && (
        <div className="flex items-center gap-1.5 text-emerald-400 text-[11px]">
          <CheckCircle2 size={13} />
          <span>You are running the latest version of Lurkr (v{snapshot.currentVersion}).</span>
        </div>
      )}

      {snapshot.status === 'downloading' && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
            <span>Downloading {snapshot.assetName || 'update'}…</span>
            <span className="font-mono">
              {snapshot.percent}% ({formatBytes(snapshot.downloadedBytes)}
              {snapshot.totalBytes > 0 ? ` / ${formatBytes(snapshot.totalBytes)}` : ''})
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-secondary)] border border-[var(--border)]">
            <div
              className="h-full bg-[var(--accent)] transition-all duration-150"
              style={{ width: `${Math.max(4, snapshot.percent)}%` }}
            />
          </div>
        </div>
      )}

      {snapshot.status === 'downloaded' && snapshot.assetName && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-[11px] text-emerald-300">
          Downloaded <span className="font-mono">{snapshot.assetName}</span> ({formatBytes(snapshot.totalBytes)})
          {snapshot.sha256Verified ? ' and verified SHA-256 checksum.' : '.'} Ready to install.
        </div>
      )}

      {snapshot.status === 'error' && snapshot.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-400">
          {snapshot.error}
        </div>
      )}

      {!compact && snapshot.releaseNotes && (
        <details className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-2.5">
          <summary className="cursor-pointer font-medium text-[var(--text-secondary)]">
            Release Notes ({snapshot.releaseName || `v${snapshot.latestVersion}`})
          </summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-[var(--text-muted)] max-h-40 overflow-y-auto">
            {snapshot.releaseNotes}
          </pre>
        </details>
      )}

      <label className="flex items-center justify-between gap-3 pt-1 text-[11px] text-[var(--text-secondary)]">
        <span>Automatically check for updates on launch</span>
        <input
          type="checkbox"
          checked={snapshot.autoCheck}
          onChange={(e) => void setAutoCheck(e.target.checked)}
        />
      </label>
    </div>
  );
};
