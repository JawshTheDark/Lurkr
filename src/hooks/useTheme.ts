// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settings';
import { useThemesStore } from '../stores/themes';
import { isThemeSafeMode, useCustomThemeStore, type CustomThemeConfig } from '../stores/customTheme';
import { useViewport } from './useViewport';
import { usePrefersDark } from '../utils/prefersDark';
import { parseComputedRgb, parseHex } from '../lib/color';

export const COLOR_VARS: Record<string, string> = {
  'look.color.bg': '--bg',
  'look.color.bg_soft': '--bg-soft',
  'look.color.fg': '--fg',
  'look.color.fg_muted': '--fg-muted',
  'look.color.accent': '--accent',
  'look.color.link': '--link',
  'look.color.good': '--good',
  'look.color.warn': '--warn',
  'look.color.bad': '--bad',
  'look.color.border': '--border',
  'look.color.message.alt_bg': '--alt-bg',
  'look.color.message.alt_fg': '--alt-fg',
  'look.color.buffer.unread': '--buffer-unread',
  'look.color.buffer.highlight': '--buffer-highlight',
  'look.color.member.owner': '--member-owner',
  'look.color.member.admin': '--member-admin',
  'look.color.member.op': '--member-op',
  'look.color.member.halfop': '--member-halfop',
  'look.color.member.voice': '--member-voice',
  'look.nick.self_color': '--nick-self',
};

const SURFACE_STYLE_ID = 'lurkr-custom-theme-surface';
const CUSTOM_CSS_STYLE_ID = 'lurkr-custom-theme-css';

function schemeFromLuma(r: number, g: number, b: number): 'light' | 'dark' {
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? 'light' : 'dark';
}

function colorSchemeFor(bg: string): 'light' | 'dark' {
  const rgb = parseHex(bg);
  if (!rgb) return 'dark';
  return schemeFromLuma(rgb.r, rgb.g, rgb.b);
}

function computedColorScheme(fallbackBg: string): 'light' | 'dark' {
  const resolved = document.body ? getComputedStyle(document.body).backgroundColor : '';
  const rgb = parseComputedRgb(resolved || '');
  if (rgb) return schemeFromLuma(rgb.r, rgb.g, rgb.b);
  return colorSchemeFor(fallbackBg);
}

function upsertStyleTag(id: string, css: string): void {
  const existing = document.getElementById(id) as HTMLStyleElement | null;
  if (!css.trim()) {
    if (existing) existing.textContent = '';
    return;
  }
  const el = existing || document.createElement('style');
  el.id = id;
  el.textContent = css;
  if (!existing) document.head.appendChild(el);
}

