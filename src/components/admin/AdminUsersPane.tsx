// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  useAdminStore,
  type AdminRecoveryLink,
  type AdminUser,
} from '../../stores/admin';
import { useAuthStore } from '../../stores/auth';
import { useConfigStore } from '../../stores/config';
import { useToastsStore } from '../../stores/toasts';
import { formatRelative } from '../../utils/timestamp';
import { MAX_IDENT_LENGTH } from '../../shared/ident';
import { isUnrestricted, UNRESTRICTED, type AccountRestrictions } from '../../shared/accountRestrictions';
import { describeRestrictions } from '../../utils/accountRestrictions';
import { RestrictionsFields } from './RestrictionsFields';

export const AdminUsersPane: React.FC = () => {
  const users = useAdminStore((s) => s.users);
  const usersLoaded = useAdminStore((s) => s.usersLoaded);
  const identConfig = useAdminStore((s) => s.identConfig);
  const authUser = useAuthStore((s) => s.user);
  const edition = useConfigStore((s) => s.edition);
  const isNode = edition === 'node';

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingIdentId, setEditingIdentId] = useState<number | null>(null);
  const [identDraft, setIdentDraft] = useState('');
  const [editingLimitsId, setEditingLimitsId] = useState<number | null>(null);
  const [limitsDraft, setLimitsDraft] = useState<AccountRestrictions>({ ...UNRESTRICTED });
  const [freshRecovery, setFreshRecovery] = useState<
    (AdminRecoveryLink & { userId: number; copied: boolean }) | null
  >(null);

  useEffect(() => {
    setError('');
    useAdminStore
      .getState()
      .fetchUsers()
      .catch((err: any) => setError(err?.message || 'Failed to load users'));
  }, []);

  const identShown = identConfig.status !== 'off';
  const identOnEngine = identConfig.host === 'engine';
  const canAssignIdents = identShown && !isNode;

  const runAction = async (fn: () => Promise<void>, fallbackErr: string) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err: any) {
      setError(err?.message || fallbackErr);
    } finally {
      setBusy(false);
    }
  };

  const isLimited = (u: AdminUser) => !!u.restrictions && !isUnrestricted(u.restrictions);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Users</h2>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Everyone with an account on this instance. The last admin and your own account cannot be deleted.
        </p>
      </div>

      {canAssignIdents ? (
        <p className="text-xs text-[var(--text-muted)]">
          Each account&apos;s <strong className="text-[var(--text-primary)]">ident</strong> is what IRC networks see in{' '}
          <code>nick!ident@host</code>. Leaving it blank derives it from the username.
        </p>
      ) : (
        usersLoaded &&
        !isNode && (
          <p className="text-xs text-[var(--text-muted)]">
            Ident daemon is not active (set <code>LURKER_IDENTD_ENABLED</code> or{' '}
            <code>LURKER_OIDENTD_FILE</code>
            {identOnEngine ? ' on the engine' : ''} to assign per-user idents).
          </p>
        )
      )}

      {identConfig.status === 'failed' && !isNode && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          Ident is configured on {identOnEngine ? 'the engine' : 'this server'} but is not responding.
        </div>
      )}

      {canAssignIdents && identOnEngine && identConfig.status === 'unknown' && (
        <p className="text-xs text-[var(--text-muted)]">
          Ident runs on the engine; the server could not verify its live status.
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {!usersLoaded && !error && (
        <div className="py-8 text-center text-xs text-[var(--text-muted)]">Loading users...</div>
      )}

      {usersLoaded && users.length === 0 && !error && (
        <div className="py-8 text-center text-xs text-[var(--text-muted)]">No users.</div>
      )}

      <div className="space-y-2">
        {users.map((u) => {
          const isSelf = u.id === authUser?.id;
          const limited = isLimited(u);
          const limitsSummary = describeRestrictions(u.restrictions);
          return (
            <div
              key={u.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 text-xs space-y-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                  <span className="font-semibold text-sm text-[var(--text-primary)]">{u.username}</span>
                  {u.role === 'admin' && (
                    <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                      admin
                    </span>
                  )}
                  {u.isPaused && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                      paused
                    </span>
                  )}
                  {limited && (
                    <span
                      title={limitsSummary}
                      className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400"
                    >
                      limited ({limitsSummary})
                    </span>
                  )}
                  {identShown && u.effectiveIdent && (
                    <span
                      title={
                        u.ident
                          ? 'Ident assigned by admin'
                          : 'Ident derived from account username'
                      }
                      className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] font-mono"
                    >
                      ident {u.effectiveIdent}
                    </span>
                  )}
                  {identShown && u.identConflict && (
                    <span
                      title="Another account answers this same ident"
                      className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-400"
                    >
                      duplicate ident
                    </span>
                  )}
                  {u.recoveryExpiresAt && (
                    <span
                      title={`Recovery link expires ${u.recoveryExpiresAt}`}
                      className="rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-[10px] text-[var(--accent)]"
                    >
                      recovery pending
                    </span>
                  )}
                </div>

                {(u.lastSeenAt || u.createdAt) && (
                  <span
                    className="text-[11px] text-[var(--text-muted)]"
                    title={`Joined ${u.createdAt || 'unknown'}${u.lastSeenAt ? ` · Last seen ${u.lastSeenAt}` : ''}`}
                  >
                    {u.lastSeenAt
                      ? `last seen ${formatRelative(u.lastSeenAt)}`
                      : `joined ${formatRelative(u.createdAt)}`}
                  </span>
                )}
              </div>

              {canAssignIdents && editingIdentId === u.id && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runAction(async () => {
                      await useAdminStore.getState().setUserIdent(u.id, identDraft.trim() || null);
                      setEditingIdentId(null);
                      useToastsStore.getState().push('Ident updated', 'success');
                    }, 'Failed to update ident');
                  }}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-2.5"
                >
                  <label className="flex items-center gap-2">
                    <span className="text-[var(--text-secondary)]">Ident</span>
                    <input
                      type="text"
                      value={identDraft}
                      onChange={(e) => setIdentDraft(e.target.value)}
                      placeholder={u.effectiveIdent || u.username}
                      maxLength={MAX_IDENT_LENGTH}
                      spellCheck={false}
                      autoCapitalize="off"
                      className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded bg-[var(--accent)] px-2.5 py-1 text-white font-medium"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setEditingIdentId(null)}
                    className="rounded border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--bg-hover)]"
                  >
                    Cancel
                  </button>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    Blank reverts to username. Applies on next IRC connection.
                  </span>
                </form>
              )}

              {!isNode && editingLimitsId === u.id && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runAction(async () => {
                      await useAdminStore.getState().setUserRestrictions(u.id, limitsDraft);
                      setEditingLimitsId(null);
                      useToastsStore.getState().push('Account limits updated', 'success');
                    }, 'Failed to update limits');
                  }}
                  className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-2.5"
                >
                  <RestrictionsFields value={limitsDraft} onChange={setLimitsDraft} disabled={busy} />
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded bg-[var(--accent)] px-2.5 py-1 text-white font-medium"
                    >
                      Save Limits
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setEditingLimitsId(null)}
                      className="rounded border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--bg-hover)]"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {freshRecovery && freshRecovery.userId === u.id && (
                <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--bg-primary)] p-2.5 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="flex-1 break-all font-mono text-[11px] text-[var(--text-primary)] select-all">
                      {freshRecovery.url}
                    </code>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard?.writeText(freshRecovery.url);
                          setFreshRecovery((cur) => (cur ? { ...cur, copied: true } : cur));
                        } catch {
                          useToastsStore.getState().push('Copy the URL manually', 'info');
                        }
                      }}
                      className="rounded border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--bg-hover)]"
                    >
                      {freshRecovery.copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Send this single-use link to {u.username} (valid 24 hours). It cannot be retrieved again once dismissed.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {canAssignIdents && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setIdentDraft(u.ident || '');
                      setEditingIdentId((cur) => (cur === u.id ? null : u.id));
                    }}
                    className="rounded-lg border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--bg-hover)]"
                  >
                    Ident
                  </button>
                )}

                {!isNode && (
                  <button
                    type="button"
                    disabled={busy || (u.role === 'admin' && !limited)}
                    title={
                      u.role === 'admin' && !limited
                        ? 'Cannot limit an admin account'
                        : 'Restrict allowed networks and uploads'
                    }
                    onClick={() => {
                      setLimitsDraft(u.restrictions ? { ...u.restrictions } : { ...UNRESTRICTED });
                      setEditingLimitsId((cur) => (cur === u.id ? null : u.id));
                    }}
                    className="rounded-lg border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--bg-hover)] disabled:opacity-45"
                  >
                    Limits
                  </button>
                )}

                {!isNode && (
                  <button
                    type="button"
                    disabled={isSelf || busy}
                    title={isSelf ? 'Cannot pause yourself' : undefined}
                    onClick={() =>
                      void runAction(
                        () =>
                          u.isPaused
                            ? useAdminStore.getState().resumeUser(u.id)
                            : useAdminStore.getState().pauseUser(u.id),
                        'Failed to update user pause state',
                      )
                    }
                    className="rounded-lg border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--bg-hover)] disabled:opacity-45"
                  >
                    {u.isPaused ? 'Resume' : 'Pause'}
                  </button>
                )}

                {!isNode && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        u.recoveryExpiresAt &&
                        typeof window.confirm === 'function' &&
                        !window.confirm(`Issue a new recovery link for ${u.username}? The old one will stop working.`)
                      ) {
                        return;
                      }
                      void runAction(async () => {
                        const recovery = await useAdminStore.getState().createRecovery(u.id);
                        setFreshRecovery({ ...recovery, userId: u.id, copied: false });
                      }, 'Failed to issue recovery link');
                    }}
                    className="rounded-lg border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--bg-hover)]"
                  >
                    {u.recoveryExpiresAt ? 'Reissue Recovery' : 'Recovery Link'}
                  </button>
                )}

                {!isNode && u.recoveryExpiresAt && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void runAction(async () => {
                        await useAdminStore.getState().deleteRecovery(u.id);
                        setFreshRecovery((cur) => (cur?.userId === u.id ? null : cur));
                      }, 'Failed to revoke recovery link')
                    }
                    className="rounded-lg border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--bg-hover)]"
                  >
                    Revoke Recovery
                  </button>
                )}

                <button
                  type="button"
                  disabled={isSelf || busy}
                  title={isSelf ? 'Cannot delete yourself' : 'Delete user'}
                  onClick={() => {
                    if (
                      typeof window.confirm === 'function' &&
                      !window.confirm(`Delete account "${u.username}" and all its data?`)
                    ) {
                      return;
                    }
                    void runAction(
                      () => useAdminStore.getState().deleteUser(u.id),
                      'Failed to delete user',
                    );
                  }}
                  className="ml-auto rounded-lg border border-red-500/30 p-1.5 text-red-400 hover:bg-red-500/10 disabled:opacity-45"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
