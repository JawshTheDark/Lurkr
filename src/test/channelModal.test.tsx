// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelModal } from '../components/ChannelModal';
import { registerAllSessionResets } from '../stores/registerResets';
import { resetSession } from '../stores/sessionReset';
import { useBuffersStore } from '../stores/buffers';
import { useChannelNotifyStore } from '../stores/channelNotify';
import { useIgnoresStore } from '../stores/ignores';
import { useNetworksStore } from '../stores/networks';
import {
  createEmptyServerProfile,
  type IrcdFamily,
  type ServicesFamily,
} from '../lib/networkCapabilities';
import { parseModeSpec } from '../shared/channelModes';
import { connectSocket, resetSocket } from '../services/socket';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
registerAllSessionResets();

function setControlValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('ChannelModal parity', () => {
  const origWebSocket = globalThis.WebSocket;
  const origFetch = globalThis.fetch;
  let container: HTMLDivElement;
  let root: Root | null = null;
  let lastSocket: {
    sent: Record<string, unknown>[];
    emit: (ev: string, data?: unknown) => void;
  } | null = null;

  beforeEach(async () => {
    resetSocket();
    resetSession();
    container = document.createElement('div');
    document.body.appendChild(container);

    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          networks: [
            {
              id: 1,
              name: 'Libera.Chat',
              host: 'irc.libera.chat',
              port: 6697,
              nick: 'Jawsh',
              tls: true,
              channels: [{ name: '#lurker', key: 'hunter2' }],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    class MockWebSocket {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = MockWebSocket.OPEN;
      listeners = new Map<string, Array<(e?: any) => void>>();
      sent: Record<string, unknown>[] = [];
      constructor() {
        lastSocket = this;
        setTimeout(() => this.emit('open'), 0);
      }
      addEventListener(ev: string, cb: (e?: any) => void) {
        const list = this.listeners.get(ev) || [];
        list.push(cb);
        this.listeners.set(ev, list);
      }
      send(raw: string) {
        try {
          this.sent.push(JSON.parse(raw));
        } catch {
          /* ignore */
        }
      }
      close() {
        this.readyState = MockWebSocket.CLOSED;
      }
      emit(ev: string, data?: unknown) {
        for (const cb of this.listeners.get(ev) || []) {
          cb(data);
        }
      }
    }
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

    connectSocket();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container.remove();
    resetSocket();
    resetSession();
    globalThis.WebSocket = origWebSocket;
    globalThis.fetch = origFetch;
  });

  function seedChannel({
    myModes = ['o'],
    modes = 'ntl',
    modeParams = { l: '50' } as Record<string, string>,
    chanmodes = ['eIbq', 'k', 'flj', 'CFLMPQRSTcgimnprstuz'],
    prefix = [
      { mode: 'o', symbol: '@' },
      { mode: 'v', symbol: '+' },
    ],
    ircd = 'unknown' as IrcdFamily,
    services = 'unknown' as ServicesFamily,
    isupport = {} as Record<string, string | true>,
  } = {}) {
    const profile = {
      ...createEmptyServerProfile(),
      ircd,
      services,
      isupport,
    };
    useNetworksStore.setState({
      networks: [
        {
          id: 1,
          name: 'Libera.Chat',
          host: 'irc.libera.chat',
          port: 6697,
          nick: 'Jawsh',
          tls: true,
          channels: [{ name: '#lurker', key: 'hunter2' }],
        },
      ],
      states: {
        1: {
          networkId: 1,
          channels: ['#lurker'],
          state: 'connected',
          nick: 'Jawsh',
          modeSpec: parseModeSpec({
            CHANMODES: chanmodes,
            PREFIX: prefix,
            MODES: '4',
            TOPICLEN: '390',
          }),
        },
      },
      profiles: ircd === 'unknown' && services === 'unknown' ? {} : { 1: profile },
      loaded: true,
    });
    const buffers = useBuffersStore.getState();
    buffers.ensure(1, '#lurker', 10);
    buffers.setJoined(1, '#lurker', true);
    buffers.setMembers(1, '#lurker', [
      { nick: 'Jawsh', modes: myModes, away: false },
      { nick: 'alice', modes: [], away: false },
    ]);
    buffers.setTopic(1, '#lurker', 'hello', {
      setBy: 'alice',
      setAt: '2026-09-23T10:00:00.000Z',
    });
    buffers.setChannelModes(1, '#lurker', modes, modeParams, '2026-05-17T10:00:00.000Z');
  }

  function findModeCheckbox(letter: string): HTMLInputElement | null {
    const rows = Array.from(container.querySelectorAll('.channel-mode-row, .channel-modes.bare li'));
    const match = rows.find((row) =>
      Array.from(row.querySelectorAll('.channel-mode-tag, span')).some(
        (el) => el.textContent?.trim() === `+${letter}`,
      ),
    );
    return match ? (match.querySelector('input[type="checkbox"]') as HTMLInputElement | null) : null;
  }

  it('draws modeSpec tabs/rows, folds unknown modes, and gates permissions for non-ops', () => {
    seedChannel({ myModes: ['o'], modes: 'ntlCg' });

    root = createRoot(container);
    act(() => {
      root!.render(<ChannelModal open networkId={1} target="#lurker" onClose={() => {}} />);
    });

    const tabLabels = Array.from(container.querySelectorAll('[role="tab"]')).map(
      (t) => t.textContent?.trim() || '',
    );
    expect(tabLabels).toEqual(['Settings', 'Bans', 'Exceptions', 'Invites', 'Quiets']);

    expect(findModeCheckbox('n')?.checked).toBe(true);
    expect(findModeCheckbox('m')?.checked).toBe(false);
    expect(findModeCheckbox('C')?.checked).toBe(true);

    const otherDetails = container.querySelector('details.channel-other-modes');
    expect(otherDetails).toBeTruthy();
    expect(otherDetails!.hasAttribute('open')).toBe(false);
    expect(otherDetails!.querySelector('summary')?.textContent).toContain('+g');
    expect(container.textContent).toContain('Set by alice');
    expect(container.textContent).toContain('Created');
    expect(container.textContent).toContain('5 / 390');

    // Switch to non-op: +t makes topic read-only, modes disabled, only set modes visible
    act(() => {
      useBuffersStore.getState().setMembers(1, '#lurker', [
        { nick: 'Jawsh', modes: [], away: false },
        { nick: 'alice', modes: ['o'], away: false },
      ]);
    });
    expect(container.querySelector('textarea')).toBeNull();
    expect(findModeCheckbox('n')?.disabled).toBe(true);
    expect(findModeCheckbox('m')).toBeNull();
    expect(container.textContent).toContain('Only channel operators can change modes.');
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it('saves topic & mode diffs cleanly via set-topic and set-channel-modes and surfaces live IRC errors', async () => {
    seedChannel({ myModes: ['o'], modes: 'ntk' });

    root = createRoot(container);
    act(() => {
      root!.render(<ChannelModal open networkId={1} target="#lurker" onClose={() => {}} />);
    });

    // Stored key should be masked and revealable, without dirtying Save
    const keyInput = container.querySelector('input[aria-label="+k value"]') as HTMLInputElement;
    expect(keyInput.type).toBe('password');
    expect(keyInput.value).toBe('hunter2');
    const saveBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    const revealBtn = container.querySelector('button[aria-label="Show key"]') as HTMLButtonElement;
    act(() => {
      revealBtn.click();
    });
    expect(keyInput.type).toBe('text');

    // Edit topic with newline + toggle +m and -t
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    act(() => {
      setControlValue(ta, 'new\ntopic');
      findModeCheckbox('m')!.click();
      findModeCheckbox('t')!.click();
    });
    expect(saveBtn.disabled).toBe(false);

    // Submit save and ACK both commands
    await act(async () => {
      saveBtn.click();
      await Promise.resolve();
    });

    const topicReq = lastSocket!.sent.find((p) => p.type === 'set-topic');
    expect(topicReq).toMatchObject({
      type: 'set-topic',
      networkId: 1,
      channel: '#lurker',
      topic: 'new topic',
    });

    act(() => {
      lastSocket!.emit('message', {
        data: JSON.stringify({ kind: 'send-result', clientId: topicReq!.clientId, ok: true }),
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    const modesReq = lastSocket!.sent.find((p) => p.type === 'set-channel-modes');
    expect(modesReq).toMatchObject({
      type: 'set-channel-modes',
      networkId: 1,
      channel: '#lurker',
      changes: [
        { sign: '+', letter: 'm' },
        { sign: '-', letter: 't' },
      ],
    });

    // Simulate server refusal error arriving for #lurker
    act(() => {
      lastSocket!.emit('message', {
        data: JSON.stringify({ kind: 'send-result', clientId: modesReq!.clientId, ok: true }),
      });
      lastSocket!.emit('message', {
        data: JSON.stringify({
          kind: 'irc',
          type: 'error',
          networkId: 1,
          target: '#lurker',
          text: "You're not a channel operator.",
        }),
      });
    });

    expect(container.textContent).toContain("You're not a channel operator.");
  });

  it('loads Bans list via get-mode-list and patches live +b/-b changes, plus updates 4-rung notifications', async () => {
    seedChannel({ myModes: ['o'], modes: 'nt' });
    useBuffersStore.getState().detachForJump(1, '#lurker');

    root = createRoot(container);
    act(() => {
      root!.render(<ChannelModal open networkId={1} target="#lurker" onClose={() => {}} />);
    });

    // Test 4-rung Notifications ladder & aria-pressed exclusivity
    const notifyGroup = container.querySelector('[aria-label="Channel notifications"]')!;
    const notifyButtons = Array.from(notifyGroup.querySelectorAll('button'));
    expect(notifyButtons.map((b) => b.textContent?.trim())).toEqual([
      'All Messages',
      'Highlights Only',
      'Nothing',
      'Muted',
    ]);
    expect(
      notifyButtons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent),
    ).toEqual(['Highlights Only']);

    act(() => {
      notifyButtons.find((b) => b.textContent === 'Muted')!.click();
    });
    const muteAdd = lastSocket!.sent.find((p) => p.type === 'add-ignore');
    expect(muteAdd).toMatchObject({
      type: 'add-ignore',
      networkId: 1,
      rule: { channels: ['#lurker'], levels: ['NOUNREAD', 'NONOTIFY'] },
    });
    act(() => {
      lastSocket!.emit('message', {
        data: JSON.stringify({
          kind: 'ignore-list-updated',
          networkId: 1,
          rules: [
            {
              id: 77,
              mask: null,
              channels: ['#lurker'],
              pattern: null,
              patternKind: 'substr',
              levels: ['NOUNREAD', 'NONOTIFY'],
              isExcept: false,
              expiresAt: null,
              createdAt: '2026-11-26T00:00:00Z',
            },
          ],
        }),
      });
    });
    expect(
      notifyButtons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent),
    ).toEqual(['Muted']);
    expect(useIgnoresStore.getState().isChannelUnreadMuted(1, '#lurker')).toBe(true);

    // Switch to All Messages removes mute rule and sets notifyAlways
    act(() => {
      notifyButtons.find((b) => b.textContent === 'All Messages')!.click();
    });
    expect(lastSocket!.sent.find((p) => p.type === 'remove-ignore')).toMatchObject({
      type: 'remove-ignore',
      networkId: 1,
      id: 77,
    });
    expect(lastSocket!.sent.find((p) => p.type === 'set-channel-notify-always')).toMatchObject({
      type: 'set-channel-notify-always',
      networkId: 1,
      target: '#lurker',
      notifyAlways: true,
    });
    useChannelNotifyStore.getState().applyChange(1, '#lurker', true);

    // Open Bans tab -> fetches get-mode-list
    const bansTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (t) => t.textContent?.trim() === 'Bans',
    ) as HTMLButtonElement;
    act(() => {
      bansTab.click();
    });

    const listReq = lastSocket!.sent.find((p) => p.type === 'get-mode-list');
    expect(listReq).toMatchObject({
      type: 'get-mode-list',
      networkId: 1,
      channel: '#lurker',
      letter: 'b',
    });

    act(() => {
      lastSocket!.emit('message', {
        data: JSON.stringify({
          kind: 'send-result',
          clientId: listReq!.clientId,
          ok: true,
          data: {
            ok: true,
            entries: [{ mask: '*!*@troll.invalid', setBy: 'op', setAt: null }],
          },
        }),
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('*!*@troll.invalid');

    // Live +b mode patches list without refetch even while buffer is detached
    act(() => {
      lastSocket!.emit('message', {
        data: JSON.stringify({
          kind: 'irc',
          type: 'mode',
          networkId: 1,
          target: '#lurker',
          nick: 'alice',
          time: '2026-11-26T12:00:00Z',
          modes: [{ mode: '+b', param: '*!*@spam.example', kind: 'list' }],
        }),
      });
    });
    expect(container.textContent).toContain('*!*@spam.example');

    // Remove ban via X button
    const removeBtn = container.querySelector(
      'button[aria-label="Remove *!*@troll.invalid"]',
    ) as HTMLButtonElement;
    await act(async () => {
      removeBtn.click();
      await Promise.resolve();
    });
    expect(lastSocket!.sent.find((p) => p.type === 'set-channel-modes')).toMatchObject({
      type: 'set-channel-modes',
      networkId: 1,
      channel: '#lurker',
      changes: [{ sign: '-', letter: 'b', param: '*!*@troll.invalid' }],
    });
  });

  it('shows Solanum descriptors, active pill hover previews, custom folding, and EXTBAN hints', async () => {
    seedChannel({
      myModes: ['o'],
      modes: 'ntCfzX',
      modeParams: { f: '#overflow' },
      chanmodes: ['eIbq', 'k', 'flj', 'CFLMPQRSTcgimnprstuzX'],
      ircd: 'solanum',
      services: 'atheme',
      isupport: { EXTBAN: '$,agjrxz', MAXLIST: 'beI:100' },
    });

    root = createRoot(container);
    act(() => {
      root!.render(<ChannelModal open networkId={1} target="#lurker" onClose={() => {}} />);
    });

    // Software banner + services + role + active pills
    expect(container.textContent).toContain('Solanum');
    expect(container.textContent).toContain('Services: Atheme');
    expect(container.textContent).toContain('Role: Operator (@)');
    expect(container.textContent).toContain('Solanum Modes');
    expect(container.textContent).toContain('Channel forward');
    expect(container.textContent).toContain('#overflow');
    expect(container.textContent).toContain('Reduced moderation');
    expect(container.textContent).toContain(
      'Routes messages blocked by +m, +b, +q, or +R to channel ops instead.',
    );

    // Truly unrecognized server flag +X folds cleanly into details.channel-other-modes
    const otherDetails = container.querySelector('details.channel-other-modes');
    expect(otherDetails).toBeTruthy();
    expect(otherDetails!.querySelector('summary')?.textContent).toContain('+X');

    // Hovering +z active pill reveals the inline status preview
    const zPill = Array.from(container.querySelectorAll('.channel-active-pill')).find((b) =>
      b.textContent?.includes('+z'),
    ) as HTMLButtonElement;
    expect(zPill).toBeTruthy();
    act(() => {
      zPill.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(container.querySelector('.channel-active-preview')?.textContent).toContain(
      '+z Reduced moderation',
    );

    // Switch to Bans tab -> Solanum EXTBAN hints + MAXLIST limit + click quick-insert
    const bansTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (t) => t.textContent?.trim() === 'Bans',
    ) as HTMLButtonElement;
    act(() => {
      bansTab.click();
    });
    expect(container.textContent).toContain('Max 100 entries');
    const accountChip = Array.from(container.querySelectorAll('.channel-extban-chip')).find((b) =>
      b.textContent?.includes('$a:'),
    ) as HTMLButtonElement;
    expect(accountChip).toBeTruthy();
    act(() => {
      accountChip.click();
    });
    const maskInput = container.querySelector(
      'input[aria-label="Add to Bans"]',
    ) as HTMLInputElement;
    expect(maskInput.value).toBe('$a:');
    expect(maskInput.placeholder).toContain('$a:account');
  });

  it('switches mode meanings per IRCd family across UnrealIRCd, InspIRCd, and Ergo', () => {
    seedChannel({
      myModes: ['q'],
      modes: 'ntfzL',
      modeParams: { f: '[5t]:3', L: '#overflow' },
      chanmodes: ['beI', 'kFfL', 'ljH', 'CcDdGMNOPQRSTuVzZmr'],
      prefix: [
        { mode: 'q', symbol: '~' },
        { mode: 'o', symbol: '@' },
      ],
      ircd: 'unrealircd',
      services: 'anope',
      isupport: { EXTBAN: '~' },
    });

    root = createRoot(container);
    act(() => {
      root!.render(<ChannelModal open networkId={1} target="#lurker" onClose={() => {}} />);
    });

    expect(container.textContent).toContain('UnrealIRCd');
    expect(container.textContent).toContain('UnrealIRCd Modes');
    expect(container.textContent).toContain('Role: Owner (~)');
    expect(container.textContent).toContain('Flood protection');
    expect(container.textContent).toContain('Flood profile');
    expect(container.textContent).toContain('TLS connections only');
    expect(container.textContent).toContain('Channel link');

    // Re-seed as InspIRCd: +F becomes Nick flood, +B Block ALL CAPS, +J Kick rejoin cooldown
    act(() => {
      seedChannel({
        myModes: ['o'],
        modes: 'ntfFJ',
        modeParams: { f: '5:3', F: '3:60', J: '30' },
        chanmodes: ['beI', 'k', 'fFgjJLHdwX', 'ABCDGKMNOPQRSTuZzmr'],
        ircd: 'inspircd',
      });
    });
    expect(container.textContent).toContain('InspIRCd Modes');
    expect(container.textContent).toContain('Message flood');
    expect(container.textContent).toContain('Nick flood');
    expect(container.textContent).toContain('Block ALL CAPS');
    expect(container.textContent).toContain('Kick rejoin cooldown');

    // Re-seed as Ergo: +U Op-moderated, +E Roleplay commands, +b mute hint `m:`
    act(() => {
      seedChannel({
        myModes: ['o'],
        modes: 'ntEU',
        modeParams: {},
        chanmodes: ['beI', 'k', 'fl', 'CEMRuU'],
        ircd: 'ergo',
        services: 'ergo',
      });
    });
    expect(container.textContent).toContain('Ergo Modes');
    expect(container.textContent).toContain('Services: Ergo Built-in');
    expect(container.textContent).toContain('Roleplay commands');
    expect(container.textContent).toContain('Op-moderated');

    const bansTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (t) => t.textContent?.trim() === 'Bans',
    ) as HTMLButtonElement;
    act(() => {
      bansTab.click();
    });
    expect(container.textContent).toContain('m:');
    expect(container.textContent).toContain('Mute mask (speak/nick only)');
  });
});
