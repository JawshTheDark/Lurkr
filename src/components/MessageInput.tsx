// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Paperclip,
  Palette,
  Send,
  X,
  Star,
  Clock,
  FolderOpen,
  Upload,
  CornerUpLeft,
  Loader2,
} from 'lucide-react';
import { useBuffersStore, bufferKey } from '../stores/buffers';
import { useNetworksStore } from '../stores/networks';
import { useDraftStore } from '../stores/drafts';
import { useRepliesStore } from '../stores/replies';
import { useUploadsStore, onInsertUrl } from '../stores/uploads';
import { useAuthStore } from '../stores/auth';
import { useIgnoresStore } from '../stores/ignores';
import { useInputHistoryStore } from '../stores/inputHistory';
import { useRecentBuffersStore } from '../stores/recentBuffers';
import { useSettingsStore } from '../stores/settings';
import { useToastsStore } from '../stores/toasts';
import { useDesktopUiStore } from '../stores/desktopUi';
import { useAliasesStore } from '../stores/aliases';
import { socketSend, socketSendWithAck } from '../services/socketBus';
import { dispatchSlashCommand, SLASH_COMMANDS } from '../lib/commands/dispatch';
import { usageHint, usageVerb, type UsageHint } from '../lib/commands/usageHint';
import { isChannelTarget } from '../shared/channels';
import {
  buildCapabilityContext,
  getAvailableSlashCommands,
} from '../lib/networkCapabilities';
import { buildNickCandidates } from '../utils/nickCompletion';
import { buildChannelCandidates } from '../utils/channelCompletion';
import {
  findActiveShortcode,
  findCompletedShortcode,
  loadEmoji,
  rankShortcodes,
} from '../utils/emojiShortcodes';
import { insertWithPadding } from '../utils/insertAtCaret';
import { byteLen, chunkCountForSay, textBudgetFor } from '../utils/messageSplit';
import { ACCEPTED_FILE_TYPES, ensureUploadFilename, pastedUploadFiles } from '../utils/uploaders';
import {
  IRC_BOLD,
  IRC_ITALIC,
  IRC_UNDERLINE,
  IRC_STRIKE,
  IRC_REVERSE,
  IRC_COLOR,
  IRC_RESET,
  applyIrcControlAtSelection,
  formatMircColorCode,
  hasIrcFormatting,
  stripIrcFormatting,
} from '../utils/mircFormat';
import { applySpoilerMarkup } from '../utils/spoilerMarkup';
import { LongMessageUploadModal } from './LongMessageUploadModal';
import { TypingIndicator } from './TypingIndicator';
import { MircFormatPopover } from './MircFormatPopover';
import { LinkedText } from './LinkedText';

interface MessageInputProps {
  networkId: number;
  target: string;
  replyKey?: string;
  threadRootMsgid?: string;
  threadRootMessageId?: number | null;
  placeholder?: string;
  onOpenUploadsModal?: () => void;
  onSent?: () => void;
  autoFocus?: boolean;
}

type SuggestItem =
  | { kind: 'command'; label: string; detail: string; insert: string }
  | { kind: 'emoji'; label: string; detail: string; insert: string; start: number; end: number }
  | { kind: 'nick'; label: string; detail?: string; insert: string; start: number; end: number };

