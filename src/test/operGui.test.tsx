// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OperToolbar } from '../components/OperToolbar';
import { OperConsoleModal } from '../components/OperConsoleModal';
import { StatusBar } from '../components/StatusBar';
import { MemberList } from '../components/MemberList';
import { MessageInput } from '../components/MessageInput';
import { isNetworkOper, useNetworksStore } from '../stores/networks';
import { useBuffersStore } from '../stores/buffers';
import { useOperStore } from '../stores/oper';
import { createEmptyServerProfile, ingestServerLines } from '../lib/networkCapabilities';
import { registerSocketSenders } from '../services/socketBus';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function findButtonByText(rootEl: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(rootEl.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  );
}

function makeUnrealProfile(caps: string[] = ['setname', 'chghost', 'message-tags', 'draft/metadata-2']) {
  return ingestServerLines(createEmptyServerProfile(), [
    { type: 'motd', text: `Negotiated capabilities: ${caps.join(' ')}` },
    { type: 'motd', text: 'Your host is hub1.unreal.example, running version UnrealIRCd-6.1.7' },
    {
      type: 'motd',
      text: '004 Jawsh hub1.unreal.example UnrealIRCd-6.1.7 iowghraAsORTVSxNCWqBzvdHtGpI lvhopsmntikrRcaqOALQbSeIKVfMCuzNTGjZ',
    },
    {
      type: 'motd',
      text: '005 Jawsh NETWORK=UnrealNet PREFIX=(qaohv)~&@%+ CHANMODES=beI,kfL,lj,psmntirRcOAQKVCuzNSMTGZ HCN SAFELIST EXTBAN=~ KNOCK :are supported by this server',
    },
    { type: 'motd', text: '008 Jawsh Server notice mask (+kcfvGqsSo)' },
    { type: 'notice', nick: 'OperServ', text: 'Anope 2.1.4 loaded' },
  ]);
}

function makeErgoProfile(
  caps: string[] = ['setname', 'roleplay', 'message-tags', 'draft/metadata-2', 'draft/message-redaction'],
) {
  return ingestServerLines(createEmptyServerProfile(), [
    { type: 'motd', text: `Negotiated capabilities: ${caps.join(' ')}` },
    { type: 'motd', text: 'Your host is irc.ergo.example, running version ergo-2.14.0' },
    { type: 'motd', text: '004 Jawsh irc.ergo.example ergo-2.14.0 BRZciosw EIMNRSTWcikmnopqrstuvz' },
    {
      type: 'motd',
      text: '005 Jawsh NETWORK=ErgoNet PREFIX=(qaohv)~&@%+ CHANMODES=beI,k,l,EIMNRSTWcikmnopqrstuvz MONITOR=100 SAFERATE KNOCK :are supported by this server',
    },
    { type: 'motd', text: '381 Jawsh :You are now an IRC operator (operclass: admin)' },
  ]);
}

