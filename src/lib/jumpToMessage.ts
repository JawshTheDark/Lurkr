// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { useBuffersStore } from '../stores/buffers';
import { useDesktopUiStore } from '../stores/desktopUi';
import { useNetworksStore } from '../stores/networks';
import { useToastsStore } from '../stores/toasts';

export interface JumpToMessageArgs {
  networkId: number | string | null;
  target: string;
  messageId?: number | null;
  onAfterActivate?: () => void;
}

let activeJumpUnsub: (() => void) | null = null;

export function resetPendingJump(): void {
  activeJumpUnsub?.();
  activeJumpUnsub = null;
}

/**
 * Activate a buffer, ensure historical context around `messageId` is loaded
 * (via `history` `mode: 'around'` if not already present), and ask MessageList
 * to center and briefly glow the origin message.
 */
export function jumpToMessage({
  networkId,
  target,
  messageId,
  onAfterActivate,
}: JumpToMessageArgs): void {
  if (typeof target === 'string' && target.startsWith(':server:')) {
    useToastsStore.getState().push({
      kind: 'info',
      title: 'Cannot jump in server buffer',
      body: 'Server buffers have no jumpable message history.',
      ttlMs: 4000,
    });
    return;
  }

  const buffers = useBuffersStore.getState();
  if (messageId == null) {
    buffers.activate(networkId, target);
    onAfterActivate?.();
    return;
  }

  const msgId = Number(messageId);
  if (!Number.isInteger(msgId) || msgId <= 0) {
    useToastsStore.getState().push({
      kind: 'warn',
      title: 'Couldn’t load that message',
      body: 'Invalid message reference.',
      ttlMs: 4000,
    });
    return;
  }

  if (!buffers.hasBuffer(networkId, target)) {
    useToastsStore.getState().push({
      kind: 'info',
      title: 'Buffer is closed',
      body: 'Open that channel or DM first to view its message context.',
      ttlMs: 4000,
    });
    return;
  }

  const initialBuf = buffers.findByTarget(networkId, target);
  if (!initialBuf) return;

  const targetNetId = initialBuf.networkId;
  const targetName = initialBuf.target;
  const hasMessage =
    !initialBuf.unseeded && initialBuf.messages.some((m) => Number(m.id) === msgId);
  const hiddenByClear = initialBuf.clearedBeforeId > 0 && msgId <= initialBuf.clearedBeforeId;

  resetPendingJump();

  if (hasMessage) {
    buffers.activate(targetNetId, targetName);
    if (hiddenByClear) {
      buffers.detachForJump(targetNetId, targetName);
    }
    useDesktopUiStore.getState().requestMessageJump({
      networkId: targetNetId,
      target: targetName,
      messageId: msgId,
    });
    onAfterActivate?.();
    return;
  }

  buffers.activate(targetNetId, targetName, { skipHydrate: true });
  onAfterActivate?.();

  const token = useBuffersStore.getState().loadAround(targetNetId, targetName, msgId);
  if (token == null) {
    useToastsStore.getState().push({
      kind: 'warn',
      title: 'Not connected',
      body: "Can't load that message while disconnected.",
      ttlMs: 5000,
    });
    return;
  }

  const handleSettled = (): boolean => {
    const curBuf = useBuffersStore.getState().findByTarget(targetNetId, targetName);
    if (!curBuf) {
      resetPendingJump();
      return true;
    }
    if (curBuf.pendingHistoryToken === token) return false;
    resetPendingJump();
    if (curBuf.pendingHistoryToken != null) return true;

    const landed = curBuf.messages.some((m) => Number(m.id) === msgId);
    if (landed) {
      const activeKey = useNetworksStore.getState().activeKey;
      const expectedKey =
        targetNetId == null ? targetName : `${targetNetId}::${targetName}`;
      if (!activeKey || activeKey.toLowerCase() === expectedKey.toLowerCase()) {
        useDesktopUiStore.getState().requestMessageJump({
          networkId: targetNetId,
          target: targetName,
          messageId: msgId,
        });
      }
    } else {
      useToastsStore.getState().push({
        kind: 'warn',
        title: 'Couldn’t load that message',
        body: 'The connection dropped, or the message is no longer available.',
        ttlMs: 5000,
      });
    }
    return true;
  };

  if (!handleSettled()) {
    activeJumpUnsub = useBuffersStore.subscribe(() => {
      handleSettled();
    });
  }
}
