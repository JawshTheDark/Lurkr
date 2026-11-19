// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';

const STORAGE_KEY = 'lurkr.customTheme.v1';

export type MessageRowStyle = 'flat' | 'striped' | 'cards';

export interface CustomThemeConfig {
  enabled: boolean;
  customCss: string;
  radiusPx: number | null;
  borderBoostPct: number;
  wallpaper: string;
  wallpaperDim: number;
  panelOpacity: number;
  blurPx: number;
  messageRowStyle: MessageRowStyle;
  fontScalePct: number;
}

export const DEFAULT_CUSTOM_THEME: CustomThemeConfig = {
  enabled: true,
  customCss: '',
  radiusPx: null,
  borderBoostPct: 0,
  wallpaper: '',
  wallpaperDim: 0.78,
  panelOpacity: 1,
  blurPx: 0,
  messageRowStyle: 'flat',
  fontScalePct: 100,
};

export interface CssSnippet {
  id: string;
  label: string;
  description: string;
  css: string;
}

export const CUSTOM_CSS_SNIPPETS: readonly CssSnippet[] = [
  {
    id: 'glow-accents',
    label: 'Terminal Glow',
    description: 'Subtle phosphor glow on active channels, links, and badges',
    css: `.msg-link, a {\n  text-shadow: 0 0 8px color-mix(in srgb, var(--link) 45%, transparent);\n}\n.modal-card {\n  box-shadow: 0 0 28px color-mix(in srgb, var(--accent) 22%, transparent);\n}`,
  },
  {
    id: 'rounded-pills',
    label: 'Rounded Buffers & Inputs',
    description: 'Softer pill geometry across sidebar rows, inputs, and dialogs',
    css: `.modal-card {\n  border-radius: 14px !important;\n}\n.buffer-list button, .member-list > div {\n  border-radius: 8px;\n}`,
  },
  {
    id: 'crisp-hairlines',
    label: 'Crisp UI Hairlines',
    description: 'Higher contrast 1px dividers between panels and controls',
    css: `.modal-card, aside, header {\n  border-color: color-mix(in srgb, var(--fg) 18%, var(--border)) !important;\n}`,
  },
  {
    id: 'crt-scanlines',
    label: 'CRT Scanline Overlay',
    description: 'Retro subtle scanline texture over the message viewport',
    css: `.message-list {\n  background-image: repeating-linear-gradient(\n    to bottom,\n    transparent 0px,\n    transparent 2px,\n    color-mix(in srgb, var(--fg) 3%, transparent) 2px,\n    color-mix(in srgb, var(--fg) 3%, transparent) 3px\n  );\n}`,
  },
];

export const WALLPAPER_PRESETS: readonly { label: string; value: string }[] = [
  { label: 'None', value: '' },
  {
    label: 'Midnight Aurora',
    value:
      'radial-gradient(circle at 18% 20%, rgba(169, 157, 236, 0.24), transparent 48%), radial-gradient(circle at 82% 75%, rgba(120, 220, 232, 0.18), transparent 50%), linear-gradient(135deg, #13111c 0%, #1d1a2f 50%, #101622 100%)',
  },
  {
    label: 'Synthwave Horizon',
    value:
      'radial-gradient(circle at 50% 10%, rgba(255, 97, 136, 0.25), transparent 52%), linear-gradient(160deg, #1a1026 0%, #2b133f 55%, #121024 100%)',
  },
  {
    label: 'Nordic Mist',
    value:
      'radial-gradient(circle at 20% 80%, rgba(136, 192, 208, 0.16), transparent 55%), linear-gradient(135deg, #1f2430 0%, #2e3440 60%, #1d222c 100%)',
  },
  {
    label: 'Warm Amber Mesh',
    value:
      'radial-gradient(circle at 80% 20%, rgba(252, 152, 103, 0.2), transparent 45%), linear-gradient(145deg, #1d1816 0%, #28211d 60%, #181412 100%)',
  },
];

function sanitizeConfig(raw: Partial<CustomThemeConfig> | null | undefined): CustomThemeConfig {
  const src = raw && typeof raw === 'object' ? raw : {};
  const clamp = (n: unknown, min: number, max: number, fallback: number): number =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  const rowStyle: MessageRowStyle =
    src.messageRowStyle === 'striped' || src.messageRowStyle === 'cards' ? src.messageRowStyle : 'flat';
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_CUSTOM_THEME.enabled,
    customCss: typeof src.customCss === 'string' ? src.customCss.slice(0, 64_000) : '',
    radiusPx:
      src.radiusPx === null
        ? null
        : typeof src.radiusPx === 'number' && Number.isFinite(src.radiusPx)
          ? Math.min(20, Math.max(0, Math.round(src.radiusPx)))
          : null,
    borderBoostPct: Math.round(clamp(src.borderBoostPct, 0, 35, DEFAULT_CUSTOM_THEME.borderBoostPct)),
    wallpaper: typeof src.wallpaper === 'string' ? src.wallpaper.trim().slice(0, 2048) : '',
    wallpaperDim: clamp(src.wallpaperDim, 0, 0.95, DEFAULT_CUSTOM_THEME.wallpaperDim),
    panelOpacity: clamp(src.panelOpacity, 0.35, 1, DEFAULT_CUSTOM_THEME.panelOpacity),
    blurPx: Math.round(clamp(src.blurPx, 0, 24, DEFAULT_CUSTOM_THEME.blurPx)),
    messageRowStyle: rowStyle,
    fontScalePct: Math.round(clamp(src.fontScalePct, 75, 150, DEFAULT_CUSTOM_THEME.fontScalePct)),
  };
}

function loadFromStorage(): CustomThemeConfig {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CUSTOM_THEME };
    return sanitizeConfig(JSON.parse(raw) as Partial<CustomThemeConfig>);
  } catch {
    return { ...DEFAULT_CUSTOM_THEME };
  }
}

function persistToStorage(cfg: CustomThemeConfig): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // Ignore storage quota or disabled storage errors
  }
}

export function isThemeSafeMode(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('safe') === '1' || params.get('safecss') === '1';
  } catch {
    return false;
  }
}

interface CustomThemeState {
  config: CustomThemeConfig;
  setConfig: (patch: Partial<CustomThemeConfig>) => void;
  replaceConfig: (next: Partial<CustomThemeConfig>) => void;
  reset: () => void;
}

export const useCustomThemeStore = create<CustomThemeState>((set, get) => ({
  config: loadFromStorage(),
  setConfig: (patch) => {
    const next = sanitizeConfig({ ...get().config, ...patch });
    persistToStorage(next);
    set({ config: next });
  },
  replaceConfig: (nextPartial) => {
    const next = sanitizeConfig(nextPartial);
    persistToStorage(next);
    set({ config: next });
  },
  reset: () => {
    const fresh = { ...DEFAULT_CUSTOM_THEME };
    persistToStorage(fresh);
    set({ config: fresh });
  },
}));
