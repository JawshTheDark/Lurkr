// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildCapabilityContext,
  createEmptyServerProfile,
  detectIrcdFromVersion,
  evaluateCommand,
  getAvailableBanTypes,
  getAvailableBroadcastTypes,
  getAvailableQuickServerCmds,
  getAvailableServices,
  getAvailableSlashCommands,
  getAvailableUserActions,
  getConfigurableUserModes,
  ingestServerLines,
  supportsAndKillFlag,
  supportsDefcon,
  supportsRehashTlsFlag,
  supportsServerRouting,
  supportsSnomaskEdit,
} from '../lib/networkCapabilities';
import { SLASH_COMMANDS } from '../lib/commands/dispatch';
import { useNetworksStore } from '../stores/networks';

describe('networkCapabilities inference & strict capability gating', () => {
  beforeEach(() => {
    useNetworksStore.getState().reset();
  });

  it('detects Ergo, UnrealIRCd 6, InspIRCd, and Solanum from 002/004/351/005/CAP lines', () => {
    expect(detectIrcdFromVersion('ergo-2.14.0')).toBe('ergo');
    expect(detectIrcdFromVersion('UnrealIRCd-6.1.7')).toBe('unrealircd');
    expect(detectIrcdFromVersion('InspIRCd-4.2.0')).toBe('inspircd');
    expect(detectIrcdFromVersion('solanum-1.0-dev')).toBe('solanum');

    const ergo = ingestServerLines(createEmptyServerProfile(), [
      { type: 'motd', text: 'Negotiated capabilities: account-notify batch chathistory echo-message message-tags setname' },
      { type: 'motd', text: 'Your host is irc.ergo.chat, running version ergo-2.14.0' },
      { type: 'motd', text: '004 Nick irc.ergo.chat ergo-2.14.0 BRZciosw EIMNRSTWcikmnopqrstuvz' },
      { type: 'motd', text: '005 Nick NETWORK=ErgoNet PREFIX=(qaohv)~&@%+ CHANMODES=beI,k,l,EIMNRSTWcikmnopqrstuvz SAFERATE KNOCK :are supported' },
      { type: 'motd', text: '381 Nick :You are now an IRC operator (operclass: local-mod, capabilities: ban kill)' },
    ]);
    expect(ergo.ircd).toBe('ergo');
    expect(ergo.services).toBe('ergo');
    expect(ergo.capsKnown).toBe(true);
    expect(ergo.negotiatedCaps).toContain('setname');
    expect(ergo.operClass).toBe('local-mod');
    expect(ergo.operCapabilitiesKnown).toBe(true);
    expect(ergo.operCapabilities).toEqual(['ban', 'kill']);
    expect(ergo.availableUserModes).toBe('BRZciosw');
    expect(ergo.availableChanModes).toContain('E');
    expect(ergo.roleplayEnabled).toBe(true);

    const unreal = ingestServerLines(createEmptyServerProfile(), [
      { type: 'motd', text: 'Your host is irc.example.net, running version UnrealIRCd-6.1.7' },
      { type: 'motd', text: '005 Nick HCN SAFELIST EXTBAN=~ WATCH=128 SILENCE=15 :are supported' },
      { type: 'motd', text: '008 Nick Server notice mask (+kcfvGqsSo)' },
      { type: 'notice', nick: 'OperServ', text: 'Anope 2.1.3 loaded' },
      { type: 'error', text: '421 Nick TSCTL :Unknown command' },
    ]);
    expect(unreal.ircd).toBe('unrealircd');
    expect(unreal.services).toBe('anope');
    expect(unreal.snomask).toBe('kcfvGqsSo');
    expect(unreal.unsupportedCommands).toContain('TSCTL');
  });

  it('tracks live 421/401/351/CAP lines inside useNetworksStore cleanly', () => {
    useNetworksStore.setState({
      networks: [{ id: 7, name: 'ErgoNet', host: 'ergo.net', port: 6697, nick: 'Jawsh', tls: true }],
    });
    useNetworksStore.getState().ingestServerEvents(7, [
      { type: 'motd', text: 'Negotiated capabilities: message-tags setname' },
      { type: 'motd', text: 'Your host is ergo.net, running version ergo-2.14.0' },
      { type: 'error', text: '421 Jawsh DEFCON :Unknown command' },
    ]);

    const profile = useNetworksStore.getState().profileFor(7);
    expect(profile.ircd).toBe('ergo');
    expect(profile.unsupportedCommands).toContain('DEFCON');

    const ctx = buildCapabilityContext(
      { state: 'connected', nick: 'Jawsh', userModes: 'Zios' },
      profile,
    );
    expect(evaluateCommand(ctx, 'DEFCON').allowed).toBe(false);
    expect(evaluateCommand(ctx, 'KLINE').allowed).toBe(true);
    expect(evaluateCommand(ctx, 'SETNAME').allowed).toBe(true);
  });

  it('strictly separates Ergo (+Zios) and UnrealIRCd+Anope (+iowgs) menus, modes, and commands', () => {
    const ergoProf = ingestServerLines(createEmptyServerProfile(), [
      { type: 'motd', text: 'Negotiated capabilities: message-tags chathistory' },
      { type: 'motd', text: 'Your host is ergo.net, running version ergo-2.14.0' },
      { type: 'motd', text: '004 Jawsh ergo.net ergo-2.14.0 BRZciosw EIMNRSTWcikmnopqrstuvz' },
      { type: 'motd', text: '005 Jawsh PREFIX=(qaohv)~&@%+ CHANMODES=beI,k,l,EMnmt MONITOR=100 SAFERATE :are supported' },
    ]);
    const ergoCtx = buildCapabilityContext(
      { state: 'connected', nick: 'Jawsh', userModes: 'Zios' },
      ergoProf,
    );

    expect(getAvailableBanTypes(ergoCtx).map((b) => b.value)).toEqual(['KLINE', 'DLINE', 'UBAN ADD']);
    expect(getAvailableUserActions(ergoCtx).map((a) => a.value)).toEqual(['KILL', 'SAJOIN', 'SAMODE', 'SANICK']);
    expect(getAvailableBroadcastTypes(ergoCtx).map((b) => b.value)).toEqual([
      'WALLOPS',
      'NPC',
      'SCENE',
      'AMBIENCE',
    ]);
    // Without +E / roleplay CAP, Ergo hides NPC/SCENE/AMBIENCE and shows only WALLOPS
    const ergoNoRoleplayCtx = buildCapabilityContext(
      { state: 'connected', nick: 'Jawsh', userModes: 'Zios' },
      { ...ergoProf, availableChanModes: ergoProf.availableChanModes.replace(/E/g, ''), roleplayEnabled: false },
    );
    expect(getAvailableBroadcastTypes(ergoNoRoleplayCtx).map((b) => b.value)).toEqual(['WALLOPS']);
    expect(getAvailableServices(ergoCtx)).toEqual(['NickServ', 'ChanServ', 'HostServ']);
    expect(getAvailableQuickServerCmds(ergoCtx).map((q) => q.cmd)).toEqual([
      'LUSERS',
      'STATS o',
      'STATS u',
      'STATS d',
      'UBAN LIST',
      'DEFCON',
      'HELPOP',
      'VERSION',
    ]);
    expect(supportsDefcon(ergoCtx)).toEqual({ ergo: true, anope: false });
    expect(supportsAndKillFlag(ergoCtx)).toBe(true);
    expect(supportsRehashTlsFlag(ergoCtx)).toBe(false);
    expect(supportsServerRouting(ergoCtx)).toBe(false);
    expect(supportsSnomaskEdit(ergoCtx)).toBe(true);
    const ergoModeLetters = getConfigurableUserModes(ergoCtx).map((m) => m.mode);
    expect(ergoModeLetters).toContain('i');
    expect(ergoModeLetters).toContain('s');
    expect(ergoModeLetters).toContain('Z');
    expect(ergoModeLetters).toContain('R');
    expect(ergoModeLetters).not.toContain('x');
    expect(evaluateCommand(ergoCtx, 'SETNAME').allowed).toBe(false);
    expect(evaluateCommand(ergoCtx, 'NPC').allowed).toBe(true);

    const unrealProf = ingestServerLines(createEmptyServerProfile(), [
      { type: 'motd', text: 'Negotiated capabilities: setname chghost message-tags' },
      { type: 'motd', text: 'Your host is hub1.unreal.net, running version UnrealIRCd-6.1.7' },
      { type: 'motd', text: '004 Jawsh hub1.unreal.net UnrealIRCd-6.1.7 iowghraAsORTVSxNCWqBzvdHtGpI lvhopsmntikr' },
      { type: 'motd', text: '005 Jawsh PREFIX=(qaohv)~&@%+ CHANMODES=beI,kfL,lj,psmnt HCN SAFELIST EXTBAN=~ KNOCK :are supported' },
      { type: 'motd', text: '008 Jawsh Server notice mask (+kcfvGqsSo)' },
      { type: 'notice', nick: 'OperServ', text: 'Anope 2.1.4 loaded' },
    ]);
    const unrealCtx = buildCapabilityContext(
      { state: 'connected', nick: 'Jawsh', userModes: 'iowgs' },
      unrealProf,
    );

    expect(getAvailableBanTypes(unrealCtx).map((b) => b.value)).toEqual([
      'GLINE',
      'KLINE',
      'ZLINE',
      'GZLINE',
      'SHUN',
      'TEMPSHUN',
      'ELINE',
      'SPAMFILTER',
      'OS AKILL',
      'OS SQLINE',
      'OS SZLINE',
      'OS SNLINE',
      'OS SGLINE',
    ]);
    expect(getAvailableUserActions(unrealCtx).map((a) => a.value)).toContain('SAPART');
    expect(getAvailableUserActions(unrealCtx).map((a) => a.value)).toContain('CHGHOST');
    expect(getAvailableUserActions(unrealCtx).map((a) => a.value)).not.toContain('UBAN');
    expect(getAvailableBroadcastTypes(unrealCtx).map((b) => b.value)).toEqual([
      'WALLOPS',
      'GLOBOPS',
      'LOCOPS',
      'CHATOPS',
      'GLOBAL',
      'ADDMOTD',
      'ADDOMOTD',
    ]);
    expect(getAvailableServices(unrealCtx)).toEqual([
      'OperServ',
      'NickServ',
      'ChanServ',
      'HostServ',
      'MemoServ',
      'BotServ',
    ]);
    expect(supportsDefcon(unrealCtx)).toEqual({ ergo: false, anope: true });
    expect(supportsAndKillFlag(unrealCtx)).toBe(false);
    expect(supportsRehashTlsFlag(unrealCtx)).toBe(true);
    expect(supportsServerRouting(unrealCtx)).toBe(true);
    expect(evaluateCommand(unrealCtx, 'DLINE').allowed).toBe(false);
    expect(evaluateCommand(unrealCtx, 'UBAN').allowed).toBe(false);
    expect(evaluateCommand(unrealCtx, 'NPC').allowed).toBe(false);
  });

  it('gates commands on local oper (+O vs +o), Solanum PREFIX, CAPs, and oper capabilities', () => {
    const unrealProf = ingestServerLines(createEmptyServerProfile(), [
      { type: 'motd', text: 'Your host is leaf.unreal.net, running version UnrealIRCd-6.1.7' },
      { type: 'motd', text: 'Negotiated capabilities: chghost' },
    ]);
    const localOperCtx = buildCapabilityContext(
      { state: 'connected', nick: 'Jawsh', userModes: 'iO' },
      unrealProf,
    );
    expect(localOperCtx.isLocalOnlyOper).toBe(true);
    expect(evaluateCommand(localOperCtx, 'KLINE').allowed).toBe(true);
    expect(evaluateCommand(localOperCtx, 'KILL').allowed).toBe(true);
    expect(evaluateCommand(localOperCtx, 'GLINE').allowed).toBe(false);
    expect(evaluateCommand(localOperCtx, 'GZLINE').allowed).toBe(false);
    expect(evaluateCommand(localOperCtx, 'SAJOIN').allowed).toBe(false);
    expect(evaluateCommand(localOperCtx, 'CONNECT').allowed).toBe(false);

    const restrictedErgoProf = ingestServerLines(createEmptyServerProfile(), [
      { type: 'motd', text: 'Your host is ergo.net, running version ergo-2.14.0' },
      { type: 'motd', text: '381 Jawsh :You are now an IRC operator (operclass: helper, capabilities: kill rehash)' },
    ]);
    const restrictedCtx = buildCapabilityContext(
      { state: 'connected', nick: 'Jawsh', userModes: 'Zio' },
      restrictedErgoProf,
    );
    expect(evaluateCommand(restrictedCtx, 'KILL').allowed).toBe(true);
    expect(evaluateCommand(restrictedCtx, 'REHASH').allowed).toBe(true);
    expect(evaluateCommand(restrictedCtx, 'DLINE').allowed).toBe(false);
    expect(evaluateCommand(restrictedCtx, 'DEFCON').allowed).toBe(false);
    expect(evaluateCommand(restrictedCtx, 'DIE').allowed).toBe(false);

    const solanumProf = ingestServerLines(createEmptyServerProfile(), [
      { type: 'motd', text: 'Negotiated capabilities: message-tags' },
      { type: 'motd', text: 'Your host is irc.libera.chat, running version solanum-1.0-dev' },
      { type: 'motd', text: '005 Jawsh PREFIX=(ov)@+ CALLERID DEAF EXTBAN=$ :are supported' },
    ]);
    const solanumChanOpCtx = buildCapabilityContext(
      {
        state: 'connected',
        nick: 'Jawsh',
        userModes: 'i',
        modeSpec: {
          prefix: [
            { mode: 'o', symbol: '@' },
            { mode: 'v', symbol: '+' },
          ],
          list: 'beI',
          always: 'k',
          onSet: 'l',
          flags: 'nt',
          maxModes: 4,
          topicLen: 300,
        },
      },
      solanumProf,
      { selfChannelModes: ['o'], channelModes: 'nt', target: '#libera' },
    );
    const availNames = new Set(getAvailableSlashCommands(SLASH_COMMANDS, solanumChanOpCtx).map((c) => c.name));
    expect(availNames.has('op')).toBe(true);
    expect(availNames.has('voice')).toBe(true);
    expect(availNames.has('kick')).toBe(true);
    expect(availNames.has('halfop')).toBe(false);
    expect(availNames.has('owner')).toBe(false);
    expect(availNames.has('protect')).toBe(false);
    expect(availNames.has('kill')).toBe(false);
    expect(availNames.has('setname')).toBe(false);
    expect(availNames.has('redact')).toBe(false);
    expect(availNames.has('oper')).toBe(true);
    expect(availNames.has('deoper')).toBe(false);
  });
});