describe('Oper GUI', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let acked: Record<string, unknown>[];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    acked = [];
    registerSocketSenders(
      () => true,
      async (payload) => {
        acked.push(payload);
        return { ok: true };
      },
    );
    useNetworksStore.getState().reset();
    useBuffersStore.getState().reset();
    useOperStore.getState().reset();
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    container.remove();
    useOperStore.getState().reset();
  });

  it('detects oper status strictly from connected state + +o/+O usermode', () => {
    expect(isNetworkOper(null)).toBe(false);
    expect(isNetworkOper({ networkId: 1, channels: [], state: 'disconnected', userModes: 'o' })).toBe(
      false,
    );
    expect(isNetworkOper({ networkId: 1, channels: [], state: 'connected', userModes: 'iw' })).toBe(
      false,
    );
    expect(isNetworkOper({ networkId: 1, channels: [], state: 'connected', userModes: 'io' })).toBe(
      true,
    );
    expect(
      isNetworkOper({ networkId: 1, channels: [], state: 'connected', userModes: 'iOwghN' }),
    ).toBe(true);
  });

  it('shows UnrealIRCd + Anope OperToolbar controls strictly when opered on UnrealIRCd and hides Ergo-only actions', async () => {
    useNetworksStore.getState().setProfile(1, makeUnrealProfile());

    const nonOperState = {
      networkId: 1,
      channels: ['#opers'],
      state: 'connected',
      nick: 'Jawsh',
      userModes: 'iw',
    };
    const operState = {
      ...nonOperState,
      userModes: 'iowgs',
    };

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(OperToolbar, { networkId: 1, target: '#opers', netState: nonOperState }));
    });
    expect(container.querySelector('[data-testid="oper-toolbar"]')).toBeNull();

    act(() => {
      root!.render(React.createElement(OperToolbar, { networkId: 1, target: '#opers', netState: operState }));
    });
    const toolbar = container.querySelector('[data-testid="oper-toolbar"]') as HTMLElement | null;
    expect(toolbar).not.toBeNull();
    expect(toolbar!.className).not.toContain('flex-wrap');
    const track = container.querySelector('[data-testid="oper-toolbar-track"]') as HTMLElement | null;
    expect(track).not.toBeNull();
    expect(track!.className).not.toContain('flex-wrap');
    expect(track!.className).toContain('flex-nowrap');
    expect(toolbar!.querySelectorAll('button').length).toBeGreaterThanOrEqual(7);

    // Proportional shrinking & re-growing according to container width without overlap or wrapping
    let mockOuterWidth = 500;
    const actionsRow = track!.firstElementChild as HTMLElement;
    const deoperBtnEl = findButtonByText(container, 'De-Oper')!;
    Object.defineProperty(toolbar!, 'clientWidth', { configurable: true, get: () => mockOuterWidth });
    Object.defineProperty(actionsRow, 'offsetWidth', { configurable: true, get: () => 868 });
    Object.defineProperty(deoperBtnEl, 'offsetWidth', { configurable: true, get: () => 100 });
    Object.defineProperty(track!, 'offsetHeight', { configurable: true, get: () => 40 });

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(track!.style.width).toBe('1000px');
    expect(track!.style.transform).toBe('scale(0.5)');
    expect(toolbar!.style.height).toBe('20px');

    mockOuterWidth = 1100;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(track!.style.transform).toBe('');
    expect(track!.style.width).toBe('');
    expect(toolbar!.style.height).toBe('');
    expect(container.textContent).toContain('OPER');
    expect(container.textContent).toContain('UnrealIRCd');
    expect(container.textContent).toContain('Bans / TKL');
    expect(container.textContent).toContain('Users / SA*');
    expect(container.textContent).toContain('Services');
    expect(container.textContent).toContain('Server');

    // Bans dropdown shows Unreal TKLs (STATS g) and NO Ergo UBAN/DLINE
    const bansBtn = findButtonByText(container, 'Bans / TKL')!;
    act(() => {
      bansBtn.click();
    });
    expect(document.body.textContent).not.toContain('UBAN');
    expect(document.body.textContent).not.toContain('DLINE');
    const statsGBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('STATS g (GLINEs)'),
    )!;
    expect(statsGBtn).toBeTruthy();
    await act(async () => {
      statsGBtn.click();
    });
    expect(acked).toContainEqual({ type: 'raw', networkId: 1, line: 'STATS g' });

    // Users / SA* dropdown shows SAPART/CHGHOST on UnrealIRCd and dispatches SAMODE
    const usersBtn = findButtonByText(container, 'Users / SA*')!;
    act(() => {
      usersBtn.click();
    });
    expect(document.body.textContent).toContain('SAPART');
    expect(document.body.textContent).toContain('CHGHOST');
    const saModeBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('SAMODE #opers +m'),
    )!;
    expect(saModeBtn).toBeTruthy();
    await act(async () => {
      saModeBtn.click();
    });
    expect(acked).toContainEqual({ type: 'raw', networkId: 1, line: 'SAMODE #opers +m' });

    // Services dropdown shows Anope services
    const svcBtn = findButtonByText(container, 'Services')!;
    act(() => {
      svcBtn.click();
    });
    expect(document.body.textContent).toContain('OperServ Console');
    expect(document.body.textContent).toContain('Global Network Notice');
    expect(document.body.textContent).toContain('BotServ Console');

    // Trigger De-Oper
    const deoperBtn = findButtonByText(container, 'De-Oper')!;
    await act(async () => {
      deoperBtn.click();
    });
    expect(acked).toContainEqual({ type: 'raw', networkId: 1, line: 'MODE Jawsh -o' });
  });

  it('shows Ergo-tailored controls ONLY when on an Ergo network (+Zios) and hides Unreal/Anope commands', async () => {
    useNetworksStore.getState().setProfile(1, makeErgoProfile());
    const ergoOperState = {
      networkId: 1,
      channels: ['#opers'],
      state: 'connected',
      nick: 'Jawsh',
      userModes: 'Zios',
    };

    useNetworksStore.setState({
      networks: [{ id: 1, name: 'ErgoNet', host: 'irc.ergo.example', port: 6697, nick: 'Jawsh', tls: true }],
      states: { 1: ergoOperState },
      activeKey: '1::#opers',
    });

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(OperToolbar, { networkId: 1, target: '#opers', netState: ergoOperState }));
    });
    expect(container.textContent).toContain('Ergo');
    expect(container.textContent).toContain('Bans');
    expect(container.textContent).not.toContain('Bans / TKL');

    // Bans dropdown has Ergo UBAN, DLINE, KLINE — NO GLINE / GZLINE / SHUN / TEMPSHUN / ELINE / SPAMFILTER
    act(() => {
      findButtonByText(container, 'Bans')!.click();
    });
    expect(document.body.textContent).toContain('UBAN LIST (Ergo)');
    expect(document.body.textContent).toContain('DLINE — IP / CIDR Subnet Ban');
    expect(document.body.textContent).toContain('KLINE — User@Host Server Ban');
    expect(document.body.textContent).not.toContain('GLINE');
    expect(document.body.textContent).not.toContain('GZLINE');
    expect(document.body.textContent).not.toContain('SHUN');

    // Services dropdown has NickServ / ChanServ / HostServ ONLY — NO OperServ / Global / MemoServ / BotServ
    act(() => {
      findButtonByText(container, 'Services')!.click();
    });
    expect(document.body.textContent).toContain('NickServ Console');
    expect(document.body.textContent).toContain('HostServ Console');
    expect(document.body.textContent).not.toContain('OperServ');
    expect(document.body.textContent).not.toContain('Global Network Notice');
    expect(document.body.textContent).not.toContain('BotServ');

    // Server dropdown has DEFCON + REHASH without -tls, NO CONNECT/SQUIT/MODULE
    act(() => {
      findButtonByText(container, 'Server')!.click();
    });
    expect(document.body.textContent).toContain('DEFCON Status');
    expect(document.body.textContent).toContain('REHASH');
    expect(document.body.textContent).not.toContain('REHASH -tls');
    expect(document.body.textContent).not.toContain('MODULE list');

    // OperConsoleModal on Ergo: native DEFCON 2 works & GLINE / Linking tabs are hidden
    act(() => {
      root!.render(React.createElement(OperConsoleModal));
      useOperStore.getState().openModal({ tab: 'broadcast', networkId: 1 });
    });
    expect(document.body.textContent).toContain('Ergo Built-in');
    expect(document.body.textContent).not.toContain('Link / SQUIT');
    expect(document.body.textContent).toContain('Emergency DEFCON Level (Ergo)');

    const defcon2 = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('2 · Strict'),
    )!;
    await act(async () => {
      defcon2.click();
    });
    expect(acked).toContainEqual({ type: 'raw', networkId: 1, line: 'DEFCON 2' });
  });

  it('shows OPER pill in StatusBar only when oper and renders UnrealIRCd GLINE preview in OperConsoleModal', async () => {
    useNetworksStore.setState({
      networks: [{ id: 1, name: 'UnrealNet', host: 'hub1.unreal.example', port: 6697, nick: 'Jawsh', tls: true }],
      states: {
        1: { networkId: 1, channels: ['#opers'], state: 'connected', nick: 'Jawsh', userModes: 'i' },
      },
      activeKey: '1::#opers',
    });
    useNetworksStore.getState().setProfile(1, makeUnrealProfile());

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(StatusBar));
    });
    expect(container.querySelector('[data-testid="statusbar-oper-badge"]')).toBeNull();

    act(() => {
      useNetworksStore.getState().applyUserMode({ networkId: 1, modes: 'iOo' });
    });
    expect(container.querySelector('[data-testid="statusbar-oper-badge"]')).not.toBeNull();

    act(() => {
      root!.render(React.createElement(OperConsoleModal));
      useOperStore.getState().openModal({
        tab: 'bans',
        networkId: 1,
        banType: 'GLINE',
        banMask: '*@spam.example',
        banDuration: '7d',
        banReason: 'Botnet flood',
      });
    });
    expect(document.body.textContent).toContain('Preview: GLINE *@spam.example 7d :Botnet flood');
    expect(document.body.textContent).not.toContain('ANDKILL');

    const applyBanBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Apply / Add Ban'),
    )!;
    await act(async () => {
      applyBanBtn.click();
    });
    expect(acked).toContainEqual({
      type: 'raw',
      networkId: 1,
      line: 'GLINE *@spam.example 7d :Botnet flood',
    });
  });

  it('filters MemberList context menu strictly on channel rank, PREFIX, and IRCd oper capabilities', async () => {
    useBuffersStore.getState().ensure(1, '#opers', 10);
    useBuffersStore.getState().setMembers(1, '#opers', [
      { nick: 'Jawsh', user: 'jawsh', host: 'oper.host', modes: [], away: false },
      { nick: 'troll', user: 'troll', host: '203.0.113.9', modes: [], away: false },
    ]);

    // Case 1: Non-oper ordinary user on Ergo (no channel modes) -> NO Kick/Ban/Op or Oper actions
    useNetworksStore.getState().setProfile(1, makeErgoProfile());
    useNetworksStore.setState({
      networks: [{ id: 1, name: 'ErgoNet', host: 'irc.ergo.example', port: 6697, nick: 'Jawsh', tls: true }],
      states: {
        1: { networkId: 1, channels: ['#opers'], state: 'connected', nick: 'Jawsh', userModes: 'i' },
      },
    });

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(MemberList, { networkId: 1, target: '#opers' }));
    });
    const trollRow1 = container.querySelector('[title="troll"]')!;
    act(() => {
      trollRow1.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
    });
    expect(document.body.textContent).not.toContain('Give Op');
    expect(document.body.textContent).not.toContain('Kickban');
    expect(document.body.textContent).not.toContain('Oper: Kill');

    // Case 2: Opered (+Zios) on Ergo -> sees Ergo oper items (UBAN/DLINE/KLINE/SAMODE/SAJOIN/SANICK/KILL), NO GLINE/SAPART/CHGHOST
    act(() => {
      useNetworksStore.getState().applyUserMode({ networkId: 1, modes: 'Zios' });
    });
    const trollRow2 = container.querySelector('[title="troll"]')!;
    act(() => {
      trollRow2.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
    });
    expect(document.body.textContent).toContain('Oper: Unified Ban (UBAN)');
    expect(document.body.textContent).toContain('Oper: D-Line');
    expect(document.body.textContent).toContain('Oper: K-Line');
    expect(document.body.textContent).not.toContain('Oper: G-Line');
    expect(document.body.textContent).not.toContain('Oper: Force Part');
    expect(document.body.textContent).not.toContain('Oper: Change Host');

    // Case 3: Opered (+iowgs) on UnrealIRCd with chghost CAP -> sees G-Line/SAPART/CHGHOST, NO UBAN/DLINE
    useNetworksStore.getState().setProfile(1, makeUnrealProfile(['chghost']));
    act(() => {
      useNetworksStore.getState().applyUserMode({ networkId: 1, modes: 'iowgs' });
    });
    const trollRow3 = container.querySelector('[title="troll"]')!;
    act(() => {
      trollRow3.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
    });
    expect(document.body.textContent).toContain('Oper: G-Line');
    expect(document.body.textContent).toContain('Oper: Force Part (#opers)');
    expect(document.body.textContent).toContain('Oper: ChgHost / ChgIdent');
    expect(document.body.textContent).not.toContain('Oper: Unified Ban (UBAN)');
    expect(document.body.textContent).not.toContain('Oper: D-Line');
  });

  it('filters MessageInput slash command autocomplete strictly by software dialect, CAPs, and modes', () => {
    useBuffersStore.getState().ensure(1, '#opers', 10);
    useNetworksStore.getState().setProfile(1, makeErgoProfile(['setname']));
    useNetworksStore.setState({
      networks: [{ id: 1, name: 'ErgoNet', host: 'irc.ergo.example', port: 6697, nick: 'Jawsh', tls: true }],
      states: {
        1: { networkId: 1, channels: ['#opers'], state: 'connected', nick: 'Jawsh', userModes: 'Zios' },
      },
    });

    root = createRoot(container);
    act(() => {
      root!.render(React.createElement(MessageInput, { networkId: 1, target: '#opers' }));
    });

    const textarea = container.querySelector('textarea')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;

    // Typing '/gl' on Ergo must NOT suggest UnrealIRCd /gline or Anope /global
    act(() => {
      setValue.call(textarea, '/gl');
      textarea.setSelectionRange(3, 3);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).not.toContain('/gline');
    expect(container.textContent).not.toContain('/global');

    // Typing '/dl' on Ergo suggests /dline
    act(() => {
      setValue.call(textarea, '/dl');
      textarea.setSelectionRange(3, 3);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('/dline');

    // Typing '/setname' on Ergo WITH setname CAP suggests /setname
    act(() => {
      setValue.call(textarea, '/setn');
      textarea.setSelectionRange(5, 5);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('/setname');

    // Drop setname CAP -> /setname disappears immediately from slash suggestions
    act(() => {
      useNetworksStore.getState().setProfile(1, makeErgoProfile(['message-tags']));
    });
    act(() => {
      setValue.call(textarea, '/setn');
      textarea.setSelectionRange(5, 5);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const btnTexts = Array.from(container.querySelectorAll('button'))
      .map((b) => b.textContent || '')
      .join(' ');
    expect(btnTexts).not.toContain('/setname');
  });
});
