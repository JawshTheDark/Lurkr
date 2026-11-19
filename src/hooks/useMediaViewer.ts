// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';

export interface MediaViewerItem {
  url: string;
  src?: string;
  kind: 'image' | 'video' | 'audio';
  title?: string;
  filename?: string;
  mime?: string;
}

interface MediaViewerState {
  item: MediaViewerItem | null;
  open: (item: MediaViewerItem) => void;
  close: () => void;
}

export const useMediaViewerStore = create<MediaViewerState>((set) => ({
  item: null,
  open: (item) => set({ item }),
  close: () => set({ item: null }),
}));
