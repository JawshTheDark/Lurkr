// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import type { SettingValue } from '../shared/settingsRegistry';
import { getOption } from '../utils/settingsRegistry';
import { THEMED_KEYS } from '../utils/settingsRegistry';
import {
  contrastRatio,
  hsvToRgb,
  mix,
  parseHex,
  relativeLuminance,
  rgbToHsv,
  toHex,
} from './color';
import type { CustomThemeConfig } from '../stores/customTheme';
import { CUSTOM_CSS_SNIPPETS } from '../stores/customTheme';

export type ThemeCategoryTag = 'dark' | 'light' | 'pastel' | 'nature' | 'retro' | 'contrast';

export interface GalleryTheme {
  id: string;
  name: string;
  author: string;
  tagline: string;
  tags: ThemeCategoryTag[];
  values: Record<string, SettingValue>;
  custom?: Partial<CustomThemeConfig>;
}

/**
 * Builds a readable 19-color nick palette anchored to the theme's accent and checked
 * against `bgHex` so generated nick colors stay legible on both dark and light surfaces.
 */
export function generateHarmoniousNickPalette(anchorHex: string, bgHex: string): string[] {
  const anchorRgb = parseHex(anchorHex) ?? { r: 169, g: 157, b: 236 };
  const bgRgb = parseHex(bgHex) ?? { r: 33, g: 32, b: 34 };
  const darkBg = relativeLuminance(bgRgb) < 0.35;
  const baseHsv = rgbToHsv(anchorRgb);
  const sat = Math.max(0.42, Math.min(0.82, baseHsv.s || 0.62));
  const out: string[] = [];

  for (let i = 0; i < 19; i++) {
    const hue = (baseHsv.h + i * (360 / 19)) % 360;
    let val = darkBg ? (i % 2 === 0 ? 0.92 : 0.84) : i % 2 === 0 ? 0.68 : 0.56;
    let rgb = hsvToRgb({ h: hue, s: darkBg ? sat : Math.min(0.88, sat + 0.12), v: val });
    let tries = 0;
    while (contrastRatio(rgb, bgRgb) < 3.4 && tries < 8) {
      val = darkBg ? Math.min(1, val + 0.04) : Math.max(0.25, val - 0.06);
      rgb = darkBg
        ? mix(rgb, { r: 255, g: 255, b: 255 }, 0.14)
        : hsvToRgb({ h: hue, s: Math.min(0.9, sat + 0.15), v: val });
      tries++;
    }
    out.push(toHex(rgb));
  }
  return out;
}

interface PaletteSeed {
  id: string;
  name: string;
  author: string;
  tagline: string;
  tags: ThemeCategoryTag[];
  bg: string;
  bgSoft: string;
  border: string;
  fg: string;
  fgMuted: string;
  altBg?: string;
  altFg: string;
  accent: string;
  link: string;
  good: string;
  warn: string;
  bad: string;
  owner?: string;
  admin?: string;
  op?: string;
  halfop?: string;
  voice?: string;
  nickSeeds?: string[];
  mirc?: string[];
  fontFamily?: string;
  fontWeight?: number;
  custom?: Partial<CustomThemeConfig>;
}

function expandSeed(seed: PaletteSeed): GalleryTheme {
  const nickColors =
    seed.nickSeeds && seed.nickSeeds.length >= 19
      ? seed.nickSeeds.slice(0, 19)
      : generateHarmoniousNickPalette(seed.accent, seed.bg);

  const values: Record<string, SettingValue> = {
    'look.color.bg': seed.bg,
    'look.color.bg_soft': seed.bgSoft,
    'look.color.border': seed.border,
    'look.color.fg': seed.fg,
    'look.color.fg_muted': seed.fgMuted,
    'look.color.message.alt_bg': seed.altBg || 'var(--bg)',
    'look.color.message.alt_fg': seed.altFg,
    'look.color.accent': seed.accent,
    'look.color.link': seed.link,
    'look.color.good': seed.good,
    'look.color.warn': seed.warn,
    'look.color.bad': seed.bad,
    'look.color.buffer.unread': 'var(--accent)',
    'look.color.buffer.highlight': 'var(--warn)',
    'look.color.member.owner': seed.owner || seed.bad,
    'look.color.member.admin': seed.admin || seed.warn,
    'look.color.member.op': seed.op || seed.accent,
    'look.color.member.halfop': seed.halfop || seed.link,
    'look.color.member.voice': seed.voice || seed.good,
    'look.nick.self_color': 'var(--fg)',
    'look.nick.colors': nickColors,
    ...(seed.mirc ? { 'look.color.mirc_colors': seed.mirc } : {}),
    ...(seed.fontFamily ? { 'look.font.family': seed.fontFamily } : {}),
    ...(seed.fontWeight ? { 'look.font.weight': seed.fontWeight } : {}),
  };

  return {
    id: seed.id,
    name: seed.name,
    author: seed.author,
    tagline: seed.tagline,
    tags: seed.tags,
    values,
    ...(seed.custom ? { custom: seed.custom } : {}),
  };
}

