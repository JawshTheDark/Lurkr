// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { AppModal } from './AppModal';
import { loadEmoji, rankShortcodes } from '../utils/emojiShortcodes';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🔥', '👀', '✅', '🚀', '💯', '🙏'];

interface ReactionPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
}

export const ReactionPickerModal: React.FC<ReactionPickerModalProps> = ({
  open,
  onClose,
  onSelect,
}) => {
  const [query, setQuery] = useState('');
  const [table, setTable] = useState<Record<string, string> | null>(null);
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    if (!table) {
      loadEmoji().then((mod) => {
        setTable(mod.EMOJI);
        setNames(Object.keys(mod.EMOJI));
      });
    }
  }, [open, table]);

  const results = useMemo(() => {
    if (!table) return [];
    const q = query.trim().toLowerCase();
    if (!q) {
      return names.slice(0, 80).map((name) => ({ name, glyph: table[name] }));
    }
    return rankShortcodes(names, q)
      .slice(0, 80)
      .map((name) => ({ name, glyph: table[name] }));
  }, [query, table, names]);

  return (
    <AppModal open={open} onClose={onClose} title="Add Reaction" maxWidth="max-w-sm">
      <div className="space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search emoji..."
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] pl-8 pr-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>

        {!query.trim() && (
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
              Quick Reactions
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onSelect(emoji);
                    onClose();
                  }}
                  className="flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] py-1.5 text-xl hover:bg-[var(--bg-hover)]"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="max-h-56 overflow-y-auto grid grid-cols-7 gap-1 pt-1">
          {results.map((item) => (
            <button
              key={item.name}
              type="button"
              title={`:${item.name}:`}
              onClick={() => {
                onSelect(item.glyph);
                onClose();
              }}
              className="flex items-center justify-center rounded p-1.5 text-xl hover:bg-[var(--bg-hover)]"
            >
              {item.glyph}
            </button>
          ))}
          {table && results.length === 0 && (
            <div className="col-span-7 py-6 text-center text-xs text-[var(--text-muted)]">
              No emoji matching &ldquo;{query}&rdquo;
            </div>
          )}
        </div>
      </div>
    </AppModal>
  );
};
