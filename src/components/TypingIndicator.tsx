// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useState } from 'react';
import { bufferKey, useBuffersStore } from '../stores/buffers';
import { useIgnoresStore } from '../stores/ignores';
import { useNetworksStore } from '../stores/networks';
import { useSettingsStore } from '../stores/settings';

interface TypingIndicatorProps {
  networkId: number;
  target: string;
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({ networkId, target }) => {
  const bKey = bufferKey(networkId, target);
  const typingMap = useBuffersStore((s) => s.buffers[bKey]?.typing);
  const ownNick = useNetworksStore(
    (s) => s.states[networkId]?.nick || s.networks.find((n) => n.id === networkId)?.nick || '',
  );
  useIgnoresStore((s) => s.global);
  useIgnoresStore((s) => s.byNetwork[networkId]);
  const isMemberIgnored = useIgnoresStore((s) => s.isMemberIgnored);
  const showTyping = useSettingsStore(
    (s) => s.effective('chat.show_typing_notifications') !== false,
  );

  const [now, setNow] = useState(() => Date.now());
  const rawCount = typingMap ? Object.keys(typingMap).length : 0;

  useEffect(() => {
    if (!showTyping || rawCount === 0) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [showTyping, rawCount]);

  if (!showTyping || !typingMap || rawCount === 0) return null;

  const ownLower = ownNick.toLowerCase();
  const live = Object.values(typingMap).filter(
    (entry) =>
      entry.expiresAt > now &&
      (!ownLower || entry.nick.toLowerCase() !== ownLower) &&
      !isMemberIgnored(networkId, target, { nick: entry.nick, userhost: entry.userhost ?? null }),
  );

  if (live.length === 0) return null;

  const active = live.filter((e) => e.state !== 'paused');
  const paused = live.filter((e) => e.state === 'paused');

  const formatLabel = (list: typeof live, verbSingle: string, verbPlural: string): React.ReactNode => {
    if (list.length === 1) {
      return (
        <>
          <strong className="font-semibold text-[var(--text-primary)]">{list[0].nick}</strong>{' '}
          {verbSingle}
        </>
      );
    }
    if (list.length === 2) {
      return (
        <>
          <strong className="font-semibold text-[var(--text-primary)]">{list[0].nick}</strong> and{' '}
          <strong className="font-semibold text-[var(--text-primary)]">{list[1].nick}</strong>{' '}
          {verbPlural}
        </>
      );
    }
    return (
      <>
        <strong className="font-semibold text-[var(--text-primary)]">{list[0].nick}</strong>,{' '}
        <strong className="font-semibold text-[var(--text-primary)]">{list[1].nick}</strong>, and{' '}
        {list.length - 2} more {verbPlural}
      </>
    );
  };

  const showActive = active.length > 0;
  const textNode = showActive
    ? formatLabel(active, 'is typing…', 'are typing…')
    : formatLabel(paused, 'paused typing', 'paused typing');

  return (
    <div
      className="typing-indicator mb-1.5 flex items-center gap-2 px-1 text-[11px] text-[var(--text-muted)]"
      aria-live="polite"
    >
      <span className="typing-dots" aria-hidden="true">
        <span className={showActive ? 'typing-dot typing-dot-active' : 'typing-dot'} />
        <span className={showActive ? 'typing-dot typing-dot-active' : 'typing-dot'} />
        <span className={showActive ? 'typing-dot typing-dot-active' : 'typing-dot'} />
      </span>
      <span className="truncate">{textNode}</span>
    </div>
  );
};