const SEEDS: PaletteSeed[] = [
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    author: 'Catppuccin',
    tagline: 'Soothing pastel dark theme with lavender & mauve highlights',
    tags: ['dark'],
    bg: '#1e1e2e',
    bgSoft: '#28283d',
    border: '#383854',
    fg: '#cdd6f4',
    fgMuted: '#a6adc8',
    altFg: '#bac2de',
    accent: '#cba6f7',
    link: '#89b4fa',
    good: '#a6e3a1',
    warn: '#f9e2af',
    bad: '#f38ba8',
    admin: '#fab387',
    halfop: '#94e2d5',
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    author: 'Catppuccin',
    tagline: 'Warm daylight palette with soft contrast and rich pastels',
    tags: ['light'],
    bg: '#eff1f5',
    bgSoft: '#e6e9ef',
    border: '#ccd0da',
    fg: '#4c4f69',
    fgMuted: '#6c6f85',
    altFg: '#5c5f77',
    accent: '#8839ef',
    link: '#1e66f5',
    good: '#40a02b',
    warn: '#df8e1d',
    bad: '#d20f39',
    admin: '#fe640b',
    halfop: '#179299',
  },
  {
    id: 'dracula',
    name: 'Dracula',
    author: 'Dracula Theme',
    tagline: 'Iconic purple, pink, and cyan vampire palette',
    tags: ['dark'],
    bg: '#282a36',
    bgSoft: '#343746',
    border: '#44475a',
    fg: '#f8f8f2',
    fgMuted: '#9aa4c7',
    altFg: '#e2e4f0',
    accent: '#bd93f9',
    link: '#8be9fd',
    good: '#50fa7b',
    warn: '#f1fa8c',
    bad: '#ff5555',
    owner: '#ff79c6',
    admin: '#ffb86c',
    halfop: '#8be9fd',
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    author: 'enkia',
    tagline: 'Deep indigo city lights with electric cyan and periwinkle',
    tags: ['dark'],
    bg: '#1a1b26',
    bgSoft: '#24283b',
    border: '#333952',
    fg: '#c0caf5',
    fgMuted: '#7a88b8',
    altFg: '#a9b1d6',
    accent: '#7aa2f7',
    link: '#7dcfff',
    good: '#9ece6a',
    warn: '#e0af68',
    bad: '#f7768e',
    admin: '#ff9e64',
    halfop: '#73daca',
  },
  {
    id: 'nord',
    name: 'Nord',
    author: 'Arctic Ice Studio',
    tagline: 'Calm polar frost blues and muted slate tones',
    tags: ['dark'],
    bg: '#2e3440',
    bgSoft: '#3b4252',
    border: '#4c566a',
    fg: '#eceff4',
    fgMuted: '#9aa5b8',
    altFg: '#d8dee9',
    accent: '#88c0d0',
    link: '#81a1c1',
    good: '#a3be8c',
    warn: '#ebcb8b',
    bad: '#bf616a',
    admin: '#d08770',
    halfop: '#8fbcbb',
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    author: 'morhetz',
    tagline: 'Retro groove earthy browns with warm amber & aqua accents',
    tags: ['dark', 'retro'],
    bg: '#282828',
    bgSoft: '#3c3836',
    border: '#504945',
    fg: '#ebdbb2',
    fgMuted: '#a89984',
    altFg: '#d5c4a1',
    accent: '#fabd2f',
    link: '#83a598',
    good: '#b8bb26',
    warn: '#fe8019',
    bad: '#fb4934',
    owner: '#fb4934',
    admin: '#fe8019',
    op: '#d3869b',
    halfop: '#8ec07c',
  },
  {
    id: 'gruvbox-light',
    name: 'Gruvbox Light',
    author: 'morhetz',
    tagline: 'Warm parchment background with rich terracotta and forest ink',
    tags: ['light', 'retro'],
    bg: '#fbf1c7',
    bgSoft: '#ebdbb2',
    border: '#d5c4a1',
    fg: '#3c3836',
    fgMuted: '#665c54',
    altFg: '#504945',
    accent: '#b57614',
    link: '#076678',
    good: '#79740e',
    warn: '#af3a03',
    bad: '#9d0006',
    op: '#8f3f71',
    halfop: '#427b58',
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    author: 'Ethan Schoonover',
    tagline: 'Precision engineered deep teal dusk with crisp balanced accents',
    tags: ['dark'],
    bg: '#002b36',
    bgSoft: '#073642',
    border: '#194b57',
    fg: '#93a1a1',
    fgMuted: '#657b83',
    altFg: '#839496',
    accent: '#268bd2',
    link: '#2aa198',
    good: '#859900',
    warn: '#b58900',
    bad: '#dc322f',
    owner: '#d33682',
    admin: '#cb4b16',
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    author: 'Ethan Schoonover',
    tagline: 'Cream linen surface engineered for long glare-free daylight sessions',
    tags: ['light'],
    bg: '#fdf6e3',
    bgSoft: '#eee8d5',
    border: '#dcd5c1',
    fg: '#586e75',
    fgMuted: '#78898f',
    altFg: '#657b83',
    accent: '#268bd2',
    link: '#2aa198',
    good: '#859900',
    warn: '#b58900',
    bad: '#dc322f',
    owner: '#d33682',
    admin: '#cb4b16',
  },
  {
    id: 'one-dark-pro',
    name: 'One Dark Pro',
    author: 'Atom',
    tagline: 'Balanced charcoal slate with clear blue, coral, and sage hues',
    tags: ['dark'],
    bg: '#282c34',
    bgSoft: '#2f343f',
    border: '#3e4451',
    fg: '#abb2bf',
    fgMuted: '#7f848e',
    altFg: '#9da5b4',
    accent: '#61afef',
    link: '#56b6c2',
    good: '#98c379',
    warn: '#e5c07b',
    bad: '#e06c75',
    op: '#c678dd',
    admin: '#d19a66',
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    author: 'Rosé Pine',
    tagline: 'Velvet obsidian with muted rose, gold, and pine mist',
    tags: ['dark'],
    bg: '#191724',
    bgSoft: '#26233a',
    border: '#393552',
    fg: '#e0def4',
    fgMuted: '#908caa',
    altFg: '#c4c0de',
    accent: '#ebbcba',
    link: '#9ccfd8',
    good: '#31748f',
    warn: '#f6c177',
    bad: '#eb6f92',
    op: '#c4a7e7',
  },
  {
    id: 'synthwave-84',
    name: "Synthwave '84",
    author: 'Robb Owen',
    tagline: 'Neon magenta & electric laser cyan over deep arcade plum',
    tags: ['dark', 'retro'],
    bg: '#241b2f',
    bgSoft: '#312542',
    border: '#4d3866',
    fg: '#f4eeff',
    fgMuted: '#a995c9',
    altFg: '#d8ccf0',
    accent: '#ff7edb',
    link: '#36f9f6',
    good: '#72f1b8',
    warn: '#fede5d',
    bad: '#fe4450',
    admin: '#ff8b39',
    custom: {
      customCss: CUSTOM_CSS_SNIPPETS[0].css,
      borderBoostPct: 12,
    },
  },
  {
    id: 'crt-phosphor',
    name: 'CRT Phosphor Green',
    author: 'Lurkr Community',
    tagline: 'Classic green phosphor mainframe terminal vibe',
    tags: ['dark', 'retro', 'contrast'],
    bg: '#08110b',
    bgSoft: '#0f1f14',
    border: '#1d4429',
    fg: '#98f5b1',
    fgMuted: '#53a86b',
    altFg: '#7ce098',
    accent: '#39ff7a',
    link: '#6effd2',
    good: '#39ff7a',
    warn: '#d8ff66',
    bad: '#ff5c77',
    custom: {
      customCss: CUSTOM_CSS_SNIPPETS[3].css,
      borderBoostPct: 14,
      radiusPx: 2,
    },
  },
  {
    id: 'oled-black',
    name: 'OLED Pitch Black',
    author: 'Lurkr Community',
    tagline: 'True #000000 canvas with razor-sharp contrast and crisp borders',
    tags: ['dark', 'contrast'],
    bg: '#000000',
    bgSoft: '#0f0f12',
    border: '#2c2c34',
    fg: '#ffffff',
    fgMuted: '#9e9ea9',
    altFg: '#dcdce2',
    accent: '#60a5fa',
    link: '#38bdf8',
    good: '#4ade80',
    warn: '#facc15',
    bad: '#fb7185',
    custom: {
      borderBoostPct: 18,
    },
  },
  {
    id: 'catppuccin-frappe',
    name: 'Catppuccin Frappé',
    author: 'Catppuccin',
    tagline: 'Cozy muted slate blue with soft lavender and flamingo accents',
    tags: ['dark', 'pastel'],
    bg: '#303446',
    bgSoft: '#3b4056',
    border: '#51576d',
    fg: '#c6d0f5',
    fgMuted: '#a5adce',
    altFg: '#b5bfe2',
    accent: '#babbf1',
    link: '#8caaee',
    good: '#a6d189',
    warn: '#e5c890',
    bad: '#e78284',
    admin: '#ef9f76',
    halfop: '#81c8be',
  },
  {
    id: 'catppuccin-macchiato',
    name: 'Catppuccin Macchiato',
    author: 'Catppuccin',
    tagline: 'Balanced twilight indigo with crisp pastel readability',
    tags: ['dark', 'pastel'],
    bg: '#24273a',
    bgSoft: '#2d3149',
    border: '#494d64',
    fg: '#cad3f5',
    fgMuted: '#a5adcb',
    altFg: '#b8c0e0',
    accent: '#c6a0f6',
    link: '#8aadf4',
    good: '#a6da95',
    warn: '#eed49f',
    bad: '#ed8796',
    admin: '#f5a97f',
    halfop: '#8bd5ca',
  },
  {
    id: 'tokyo-night-storm',
    name: 'Tokyo Night Storm',
    author: 'enkia',
    tagline: 'Brighter slate midnight sky with neon sky-blue and mint',
    tags: ['dark'],
    bg: '#24283b',
    bgSoft: '#2e334c',
    border: '#414868',
    fg: '#c0caf5',
    fgMuted: '#828bb8',
    altFg: '#a9b1d6',
    accent: '#7aa2f7',
    link: '#7dcfff',
    good: '#9ece6a',
    warn: '#e0af68',
    bad: '#f7768e',
    admin: '#ff9e64',
    halfop: '#73daca',
  },
  {
    id: 'tokyo-night-day',
    name: 'Tokyo Night Day',
    author: 'enkia',
    tagline: 'Cool alabaster daylight surface with vibrant cobalt and teal',
    tags: ['light'],
    bg: '#e1e2e7',
    bgSoft: '#d5d6db',
    border: '#b8bac4',
    fg: '#3760bf',
    fgMuted: '#6172b0',
    altFg: '#4c598c',
    accent: '#2e7de9',
    link: '#007197',
    good: '#587539',
    warn: '#8c6c3e',
    bad: '#f52a65',
    admin: '#b15c00',
    halfop: '#118c74',
  },
  {
    id: 'rose-pine-moon',
    name: 'Rosé Pine Moon',
    author: 'Rosé Pine',
    tagline: 'Moonlit slate violet with warm gold and iris tones',
    tags: ['dark', 'pastel'],
    bg: '#232136',
    bgSoft: '#2e2b45',
    border: '#44415a',
    fg: '#e0def4',
    fgMuted: '#908caa',
    altFg: '#c8c4e4',
    accent: '#ea9a97',
    link: '#9ccfd8',
    good: '#3e8fb0',
    warn: '#f6c177',
    bad: '#eb6f92',
    op: '#c4a7e7',
  },
  {
    id: 'rose-pine-dawn',
    name: 'Rosé Pine Dawn',
    author: 'Rosé Pine',
    tagline: 'Warm linen paper with soft rose, pine teal, and iris accents',
    tags: ['light', 'pastel'],
    bg: '#faf4ed',
    bgSoft: '#f2e9e1',
    border: '#dfdad9',
    fg: '#575279',
    fgMuted: '#797593',
    altFg: '#676186',
    accent: '#d7827e',
    link: '#286983',
    good: '#56949f',
    warn: '#ea9d34',
    bad: '#b4637a',
    op: '#907aa9',
  },
  {
    id: 'kanagawa-wave',
    name: 'Kanagawa Wave',
    author: 'rebelot',
    tagline: 'Sumi-e ink midnight blue inspired by Hokusai woodblocks',
    tags: ['dark', 'nature'],
    bg: '#1f1f28',
    bgSoft: '#2a2a37',
    border: '#363646',
    fg: '#dcd7ba',
    fgMuted: '#938aa9',
    altFg: '#c8c093',
    accent: '#7e9cd8',
    link: '#7fb4ca',
    good: '#98bb6c',
    warn: '#e6c384',
    bad: '#e46876',
    admin: '#ffa066',
    op: '#957fb8',
  },
  {
    id: 'kanagawa-dragon',
    name: 'Kanagawa Dragon',
    author: 'rebelot',
    tagline: 'Charred obsidian ink with warm parchment text and moss accents',
    tags: ['dark', 'nature'],
    bg: '#181616',
    bgSoft: '#242120',
    border: '#393836',
    fg: '#c5c9c5',
    fgMuted: '#8a8980',
    altFg: '#a6a69c',
    accent: '#8ba4b0',
    link: '#8ea4a2',
    good: '#87a987',
    warn: '#c4b28a',
    bad: '#c4746e',
    op: '#a292a3',
  },
  {
    id: 'everforest-dark',
    name: 'Everforest Dark',
    author: 'sainnhe',
    tagline: 'Soft pine canopy greens on restful warm forest slate',
    tags: ['dark', 'nature'],
    bg: '#272e33',
    bgSoft: '#323c41',
    border: '#495156',
    fg: '#d3c6aa',
    fgMuted: '#9da9a0',
    altFg: '#b9b49f',
    accent: '#a7c080',
    link: '#7fbbb3',
    good: '#a7c080',
    warn: '#dbbc7f',
    bad: '#e67e80',
    admin: '#e69875',
    op: '#d699b6',
  },
  {
    id: 'everforest-light',
    name: 'Everforest Light',
    author: 'sainnhe',
    tagline: 'Gentle cream parchment with sage green and warm terracotta',
    tags: ['light', 'nature'],
    bg: '#fdf6e3',
    bgSoft: '#f3ead3',
    border: '#dfd6be',
    fg: '#5c6a72',
    fgMuted: '#829181',
    altFg: '#6c7a7a',
    accent: '#8da101',
    link: '#3a94c5',
    good: '#8da101',
    warn: '#dfa000',
    bad: '#f85552',
    admin: '#f57d26',
    op: '#df69ba',
  },
  {
    id: 'ayu-dark',
    name: 'Ayu Dark',
    author: 'Ayu',
    tagline: 'Sleek deep ink black with tangerine gold and crisp cyan',
    tags: ['dark'],
    bg: '#0b0e14',
    bgSoft: '#131721',
    border: '#252c3b',
    fg: '#bfbdb6',
    fgMuted: '#7a808d',
    altFg: '#acb6bf',
    accent: '#e6b450',
    link: '#39bae6',
    good: '#7fd962',
    warn: '#ffb454',
    bad: '#d95757',
    op: '#d2a6ff',
  },
  {
    id: 'ayu-mirage',
    name: 'Ayu Mirage',
    author: 'Ayu',
    tagline: 'Mid-tone slate ocean with warm marigold and seafoam highlights',
    tags: ['dark'],
    bg: '#1f2430',
    bgSoft: '#272e3e',
    border: '#384157',
    fg: '#cccac2',
    fgMuted: '#8a919e',
    altFg: '#b8b7b0',
    accent: '#ffcc66',
    link: '#73d0ff',
    good: '#d5ff80',
    warn: '#ffd173',
    bad: '#f28779',
    op: '#dfbfff',
  },
  {
    id: 'ayu-light',
    name: 'Ayu Light',
    author: 'Ayu',
    tagline: 'Bright crisp paper white with bold tangerine orange accents',
    tags: ['light'],
    bg: '#fafafa',
    bgSoft: '#f0f1f3',
    border: '#dcdedf',
    fg: '#5c6166',
    fgMuted: '#8a9199',
    altFg: '#6e747a',
    accent: '#ff9940',
    link: '#399ee6',
    good: '#86b300',
    warn: '#f2ae49',
    bad: '#f07171',
    op: '#a37acc',
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    author: 'Sarah Drasner',
    tagline: 'Deep midnight marine tailored for late-night contrast clarity',
    tags: ['dark'],
    bg: '#011627',
    bgSoft: '#0b253a',
    border: '#1d3b53',
    fg: '#d6deeb',
    fgMuted: '#7f93a8',
    altFg: '#b8c7d9',
    accent: '#82aaff',
    link: '#7fdbca',
    good: '#addb67',
    warn: '#ecc48d',
    bad: '#ef5350',
    op: '#c792ea',
  },
  {
    id: 'night-owl-light',
    name: 'Night Owl Light',
    author: 'Sarah Drasner',
    tagline: 'Crisp studio ivory with deep ocean teal and violet syntax',
    tags: ['light'],
    bg: '#fbfbfb',
    bgSoft: '#f0f0f0',
    border: '#d9d9d9',
    fg: '#403f53',
    fgMuted: '#7a8181',
    altFg: '#535269',
    accent: '#4876d6',
    link: '#0c969b',
    good: '#2aa298',
    warn: '#c96765',
    bad: '#de3d3b',
    op: '#994cc3',
  },
  {
    id: 'moonlight-ii',
    name: 'Moonlight II',
    author: 'atomiks',
    tagline: 'Lush twilight navy with sky-cyan, coral, and pale violet glow',
    tags: ['dark'],
    bg: '#222436',
    bgSoft: '#2a2e45',
    border: '#3b4162',
    fg: '#c8d3f5',
    fgMuted: '#828bb8',
    altFg: '#a9b8e8',
    accent: '#82aaff',
    link: '#86e1fc',
    good: '#c3e88d',
    warn: '#ffc777',
    bad: '#ff757f',
    op: '#c099ff',
  },
  {
    id: 'palenight',
    name: 'Material Palenight',
    author: 'Mattia Astorino',
    tagline: 'Velvet indigo material tones with pastel cyan & orchid accents',
    tags: ['dark', 'pastel'],
    bg: '#292d3e',
    bgSoft: '#34394e',
    border: '#484f6b',
    fg: '#bfc7d5',
    fgMuted: '#8791a8',
    altFg: '#a6accd',
    accent: '#c792ea',
    link: '#89ddff',
    good: '#c3e88d',
    warn: '#ffcb6b',
    bad: '#f07178',
    admin: '#f78c6c',
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark Default',
    author: 'GitHub',
    tagline: 'Familiar deep charcoal-ink with sharp sky-blue highlights',
    tags: ['dark'],
    bg: '#0d1117',
    bgSoft: '#161b22',
    border: '#30363d',
    fg: '#e6edf3',
    fgMuted: '#8b949e',
    altFg: '#c9d1d9',
    accent: '#58a6ff',
    link: '#79c0ff',
    good: '#3fb950',
    warn: '#d29922',
    bad: '#f85149',
    op: '#bc8cff',
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    author: 'GitHub',
    tagline: 'Ultra-clean high-legibility white with crisp slate borders',
    tags: ['light'],
    bg: '#ffffff',
    bgSoft: '#f6f8fa',
    border: '#d0d7de',
    fg: '#1f2328',
    fgMuted: '#656d76',
    altFg: '#32383f',
    accent: '#0969da',
    link: '#0969da',
    good: '#1a7f37',
    warn: '#9a6700',
    bad: '#cf222e',
    op: '#8250df',
  },
  {
    id: 'vesper',
    name: 'Vesper',
    author: 'Rauno Freiberg',
    tagline: 'Minimalist near-black espresso with warm apricot and seafoam',
    tags: ['dark'],
    bg: '#101010',
    bgSoft: '#191919',
    border: '#2c2c2c',
    fg: '#ffffff',
    fgMuted: '#8e8e8e',
    altFg: '#d4d4d4',
    accent: '#ffc799',
    link: '#99ffe4',
    good: '#99ffe4',
    warn: '#ffc799',
    bad: '#ff8080',
  },
  {
    id: 'poimandres',
    name: 'Poimandres',
    author: 'drcmda',
    tagline: 'Minimal dark obsidian paired with soothing mint-teal and blue',
    tags: ['dark', 'pastel'],
    bg: '#1b1e28',
    bgSoft: '#252936',
    border: '#353b4d',
    fg: '#e4f0fb',
    fgMuted: '#8992aa',
    altFg: '#a6accd',
    accent: '#5de4c7',
    link: '#89ddff',
    good: '#5de4c7',
    warn: '#fffac2',
    bad: '#d0679d',
    op: '#add7ff',
  },
  {
    id: 'cobalt2',
    name: 'Cobalt2',
    author: 'Wes Bos',
    tagline: 'Deep sapphire navy with punchy sunshine yellow & electric cyan',
    tags: ['dark', 'contrast'],
    bg: '#193549',
    bgSoft: '#1f4662',
    border: '#2f6185',
    fg: '#ffffff',
    fgMuted: '#99b8d1',
    altFg: '#d6e7f5',
    accent: '#ffc600',
    link: '#80ffbb',
    good: '#3ad900',
    warn: '#ffc600',
    bad: '#ff628c',
    admin: '#ff9d00',
  },
  {
    id: 'monokai-classic',
    name: 'Monokai Classic',
    author: 'Wimer Hazenberg',
    tagline: 'Original 2006 TextMate charcoal olive with punchy lime and magenta',
    tags: ['dark', 'retro'],
    bg: '#272822',
    bgSoft: '#35362e',
    border: '#49483e',
    fg: '#f8f8f2',
    fgMuted: '#9c9883',
    altFg: '#e2e2dc',
    accent: '#a6e22e',
    link: '#66d9ef',
    good: '#a6e22e',
    warn: '#e6db74',
    bad: '#f92672',
    op: '#ae81ff',
    admin: '#fd971f',
  },
  {
    id: 'horizon-dark',
    name: 'Horizon Dark',
    author: 'Jonathan Olaleye',
    tagline: 'Warm obsidian dusk with coral sunset pink and amber highlights',
    tags: ['dark'],
    bg: '#1c1e26',
    bgSoft: '#252833',
    border: '#3a3e4f',
    fg: '#e0e0e4',
    fgMuted: '#9497a6',
    altFg: '#c7c8d1',
    accent: '#e95678',
    link: '#26bbd9',
    good: '#29d398',
    warn: '#fab795',
    bad: '#f43e5c',
    op: '#ee64ac',
  },
  {
    id: 'zenburn',
    name: 'Zenburn',
    author: 'Jani Nurminen',
    tagline: 'Low-contrast sage charcoal engineered for zero eye strain',
    tags: ['dark', 'retro', 'nature'],
    bg: '#3f3f3f',
    bgSoft: '#494949',
    border: '#5c5c5c',
    fg: '#dcdccc',
    fgMuted: '#a0a092',
    altFg: '#c8c8b6',
    accent: '#f0dfaf',
    link: '#8cd0d3',
    good: '#7f9f7f',
    warn: '#e0cf9f',
    bad: '#cc9393',
    admin: '#dfaf8f',
  },
  {
    id: 'papercolor-light',
    name: 'PaperColor Light',
    author: 'NLKNguyen',
    tagline: 'Material design daylight paper inspired by Google Material inks',
    tags: ['light', 'contrast'],
    bg: '#eeeeee',
    bgSoft: '#e2e2e2',
    border: '#c6c6c6',
    fg: '#333333',
    fgMuted: '#666666',
    altFg: '#444444',
    accent: '#005f87',
    link: '#0087af',
    good: '#008700',
    warn: '#d75f00',
    bad: '#af0000',
    op: '#8700af',
  },
  {
    id: 'amber-crt',
    name: 'Amber Monochrome CRT',
    author: 'Lurkr Community',
    tagline: 'Warm 1980s P3 amber-phosphor terminal glow',
    tags: ['dark', 'retro', 'contrast'],
    bg: '#120b03',
    bgSoft: '#1e1306',
    border: '#422809',
    fg: '#ffb84d',
    fgMuted: '#b87b24',
    altFg: '#e8a238',
    accent: '#ffcc66',
    link: '#ffe08a',
    good: '#ffc94d',
    warn: '#ff9433',
    bad: '#ff524d',
    custom: {
      customCss: CUSTOM_CSS_SNIPPETS[3].css,
      borderBoostPct: 14,
      radiusPx: 2,
    },
  },
  {
    id: 'c64-retro',
    name: 'Commodore 64 Blue',
    author: 'Lurkr Community',
    tagline: 'Nostalgic PETSCII deep royal screen with light sky border vibes',
    tags: ['dark', 'retro'],
    bg: '#2b2478',
    bgSoft: '#3b3396',
    border: '#6c63cc',
    fg: '#b8b2ff',
    fgMuted: '#8c85e0',
    altFg: '#d0ccff',
    accent: '#9cf5ff',
    link: '#fff080',
    good: '#9ef593',
    warn: '#ffe975',
    bad: '#ff8a8a',
    custom: {
      borderBoostPct: 20,
      radiusPx: 0,
    },
  },
  {
    id: 'cyberpunk-edgerunner',
    name: 'Cyberpunk Edgerunner',
    author: 'Lurkr Community',
    tagline: 'High-voltage electric yellow & neon hot-cyan over night-city black',
    tags: ['dark', 'retro', 'contrast'],
    bg: '#0d0c14',
    bgSoft: '#171524',
    border: '#342c4d',
    fg: '#f7f4ff',
    fgMuted: '#9992b8',
    altFg: '#dcd5f2',
    accent: '#fcee0a',
    link: '#00f0ff',
    good: '#00ff9f',
    warn: '#fcee0a',
    bad: '#ff0055',
    custom: {
      customCss: CUSTOM_CSS_SNIPPETS[0].css,
      borderBoostPct: 14,
    },
  },
  {
    id: 'high-contrast-midnight',
    name: 'High Contrast Midnight',
    author: 'Lurkr Community',
    tagline: 'Maximum accessibility contrast with crisp white outlines',
    tags: ['dark', 'contrast'],
    bg: '#06080c',
    bgSoft: '#11161f',
    border: '#4f5d75',
    fg: '#ffffff',
    fgMuted: '#c2ccdb',
    altFg: '#edf2f7',
    accent: '#7dd3fc',
    link: '#38bdf8',
    good: '#4ade80',
    warn: '#fde047',
    bad: '#fb7185',
    custom: {
      borderBoostPct: 24,
    },
  },
];

