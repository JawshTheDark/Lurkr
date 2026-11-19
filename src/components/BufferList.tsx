// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useMemo, useState } from 'react';
import {
  Bell,
  Bookmark,
  ChevronDown,
  ChevronRight,
  FolderUp,
  Hash,
  MessageSquare,
  Pencil,
  Pin,
  Plus,
  Search,
  Server,
  Settings,
  Shield,
  Star,
  Terminal,
  Download,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNetworksStore, canDisconnect, isNetworkOper, type Network } from '../stores/networks';
import { executeOperRaw, useOperStore } from '../stores/oper';
import { useBuffersStore, bufferKey, type Buffer } from '../stores/buffers';
import { useFavoritesStore } from '../stores/favorites';
import { usePinsStore } from '../stores/pins';
import { useDraftStore } from '../stores/drafts';
import { useHighlightsStore } from '../stores/highlights';
import { useDccStore } from '../stores/dcc';
import { useConfigStore } from '../stores/config';
import { useAuthStore } from '../stores/auth';
import { useIgnoresStore } from '../stores/ignores';
import { SYSTEM_KEY } from '../lib/virtualBuffers';
import { socketSend } from '../services/socketBus';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

interface BufferListProps {
  onOpenNetworkModal: (network?: Network) => void;
  onOpenJoinChannel: (networkId: number) => void;
  onOpenChannelList: (networkId: number) => void;
  onOpenSearch: () => void;
  onOpenUploads: () => void;
  onOpenHighlights: () => void;
  onOpenBookmarks: () => void;
  onSelectBuffer?: () => void;
}

