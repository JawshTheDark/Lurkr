// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useBuffersStore, type BufferMember } from '../stores/buffers';
import { isNetworkOper, useNetworksStore } from '../stores/networks';
import { executeOperRaw, useOperStore } from '../stores/oper';
import { hasRankAtLeast } from '../shared/channelModes';
import {
  buildCapabilityContext,
  evaluateCommand,
  prefixIncludes,
} from '../lib/networkCapabilities';
import { useNickNotesStore } from '../stores/nickNotes';
import { useIgnoresStore } from '../stores/ignores';
import { useWhoisStore } from '../stores/whois';
import { useRelayBotsStore } from '../stores/relayBots';
import { useDccStore } from '../stores/dcc';
import { useConfigStore } from '../stores/config';
import { socketSend } from '../services/socketBus';
import { resolveThemedNickColor } from '../lib/nickTheme';
import { prefixOf } from '../utils/memberPrefix';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

const EMPTY_NICK_NOTES: Record<string, string> = {};

interface MemberListProps {
  networkId: number;
  target: string;
}

export const MemberList: React.FC<MemberListProps> = ({ networkId, target }) => {
  const buf = useBuffersStore((s) => {
    const exact = s.buffers[`${networkId}::${target}`];
    if (exact) return exact;
    const lowerTarget = target.toLowerCase();
    for (const b of Object.values(s.buffers)) {
      if (b.networkId === networkId && b.target.toLowerCase() === lowerTarget) {
        return b;
      }
    }
    return undefined;
  });

  useEffect(() => {
    if (buf?.kind === 'channel' && buf.joined && buf.membersKnown !== 'full') {
      useBuffersStore.getState().ensureMembers(networkId, buf.target);
    }
  }, [networkId, buf?.target, buf?.kind, buf?.joined, buf?.membersKnown]);
  const prefixModes = useNetworksStore((s) => s.prefixFor(networkId));
  const netState = useNetworksStore((s) => s.states[networkId]);
  const profile = useNetworksStore((s) => s.profiles[networkId]);
  const network = useNetworksStore((s) => s.networkById(networkId));
  const ownNick = netState?.nick || network?.nick || '';
  const isOper = isNetworkOper(netState);
  const dccEnabled = useConfigStore((s) => s.features.dcc);
  const nickNotes = useNickNotesStore((s) => s.byNetwork[networkId] ?? EMPTY_NICK_NOTES);
  const relayBotsByKey = useRelayBotsStore((s) => s.byKey);
  const [filter, setFilter] = useState('');
  const [ctx, setCtx] = useState<{ open: boolean; x: number; y: number; member: BufferMember | null }>({
    open: false,
    x: 0,
    y: 0,
    member: null,
  });

  const sortedMembers = useMemo(() => {
    if (!buf?.members) return [];
    const ignores = useIgnoresStore.getState();
    const q = filter.trim().toLowerCase();
    const rankOf = (m: BufferMember) => {
      for (let i = 0; i < prefixModes.length; i++) {
        if (m.modes?.includes(prefixModes[i].mode)) return i;
      }
      return prefixModes.length;
    };
    return buf.members
      .filter((m) => {
        if (ignores.isMemberIgnored(networkId, target, { nick: m.nick, userhost: m.user && m.host ? `${m.user}@${m.host}` : null })) {
          return false;
        }
        return !q || m.nick.toLowerCase().includes(q);
      })
      .slice()
      .sort((a, b) => {
        const ra = rankOf(a);
        const rb = rankOf(b);
        if (ra !== rb) return ra - rb;
        return a.nick.toLowerCase().localeCompare(b.nick.toLowerCase());
      });
  }, [buf?.members, filter, networkId, target, prefixModes]);

  const contextItems = (): ContextMenuItem[] => {
    const m = ctx.member;
    if (!m) return [];
    const isSelf = !!ownNick && m.nick.toLowerCase() === ownNick.toLowerCase();
    const selfMember = ownNick
      ? buf?.members?.find((bm) => bm.nick.toLowerCase() === ownNick.toLowerCase())
      : undefined;
    const selfModes = selfMember?.modes || [];
    const targetModes = m.modes || [];
    const capCtx = buildCapabilityContext(netState, profile, {
      target,
      selfChannelModes: selfModes,
      channelModes: buf?.modes || [],
    });
    const listModes = capCtx.modeSpec.list || 'beI';

    const items: ContextMenuItem[] = [
      {
        label: 'Open DM',
        onClick: () => useBuffersStore.getState().openDm(networkId, m.nick),
      },
      {
        label: 'Whois',
        onClick: () => useWhoisStore.getState().request(networkId, m.nick),
      },
    ];

    // Channel moderation actions (require channel prefix rank & network PREFIX support)
    if (!isSelf) {
      const modItems: ContextMenuItem[] = [];
      const addPrefixToggle = (mode: string, posLabel: string, negLabel: string, reqRank: string) => {
        if (!prefixIncludes(prefixModes, mode)) return;
        if (!hasRankAtLeast(selfModes, prefixModes, reqRank)) return;
        const hasMode = targetModes.includes(mode);
        const sign = hasMode ? '-' : '+';
        modItems.push({
          label: hasMode ? negLabel : posLabel,
          onClick: () =>
            socketSend({ type: 'raw', networkId, line: `MODE ${target} ${sign}${mode} ${m.nick}` }),
        });
      };

      addPrefixToggle('q', 'Owner (+q)', 'Remove Owner (-q)', 'q');
      addPrefixToggle('a', 'Admin (+a)', 'Remove Admin (-a)', 'q');
      addPrefixToggle('o', 'Op (+o)', 'Deop (-o)', 'o');
      addPrefixToggle('h', 'Halfop (+h)', 'Dehalfop (-h)', 'o');
      addPrefixToggle('v', 'Voice (+v)', 'Devoice (-v)', 'h');

      const banMask = m.host ? `*!*@${m.host}` : `${m.nick}!*@*`;
      if (hasRankAtLeast(selfModes, prefixModes, 'h')) {
        if (listModes.includes('b')) {
          modItems.push({
            label: `Ban (+b ${banMask})`,
            onClick: () => socketSend({ type: 'raw', networkId, line: `MODE ${target} +b ${banMask}` }),
          });
        }
        modItems.push({
          label: 'Kick',
          danger: true,
          onClick: () => socketSend({ type: 'raw', networkId, line: `KICK ${target} ${m.nick}` }),
        });
        if (listModes.includes('b')) {
          modItems.push({
            label: 'Kickban',
            danger: true,
            onClick: () => {
              socketSend({ type: 'raw', networkId, line: `MODE ${target} +b ${banMask}` });
              socketSend({ type: 'raw', networkId, line: `KICK ${target} ${m.nick}` });
            },
          });
        }
      }

      if (modItems.length > 0) {
        items.push({ divider: true }, ...modItems);
      }
    }

    if (!isSelf) {
      const markedRelay = !!relayBotsByKey[`${networkId}::${m.nick.toLowerCase()}`];
      items.push(
        { divider: true },
        {
          label: markedRelay ? 'Unmark relay bot' : 'Mark as relay bot',
          onClick: () => useRelayBotsStore.getState().setRelay(networkId, m.nick, !markedRelay),
        },
        {
          label: 'Ignore',
          danger: true,
          onClick: () =>
            useIgnoresStore.getState().add({ networkId, mask: `${m.nick}!*@*`, levels: ['ALL'] }),
        },
      );
    }

    // IRC Operator actions gated by IRCd software, CAPs, and oper modes
    if (isOper && !isSelf) {
      const can = (cmd: string) => evaluateCommand(capCtx, cmd).allowed;
      const banMask = m.host ? `*!*@${m.host}` : `${m.nick}!*@*`;
      const operItems: ContextMenuItem[] = [];

      const forceCmd = can('SAMODE') ? 'SAMODE' : can('OMODE') ? 'OMODE' : null;
      if (forceCmd && !hasRankAtLeast(selfModes, prefixModes, 'o') && prefixIncludes(prefixModes, 'o')) {
        const hasOp = targetModes.includes('o');
        operItems.push({
          label: hasOp ? `Oper: Force Deop (${forceCmd} -o)` : `Oper: Force Op (${forceCmd} +o)`,
          onClick: () =>
            void executeOperRaw(networkId, `${forceCmd} ${target} ${hasOp ? '-' : '+'}o ${m.nick}`),
        });
      }
      if (can('SAJOIN')) {
        operItems.push({
          label: 'Oper: Force Join (SAJOIN)…',
          onClick: () =>
            useOperStore.getState().openModal({
              tab: 'users',
              networkId,
              userAction: 'SAJOIN',
              targetNick: m.nick,
              targetChannel: target,
            }),
        });
      }
      if (can('SAPART')) {
        operItems.push({
          label: `Oper: Force Part (${target})`,
          onClick: () => void executeOperRaw(networkId, `SAPART ${m.nick} ${target}`),
        });
      }
      if (can('SANICK')) {
        operItems.push({
          label: 'Oper: Force Nick (SANICK)…',
          onClick: () =>
            useOperStore.getState().openModal({
              tab: 'users',
              networkId,
              userAction: 'SANICK',
              targetNick: m.nick,
            }),
        });
      }
      if (can('CHGHOST')) {
        operItems.push({
          label: 'Oper: ChgHost / ChgIdent…',
          onClick: () =>
            useOperStore.getState().openModal({
              tab: 'users',
              networkId,
              userAction: 'CHGHOST',
              targetNick: m.nick,
            }),
        });
      }
      if (can('TEMPSHUN')) {
        operItems.push({
          label: 'Oper: Tempshun…',
          onClick: () =>
            useOperStore.getState().openModal({
              tab: 'bans',
              networkId,
              banType: 'TEMPSHUN',
              banMask: m.nick,
            }),
        });
      }
      if (can('UBAN')) {
        operItems.push({
          label: 'Oper: Unified Ban (UBAN)…',
          danger: true,
          onClick: () =>
            useOperStore.getState().openModal({
              tab: 'bans',
              networkId,
              banType: 'UBAN ADD',
              banMask: m.account ? m.account : banMask,
            }),
        });
      }
      if (can('DLINE') && m.host) {
        operItems.push({
          label: 'Oper: D-Line IP/Host…',
          danger: true,
          onClick: () =>
            useOperStore.getState().openModal({
              tab: 'bans',
              networkId,
              banType: 'DLINE',
              banMask: m.host ?? undefined,
            }),
        });
      }
      if (can('GLINE')) {
        operItems.push({
          label: 'Oper: G-Line / Ban…',
          danger: true,
          onClick: () =>
            useOperStore.getState().openModal({
              tab: 'bans',
              networkId,
              banType: 'GLINE',
              banMask,
            }),
        });
      } else if (can('KLINE')) {
        operItems.push({
          label: 'Oper: K-Line User@Host…',
          danger: true,
          onClick: () =>
            useOperStore.getState().openModal({
              tab: 'bans',
              networkId,
              banType: 'KLINE',
              banMask,
            }),
        });
      }
      if (can('KILL')) {
        operItems.push({
          label: 'Oper: Kill User…',
          danger: true,
          onClick: () =>
            useOperStore.getState().openModal({
              tab: 'users',
              networkId,
              userAction: 'KILL',
              targetNick: m.nick,
            }),
        });
      }

      if (operItems.length > 0) {
        items.push({ divider: true }, ...operItems);
      }
    }

    if (dccEnabled && !isSelf) {
      items.push(
        { divider: true },
        {
          label: 'DCC Send File…',
          onClick: () =>
            useDccStore.getState().openModal('files', { networkId, nick: m.nick, passive: false }),
        },
        {
          label: 'DCC Chat',
          onClick: () =>
            void useDccStore.getState().openChat({ networkId, nick: m.nick }),
        },
      );
    }
    return items;
  };

  if (!buf) return null;

  return (
    <aside
      className="member-list"
      style={{
        width: '210px',
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-soft)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <div style={{ fontSize: '0.8em', color: 'var(--fg-muted)', fontWeight: 600 }}>
          {buf.membersKnown === 'none'
            ? 'Loading members…'
            : `${sortedMembers.length} ${sortedMembers.length === 1 ? 'member' : 'members'}`}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            padding: '3px 6px',
          }}
        >
          <Search size={12} style={{ color: 'var(--fg-muted)' }} />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--fg)',
              fontSize: '0.82em',
              outline: 'none',
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px' }}>
        {sortedMembers.map((m) => {
          const prefix = prefixOf(m.modes || [], prefixModes);
          const note = nickNotes[m.nick.toLowerCase()];
          const isRelay = !!relayBotsByKey[`${networkId}::${m.nick.toLowerCase()}`];
          return (
            <div
              key={m.nick}
              onDoubleClick={() => useBuffersStore.getState().openDm(networkId, m.nick)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtx({ open: true, x: e.clientX, y: e.clientY, member: m });
              }}
              title={
                note
                  ? `${m.nick} — ${note}${isRelay ? ' (Relay bot)' : ''}`
                  : isRelay
                    ? `${m.nick} (Relay bot)`
                    : m.nick
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 6px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.88em',
                opacity: m.away ? 0.55 : 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--alt-bg)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              {prefix && (
                <span style={{ color: 'var(--fg-muted)', fontWeight: 700, width: '1ch' }}>
                  {prefix}
                </span>
              )}
              <span
                style={{
                  color:
                    resolveThemedNickColor(
                      m.nick,
                      Boolean(ownNick && m.nick.toLowerCase() === ownNick.toLowerCase()),
                    ) || undefined,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {m.nick}
              </span>
              {isRelay && (
                <span
                  style={{
                    fontSize: '0.72em',
                    color: 'var(--accent)',
                    border: '1px solid var(--border)',
                    borderRadius: '3px',
                    padding: '0 4px',
                    flexShrink: 0,
                  }}
                >
                  relay
                </span>
              )}
            </div>
          );
        })}
      </div>

      <ContextMenu
        open={ctx.open}
        x={ctx.x}
        y={ctx.y}
        items={contextItems()}
        onClose={() => setCtx((c) => ({ ...c, open: false }))}
      />
    </aside>
  );
};
