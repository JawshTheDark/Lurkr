// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useState } from 'react';
import { useAdminStore } from '../../stores/admin';
import { useToastsStore } from '../../stores/toasts';
import { normalizeJitsiBase } from '../../shared/jitsi';

export const AdminGeneralPane: React.FC = () => {
  const jitsiUrl = useAdminStore((s) => s.jitsiUrl);
  const [jitsiInput, setJitsiInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setError('');
    useAdminStore
      .getState()
      .fetchGeneral()
      .catch((err: any) => setError(err?.message || 'Failed to load general settings'));
  }, []);

  useEffect(() => {
    if (jitsiUrl !== undefined) {
      setJitsiInput(jitsiUrl || '');
    }
  }, [jitsiUrl]);

  return (
    <div className="space-y-4 text-xs">
      <div>
        <h2 className="text-sm font-semibold">General</h2>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Instance-wide defaults across all users.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400">
          {error}
        </div>
      )}

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const trimmed = jitsiInput.trim();
          setError('');
          if (trimmed && !normalizeJitsiBase(trimmed)) {
            setError('Expected a valid https:// host URL');
            return;
          }
          setBusy(true);
          try {
            await useAdminStore.getState().setJitsiUrl(trimmed);
            useToastsStore.getState().push('Jitsi server updated', 'success');
          } catch (err: any) {
            setError(err?.message || 'Failed to update Jitsi URL');
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 space-y-3 max-w-lg"
      >
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Jitsi Meet Server (/jitsi)
          </h3>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            Default instance Jitsi Meet base URL used by /jitsi (leave blank for meet.jit.si).
          </p>
        </div>
        <input
          type="url"
          value={jitsiInput}
          disabled={busy || jitsiUrl === undefined}
          onChange={(e) => setJitsiInput(e.target.value)}
          placeholder="https://meet.jit.si"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs"
        />
        <button
          type="submit"
          disabled={busy || jitsiUrl === undefined}
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-45"
        >
          {busy ? 'Saving...' : 'Save Jitsi Server'}
        </button>
      </form>
    </div>
  );
};
