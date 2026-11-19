// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { flattenBufferOrder } from './bufferOrder';
import { useBuffersStore } from '../stores/buffers';
import { useFavoritesStore } from '../stores/favorites';
import { useNetworksStore } from '../stores/networks';
import { usePinsStore } from '../stores/pins';
import { SYSTEM_KEY } from '../lib/virtualBuffers';

export function cycleActiveBuffer(direction: -1 | 1): void {
  const networksStore = useNetworksStore.getState();
  const buffersStore = useBuffersStore.getState();
  const pinsStore = usePinsStore.getState();
  const favOrder = useFavoritesStore.getState().orderInjection();

  const entries = flattenBufferOrder({
    networks: networksStore.networks,
    buffers: buffersStore,
    pins: pinsStore,
    favorites: favOrder,
  });

  if (entries.length === 0) {
    if (buffersStore.buffers[SYSTEM_KEY]) {
      buffersStore.activate(null, '*status');
    }
    return;
  }

  const activeKey = networksStore.activeKey;
  const idx = activeKey ? entries.findIndex((e) => e.key === activeKey) : -1;
  const targetIdx =
    idx === -1
      ? direction > 0
        ? 0
        : entries.length - 1
      : (idx + direction + entries.length) % entries.length;
  const next = entries[targetIdx];
  if (next) {
    buffersStore.activate(Number(next.networkId), next.target);
  }
}
