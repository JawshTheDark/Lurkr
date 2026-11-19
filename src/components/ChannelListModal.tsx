// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, Users, Loader2 } from 'lucide-react';
import { AppModal } from './AppModal';
import { EMPTY_CHANLIST, useChanlistStore } from '../stores/chanlist';
import { useBuffersStore } from '../stores/buffers';

interface ChannelListModalProps {
  open: boolean;
  networkId: number | null;
  onClose: () => void;
}

export const ChannelListModal: React.FC<ChannelListModalProps> = ({
  open,
  networkId,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const chanlist = useChanlistStore((s) =>
    networkId ? s.forNetwork(networkId) : EMPTY_CHANLIST,
  );

  useEffect(() => {
    if (open && networkId && chanlist.status === 'idle') {
      useChanlistStore.getState().request(networkId, false);
    }
  }, [open, networkId, chanlist.status]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? chanlist.channels.filter(
          (c) =>
            c.channel.toLowerCase().includes(q) ||
            (c.topic && c.topic.toLowerCase().includes(q)),
        )
      : chanlist.channels;
    return list.slice(0, 200);
  }, [chanlist.channels, query]);

  return (
    <AppModal open={open} onClose={onClose} title="Channel Directory" maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter channels or topics..."
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] pl-8 pr-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <button
            type="button"
            disabled={!networkId || chanlist.status === 'loading'}
            onClick={() => networkId && useChanlistStore.getState().request(networkId, true)}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${chanlist.status === 'loading' ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>

        <div className="text-xs text-[var(--text-muted)] flex justify-between">
          <span>
            {chanlist.status === 'loading'
              ? 'Loading channel list...'
              : `${chanlist.channels.length.toLocaleString()} channels loaded`}
          </span>
          {filtered.length === 200 && <span>Showing top 200 matches</span>}
        </div>

        <div className="max-h-96 overflow-y-auto divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--bg-primary)]">
          {chanlist.status === 'loading' && chanlist.channels.length === 0 && (
            <div className="flex items-center justify-center py-12 text-xs text-[var(--text-muted)] gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Fetching /LIST...
            </div>
          )}
          {'error' in chanlist && chanlist.error && (
            <div className="py-8 text-center text-xs text-red-400">{chanlist.error}</div>
          )}
          {filtered.map((c) => (
            <button
              key={c.channel}
              type="button"
              onClick={() => {
                if (!networkId) return;
                useBuffersStore.getState().joinOrActivate(networkId, c.channel);
                onClose();
              }}
              className="w-full flex items-start justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--bg-hover)]"
            >
              <div className="min-w-0">
                <div className="font-medium text-sm text-[var(--text-primary)]">
                  {c.channel}
                </div>
                {c.topic && (
                  <div className="text-xs text-[var(--text-secondary)] line-clamp-1">
                    {c.topic}
                  </div>
                )}
              </div>
              <span className="shrink-0 flex items-center gap-1 text-xs text-[var(--text-muted)]">
                <Users className="w-3 h-3" /> {c.users}
              </span>
            </button>
          ))}
        </div>
      </div>
    </AppModal>
  );
};
