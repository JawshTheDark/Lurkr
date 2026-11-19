// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { api } from '../api';
import type { SettingValue } from '../shared/settingsRegistry';
import { THEMED_KEYS } from '../utils/settingsRegistry';
import type { ThemePreset } from '../shared/themePresets';
import { builtinThemes, getBuiltinTheme } from '../shared/themePresets';
import { getPrefersDark } from '../utils/prefersDark';
import { useSettingsStore } from './settings';

export interface SavedTheme {
  id: number;
  name: string;
  values: Record<string, SettingValue>;
  createdAt: string;
  updatedAt: string;
}

function asPreset(t: SavedTheme): ThemePreset {
  return { id: String(t.id), name: t.name, builtin: false, values: t.values };
}

interface ThemesState {
  saved: SavedTheme[];
  loaded: boolean;
  all: () => ThemePreset[];
  byId: (id: string) => ThemePreset | null;
  activePointerKey: () => string;
  activeThemeId: () => string;
  activeTheme: () => ThemePreset;
  activeThemeValues: () => Record<string, SettingValue> | null;
  hydrate: (items: SavedTheme[]) => void;
  fetchAll: () => Promise<void>;
  snapshotCurrent: () => Record<string, SettingValue>;
  applyTheme: (id: string) => Promise<void>;
  saveCurrentAs: (name: string) => Promise<SavedTheme>;
  saveCurrentInto: (id: number) => Promise<SavedTheme>;
  create: (name: string, values: Record<string, SettingValue>) => Promise<SavedTheme>;
  update: (
    id: number,
    fields: { name?: string; values?: Record<string, SettingValue> },
  ) => Promise<SavedTheme>;
  remove: (id: number) => Promise<void>;
  reset: () => void;
}

export const useThemesStore = create<ThemesState>((set, get): ThemesState => ({
  saved: [],
  loaded: false,
  all: () => [...builtinThemes(), ...(Array.isArray(get().saved) ? get().saved : []).map(asPreset)],
  byId: (id: string) => get().all().find((t) => t.id === id) || null,
  activePointerKey: () => {
    const settings = useSettingsStore.getState();
    if (settings.effective('look.theme.mode') === 'system') {
      return getPrefersDark() ? 'look.theme.dark' : 'look.theme.light';
    }
    return 'look.theme.active';
  },
  activeThemeId: (): string => {
    const settings = useSettingsStore.getState();
    const id = String(settings.effective(get().activePointerKey()) ?? 'dark');
    return get().byId(id) ? id : 'dark';
  },
  activeTheme: () => get().byId(get().activeThemeId()) || getBuiltinTheme('dark')!,
  activeThemeValues: () => (get().activeThemeId() === 'dark' ? null : get().activeTheme().values),
  hydrate: (items) => set({ saved: Array.isArray(items) ? items : [], loaded: true }),
  fetchAll: async () => {
    const data = await api<{ items?: SavedTheme[] }>('/api/themes');
    get().hydrate(Array.isArray(data?.items) ? data.items : []);
  },
  snapshotCurrent: () => {
    const settings = useSettingsStore.getState();
    const out: Record<string, SettingValue> = {};
    for (const key of THEMED_KEYS) {
      const value = settings.effective(key);
      if (value !== undefined) out[key] = value as SettingValue;
    }
    return out;
  },
  applyTheme: async (id: string) => {
    const settings = useSettingsStore.getState();
    await settings.patchMany({ [get().activePointerKey()]: id }, [...THEMED_KEYS]);
  },
  saveCurrentAs: async (name: string) => {
    const values = get().snapshotCurrent();
    const created = await get().create(name, values);
    await get().applyTheme(String(created.id));
    return created;
  },
  saveCurrentInto: async (id: number) => {
    const values = get().snapshotCurrent();
    const updated = await get().update(id, { values });
    await get().applyTheme(String(id));
    return updated;
  },
  create: async (name, values) => {
    const { theme } = await api('/api/themes', { method: 'POST', body: { name, values } });
    await get().fetchAll();
    return theme;
  },
  update: async (id, fields) => {
    const { theme } = await api(`/api/themes/${id}`, { method: 'PUT', body: fields });
    await get().fetchAll();
    return theme;
  },
  remove: async (id) => {
    await api(`/api/themes/${id}`, { method: 'DELETE' });
    await get().fetchAll();
  },
  reset: () => set({ saved: [], loaded: false }),
}));
