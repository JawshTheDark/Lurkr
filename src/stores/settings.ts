// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { api } from '../api';
import { REGISTRY, getDefault, getOption } from '../utils/settingsRegistry';
import type { SettingValue } from '../shared/settingsRegistry';
import {
  currentLayoutValue,
  currentSettingKey,
  LAYOUT_SETTING_KEY,
  RENAMED_SETTING_KEYS,
} from '../shared/settingsRenames';
import { useThemesStore } from './themes';

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  return false;
}

interface SettingsState {
  values: Record<string, SettingValue>;
  loaded: boolean;
  loading: Promise<void> | null;
  baseline: (key: string) => SettingValue | undefined;
  effective: (key: string) => SettingValue | undefined;
  isModified: (key: string) => boolean;
  themeDriftKeys: () => string[];
  fetchAll: () => Promise<void>;
  syncDetectedTimezone: () => Promise<void>;
  setValue: (key: string, value: SettingValue) => Promise<void>;
  patchMany: (changes: Record<string, SettingValue>, resets?: string[]) => Promise<void>;
  resetKey: (key: string) => Promise<void>;
  applyRemote: (payload: { changes?: Record<string, SettingValue>; resets?: string[] }) => void;
  reset: () => void;
}

export { REGISTRY };

export const useSettingsStore = create<SettingsState>((set, get): SettingsState => ({
  values: {},
  loaded: false,
  loading: null,
  baseline: (key: string): SettingValue | undefined => {
    if (getOption(key)?.themed) {
      const vals = useThemesStore.getState().activeThemeValues() as Record<string, SettingValue> | null;
      const themed = vals?.[key];
      if (themed !== undefined) return themed;
    }
    return getDefault(key);
  },
  effective: (key: string) => {
    const vals = get().values;
    if (key in vals) return vals[key];
    // Support both pre-2.7 (`look.message.compact.*` / `compact`) and 2.7 (`modern`) keys.
    const renamed = currentSettingKey(key);
    if (renamed !== key && renamed in vals) return vals[renamed];
    for (const [oldKey, newKey] of Object.entries(RENAMED_SETTING_KEYS)) {
      if (newKey === key && oldKey in vals) return vals[oldKey];
    }
    if (key === LAYOUT_SETTING_KEY && LAYOUT_SETTING_KEY in vals) {
      return currentLayoutValue(vals[LAYOUT_SETTING_KEY]) ?? get().baseline(key);
    }
    return get().baseline(key);
  },
  isModified: (key: string) => {
    const vals = get().values;
    if (!(key in vals)) return false;
    return !valuesEqual(vals[key], get().baseline(key));
  },
  themeDriftKeys: () => {
    const vals = get().values;
    return Object.keys(vals).filter(
      (key) => getOption(key)?.themed && !valuesEqual(vals[key], get().baseline(key)),
    );
  },
  fetchAll: async () => {
    const existing = get().loading;
    if (existing) return existing;
    const p = (async () => {
      const { values, themes } = await api('/api/settings/bootstrap');
      set({ values: { ...values }, loaded: true });
      if (Array.isArray(themes)) useThemesStore.getState().hydrate(themes);
    })();
    set({ loading: p });
    try {
      await p;
      get().syncDetectedTimezone().catch(() => {});
    } finally {
      set({ loading: null });
    }
  },
  syncDetectedTimezone: async () => {
    let detected: string | undefined;
    try {
      detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!detected) return;
    if (get().values['system.timezone'] === detected) return;
    try {
      await get().setValue('system.timezone', detected);
    } catch {
      /* ignore */
    }
  },
  setValue: async (key: string, value: SettingValue) => {
    const opt = getOption(key);
    if (opt?.themed && valuesEqual(value, get().baseline(key))) {
      await get().patchMany({}, [key]);
      return;
    }
    await get().patchMany({ [key]: value });
  },
  patchMany: async (changes, resets = []) => {
    const { values } = await api('/api/settings', {
      method: 'PATCH',
      body: { changes, resets },
    });
    set({ values: { ...values } });
  },
  resetKey: async (key: string) => {
    const { values } = await api(`/api/settings/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
    set({ values: { ...values } });
  },
  applyRemote: ({ changes, resets }) => {
    const next = { ...get().values };
    for (const [key, value] of Object.entries(changes || {})) {
      const def = getDefault(key);
      if (!getOption(key)?.themed && def !== undefined && valuesEqual(value, def)) {
        delete next[key];
      } else {
        next[key] = value;
      }
    }
    for (const key of resets || []) delete next[key];
    set({ values: next });
  },
  reset: () => set({ values: {}, loaded: false, loading: null }),
}));