export const MessageInput: React.FC<MessageInputProps> = ({
  networkId,
  target,
  replyKey: replyKeyProp,
  threadRootMsgid,
  threadRootMessageId,
  placeholder,
  onOpenUploadsModal,
  onSent,
  autoFocus,
}) => {
  const bKey = bufferKey(networkId, target);
  const replyKey = replyKeyProp ?? bKey;
  const isServerBuffer = target.startsWith(':server:');

  const buffer = useBuffersStore((s) => s.buffers[bKey]);
  const network = useNetworksStore((s) => s.networks.find((n) => n.id === networkId));
  const netState = useNetworksStore((s) => s.states[networkId]);
  const serverProfile = useNetworksStore((s) => s.profiles[networkId]);
  const reply = useDraftStore((s) => (replyKey ? (s.replies[replyKey] ?? null) : null));
  const draft = useDraftStore((s) => s.drafts[bKey] ?? '');

  const authUser = useAuthStore((s) => s.user);
  const canUpload = useAuthStore((s) => s.canUpload());
  const uploadsOffTitle = useAuthStore((s) => s.uploadsOffTitle());
  const isPaused = useAuthStore((s) => s.isPaused());

  const uploadCurrent = useUploadsStore((s) => s.current);
  const [menuOpen, setMenuOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const menuMode = useUploadsStore((s) => s.menuMode);
  const menuItems = useUploadsStore((s) => s.menuItems);
  const menuLoading = useUploadsStore((s) => s.menuLoading);
  const menuError = useUploadsStore((s) => s.menuError);

  const isMemberIgnored = useIgnoresStore((s) => s.isMemberIgnored);
  const isIgnored = useCallback(
    (nick: string, userhost?: string | null) =>
      isMemberIgnored(networkId, target, { nick, userhost }),
    [isMemberIgnored, networkId, target],
  );
  const recentRank = useRecentBuffersStore((s) => s.rank);
  const aliases = useAliasesStore((s) => s.aliases);
  const enterSends = useSettingsStore((s: any) => s.values.enterSends !== false);
  const historyIdxRef = useRef<number>(-1);

  const [text, setText] = useState(draft);
  const [caretPos, setCaretPos] = useState(draft.length);
  const [usageDismissedFor, setUsageDismissedFor] = useState<string | null>(null);
  const textRef = useRef(text);
  const [dragOver, setDragOver] = useState(false);
  const [longModalOpen, setLongModalOpen] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<
    Array<{
      id: number;
      filename: string;
      previewUrl: string | null;
      status: 'uploading' | 'error';
      error?: string;
    }>
  >([]);
  const [sendWhenUploaded, setSendWhenUploaded] = useState(false);
  const activeUploadsRef = useRef<Map<number, Promise<boolean>>>(new Map());
  const removedUploadIdsRef = useRef<Set<number>>(new Set());
  const nextPendingUploadIdRef = useRef(1);
  const sendWhenUploadedRef = useRef(false);
  const previewUrlsRef = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    removedUploadIdsRef.current.clear();
    activeUploadsRef.current.clear();
    if (typeof URL.revokeObjectURL === 'function') {
      for (const url of previewUrlsRef.current.values()) URL.revokeObjectURL(url);
    }
    previewUrlsRef.current.clear();
    sendWhenUploadedRef.current = false;
    setSendWhenUploaded(false);
    setPendingUploads([]);
  }, [bKey]);

  useEffect(() => {
    return () => {
      if (typeof URL.revokeObjectURL === 'function') {
        for (const url of previewUrlsRef.current.values()) URL.revokeObjectURL(url);
      }
      previewUrlsRef.current.clear();
    };
  }, []);
  const [pendingLongText, setPendingLongText] = useState('');
  const [suggestIdx, setSuggestIdx] = useState(0);
  const [emojiTable, setEmojiTable] = useState<Record<string, string> | null>(null);
  const [emojiNames, setEmojiNames] = useState<string[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const attachBtnRef = useRef<HTMLButtonElement>(null);
  const formatRef = useRef<HTMLDivElement>(null);
  const formatBtnRef = useRef<HTMLButtonElement>(null);
  const lastTypingSentRef = useRef<number>(0);
  const typingPhaseRef = useRef<'none' | 'active' | 'paused'>('none');
  const typingPauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const netStateRef = useRef(netState?.state);
  netStateRef.current = netState?.state;

  // Tab completion cycling state
  const tabStateRef = useRef<{
    candidates: string[];
    index: number;
    start: number;
    end: number;
    isStartOfLine: boolean;
  } | null>(null);

  // Sync draft when switching buffers
  useEffect(() => {
    const initial = threadRootMsgid ? '' : useDraftStore.getState().forBuffer(networkId, target);
    textRef.current = initial;
    setText(initial);
    setCaretPos(initial.length);
    setUsageDismissedFor(null);
    tabStateRef.current = null;
    historyIdxRef.current = -1;
  }, [networkId, target, threadRootMsgid]);

  // Auto-focus on mount or buffer change if requested
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus, networkId, target]);

  // Auto-resize textarea (keep minimum 36px to match toolbar buttons)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(36, Math.min(el.scrollHeight, 180))}px`;
  }, [text]);

  // Register insert URL callback for uploads
  useEffect(() => {
    if (threadRootMsgid) return; // main composer registers; thread panel handles its own or shares
    const unsub = onInsertUrl((url: string) => {
      const el = textareaRef.current;
      const start = el?.selectionStart ?? text.length;
      const end = el?.selectionEnd ?? text.length;
      const next = insertWithPadding(text, start, end, url);
      setText(next.text);
      useDraftStore.getState().setDraft(networkId, target, next.text);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(next.caret, next.caret);
        }
      });
    });
    return unsub;
  }, [networkId, target, text, threadRootMsgid]);

  const clearTypingTimer = useCallback(() => {
    if (typingPauseTimerRef.current) {
      clearTimeout(typingPauseTimerRef.current);
      typingPauseTimerRef.current = null;
    }
  }, []);

  const emitTypingDoneIfActive = useCallback(() => {
    clearTypingTimer();
    const prevPhase = typingPhaseRef.current;
    typingPhaseRef.current = 'none';
    lastTypingSentRef.current = 0;
    if (
      prevPhase !== 'none' &&
      !isServerBuffer &&
      netStateRef.current === 'connected' &&
      useSettingsStore.getState().effective('chat.send_typing_notifications') !== false
    ) {
      socketSend({ type: 'typing', networkId, target, state: 'done' });
    }
  }, [clearTypingTimer, isServerBuffer, networkId, target]);

  // Emit 'done' when switching buffers or unmounting after active/paused typing
  useEffect(() => {
    return () => {
      emitTypingDoneIfActive();
    };
  }, [emitTypingDoneIfActive]);

  // Close attach menu and formatting popover on outside click
  useEffect(() => {
    if (!menuOpen && !formatOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const node = e.target as Node;
      if (menuOpen && menuRef.current && !menuRef.current.contains(node) && !attachBtnRef.current?.contains(node)) {
        setMenuOpen(false);
      }
      if (formatOpen && formatRef.current && !formatRef.current.contains(node) && !formatBtnRef.current?.contains(node)) {
        setFormatOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen, formatOpen]);

  const updateText = useCallback(
    (next: string, opts?: { suppressTyping?: boolean; caret?: number }) => {
      textRef.current = next;
      setText(next);
      const nextCaret =
        opts?.caret ?? Math.min(textareaRef.current?.selectionStart ?? next.length, next.length);
      setCaretPos(nextCaret);
      const nextVerb = usageVerb(next);
      setUsageDismissedFor((prev) => (prev && prev === nextVerb ? prev : null));
      tabStateRef.current = null;
      if (!threadRootMsgid) {
        useDraftStore.getState().setDraft(networkId, target, next);
      }
      if (opts?.suppressTyping) {
        clearTypingTimer();
        return;
      }
      const typingAllowed =
        !isServerBuffer &&
        netState?.state === 'connected' &&
        useSettingsStore.getState().effective('chat.send_typing_notifications') !== false;
      const isPlainText = Boolean(next.trim()) && !next.startsWith('/');

      if (!typingAllowed || !isPlainText) {
        if (typingPhaseRef.current !== 'none') {
          emitTypingDoneIfActive();
        } else {
          clearTypingTimer();
        }
        return;
      }

      // Emit 'active' immediately on transition or every 3s throttle while typing
      const now = Date.now();
      if (typingPhaseRef.current !== 'active' || now - lastTypingSentRef.current > 3000) {
        lastTypingSentRef.current = now;
        typingPhaseRef.current = 'active';
        socketSend({ type: 'typing', networkId, target, state: 'active' });
      }

      // Transition to 'paused' after 4.5s of idle non-empty input
      clearTypingTimer();
      typingPauseTimerRef.current = setTimeout(() => {
        typingPauseTimerRef.current = null;
        if (
          typingPhaseRef.current === 'active' &&
          !isServerBuffer &&
          netStateRef.current === 'connected' &&
          useSettingsStore.getState().effective('chat.send_typing_notifications') !== false
        ) {
          typingPhaseRef.current = 'paused';
          lastTypingSentRef.current = 0;
          socketSend({ type: 'typing', networkId, target, state: 'paused' });
        }
      }, 4500);
    },
    [isServerBuffer, networkId, target, threadRootMsgid, netState?.state, clearTypingTimer, emitTypingDoneIfActive],
  );

  const availableSlashCommands = useMemo(() => {
    const ownNick = netState?.nick || network?.nick || '';
    const selfMember =
      buffer && ownNick
        ? buffer.members.find((m) => m.nick.toLowerCase() === ownNick.toLowerCase())
        : undefined;
    const capCtx = buildCapabilityContext(netState, serverProfile, {
      selfChannelModes: selfMember?.modes,
      channelModes: buffer?.modes,
      target,
    });
    const inChannel = buffer ? buffer.kind === 'channel' : isChannelTarget(target);
    const baseCmds = getAvailableSlashCommands(SLASH_COMMANDS, capCtx, { inChannel });
    if (!aliases.length) return baseCmds;
    const aliasNames = new Set(aliases.map((a) => a.name));
    const aliasDefs = aliases.map((a) => ({
      name: a.name,
      args: '',
      description: `Alias → ${a.body}`,
      category: 'general' as const,
    }));
    return [...aliasDefs, ...baseCmds.filter((c) => !aliasNames.has(c.name))];
  }, [netState, network?.nick, serverProfile, buffer, target, aliases]);

  // Suggestions (slash commands, :emoji:, @nick)
  const suggestions = useMemo<SuggestItem[]>(() => {
    const el = textareaRef.current;
    const caret = Math.min(el?.selectionStart ?? caretPos, text.length);

    // 1. Slash command at start of input
    if (text.startsWith('/') && !text.slice(0, caret).includes(' ') && !text.includes('\n')) {
      const q = text.slice(1, caret).toLowerCase();
      const prefixMatches = availableSlashCommands.filter((c) => c.name.startsWith(q));
      const subMatches =
        q.length >= 2
          ? availableSlashCommands.filter((c) => !c.name.startsWith(q) && c.name.includes(q))
          : [];
      return [...prefixMatches, ...subMatches]
        .slice(0, 15)
        .map((c) => ({
          kind: 'command',
          label: `/${c.name}`,
          detail: `${c.args ? c.args + ' — ' : ''}${c.description}`,
          insert: `/${c.name} `,
        }));
    }

    // 2. Active :emoji: shortcode (2+ chars)
    const sc = findActiveShortcode(text, caret);
    if (sc && sc.name.length >= 2) {
      if (!emojiTable) {
        loadEmoji().then((mod) => {
          setEmojiTable(mod.EMOJI);
          setEmojiNames(Object.keys(mod.EMOJI));
        });
        return [];
      }
      const ranked = rankShortcodes(emojiNames, sc.name).slice(0, 8);
      return ranked.map((name) => ({
        kind: 'emoji',
        label: `:${name}:`,
        detail: emojiTable[name] || '',
        insert: emojiTable[name] || `:${name}:`,
        start: sc.start,
        end: sc.end,
      }));
    }

    // 3. @nick mention
    const before = text.slice(0, caret);
    const atMatch = /(?:^|\s)@([^\s]*)$/.exec(before);
    if (atMatch && buffer) {
      const prefix = atMatch[1];
      const start = caret - prefix.length - 1; // include '@'
      const candidates = buildNickCandidates(
        buffer,
        netState?.nick || network?.nick || '',
        prefix,
        isIgnored,
      ).slice(0, 8);
      return candidates.map((c) => ({
        kind: 'nick',
        label: c.nick,
        detail: c.displayName || (c.recent ? 'recent' : undefined),
        insert: start === 0 ? `${c.nick}: ` : `${c.nick} `,
        start,
        end: caret,
      }));
    }

    return [];
  }, [
    text,
    caretPos,
    availableSlashCommands,
    emojiTable,
    emojiNames,
    buffer,
    netState?.nick,
    network?.nick,
    isIgnored,
  ]);

  const activeVerb = usageVerb(text);
  const usage = useMemo<UsageHint | null>(() => {
    if (activeVerb === null || usageDismissedFor === activeVerb) return null;
    return usageHint(text, caretPos, availableSlashCommands, aliases, isServerBuffer);
  }, [activeVerb, usageDismissedFor, text, caretPos, availableSlashCommands, aliases, isServerBuffer]);

  useEffect(() => {
    setSuggestIdx(0);
  }, [suggestions.length]);

  const applySuggestion = useCallback(
    (item: SuggestItem) => {
      let next = '';
      let newCaret = 0;
      if (item.kind === 'command') {
        next = item.insert;
        newCaret = next.length;
      } else {
        next = text.slice(0, item.start) + item.insert + text.slice(item.end);
        newCaret = item.start + item.insert.length;
      }
      updateText(next, { caret: newCaret });
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCaret, newCaret);
        }
      });
    },
    [text, updateText],
  );

  // Send logic
  const sendNow = useCallback(
    async (raw: string, skipLengthGate = false) => {
      const trimmed = raw.trim();
      if (!trimmed) return;

      if (isPaused) {
        useToastsStore.getState().push('Account is paused', 'error');
        return;
      }

      // Slash commands
      if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
        useInputHistoryStore.getState().add(networkId, target, { text: trimmed });
        historyIdxRef.current = -1;
        updateText('');
        await dispatchSlashCommand(trimmed, networkId, target);
        onSent?.();
        return;
      }

      const body = trimmed.startsWith('//') ? trimmed.slice(1) : raw.replace(/\s+$/, '');
      if (isServerBuffer) {
        useToastsStore
          .getState()
          .push('Cannot send plain messages to a server log — type a /command or switch to a channel/DM.', 'error');
        return;
      }

      const budget = textBudgetFor(
        { nick: netState?.nick || network?.nick, userhostBytes: null },
        target,
        false,
      );
      const lines = chunkCountForSay(body, budget);
      const bytes = byteLen(body);

      if (!skipLengthGate && canUpload && (lines > 4 || bytes > 1500)) {
        setPendingLongText(body);
        setLongModalOpen(true);
        return;
      }

      useInputHistoryStore.getState().add(networkId, target, { text: body, reply });
      historyIdxRef.current = -1;
      const activeReply = reply;
      const rawReplyTo =
        typeof threadRootMessageId === 'number' && Number.isInteger(threadRootMessageId)
          ? threadRootMessageId
          : activeReply?.messageId;
      const numericReplyTo =
        typeof rawReplyTo === 'number' && Number.isInteger(rawReplyTo) ? rawReplyTo : undefined;

      updateText('', { suppressTyping: true });
      if (!threadRootMsgid) {
        useDraftStore.getState().flush(networkId, target);
      }
      if (activeReply) {
        useRepliesStore.getState().cancel(replyKey);
      }

      const ack = await socketSendWithAck({
        type: 'send',
        networkId,
        target,
        text: body,
        ...(numericReplyTo !== undefined ? { replyTo: numericReplyTo } : {}),
      });

      if (!ack.ok) {
        if (!textRef.current && body) {
          updateText(body, { suppressTyping: true });
        }
        useToastsStore.getState().push({
          title: 'Message not sent',
          body: ack.error || 'Failed to send message',
          kind: 'error',
        });
      } else {
        clearTypingTimer();
        typingPhaseRef.current = 'none';
        lastTypingSentRef.current = 0;
        if (useSettingsStore.getState().effective('chat.send_typing_notifications') !== false) {
          socketSend({ type: 'typing', networkId, target, state: 'done' });
        }
        onSent?.();
      }
    },
    [
      isPaused,
      isServerBuffer,
      networkId,
      target,
      netState?.nick,
      network?.nick,
      canUpload,
      reply,
      replyKey,
      threadRootMsgid,
      threadRootMessageId,
      updateText,
      clearTypingTimer,
      onSent,
    ],
  );

  // Upload files
  const dismissPendingUpload = useCallback((id: number) => {
    removedUploadIdsRef.current.add(id);
    activeUploadsRef.current.delete(id);
    const previewUrl = previewUrlsRef.current.get(id);
    if (previewUrl) {
      if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(previewUrl);
      previewUrlsRef.current.delete(id);
    }
    setPendingUploads((prev) => prev.filter((p) => p.id !== id));
    if (activeUploadsRef.current.size === 0) {
      sendWhenUploadedRef.current = false;
      setSendWhenUploaded(false);
    }
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | File[]): Promise<boolean> => {
      if (!canUpload) {
        useToastsStore.getState().push(uploadsOffTitle || 'Uploads disabled', 'error');
        return false;
      }
      const list = Array.from(files);
      if (list.length === 0) return false;

      const tasks = list.map((rawFile) => {
        const safeName = ensureUploadFilename(rawFile.name, rawFile.type);
        const file =
          rawFile.name && rawFile.name.trim()
            ? rawFile
            : new File([rawFile], safeName, { type: rawFile.type || 'image/png' });
        const id = nextPendingUploadIdRef.current++;
        const previewUrl =
          file.type.startsWith('image/') && typeof URL.createObjectURL === 'function'
            ? URL.createObjectURL(file)
            : null;
        if (previewUrl) previewUrlsRef.current.set(id, previewUrl);

        setPendingUploads((prev) => [
          ...prev,
          { id, filename: safeName, previewUrl, status: 'uploading' },
        ]);

        const task = (async (): Promise<boolean> => {
          try {
            const res = await useUploadsStore
              .getState()
              .upload(file, safeName, { insert: false });
            if (removedUploadIdsRef.current.has(id)) return false;

            if (previewUrl) {
              if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(previewUrl);
              previewUrlsRef.current.delete(id);
            }
            setPendingUploads((prev) => prev.filter((p) => p.id !== id));

            if (res?.url) {
              const el = textareaRef.current;
              const cur = textRef.current;
              const rawStart = el?.selectionStart ?? cur.length;
              const rawEnd = el?.selectionEnd ?? cur.length;
              const start = Math.min(rawStart, cur.length);
              const end = Math.min(Math.max(start, rawEnd), cur.length);
              const next = insertWithPadding(cur, start, end, res.url);
              textRef.current = next.text;
              updateText(next.text);
              if (!sendWhenUploadedRef.current) {
                requestAnimationFrame(() => {
                  if (textareaRef.current) {
                    textareaRef.current.focus();
                    textareaRef.current.setSelectionRange(next.caret, next.caret);
                  }
                });
              }
            }
            return true;
          } catch (err: any) {
            if (removedUploadIdsRef.current.has(id)) return false;
            const message = err?.message || 'Upload failed';
            setPendingUploads((prev) =>
              prev.map((p) => (p.id === id ? { ...p, status: 'error', error: message } : p)),
            );
            useToastsStore.getState().push({
              title: 'Upload failed',
              body: message,
              kind: 'error',
            });
            return false;
          } finally {
            activeUploadsRef.current.delete(id);
          }
        })();

        activeUploadsRef.current.set(id, task);
        return task;
      });

      const outcomes = await Promise.all(tasks);
      return outcomes.every(Boolean);
    },
    [canUpload, uploadsOffTitle, updateText],
  );

  const submitOrQueueSend = useCallback(
    async (explicitText?: string) => {
      if (isPaused) {
        useToastsStore.getState().push('Account is paused', 'error');
        return;
      }
      if (activeUploadsRef.current.size > 0) {
        if (sendWhenUploadedRef.current) return;
        sendWhenUploadedRef.current = true;
        setSendWhenUploaded(true);
        try {
          while (activeUploadsRef.current.size > 0) {
            const results = await Promise.all(Array.from(activeUploadsRef.current.values()));
            if (!sendWhenUploadedRef.current || results.some((ok) => !ok)) {
              sendWhenUploadedRef.current = false;
              setSendWhenUploaded(false);
              return;
            }
          }
          sendWhenUploadedRef.current = false;
          setSendWhenUploaded(false);
          const finalText = textRef.current;
          if (finalText.trim()) {
            await sendNow(finalText);
          }
        } catch {
          sendWhenUploadedRef.current = false;
          setSendWhenUploaded(false);
        }
        return;
      }
      await sendNow(explicitText ?? textRef.current);
    },
    [isPaused, sendNow],
  );

  const handleClipboardPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (isPaused) return;
      if (useSettingsStore.getState().effective('uploads.paste.enabled') === false) return;

      const files = pastedUploadFiles(e.nativeEvent);
      if (files.length > 0) {
        e.preventDefault();
        void handleFiles(files);
        return;
      }

      const readClipImg = window.lurkerDesktop?.readClipboardImage;
      const hasText =
        Boolean(e.clipboardData?.getData('text/plain')) ||
        Boolean(e.clipboardData?.getData('text/uri-list'));
      if (!hasText && readClipImg) {
        e.preventDefault();
        const clipTaskId = nextPendingUploadIdRef.current++;
        const clipTask = (async (): Promise<boolean> => {
          try {
            const img = await readClipImg();
            if (!img) return true;
            const blob = new Blob([Uint8Array.from(img.data)], { type: img.mime || 'image/png' });
            const file = new File([blob], img.filename || 'screenshot.png', {
              type: img.mime || 'image/png',
            });
            return await handleFiles([file]);
          } finally {
            activeUploadsRef.current.delete(clipTaskId);
          }
        })();
        activeUploadsRef.current.set(clipTaskId, clipTask);
      }
    },
    [handleFiles, isPaused],
  );

  const pendingComposeInsert = useDesktopUiStore((s) => s.pendingComposeInsert);
  const pasteImageNonce = useDesktopUiStore((s) => s.pasteImageNonce);
  const handledPasteNonceRef = useRef<number>(pasteImageNonce);

  useEffect(() => {
    if (threadRootMsgid || !pendingComposeInsert) return;
    const { text: inserted, nonce } = pendingComposeInsert;
    useDesktopUiStore.getState().consumeComposeInsert(nonce);
    updateText(inserted);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(inserted.length, inserted.length);
      }
    });
  }, [pendingComposeInsert, threadRootMsgid, updateText]);

  useEffect(() => {
    if (threadRootMsgid || pasteImageNonce <= handledPasteNonceRef.current) return;
    handledPasteNonceRef.current = pasteImageNonce;
    const readClipImg = window.lurkerDesktop?.readClipboardImage;
    if (!readClipImg || isPaused) return;
    void (async () => {
      const img = await readClipImg();
      if (!img) {
        useToastsStore.getState().push('No image found in clipboard', 'info');
        return;
      }
      const blob = new Blob([Uint8Array.from(img.data)], { type: img.mime || 'image/png' });
      const file = new File([blob], img.filename || 'screenshot.png', {
        type: img.mime || 'image/png',
      });
      await handleFiles([file]);
    })();
  }, [pasteImageNonce, threadRootMsgid, isPaused, handleFiles]);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        handleFiles(files);
      }
    },
    [handleFiles],
  );

  const insertMircFormatting = useCallback(
    (openCode: string, closeCode = openCode) => {
      const el = textareaRef.current;
      const current = textRef.current;
      const selStart = el?.selectionStart ?? current.length;
      const selEnd = el?.selectionEnd ?? current.length;
      const res = applyIrcControlAtSelection({
        text: current,
        selectionStart: selStart,
        selectionEnd: selEnd,
        openCode,
        closeCode,
      });
      updateText(res.text);
      requestAnimationFrame(() => {
        const targetEl = textareaRef.current;
        if (!targetEl) return;
        targetEl.focus();
        targetEl.setSelectionRange(res.selectionStart, res.selectionEnd);
      });
    },
    [updateText],
  );

  const insertMircColor = useCallback(
    (fg: number | null, bg: number | null = null) => {
      const code = formatMircColorCode(fg, bg);
      insertMircFormatting(code, IRC_COLOR);
    },
    [insertMircFormatting],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Suggestions navigation
      if (suggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSuggestIdx((i) => (i + 1) % suggestions.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSuggestIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
          return;
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault();
          applySuggestion(suggestions[suggestIdx] || suggestions[0]);
          return;
        }
      }

      // Tab completion (nicks & channels)
      if (e.key === 'Tab') {
        e.preventDefault();
        const el = e.currentTarget;
        const cur = textRef.current;
        const caret = el.selectionStart ?? cur.length;

        if (tabStateRef.current && tabStateRef.current.end === caret) {
          const ts = tabStateRef.current;
          const nextIdx = (ts.index + (e.shiftKey ? -1 : 1) + ts.candidates.length) % ts.candidates.length;
          const cand = ts.candidates[nextIdx];
          const suffix = ts.isStartOfLine && !cand.startsWith('#') ? ': ' : ' ';
          const inserted = cand + suffix;
          const next = cur.slice(0, ts.start) + inserted + cur.slice(ts.end);
          ts.index = nextIdx;
          ts.end = ts.start + inserted.length;
          textRef.current = next;
          setText(next);
          setCaretPos(ts.end);
          if (!threadRootMsgid) useDraftStore.getState().setDraft(networkId, target, next);
          requestAnimationFrame(() => el.setSelectionRange(ts.end, ts.end));
          return;
        }
        tabStateRef.current = null;

        const before = cur.slice(0, caret);
        const tokenMatch = /(^|\s)([^\s]+)$/.exec(before);
        if (!tokenMatch) return;
        const token = tokenMatch[2];
        const start = caret - token.length;
        const isStartOfLine = start === 0;
        const selfNick = netState?.nick || network?.nick || '';

        let candidates: string[] = [];
        if (token.startsWith('#')) {
          const allBufs = Object.values(useBuffersStore.getState().buffers).filter(
            (b) => b.networkId === networkId && b.joined !== false,
          );
          candidates = buildChannelCandidates(allBufs, token, (t) =>
            recentRank(bufferKey(networkId, t)),
          );
        } else if (buffer) {
          const completionBuf =
            buffer.kind === 'dm' && buffer.members.length === 0
              ? { ...buffer, members: [{ nick: buffer.target, user: null, host: null, modes: [], away: false }] }
              : buffer;
          candidates = buildNickCandidates(
            completionBuf,
            selfNick,
            token,
            isIgnored,
          ).map((c) => c.nick);
        }

        if (candidates.length === 0) return;
        const cand = candidates[0];
        const suffix = isStartOfLine && !cand.startsWith('#') ? ': ' : ' ';
        const inserted = cand + suffix;
        const next = cur.slice(0, start) + inserted + cur.slice(caret);
        const newEnd = start + inserted.length;
        tabStateRef.current = {
          candidates,
          index: 0,
          start,
          end: newEnd,
          isStartOfLine,
        };
        textRef.current = next;
        setText(next);
        setCaretPos(newEnd);
        if (!threadRootMsgid) useDraftStore.getState().setDraft(networkId, target, next);
        requestAnimationFrame(() => el.setSelectionRange(newEnd, newEnd));
        return;
      }

      // mIRC text formatting & color picker shortcuts
      const mod = e.ctrlKey || e.metaKey;
      const lowerKey = e.key.toLowerCase();
      if (
        !e.altKey &&
        lowerKey === 'k' &&
        ((mod && e.shiftKey) || (e.ctrlKey && !e.metaKey && !e.shiftKey))
      ) {
        e.preventDefault();
        setMenuOpen(false);
        setFormatOpen((prev) => !prev);
        return;
      }
      if (mod && !e.altKey && !e.shiftKey) {
        if (lowerKey === 'b') {
          e.preventDefault();
          insertMircFormatting(IRC_BOLD);
          return;
        }
        if (lowerKey === 'i') {
          e.preventDefault();
          insertMircFormatting(IRC_ITALIC);
          return;
        }
        if (lowerKey === 'u') {
          e.preventDefault();
          insertMircFormatting(IRC_UNDERLINE);
          return;
        }
      }
      if (mod && e.shiftKey && !e.altKey) {
        if (lowerKey === 's') {
          e.preventDefault();
          insertMircFormatting(IRC_STRIKE);
          return;
        }
        if (lowerKey === 'r') {
          e.preventDefault();
          insertMircFormatting(IRC_REVERSE);
          return;
        }
        if (lowerKey === 'o') {
          e.preventDefault();
          insertMircFormatting(IRC_RESET, '');
          return;
        }
      }
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && lowerKey === 'o') {
        e.preventDefault();
        insertMircFormatting(IRC_RESET, '');
        return;
      }

      // Escape dismisses command usage line / closes popovers / cancels reply
      if (e.key === 'Escape') {
        const curVerb = usageVerb(textRef.current);
        if (usage || (suggestions.length > 0 && curVerb)) {
          e.preventDefault();
          if (curVerb) setUsageDismissedFor(curVerb);
          return;
        }
        if (formatOpen) {
          e.preventDefault();
          setFormatOpen(false);
          return;
        }
        if (menuOpen) {
          e.preventDefault();
          setMenuOpen(false);
          return;
        }
        if (reply) {
          e.preventDefault();
          useRepliesStore.getState().cancel(replyKey);
          return;
        }
      }

      // History recall (ArrowUp/ArrowDown when single line / at edge)
      if (e.key === 'ArrowUp' && !text.includes('\n')) {
        const entries = useInputHistoryStore.getState().forBuffer(networkId, target);
        if (entries.length > 0) {
          const nextIdx =
            historyIdxRef.current === -1
              ? entries.length - 1
              : Math.max(0, historyIdxRef.current - 1);
          historyIdxRef.current = nextIdx;
          e.preventDefault();
          updateText(entries[nextIdx].text);
        }
        return;
      }
      if (e.key === 'ArrowDown' && !text.includes('\n')) {
        const entries = useInputHistoryStore.getState().forBuffer(networkId, target);
        if (historyIdxRef.current !== -1) {
          e.preventDefault();
          if (historyIdxRef.current >= entries.length - 1) {
            historyIdxRef.current = -1;
            updateText('');
          } else {
            historyIdxRef.current += 1;
            updateText(entries[historyIdxRef.current].text);
          }
        }
        return;
      }

      // Enter to send
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
        if (enterSends && !e.shiftKey) {
          e.preventDefault();
          void submitOrQueueSend(textRef.current);
        } else if (!enterSends && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void submitOrQueueSend(textRef.current);
        }
      }
    },
    [
      suggestions,
      suggestIdx,
      applySuggestion,
      text,
      threadRootMsgid,
      networkId,
      target,
      recentRank,
      buffer,
      netState?.nick,
      network?.nick,
      isIgnored,
      usage,
      formatOpen,
      menuOpen,
      insertMircFormatting,
      reply,
      replyKey,
      updateText,
      enterSends,
      submitOrQueueSend,
    ],
  );

  // Auto-convert completed :shortcode: on change
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      const caret = e.target.selectionStart ?? val.length;
      const completed = findCompletedShortcode(val, caret);
      if (completed && emojiTable && emojiTable[completed.name]) {
        const glyph = emojiTable[completed.name];
        const next = val.slice(0, completed.start) + glyph + val.slice(completed.end);
        const newCaret = completed.start + glyph.length;
        updateText(next, { caret: newCaret });
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.setSelectionRange(newCaret, newCaret);
          }
        });
        return;
      }
      updateText(val, { caret });
    },
    [emojiTable, updateText],
  );

  const estimatedLines = useMemo(() => {
    if (!text.trim() || text.startsWith('/')) return 1;
    const budget = textBudgetFor(
      { nick: netState?.nick || network?.nick, userhostBytes: null },
      target,
      false,
    );
    return chunkCountForSay(text, budget);
  }, [text, netState?.nick, network?.nick, target]);

  return (
    <div
      className={`relative border-t border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 ${
        dragOver ? 'ring-2 ring-inset ring-[var(--accent)] bg-[var(--accent)]/5' : ''
      }`}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer?.files?.length) {
          handleFiles(e.dataTransfer.files);
        }
      }}
    >
      {/* Incoming typing indicator */}
      {!threadRootMsgid && !isServerBuffer && (
        <TypingIndicator networkId={networkId} target={target} />
      )}

      {/* Reply Banner */}
      {reply && !threadRootMsgid && (
        <div className="mb-1.5 flex items-center justify-between gap-2 rounded bg-[var(--bg-secondary)] px-2.5 py-1 text-xs border-l-2 border-[var(--accent)]">
          <div className="flex items-center gap-1.5 min-w-0 truncate text-[var(--text-secondary)]">
            <CornerUpLeft className="w-3.5 h-3.5 shrink-0 text-[var(--accent)]" />
            <span>Replying to</span>
            <strong className="text-[var(--text-primary)]">{reply.nick}</strong>
            {reply.text && (
              <span className="truncate opacity-75">— {reply.text}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => useRepliesStore.getState().cancel(replyKey)}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5"
            title="Cancel reply (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Pending Pasted/Dropped Attachment Preview Strip */}
      {pendingUploads.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-2">
          {pendingUploads.map((item) => (
            <div
              key={item.id}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                item.status === 'error'
                  ? 'border-[var(--bad)] bg-red-500/10'
                  : 'border-[var(--border)] bg-[var(--bg-secondary)]'
              }`}
            >
              {item.previewUrl && (
                <img
                  src={item.previewUrl}
                  alt={item.filename}
                  className="h-10 w-10 rounded object-cover border border-[var(--border)] shrink-0"
                />
              )}
              <div className={item.status === 'error' ? 'min-w-0 max-w-md' : 'min-w-0 max-w-[200px]'}>
                <div className="truncate font-medium text-[var(--text-primary)]">
                  {item.filename}
                </div>
                <div
                  title={item.status === 'error' ? item.error || 'Upload failed' : undefined}
                  className={`text-[11px] ${
                    item.status === 'error'
                      ? 'text-[var(--bad)] whitespace-normal break-words'
                      : 'truncate text-[var(--text-muted)]'
                  }`}
                >
                  {item.status === 'error'
                    ? item.error || 'Upload failed'
                    : uploadCurrent?.phase === 'processing' &&
                        (uploadCurrent.destination === 'MP4' ||
                          uploadCurrent.destination === 'M4A') &&
                        uploadCurrent.filename === item.filename
                      ? `Converting to ${uploadCurrent.destination}...`
                      : sendWhenUploaded
                        ? 'Sending after upload...'
                        : 'Uploading...'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => dismissPendingUpload(item.id)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5"
                title={item.status === 'error' ? 'Dismiss' : 'Cancel attachment'}
                aria-label={`Remove ${item.filename}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upload Progress Banner */}
      {uploadCurrent && (
        <div className="mb-1.5 rounded bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="flex items-center gap-1.5 truncate text-[var(--text-primary)]">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />
              <span className="truncate">
                {uploadCurrent.phase === 'uploading'
                  ? `Uploading ${uploadCurrent.filename}...`
                  : uploadCurrent.phase === 'processing'
                    ? uploadCurrent.destination === 'MP4' || uploadCurrent.destination === 'M4A'
                      ? `Converting ${uploadCurrent.filename} to ${uploadCurrent.destination}...`
                      : `Processing ${uploadCurrent.filename}...`
                    : `Sending ${uploadCurrent.filename}...`}
              </span>
            </span>
            <span className="text-[var(--text-muted)] tabular-nums">
              {uploadCurrent.phase === 'processing' &&
              (uploadCurrent.destination === 'MP4' || uploadCurrent.destination === 'M4A')
                ? 'Converting'
                : `${uploadCurrent.progress}%`}
            </span>
          </div>
          <div className="h-1 w-full rounded-full bg-[var(--border)] overflow-hidden">
            <div
              className={`h-full bg-[var(--accent)] transition-all duration-150 ${
                uploadCurrent.phase === 'processing' &&
                (uploadCurrent.destination === 'MP4' || uploadCurrent.destination === 'M4A')
                  ? 'animate-pulse w-full'
                  : ''
              }`}
              style={
                uploadCurrent.phase === 'processing' &&
                (uploadCurrent.destination === 'MP4' || uploadCurrent.destination === 'M4A')
                  ? undefined
                  : { width: `${uploadCurrent.progress}%` }
              }
            />
          </div>
        </div>
      )}

      {/* Suggestions Popup & Persistent Command Usage Line (#1369) */}
      {(suggestions.length > 0 || (usage !== null && !formatOpen && !menuOpen)) && (
        <div className="vertical-popover absolute bottom-full left-3 right-3 mb-1 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] shadow-xl z-30 overflow-hidden">
          {suggestions.length > 0 && (
            <div className="max-h-56 overflow-y-auto py-1">
              {suggestions.map((item, idx) => (
                <button
                  key={`${item.kind}-${item.label}-${idx}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySuggestion(item);
                  }}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-xs transition-colors ${
                    idx === suggestIdx
                      ? 'bg-[var(--accent)]/20 text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <span className="font-medium text-[var(--text-primary)] shrink-0">
                    {item.label}
                  </span>
                  {item.detail && (
                    <span className="truncate text-[var(--text-muted)]">{item.detail}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {usage && (
            <div
              data-testid="command-usage-line"
              className={`usage-line px-3 py-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-xs text-[var(--text-muted)] select-none ${
                suggestions.length > 0 ? 'border-t border-[var(--border)]' : ''
              }`}
            >
              <span className="usage font-mono">
                {usage.parts.map((part, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && ' '}
                    <span
                      className={
                        part.active
                          ? 'active text-[var(--text-primary)] font-semibold'
                          : undefined
                      }
                    >
                      {part.text}
                    </span>
                  </React.Fragment>
                ))}
              </span>
              <span className="summary truncate text-[11px]">{usage.description}</span>
            </div>
          )}
        </div>
      )}

      {/* Attach Menu Popover */}
      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute bottom-full left-3 mb-1 w-72 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] shadow-xl z-30 overflow-hidden"
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] px-2.5 py-1.5">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => useUploadsStore.getState().selectMenuMode('favorites')}
                className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
                  menuMode === 'favorites'
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <Star className="w-3 h-3" /> Starred
              </button>
              <button
                type="button"
                onClick={() => useUploadsStore.getState().selectMenuMode('recent')}
                className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
                  menuMode === 'recent'
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <Clock className="w-3 h-3" /> Recent
              </button>
            </div>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="max-h-52 overflow-y-auto p-1.5 space-y-1">
            {menuLoading && (
              <div className="py-4 text-center text-xs text-[var(--text-muted)]">
                Loading...
              </div>
            )}
            {menuError && (
              <div className="py-3 px-2 text-center text-xs text-red-400">
                {menuError}
              </div>
            )}
            {!menuLoading && !menuError && menuItems.length === 0 && (
              <div className="py-4 text-center text-xs text-[var(--text-muted)]">
                No {menuMode === 'favorites' ? 'starred' : 'recent'} uploads yet
              </div>
            )}
            {menuItems.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  const el = textareaRef.current;
                  const start = el?.selectionStart ?? text.length;
                  const end = el?.selectionEnd ?? text.length;
                  const next = insertWithPadding(text, start, end, u.url);
                  updateText(next.text);
                  setMenuOpen(false);
                }}
                className="w-full flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-hover)]"
              >
                <span className="truncate text-[var(--text-primary)]">{u.filename || u.url}</span>
                {u.mime && (
                  <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                    {u.mime.split('/')[0]}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="border-t border-[var(--border)] p-1.5 flex gap-1.5">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                fileInputRef.current?.click();
              }}
              className="flex-1 flex items-center justify-center gap-1.5 rounded bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              <Upload className="w-3.5 h-3.5" /> Upload File
            </button>
            {onOpenUploadsModal && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenUploadsModal();
                }}
                className="flex items-center justify-center gap-1 rounded border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                title="Browse all uploads"
              >
                <FolderOpen className="w-3.5 h-3.5" /> Browse
              </button>
            )}
          </div>
        </div>
      )}

      {/* Live mIRC Formatting Preview */}
      {hasIrcFormatting(text) && (
        <div
          data-testid="mirc-live-preview"
          className="mb-1.5 flex items-center justify-between gap-2 rounded bg-[var(--bg-secondary)] px-2.5 py-1 text-xs border border-[var(--border)]"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">
              Preview
            </span>
            <div className="min-w-0 truncate text-sm text-[var(--text-primary)]">
              <LinkedText text={applySpoilerMarkup(text)} networkId={networkId} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => updateText(stripIrcFormatting(textRef.current))}
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            title="Strip all mIRC formatting codes"
          >
            Clear
          </button>
        </div>
      )}

      {/* mIRC Formatting & Color Picker Popover */}
      <div ref={formatRef}>
        <MircFormatPopover
          open={formatOpen}
          onClose={() => setFormatOpen(false)}
          onApplyStyle={(code) =>
            insertMircFormatting(code, code === IRC_RESET || code === IRC_COLOR ? '' : code)
          }
          onApplyColor={(fg, bg) => insertMircColor(fg, bg)}
          onResetAll={() => insertMircFormatting(IRC_RESET, '')}
        />
      </div>

      {/* Main Composer Row */}
      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_FILE_TYPES}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) {
              handleFiles(e.target.files);
              e.target.value = '';
            }
          }}
        />

        <button
          ref={attachBtnRef}
          type="button"
          disabled={!canUpload || !authUser}
          title={canUpload ? 'Attach or upload file' : uploadsOffTitle || 'Uploads disabled'}
          aria-label="Attach or upload file"
          onClick={() => {
            setFormatOpen(false);
            if (menuOpen) {
              setMenuOpen(false);
            } else {
              setMenuOpen(true);
              useUploadsStore.getState().openMenu();
            }
          }}
          style={{ width: '36px', height: '36px', padding: 0 }}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        <button
          ref={formatBtnRef}
          type="button"
          disabled={isPaused}
          title="Text formatting & mIRC colors (Ctrl+Shift+K)"
          aria-label="Text formatting and mIRC colors"
          aria-expanded={formatOpen}
          onClick={() => {
            setMenuOpen(false);
            setFormatOpen((prev) => !prev);
          }}
          style={{ width: '36px', height: '36px', padding: 0 }}
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-transparent transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            formatOpen
              ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/40'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Palette className="w-4 h-4" />
        </button>

        <div className="relative flex-1 flex">
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => {
              textRef.current = e.target.value;
              handleChange(e);
            }}
            onKeyUp={(e) => setCaretPos(e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
            onClick={(e) => setCaretPos(e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
            onSelect={(e) => setCaretPos(e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
            onKeyDown={(e) => {
              const wantsSubmit =
                !e.nativeEvent.isComposing &&
                suggestions.length === 0 &&
                ((enterSends && e.key === 'Enter' && !e.shiftKey) ||
                  (!enterSends && e.key === 'Enter' && (e.ctrlKey || e.metaKey)));
              if (wantsSubmit && activeUploadsRef.current.size > 0) {
                e.preventDefault();
                void submitOrQueueSend();
                return;
              }
              handleKeyDown(e);
            }}
            onPaste={handleClipboardPaste}
            placeholder={
              placeholder ||
              (isPaused
                ? 'Account paused (read-only)'
                : `Message ${target}${canUpload ? ' (paste or drop files to upload)' : ''}`)
            }
            disabled={isPaused}
            style={{
              display: 'block',
              minHeight: '36px',
              padding: '7px 12px',
              lineHeight: '20px',
            }}
            className="block w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-[7px] text-sm leading-5 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-50"
          />
          {estimatedLines > 1 && (
            <span className="absolute right-2 bottom-1.5 text-[10px] text-[var(--text-muted)] pointer-events-none">
              ~{estimatedLines} lines
            </span>
          )}
        </div>

        <button
          type="button"
          disabled={(!text.trim() && !pendingUploads.some((p) => p.status === 'uploading')) || isPaused}
          onClick={() => void submitOrQueueSend(text)}
          style={{ width: '36px', height: '36px', padding: 0 }}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          title={
            sendWhenUploaded
              ? 'Sending once upload completes...'
              : pendingUploads.some((p) => p.status === 'uploading')
                ? 'Send once upload completes'
                : 'Send message'
          }
          aria-label="Send message"
        >
          {sendWhenUploaded ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Long Message Upload Modal */}
      <LongMessageUploadModal
        open={longModalOpen}
        content={pendingLongText}
        onClose={() => {
          setLongModalOpen(false);
          setPendingLongText('');
        }}
        onSendAnyway={() => {
          const body = pendingLongText;
          setLongModalOpen(false);
          setPendingLongText('');
          sendNow(body, true);
        }}
        onUploaded={(url) => {
          setLongModalOpen(false);
          setPendingLongText('');
          sendNow(url, true);
        }}
      />
    </div>
  );
};