function formatWallpaperCss(wallpaper: string): string | null {
  const w = wallpaper.trim();
  if (!w) return null;
  // Block CSS breakouts while allowing gradients and safe image URLs
  if (/[;{}]/.test(w)) return null;
  if (/^(radial-gradient|linear-gradient|conic-gradient)\(/i.test(w)) return w;
  if (/^(https?:\/\/|data:image\/)/i.test(w)) {
    return `url("${w.replace(/"/g, '%22')}")`;
  }
  return null;
}

function buildSurfaceRules(cfg: CustomThemeConfig): string {
  const rules: string[] = [];

  if (cfg.radiusPx !== null) {
    const r = cfg.radiusPx;
    rules.push(`
      .modal-card, .rounded-xl, .rounded-lg, .rounded-md {
        border-radius: ${r}px !important;
      }
      .msg-row {
        border-radius: ${Math.max(2, Math.round(r * 0.75))}px !important;
      }
    `);
  }

  if (cfg.messageRowStyle === 'striped') {
    rules.push(`
      .msg-row.msg-alt:not(.msg-highlight) {
        background: color-mix(in srgb, var(--fg) 3.5%, var(--alt-bg)) !important;
      }
    `);
  } else if (cfg.messageRowStyle === 'cards') {
    const cardRadius = cfg.radiusPx ?? 8;
    rules.push(`
      .msg-row {
        background: color-mix(in srgb, var(--bg-soft) 68%, var(--bg)) !important;
        border: 1px solid color-mix(in srgb, var(--fg) 8%, var(--border));
        border-radius: ${cardRadius}px !important;
        margin-bottom: 4px;
        padding: 7px 10px !important;
      }
    `);
  }

  const wallpaperBg = formatWallpaperCss(cfg.wallpaper);
  if (wallpaperBg) {
    const dimPct = Math.round(cfg.wallpaperDim * 100);
    rules.push(`
      html, body, #root {
        background-color: var(--bg) !important;
        background-image: linear-gradient(
          color-mix(in srgb, var(--bg) ${dimPct}%, transparent),
          color-mix(in srgb, var(--bg) ${dimPct}%, transparent)
        ), ${wallpaperBg} !important;
        background-size: cover !important;
        background-position: center !important;
        background-attachment: fixed !important;
      }
      .chat, .chat > * {
        background-color: transparent;
      }
    `);
  }

  if (cfg.panelOpacity < 0.999 || cfg.blurPx > 0) {
    const bgPct = Math.round(cfg.panelOpacity * 100);
    const softPct = Math.min(98, Math.round(cfg.panelOpacity * 100));
    const blurRule = cfg.blurPx > 0 ? `backdrop-filter: blur(${cfg.blurPx}px); -webkit-backdrop-filter: blur(${cfg.blurPx}px);` : '';
    rules.push(`
      :root {
        --bg-primary: color-mix(in srgb, var(--bg) ${bgPct}%, transparent);
        --bg-secondary: color-mix(in srgb, var(--bg-soft) ${softPct}%, transparent);
      }
      aside, header, .modal-card {
        ${blurRule}
      }
      aside.member-list, .modal-card {
        background: color-mix(in srgb, var(--bg-soft) ${softPct}%, transparent) !important;
      }
    `);
  }

  return rules.join('\n');
}

export function useTheme(): void {
  const values = useSettingsStore((s) => s.values);
  const savedThemes = useThemesStore((s) => s.saved);
  const customConfig = useCustomThemeStore((s) => s.config);
  const { isMobile } = useViewport();
  const prefersDark = usePrefersDark();

  useEffect(() => {
    const settings = useSettingsStore.getState();
    const root = document.documentElement;
    const customEnabled = customConfig.enabled && !isThemeSafeMode();

    for (const [key, cssVar] of Object.entries(COLOR_VARS)) {
      root.style.setProperty(cssVar, String(settings.effective(key)));
    }

    if (customEnabled && customConfig.borderBoostPct > 0) {
      const baseBorder = String(settings.effective('look.color.border'));
      root.style.setProperty(
        '--border',
        `color-mix(in srgb, var(--fg) ${customConfig.borderBoostPct}%, ${baseBorder})`,
      );
    }

    root.style.setProperty('--mono', String(settings.effective('look.font.family')));
    const fontSizeKey = isMobile ? 'look.font.size.mobile' : 'look.font.size';
    const basePx = Number(settings.effective(fontSizeKey)) || 14;
    const scaledPx = customEnabled
      ? Math.max(9, Math.min(36, Math.round((basePx * customConfig.fontScalePct) / 100)))
      : basePx;
    root.style.setProperty('--font-size', `${scaledPx}px`);
    root.style.setProperty('--font-weight', String(settings.effective('look.font.weight')));
    const macSmoothing = !!settings.effective('look.font.smoothing_macos');
    root.style.setProperty(
      '--font-smoothing-webkit',
      macSmoothing ? 'subpixel-antialiased' : 'auto',
    );
    root.style.setProperty('--font-smoothing-moz', 'auto');
    root.style.setProperty(
      '--compact-group-gap',
      `${settings.effective('look.message.compact.group_gap')}px`,
    );
    root.style.setProperty(
      '--compact-line-height',
      String(Number(settings.effective('look.message.compact.line_height')) / 100),
    );
    root.style.setProperty(
      '--compact-indent',
      `${settings.effective('look.message.compact.indent')}ch`,
    );

    if (customEnabled && customConfig.radiusPx !== null) {
      const r = customConfig.radiusPx;
      root.style.setProperty('--radius-md', `${r}px`);
      root.style.setProperty('--radius-sm', `${Math.max(0, Math.round(r / 3))}px`);
      root.style.setProperty('--radius-reaction', `${Math.max(2, Math.round(r * 0.75))}px`);
    } else {
      root.style.removeProperty('--radius-md');
      root.style.removeProperty('--radius-sm');
      root.style.removeProperty('--radius-reaction');
    }

    root.style.colorScheme = computedColorScheme(String(settings.effective('look.color.bg')));

    upsertStyleTag(SURFACE_STYLE_ID, customEnabled ? buildSurfaceRules(customConfig) : '');
    upsertStyleTag(CUSTOM_CSS_STYLE_ID, customEnabled ? customConfig.customCss : '');
  }, [values, savedThemes, customConfig, isMobile, prefersDark]);
}
