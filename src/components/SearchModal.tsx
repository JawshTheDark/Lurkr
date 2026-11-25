// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { AppModal } from './AppModal';
import { useSearchStore } from '../stores/search';
import { useRelayBotsStore } from '../stores/relayBots';
import { jumpToMessage } from '../lib/jumpToMessage';
import { formatTime } from '../utils/timestamp';

export const SearchModal: React.FC = () => {
  const open = useSearchStore((s) => s.open);
  const query = useSearchStore((s) => s.query);
  const networkId = useSearchStore((s) => s.networkId);
  const target = useSearchStore((s) => s.target);
  const results = useSearchStore((s) => s.results);
  const loading = useSearchStore((s) => s.loading);
  const hasMore = useSearchStore((s) => s.hasMore);
  const error = useSearchStore((s) => s.error);
  const relayBotsByKey = useRelayBotsStore((s) => s.byKey);
  void relayBotsByKey;

  const [input, setInput] = useState(query);
  const [scopeCurrent, setScopeCurrent] = useState(!!target);

  useEffect(() => {
    if (open) {
      setInput(query);
      setScopeCurrent(!!target);
    }
  }, [open, query, target]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    useSearchStore.getState().search({
      query: input,
      networkId: scopeCurrent ? networkId : null,
      target: scopeCurrent ? target : null,
    });
  };

  return (
    <AppModal
      open={open}
      onClose={() => useSearchStore.getState().closeSearch()}
      title="Search Messages"
      maxWidth="max-w-2xl"
    >
      <div className="space-y-3">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
            <input
              type="text"
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search message history..."
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] pl-8 pr-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Search
          </button>
        </form>

        {target && (
          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={scopeCurrent}
              onChange={(e) => setScopeCurrent(e.target.checked)}
            />
            Search only in {target}
          </label>
        )}

        {error && <div className="text-xs text-red-400">{error}</div>}

        <div className="max-h-96 overflow-y-auto space-y-1.5">
          {loading && results.length === 0 && (
            <div className="flex items-center justify-center py-10 text-xs text-[var(--text-muted)] gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Searching...
            </div>
          )}
          {!loading && query && results.length === 0 && !error && (
            <div className="py-10 text-center text-xs text-[var(--text-muted)]">
              No messages found for &ldquo;{query}&rdquo;
            </div>
          )}
          {results.map((hit) => {
            const relayed = useRelayBotsStore.getState().unwrap(hit.networkId, {
              type: hit.type || 'message',
              nick: hit.nick,
              self: hit.self,
              text: hit.text,
            });
            const displayNick = relayed ? relayed.nick : hit.nick;
            const displayText = relayed ? relayed.text : hit.text;
            const timeVal = hit.createdAt || hit.time || '';
            return (
              <button
                key={hit.id}
                type="button"
                onClick={() =>
                  jumpToMessage({
                    networkId: hit.networkId,
                    target: hit.target,
                    messageId: Number(hit.id),
                    onAfterActivate: () => useSearchStore.getState().closeSearch(),
                  })
                }
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-left hover:border-[var(--accent)] cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between gap-2 text-xs mb-0.5">
                  <span className="font-semibold text-[var(--text-primary)]">
                    {displayNick}{' '}
                    <span className="font-normal text-[var(--text-muted)]">in {hit.target}</span>
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {timeVal ? formatTime(timeVal) : ''}
                  </span>
                </div>
                <div className="text-xs text-[var(--text-secondary)] break-words">
                  {relayed?.source && (
                    <span
                      className="text-[var(--text-muted)] mr-1"
                      title={`Relayed via ${hit.nick}`}
                    >
                      [{relayed.source}]
                    </span>
                  )}
                  {displayText}
                </div>
              </button>
            );
          })}
          {hasMore && (
            <button
              type="button"
              disabled={loading}
              onClick={() => useSearchStore.getState().loadMore()}
              className="w-full rounded-lg border border-[var(--border)] py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              {loading ? 'Loading...' : 'Load more results'}
            </button>
          )}
        </div>
      </div>
    </AppModal>
  );
};
