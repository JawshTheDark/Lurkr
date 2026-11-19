// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAdminStore, type AdminNetworkPreset } from '../../stores/admin';

function presetDetails(p: AdminNetworkPreset): string {
  const parts: string[] = [];
  if (p.tags.length > 0) parts.push(p.tags.join(', '));
  if (p.users != null) parts.push(`${p.users.toLocaleString()} users`);
  if (p.channelCount != null) parts.push(`${p.channelCount.toLocaleString()} channels`);
  return parts.join(' · ');
}

interface DraftPreset {
  name: string;
  host: string;
  port: string;
  tls: boolean;
  saslLikelyRequired: boolean;
  channels: string;
  tags: string;
  users: string;
  channelCount: string;
}

const EMPTY_DRAFT: DraftPreset = {
  name: '',
  host: '',
  port: '6697',
  tls: true,
  saslLikelyRequired: false,
  channels: '',
  tags: '',
  users: '',
  channelCount: '',
};

export const AdminNetworksPane: React.FC = () => {
  const networks = useAdminStore((s) => s.networks);
  const allowUserDefined = useAdminStore((s) => s.allowUserDefinedNetworks);
  const loaded = useAdminStore((s) => s.networksLoaded);

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<AdminNetworkPreset | null>(null);
  const [draft, setDraft] = useState<DraftPreset>(EMPTY_DRAFT);

  useEffect(() => {
    setError('');
    useAdminStore
      .getState()
      .fetchNetworks()
      .catch((err: any) => setError(err?.message || 'Failed to load networks'));
  }, []);

  const resetForm = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
  };

  const startEdit = (p: AdminNetworkPreset) => {
    setEditing(p);
    setDraft({
      name: p.name,
      host: p.host,
      port: String(p.port),
      tls: p.tls,
      saslLikelyRequired: p.saslLikelyRequired,
      channels: p.channels.join(', '),
      tags: p.tags.join(', '),
      users: p.users != null ? String(p.users) : '',
      channelCount: p.channelCount != null ? String(p.channelCount) : '',
    });
  };

  const hasEnabledPreset = networks.some((p) => p.enabled);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Networks</h2>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Networks listed here are pinned at the top of every user&apos;s network picker with their recommended channels pre-checked.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {!loaded && !error && (
        <div className="py-6 text-center text-xs text-[var(--text-muted)]">Loading networks...</div>
      )}

      {loaded && networks.length === 0 && !error && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-4 text-xs text-[var(--text-muted)]">
          No networks listed — users see the built-in catalogue of public networks.
        </div>
      )}

      <div className="space-y-2">
        {networks.map((p) => {
          const extra = presetDetails(p);
          return (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2.5 text-xs"
            >
              <div className="space-y-0.5">
                <div className="font-semibold text-sm text-[var(--text-primary)]">{p.name}</div>
                <div className="text-[11px] text-[var(--text-muted)] font-mono">
                  {p.host}:{p.port}
                  {p.tls ? ' · TLS' : ''}
                  {p.saslLikelyRequired ? ' · account required' : ''}
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  {p.channels.length ? p.channels.join(', ') : 'No recommended channels'}
                  {extra ? ` · ${extra}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => startEdit(p)}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--bg-hover)]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setError('');
                    setBusy(true);
                    try {
                      await useAdminStore.getState().deleteNetwork(p.id);
                      if (editing?.id === p.id) resetForm();
                    } catch (err: any) {
                      setError(err?.message || 'Failed to delete network preset');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="rounded border border-red-500/30 p-1.5 text-red-400 hover:bg-red-500/10"
                  title="Delete network preset"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          setBusy(true);
          try {
            const body = {
              name: draft.name.trim(),
              host: draft.host.trim(),
              port: Number(draft.port) || 6697,
              tls: draft.tls,
              saslLikelyRequired: draft.saslLikelyRequired,
              channels: draft.channels
                .split(',')
                .map((c) => c.trim())
                .filter(Boolean),
              tags: draft.tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
              users: draft.users.trim() ? Number(draft.users.trim()) : null,
              channelCount: draft.channelCount.trim() ? Number(draft.channelCount.trim()) : null,
            };
            if (editing) {
              await useAdminStore.getState().updateNetwork(editing.id, body);
            } else {
              await useAdminStore.getState().createNetwork(body);
            }
            resetForm();
          } catch (err: any) {
            setError(err?.message || 'Failed to save network preset');
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 space-y-3 text-xs"
      >
        <div className="font-semibold text-sm">{editing ? `Edit ${editing.name}` : 'Add a Network'}</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="block space-y-1">
            <span className="text-[var(--text-secondary)]">Name</span>
            <input
              type="text"
              required
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Our IRC"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[var(--text-secondary)]">Host</span>
            <input
              type="text"
              required
              value={draft.host}
              onChange={(e) => setDraft((d) => ({ ...d, host: e.target.value }))}
              placeholder="irc.example.org"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[var(--text-secondary)]">Port</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={draft.port}
              onChange={(e) => setDraft((d) => ({ ...d, port: e.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs"
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-[var(--text-secondary)]">Recommended channels</span>
          <input
            type="text"
            value={draft.channels}
            onChange={(e) => setDraft((d) => ({ ...d, channels: e.target.value }))}
            placeholder="#general, #random"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs"
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="block space-y-1">
            <span className="text-[var(--text-secondary)]">Tags (optional)</span>
            <input
              type="text"
              value={draft.tags}
              onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
              placeholder="gaming, linux"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[var(--text-secondary)]">Users (optional)</span>
            <input
              type="number"
              min={0}
              value={draft.users}
              onChange={(e) => setDraft((d) => ({ ...d, users: e.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[var(--text-secondary)]">Channels (optional)</span>
            <input
              type="number"
              min={0}
              value={draft.channelCount}
              onChange={(e) => setDraft((d) => ({ ...d, channelCount: e.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.tls}
              onChange={(e) => setDraft((d) => ({ ...d, tls: e.target.checked }))}
            />
            <span>TLS</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.saslLikelyRequired}
              onChange={(e) =>
                setDraft((d) => ({ ...d, saslLikelyRequired: e.target.checked }))
              }
            />
            <span>Requires account (prompt for SASL credentials)</span>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-white font-medium"
          >
            {editing ? 'Save Changes' : 'Add Network'}
          </button>
          {editing && (
            <button
              type="button"
              disabled={busy}
              onClick={resetForm}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 text-xs space-y-1.5">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!allowUserDefined}
            disabled={busy || (!hasEnabledPreset && allowUserDefined)}
            onChange={async (e) => {
              const restrictToListed = e.target.checked;
              setError('');
              setBusy(true);
              try {
                await useAdminStore.getState().setNetworkPolicy(!restrictToListed);
              } catch (err: any) {
                setError(err?.message || 'Failed to update network lockdown policy');
              } finally {
                setBusy(false);
              }
            }}
            className="mt-0.5"
          />
          <span>
            Only let users connect to the networks listed above. Off-list connections stop without deleting data.
          </span>
        </label>
        {!hasEnabledPreset && (
          <p className="text-[11px] text-[var(--text-muted)]">
            Add at least one network preset before restricting users to listed networks.
          </p>
        )}
      </div>
    </div>
  );
};
