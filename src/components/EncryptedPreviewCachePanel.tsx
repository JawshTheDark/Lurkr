import React, { useCallback, useEffect, useState } from 'react';
import { HardDrive, Lock, Trash2 } from 'lucide-react';
import type { EncryptedCacheStats } from '../api';
import {
  PREVIEW_CACHE_MAX_MB_OPTIONS,
  clearEncryptedCache,
  getEncryptedCacheStats,
  useEncryptedPreviewCacheStore,
} from '../lib/encryptedPreviewCache';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function describeBackend(stats: EncryptedCacheStats | null): string {
  if (!stats) return 'Unavailable in this browser environment';
  switch (stats.backend) {
    case 'safeStorage+aes-256-gcm':
      return 'AES-256-GCM (OS Keyring / DPAPI sealed)';
    case 'ephemeral-aes-256-gcm':
      return 'AES-256-GCM (Ephemeral session key)';
    case 'webcrypto+indexeddb':
      return 'AES-256-GCM (Web Crypto + IndexedDB)';
    default:
      return stats.backend;
  }
}

export const EncryptedPreviewCachePanel: React.FC = () => {
  const enabled = useEncryptedPreviewCacheStore((s) => s.enabled);
  const maxMb = useEncryptedPreviewCacheStore((s) => s.maxMb);
  const clearOnLogout = useEncryptedPreviewCacheStore((s) => s.clearOnLogout);
  const setEnabled = useEncryptedPreviewCacheStore((s) => s.setEnabled);
  const setMaxMb = useEncryptedPreviewCacheStore((s) => s.setMaxMb);
  const setClearOnLogout = useEncryptedPreviewCacheStore((s) => s.setClearOnLogout);

  const [stats, setStats] = useState<EncryptedCacheStats | null>(null);
  const [clearing, setClearing] = useState(false);

  const refreshStats = useCallback(async () => {
    const next = await getEncryptedCacheStats();
    setStats(next);
  }, []);

  useEffect(() => {
    void refreshStats();
  }, [enabled, maxMb, refreshStats]);

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearEncryptedCache();
      await refreshStats();
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-[var(--border)] pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
            <Lock size={14} className="text-[var(--accent)]" />
            <span>Encrypted Image Preview Cache</span>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Stores fetched link thumbnails and image previews encrypted at rest so plain images are never written to browser disk cache.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleClear()}
          disabled={clearing}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-red-400/60 hover:text-red-400 disabled:opacity-50"
        >
          <Trash2 size={12} />
          {clearing ? 'Clearing…' : 'Clear Cache'}
        </button>
      </div>

      <div className="grid gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <HardDrive size={12} />
            Backend: <strong className="text-[var(--text-primary)]">{describeBackend(stats)}</strong>
          </span>
          <span>
            {stats
              ? `${stats.imageCount} images · ${stats.metaCount} previews · ${formatBytes(stats.totalBytes)} / ${maxMb} MB`
              : 'Loading cache stats…'}
          </span>
        </div>

        <label className="flex items-center justify-between gap-3 pt-1">
          <span className="text-[var(--text-primary)]">Cache image previews in encrypted storage</span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
        </label>

        <label className="flex items-center justify-between gap-3">
          <span className="text-[var(--text-primary)]">Maximum encrypted cache size</span>
          <select
            value={maxMb}
            onChange={(e) => setMaxMb(Number(e.target.value))}
            className="rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]"
          >
            {PREVIEW_CACHE_MAX_MB_OPTIONS.map((mb) => (
              <option key={mb} value={mb}>
                {mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center justify-between gap-3">
          <span className="text-[var(--text-primary)]">Wipe encrypted preview cache on sign out</span>
          <input
            type="checkbox"
            checked={clearOnLogout}
            onChange={(e) => setClearOnLogout(e.target.checked)}
          />
        </label>
      </div>
    </div>
  );
};
