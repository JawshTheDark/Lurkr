// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAdminStore } from '../../stores/admin';
import { formatDateTime } from '../../utils/timestamp';

export const AdminLockoutsPane: React.FC = () => {
  const lockouts = useAdminStore((s) => s.lockouts);
  const policy = useAdminStore((s) => s.lockoutPolicy);
  const loaded = useAdminStore((s) => s.lockoutsLoaded);

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError('');
    setBusy(true);
    try {
      await useAdminStore.getState().fetchLockouts();
    } catch (err: any) {
      setError(err?.message || 'Failed to load lockouts');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Lockouts</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {policy
              ? `${policy.maxFailures} failed logins from one address within ${policy.windowMinutes} minutes lock it out for ${policy.backoffMinutes} minutes. `
              : ''}
            Web sign-in and bouncer track lockouts separately.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void load()}
            className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 hover:bg-[var(--bg-hover)]"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          {lockouts.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setError('');
                setBusy(true);
                try {
                  await useAdminStore.getState().clearLockouts();
                } catch (err: any) {
                  setError(err?.message || 'Failed to clear lockouts');
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-lg border border-red-500/30 px-2.5 py-1.5 text-red-400 hover:bg-red-500/10"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400">
          {error}
        </div>
      )}

      {!loaded && !error && (
        <div className="py-8 text-center text-[var(--text-muted)]">Loading lockouts...</div>
      )}

      {loaded && lockouts.length === 0 && !error && (
        <div className="py-8 text-center text-[var(--text-muted)]">
          No addresses are locked out.
        </div>
      )}

      <div className="space-y-2">
        {lockouts.map((l) => (
          <div
            key={`${l.source}:${l.address}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="font-mono font-medium text-[var(--text-primary)]">{l.address}</span>
              <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--text-muted)]">
                {l.source}
              </span>
            </div>
            <span className="text-[11px] text-[var(--text-muted)]">
              Lifts at {formatDateTime(l.liftsAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
