// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileUp,
  Layers,
  Palette,
  RotateCcw,
  Save,
  Search,
  Sliders,
  Sparkles,
  Trash2,
  Type,
  Wand2,
} from 'lucide-react';
import { COLOR_VARS } from '../hooks/useTheme';
import { nickColor } from '../utils/nickColor';
import { usePrefersDark } from '../utils/prefersDark';
import { getDefault, THEMED_KEYS } from '../utils/settingsRegistry';
import { MAX_THEMES_PER_USER, THEME_NAME_MAX, themeNameError, type ThemePreset } from '../shared/themePresets';
import type { SettingValue } from '../shared/settingsRegistry';
import {
  buildThemeExportBundle,
  generateHarmoniousNickPalette,
  parseThemeImport,
  THEME_GALLERY,
  type GalleryTheme,
  type ParsedThemeImport,
  type ThemeCategoryTag,
} from '../lib/themeGallery';
import {
  CUSTOM_CSS_SNIPPETS,
  type CustomThemeConfig,
  type MessageRowStyle,
  useCustomThemeStore,
  WALLPAPER_PRESETS,
} from '../stores/customTheme';
import { useSettingsStore } from '../stores/settings';
import { useThemesStore } from '../stores/themes';
import { useToastsStore } from '../stores/toasts';
import { ColorListEditor, resolveCssColorToHex, SmartColorControl } from './SmartColorControl';

type StudioTab = 'presets' | 'colors' | 'surfaces' | 'css';

const SUBTLE_BORDER = 'color-mix(in srgb, var(--fg) 14%, var(--border))';
const PANEL_STYLE: React.CSSProperties = {
  background: 'var(--bg-soft)',
  border: `1px solid ${SUBTLE_BORDER}`,
};
const INSET_STYLE: React.CSSProperties = {
  background: 'var(--bg)',
  border: `1px solid ${SUBTLE_BORDER}`,
};

