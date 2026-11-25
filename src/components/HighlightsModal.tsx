// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect } from 'react';
import { Bell, Loader2 } from 'lucide-react';
import { AppModal } from './AppModal';
import { useHighlightsStore } from '../stores/highlights';
import { useRelayBotsStore } from '../stores/relayBots';
import { jumpToMessage } from '../lib/jumpToMessage';
import { formatTime } from '../utils/timestamp';

interface HighlightsModalProps {
  open: boolean;
  onClose: () => void;
}

export const HighlightsModal: React.FC<HighlightsModalProps> = ({ open, onClose }) => {
  const items = useHighlightsStore((s) => s.items);
  const loading = useHighlightsStore((s) => s.loading);
  const hasMore = useHighlightsStore((s) => s.hasMore);
  const loaded = useHighlightsStore((s) => s.loaded);
  const relayBotsByKey = useRelayBotsStore((s) => s.byKey);
  void relayBotsByKey;

  useEffect(() => {
    if (open) {
      useHighlightsStore.getState().markSeen();
      if (!loaded) {
        useHighlightsStore.getState().fetchInitial();
      }
    }
  }, [open, loaded]);

  return (
    <AppModal open={open} onClose={onClose} title="Highlights & Mentions" maxWidth="max-w-xl">
      <div className="max-h-96 overflow-y-auto space-y-2">
        {loading && items.length === 0 && (
          <div className="flex items-center justify-center py-10 text-xs text-[var(--text-muted)] gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading highlights...
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="py-10 text-center text-xs text-[var(--text-muted)] flex flex-col items-center gap-2">
            <Bell className="w-6 h-6 opacity-40" />
            <span>No highlights yet.</span>
          </div>
        )}
        {items.map((item) => {
          const relayed = useRelayBotsStore.getState().unwrap(item.networkId, {
            type: item.type || 'message',
            nick: item.nick,
            text: item.text,
          });
          const displayNick = relayed ? relayed.nick : item.nick;
          const displayText = relayed ? relayed.text : item.text;
          return (
            <button
              key={`${item.kind || 'h'}-${item.id}`}
              type="button"
              onClick={() =>
                jumpToMessage({
                  networkId: item.networkId,
                  target: item.target,
                  messageId: Number((item as any).messageId ?? item.id),
                  onAfterActivate: onClose,
                })
              }
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-left hover:border-[var(--accent)] cursor-pointer transition-colors"
            >
              <div className="flex items-center justify-between gap-2 text-xs mb-0.5">
                <span className="font-semibold text-[var(--text-primary)]">
                  {displayNick}{' '}
                  <span className="font-normal text-[var(--text-muted)]">in {item.target}</span>
                </span>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {formatTime(item.createdAt || item.time || '')}
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
          );
        })}
        {hasMore && items.length > 0 && (
          <button
            type="button"
            disabled={loading}
            onClick={() => useHighlightsStore.getState().fetchMore()}
            className="w-full rounded-lg border border-[var(--border)] py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            {loading ? 'Loading...' : 'Load more'}
          </button>
        )}
      </div>
    </AppModal>
  );
};
