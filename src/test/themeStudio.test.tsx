// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeStudio } from '../components/ThemeStudio';
import { SettingsView } from '../views/SettingsView';
import { MemoryRouter } from 'react-router-dom';
import { LinkedText } from '../components/LinkedText';
import { useTheme } from '../hooks/useTheme';
import { contrastRatio, parseHex } from '../lib/color';
import { resolveThemedNickColor } from '../lib/nickTheme';
import {
  buildThemeExportBundle,
  generateHarmoniousNickPalette,
  parseThemeImport,
  THEME_GALLERY,
} from '../lib/themeGallery';
import { useCustomThemeStore } from '../stores/customTheme';
import { useSettingsStore } from '../stores/settings';
import { useThemesStore } from '../stores/themes';
import { getOption } from '../utils/settingsRegistry';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ThemeHookHarness: React.FC = () => {
  useTheme();
  return null;
};

describe('Theme Engine & Theme Studio', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    window.localStorage.clear();
    useSettingsStore.getState().reset();
    useThemesStore.getState().reset();
    useCustomThemeStore.getState().reset();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    container.remove();
    globalThis.fetch = origFetch;
    document.getElementById('lurkr-custom-theme-css')?.remove();
    document.getElementById('lurkr-custom-theme-surface')?.remove();
    useSettingsStore.getState().reset();
    useThemesStore.getState().reset();
    useCustomThemeStore.getState().reset();
  });

  it('ships valid registry-compliant gallery themes and contrast-safe nick palettes', () => {
    expect(THEME_GALLERY.length).toBeGreaterThanOrEqual(40);
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    for (const preset of THEME_GALLERY) {
      expect(seenIds.has(preset.id)).toBe(false);
      expect(seenNames.has(preset.name.toLowerCase())).toBe(false);
      seenIds.add(preset.id);
      seenNames.add(preset.name.toLowerCase());
      for (const key of Object.keys(preset.values)) {
        expect(getOption(key)?.themed).toBe(true);
      }
      const nickColors = preset.values['look.nick.colors'] as string[];
      expect(Array.isArray(nickColors)).toBe(true);
      expect(nickColors.length).toBe(19);
    }

    const generated = generateHarmoniousNickPalette('#7aa2f7', '#000000');
    expect(generated).toHaveLength(19);
    const bgRgb = parseHex('#000000')!;
    for (const hex of generated) {
      expect(contrastRatio(parseHex(hex)!, bgRgb)).toBeGreaterThanOrEqual(3.2);
    }
  });

  it('parses Lurkr, VS Code, and Base16 theme JSON imports and builds export bundles', () => {
    const bundle = buildThemeExportBundle('Midnight', { 'look.color.bg': '#101018' });
    const parsedLurkr = parseThemeImport(JSON.stringify(bundle));
    expect(parsedLurkr.sourceFormat).toBe('lurkr');
    expect(parsedLurkr.values['look.color.bg']).toBe('#101018');

    const vsCodeParsed = parseThemeImport(
      JSON.stringify({
        name: 'Tokyo Dark',
        colors: {
          'editor.background': '#1a1b26',
          'editor.foreground': '#c0caf5',
          'focusBorder': '#7aa2f7',
        },
      }),
    );
    expect(vsCodeParsed.sourceFormat).toBe('vscode');
    expect(vsCodeParsed.values['look.color.bg']).toBe('#1a1b26');
    expect(vsCodeParsed.values['look.color.accent']).toBe('#7aa2f7');

    const base16Parsed = parseThemeImport(
      JSON.stringify({
        scheme: 'Gruvbox',
        base00: '282828',
        base05: 'ebdbb2',
        base0E: 'd3869b',
      }),
    );
    expect(base16Parsed.sourceFormat).toBe('base16');
    expect(base16Parsed.values['look.color.bg']).toBe('#282828');
    expect(() => parseThemeImport('{bad json')).toThrow();
  });

  it('injects custom CSS, surface radius, border boost, and honors enable/disable toggle', () => {
    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(ThemeHookHarness));
    });

    act(() => {
      useCustomThemeStore.getState().setConfig({
        enabled: true,
        radiusPx: 12,
        borderBoostPct: 20,
        customCss: '.msg-row { letter-spacing: 0.02em; }',
      });
    });

    expect(document.documentElement.style.getPropertyValue('--radius-md')).toBe('12px');
    expect(document.documentElement.style.getPropertyValue('--border')).toContain('color-mix');
    expect(document.getElementById('lurkr-custom-theme-css')?.textContent).toContain(
      'letter-spacing: 0.02em',
    );

    act(() => {
      useCustomThemeStore.getState().setConfig({ enabled: false });
    });
    expect(document.getElementById('lurkr-custom-theme-css')?.textContent || '').toBe('');

    // --accent-fg maximizes WCAG contrast for bright CRT accents vs deep light-theme accents
    act(() => {
      useSettingsStore.setState({ values: { 'look.color.accent': '#39ff7a' }, loaded: true });
    });
    expect(document.documentElement.style.getPropertyValue('--accent-fg')).toBe('#090c0a');

    act(() => {
      useSettingsStore.setState({ values: { 'look.color.accent': '#0969da' }, loaded: true });
    });
    expect(document.documentElement.style.getPropertyValue('--accent-fg')).toBe('#ffffff');
  });

  it('applies themed nick palette, self color, and custom mIRC palette to chat rendering', () => {
    useSettingsStore.setState({
      values: {
        'look.nick.self_color': '#00ffaa',
        'look.nick.colors': ['#ff0088'],
        'look.color.mirc_colors': ['#ffffff', '#000000', '#123456', '#abcdef'],
      },
      loaded: true,
    });

    expect(resolveThemedNickColor('Jawsh', true)).toBe('#00ffaa');
    expect(resolveThemedNickColor('alice', false)).toBe('#ff0088');

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(LinkedText, { text: '\x0303custom-green\x0f' }));
    });
    const styled = container.querySelector('span[style]') as HTMLSpanElement | null;
    expect(styled?.style.color).toBe('rgb(171, 205, 239)');
  });

  it('renders ThemeStudio tabs, installs a gallery theme, and inserts custom CSS snippets', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/themes') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}'));
        return new Response(
          JSON.stringify({
            theme: {
              id: 77,
              name: body.name,
              values: body.values,
              createdAt: '2026-11-18T00:00:00Z',
              updatedAt: '2026-11-18T00:00:00Z',
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/api/themes')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 77,
                name: 'Catppuccin Mocha',
                values: THEME_GALLERY[0].values,
                createdAt: '2026-11-18T00:00:00Z',
                updatedAt: '2026-11-18T00:00:00Z',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/api/settings') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body || '{}'));
        return new Response(
          JSON.stringify({ values: body.changes || {} }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ values: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(ThemeStudio));
    });

    expect(container.textContent).toContain('Theme Studio');
    expect(container.textContent).toContain('Catppuccin Mocha');

    const useButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent === 'Use Theme',
    );
    expect(useButtons.length).toBeGreaterThan(0);

    await act(async () => {
      useButtons[0].click();
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(useThemesStore.getState().activeThemeId()).toBe('77');

    // Switch to Custom CSS & Import/Export tab and insert a snippet
    const cssTab = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Custom CSS'),
    ) as HTMLButtonElement;
    act(() => {
      cssTab.click();
    });

    const snippetBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Terminal Glow'),
    ) as HTMLButtonElement;
    act(() => {
      snippetBtn.click();
    });

    expect(useCustomThemeStore.getState().config.customCss).toContain('text-shadow');
  });

  it('constrains SettingsView height so the Theme Studio and settings panes scroll properly', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ items: [], rules: [], aliases: [], hasPassword: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(MemoryRouter, null, React.createElement(SettingsView)),
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    const outer = container.firstElementChild as HTMLElement | null;
    const main = container.querySelector('main') as HTMLElement | null;
    expect(outer?.className).toContain('h-screen');
    expect(outer?.className).toContain('overflow-hidden');
    expect(main?.className).toContain('min-h-0');
    expect(main?.className).toContain('overflow-y-auto');
    expect(main?.className).toContain('scroll-region');
  });
});
