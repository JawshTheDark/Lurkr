// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useMemo, useState } from 'react';
import { ShieldOff, Trash2, Plus } from 'lucide-react';
import { AppModal } from './AppModal';
import { useIgnoresStore } from '../stores/ignores';
import { useNetworksStore } from '../stores/networks';

interface IgnoreModalProps {
  open: boolean;
  networkId: number | null;
  onClose: () => void;
}

const LEVELS = ['MSGS', 'ACTIONS', 'NOTICES', 'JOINS', 'PARTS', 'QUITS', 'NICKS', 'ALL'];

export const IgnoreModal: React.FC<IgnoreModalProps> = ({ open, networkId, onClose }) => {
  const globalRules = useIgnoresStore((s) => s.global);
  const byNetwork = useIgnoresStore((s) => s.byNetwork);
  const allRules = useMemo(
    () => useIgnoresStore.getState().all(),
    [globalRules, byNetwork],
  );
  const networks = useNetworksStore((s) => s.networks);

  const [mask, setMask] = useState('');
  const [scopeNetworkId, setScopeNetworkId] = useState<string>(
    networkId != null ? String(networkId) : 'global',
  );
  const [levels, setLevels] = useState<string[]>(['ALL']);
  const [channels, setChannels] = useState('');

  const toggleLevel = (lvl: string) => {
    if (lvl === 'ALL') {
      setLevels(['ALL']);
      return;
    }
    const next = levels.filter((l) => l !== 'ALL');
    if (next.includes(lvl)) {
      const filtered = next.filter((l) => l !== lvl);
      setLevels(filtered.length ? filtered : ['ALL']);
    } else {
      setLevels([...next, lvl]);
    }
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mask.trim()) return;
    useIgnoresStore.getState().add({
      networkId: scopeNetworkId === 'global' ? null : Number(scopeNetworkId),
      mask: mask.trim(),
      levels,
      channels: channels
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    });
    setMask('');
    setChannels('');
  };

  return (
    <AppModal open={open} onClose={onClose} title="Ignore Rules" maxWidth="max-w-lg">
      <div className="space-y-4">
        <form
          onSubmit={handleAdd}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-3 space-y-2.5"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              required
              value={mask}
              onChange={(e) => setMask(e.target.value)}
              placeholder="Nick or mask (e.g. troll!*@*)"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
            <select
              value={scopeNetworkId}
              onChange={(e) => setScopeNetworkId(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            >
              <option value="global">Global (All Networks)</option>
              {networks.map((n) => (
                <option key={n.id} value={String(n.id)}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>

          <input
            type="text"
            value={channels}
            onChange={(e) => setChannels(e.target.value)}
            placeholder="Channels (optional, comma-separated, e.g. #general)"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          />

          <div className="flex flex-wrap gap-1.5">
            {LEVELS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => toggleLevel(lvl)}
                className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                  levels.includes(lvl)
                    ? 'bg-[var(--accent)] text-white'
                    : 'border border-[var(--border)] text-[var(--text-secondary)]'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              <Plus className="w-3.5 h-3.5" /> Add Rule
            </button>
          </div>
        </form>

        <div className="max-h-64 overflow-y-auto space-y-1.5">
          {allRules.length === 0 && (
            <div className="py-8 text-center text-xs text-[var(--text-muted)] flex flex-col items-center gap-2">
              <ShieldOff className="w-5 h-5 opacity-40" />
              <span>No ignore rules configured.</span>
            </div>
          )}
          {allRules.map((r) => (
            <div
              key={`${r.networkId ?? 'g'}-${r.id}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <div className="font-medium text-[var(--text-primary)] truncate">
                  {r.mask || r.pattern || '(rule)'}
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  {r.networkId == null
                    ? 'Global'
                    : networks.find((n) => n.id === r.networkId)?.name || `Network #${r.networkId}`}{' '}
                  · {r.levels.join(', ')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => useIgnoresStore.getState().remove(r.networkId, r.id)}
                className="rounded p-1 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </AppModal>
  );
};
