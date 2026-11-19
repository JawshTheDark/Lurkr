// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Play, Search, Shield, Terminal } from 'lucide-react';
import { AppModal } from './AppModal';
import {
  SLASH_COMMANDS,
  dispatchSlashCommand,
  type SlashCommandCategory,
  type SlashCommandDef,
} from '../lib/commands/dispatch';
import {
  buildCapabilityContext,
  evaluateCommand,
  formatServerSummary,
  getAvailableSlashCommands,
} from '../lib/networkCapabilities';
import { isChannelTarget } from '../shared/channels';
import { activeBufferFrom, useNetworksStore } from '../stores/networks';
import { useBuffersStore } from '../stores/buffers';
import { useDesktopUiStore } from '../stores/desktopUi';
import { useToastsStore } from '../stores/toasts';

type FilterTab = 'all' | 'general' | 'channel' | 'network' | 'oper';

const OPER_CATEGORIES = new Set<SlashCommandCategory>([
  'oper',
  'unreal',
  'anope',
  'ergo',
  'services',
]);

function categoryBucket(cat?: SlashCommandCategory): FilterTab {
  if (!cat) return 'general';
  if (OPER_CATEGORIES.has(cat)) return 'oper';
  if (cat === 'channel') return 'channel';
  if (cat === 'network') return 'network';
  return 'general';
}

function canRunWithoutArgs(cmd: SlashCommandDef): boolean {
  return !cmd.args.includes('<');
}

