// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useState } from 'react';
import { Bell, Shield, MessageSquare } from 'lucide-react';
import { AppModal } from './AppModal';
import { useBuffersStore, bufferKey } from '../stores/buffers';
import { useChannelNotifyStore, type ChannelNotifyLevel } from '../stores/channelNotify';
import { socketSendWithAck } from '../services/socketBus';
import { useToastsStore } from '../stores/toasts';

interface ChannelModalProps {
  open: boolean;
  networkId: number | null;
  target: string;
  onClose: () => void;
}

export const ChannelModal: React.FC<ChannelModalProps> = ({
  open,
  networkId,
  target,
  onClose,
}) => {
  const bKey = networkId ? bufferKey(networkId, target) : '';
  const buffer = useBuffersStore((s) => (bKey ? s.buffers[bKey] : undefined));
  const notifyLevel = useChannelNotifyStore((s) =>
    networkId ? s.levelFor(networkId, target) : 'default',
  );

  const [topic, setTopic] = useState('');
  const [modes, setModes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && buffer) {
      setTopic(buffer.topic || '');
      setModes(buffer.modes || '');
    }
  }, [open, buffer]);

  if (!networkId || !buffer) return null;

  const handleSaveTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const ack = await socketSendWithAck({
        type: 'raw',
        networkId,
        line: `TOPIC ${target} :${topic}`,
      });
      if (!ack.ok && ack.error) {
        useToastsStore.getState().push(ack.error, 'error');
      } else {
        useToastsStore.getState().push('Topic updated', 'success');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleApplyModes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modes.trim()) return;
    setSaving(true);
    try {
      const ack = await socketSendWithAck({
        type: 'raw',
        networkId,
        line: `MODE ${target} ${modes.trim()}`,
      });
      if (!ack.ok && ack.error) {
        useToastsStore.getState().push(ack.error, 'error');
      } else {
        useToastsStore.getState().push('Mode command sent', 'success');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal open={open} onClose={onClose} title={`Channel Settings: ${target}`} maxWidth="max-w-lg">
      <div className="space-y-4">
        {/* Notifications */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)] mb-2">
            <Bell className="w-3.5 h-3.5 text-[var(--accent)]" /> Notifications
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(['default', 'all', 'mute'] as ChannelNotifyLevel[]).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => useChannelNotifyStore.getState().setLevel(networkId, target, lvl)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium capitalize transition-colors ${
                  notifyLevel === lvl
                    ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
                    : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {lvl === 'default' ? 'Mentions Only' : lvl === 'all' ? 'All Messages' : 'Muted'}
              </button>
            ))}
          </div>
        </div>

        {/* Topic */}
        <form
          onSubmit={handleSaveTopic}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-3 space-y-2"
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
            <MessageSquare className="w-3.5 h-3.5 text-[var(--accent)]" /> Channel Topic
          </div>
          <textarea
            rows={3}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Set Topic
            </button>
          </div>
        </form>

        {/* Modes */}
        <form
          onSubmit={handleApplyModes}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-3 space-y-2"
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
            <Shield className="w-3.5 h-3.5 text-[var(--accent)]" /> Channel Modes
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={modes}
              onChange={(e) => setModes(e.target.value)}
              placeholder="+nt"
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              Apply
            </button>
          </div>
        </form>
      </div>
    </AppModal>
  );
};