export const BufferList: React.FC<BufferListProps> = ({
  onOpenNetworkModal,
  onOpenJoinChannel,
  onOpenChannelList,
  onOpenSearch,
  onOpenUploads,
  onOpenHighlights,
  onOpenBookmarks,
  onSelectBuffer,
}) => {
  const navigate = useNavigate();
  const networks = useNetworksStore((s) => s.networks);
  const states = useNetworksStore((s) => s.states);
  const activeKey = useNetworksStore((s) => s.activeKey);
  const buffers = useBuffersStore((s) => s.buffers);
  const favorites = useFavoritesStore((s) => s.entries);
  const pinsByNet = usePinsStore((s) => s.byNetwork);
  const drafts = useDraftStore((s) => s.drafts);
  const replies = useDraftStore((s) => s.replies);
  const highlightUnread = useHighlightsStore((s) => s.unread);
  const dccEnabled = useConfigStore((s) => s.features.dcc);
  const dccActiveCount = useDccStore((s) => s.activeCount());
  const isAdmin = useAuthStore((s) => s.isAdmin());

  const [collapsedNets, setCollapsedNets] = useState<Record<number, boolean>>({});
  const [ctx, setCtx] = useState<{
    open: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
  }>({ open: false, x: 0, y: 0, items: [] });

  const { friends, favChannels, favKeys } = useMemo(() => {
    const fKeys = new Set(favorites.map((e) => `${e.networkId}::${e.target.toLowerCase()}`));
    const secs = useFavoritesStore.getState().sections();
    return { friends: secs.friends, favChannels: secs.channels, favKeys: fKeys };
  }, [favorites, buffers]);

  const selectBuf = (networkId: number | null, target: string) => {
    useBuffersStore.getState().activate(networkId, target);
    onSelectBuffer?.();
  };

  const openNetMenu = (e: React.MouseEvent, net: Network) => {
    e.preventDefault();
    const st = states[net.id]?.state;
    const connected = canDisconnect(st);
    const items: ContextMenuItem[] = [
      {
        label: 'Join Channel…',
        disabled: st !== 'connected',
        onClick: () => onOpenJoinChannel(net.id),
      },
      {
        label: 'Channel List (/LIST)',
        disabled: st !== 'connected',
        onClick: () => onOpenChannelList(net.id),
      },
      { divider: true },
      connected
        ? {
            label: 'Disconnect',
            onClick: () => void useNetworksStore.getState().disconnect(net.id),
          }
        : {
            label: 'Connect',
            onClick: () => void useNetworksStore.getState().connect(net.id),
          },
      {
        label: 'Reconnect',
        onClick: () => void useNetworksStore.getState().reconnect(net.id),
      },
      ...(st === 'connected'
        ? isNetworkOper(states[net.id])
          ? [
              { divider: true },
              {
                label: 'Oper Control Center…',
                onClick: () => useOperStore.getState().openModal({ tab: 'bans', networkId: net.id }),
              },
              {
                label: 'Oper: Broadcast / DEFCON…',
                onClick: () =>
                  useOperStore.getState().openModal({ tab: 'broadcast', networkId: net.id }),
              },
              {
                label: 'Oper: Server & Routing…',
                onClick: () =>
                  useOperStore.getState().openModal({ tab: 'server', networkId: net.id }),
              },
              {
                label: 'Drop Oper (-o)',
                danger: true,
                onClick: () => {
                  const ownNick = states[net.id]?.nick || net.nick;
                  if (ownNick) void executeOperRaw(net.id, `MODE ${ownNick} -o`, 'Dropped IRC Operator (-o)');
                },
              },
            ]
          : [
              { divider: true },
              {
                label: 'Oper Login (/oper)…',
                onClick: () => useOperStore.getState().openModal({ tab: 'auth', networkId: net.id }),
              },
            ]
        : []),
      { divider: true },
      {
        label: 'Edit Network…',
        onClick: () => onOpenNetworkModal(net),
      },
      {
        label: 'Delete Network',
        danger: true,
        onClick: () => {
          if (window.confirm(`Delete network "${net.name}"?`)) {
            void useNetworksStore.getState().remove(net.id);
          }
        },
      },
    ];
    setCtx({ open: true, x: e.clientX, y: e.clientY, items });
  };

  const openBufMenu = (e: React.MouseEvent, buf: Buffer) => {
    e.preventDefault();
    if (buf.networkId == null) return;
    const nid = buf.networkId;
    const isFav = useFavoritesStore.getState().isFavorite(nid, buf.target);
    const isPin = usePinsStore.getState().isPinned(nid, buf.target);
    const items: ContextMenuItem[] = [];

    if (buf.kind === 'channel') {
      if (buf.joined) {
        items.push({
          label: 'Part Channel',
          onClick: () => socketSend({ type: 'part', networkId: nid, channel: buf.target }),
        });
      } else {
        items.push({
          label: 'Join Channel',
          onClick: () => useBuffersStore.getState().joinOrActivate(nid, buf.target),
        });
      }
    }

    if (buf.kind === 'channel' || buf.kind === 'dm') {
      items.push(
        isFav
          ? {
              label: 'Unfavorite',
              onClick: () => useFavoritesStore.getState().unfavorite(nid, buf.target),
            }
          : {
              label: 'Favorite',
              onClick: () => useFavoritesStore.getState().favorite(nid, buf.target),
            },
      );
      items.push(
        isPin
          ? {
              label: 'Unpin',
              onClick: () => usePinsStore.getState().unpin(nid, buf.target),
            }
          : {
              label: 'Pin to top',
              onClick: () => usePinsStore.getState().pin(nid, buf.target),
            },
      );
    }

    if (buf.kind === 'channel' && isNetworkOper(states[nid])) {
      items.push(
        { divider: true },
        {
          label: 'Oper: Force Mode (SAMODE)…',
          onClick: () =>
            useOperStore.getState().openModal({
              tab: 'users',
              networkId: nid,
              userAction: 'SAMODE',
              targetChannel: buf.target,
            }),
        },
        {
          label: 'Oper: Force Join User…',
          onClick: () =>
            useOperStore.getState().openModal({
              tab: 'users',
              networkId: nid,
              userAction: 'SAJOIN',
              targetChannel: buf.target,
            }),
        },
        {
          label: `Oper: CHANKILL ${buf.target}…`,
          danger: true,
          onClick: () =>
            useOperStore.getState().openModal({
              tab: 'services',
              networkId: nid,
              serviceName: 'OperServ',
              serviceCmd: `CHANKILL ${buf.target} `,
            }),
        },
      );
    }

    items.push(
      { divider: true },
      {
        label: 'Clear Buffer (/clear)',
        onClick: () => useBuffersStore.getState().clearBuffer(nid, buf.target),
      },
    );

    if (buf.kind !== 'server') {
      items.push({
        label: 'Close Buffer',
        danger: true,
        onClick: () =>
          socketSend({
            type: 'close-buffer',
            bufferId: buf.id,
            networkId: nid,
            target: buf.target,
          }),
      });
    }

    setCtx({ open: true, x: e.clientX, y: e.clientY, items });
  };

  const renderBufferRow = (buf: Buffer, labelOverride?: string, showNetTag?: string) => {
    const k = bufferKey(buf.networkId, buf.target);
    const isActive = activeKey === k;
    const hasDraft = !!(drafts[k] || replies[k]);
    const isPinned = buf.networkId != null && (pinsByNet[buf.networkId] || []).includes(buf.target);
    const muted =
      buf.networkId != null &&
      buf.kind === 'channel' &&
      useIgnoresStore.getState().isChannelUnreadMuted(buf.networkId, buf.target);

    return (
      <div
        key={k}
        onClick={() => selectBuf(buf.networkId, buf.target)}
        onContextMenu={(e) => openBufMenu(e, buf)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '5px 8px',
          borderRadius: '5px',
          cursor: 'pointer',
          background: isActive ? 'var(--alt-bg)' : 'transparent',
          color: isActive
            ? 'var(--fg)'
            : buf.highlighted > 0
              ? 'var(--buffer-highlight)'
              : buf.unread > 0 && !muted
                ? 'var(--buffer-unread)'
                : buf.kind === 'channel' && !buf.joined
                  ? 'var(--fg-muted)'
                  : 'var(--fg)',
          fontWeight: buf.unread > 0 && !muted ? 600 : 400,
          fontSize: '0.9em',
        }}
      >
        <span style={{ color: 'var(--fg-muted)', display: 'flex', flexShrink: 0 }}>
          {buf.kind === 'channel' ? (
            <Hash size={14} />
          ) : buf.kind === 'server' ? (
            <Server size={14} />
          ) : buf.kind === 'system' ? (
            <Terminal size={14} />
          ) : (
            <MessageSquare size={14} />
          )}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            opacity: buf.kind === 'channel' && !buf.joined ? 0.6 : 1,
          }}
        >
          {labelOverride || buf.target}
          {showNetTag && (
            <span style={{ color: 'var(--fg-muted)', fontSize: '0.8em', marginLeft: '4px' }}>
              ({showNetTag})
            </span>
          )}
        </span>
        {isPinned && <Pin size={11} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />}
        {hasDraft && <Pencil size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
        {buf.highlighted > 0 ? (
          <span
            style={{
              background: 'var(--buffer-highlight)',
              color: '#000',
              borderRadius: '10px',
              padding: '0 6px',
              fontSize: '0.75em',
              fontWeight: 700,
            }}
          >
            {buf.highlighted}
          </span>
        ) : buf.unread > 0 && !muted ? (
          <span
            style={{
              background: 'var(--alt-bg)',
              color: 'var(--buffer-unread)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              padding: '0 6px',
              fontSize: '0.75em',
            }}
          >
            {buf.unread}
          </span>
        ) : null}
      </div>
    );
  };

  const sysBuf = buffers[SYSTEM_KEY];

  return (
    <div
      className="buffer-list"
      style={{
        width: '100%',
        flex: 1,
        minHeight: 0,
        height: '100%',
        background: 'var(--bg-soft)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Top toolbar */}
      <div
        style={{
          padding: '8px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          rowGap: '4px',
          columnGap: '4px',
        }}
      >
        <strong style={{ fontSize: '1em', letterSpacing: '0.02em', flexShrink: 0 }}>Lurker</strong>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '2px',
            minWidth: 0,
          }}
        >
          <button type="button" title="Search (Ctrl+F)" onClick={onOpenSearch} className="icon-btn">
            <Search size={15} />
          </button>
          <button type="button" title="Uploads" onClick={onOpenUploads} className="icon-btn">
            <FolderUp size={15} />
          </button>
          <button
            type="button"
            title="Highlights & Activity"
            onClick={onOpenHighlights}
            className="icon-btn"
            style={{ position: 'relative' }}
          >
            <Bell size={15} />
            {highlightUnread > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '2px',
                  right: '2px',
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: 'var(--accent)',
                }}
              />
            )}
          </button>
          <button type="button" title="Bookmarks" onClick={onOpenBookmarks} className="icon-btn">
            <Bookmark size={15} />
          </button>
          {dccEnabled && (
            <button
              type="button"
              title="DCC Transfers & Files"
              onClick={() => useDccStore.getState().openModal('transfers')}
              className="icon-btn"
              style={{ position: 'relative' }}
            >
              <Download size={15} />
              {dccActiveCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: '2px',
                    right: '2px',
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    background: 'var(--good)',
                  }}
                />
              )}
            </button>
          )}
          <button type="button" title="Settings" onClick={() => navigate('/settings')} className="icon-btn">
            <Settings size={15} />
          </button>
          {isAdmin && (
            <button type="button" title="Admin" onClick={() => navigate('/admin')} className="icon-btn">
              <Shield size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable buffer tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {sysBuf && renderBufferRow(sysBuf, 'System Console')}

        {friends.length > 0 && (
          <div>
            <div style={{ fontSize: '0.72em', fontWeight: 700, color: 'var(--fg-muted)', padding: '2px 8px', textTransform: 'uppercase' }}>
              Friends
            </div>
            {friends.map((f) => {
              const b = buffers[bufferKey(f.networkId, f.target)];
              const netName = networks.find((n) => n.id === f.networkId)?.name;
              return b ? renderBufferRow(b, undefined, netName) : null;
            })}
          </div>
        )}

        {favChannels.length > 0 && (
          <div>
            <div style={{ fontSize: '0.72em', fontWeight: 700, color: 'var(--fg-muted)', padding: '2px 8px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Star size={10} /> Favorites
            </div>
            {favChannels.map((c) => {
              const b = buffers[bufferKey(c.networkId, c.target)];
              const netName = networks.find((n) => n.id === c.networkId)?.name;
              return b ? renderBufferRow(b, undefined, netName) : null;
            })}
          </div>
        )}

        {networks.map((net) => {
          const st = states[net.id]?.state;
          const collapsed = !!collapsedNets[net.id];
          const netBufs = Object.values(buffers).filter((b) => b.networkId === net.id);
          const pinned = pinsByNet[net.id] || [];

          const serverBuf = netBufs.find((b) => b.kind === 'server');
          const restBufs = netBufs
            .filter(
              (b) =>
                b.kind !== 'server' &&
                !favKeys.has(`${net.id}::${b.target.toLowerCase()}`),
            )
            .sort((a, b) => {
              const pa = pinned.indexOf(a.target);
              const pb = pinned.indexOf(b.target);
              if (pa !== -1 || pb !== -1) {
                if (pa === -1) return 1;
                if (pb === -1) return -1;
                return pa - pb;
              }
              if (a.kind !== b.kind) return a.kind === 'channel' ? -1 : 1;
              return a.target.toLowerCase().localeCompare(b.target.toLowerCase());
            });

          return (
            <div key={net.id}>
              <div
                onClick={() => setCollapsedNets((m) => ({ ...m, [net.id]: !m[net.id] }))}
                onContextMenu={(e) => openNetMenu(e, net)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '4px 6px',
                  cursor: 'pointer',
                  fontSize: '0.82em',
                  fontWeight: 700,
                  color: 'var(--fg-muted)',
                }}
              >
                {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    background:
                      st === 'connected'
                        ? 'var(--good)'
                        : st === 'connecting' || st === 'reconnecting'
                          ? 'var(--warn)'
                          : 'var(--bad)',
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg)' }}>
                  {net.name}
                </span>
                <button
                  type="button"
                  title="Join channel"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenJoinChannel(net.id);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--fg-muted)',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'flex',
                  }}
                >
                  <Plus size={13} />
                </button>
              </div>
              {!collapsed && (
                <div style={{ paddingLeft: '8px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
                  {serverBuf && renderBufferRow(serverBuf, net.name)}
                  {restBufs.map((b) => renderBufferRow(b))}
                </div>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => onOpenNetworkModal()}
          style={{
            margin: '6px',
            padding: '7px 10px',
            borderRadius: '5px',
            border: '1px dashed var(--border)',
            background: 'transparent',
            color: 'var(--fg-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            fontSize: '0.85em',
          }}
        >
          <Plus size={14} /> Add Network
        </button>
      </div>

      <ContextMenu
        open={ctx.open}
        x={ctx.x}
        y={ctx.y}
        items={ctx.items}
        onClose={() => setCtx((c) => ({ ...c, open: false }))}
      />
    </div>
  );
};
