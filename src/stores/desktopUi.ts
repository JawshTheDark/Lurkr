// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';

export type AboutTab = 'program' | 'network';

export type IrcPromptKind =
  | 'nick'
  | 'topic'
  | 'query'
  | 'whois'
  | 'whowas'
  | 'away'
  | 'invite'
  | 'mode'
  | 'kill'
  | 'relay'
  | 'rename'
  | 'raw';

let nextNonce = 1;

interface DesktopUiState {
  aboutOpen: boolean;
  aboutTab: AboutTab;
  commandsOpen: boolean;
  shortcutsOpen: boolean;
  promptKind: IrcPromptKind | null;
  requestedSettingsSection: string | null;
  loginShowServerConfigNonce: number;
  pasteImageNonce: number;
  pendingChatAction: { action: string; arg?: string; nonce: number } | null;
  pendingComposeInsert: { text: string; nonce: number } | null;

  openAbout: (tab?: AboutTab) => void;
  closeAbout: () => void;
  openCommands: () => void;
  closeCommands: () => void;
  openShortcuts: () => void;
  closeShortcuts: () => void;
  openPrompt: (kind: IrcPromptKind) => void;
  closePrompt: () => void;
  requestSettingsSection: (section: string | null) => void;
  triggerLoginServerConfig: () => void;
  triggerPasteImage: () => void;
  dispatchChatAction: (action: string, arg?: string) => void;
  consumeChatAction: (nonce: number) => void;
  insertIntoComposer: (text: string) => void;
  consumeComposeInsert: (nonce: number) => void;
  reset: () => void;
}

export const useDesktopUiStore = create<DesktopUiState>((set) => ({
  aboutOpen: false,
  aboutTab: 'program',
  commandsOpen: false,
  shortcutsOpen: false,
  promptKind: null,
  requestedSettingsSection: null,
  loginShowServerConfigNonce: 0,
  pasteImageNonce: 0,
  pendingChatAction: null,
  pendingComposeInsert: null,

  openAbout: (tab = 'program') => set({ aboutOpen: true, aboutTab: tab }),
  closeAbout: () => set({ aboutOpen: false }),
  openCommands: () => set({ commandsOpen: true }),
  closeCommands: () => set({ commandsOpen: false }),
  openShortcuts: () => set({ shortcutsOpen: true }),
  closeShortcuts: () => set({ shortcutsOpen: false }),
  openPrompt: (kind) => set({ promptKind: kind }),
  closePrompt: () => set({ promptKind: null }),
  requestSettingsSection: (section) => set({ requestedSettingsSection: section }),
  triggerLoginServerConfig: () =>
    set((s) => ({ loginShowServerConfigNonce: s.loginShowServerConfigNonce + 1 })),
  triggerPasteImage: () => set((s) => ({ pasteImageNonce: s.pasteImageNonce + 1 })),
  dispatchChatAction: (action, arg) =>
    set({ pendingChatAction: { action, arg, nonce: nextNonce++ } }),
  consumeChatAction: (nonce) =>
    set((s) => (s.pendingChatAction?.nonce === nonce ? { pendingChatAction: null } : s)),
  insertIntoComposer: (text) => set({ pendingComposeInsert: { text, nonce: nextNonce++ } }),
  consumeComposeInsert: (nonce) =>
    set((s) => (s.pendingComposeInsert?.nonce === nonce ? { pendingComposeInsert: null } : s)),
  reset: () =>
    set({
      aboutOpen: false,
      aboutTab: 'program',
      commandsOpen: false,
      shortcutsOpen: false,
      promptKind: null,
      requestedSettingsSection: null,
      pendingChatAction: null,
      pendingComposeInsert: null,
    }),
}));
