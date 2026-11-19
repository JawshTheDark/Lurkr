// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

// What `limit` counts on a `history` request.
//
// The server sizes a page in stored rows; we render CONSOLIDATED rows, folding
// each run of join/part/quit/nick/chghost into one summary line. On a channel
// coming back from a netsplit that mismatch is the difference between a full
// screen and three visible lines — we'd fetch, fold, notice the page was short,
// fetch again, and the user would watch the buffer assemble itself.
// `countBy:'renderable'` asks the server to spend the budget only on rows that
// render as their own line; the presence churn still arrives (consolidation
// needs the whole run to summarize it) but no longer eats the page.
//
// Asking for it is only correct WHEN WE ACTUALLY FOLD. With
// `chat.consolidate_joins` off every event renders as its own line, so 'event'
// is already the right unit — and asking for 'renderable' there would pull the
// server's whole scan window (up to 2000 rows) into a page the user then sees
// in full. Hence the gate: the unit we request must match the unit we render.
//
// The `none` event tier (#666) adds a third answer. There we draw nothing for
// join/part/quit/nick/chghost OR mode, so 'renderable' is no longer strict
// enough — mode rows would still spend budget while rendering as nothing — and
// 'chat' is the matching unit. pageUnitFor() owns that mapping so the native
// clients can't resolve it differently.
//
// There is no unit for the `smart` tier: which events it hides depends on who
// spoke recently in this reader's client, which the server can't know. `smart`
// asks for the same unit `all` would and can still see a short page — pre-#10
// behavior, on the buffers where it's least likely to matter.

import { useSettingsStore } from '../stores/settings.js';
import { isMobileViewport } from '../hooks/useViewport.js';
import { asEventMode, eventModeKey, pageUnitFor } from '../shared/eventFilter.js';
import type { EventMode, PageUnit } from '../shared/eventFilter.js';

export type HistoryCountBy = PageUnit;

export function currentEventMode(): EventMode {
  const settings = useSettingsStore.getState();
  return asEventMode(settings.effective(eventModeKey(isMobileViewport())));
}

export function historyCountBy(): HistoryCountBy {
  const settings = useSettingsStore.getState();
  if (!settings.loaded) return 'event';
  return pageUnitFor(currentEventMode(), !!settings.effective('chat.consolidate_joins'));
}
