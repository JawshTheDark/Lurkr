// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  Bookmark,
  Copy,
  MessageSquare,
  Reply,
  SmilePlus,
  Trash2,
  Upload,
} from 'lucide-react';
import { useBuffersStore, type Buffer, type BufferMessage } from '../stores/buffers';
import { useNetworksStore, tagSupport } from '../stores/networks';
import { useSettingsStore } from '../stores/settings';
import { useIgnoresStore } from '../stores/ignores';
import { useReactionsStore } from '../stores/reactions';
import { useRedactionsStore } from '../stores/redactions';
import { useBookmarksStore } from '../stores/bookmarks';
import { useRepliesStore } from '../stores/replies';
import { useThreadsStore } from '../stores/threads';
import { useUploadsStore } from '../stores/uploads';
import { useAuthStore } from '../stores/auth';
import { useRelayBotsStore } from '../stores/relayBots';
import { useWhoisStore } from '../stores/whois';
import { useDesktopUiStore } from '../stores/desktopUi';
import { socketSend } from '../services/socketBus';
import { formatTimestamp, formatDate } from '../utils/timestamp';
import { resolveThemedNickColor } from '../lib/nickTheme';
import { replyExcerpt, stripReplyAddress } from '../utils/replyText';
import { isChannelTarget } from '../shared/channels';
import { currentLayoutValue } from '../shared/settingsRenames';
import { LinkedText } from './LinkedText';
import { MessageAttachments } from './MessageAttachments';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

interface MessageListProps {
  buffer: Buffer;
  onOpenReactionPicker: (msg: BufferMessage) => void;
}

const NOISE_TYPES = new Set(['join', 'part', 'quit', 'nick', 'mode', 'chghost']);

