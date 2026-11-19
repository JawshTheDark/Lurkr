// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useState } from 'react';
import { Hash } from 'lucide-react';
import { AppModal } from './AppModal';
import { useBuffersStore } from '../stores/buffers';

interface JoinChannelModalProps {
  open: boolean;
  networkId: number | null;
  onClose: () => void;
}

export const JoinChannelModal: React.FC<JoinChannelModalProps> = ({
  open,
  networkId,
  onClose,
}) => {
  const [channel, setChannel] = useState('#');
  const [key, setKey] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!networkId) return;
    const raw = channel.trim();
    if (!raw) return;
    const target = raw.startsWith('#') || raw.startsWith('&') ? raw : `#${raw}`;
    useBuffersStore.getState().joinOrActivate(networkId, target, key.trim() || undefined);
    setChannel('#');
    setKey('');
    onClose();
  };

  return (
    <AppModal open={open} onClose={onClose} title="Join Channel" maxWidth="max-w-sm">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
            Channel Name
          </label>
          <div className="relative">
            <Hash className="w-4 h-4 absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
            <input
              type="text"
              autoFocus
              required
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              placeholder="#general"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] pl-8 pr-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
            Channel Key (Optional)
          </label>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Optional key"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            Join
          </button>
        </div>
      </form>
    </AppModal>
  );
};
