// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { useToastsStore } from '../stores/toasts';
import { useSettingsStore } from '../stores/settings';
import { useChannelNotifyStore } from '../stores/channelNotify';
import { useNetworksStore } from '../stores/networks';
import { useIgnoresStore } from '../stores/ignores';
import { isChannelTarget } from '../shared/channels';

let audioCtx: AudioContext | null = null;

export function playSound(): void {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.16);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.17);
  } catch {
    /* ignore audio errors */
  }
}

export function sendDesktopNotification(
  title: string,
  body: string,
  bufferPath?: string,
): void {
  if (window.lurkerDesktop) {
    void window.lurkerDesktop.notify({ title, body, bufferPath });
    return;
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const n = new Notification(title, { body });
    n.onclick = () => {
      window.focus();
    };
  }
}

export function notifyForEvent(event: any): void {
  if (!event || event.self) return;
  const settings = useSettingsStore.getState();
  const networkId = event.networkId;
  const target = event.target;
  if (networkId == null || !target) return;

  const isDm = !isChannelTarget(target);
  const isHighlight = !!event.matched;
  const notifyLevel = useChannelNotifyStore.getState().levelFor(networkId, target);
  if (notifyLevel === 'mute') return;

  const ignoreVerdict = useIgnoresStore.getState().evaluate(Number(networkId), {
    nick: event.nick || '',
    userhost: event.userhost || null,
    target,
    text: event.text || '',
    type: event.type || 'message',
    isDm,
  });
  if (ignoreVerdict.nonotify || ignoreVerdict.hide) return;

  const activeKey = useNetworksStore.getState().activeKey;
  const isViewingBuffer =
    document.hasFocus() &&
    document.visibilityState === 'visible' &&
    activeKey === `${networkId}::${target}`;

  const shouldAlert = isHighlight || isDm || notifyLevel === 'all';
  if (!shouldAlert || isViewingBuffer) return;

  const title = isDm ? event.nick || target : `${event.nick || ''} in ${target}`;
  const body = event.text || '';

  if (settings.effective('notifications.sound.enabled') !== false) {
    playSound();
  }

  useToastsStore.getState().push({
    title,
    body,
    networkId: Number(networkId),
    target,
    messageId: typeof event.id === 'number' ? event.id : undefined,
    kind: isHighlight ? 'highlight' : isDm ? 'dm' : 'always_notify',
  });

  if (
    settings.effective('notifications.desktop.enabled') !== false &&
    (!document.hasFocus() || document.visibilityState !== 'visible')
  ) {
    sendDesktopNotification(title, body, `/chat/${networkId}/${encodeURIComponent(target)}`);
  }
}