export const MessageList: React.FC<MessageListProps> = ({ buffer, onOpenReactionPicker }) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const [showJumpBottom, setShowJumpBottom] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const settingsValues = useSettingsStore((s) => s.values);
  const reactionsByMsg = useReactionsStore((s) => s.byMessage);
  const redactionsByMsg = useRedactionsStore((s) => s.byMessage);
  const bookmarkedIds = useBookmarksStore((s) => s.bookmarkedIds);
  const relayBotsByKey = useRelayBotsStore((s) => s.byKey);
  const globalIgnores = useIgnoresStore((s) => s.global);
  const byNetworkIgnores = useIgnoresStore((s) => s.byNetwork);
  const netState = useNetworksStore((s) =>
    buffer.networkId != null ? s.states[buffer.networkId] : null,
  );
  const canUpload = useAuthStore((s) => s.canUpload());
  const [nickCtx, setNickCtx] = useState<{
    open: boolean;
    x: number;
    y: number;
    nick: string;
    relayBot?: string;
    isSelf: boolean;
  }>({ open: false, x: 0, y: 0, nick: '', isSelf: false });

  const settings = useSettingsStore.getState();
  const rawLayout = String(settings.effective('look.message.layout') || 'compact');
  const isCompactLayout =
    (currentLayoutValue(rawLayout) ?? (rawLayout === 'standard' ? 'traditional' : 'modern')) ===
    'modern';
  const showTimestamps = settings.effective('look.message.timestamps') !== false;
  const use24h = settings.effective('look.message.timestamp_24h') !== false;
  const showSeconds = settings.effective('look.message.timestamp_seconds') === true;
  const eventMode = String(settings.effective('chat.events.mode') || 'all');
  const threadsEnabled = settings.effective('chat.threads.enabled') === true;
  void settingsValues;

  const sup = tagSupport(netState);

  const { visibleMessages, nohilightIds } = useMemo(() => {
    void globalIgnores;
    void byNetworkIgnores;
    const ignores = useIgnoresStore.getState();
    const list: BufferMessage[] = [];
    const nohi = new Set<BufferMessage>();
    for (const m of buffer.messages) {
      if (!buffer.detached && buffer.clearedBeforeId > 0 && m.id != null && m.id <= buffer.clearedBeforeId) {
        continue;
      }
      if (threadsEnabled && (m as any).replyTo?.root && !(m as any).thread) {
        continue;
      }
      if (eventMode === 'none' && NOISE_TYPES.has(m.type)) continue;
      if (buffer.networkId != null) {
        const verdict = ignores.evaluate(buffer.networkId, {
          nick: m.nick || '',
          userhost: (m as any).userhost || null,
          target: buffer.target,
          text: String((m as any).text || m.body || ''),
          type: m.type,
          isDm: !isChannelTarget(buffer.target),
        });
        if (verdict.hide) continue;
        if (verdict.nohilight) nohi.add(m);
      }
      list.push(m);
    }
    return { visibleMessages: list, nohilightIds: nohi };
  }, [
    buffer.messages,
    buffer.detached,
    buffer.clearedBeforeId,
    buffer.networkId,
    buffer.target,
    eventMode,
    threadsEnabled,
    globalIgnores,
    byNetworkIgnores,
  ]);

  // Key on the newest visible row, not the row count: once a buffer is full
  // (MAX_PER_BUFFER) every live line appends one and trims one in the same
  // update, so the length never changes and the view would stop following.
  const newestVisible = visibleMessages[visibleMessages.length - 1];
  const newestVisibleKey = newestVisible?.id ?? newestVisible;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (atBottomRef.current && !buffer.detached) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visibleMessages.length, newestVisibleKey, buffer.networkId, buffer.target, buffer.detached]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = distFromBottom < 48;
    setShowJumpBottom(distFromBottom > 160 || buffer.detached);

    if (el.scrollTop < 120 && buffer.hasMoreOlder && !buffer.loadingHistory && buffer.oldestId != null) {
      useBuffersStore.getState().setLoadingHistory(buffer.networkId, buffer.target, true);
      socketSend({
        type: 'history',
        mode: 'older',
        bufferId: buffer.id,
        networkId: buffer.networkId,
        target: buffer.target,
        beforeId: buffer.oldestId,
        limit: 100,
      });
    }

    if (
      distFromBottom < 120 &&
      buffer.detached &&
      buffer.hasMoreNewer &&
      !buffer.loadingHistory &&
      buffer.newestId != null
    ) {
      useBuffersStore.getState().setLoadingHistory(buffer.networkId, buffer.target, true);
      socketSend({
        type: 'history',
        mode: 'newer',
        bufferId: buffer.id,
        networkId: buffer.networkId,
        target: buffer.target,
        afterId: buffer.newestId,
        limit: 100,
      });
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!canUpload) return;
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    try {
      await useUploadsStore.getState().upload(files[0], files[0].name, { insert: true });
    } catch {
      /* status bar shows error */
    }
  };

  const bufKeyStr =
    buffer.networkId == null ? buffer.target : `${buffer.networkId}::${buffer.target}`;

  const renderMessageText = (m: BufferMessage) => {
    const text = String((m as any).text ?? m.body ?? '');
    if (m.type === 'join') return `${m.nick} joined ${buffer.target}`;
    if (m.type === 'part') return `${m.nick} left${text ? ` (${text})` : ''}`;
    if (m.type === 'quit') return `${m.nick} quit${text ? ` (${text})` : ''}`;
    if (m.type === 'kick') return `${(m as any).kicked || ''} was kicked by ${m.nick}${text ? ` (${text})` : ''}`;
    if (m.type === 'nick') {
      const oldNick = (m as any).oldNick || m.nick || '';
      const newNick = (m as any).newNick || '';
      return `${oldNick} is now known as ${newNick}`;
    }
    if (m.type === 'topic') return `${m.nick} changed the topic to: ${(m as any).topic ?? text}`;
    if (m.type === 'mode') return `${m.nick} set mode ${text}`;
    return text;
  };

  let lastDay = '';

  return (
    <div
      style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      onDragOver={(e) => {
        if (canUpload && e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => void handleDrop(e)}
    >
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="message-list"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: isCompactLayout ? 'var(--compact-group-gap, 2px)' : '8px',
        }}
      >
        {buffer.loadingHistory && (
          <div style={{ textAlign: 'center', color: 'var(--fg-muted)', fontSize: '0.82em', padding: '6px' }}>
            Loading history…
          </div>
        )}

        {visibleMessages.length === 0 && !buffer.loadingHistory && (
          <div style={{ margin: 'auto', color: 'var(--fg-muted)', fontSize: '0.9em' }}>
            No messages yet.
          </div>
        )}

        {visibleMessages.map((m, idx) => {
          const timeStr = String((m as any).time || m.createdAt || '');
          const day = timeStr ? formatDate(timeStr) : '';
          const showDay = day && day !== lastDay;
          if (day) lastDay = day;

          const showUnread =
            buffer.dividerAfterId != null && m.id != null && m.id === buffer.dividerAfterId && idx < visibleMessages.length - 1;

          const redaction = useRedactionsStore.getState().get(m as any);
          void redactionsByMsg;
          void relayBotsByKey;
          const reactionGroups = m.id != null ? useReactionsStore.getState().groupsFor(m.id) : [];
          void reactionsByMsg;
          const isBookmarked = m.id != null && !!bookmarkedIds[Number(m.id)];
          const isSystemEvent = NOISE_TYPES.has(m.type) || m.type === 'topic' || m.type === 'motd' || m.type === 'system';

          const relayed =
            buffer.networkId != null
              ? useRelayBotsStore.getState().unwrap(buffer.networkId, {
                  type: m.type,
                  nick: m.nick,
                  self: !!(m as any).self,
                  text: String((m as any).text ?? m.body ?? ''),
                })
              : null;
          const displayNick = relayed ? relayed.nick : m.nick || '';
          const displaySelf = relayed
            ? useNetworksStore.getState().isOwnNick(buffer.networkId, relayed.nick)
            : !!(m as any).self;
          const relayBot = relayed ? m.nick : undefined;
          const relaySource = relayed ? relayed.source : null;

          const replyTo = (m as any).replyTo;
          const parentRelayed =
            replyTo?.parent && buffer.networkId != null
              ? useRelayBotsStore.getState().unwrap(buffer.networkId, replyTo.parent)
              : null;
          const parentNick = parentRelayed ? parentRelayed.nick : replyTo?.parent?.nick;
          const parentText = parentRelayed ? parentRelayed.text : replyTo?.parent?.text;

          let text = relayed ? relayed.text : renderMessageText(m);
          if (replyTo?.parent && m.type === 'message' && parentNick) {
            const stripped = stripReplyAddress(text, parentNick);
            text =
              stripped === text && parentRelayed && replyTo.parent.nick
                ? stripReplyAddress(text, replyTo.parent.nick)
                : stripped;
          }

          const threadStats = (m as any).thread;
          const isHighlight = !!(m as any).matched && !nohilightIds.has(m);
          const isAlt = idx % 2 === 1;

          return (
            <React.Fragment key={m.id ?? `local-${idx}`}>
              {showDay && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    margin: '10px 0',
                    color: 'var(--fg-muted)',
                    fontSize: '0.78em',
                  }}
                >
                  <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                  <span>{day}</span>
                  <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                </div>
              )}

              <div
                className={`msg-row ${isAlt ? 'msg-alt' : ''} ${isHighlight ? 'msg-highlight' : ''}`}
                style={{
                  position: 'relative',
                  padding: isCompactLayout ? '2px 6px' : '6px 8px',
                  borderRadius: '4px',
                  background: isHighlight
                    ? 'color-mix(in srgb, var(--buffer-highlight) 12%, transparent)'
                    : isAlt
                      ? 'var(--alt-bg)'
                      : 'transparent',
                  borderLeft: isHighlight ? '3px solid var(--buffer-highlight)' : '3px solid transparent',
                  lineHeight: isCompactLayout ? 'var(--compact-line-height, 1.4)' : '1.45',
                }}
                onMouseEnter={(e) => {
                  const actions = e.currentTarget.querySelector('.msg-hover-actions') as HTMLElement | null;
                  if (actions) actions.style.opacity = '1';
                }}
                onMouseLeave={(e) => {
                  const actions = e.currentTarget.querySelector('.msg-hover-actions') as HTMLElement | null;
                  if (actions) actions.style.opacity = '0';
                }}
              >
                {replyTo?.parent && (
                  <div
                    style={{
                      fontSize: '0.8em',
                      color: 'var(--fg-muted)',
                      paddingLeft: '8px',
                      borderLeft: '2px solid var(--border)',
                      marginBottom: '2px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    ↩ <strong>{parentNick}</strong>: {parentText}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                  {showTimestamps && timeStr && (
                    <span
                      style={{
                        color: 'var(--fg-muted)',
                        fontSize: '0.78em',
                        flexShrink: 0,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatTimestamp(
                        timeStr,
                        use24h
                          ? showSeconds
                            ? 'HH:mm:ss'
                            : 'HH:mm'
                          : showSeconds
                            ? 'h:mm:ss a'
                            : 'h:mm a',
                      )}
                    </span>
                  )}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                      {!isSystemEvent && displayNick && (
                        <span
                          role="button"
                          tabIndex={0}
                          title={relayBot ? `Relayed via ${relayBot}` : displayNick}
                          onClick={(e) => {
                            e.stopPropagation();
                            setNickCtx({
                              open: true,
                              x: e.clientX,
                              y: e.clientY,
                              nick: displayNick,
                              relayBot,
                              isSelf: displaySelf,
                            });
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setNickCtx({
                              open: true,
                              x: e.clientX,
                              y: e.clientY,
                              nick: displayNick,
                              relayBot,
                              isSelf: displaySelf,
                            });
                          }}
                          style={{
                            color: resolveThemedNickColor(displayNick, displaySelf) || undefined,
                            fontWeight: 600,
                            flexShrink: 0,
                            cursor: 'pointer',
                          }}
                        >
                          {m.type === 'action' ? `* ${displayNick}` : `<${displayNick}>`}
                        </span>
                      )}

                      <span
                        style={{
                          color: isSystemEvent
                            ? 'var(--fg-muted)'
                            : isAlt && !isHighlight
                              ? 'var(--alt-fg)'
                              : 'var(--fg)',
                          fontStyle: m.type === 'action' || redaction ? 'italic' : 'normal',
                          opacity: redaction ? 0.6 : 1,
                          wordBreak: 'break-word',
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        {relaySource && !redaction && (
                          <span
                            className="relay-via"
                            title={relayBot ? `Relayed via ${relayBot}` : undefined}
                            style={{ color: 'var(--fg-muted)', marginRight: '5px', fontSize: '0.88em' }}
                          >
                            [{relaySource}]
                          </span>
                        )}
                        {redaction ? (
                          `[message deleted by ${redaction.by}${redaction.reason ? `: ${redaction.reason}` : ''}]`
                        ) : (
                          <LinkedText text={text} networkId={buffer.networkId} />
                        )}
                      </span>
                    </div>

                    {!redaction && (m.type === 'message' || m.type === 'action') && (
                      <MessageAttachments text={text} />
                    )}

                    {(reactionGroups.length > 0 || (threadsEnabled && threadStats?.count > 0)) && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                        {reactionGroups.map((g) => (
                          <button
                            key={g.value}
                            type="button"
                            title={g.nicks.join(', ')}
                            onClick={() => {
                              if (buffer.networkId != null && m.id != null) {
                                useReactionsStore
                                  .getState()
                                  .toggle(buffer.networkId, buffer.target, Number(m.id), g.value);
                              }
                            }}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '1px 6px',
                              borderRadius: '10px',
                              border: `1px solid ${g.mine ? 'var(--accent)' : 'var(--border)'}`,
                              background: g.mine ? 'rgba(100,150,255,0.12)' : 'var(--bg-soft)',
                              color: 'var(--fg)',
                              fontSize: '0.78em',
                              cursor: 'pointer',
                            }}
                          >
                            <span>{g.value}</span>
                            <span>{g.nicks.length}</span>
                          </button>
                        ))}
                        {threadsEnabled && threadStats?.count > 0 && buffer.id != null && (m as any).msgid && (
                          <button
                            type="button"
                            onClick={() => useThreadsStore.getState().open(buffer.id!, (m as any).msgid)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '1px 8px',
                              borderRadius: '10px',
                              border: '1px solid var(--border)',
                              background: 'var(--bg-soft)',
                              color: 'var(--link)',
                              fontSize: '0.78em',
                              cursor: 'pointer',
                            }}
                          >
                            <MessageSquare size={11} />
                            {threadStats.count} {threadStats.count === 1 ? 'reply' : 'replies'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {!isSystemEvent && !redaction && m.id != null && (() => {
                  const isVirtualTarget = buffer.target.startsWith(':');
                  const keptNotice = Boolean((m as any).sentTo && (m as any).self && m.type === 'notice');
                  const canReplyRow = sup.reply && buffer.networkId != null && !isVirtualTarget;
                  const canReactRow = sup.react && !isVirtualTarget;
                  const canDeleteRow =
                    sup.redact &&
                    (m as any).self &&
                    buffer.networkId != null &&
                    (m.type === 'message' || m.type === 'action' || m.type === 'notice') &&
                    (!isVirtualTarget || keptNotice);
                  return (
                  <div
                    className="msg-hover-actions"
                    style={{
                      position: 'absolute',
                      top: '-10px',
                      right: '8px',
                      opacity: 0,
                      transition: 'opacity 0.12s',
                      display: 'flex',
                      gap: '2px',
                      background: 'var(--bg-soft)',
                      border: '1px solid var(--border)',
                      borderRadius: '5px',
                      padding: '2px',
                    }}
                  >
                    {canReplyRow && (
                      <button
                        type="button"
                        title="Reply"
                        className="icon-btn"
                        onClick={() =>
                          useRepliesStore.getState().start(bufKeyStr, {
                            messageId: Number(m.id),
                            nick: displayNick,
                            type: m.type,
                            text: replyExcerpt(text),
                            self: displaySelf,
                          })
                        }
                      >
                        <Reply size={13} />
                      </button>
                    )}
                    {canReactRow && (
                      <button
                        type="button"
                        title="Add reaction"
                        className="icon-btn"
                        onClick={() => onOpenReactionPicker(m)}
                      >
                        <SmilePlus size={13} />
                      </button>
                    )}
                    {threadsEnabled && !isVirtualTarget && buffer.id != null && (m as any).msgid && (
                      <button
                        type="button"
                        title="Open thread"
                        className="icon-btn"
                        onClick={() => {
                          useThreadsStore.getState().setWantComposer(true);
                          useThreadsStore.getState().open(buffer.id!, (m as any).msgid);
                        }}
                      >
                        <MessageSquare size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
                      className="icon-btn"
                      style={{ color: isBookmarked ? 'var(--accent)' : undefined }}
                      onClick={() => void useBookmarksStore.getState().toggle(Number(m.id))}
                    >
                      <Bookmark size={13} fill={isBookmarked ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      type="button"
                      title="Copy text"
                      className="icon-btn"
                      onClick={() => void navigator.clipboard.writeText(text)}
                    >
                      <Copy size={13} />
                    </button>
                    {canDeleteRow && (
                      <button
                        type="button"
                        title="Delete message"
                        className="icon-btn"
                        style={{ color: 'var(--bad)' }}
                        onClick={() =>
                          socketSend({
                            type: 'redact',
                            networkId: buffer.networkId,
                            target: (m as any).sentTo?.target || buffer.target,
                            messageId: Number(m.id),
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  );
                })()}
              </div>

              {showUnread && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    margin: '6px 0',
                    color: 'var(--bad)',
                    fontSize: '0.75em',
                    fontWeight: 600,
                  }}
                >
                  <div style={{ flex: 1, height: '1px', background: 'var(--bad)' }} />
                  <span>New messages</span>
                  <div style={{ flex: 1, height: '1px', background: 'var(--bad)' }} />
                </div>
              )}
            </React.Fragment>
          );
        })}

        {!buffer.detached &&
          (netState?.sendPending ?? [])
            .filter((p) => p.target.toLowerCase() === buffer.target.toLowerCase())
            .map((p) => (
              <div
                key={`pending-${p.id}`}
                style={{
                  padding: isCompactLayout ? '2px 6px' : '6px 8px',
                  opacity: 0.55,
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '8px',
                  fontStyle: p.kind === 'action' ? 'italic' : 'normal',
                }}
              >
                {showTimestamps && p.at && (
                  <span style={{ color: 'var(--fg-muted)', fontSize: '0.78em', flexShrink: 0 }}>
                    {formatTimestamp(
                      p.at,
                      use24h ? (showSeconds ? 'HH:mm:ss' : 'HH:mm') : showSeconds ? 'h:mm:ss a' : 'h:mm a',
                    )}
                  </span>
                )}
                <span style={{ color: resolveThemedNickColor(netState?.nick || '', true) || undefined, fontWeight: 600 }}>
                  {p.kind === 'action' ? `* ${netState?.nick || 'you'}` : `<${netState?.nick || 'you'}>`}
                </span>
                <span style={{ color: 'var(--fg)', wordBreak: 'break-word', flex: 1, minWidth: 0 }}>
                  {p.text}
                </span>
                <span style={{ fontSize: '0.75em', color: 'var(--fg-muted)', flexShrink: 0 }}>
                  sending…
                </span>
              </div>
            ))}
      </div>

      <ContextMenu
        open={nickCtx.open}
        x={nickCtx.x}
        y={nickCtx.y}
        onClose={() => setNickCtx((c) => ({ ...c, open: false }))}
        items={(() => {
          if (!nickCtx.open || !nickCtx.nick) return [];
          const nid = buffer.networkId;
          const items: ContextMenuItem[] = [
            {
              label: `Reply / Address ${nickCtx.nick}`,
              onClick: () =>
                useDesktopUiStore.getState().insertIntoComposer(`${nickCtx.nick}: `),
            },
            {
              label: 'Copy Nickname',
              onClick: () => {
                void navigator.clipboard?.writeText(nickCtx.nick).catch(() => {});
              },
            },
          ];

          if (nickCtx.relayBot && nid != null) {
            const innerMarked = useRelayBotsStore.getState().isRelay(nid, nickCtx.nick);
            const outerMarked = useRelayBotsStore.getState().isRelay(nid, nickCtx.relayBot);
            items.push(
              { divider: true },
              {
                label: innerMarked ? `Unmark relay bot (${nickCtx.nick})` : 'Mark relay bot',
                onClick: () =>
                  useRelayBotsStore.getState().setRelay(nid, nickCtx.nick, !innerMarked),
              },
              {
                label: outerMarked
                  ? `Unmark ${nickCtx.relayBot} as relay bot`
                  : `Mark ${nickCtx.relayBot} as relay bot`,
                onClick: () =>
                  useRelayBotsStore.getState().setRelay(nid, nickCtx.relayBot!, !outerMarked),
              },
              {
                label: `View Bot Profile (${nickCtx.relayBot})…`,
                onClick: () => useWhoisStore.getState().request(nid, nickCtx.relayBot!),
              },
            );
          } else if (nid != null) {
            if (!nickCtx.isSelf) {
              items.push({
                label: 'Open DM',
                onClick: () => useBuffersStore.getState().openDm(nid, nickCtx.nick),
              });
            }
            items.push({
              label: 'Whois…',
              onClick: () => useWhoisStore.getState().request(nid, nickCtx.nick),
            });
            if (!nickCtx.isSelf) {
              const marked = useRelayBotsStore.getState().isRelay(nid, nickCtx.nick);
              items.push(
                { divider: true },
                {
                  label: marked ? 'Unmark relay bot' : 'Mark as relay bot',
                  onClick: () =>
                    useRelayBotsStore.getState().setRelay(nid, nickCtx.nick, !marked),
                },
                {
                  label: 'Ignore',
                  danger: true,
                  onClick: () =>
                    useIgnoresStore
                      .getState()
                      .add({ networkId: nid, mask: `${nickCtx.nick}!*@*`, levels: ['ALL'] }),
                },
              );
            }
          }
          return items;
        })()}
      />

      {showJumpBottom && (
        <button
          type="button"
          onClick={() => {
            if (buffer.detached) {
              useBuffersStore.getState().reattachToLive(buffer.networkId, buffer.target);
            } else if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
          }}
          style={{
            position: 'absolute',
            bottom: '14px',
            right: '18px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            background: 'var(--bg-soft)',
            color: 'var(--accent)',
            fontWeight: 600,
            fontSize: '0.82em',
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <ArrowDown size={14} />
          {buffer.detached
            ? `Return to present${buffer.liveDuringDetach > 0 ? ` (${buffer.liveDuringDetach})` : ''}`
            : 'Jump to bottom'}
        </button>
      )}

      {dragOver && (
        <div
          style={{
            position: 'absolute',
            inset: '8px',
            background: 'rgba(0,0,0,0.7)',
            border: '2px dashed var(--accent)',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            color: 'var(--accent)',
            pointerEvents: 'none',
            zIndex: 20,
          }}
        >
          <Upload size={32} />
          <strong>Drop file to upload &amp; insert link</strong>
        </div>
      )}
    </div>
  );
};
