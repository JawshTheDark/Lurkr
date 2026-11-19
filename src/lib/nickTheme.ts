// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { useSettingsStore } from '../stores/settings';
import { getDefault } from '../utils/settingsRegistry';
import { nickColor } from '../utils/nickColor';

const FALLBACK_MIRC_PALETTE = [
  '#ffffff',
  '#000000',
  '#6799f3',
  '#a9dc76',
  '#ff6188',
  '#ed6c89',
  '#ab9df2',
  '#fc9867',
  '#ffd866',
  '#b3db82',
  '#78dce8',
  '#a0f1ff',
  '#7ba4ff',
  '#ff7494',
  '#7f7f7f',
  '#d2d2d2',
];

export function getMircPalette(): string[] {
  const raw = useSettingsStore.getState().effective('look.color.mirc_colors');
  const def = getDefault('look.color.mirc_colors');
  const base = Array.isArray(def) ? def.map(String) : FALLBACK_MIRC_PALETTE;
  if (!Array.isArray(raw) || raw.length === 0) return base;
  return base.map((fallback, idx) => {
    const val = raw[idx];
    return typeof val === 'string' && val.trim() ? val.trim() : fallback;
  });
}

export function resolveThemedNickColor(
  nick: string | null | undefined,
  isSelf = false,
): string | null {
  if (!nick) return null;
  const settings = useSettingsStore.getState();
  if (isSelf) {
    const selfColor = settings.effective('look.nick.self_color');
    if (typeof selfColor === 'string' && selfColor.trim()) {
      return selfColor.trim();
    }
    return 'var(--fg)';
  }
  if (settings.effective('look.nick.color_hash') === false) {
    return null;
  }
  const fallbackPalette = Array.isArray(getDefault('look.nick.colors'))
    ? (getDefault('look.nick.colors') as string[])
    : ['#a99dec'];
  const paletteRaw = settings.effective('look.nick.colors');
  const palette = Array.isArray(paletteRaw)
    ? paletteRaw.map((c) => String(c).trim()).filter(Boolean)
    : [];
  const stopCharsRaw = settings.effective('look.nick.color_stop_chars');
  const stopChars = typeof stopCharsRaw === 'string' ? stopCharsRaw : '_-|`';
  return nickColor(nick, {
    palette: palette.length > 0 ? palette : fallbackPalette,
    stopChars,
  });
}
