// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useMemo, useState } from 'react';
import { AppModal } from './AppModal';
import { activeBufferFrom, useNetworksStore } from '../stores/networks';
import { useBuffersStore } from '../stores/buffers';
import { useDesktopUiStore, type IrcPromptKind } from '../stores/desktopUi';
import { dispatchSlashCommand } from '../lib/commands/dispatch';
import { isChannelTarget } from '../shared/channels';

interface PromptSpec {
  title: string;
  description: string;
  primaryLabel: string;
  primaryPlaceholder: string;
  primaryRequired: boolean;
  secondaryLabel?: string;
  secondaryPlaceholder?: string;
}

const SPECS: Record<IrcPromptKind, PromptSpec> = {
  nick: {
    title: 'Change Nickname (/nick)',
    description: 'Set your nickname on the active IRC network.',
    primaryLabel: 'New Nickname',
    primaryPlaceholder: 'e.g. alice_',
    primaryRequired: true,
  },
  topic: {
    title: 'Set Channel Topic (/topic)',
    description: 'Update the topic for the current channel.',
    primaryLabel: 'Topic',
    primaryPlaceholder: 'Enter channel topic...',
    primaryRequired: false,
  },
  query: {
    title: 'Open Direct Message (/query)',
    description: 'Open a private message buffer with a user and optionally send a message.',
    primaryLabel: 'Nickname',
    primaryPlaceholder: 'e.g. bob',
    primaryRequired: true,
    secondaryLabel: 'Initial Message (optional)',
    secondaryPlaceholder: 'Hey there!',
  },
  whois: {
    title: 'WHOIS User (/whois)',
    description: 'Query connection, server, channels, and account info for a nickname.',
    primaryLabel: 'Nickname',
    primaryPlaceholder: 'e.g. bob',
    primaryRequired: true,
  },
  whowas: {
    title: 'WHOWAS History (/whowas)',
    description: 'Query recent session history for an offline or recently renamed nickname.',
    primaryLabel: 'Nickname',
    primaryPlaceholder: 'e.g. bob',
    primaryRequired: true,
    secondaryLabel: 'Count (optional)',
    secondaryPlaceholder: '5',
  },
  away: {
    title: 'Set Away Status (/away)',
    description: 'Mark yourself as away on this network with a custom status message.',
    primaryLabel: 'Away Message',
    primaryPlaceholder: 'Away from keyboard',
    primaryRequired: false,
  },
  invite: {
    title: 'Invite User to Channel (/invite)',
    description: 'Invite a nickname into a channel.',
    primaryLabel: 'Nickname',
    primaryPlaceholder: 'e.g. bob',
    primaryRequired: true,
    secondaryLabel: 'Channel',
    secondaryPlaceholder: '#channel',
  },
  mode: {
    title: 'Set Modes (/mode)',
    description: 'Inspect or update channel/user modes (e.g. +m, +o nick, -i).',
    primaryLabel: 'Modes & Arguments',
    primaryPlaceholder: '+o nick or #channel +m',
    primaryRequired: false,
  },
  kill: {
    title: 'Kill User (/kill)',
    description: 'Disconnect a user from the IRC network (requires operator privileges).',
    primaryLabel: 'Nickname',
    primaryPlaceholder: 'e.g. spammer',
    primaryRequired: true,
    secondaryLabel: 'Reason (optional)',
    secondaryPlaceholder: 'Disruptive behavior',
  },
  relay: {
    title: 'Mark Relay / Janus Bot (/relay)',
    description:
      'Unwrap messages from a bridge bot (e.g. EyeBridge) into [source] <nick> message rows.',
    primaryLabel: 'Bot Nickname',
    primaryPlaceholder: 'e.g. EyeBridge',
    primaryRequired: true,
    secondaryLabel: 'Custom Pattern (optional)',
    secondaryPlaceholder: '[{source}] <{nick}> {message}',
  },
  rename: {
    title: 'Rename Channel (/rename)',
    description: 'Rename the current IRC channel (requires draft/channel-rename CAP).',
    primaryLabel: 'New Channel Name',
    primaryPlaceholder: '#new-channel',
    primaryRequired: true,
    secondaryLabel: 'Reason (optional)',
    secondaryPlaceholder: 'Topic moved',
  },
  raw: {
    title: 'Run Slash or Raw IRC Command',
    description: 'Enter a slash command (e.g. /lusers) or raw IRC line (e.g. STATS u).',
    primaryLabel: 'Command',
    primaryPlaceholder: '/version or STATS u',
    primaryRequired: true,
  },
};

