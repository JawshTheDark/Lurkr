// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect } from 'react';
import { Bookmark, Trash2, Loader2 } from 'lucide-react';
import { AppModal } from './AppModal';
import { useBookmarksStore } from '../stores/bookmarks';
import { useBuffersStore } from '../stores/buffers';
import { useRelayBotsStore } from '../stores/relayBots';
import { formatTime } from '../utils/timestamp';

interface BookmarksModalProps {
  open: boolean;
  onClose: () => void;
}

export const BookmarksModal: React.FC<BookmarksModalProps> = ({ open, onClose }) => {
  const items = useBookmarksStore((s) => s.items);
  const loading = useBookmarksStore((s) => s.loading);
  const hasMore = useBookmarksStore((s) => s.hasMore);
  const loaded = useBookmarksStore((s) => s.loaded);
  const relayBotsByKey = useRelayBotsStore((s) => s.byKey);
  void relayBotsByKey;

  useEffect(() => {
    if (open && !loaded) {
      useBookmarksStore.getState().fetchInitial();
    }
  }, [open, loaded]);

  return (
    <AppModal open={open} onClose={onClose} title="Bookmarks" maxWidth="max-w-xl">
      <div className="max-h-96 overflow-y-auto space-y-2">
        {loading && items.length === 0 && (
          <div className="flex items-center justify-center py-10 text-xs text-[var(--text-muted)] gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading bookmarks...
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="py-10 text-center text-xs text-[var(--text-muted)] flex flex-col items-center gap-2">
            <Bookmark className="w-6 h-6 opacity-40" />
            <span>No bookmarked messages yet.</span>
          </div>
        )}
        {items.map((item) => {
          const relayed = useRelayBotsStore.getState().unwrap(item.networkId, {
            type: 'message',
            nick: item.nick,
            text: item.text,
          });
          const displayNick = relayed ? relayed.nick : item.nick;
          const displayText = relayed ? relayed.text : item.text;
          return (
            <div
              key={item.id}
              className="flex items-start justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2"
            >
              <button
                type="button"
                onClick={() => {
                  useBuffersStore.getState().activate(item.networkId, item.target);
                  onClose();
                }}
                className="flex-1 text-left min-w-0"
              >
                <div className="flex items-center justify-between gap-2 text-xs mb-0.5">
                  <span className="font-semibold text-[var(--text-primary)]">
                    {displayNick}{' '}
                    <span className="font-normal text-[var(--text-muted)]">in {item.target}</span>
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {formatTime(item.createdAt)}
                  </span>
                </div>
                <div className="text-xs text-[var(--text-secondary)] break-words">
                  {relayed?.source && (
                    <span className="text-[var(--text-muted)] mr-1" title={`Relayed via ${item.nick}`}>
                      [{relayed.source}]
                    </span>
                  )}
                  {displayText}
                </div>
              </button>
              <button
                type="button"
                onClick={() => useBookmarksStore.getState().remove(item.messageId)}
                className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-400"
                title="Remove bookmark"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
        {hasMore && items.length > 0 && (
          <button
            type="button"
            disabled={loading}
            onClick={() => useBookmarksStore.getState().fetchMore()}
            className="w-full rounded-lg border border-[var(--border)] py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            {loading ? 'Loading...' : 'Load more'}
          </button>
        )}
      </div>
    </AppModal>
  );
};