const FONT_PRESETS: readonly { label: string; stack: string }[] = [
  {
    label: 'Input Mono',
    stack: "'Input Mono', 'Input', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  },
  {
    label: 'JetBrains Mono',
    stack: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  },
  {
    label: 'Fira Code',
    stack: "'Fira Code', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  },
  {
    label: 'Cascadia Code',
    stack: "'Cascadia Code', 'Cascadia Mono', Consolas, ui-monospace, monospace",
  },
  {
    label: 'SF Mono / Menlo',
    stack: "'SF Mono', Menlo, Monaco, ui-monospace, monospace",
  },
  {
    label: 'IBM Plex Mono',
    stack: "'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace",
  },
  {
    label: 'System Sans',
    stack: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
];

const COLOR_GROUPS: Array<{
  title: string;
  items: Array<{ key: string; label: string; contrastCheck?: boolean }>;
}> = [
  {
    title: 'Surfaces & Text',
    items: [
      { key: 'look.color.bg', label: 'Window Background' },
      { key: 'look.color.bg_soft', label: 'Soft Surface / Panels' },
      { key: 'look.color.border', label: 'Borders & Dividers' },
      { key: 'look.color.fg', label: 'Primary Text', contrastCheck: true },
      { key: 'look.color.fg_muted', label: 'Muted Text / Timestamps', contrastCheck: true },
      { key: 'look.color.message.alt_bg', label: 'Alternating Row BG' },
      { key: 'look.color.message.alt_fg', label: 'Alternating Row Text', contrastCheck: true },
    ],
  },
  {
    title: 'Brand, Links & Status',
    items: [
      { key: 'look.color.accent', label: 'Accent Color', contrastCheck: true },
      { key: 'look.color.link', label: 'URL & Channel Links', contrastCheck: true },
      { key: 'look.color.good', label: 'Success / Connected', contrastCheck: true },
      { key: 'look.color.warn', label: 'Warning / Away', contrastCheck: true },
      { key: 'look.color.bad', label: 'Error / Danger', contrastCheck: true },
    ],
  },
  {
    title: 'Sidebar & Member Ranks',
    items: [
      { key: 'look.color.buffer.unread', label: 'Unread Channel', contrastCheck: true },
      { key: 'look.color.buffer.highlight', label: 'Mention Highlight', contrastCheck: true },
      { key: 'look.nick.self_color', label: 'Your Own Nick', contrastCheck: true },
      { key: 'look.color.member.owner', label: 'Owner (~)', contrastCheck: true },
      { key: 'look.color.member.admin', label: 'Admin (&)', contrastCheck: true },
      { key: 'look.color.member.op', label: 'Operator (@)', contrastCheck: true },
      { key: 'look.color.member.halfop', label: 'Halfop (%)', contrastCheck: true },
      { key: 'look.color.member.voice', label: 'Voice (+)', contrastCheck: true },
    ],
  },
];

function previewStyleVars(
  effectiveGet: (key: string) => SettingValue | undefined,
  custom: CustomThemeConfig,
): React.CSSProperties {
  const vars: Record<string, string> = {};
  for (const [settingKey, cssVar] of Object.entries(COLOR_VARS)) {
    const val = effectiveGet(settingKey);
    if (val !== undefined) vars[cssVar] = String(val);
  }
  const baseBorder = String(effectiveGet('look.color.border') ?? '#2c2a2e');
  const fg = String(effectiveGet('look.color.fg') ?? '#fcfcfa');
  if (custom.enabled && custom.borderBoostPct > 0) {
    vars['--border'] = `color-mix(in srgb, ${fg} ${custom.borderBoostPct}%, ${baseBorder})`;
  }
  vars['--mono'] = String(effectiveGet('look.font.family') ?? 'monospace');
  vars['fontFamily'] = 'var(--mono)';
  return vars as React.CSSProperties;
}

function previewSwatchDots(values: Record<string, SettingValue>): string[] {
  const keys = [
    'look.color.bg',
    'look.color.bg_soft',
    'look.color.fg',
    'look.color.accent',
    'look.color.good',
    'look.color.bad',
  ];
  return keys.map((k) => {
    const raw = values[k] ?? getDefault(k);
    return typeof raw === 'string' && !raw.startsWith('var(') ? raw : '#a99dec';
  });
}

const LiveThemePreview: React.FC<{
  previewing: GalleryTheme | null;
  effectiveGet: (key: string) => SettingValue | undefined;
  custom: CustomThemeConfig;
  onApplyPreview: () => void;
  onCancelPreview: () => void;
}> = ({ previewing, effectiveGet, custom, onApplyPreview, onCancelPreview }) => {
  const readVal = (key: string): SettingValue | undefined => {
    if (previewing && previewing.values[key] !== undefined) return previewing.values[key];
    return effectiveGet(key);
  };
  const effectiveCustom: CustomThemeConfig =
    previewing?.custom ? { ...custom, ...previewing.custom } : custom;

  const nickPaletteRaw = readVal('look.nick.colors');
  const nickPalette = Array.isArray(nickPaletteRaw)
    ? nickPaletteRaw.map(String).filter(Boolean)
    : [];
  const nickColorOpts = nickPalette.length > 0 ? { palette: nickPalette, stopChars: '_-|`' } : undefined;
  const mircRaw = readVal('look.color.mirc_colors');
  const mirc = Array.isArray(mircRaw) ? mircRaw.map(String) : ['#fff', '#000', '#6799f3', '#a9dc76', '#ff6188'];
  const scopedVars = previewStyleVars(readVal, effectiveCustom);
  const bgStyle: React.CSSProperties = {
    ...scopedVars,
    background: 'var(--bg)',
    color: 'var(--fg)',
    border: `1px solid ${SUBTLE_BORDER}`,
    borderRadius: `${effectiveCustom.enabled && effectiveCustom.radiusPx !== null ? effectiveCustom.radiusPx : 8}px`,
  };

  const aliceColor = nickColor('alice', nickColorOpts) || 'var(--accent)';
  const bobColor = nickColor('bob', nickColorOpts) || 'var(--good)';

  return (
    <div className="rounded-xl overflow-hidden shadow-sm" style={bgStyle}>
      <div
        className="flex items-center justify-between px-3 py-1.5 text-[11px] border-b"
        style={{ background: 'var(--bg-soft)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold" style={{ color: 'var(--fg)' }}>
            #lurker
          </span>
          <span className="truncate text-[10px]" style={{ color: 'var(--fg-muted)' }}>
            Live theme preview · IRCv3 & custom styles
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="w-2 h-2 rounded-full" style={{ background: 'var(--good)' }} />
          <span style={{ color: 'var(--good)' }}>connected</span>
        </div>
      </div>

      <div className="grid grid-cols-12 text-[11px] min-h-[146px]">
        {/* Mini sidebar */}
        <div
          className="col-span-3 hidden sm:flex flex-col justify-between p-2 border-r"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
        >
          <div className="space-y-1">
            <div className="text-[10px] font-semibold uppercase" style={{ color: 'var(--fg-muted)' }}>
              Libera.Chat
            </div>
            <div
              className="px-2 py-0.5 rounded font-medium flex justify-between"
              style={{ background: 'var(--alt-bg)', color: 'var(--fg)' }}
            >
              <span>#lurker</span>
            </div>
            <div className="px-2 py-0.5 flex justify-between" style={{ color: 'var(--buffer-unread)' }}>
              <span>#lobby</span>
              <span className="text-[10px] font-bold">4</span>
            </div>
            <div className="px-2 py-0.5 flex justify-between" style={{ color: 'var(--buffer-highlight)' }}>
              <span>#dev</span>
              <span className="text-[10px] font-bold">1!</span>
            </div>
          </div>
          <div className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>
            TLS · 14ms
          </div>
        </div>

        {/* Mini chat */}
        <div className="col-span-12 sm:col-span-6 p-2.5 space-y-1 flex flex-col justify-between">
          <div className="space-y-1">
            <div className="flex gap-1.5 px-1.5 py-0.5 rounded">
              <span style={{ color: 'var(--fg-muted)' }}>21:04</span>
              <span className="font-semibold" style={{ color: aliceColor }}>
                &lt;alice&gt;
              </span>
              <span>
                Check{' '}
                <span className="underline" style={{ color: 'var(--link)' }}>
                  https://lurkr.chat
                </span>
              </span>
            </div>
            <div
              className="flex gap-1.5 px-1.5 py-0.5 rounded"
              style={{ background: 'var(--alt-bg)', color: 'var(--alt-fg)' }}
            >
              <span style={{ color: 'var(--fg-muted)' }}>21:05</span>
              <span className="font-semibold" style={{ color: bobColor }}>
                &lt;bob&gt;
              </span>
              <span>
                <span style={{ color: mirc[3] || 'var(--good)' }}>clean </span>
                <span style={{ color: mirc[4] || 'var(--bad)' }}>mIRC </span>
                <span style={{ color: mirc[6] || 'var(--accent)' }}>colors!</span>
              </span>
            </div>
            <div
              className="flex gap-1.5 px-1.5 py-0.5 rounded border-l-2"
              style={{
                background: 'color-mix(in srgb, var(--buffer-highlight) 12%, transparent)',
                borderColor: 'var(--buffer-highlight)',
              }}
            >
              <span style={{ color: 'var(--fg-muted)' }}>21:06</span>
              <span className="font-semibold" style={{ color: 'var(--nick-self)' }}>
                &lt;you&gt;
              </span>
              <span>Mention highlight + own nick</span>
            </div>
          </div>

          <div
            className="mt-2 px-2.5 py-1 rounded text-[10px]"
            style={{
              background: 'var(--bg-soft)',
              border: '1px solid var(--border)',
              color: 'var(--fg-muted)',
            }}
          >
            Message #lurker…
          </div>
        </div>

        {/* Mini members */}
        <div
          className="col-span-3 hidden sm:block p-2 border-l space-y-0.5"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}
        >
          <div className="text-[10px] font-semibold mb-1" style={{ color: 'var(--fg-muted)' }}>
            5 members
          </div>
          <div>
            <span style={{ color: 'var(--member-owner)', fontWeight: 700 }}>~</span>
            <span style={{ color: aliceColor }}>founder</span>
          </div>
          <div>
            <span style={{ color: 'var(--member-admin)', fontWeight: 700 }}>&amp;</span>
            <span style={{ color: bobColor }}>admin</span>
          </div>
          <div>
            <span style={{ color: 'var(--member-op)', fontWeight: 700 }}>@</span>
            <span>amiantos</span>
          </div>
          <div>
            <span style={{ color: 'var(--member-halfop)', fontWeight: 700 }}>%</span>
            <span>mod</span>
          </div>
          <div>
            <span style={{ color: 'var(--member-voice)', fontWeight: 700 }}>+</span>
            <span>voice</span>
          </div>
        </div>
      </div>

      {previewing && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs border-t"
          style={{ background: 'var(--bg-soft)', borderColor: 'var(--border)' }}
        >
          <span>
            Previewing starter theme: <strong>{previewing.name}</strong>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancelPreview}
              className="rounded px-2.5 py-1 text-[11px]"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                color: 'var(--fg)',
              }}
            >
              Cancel Preview
            </button>
            <button
              type="button"
              onClick={onApplyPreview}
              className="rounded px-3 py-1 text-[11px] font-semibold"
              style={{ background: 'var(--accent)', color: 'var(--bg)' }}
            >
              Apply Theme
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const ThemeStudio: React.FC = () => {
  const settingsValues = useSettingsStore((s) => s.values);
  const savedThemes = useThemesStore((s) => s.saved);
  const customConfig = useCustomThemeStore((s) => s.config);
  const prefersDark = usePrefersDark();

  const [tab, setTab] = useState<StudioTab>('presets');
  const [showPreview, setShowPreview] = useState(true);
  const [previewGallery, setPreviewGallery] = useState<GalleryTheme | null>(null);
  const [galleryTag, setGalleryTag] = useState<'all' | ThemeCategoryTag>('all');
  const [galleryQuery, setGalleryQuery] = useState('');
  const [newThemeName, setNewThemeName] = useState('');
  const [busy, setBusy] = useState(false);

  // Optimistic local color/value edits so color pickers drag smoothly at 60fps
  const [pendingVals, setPendingVals] = useState<Record<string, SettingValue>>({});
  const commitTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const importFileRef = useRef<HTMLInputElement | null>(null);

  // Import/export modal-less inline state
  const [importText, setImportText] = useState('');
  const [parsedImport, setParsedImport] = useState<ParsedThemeImport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [copiedBundle, setCopiedBundle] = useState(false);

  const themesAll = useMemo(() => useThemesStore.getState().all(), [savedThemes]);
  const activeThemeId = useMemo(
    () => useThemesStore.getState().activeThemeId(),
    [settingsValues, savedThemes],
  );
  const activeTheme = useMemo(
    () => useThemesStore.getState().activeTheme(),
    [settingsValues, savedThemes, activeThemeId],
  );
  const driftKeys = useMemo(
    () => useSettingsStore.getState().themeDriftKeys(),
    [settingsValues, savedThemes, activeThemeId],
  );

  useEffect(() => {
    return () => {
      for (const timer of Object.values(commitTimersRef.current)) {
        clearTimeout(timer);
      }
    };
  }, []);

  const readEffective = (key: string): SettingValue | undefined => {
    if (key in pendingVals) return pendingVals[key];
    return useSettingsStore.getState().effective(key);
  };

  const varLookup = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [settingKey, cssVar] of Object.entries(COLOR_VARS)) {
      const val = readEffective(settingKey);
      if (typeof val === 'string' && !val.startsWith('var(')) {
        out[cssVar] = val;
      }
    }
    return out;
  }, [settingsValues, savedThemes, pendingVals]);

  const commitSettingNow = async (key: string, val: SettingValue) => {
    try {
      await useSettingsStore.getState().setValue(key, val);
    } catch (err: unknown) {
      useToastsStore
        .getState()
        .push(err instanceof Error ? err.message : 'Failed to update theme setting', 'error');
    } finally {
      setPendingVals((cur) => {
        if (!(key in cur)) return cur;
        const copy = { ...cur };
        delete copy[key];
        return copy;
      });
    }
  };

  const setSettingDebounced = (key: string, val: SettingValue, delayMs = 200) => {
    setPendingVals((cur) => ({ ...cur, [key]: val }));
    const cssVar = COLOR_VARS[key];
    if (cssVar && typeof document !== 'undefined') {
      document.documentElement.style.setProperty(cssVar, String(val));
    }
    if (commitTimersRef.current[key]) {
      clearTimeout(commitTimersRef.current[key]);
    }
    commitTimersRef.current[key] = setTimeout(() => {
      delete commitTimersRef.current[key];
      void commitSettingNow(key, val);
    }, delayMs);
  };

  const applyThemePreset = async (id: string) => {
    setBusy(true);
    try {
      await useThemesStore.getState().applyTheme(id);
      setPendingVals({});
      useToastsStore.getState().push('Theme applied', 'success');
    } catch (err: unknown) {
      useToastsStore
        .getState()
        .push(err instanceof Error ? err.message : 'Failed to apply theme', 'error');
    } finally {
      setBusy(false);
    }
  };

  const installAndApplyValues = async (
    name: string,
    values: Record<string, SettingValue>,
    customPatch?: Partial<CustomThemeConfig>,
  ) => {
    setBusy(true);
    try {
      const normalized = name.trim().slice(0, THEME_NAME_MAX) || 'Custom Theme';
      const existing = useThemesStore
        .getState()
        .saved.find((t) => t.name.toLowerCase() === normalized.toLowerCase());

      if (existing) {
        await useThemesStore.getState().update(existing.id, { values });
        await useThemesStore.getState().applyTheme(String(existing.id));
      } else if (
        !themeNameError(normalized) &&
        useThemesStore.getState().saved.length < MAX_THEMES_PER_USER
      ) {
        try {
          const created = await useThemesStore.getState().create(normalized, values);
          await useThemesStore.getState().applyTheme(String(created.id));
        } catch {
          // If server create is unavailable or rejected (e.g. offline/limit), apply as overrides directly
          await useSettingsStore.getState().patchMany(values);
        }
      } else {
        await useSettingsStore.getState().patchMany(values);
      }

      if (customPatch) {
        useCustomThemeStore.getState().setConfig(customPatch);
      }
      setPendingVals({});
      setPreviewGallery(null);
      useToastsStore.getState().push(`Applied "${normalized}"`, 'success');
    } catch (err: unknown) {
      useToastsStore
        .getState()
        .push(err instanceof Error ? err.message : 'Failed to apply preset', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveNewTheme = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newThemeName.trim();
    const err = themeNameError(trimmed);
    if (err) {
      useToastsStore.getState().push(err, 'error');
      return;
    }
    setBusy(true);
    try {
      await useThemesStore.getState().saveCurrentAs(trimmed);
      setNewThemeName('');
      useToastsStore.getState().push(`Saved theme "${trimmed}"`, 'success');
    } catch (ex: unknown) {
      useToastsStore
        .getState()
        .push(ex instanceof Error ? ex.message : 'Failed to save theme', 'error');
    } finally {
      setBusy(false);
    }
  };

  const updateActiveCustomTheme = async (theme: ThemePreset) => {
    if (theme.builtin) return;
    setBusy(true);
    try {
      await useThemesStore.getState().saveCurrentInto(Number(theme.id));
      useToastsStore.getState().push(`Updated "${theme.name}"`, 'success');
    } catch (err: unknown) {
      useToastsStore
        .getState()
        .push(err instanceof Error ? err.message : 'Failed to update theme', 'error');
    } finally {
      setBusy(false);
    }
  };

  const duplicateTheme = async (theme: ThemePreset) => {
    const copyName = `${theme.name} Copy`.slice(0, THEME_NAME_MAX);
    await installAndApplyValues(copyName, { ...theme.values });
  };

  const discardModifications = async () => {
    if (driftKeys.length === 0) return;
    setBusy(true);
    try {
      await useSettingsStore.getState().patchMany({}, driftKeys);
      setPendingVals({});
      useToastsStore.getState().push('Reset modified theme overrides', 'success');
    } catch (err: unknown) {
      useToastsStore
        .getState()
        .push(err instanceof Error ? err.message : 'Failed to reset overrides', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleFavoriteColor = (hex: string) => {
    const currentRaw = readEffective('look.color.favorites');
    const list = Array.isArray(currentRaw) ? currentRaw.map(String) : [];
    const lower = hex.toLowerCase();
    const exists = list.some((c) => c.toLowerCase() === lower);
    const next = exists ? list.filter((c) => c.toLowerCase() !== lower) : [...list, hex];
    void commitSettingNow('look.color.favorites', next);
  };

  const favorites = useMemo(() => {
    const raw = readEffective('look.color.favorites');
    return Array.isArray(raw) ? raw.map(String) : [];
  }, [settingsValues, pendingVals]);

  const filteredGallery = useMemo(() => {
    const q = galleryQuery.trim().toLowerCase();
    return THEME_GALLERY.filter((g) => {
      if (galleryTag !== 'all' && !g.tags.includes(galleryTag)) return false;
      if (!q) return true;
      return (
        g.name.toLowerCase().includes(q) ||
        g.tagline.toLowerCase().includes(q) ||
        g.author.toLowerCase().includes(q) ||
        g.tags.some((t) => t.includes(q))
      );
    });
  }, [galleryTag, galleryQuery]);

  const themeMode = String(readEffective('look.theme.mode') ?? 'single');
  const exportBundleJson = useMemo(() => {
    const snapshot = useThemesStore.getState().snapshotCurrent();
    return JSON.stringify(
      buildThemeExportBundle(activeTheme.name, snapshot, customConfig),
      null,
      2,
    );
  }, [activeTheme, settingsValues, customConfig]);

  const handleParseImport = (raw: string) => {
    setImportText(raw);
    if (!raw.trim()) {
      setParsedImport(null);
      setImportError(null);
      return;
    }
    try {
      setParsedImport(parseThemeImport(raw));
      setImportError(null);
    } catch (err: unknown) {
      setParsedImport(null);
      setImportError(err instanceof Error ? err.message : 'Could not parse theme');
    }
  };

  const downloadExport = () => {
    const slug = (activeTheme.name || 'lurkr-theme')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const blob = new Blob([exportBundleJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug || 'lurkr-theme'}.lurkr-theme.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Studio Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold m-0">Theme Studio</h2>
          <p className="text-xs text-[var(--fg-muted)] m-0">
            Active: <strong className="text-[var(--fg)]">{activeTheme.name}</strong>
            {driftKeys.length > 0 && (
              <span className="ml-1.5 text-[var(--warn)]">
                ({driftKeys.length} unsaved edit{driftKeys.length === 1 ? '' : 's'})
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {driftKeys.length > 0 && (
            <>
              {!activeTheme.builtin && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void updateActiveCustomTheme(activeTheme)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold hover:opacity-90"
                  style={{ background: 'var(--accent)', color: 'var(--bg)' }}
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Changes</span>
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void discardModifications()}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs hover:opacity-90"
                style={INSET_STYLE}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Discard Edits</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs hover:opacity-90"
            style={INSET_STYLE}
          >
            {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{showPreview ? 'Hide Preview' : 'Show Preview'}</span>
          </button>
        </div>
      </div>

      {/* Live Preview */}
      {showPreview && (
        <LiveThemePreview
          previewing={previewGallery}
          effectiveGet={readEffective}
          custom={customConfig}
          onApplyPreview={() => {
            if (previewGallery) {
              void installAndApplyValues(
                previewGallery.name,
                previewGallery.values,
                previewGallery.custom,
              );
            }
          }}
          onCancelPreview={() => setPreviewGallery(null)}
        />
      )}

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap gap-1.5 pb-1 border-b" style={{ borderColor: SUBTLE_BORDER }}>
        {(
          [
            { id: 'presets', label: 'Presets & Gallery', icon: Layers },
            { id: 'colors', label: 'Color Studio', icon: Palette },
            { id: 'surfaces', label: 'Fonts, Surfaces & Wallpaper', icon: Type },
            { id: 'css', label: 'Custom CSS & Import/Export', icon: Code2 },
          ] as Array<{ id: StudioTab; label: string; icon: React.FC<{ className?: string }> }>
        ).map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium cursor-pointer"
              style={
                active
                  ? { background: 'var(--accent)', color: 'var(--bg)' }
                  : { background: 'var(--bg-soft)', color: 'var(--fg-muted)', border: `1px solid ${SUBTLE_BORDER}` }
              }
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: Presets & Gallery */}
      {tab === 'presets' && (
        <div className="space-y-5">
          {/* OS Light/Dark Mapping */}
          <div className="rounded-xl p-3.5 space-y-3" style={PANEL_STYLE}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold">Theme Switching Mode</div>
                <div className="text-[11px] text-[var(--fg-muted)]">
                  Keep one active theme or follow your OS light/dark appearance automatically (OS is currently{' '}
                  <strong>{prefersDark ? 'dark' : 'light'}</strong>).
                </div>
              </div>
              <select
                value={themeMode}
                onChange={(e) => void commitSettingNow('look.theme.mode', e.target.value)}
                className="rounded-lg px-3 py-1.5 text-xs text-[var(--fg)]"
                style={INSET_STYLE}
              >
                <option value="single">One theme everywhere</option>
                <option value="system">Follow OS light / dark</option>
              </select>
            </div>

            {themeMode === 'system' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <label className="space-y-1 text-xs">
                  <span className="text-[var(--fg-muted)] block">Light-mode theme</span>
                  <select
                    value={String(readEffective('look.theme.light') ?? 'light')}
                    onChange={(e) => void commitSettingNow('look.theme.light', e.target.value)}
                    className="w-full rounded-lg px-2.5 py-1.5 text-xs text-[var(--fg)]"
                    style={INSET_STYLE}
                  >
                    {themesAll.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-[var(--fg-muted)] block">Dark-mode theme</span>
                  <select
                    value={String(readEffective('look.theme.dark') ?? 'dark')}
                    onChange={(e) => void commitSettingNow('look.theme.dark', e.target.value)}
                    className="w-full rounded-lg px-2.5 py-1.5 text-xs text-[var(--fg)]"
                    style={INSET_STYLE}
                  >
                    {themesAll.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>

          {/* Built-in & Saved Themes */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)] m-0">
              Built-in & Saved Themes ({themesAll.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {themesAll.map((t) => {
                const isActive = activeThemeId === t.id;
                const dots = previewSwatchDots(t.values);
                return (
                  <div
                    key={t.id}
                    className="rounded-xl p-3 space-y-2.5"
                    style={{
                      background: isActive
                        ? 'color-mix(in srgb, var(--accent) 10%, var(--bg-soft))'
                        : 'var(--bg-soft)',
                      border: isActive
                        ? '1px solid var(--accent)'
                        : `1px solid ${SUBTLE_BORDER}`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {isActive && <Check className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />}
                          <span className="text-xs font-semibold truncate">{t.name}</span>
                        </div>
                        <div className="text-[10px] text-[var(--fg-muted)]">
                          {t.builtin ? 'Built-in' : 'Saved theme'}
                          {isActive && driftKeys.length > 0 ? ' · modified' : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {dots.map((hex, idx) => (
                          <span
                            key={idx}
                            className="w-3 h-3 rounded-full"
                            style={{ background: hex, border: `1px solid ${SUBTLE_BORDER}` }}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {!isActive && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void applyThemePreset(t.id)}
                          className="rounded px-2.5 py-1 text-[11px] font-semibold hover:opacity-90"
                          style={{ background: 'var(--accent)', color: 'var(--bg)' }}
                        >
                          Apply
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void duplicateTheme(t)}
                        className="rounded px-2 py-1 text-[11px] hover:opacity-90"
                        style={INSET_STYLE}
                      >
                        Duplicate
                      </button>
                      {!t.builtin && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void useThemesStore.getState().remove(Number(t.id))}
                          title={`Delete ${t.name}`}
                          className="ml-auto rounded p-1 text-[var(--fg-muted)] hover:text-[var(--bad)]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <form onSubmit={saveNewTheme} className="flex flex-wrap gap-2 pt-1">
              <input
                type="text"
                maxLength={THEME_NAME_MAX}
                value={newThemeName}
                onChange={(e) => setNewThemeName(e.target.value)}
                placeholder="Save current look as custom theme..."
                className="flex-1 min-w-[200px] max-w-sm rounded-lg px-3 py-1.5 text-xs text-[var(--fg)]"
                style={INSET_STYLE}
              />
              <button
                type="submit"
                disabled={busy || !newThemeName.trim()}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--accent)', color: 'var(--bg)' }}
              >
                Save Theme
              </button>
            </form>
          </div>

          {/* Starter Theme Gallery */}
          <div className="space-y-3 pt-2 border-t" style={{ borderColor: SUBTLE_BORDER }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)] m-0">
                  Starter Theme Gallery ({filteredGallery.length} of {THEME_GALLERY.length})
                </h3>
                <p className="text-[11px] text-[var(--fg-muted)] m-0">
                  Preview or one-click install iconic themes (automatically saved & synced to your account).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1"
                  style={INSET_STYLE}
                >
                  <Search className="w-3 h-3 text-[var(--fg-muted)] shrink-0" />
                  <input
                    type="text"
                    value={galleryQuery}
                    onChange={(e) => setGalleryQuery(e.target.value)}
                    placeholder="Filter palettes…"
                    className="w-36 bg-transparent text-xs text-[var(--fg)] focus:outline-none"
                  />
                </div>
                <div className="flex flex-wrap gap-1">
                  {(['all', 'dark', 'light', 'pastel', 'nature', 'retro', 'contrast'] as const).map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setGalleryTag(tag)}
                      className="rounded px-2 py-1 text-[11px] capitalize"
                      style={
                        galleryTag === tag
                          ? { background: 'var(--accent)', color: 'var(--bg)', fontWeight: 600 }
                          : INSET_STYLE
                      }
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {filteredGallery.map((g) => {
                const dots = previewSwatchDots(g.values);
                const isPrev = previewGallery?.id === g.id;
                return (
                  <div
                    key={g.id}
                    className="rounded-xl p-3 space-y-2 flex flex-col justify-between"
                    style={{
                      background: String(g.values['look.color.bg']),
                      color: String(g.values['look.color.fg']),
                      border: isPrev
                        ? `1px solid ${String(g.values['look.color.accent'])}`
                        : `1px solid ${String(g.values['look.color.border'])}`,
                    }}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold truncate">{g.name}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {dots.map((hex, i) => (
                            <span
                              key={i}
                              className="w-2.5 h-2.5 rounded-full"
                              style={{
                                background: hex,
                                border: '1px solid rgba(128,128,128,0.35)',
                              }}
                            />
                          ))}
                        </div>
                      </div>
                      <div
                        className="text-[10.5px] leading-snug"
                        style={{ color: String(g.values['look.color.fg_muted']) }}
                      >
                        {g.tagline}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewGallery(isPrev ? null : g);
                          setShowPreview(true);
                        }}
                        className="rounded px-2 py-1 text-[11px] font-medium"
                        style={{
                          background: String(g.values['look.color.bg_soft']),
                          color: String(g.values['look.color.fg']),
                          border: `1px solid ${String(g.values['look.color.border'])}`,
                        }}
                      >
                        {isPrev ? 'Stop Preview' : 'Preview'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void installAndApplyValues(g.name, g.values, g.custom)
                        }
                        className="rounded px-2.5 py-1 text-[11px] font-semibold"
                        style={{
                          background: String(g.values['look.color.accent']),
                          color: String(g.values['look.color.bg']),
                        }}
                      >
                        Use Theme
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Full Color Studio */}
      {tab === 'colors' && (
        <div className="space-y-5">
          {COLOR_GROUPS.map((group) => (
            <div key={group.title} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)] m-0">
                {group.title}
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                {group.items.map((item) => {
                  const val = String(readEffective(item.key) ?? getDefault(item.key) ?? '#000000');
                  return (
                    <SmartColorControl
                      key={item.key}
                      label={item.label}
                      settingKey={item.key}
                      value={val}
                      contrastAgainst={item.contrastCheck ? String(readEffective('look.color.bg') ?? '#212022') : undefined}
                      varLookup={varLookup}
                      favorites={favorites}
                      onToggleFavorite={toggleFavoriteColor}
                      isModified={useSettingsStore.getState().isModified(item.key)}
                      onChange={(next) => setSettingDebounced(item.key, next)}
                      onReset={() => void useSettingsStore.getState().resetKey(item.key)}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          <ColorListEditor
            title="Nick Color Palette (19 Slots)"
            subtitle="Deterministic colors hashed across IRC users in chat, threads, and member lists."
            colors={
              Array.isArray(readEffective('look.nick.colors'))
                ? (readEffective('look.nick.colors') as string[])
                : ((getDefault('look.nick.colors') as string[]) || [])
            }
            canAddRemove
            onGenerate={() => {
              const accentHex = resolveCssColorToHex(
                String(readEffective('look.color.accent') ?? '#a99dec'),
                varLookup,
              );
              const bgHex = resolveCssColorToHex(
                String(readEffective('look.color.bg') ?? '#212022'),
                varLookup,
              );
              const generated = generateHarmoniousNickPalette(accentHex, bgHex);
              void commitSettingNow('look.nick.colors', generated);
              useToastsStore.getState().push('Generated 19 WCAG-checked nick colors', 'success');
            }}
            onReset={() => void useSettingsStore.getState().resetKey('look.nick.colors')}
            onChange={(next) => setSettingDebounced('look.nick.colors', next, 260)}
          />

          <ColorListEditor
            title="mIRC 16-Color Palette"
            subtitle="Colors used when IRC messages send numeric \\x03 color codes (0–15)."
            labeled
            colors={
              Array.isArray(readEffective('look.color.mirc_colors'))
                ? (readEffective('look.color.mirc_colors') as string[])
                : ((getDefault('look.color.mirc_colors') as string[]) || [])
            }
            onReset={() => void useSettingsStore.getState().resetKey('look.color.mirc_colors')}
            onChange={(next) => setSettingDebounced('look.color.mirc_colors', next, 260)}
          />
        </div>
      )}

      {/* TAB 3: Typography, Surfaces & Wallpaper */}
      {tab === 'surfaces' && (
        <div className="space-y-5">
          {/* Typography */}
          <div className="rounded-xl p-4 space-y-3" style={PANEL_STYLE}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)] m-0">
              Typography & Message Density
            </h3>

            <div className="space-y-2">
              <div className="text-xs font-medium">Font Family Presets</div>
              <div className="flex flex-wrap gap-1.5">
                {FONT_PRESETS.map((fp) => {
                  const cur = String(readEffective('look.font.family') ?? '');
                  const active = cur === fp.stack;
                  return (
                    <button
                      key={fp.label}
                      type="button"
                      onClick={() => void commitSettingNow('look.font.family', fp.stack)}
                      className="rounded px-2.5 py-1 text-xs"
                      style={
                        active
                          ? { background: 'var(--accent)', color: 'var(--bg)', fontWeight: 600 }
                          : INSET_STYLE
                      }
                    >
                      {fp.label}
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                value={String(readEffective('look.font.family') ?? '')}
                onChange={(e) => setSettingDebounced('look.font.family', e.target.value, 300)}
                placeholder="CSS font-family stack"
                className="w-full rounded-lg px-3 py-1.5 text-xs font-mono text-[var(--fg)]"
                style={INSET_STYLE}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <label className="space-y-1 text-xs">
                <span className="text-[var(--fg-muted)] block">Desktop Font Size (px)</span>
                <input
                  type="number"
                  min={9}
                  max={32}
                  value={Number(readEffective('look.font.size') ?? 14)}
                  onChange={(e) =>
                    setSettingDebounced('look.font.size', Math.min(32, Math.max(9, Number(e.target.value) || 14)))
                  }
                  className="w-full rounded-lg px-2.5 py-1.5 text-xs text-[var(--fg)]"
                  style={INSET_STYLE}
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="text-[var(--fg-muted)] block">Font Weight</span>
                <select
                  value={Number(readEffective('look.font.weight') ?? 400)}
                  onChange={(e) => void commitSettingNow('look.font.weight', Number(e.target.value))}
                  className="w-full rounded-lg px-2.5 py-1.5 text-xs text-[var(--fg)]"
                  style={INSET_STYLE}
                >
                  {[200, 300, 400, 500, 600, 700].map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs">
                <span className="text-[var(--fg-muted)] block">Message Layout</span>
                <select
                  value={String(readEffective('look.message.layout') ?? 'modern')}
                  onChange={(e) => void commitSettingNow('look.message.layout', e.target.value)}
                  className="w-full rounded-lg px-2.5 py-1.5 text-xs text-[var(--fg)]"
                  style={INSET_STYLE}
                >
                  <option value="modern">Modern (Compact IRC)</option>
                  <option value="traditional">Traditional</option>
                </select>
              </label>
            </div>
          </div>

          {/* Local Surface Geometry & Glass / Wallpaper */}
          <div className="rounded-xl p-4 space-y-4" style={PANEL_STYLE}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)] m-0 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5" /> Surface Geometry, Glass & Wallpaper
                </h3>
                <p className="text-[11px] text-[var(--fg-muted)] m-0">
                  Saved locally on this device and included in exported theme bundles.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={customConfig.enabled}
                    onChange={(e) => useCustomThemeStore.getState().setConfig({ enabled: e.target.checked })}
                  />
                  <span>Enable custom styles</span>
                </label>
                <button
                  type="button"
                  onClick={() => useCustomThemeStore.getState().reset()}
                  className="rounded px-2.5 py-1 text-[11px] hover:opacity-90"
                  style={INSET_STYLE}
                >
                  Reset Surfaces
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <label className="space-y-1">
                <div className="flex justify-between">
                  <span>Corner Roundness</span>
                  <span className="font-mono text-[var(--fg-muted)]">
                    {customConfig.radiusPx === null ? 'Default' : `${customConfig.radiusPx}px`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={18}
                    value={customConfig.radiusPx ?? 6}
                    onChange={(e) =>
                      useCustomThemeStore.getState().setConfig({ radiusPx: Number(e.target.value) })
                    }
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => useCustomThemeStore.getState().setConfig({ radiusPx: null })}
                    className="rounded px-2 py-0.5 text-[10px]"
                    style={INSET_STYLE}
                  >
                    Auto
                  </button>
                </div>
              </label>

              <label className="space-y-1">
                <div className="flex justify-between">
                  <span>Border Contrast Boost</span>
                  <span className="font-mono text-[var(--fg-muted)]">
                    {customConfig.borderBoostPct}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={35}
                  value={customConfig.borderBoostPct}
                  onChange={(e) =>
                    useCustomThemeStore
                      .getState()
                      .setConfig({ borderBoostPct: Number(e.target.value) })
                  }
                  className="w-full"
                />
              </label>

              <label className="space-y-1">
                <div className="flex justify-between">
                  <span>UI Font Scale</span>
                  <span className="font-mono text-[var(--fg-muted)]">
                    {customConfig.fontScalePct}%
                  </span>
                </div>
                <input
                  type="range"
                  min={75}
                  max={145}
                  step={5}
                  value={customConfig.fontScalePct}
                  onChange={(e) =>
                    useCustomThemeStore.getState().setConfig({ fontScalePct: Number(e.target.value) })
                  }
                  className="w-full"
                />
              </label>

              <label className="space-y-1">
                <span className="block">Message Row Styling</span>
                <div className="flex gap-1.5">
                  {(['flat', 'striped', 'cards'] as MessageRowStyle[]).map((styleMode) => (
                    <button
                      key={styleMode}
                      type="button"
                      onClick={() =>
                        useCustomThemeStore.getState().setConfig({ messageRowStyle: styleMode })
                      }
                      className="flex-1 rounded py-1 text-xs capitalize"
                      style={
                        customConfig.messageRowStyle === styleMode
                          ? { background: 'var(--accent)', color: 'var(--bg)', fontWeight: 600 }
                          : INSET_STYLE
                      }
                    >
                      {styleMode}
                    </button>
                  ))}
                </div>
              </label>
            </div>

            {/* Wallpaper & Glass */}
            <div className="space-y-2.5 pt-2 border-t text-xs" style={{ borderColor: SUBTLE_BORDER }}>
              <div className="font-medium">Wallpaper / Ambient Gradient & Glassmorphism</div>
              <div className="flex flex-wrap gap-1.5">
                {WALLPAPER_PRESETS.map((wp) => (
                  <button
                    key={wp.label}
                    type="button"
                    onClick={() => useCustomThemeStore.getState().setConfig({ wallpaper: wp.value })}
                    className="rounded px-2.5 py-1 text-[11px]"
                    style={
                      customConfig.wallpaper === wp.value
                        ? { background: 'var(--accent)', color: 'var(--bg)', fontWeight: 600 }
                        : INSET_STYLE
                    }
                  >
                    {wp.label}
                  </button>
                ))}
              </div>

              <input
                type="text"
                value={customConfig.wallpaper}
                onChange={(e) =>
                  useCustomThemeStore.getState().setConfig({ wallpaper: e.target.value })
                }
                placeholder="Paste https:// image URL or CSS linear-gradient(...)"
                className="w-full rounded-lg px-3 py-1.5 text-xs font-mono text-[var(--fg)]"
                style={INSET_STYLE}
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <label className="space-y-1">
                  <div className="flex justify-between">
                    <span>Wallpaper Tint Dim</span>
                    <span className="font-mono text-[var(--fg-muted)]">
                      {Math.round(customConfig.wallpaperDim * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={95}
                    value={Math.round(customConfig.wallpaperDim * 100)}
                    onChange={(e) =>
                      useCustomThemeStore
                        .getState()
                        .setConfig({ wallpaperDim: Number(e.target.value) / 100 })
                    }
                    className="w-full"
                  />
                </label>

                <label className="space-y-1">
                  <div className="flex justify-between">
                    <span>Panel Opacity</span>
                    <span className="font-mono text-[var(--fg-muted)]">
                      {Math.round(customConfig.panelOpacity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={40}
                    max={100}
                    value={Math.round(customConfig.panelOpacity * 100)}
                    onChange={(e) =>
                      useCustomThemeStore
                        .getState()
                        .setConfig({ panelOpacity: Number(e.target.value) / 100 })
                    }
                    className="w-full"
                  />
                </label>

                <label className="space-y-1">
                  <div className="flex justify-between">
                    <span>Frosted Glass Blur</span>
                    <span className="font-mono text-[var(--fg-muted)]">{customConfig.blurPx}px</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={24}
                    value={customConfig.blurPx}
                    onChange={(e) =>
                      useCustomThemeStore.getState().setConfig({ blurPx: Number(e.target.value) })
                    }
                    className="w-full"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Custom CSS & Import/Export */}
      {tab === 'css' && (
        <div className="space-y-5">
          {/* Custom CSS */}
          <div className="rounded-xl p-4 space-y-3" style={PANEL_STYLE}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)] m-0 flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5" /> Live Custom CSS
                </h3>
                <p className="text-[11px] text-[var(--fg-muted)] m-0">
                  Inject custom CSS rules targeting Lurkr CSS variables (`--bg`, `--bg-soft`, `--fg`, `--accent`, `.msg-row`, `.modal-card`). Append <code>?safe=1</code> to disable in an emergency.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={customConfig.enabled}
                    onChange={(e) => useCustomThemeStore.getState().setConfig({ enabled: e.target.checked })}
                  />
                  <span>Enabled</span>
                </label>
                {customConfig.customCss && (
                  <button
                    type="button"
                    onClick={() => useCustomThemeStore.getState().setConfig({ customCss: '' })}
                    className="rounded px-2.5 py-1 text-[11px] text-[var(--bad)]"
                    style={INSET_STYLE}
                  >
                    Clear CSS
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {CUSTOM_CSS_SNIPPETS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  title={s.description}
                  onClick={() =>
                    useCustomThemeStore.getState().setConfig({
                      enabled: true,
                      customCss: customConfig.customCss
                        ? `${customConfig.customCss.trimEnd()}\n\n/* ${s.label} */\n${s.css}`
                        : `/* ${s.label} */\n${s.css}`,
                    })
                  }
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px]"
                  style={INSET_STYLE}
                >
                  <Sparkles className="w-3 h-3 text-[var(--accent)]" />
                  <span>+ {s.label}</span>
                </button>
              ))}
            </div>

            <textarea
              rows={9}
              spellCheck={false}
              value={customConfig.customCss}
              onChange={(e) => useCustomThemeStore.getState().setConfig({ customCss: e.target.value })}
              placeholder={`/* Example */\n.msg-row {\n  transition: background 120ms ease;\n}\n.msg-row:hover {\n  background: var(--bg-hover) !important;\n}`}
              className="w-full rounded-lg p-3 text-xs font-mono text-[var(--fg)] focus:outline-none resize-y"
              style={INSET_STYLE}
            />
          </div>

          {/* Import & Export */}
          <div className="rounded-xl p-4 space-y-4" style={PANEL_STYLE}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)] m-0">
                  Import / Export Theme JSON
                </h3>
                <p className="text-[11px] text-[var(--fg-muted)] m-0">
                  Export full Lurkr bundles, or import Lurkr JSON, VS Code themes, or Base16 schemes.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    try {
                      void navigator.clipboard?.writeText?.(exportBundleJson);
                      setCopiedBundle(true);
                      setTimeout(() => setCopiedBundle(false), 1800);
                    } catch {
                      /* ignore clipboard permission issues */
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                  style={INSET_STYLE}
                >
                  {copiedBundle ? <Check className="w-3.5 h-3.5 text-[var(--good)]" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedBundle ? 'Copied JSON' : 'Copy Theme JSON'}</span>
                </button>
                <button
                  type="button"
                  onClick={downloadExport}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
                  style={{ background: 'var(--accent)', color: 'var(--bg)' }}
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .json</span>
                </button>
              </div>
            </div>

            <div className="space-y-2 border-t pt-3" style={{ borderColor: SUBTLE_BORDER }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium">Paste or upload theme JSON</span>
                <div>
                  <input
                    ref={importFileRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      void file.text().then(handleParseImport);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => importFileRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs"
                    style={INSET_STYLE}
                  >
                    <FileUp className="w-3.5 h-3.5" />
                    <span>Load .json File</span>
                  </button>
                </div>
              </div>

              <textarea
                rows={5}
                spellCheck={false}
                value={importText}
                onChange={(e) => handleParseImport(e.target.value)}
                placeholder="Paste a Lurkr theme JSON, VS Code theme JSON, or Base16 scheme JSON..."
                className="w-full rounded-lg p-3 text-xs font-mono text-[var(--fg)] focus:outline-none resize-y"
                style={INSET_STYLE}
              />

              {importError && <p className="text-xs text-[var(--bad)] m-0">{importError}</p>}

              {parsedImport && (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg p-2.5 text-xs"
                  style={INSET_STYLE}
                >
                  <div>
                    Detected <strong>{parsedImport.name}</strong> ({parsedImport.sourceFormat} format,{' '}
                    {Object.keys(parsedImport.values).length} keys
                    {parsedImport.custom ? ' + custom CSS/surface rules' : ''})
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void installAndApplyValues(
                        parsedImport.name,
                        parsedImport.values,
                        parsedImport.custom,
                      ).then(() => {
                        setImportText('');
                        setParsedImport(null);
                      })
                    }
                    className="rounded px-3 py-1 text-xs font-semibold"
                    style={{ background: 'var(--accent)', color: 'var(--bg)' }}
                  >
                    Import & Apply
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
