// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { resolveServerUrl } from '../../api';
import { useAdminStore, type AdminInvite } from '../../stores/admin';
import { useToastsStore } from '../../stores/toasts';
import { formatRelative } from '../../utils/timestamp';
import { describeRestrictions } from '../../utils/accountRestrictions';
import {
  hostListProblem,
  isUnrestricted,
  UNRESTRICTED,
  type AccountRestrictions,
} from '../../shared/accountRestrictions';
import { RestrictionsFields } from './RestrictionsFields';

function inviteMeta(inv: AdminInvite): string {
  const parts: string[] = [];
  if (inv.usedByUsername) parts.push(`joined as ${inv.usedByUsername}`);
  if (inv.status === 'consumed' && inv.usedAt) {
    parts.push(`used ${formatRelative(inv.usedAt)}`);
  } else if (inv.expiresAt) {
    parts.push(`expires ${formatRelative(inv.expiresAt)}`);
  } else {
    parts.push('no expiry');
  }
  return parts.join(' · ');
}

export const AdminInvitesPane: React.FC = () => {
  const invites = useAdminStore((s) => s.invites);
  const invitesLoaded = useAdminStore((s) => s.invitesLoaded);

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState<number>(7);
  const [restrictions, setRestrictions] = useState<AccountRestrictions>({ ...UNRESTRICTED });
  const [createdInvite, setCreatedInvite] = useState<AdminInvite | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  useEffect(() => {
    setError('');
    useAdminStore
      .getState()
      .fetchInvites()
      .catch((err: any) => setError(err?.message || 'Failed to load invites'));
  }, []);

  const noNetworks = restrictions.networks !== null && restrictions.networks.length === 0;
  const badHost = restrictions.networks !== null && !!hostListProblem(restrictions.networks);

  const copyUrl = async (inv: AdminInvite) => {
    const link = inv.url?.startsWith('http') ? inv.url : resolveServerUrl(inv.url || `/invite/${inv.token}`);
    try {
      await navigator.clipboard?.writeText(link);
      setCopiedToken(inv.token);
      setTimeout(() => setCopiedToken((cur) => (cur === inv.token ? null : cur)), 1500);
      useToastsStore.getState().push('Invite link copied', 'info');
    } catch {
      useToastsStore.getState().push('Copy the invite link manually', 'info');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Invites</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            One-time invite links. Used invites stay listed showing who joined until you remove them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreatedInvite(null);
            setRestrictions({ ...UNRESTRICTED });
            setExpiresInDays(7);
            setComposing((v) => !v);
          }}
          className="flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white"
        >
          <Plus className="w-3.5 h-3.5" /> {composing ? 'Close' : 'Generate Invite Link'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {composing && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (noNetworks || badHost) return;
            setError('');
            setBusy(true);
            try {
              const invite = await useAdminStore.getState().createInvite({
                expiresInDays,
                ...(isUnrestricted(restrictions) ? {} : { restrictions }),
              });
              setCreatedInvite(invite);
              await copyUrl(invite);
            } catch (err: any) {
              setError(err?.message || 'Failed to create invite');
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 space-y-3 text-xs"
        >
          {createdInvite ? (
            <div className="space-y-2">
              <div className="font-medium text-[var(--text-primary)]">Invite link ready (single use)</div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="flex-1 break-all rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 font-mono text-[11px] select-all">
                  {createdInvite.url}
                </code>
                <button
                  type="button"
                  onClick={() => void copyUrl(createdInvite)}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 hover:bg-[var(--bg-hover)]"
                >
                  {copiedToken === createdInvite.token ? 'Copied' : 'Copy link'}
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCreatedInvite(null);
                  setComposing(false);
                }}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-white font-medium"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <label className="flex items-center gap-2">
                <span className="text-[var(--text-secondary)]">Expires in</span>
                <select
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(Number(e.target.value))}
                  disabled={busy}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs"
                >
                  <option value={1}>1 day</option>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                </select>
              </label>

              <fieldset className="rounded-lg border border-[var(--border)] p-3 space-y-2">
                <legend className="px-1 text-[11px] text-[var(--text-muted)]">
                  Account restrictions
                </legend>
                <RestrictionsFields value={restrictions} onChange={setRestrictions} disabled={busy} />
                {noNetworks && (
                  <p className="text-[11px] text-amber-400">
                    List at least one allowed hostname, or check Any network.
                  </p>
                )}
              </fieldset>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={busy || noNetworks || badHost}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-white font-medium disabled:opacity-45"
                >
                  {busy ? 'Creating...' : 'Create Invite Link'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setComposing(false)}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--bg-hover)]"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </form>
      )}

      {!invitesLoaded && !error && (
        <div className="py-8 text-center text-xs text-[var(--text-muted)]">Loading invites...</div>
      )}

      {invitesLoaded && invites.length === 0 && !error && (
        <div className="py-8 text-center text-xs text-[var(--text-muted)]">No invites yet.</div>
      )}

      <div className="space-y-2">
        {invites.map((inv) => {
          const limits = describeRestrictions(inv.restrictions);
          const link = inv.url || `/invite/${inv.token}`;
          const spent = inv.status === 'consumed';
          return (
            <div
              key={inv.token}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2.5 text-xs space-y-1.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                      inv.status === 'pending'
                        ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                        : inv.status === 'expired'
                          ? 'bg-red-500/15 text-red-400'
                          : 'bg-[var(--bg-primary)] text-[var(--text-muted)]'
                    }`}
                  >
                    {inv.status}
                  </span>
                  {limits && (
                    <span
                      title={limits}
                      className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400"
                    >
                      limited ({limits})
                    </span>
                  )}
                  <span className="text-[11px] text-[var(--text-muted)]" title={inv.expiresAt || undefined}>
                    {inviteMeta(inv)}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {inv.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => void copyUrl(inv)}
                      className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--bg-hover)]"
                      title="Copy invite link"
                    >
                      <Copy className="w-3 h-3" />
                      {copiedToken === inv.token ? 'Copied' : 'Copy'}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const prompt = spent
                        ? `Remove this used invite? ${inv.usedByUsername || 'The member'} keeps their account.`
                        : 'Revoke this invite link so it can no longer be used?';
                      if (typeof window.confirm === 'function' && !window.confirm(prompt)) return;
                      setBusy(true);
                      setError('');
                      try {
                        await useAdminStore.getState().deleteInvite(inv.token);
                      } catch (err: any) {
                        setError(err?.message || 'Failed to delete invite');
                      } finally {
                        setBusy(false);
                      }
                    }}
                    title={spent ? 'Remove record' : 'Revoke invite'}
                    className="rounded border border-red-500/30 p-1 text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="font-mono text-[11px] text-[var(--text-muted)] truncate select-all" title={link}>
                {link}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
