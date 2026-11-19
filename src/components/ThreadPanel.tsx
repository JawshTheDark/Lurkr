// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React from 'react';
import { X, MessageSquare, ArrowLeft, Bell, BellOff, Loader2 } from 'lucide-react';
import { useThreadsStore } from '../stores/threads';
import { useBuffersStore } from '../stores/buffers';
import { socketSend } from '../services/socketBus';
import { LinkedText } from './LinkedText';
import { MessageAttachments } from './MessageAttachments';
import { MessageInput } from './MessageInput';
import { formatTime } from '../utils/timestamp';
import { resolveThemedNickColor } from '../lib/nickTheme';

interface ThreadPanelProps {
  onOpenUploadsModal?: () => void;
}

export const ThreadPanel: React.FC<ThreadPanelProps> = ({ onOpenUploadsModal }) => {
  const view = useThreadsStore((s) => s.view);
  const list = useThreadsStore((s) => s.list);
  const wantComposer = useThreadsStore((s) => s.wantComposer);
  const followedFor = useThreadsStore((s) => s.followedFor);

  if (!view && !list) return null;

  // Thread List Drawer
  if (!view && list) {
    const buf = Object.values(useBuffersStore.getState().buffers).find(
      (b) => b.id === list.bufferId,
    );
    return (
      <aside className="flex h-full w-80 sm:w-96 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare className="w-4 h-4 text-[var(--accent)] shrink-0" />
            <span className="font-semibold text-sm truncate text-[var(--text-primary)]">
              Threads {buf ? `in ${buf.target}` : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={() => useThreadsStore.getState().closeList()}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {list.loading && (
            <div className="flex items-center justify-center py-8 text-xs text-[var(--text-muted)] gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading threads...
            </div>
          )}
          {!list.loading && list.threads.length === 0 && (
            <div className="py-8 text-center text-xs text-[var(--text-muted)]">
              No active threads in this buffer yet.
            </div>
          )}
          {list.threads.map((t: any) => (
            <button
              key={t.rootMsgid}
              type="button"
              onClick={() => useThreadsStore.getState().open(list.bufferId, t.rootMsgid)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-2.5 text-left hover:border-[var(--accent)] transition-colors"
            >
              <div className="flex items-center justify-between gap-2 text-xs mb-1">
                <span className="font-semibold text-[var(--text-primary)]">
                  {t.root?.nick || t.rootNick || 'Unknown'}
                </span>
                <span className="text-[var(--text-muted)]">
                  {t.count ?? t.replyCount ?? 0} {(t.count ?? t.replyCount ?? 0) === 1 ? 'reply' : 'replies'}
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] line-clamp-2">
                {t.root?.text || t.rootText || '(message)'}
              </p>
            </button>
          ))}
        </div>
      </aside>
    );
  }

  if (!view) return null;

  const isFollowed = !!followedFor(view.bufferId, view.rootMsgid);

  return (
    <aside className="flex h-full w-80 sm:w-96 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-secondary)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          {list && (
            <button
              type="button"
              onClick={() => useThreadsStore.getState().close()}
              className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              title="Back to threads"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <MessageSquare className="w-4 h-4 text-[var(--accent)] shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate text-[var(--text-primary)]">
              Thread
            </div>
            <div className="text-[11px] truncate text-[var(--text-muted)]">
              {view.target}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              socketSend({
                type: isFollowed ? 'thread-unfollow' : 'thread-follow',
                bufferId: view.bufferId,
                rootMsgid: view.rootMsgid,
              });
            }}
            className={`rounded p-1.5 text-xs ${
              isFollowed
                ? 'text-[var(--accent)] bg-[var(--accent)]/10'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            }`}
            title={isFollowed ? 'Unfollow thread' : 'Follow thread'}
          >
            {isFollowed ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => useThreadsStore.getState().close()}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {view.loading && (
          <div className="flex items-center justify-center py-8 text-xs text-[var(--text-muted)] gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading thread...
          </div>
        )}

        {view.root && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-2.5">
            <div className="flex items-center justify-between gap-2 text-xs mb-1">
              <span
                className="font-semibold"
                style={{ color: resolveThemedNickColor(view.root.nick || '') || undefined }}
              >
                {view.root.nick}
              </span>
              {view.root.time && (
                <span className="text-[11px] text-[var(--text-muted)]">
                  {formatTime(view.root.time)}
                </span>
              )}
            </div>
            <div className="text-sm text-[var(--text-primary)] break-words">
              <LinkedText text={view.root.text || ''} />
            </div>
            <MessageAttachments text={view.root.text || ''} />
          </div>
        )}

        {view.truncated && (
          <div className="text-center text-[11px] text-[var(--text-muted)] py-1">
            Older replies truncated
          </div>
        )}

        <div className="space-y-2.5">
          {view.replies.map((msg) => (
            <div key={msg.id} className="text-sm">
              <div className="flex items-baseline gap-2">
                <span
                  className="font-semibold text-xs"
                  style={{ color: resolveThemedNickColor(msg.nick || '') || undefined }}
                >
                  {msg.nick}
                </span>
                {msg.time && (
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {formatTime(msg.time)}
                  </span>
                )}
              </div>
              <div className="text-[var(--text-primary)] break-words pl-0.5">
                <LinkedText text={msg.text || ''} />
              </div>
              <MessageAttachments text={msg.text || ''} />
            </div>
          ))}
        </div>
      </div>

      <MessageInput
        networkId={view.networkId}
        target={view.target}
        threadRootMsgid={view.rootMsgid}
        threadRootMessageId={view.root?.id ?? null}
        placeholder="Reply in thread..."
        onOpenUploadsModal={onOpenUploadsModal}
        autoFocus={wantComposer}
      />
    </aside>
  );
};
