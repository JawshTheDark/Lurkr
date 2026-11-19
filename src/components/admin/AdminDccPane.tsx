// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useState } from 'react';
import { useAdminStore, type AdminDccUser } from '../../stores/admin';
import { formatBytes } from '../../utils/formatBytes';

const GB = 1024 * 1024 * 1024;

function limitToGb(bytes: number | null): string {
  return bytes === null ? '' : String(Number((bytes / GB).toPrecision(6)));
}

export const AdminDccPane: React.FC = () => {
  const info = useAdminStore((s) => s.dcc);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{
    id: number;
    username: string;
    chat: boolean;
    receive: boolean;
    send: boolean;
    limitGb: string;
    usedBytes: number;
  } | null>(null);
  const [editError, setEditError] = useState('');

  useEffect(() => {
    setError('');
    useAdminStore
      .getState()
      .fetchDcc()
      .catch((err: any) => setError(err?.message || 'Failed to load DCC settings'));
  }, []);

  const openEdit = (u: AdminDccUser) => {
    setEditError('');
    setEditing({
      id: u.id,
      username: u.username,
      chat: u.chat,
      receive: u.receive,
      send: u.send,
      limitGb: limitToGb(u.limitBytes),
      usedBytes: u.usedBytes,
    });
  };

  return (
    <div className="space-y-4 text-xs">
      <div>
        <h2 className="text-sm font-semibold">DCC</h2>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Direct connections between users on IRC: chats, and files sent to and from this server.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400">
          {error}
        </div>
      )}

      {!info && !error && (
        <div className="py-8 text-center text-[var(--text-muted)]">Loading DCC settings...</div>
      )}

      {info && (
        <>
          {!info.enabled ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 text-[var(--text-muted)]">
              DCC is disabled on this instance. Set <code>LURKER_DCC_ENABLED</code> to enable it.
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Download directory</div>
                <div className="font-mono break-all">
                  {info.directory || 'Not set (LURKER_DCC_DIR)'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Largest file</div>
                <div>{info.maxFileBytes ? formatBytes(info.maxFileBytes) : 'No limit'}</div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Private network peers</div>
                <div>{info.allowPrivateHosts ? 'Allowed' : 'Blocked'}</div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Free-disk floor</div>
                <div>{formatBytes(info.freeDiskFloorBytes)}</div>
              </div>
            </div>
          )}

          {editing && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setEditError('');
                const rawLimit = editing.limitGb.trim();
                let limitBytes: number | null = null;
                if (rawLimit !== '') {
                  const gb = Number(rawLimit);
                  if (!Number.isFinite(gb) || gb <= 0) {
                    setEditError('Enter a positive number of GB, or leave blank for no limit');
                    return;
                  }
                  limitBytes = Math.max(1, Math.round(gb * GB));
                }
                setBusy(true);
                try {
                  await useAdminStore.getState().updateUserDcc(editing.id, {
                    chat: editing.chat,
                    receive: editing.receive,
                    send: editing.send,
                    limitBytes,
                  });
                  setEditing(null);
                } catch (err: any) {
                  setEditError(err?.message || 'Failed to update DCC grants');
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 space-y-3"
            >
              <div className="font-semibold text-sm">DCC Permissions for {editing.username}</div>
              {editError && <div className="text-red-400">{editError}</div>}
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editing.chat}
                    disabled={busy || (!info.enabled && !editing.chat)}
                    onChange={(e) => setEditing((c) => (c ? { ...c, chat: e.target.checked } : c))}
                  />
                  <span>Chat</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editing.receive}
                    disabled={busy || (!info.enabled && !editing.receive)}
                    onChange={(e) =>
                      setEditing((c) => (c ? { ...c, receive: e.target.checked } : c))
                    }
                  />
                  <span>Receive files</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editing.send}
                    disabled={busy || (!info.enabled && !editing.send)}
                    onChange={(e) => setEditing((c) => (c ? { ...c, send: e.target.checked } : c))}
                  />
                  <span>Send files</span>
                </label>
              </div>
              <label className="block space-y-1 max-w-xs">
                <span className="text-[var(--text-secondary)]">Storage limit (GB, blank = none)</span>
                <input
                  type="number"
                  step="any"
                  value={editing.limitGb}
                  placeholder="none"
                  onChange={(e) => setEditing((c) => (c ? { ...c, limitGb: e.target.value } : c))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs"
                />
                <span className="block text-[11px] text-[var(--text-muted)]">
                  Currently using {editing.usedBytes ? formatBytes(editing.usedBytes) : '0 B'}.
                </span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-white font-medium"
                >
                  {busy ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(null)}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--bg-hover)]"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {info.users.length === 0 ? (
            <div className="py-6 text-center text-[var(--text-muted)]">No users.</div>
          ) : (
            <div className="space-y-2">
              {info.users.map((u) => (
                <div
                  key={u.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2.5"
                >
                  <div>
                    <div className="font-semibold text-[var(--text-primary)]">{u.username}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      Chat: {u.chat ? 'on' : 'off'} · Receive: {u.receive ? 'on' : 'off'} · Send:{' '}
                      {u.send ? 'on' : 'off'} · Limit:{' '}
                      {u.limitBytes === null ? 'none' : formatBytes(u.limitBytes)} · Used:{' '}
                      {u.usedBytes ? formatBytes(u.usedBytes) : '0 B'}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => openEdit(u)}
                    className="rounded-lg border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--bg-hover)]"
                  >
                    Edit
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