export const THEME_GALLERY: readonly GalleryTheme[] = SEEDS.map(expandSeed);

export interface LurkrThemeBundle {
  format: 'lurkr-theme';
  version: 1;
  name: string;
  values: Record<string, SettingValue>;
  custom?: Partial<CustomThemeConfig>;
}

export function buildThemeExportBundle(
  name: string,
  values: Record<string, SettingValue>,
  custom?: CustomThemeConfig,
): LurkrThemeBundle {
  const cleanValues: Record<string, SettingValue> = {};
  for (const key of THEMED_KEYS) {
    if (values[key] !== undefined) {
      cleanValues[key] = Array.isArray(values[key]) ? [...values[key]] : values[key];
    }
  }
  return {
    format: 'lurkr-theme',
    version: 1,
    name: name.trim() || 'Custom Lurkr Theme',
    values: cleanValues,
    ...(custom ? { custom } : {}),
  };
}

export interface ParsedThemeImport {
  name: string;
  values: Record<string, SettingValue>;
  custom?: Partial<CustomThemeConfig>;
  sourceFormat: 'lurkr' | 'vscode' | 'base16';
}

function mapBase16(obj: Record<string, unknown>): ParsedThemeImport | null {
  const get = (k: string): string | null => {
    const v = obj[k];
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    if (!trimmed) return null;
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  };
  const bg = get('base00');
  const fg = get('base05');
  if (!bg || !fg) return null;
  const bgSoft = get('base01') || bg;
  const border = get('base02') || bgSoft;
  const fgMuted = get('base03') || get('base04') || fg;
  const bad = get('base08') || '#ff6188';
  const warn = get('base0A') || get('base09') || '#ffd866';
  const good = get('base0B') || '#a9dc76';
  const link = get('base0C') || get('base0D') || '#78dce8';
  const accent = get('base0E') || get('base0D') || '#ab9df2';
  const values: Record<string, SettingValue> = {
    'look.color.bg': bg,
    'look.color.bg_soft': bgSoft,
    'look.color.border': border,
    'look.color.fg': fg,
    'look.color.fg_muted': fgMuted,
    'look.color.message.alt_fg': get('base04') || fgMuted,
    'look.color.accent': accent,
    'look.color.link': link,
    'look.color.good': good,
    'look.color.warn': warn,
    'look.color.bad': bad,
    'look.color.member.owner': bad,
    'look.color.member.admin': get('base09') || warn,
    'look.color.member.op': accent,
    'look.color.member.halfop': link,
    'look.color.member.voice': good,
    'look.nick.colors': generateHarmoniousNickPalette(accent, bg),
  };
  return {
    name: String(obj.scheme || obj.name || 'Imported Base16 Theme').slice(0, 40),
    values,
    sourceFormat: 'base16',
  };
}

