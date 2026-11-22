// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import type { ContextMenuItem } from '../components/ContextMenu';
import { CANONICAL_ORDER } from '../shared/ignoreLevels';
import { useIgnoresStore } from '../stores/ignores';

const LEVEL_LABELS: Record<string, string> = {
  ALL: 'ALL — Hide everything',
  NOHIGHLIGHT: 'NOHIGHLIGHT — Suppress highlights',
  NOUNREAD: 'NOUNREAD — Mute unread counts',
  NONOTIFY: 'NONOTIFY — Mute notifications',
  PUBLIC: 'PUBLIC — Channel messages',
  MSGS: 'MSGS — Direct messages',
};

// Put broad/modifier levels first, then concrete IRC event types in canonical
// order (omitting documented no-op CTCPS, matching IgnoreRulesPanel).
const SUBMENU_LEVELS: string[] = [
  'ALL',
  'NOHIGHLIGHT',
  'NOUNREAD',
  'NONOTIFY',
  ...CANONICAL_ORDER.filter(
    (l) => l !== 'ALL' && l !== 'NOHIGHLIGHT' && l !== 'NOUNREAD' && l !== 'NONOTIFY' && l !== 'CTCPS',
  ),
];

/** Builds a cascading "Ignore ▸" context-menu item with each individual ignore type. */
export function buildIgnoreSubmenuItem(networkId: number, nick: string): ContextMenuItem {
  const mask = `${nick}!*@*`;
  const children: ContextMenuItem[] = [];

  for (const level of SUBMENU_LEVELS) {
    if (level === 'PUBLIC') {
      children.push({ divider: true });
    }
    children.push({
      label: LEVEL_LABELS[level] ?? level,
      danger: level === 'ALL',
      onClick: () => useIgnoresStore.getState().add({ networkId, mask, levels: [level] }),
    });
  }

  return {
    label: 'Ignore',
    danger: true,
    children,
  };
}
