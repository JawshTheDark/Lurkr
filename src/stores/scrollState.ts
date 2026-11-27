// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';

export type UnreadAnchor = 'up' | 'down' | null;

interface ScrollState {
  unreadAnchor: UnreadAnchor;
  scrollToUnreadNonce: number;
  setUnreadAnchor: (dir: UnreadAnchor) => void;
  requestScrollToUnread: () => void;
  reset: () => void;
}

export const useScrollStateStore = create<ScrollState>((set) => ({
  unreadAnchor: null,
  scrollToUnreadNonce: 0,
  setUnreadAnchor: (dir) => set((s) => (s.unreadAnchor === dir ? s : { unreadAnchor: dir })),
  requestScrollToUnread: () => set((s) => ({ scrollToUnreadNonce: s.scrollToUnreadNonce + 1 })),
  reset: () => set({ unreadAnchor: null, scrollToUnreadNonce: 0 }),
}));
