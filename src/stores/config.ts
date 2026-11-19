// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { api } from '../api';

export type Edition = 'standalone' | 'node';

export interface Features {
  linkPreviews: boolean;
  bouncer: boolean;
  dcc: boolean;
}

let inflight: Promise<Edition> | null = null;

interface ConfigState {
  edition: Edition;
  features: Features;
  jitsiUrl: string | null;
  checked: boolean;
  setJitsiUrl: (url: string | null) => void;
  fetch: () => Promise<Edition>;
  reset: () => void;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  edition: 'standalone',
  features: { linkPreviews: false, bouncer: false, dcc: false },
  jitsiUrl: null,
  checked: false,
  setJitsiUrl: (url) => set({ jitsiUrl: url }),
  fetch: async () => {
    if (get().checked) return get().edition;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const data = await api<{ edition?: string; features?: Partial<Features> }>('/api/config', {
          signal: AbortSignal.timeout(6000),
        });
        const edition: Edition = data.edition === 'node' ? 'node' : 'standalone';
        set({
          edition,
          features: {
            linkPreviews: data.features?.linkPreviews === true,
            bouncer: data.features?.bouncer === true,
            dcc: data.features?.dcc === true,
          },
          checked: true,
        });
      } catch {
        set({ edition: 'standalone' });
      } finally {
        inflight = null;
      }
      return get().edition;
    })();
    return inflight;
  },
  reset: () =>
    set({
      edition: 'standalone',
      features: { linkPreviews: false, bouncer: false, dcc: false },
      jitsiUrl: null,
      checked: false,
    }),
}));
