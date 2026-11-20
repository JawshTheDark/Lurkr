// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import type { UpdateStateSnapshot } from '../api';
import { APP_VERSION } from '../lib/appMeta';
import { useToastsStore } from './toasts';
import { useDesktopUiStore } from './desktopUi';

interface UpdaterStoreState {
  snapshot: UpdateStateSnapshot;
  initialized: boolean;
  notifiedVersion: string | null;
  init: () => () => void;
  refreshState: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  setAutoCheck: (enabled: boolean) => Promise<void>;
  openReleasePage: () => Promise<void>;
}

const DEFAULT_SNAPSHOT: UpdateStateSnapshot = {
  status: 'idle',
  currentVersion: APP_VERSION,
  latestVersion: null,
  releaseName: null,
  releaseNotes: null,
  releaseUrl: 'https://github.com/JawshTheDark/Lurkr/releases',
  publishedAt: null,
  assetName: null,
  installMode: 'manual',
  autoInstallSupported: false,
  sha256Verified: false,
  downloadedPath: null,
  downloadedBytes: 0,
  totalBytes: 0,
  percent: 0,
  autoCheck: true,
  checkedAt: null,
  error: null,
};

export const useUpdaterStore = create<UpdaterStoreState>((set, get) => {
  const applySnapshot = (next: UpdateStateSnapshot) => {
    const prevVersion = get().notifiedVersion;
    const isNewAvailable =
      next.status === 'available' &&
      Boolean(next.latestVersion) &&
      next.latestVersion !== prevVersion;

    set({
      snapshot: next,
      ...(isNewAvailable ? { notifiedVersion: next.latestVersion } : {}),
    });

    if (isNewAvailable && next.latestVersion) {
      useToastsStore.getState().push({
        title: `Lurkr v${next.latestVersion} is available`,
        body: 'Click Install or open About Lurkr to download and verify the update.',
        kind: 'notify',
        ttlMs: 10_000,
        action: {
          label: 'Update…',
          onClick: () => {
            useDesktopUiStore.getState().openAbout('program');
          },
        },
      });
    }
  };

  return {
    snapshot: DEFAULT_SNAPSHOT,
    initialized: false,
    notifiedVersion: null,

    init: () => {
      const bridge = window.lurkerDesktop?.updater;
      if (!bridge) return () => {};
      if (!get().initialized) {
        set({ initialized: true });
        void bridge.getState().then(applySnapshot).catch(() => {});
      }
      return bridge.onState(applySnapshot);
    },

    refreshState: async () => {
      const bridge = window.lurkerDesktop?.updater;
      if (!bridge) return;
      const next = await bridge.getState();
      applySnapshot(next);
    },

    checkForUpdates: async () => {
      const bridge = window.lurkerDesktop?.updater;
      if (!bridge) return;
      const next = await bridge.check();
      applySnapshot(next);
    },

    downloadUpdate: async () => {
      const bridge = window.lurkerDesktop?.updater;
      if (!bridge) return;
      const next = await bridge.download();
      applySnapshot(next);
    },

    installUpdate: async () => {
      const bridge = window.lurkerDesktop?.updater;
      if (!bridge) return;
      const next = await bridge.install();
      applySnapshot(next);
    },

    setAutoCheck: async (enabled: boolean) => {
      const bridge = window.lurkerDesktop?.updater;
      if (!bridge) return;
      const next = await bridge.setAutoCheck(enabled);
      applySnapshot(next);
    },

    openReleasePage: async () => {
      const bridge = window.lurkerDesktop?.updater;
      if (bridge) {
        await bridge.openReleasePage();
        return;
      }
      if (window.lurkerDesktop?.openExternal) {
        await window.lurkerDesktop.openExternal(
          get().snapshot.releaseUrl || 'https://github.com/JawshTheDark/Lurkr/releases',
        );
      }
    },
  };
});