function mapVsCode(obj: Record<string, unknown>): ParsedThemeImport | null {
  const colors = obj.colors;
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return null;
  const c = colors as Record<string, unknown>;
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const val = c[k];
      if (typeof val === 'string' && parseHex(val.trim())) return val.trim().slice(0, 7);
    }
    return undefined;
  };
  const bg = pick('editor.background', 'sideBar.background');
  const fg = pick('editor.foreground', 'foreground');
  if (!bg || !fg) return null;
  const bgSoft = pick('sideBar.background', 'editorWidget.background', 'list.hoverBackground') || bg;
  const accent = pick('focusBorder', 'textLink.foreground', 'button.background') || '#a99dec';
  const link = pick('textLink.foreground', 'terminal.ansiCyan', 'terminal.ansiBlue') || accent;
  const good = pick('terminal.ansiGreen', 'gitDecoration.addedResourceForeground') || '#a9dc76';
  const warn = pick('terminal.ansiYellow', 'editorWarning.foreground') || '#ffd866';
  const bad = pick('terminal.ansiRed', 'editorError.foreground') || '#ff6188';
  const border = pick('panel.border', 'sideBar.border', 'editorGroup.border') || bgSoft;
  const fgMuted = pick('descriptionForeground', 'editorLineNumber.foreground') || fg;
  return {
    name: String(obj.name || 'Imported VS Code Theme').slice(0, 40),
    values: {
      'look.color.bg': bg,
      'look.color.bg_soft': bgSoft,
      'look.color.border': border,
      'look.color.fg': fg,
      'look.color.fg_muted': fgMuted,
      'look.color.message.alt_fg': fgMuted,
      'look.color.accent': accent,
      'look.color.link': link,
      'look.color.good': good,
      'look.color.warn': warn,
      'look.color.bad': bad,
      'look.color.member.owner': bad,
      'look.color.member.admin': warn,
      'look.color.member.op': accent,
      'look.color.member.halfop': link,
      'look.color.member.voice': good,
      'look.nick.colors': generateHarmoniousNickPalette(accent, bg),
    },
    sourceFormat: 'vscode',
  };
}