export const IrcCommandPromptModal: React.FC = () => {
  const kind = useDesktopUiStore((s) => s.promptKind);
  const close = useDesktopUiStore((s) => s.closePrompt);

  const activeKey = useNetworksStore((s) => s.activeKey);
  const networks = useNetworksStore((s) => s.networks);
  const states = useNetworksStore((s) => s.states);
  const buffers = useBuffersStore((s) => s.buffers);

  const activeBuffer = useMemo(
    () => activeBufferFrom(activeKey, networks),
    [activeKey, networks],
  );
  const netState = activeBuffer ? states[activeBuffer.networkId] : null;
  const activeBufObj = activeBuffer
    ? buffers[`${activeBuffer.networkId}::${activeBuffer.target}`]
    : undefined;

  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState('');

  useEffect(() => {
    if (!kind) return;
    setSecondary('');
    if (kind === 'nick') {
      setPrimary(netState?.nick || activeBuffer?.network?.nick || '');
    } else if (kind === 'topic') {
      setPrimary(activeBufObj?.topic || '');
    } else if (kind === 'whois' && activeBuffer && !isChannelTarget(activeBuffer.target) && !activeBuffer.target.startsWith(':server:')) {
      setPrimary(activeBuffer.target);
    } else if (kind === 'away') {
      setPrimary(netState?.away?.message || 'Away');
    } else if (kind === 'invite') {
      setPrimary('');
      setSecondary(
        activeBuffer && isChannelTarget(activeBuffer.target) ? activeBuffer.target : '',
      );
    } else {
      setPrimary('');
    }
  }, [kind, activeBuffer, activeBufObj?.topic, netState?.nick, netState?.away?.message]);

  if (!kind) return null;
  const spec = SPECS[kind];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBuffer) {
      close();
      return;
    }
    const p = primary.trim();
    const s = secondary.trim();
    if (spec.primaryRequired && !p) return;

    let cmdLine = '';
    switch (kind) {
      case 'nick':
        cmdLine = `/nick ${p}`;
        break;
      case 'topic':
        cmdLine = p ? `/topic ${p}` : '/topic';
        break;
      case 'query':
        cmdLine = s ? `/query ${p} ${s}` : `/query ${p}`;
        break;
      case 'whois':
        cmdLine = `/whois ${p}`;
        break;
      case 'whowas':
        cmdLine = s ? `/whowas ${p} ${s}` : `/whowas ${p}`;
        break;
      case 'away':
        cmdLine = `/away ${p || 'Away'}`;
        break;
      case 'invite':
        cmdLine = s ? `/invite ${p} ${s}` : `/invite ${p}`;
        break;
      case 'mode':
        cmdLine = p ? `/mode ${p}` : '/mode';
        break;
      case 'kill':
        cmdLine = s ? `/kill ${p} ${s}` : `/kill ${p}`;
        break;
      case 'relay':
        cmdLine = s ? `/relay add ${p} ${s}` : `/relay add ${p}`;
        break;
      case 'rename':
        cmdLine = s ? `/rename ${p} ${s}` : `/rename ${p}`;
        break;
      case 'raw':
        cmdLine = p.startsWith('/') ? p : `/raw ${p}`;
        break;
    }

    close();
    if (cmdLine) {
      await dispatchSlashCommand(cmdLine, activeBuffer.networkId, activeBuffer.target);
    }
  };

  return (
    <AppModal open={!!kind} onClose={close} title={spec.title} maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs text-[var(--text-secondary)]">{spec.description}</p>
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
            {spec.primaryLabel}
          </label>
          <input
            type="text"
            autoFocus
            required={spec.primaryRequired}
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            placeholder={spec.primaryPlaceholder}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>
        {spec.secondaryLabel && (
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              {spec.secondaryLabel}
            </label>
            <input
              type="text"
              value={secondary}
              onChange={(e) => setSecondary(e.target.value)}
              placeholder={spec.secondaryPlaceholder}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={close}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            Execute
          </button>
        </div>
      </form>
    </AppModal>
  );
};
