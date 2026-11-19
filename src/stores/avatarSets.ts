// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { api, apiMultipart } from '../api';
import { RESERVED_AVATAR_SET_NAMES } from '../shared/avatarSets';

export interface AvatarSetDefinition {
  id: string;
  name: string;
  builtin?: boolean;
  tileCount?: number;
}

export const BUILTIN_AVATAR_SETS: AvatarSetDefinition[] = RESERVED_AVATAR_SET_NAMES.map(
  (name) => ({ id: name, name, builtin: true }),
);

export const AVATAR_SET_POINTER_KEY = 'look.avatars.set';

export interface SavedAvatarSet extends AvatarSetDefinition {
  id: string;
  builtin?: boolean;
}

interface AvatarSetsState {
  saved: SavedAvatarSet[];
  loaded: boolean;
  all: () => AvatarSetDefinition[];
  fetchAll: () => Promise<void>;
  uploadZip: (file: File, name?: string) => Promise<SavedAvatarSet>;
  remove: (id: string) => Promise<void>;
  reset: () => void;
}

export const useAvatarSetsStore = create<AvatarSetsState>((set, get) => ({
  saved: [],
  loaded: false,
  all: () => [...BUILTIN_AVATAR_SETS, ...get().saved],
  fetchAll: async () => {
    const { items } = await api('/api/avatar-sets');
    set({ saved: items || [], loaded: true });
  },
  uploadZip: async (file, name) => {
    const fd = new FormData();
    if (name) fd.append('name', name);
    fd.append('file', file, file.name);
    const { set: created } = await apiMultipart('/api/avatar-sets', fd);
    await get().fetchAll();
    return created;
  },
  remove: async (id) => {
    await api(`/api/avatar-sets/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await get().fetchAll();
  },
  reset: () => set({ saved: [], loaded: false }),
}));