export function parseThemeImport(rawText: string): ParsedThemeImport {
  let parsed: unknown;
  try {
    // Strip JS-style comments sometimes included in VS Code theme JSONC
    const cleaned = rawText
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,\s*([}\]])/g, '$1');
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Invalid JSON theme data.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Theme JSON must be an object.');
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.base00 === 'string' && typeof obj.base05 === 'string') {
    const b16 = mapBase16(obj);
    if (b16) return b16;
  }
  if (obj.colors && typeof obj.colors === 'object') {
    const vs = mapVsCode(obj);
    if (vs) return vs;
  }

  const candidateValues =
    obj.values && typeof obj.values === 'object' && !Array.isArray(obj.values)
      ? (obj.values as Record<string, unknown>)
      : obj;

  const cleanValues: Record<string, SettingValue> = {};
  for (const [k, v] of Object.entries(candidateValues)) {
    const opt = getOption(k);
    if (!opt || !opt.themed) continue;
    if (
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      (Array.isArray(v) && v.every((x) => typeof x === 'string'))
    ) {
      cleanValues[k] = v as SettingValue;
    }
  }
  if (Object.keys(cleanValues).length === 0) {
    throw new Error('No recognized Lurkr, VS Code, or Base16 theme keys found.');
  }

  return {
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim().slice(0, 40) : 'Imported Theme',
    values: cleanValues,
    custom:
      obj.custom && typeof obj.custom === 'object' && !Array.isArray(obj.custom)
        ? (obj.custom as Partial<CustomThemeConfig>)
        : undefined,
    sourceFormat: 'lurkr',
  };
}
