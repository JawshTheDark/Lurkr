// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { registerSessionReset } from './sessionReset';
import { clearPreviewCache } from '../hooks/useLinkPreview';
import { useAdminStore } from './admin';
import { useAuthStore } from './auth';
import { useAvatarSetsStore } from './avatarSets';
import { useBookmarksStore } from './bookmarks';
import { useBuffersStore } from './buffers';
import { useChanlistStore } from './chanlist';
import { useChannelNotifyStore } from './channelNotify';
import { useDataExportStore } from './dataExport';
import { useDccStore } from './dcc';
import { useDraftStore } from './drafts';
import { useFavoritesStore } from './favorites';
import { useHighlightRulesStore } from './highlightRules';
import { useHighlightsStore } from './highlights';
import { useIgnoresStore } from './ignores';
import { useInputHistoryStore } from './inputHistory';
import { useNavHistoryStore } from './navHistory';
import { useNetworksStore } from './networks';
import { useNickNotesStore } from './nickNotes';
import { useNicklistCollapseStore } from './nicklistCollapse';
import { useOperStore } from './oper';
import { usePinsStore } from './pins';
import { useReactionsStore } from './reactions';
import { useRecentBuffersStore } from './recentBuffers';
import { useRedactionsStore } from './redactions';
import { useRelayBotsStore } from './relayBots';
import { useSearchStore } from './search';
import { useSettingsStore } from './settings';
import { useThemesStore } from './themes';
import { useThreadsStore } from './threads';
import { useToastsStore } from './toasts';
import { useUploadsStore } from './uploads';
import { useWhoisStore } from './whois';
import { useDesktopUiStore } from './desktopUi';
import { useAliasesStore } from './aliases';
import { useE2eChannelsStore } from './e2eChannels';

let registered = false;

export function registerAllSessionResets(): void {
  if (registered) return;
  registered = true;
  registerSessionReset(() => {
    useAdminStore.getState().reset();
    useAuthStore.getState().reset();
    useAvatarSetsStore.getState().reset();
    useBookmarksStore.getState().reset();
    useBuffersStore.getState().reset();
    useChanlistStore.getState().reset();
    useChannelNotifyStore.getState().reset();
    useDataExportStore.getState().reset();
    useDccStore.getState().reset();
    useDraftStore.getState().reset();
    useFavoritesStore.getState().reset();
    useHighlightRulesStore.getState().reset();
    useHighlightsStore.getState().reset();
    useIgnoresStore.getState().reset();
    useInputHistoryStore.getState().reset();
    useNavHistoryStore.getState().reset();
    useNetworksStore.getState().reset();
    useNickNotesStore.getState().reset();
    useNicklistCollapseStore.getState().reset();
    useOperStore.getState().reset();
    usePinsStore.getState().reset();
    useReactionsStore.getState().reset();
    useRecentBuffersStore.getState().reset();
    useRedactionsStore.getState().reset();
    useRelayBotsStore.getState().reset();
    useSearchStore.getState().reset();
    useSettingsStore.getState().reset();
    useThemesStore.getState().reset();
    useThreadsStore.getState().reset();
    useToastsStore.getState().clear();
    useUploadsStore.getState().reset();
    useWhoisStore.getState().reset();
    useDesktopUiStore.getState().reset();
    useAliasesStore.getState().reset();
    useE2eChannelsStore.getState().reset();
    clearPreviewCache();
  });
}
