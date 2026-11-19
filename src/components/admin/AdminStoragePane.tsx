// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAdminStore, type AdminStorageStats } from '../../stores/admin';
import { formatBytes } from '../../utils/formatBytes';
import { formatDateTime } from '../../utils/timestamp';

function ceilingLabels(stats: AdminStorageStats) {
  const c = stats.ceilings;
  const lines =
    c.maxLinesState === 'set' && c.maxLines != null
      ? `${c.maxLines.toLocaleString()} lines per buffer (LURKER_MAX_RETENTION_LINES)`
      : c.maxLinesState === 'invalid'
        ? 'LURKER_MAX_RETENTION_LINES is invalid (not in effect)'
        : 'none — unbounded unless a user sets a limit';
  const hours =
    c.maxEventHoursState === 'set' && c.maxEventHours != null
      ? `${c.maxEventHours} hours (LURKER_MAX_EVENT_RETENTION_HOURS)`
      : c.maxEventHoursState === 'invalid'
        ? 'LURKER_MAX_EVENT_RETENTION_HOURS is invalid (not in effect)'
        : 'none — defaults to pruning event noise after 1 week';
  const days =
    c.maxClosedBufferDaysState === 'set' && c.maxClosedBufferDays != null
      ? `${c.maxClosedBufferDays} days (LURKER_MAX_CLOSED_BUFFER_DAYS)`
      : c.maxClosedBufferDaysState === 'invalid'
        ? 'LURKER_MAX_CLOSED_BUFFER_DAYS is invalid (not in effect)'
        : 'none — closed buffers kept unless users opt in';
  return { lines, hours, days };
}

export const AdminStoragePane: React.FC = () => {
  const stats = useAdminStore((s) => s.storage);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = async (force = false) => {
    setError('');
    setRefreshing(force);
    try {
      await useAdminStore.getState().fetchStorage(force);
    } catch (err: any) {
      setError(err?.message || 'Failed to load storage stats');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load(false);
  }, []);

  const ceilings = stats ? ceilingLabels(stats) : null;

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Storage</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Database size, retention ceilings, and stored message usage per account.
          </p>
        </div>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => void load(true)}
          className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--bg-hover)]"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {refreshing ? 'Refreshing...' : 'Refresh Now'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400">
          {error}
        </div>
      )}

      {!stats && !error && (
        <div className="py-8 text-center text-[var(--text-muted)]">Loading storage stats...</div>
      )}

      {stats && (
        <>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Database file</div>
                <div className="font-semibold text-sm">{formatBytes(stats.database.fileBytes)}</div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Write-ahead log</div>
                <div className="font-semibold text-sm">{formatBytes(stats.database.walBytes)}</div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Reclaimable free pages</div>
                <div className="font-semibold text-sm">
                  {formatBytes(stats.database.reclaimableBytes)}
                </div>
              </div>
            </div>

            {ceilings && (
              <div className="pt-2 border-t border-[var(--border)] space-y-1 text-[11px] text-[var(--text-muted)]">
                <div>Line ceiling: {ceilings.lines}</div>
                <div>Event-noise ceiling: {ceilings.hours}</div>
                <div>Closed-buffer ceiling: {ceilings.days}</div>
                <div>Refreshed {formatDateTime(stats.generatedAt)}.</div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Per Account
              {stats.approxBytesPerRow != null
                ? ` (≈ ${stats.approxBytesPerRow} B/line average)`
                : ''}
            </h3>
            {stats.users.length === 0 ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 text-[var(--text-muted)]">
                No stored account data yet.
              </div>
            ) : (
              stats.users.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2.5"
                >
                  <span className="font-medium text-[var(--text-primary)]">{u.username}</span>
                  <span className="text-[var(--text-muted)]">
                    {u.messageRows.toLocaleString()} lines · {u.buffers} buffer(s)
                    {stats.approxBytesPerRow != null
                      ? ` · ≈ ${formatBytes(u.messageRows * stats.approxBytesPerRow)}`
                      : ''}
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};