export const IrcCommandsModal: React.FC = () => {
  const navigate = useNavigate();
  const open = useDesktopUiStore((s) => s.commandsOpen);
  const close = useDesktopUiStore((s) => s.closeCommands);

  const activeKey = useNetworksStore((s) => s.activeKey);
  const networks = useNetworksStore((s) => s.networks);
  const states = useNetworksStore((s) => s.states);
  const profiles = useNetworksStore((s) => s.profiles);
  const buffers = useBuffersStore((s) => s.buffers);

  const activeBuffer = useMemo(
    () => activeBufferFrom(activeKey, networks),
    [activeKey, networks],
  );
  const netState = activeBuffer ? states[activeBuffer.networkId] : null;
  const profile = activeBuffer ? profiles[activeBuffer.networkId] : undefined;
  const inChannel = activeBuffer ? isChannelTarget(activeBuffer.target) : false;

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<FilterTab>('all');
  const [showUnavailable, setShowUnavailable] = useState(false);

  const capCtx = useMemo(() => {
    const channelObj = activeBuffer ? buffers[`${activeBuffer.networkId}::${activeBuffer.target}`] : undefined;
    const ownNick = netState?.nick;
    const selfMember =
      channelObj && ownNick
        ? channelObj.members.find((m) => m.nick.toLowerCase() === ownNick.toLowerCase())
        : undefined;
    return buildCapabilityContext(netState || undefined, profile, {
      selfChannelModes: selfMember?.modes,
      channelModes: channelObj?.modes,
      target: activeBuffer?.target,
    });
  }, [netState, profile, activeBuffer, buffers]);

  const summary = useMemo(() => formatServerSummary(capCtx), [capCtx]);
  const availableNames = useMemo(() => {
    const avail = getAvailableSlashCommands(SLASH_COMMANDS, capCtx, { inChannel });
    return new Set(avail.map((c) => c.name));
  }, [capCtx, inChannel]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\/+/, '');
    return SLASH_COMMANDS.filter((cmd) => {
      if (tab !== 'all' && categoryBucket(cmd.category) !== tab) return false;
      const isAvailable = availableNames.has(cmd.name);
      if (netState?.state === 'connected' && !showUnavailable && !isAvailable) return false;
      if (!q) return true;
      return (
        cmd.name.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.args.toLowerCase().includes(q) ||
        (cmd.category && cmd.category.toLowerCase().includes(q))
      );
    }).map((cmd) => {
      const avail = availableNames.has(cmd.name);
      const evalRes = avail ? { allowed: true } : evaluateCommand(capCtx, cmd.name);
      return { cmd, avail, evalRes };
    });
  }, [query, tab, showUnavailable, availableNames, netState?.state, capCtx]);

  const handleInsert = (cmd: SlashCommandDef) => {
    close();
    navigate('/');
    useDesktopUiStore.getState().insertIntoComposer(`/${cmd.name} `);
  };

  const handleRun = async (cmd: SlashCommandDef) => {
    if (!activeBuffer) {
      useToastsStore.getState().push('Open an IRC buffer first', 'error');
      return;
    }
    close();
    await dispatchSlashCommand(`/${cmd.name}`, activeBuffer.networkId, activeBuffer.target);
  };

  return (
    <AppModal
      open={open}
      onClose={close}
      title={
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-[var(--accent)]" />
          <span>IRC Commands Reference</span>
        </div>
      }
      maxWidth="max-w-2xl"
    >
      <div className="space-y-3">
        {/* Server context banner */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-[11px] text-[var(--text-secondary)] flex flex-wrap items-center justify-between gap-2">
          <span>
            {netState?.state === 'connected' ? (
              <>
                Showing commands for <strong>{summary.softwareLabel}</strong> ·{' '}
                {summary.servicesLabel} · Modes <span className="font-mono">{summary.modesLabel}</span>{' '}
                · {summary.capsCount} CAPs
              </>
            ) : (
              'Not connected to an IRC network — showing general command catalog'
            )}
          </span>
          {netState?.state === 'connected' && (
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] text-[var(--text-muted)]">
              <input
                type="checkbox"
                checked={showUnavailable}
                onChange={(e) => setShowUnavailable(e.target.checked)}
              />
              <span>Show gated / other IRCds</span>
            </label>
          )}
        </div>

        {/* Search + category tabs */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search slash commands (e.g. /whois, topic, gline, kline)..."
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] pl-8 pr-3 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {(
              [
                ['all', 'All'],
                ['general', 'General'],
                ['channel', 'Channel'],
                ['network', 'Network'],
                ['oper', 'Oper / Services'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  tab === id
                    ? 'bg-[var(--accent)] text-white'
                    : 'border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Command list */}
        <div className="max-h-96 overflow-y-auto divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--bg-primary)]">
          {rows.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--text-muted)]">
              No matching commands found.
            </div>
          ) : (
            rows.map(({ cmd, avail, evalRes }) => {
              const isOperCmd = OPER_CATEGORIES.has(cmd.category || 'general');
              return (
                <div
                  key={cmd.name}
                  className={`flex items-start justify-between gap-3 px-3 py-2.5 text-xs ${
                    !avail && netState?.state === 'connected' ? 'opacity-60' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <code className="font-mono font-semibold text-[var(--accent)]">
                        /{cmd.name}
                      </code>
                      {cmd.args && (
                        <code className="font-mono text-[11px] text-[var(--text-secondary)]">
                          {cmd.args}
                        </code>
                      )}
                      {isOperCmd && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                          <Shield className="w-2.5 h-2.5" />
                          {cmd.category}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[var(--text-secondary)]">{cmd.description}</div>
                    {!avail && netState?.state === 'connected' && evalRes.reason && (
                      <div className="text-[10px] text-amber-400/90">{evalRes.reason}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                    {activeBuffer && avail && canRunWithoutArgs(cmd) && (
                      <button
                        type="button"
                        onClick={() => void handleRun(cmd)}
                        title={`Run /${cmd.name}`}
                        className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                      >
                        <Play className="w-3 h-3" />
                        Run
                      </button>
                    )}
                    {activeBuffer && (
                      <button
                        type="button"
                        onClick={() => handleInsert(cmd)}
                        title={`Insert /${cmd.name} into message input`}
                        className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                      >
                        <CornerDownLeft className="w-3 h-3" />
                        Use
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </AppModal>
  );
};
