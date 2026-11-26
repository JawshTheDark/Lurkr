// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { idFor } from '../stores/buffers';
import { useChannelNotifyStore } from '../stores/channelNotify';
import { useIgnoresStore } from '../stores/ignores';
import { socketSend } from '../services/socketBus';
import { canonicalizeLevels } from '../utils/ignoreMatch';

export type ChannelNotifyRung = 'all' | 'highlights' | 'nothing' | 'muted';

function levelsForRung(rung: ChannelNotifyRung): string[] | null {
  if (rung === 'nothing') return canonicalizeLevels(['NONOTIFY']);
  if (rung === 'muted') return canonicalizeLevels(['NOUNREAD', 'NONOTIFY']);
  return null;
}

function sameLevels(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((l) => set.has(l));
}

export function getChannelNotifyRung(networkId: number, target: string): ChannelNotifyRung {
  const notifyAlways = useChannelNotifyStore.getState().levelFor(networkId, target) === 'all';
  if (notifyAlways) return 'all';
  const muteLevels = useIgnoresStore.getState().bufferMuteRule(networkId, target)?.levels ?? [];
  if (muteLevels.includes('NONOTIFY')) {
    return muteLevels.includes('NOUNREAD') ? 'muted' : 'nothing';
  }
  return 'highlights';
}

export function setChannelNotifyRung(
  networkId: number,
  target: string,
  rung: ChannelNotifyRung,
): void {
  const channelNotify = useChannelNotifyStore.getState();
  const isAll = channelNotify.levelFor(networkId, target) === 'all';
  if ((rung === 'all') !== isAll) {
    socketSend({
      type: 'set-channel-notify-always',
      networkId,
      target,
      bufferId: idFor(networkId, target),
      notifyAlways: rung === 'all',
    });
  }

  const ignores = useIgnoresStore.getState();
  const existing = ignores.bufferMuteRule(networkId, target);
  const want = levelsForRung(rung);
  if (existing && want && sameLevels(existing.levels, want)) return;
  if (existing) {
    ignores.remove(existing.networkId, existing.id);
  }
  if (want) {
    ignores.add({
      networkId,
      rule: {
        mask: null,
        channels: [target.toLowerCase()],
        pattern: null,
        patternKind: 'substr',
        levels: want,
        isExcept: false,
        expiresAt: null,
      },
    });
  }
}
