// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { describe, it, expect, beforeEach } from 'vitest';
import { dispatchSlashCommand, SLASH_COMMANDS } from '../lib/commands/dispatch';
import { useBuffersStore, bufferKey } from '../stores/buffers';
import { useNetworksStore } from '../stores/networks';
import {
  createEmptyServerProfile,
  ingestServerLines,
  type ServerLineInput,
} from '../lib/networkCapabilities';
import { registerSocketSenders } from '../services/socketBus';

function linesToEvents(lines: string[]): ServerLineInput[] {
  return lines.map((text) => ({ type: 'motd', text }));
}

function setupUnrealOperProfile(extraCaps: string[] = ['setname', 'chghost', 'message-tags']) {
  const profile = ingestServerLines(createEmptyServerProfile(), [
    ...linesToEvents([
      `Negotiated capabilities: ${extraCaps.join(' ')}`,
      'Your host is hub1.example.net, running version UnrealIRCd-6.1.7',
      '004 Jawsh hub1.example.net UnrealIRCd-6.1.7 iowghraAsORTVSxNCWqBzvdHtGpI lvhopsmntikrRcaqOALQbSeIKVfMCuzNTGjZ',
      '005 Jawsh NETWORK=ExampleNet PREFIX=(qaohv)~&@%+ CHANMODES=beI,kfL,lj,psmntirRcOAQKVCuzNSMTGZ HCN SAFELIST EXTBAN=~ WATCH=128 SILENCE=15 KNOCK :are supported by this server',
    ]),
    { type: 'notice', nick: 'OperServ', text: 'Anope 2.1.4 loaded' },
  ]);
  useNetworksStore.getState().setProfile(1, profile);
  useNetworksStore.setState({
    states: {
      1: {
        networkId: 1,
        state: 'connected',
        nick: 'Jawsh',
        channels: ['#general'],
        userModes: 'iowgs',
        modeSpec: {
          prefix: [
            { mode: 'q', symbol: '~' },
            { mode: 'a', symbol: '&' },
            { mode: 'o', symbol: '@' },
            { mode: 'h', symbol: '%' },
            { mode: 'v', symbol: '+' },
          ],
          list: 'beI',
          always: 'k',
          onSet: 'l',
          flags: 'ntm',
          maxModes: 12,
          topicLen: 300,
        },
        canReply: true,
        canAddReaction: true,
      },
    },
  });
}

function setupErgoOperProfile(
  extraCaps: string[] = ['setname', 'roleplay', 'message-tags', 'draft/metadata-2', 'draft/message-redaction'],
) {
  const profile = ingestServerLines(
    createEmptyServerProfile(),
    linesToEvents([
      `Negotiated capabilities: ${extraCaps.join(' ')}`,
      'Your host is ergo.example.net, running version ergo-2.14.0',
      '004 Jawsh ergo.example.net ergo-2.14.0 BRZciosw EIMNRSTWcikmnopqrstuvz',
      '005 Jawsh NETWORK=ErgoNet PREFIX=(qaohv)~&@%+ CHANMODES=beI,k,l,EIMNRSTWcikmnopqrstuvz MONITOR=100 SAFERATE KNOCK :are supported by this server',
      '381 Jawsh :You are now an IRC operator (operclass: admin)',
    ]),
  );
  useNetworksStore.getState().setProfile(1, profile);
  useNetworksStore.setState({
    states: {
      1: {
        networkId: 1,
        state: 'connected',
        nick: 'Jawsh',
        channels: ['#general'],
        userModes: 'Zios',
        modeSpec: {
          prefix: [
            { mode: 'q', symbol: '~' },
            { mode: 'a', symbol: '&' },
            { mode: 'o', symbol: '@' },
            { mode: 'h', symbol: '%' },
            { mode: 'v', symbol: '+' },
          ],
          list: 'beI',
          always: 'k',
          onSet: 'l',
          flags: 'ntmE',
          maxModes: 12,
          topicLen: 300,
        },
        canReply: true,
        canRedact: true,
      },
    },
  });
}

describe('slash command dispatch', () => {
  let sent: Record<string, unknown>[];
  let acked: Record<string, unknown>[];

  const lastMessageText = (target = '#general') => {
    const buf = useBuffersStore.getState().buffers[bufferKey(1, target)];
    return buf?.messages[buf.messages.length - 1]?.text || '';
  };

  beforeEach(() => {
    sent = [];
    acked = [];
    registerSocketSenders(
      (payload) => {
        sent.push(payload);
        return true;
      },
      async (payload) => {
        acked.push(payload);
        return { ok: true };
      },
    );

    useBuffersStore.getState().reset();
    useBuffersStore.getState().ensure(1, '#general', 10);
    useBuffersStore.getState().ensure(1, 'status', 1);
    useNetworksStore.getState().reset();
    useNetworksStore.setState({
      networks: [
        { id: 1, name: 'TestNet', host: 'irc.example.net', port: 6697, nick: 'Jawsh', tls: true },
      ],
      states: {
        1: { networkId: 1, state: 'connected', nick: 'Jawsh', channels: ['#general'], userModes: 'i' },
      },
    });
  });

  it('has unique slash command names across core, oper, unreal, anope, and ergo', () => {
    const names = SLASH_COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('filters /help dynamically by active IRCd software, capabilities, and modes', async () => {
    // Non-oper user on unknown server should see user/info commands (/join, /close, /oper) and NOT priv oper commands (/kill, /gline, /kline)
    await dispatchSlashCommand('/help', 1, '#general');
    expect(lastMessageText()).toContain('/join');
    expect(lastMessageText()).toContain('/close');
    expect(lastMessageText()).toContain('/oper');
    expect(lastMessageText()).not.toContain('/kill');
    expect(lastMessageText()).not.toContain('/gline');
    expect(lastMessageText()).not.toContain('/kline');

    await dispatchSlashCommand('/help unreal', 1, '#general');
    expect(lastMessageText()).toContain('No UNREAL commands are available');

    // Switch to UnrealIRCd + Anope + global oper
    setupUnrealOperProfile();
    await dispatchSlashCommand('/help unreal', 1, '#general');
    expect(lastMessageText()).toContain('/gline');
    expect(lastMessageText()).toContain('/sapart');

    await dispatchSlashCommand('/help anope', 1, '#general');
    expect(lastMessageText()).toContain('/operserv');
    expect(lastMessageText()).toContain('/global');

    await dispatchSlashCommand('/help ergo', 1, '#general');
    expect(lastMessageText()).not.toContain('/uban');
    expect(lastMessageText()).toContain('/nickserv');

    // Switch to Ergo + built-in services (+Zios)
    setupErgoOperProfile();
    await dispatchSlashCommand('/help ergo', 1, '#general');
    expect(lastMessageText()).toContain('/uban');
    expect(lastMessageText()).toContain('/dline');
    expect(lastMessageText()).toContain('/defcon');

    await dispatchSlashCommand('/help unreal', 1, '#general');
    expect(lastMessageText()).not.toContain('/gline');
    expect(lastMessageText()).toContain('/sajoin');

    await dispatchSlashCommand('/help anope', 1, '#general');
    expect(lastMessageText()).not.toContain('/operserv');

    await dispatchSlashCommand('/help gline', 1, '#general');
    expect(lastMessageText()).toContain('G-Line');
    expect(lastMessageText()).toContain('Unavailable here');
  });

  it('returns false for non-slash messages', async () => {
    const handled = await dispatchSlashCommand('hello world', 1, '#general');
    expect(handled).toBe(false);
  });

  it('routes /mode accurately for channels, own nick in status/DM, and explicit targets', async () => {
    await dispatchSlashCommand('/mode +m', 1, '#general');
    await dispatchSlashCommand('/mode +i', 1, 'status');
    await dispatchSlashCommand('/mode bob +o', 1, '#general');
    expect(sent.map((s) => s.line)).toEqual([
      'MODE #general +m',
      'MODE Jawsh +i',
      'MODE bob +o',
    ]);
  });

  it('dispatches standard IRCOp commands with IRC trailing colons when opered on UnrealIRCd', async () => {
    await dispatchSlashCommand('/oper jawsh supersecret', 1, 'status');
    await dispatchSlashCommand('/oper certoper', 1, 'status');

    setupUnrealOperProfile();
    await dispatchSlashCommand('/deoper', 1, 'status');
    await dispatchSlashCommand('/kill troll Spamming links everywhere', 1, '#general');
    await dispatchSlashCommand('/wallops Server upgrade in 5 minutes', 1, 'status');
    await dispatchSlashCommand('/globops Attention all opers', 1, 'status');
    await dispatchSlashCommand('/locops Local notice here', 1, 'status');
    await dispatchSlashCommand('/chatops Oper lounge check', 1, 'status');
    await dispatchSlashCommand('/squit leaf2.irc.net Maintenance reboot', 1, 'status');
    await dispatchSlashCommand('/rehash', 1, 'status');
    await dispatchSlashCommand('/operclose', 1, 'status');

    expect(acked.map((a) => a.line)).toEqual([
      'OPER jawsh supersecret',
      'OPER certoper',
      'MODE Jawsh -o',
      'KILL troll :Spamming links everywhere',
      'WALLOPS :Server upgrade in 5 minutes',
      'GLOBOPS :Attention all opers',
      'LOCOPS :Local notice here',
      'CHATOPS :Oper lounge check',
      'SQUIT leaf2.irc.net :Maintenance reboot',
      'REHASH',
      'CLOSE',
    ]);
  });

  it('dispatches UnrealIRCd 6 TKLs, SA*, CHG*/SET*, and utility commands cleanly', async () => {
    setupUnrealOperProfile(['setname', 'chghost', 'message-tags']);

    await dispatchSlashCommand('/gline *@bad.host 7d Abusive botnet', 1, 'status');
    await dispatchSlashCommand('/ungline *@bad.host', 1, 'status');
    await dispatchSlashCommand('/zline 198.51.100.5 1d Flood attack', 1, 'status');
    await dispatchSlashCommand('/gzline 198.51.100.0/24 12h DDoS', 1, 'status');
    await dispatchSlashCommand('/shun troll@* 1h Quiet timeout', 1, 'status');
    await dispatchSlashCommand('/tempshun bob Spamming', 1, 'status');
    await dispatchSlashCommand('/untempshun bob', 1, 'status');
    await dispatchSlashCommand('/eline *@trusted.net gkqs 0 Trusted relay', 1, 'status');
    await dispatchSlashCommand(
      '/spamfilter add simple pc block 1d Stop_spamming free nitro today',
      1,
      'status',
    );
    await dispatchSlashCommand('/sajoin bob', 1, '#general');
    await dispatchSlashCommand('/sapart bob #general Please leave', 1, 'status');
    await dispatchSlashCommand('/samode +m', 1, '#general');
    await dispatchSlashCommand('/sanick bob robert', 1, 'status');
    await dispatchSlashCommand('/chghost bob vanity.host', 1, 'status');
    await dispatchSlashCommand('/chgident bob customid', 1, 'status');
    await dispatchSlashCommand('/chgname bob New Real Name', 1, 'status');
    await dispatchSlashCommand('/setname My New GECOS', 1, 'status');
    await dispatchSlashCommand('/swhois bob is a Network Admin', 1, 'status');
    await dispatchSlashCommand('/module list', 1, 'status');

    expect(acked.map((a) => a.line)).toEqual([
      'GLINE *@bad.host 7d :Abusive botnet',
      'GLINE -*@bad.host',
      'ZLINE 198.51.100.5 1d :Flood attack',
      'GZLINE 198.51.100.0/24 12h :DDoS',
      'SHUN troll@* 1h :Quiet timeout',
      'TEMPSHUN bob :Spamming',
      'TEMPSHUN -bob',
      'ELINE *@trusted.net gkqs 0 :Trusted relay',
      'SPAMFILTER add simple pc block 1d Stop_spamming :free nitro today',
      'SAJOIN bob #general',
      'SAPART bob #general :Please leave',
      'SAMODE #general +m',
      'SANICK bob robert',
      'CHGHOST bob vanity.host',
      'CHGIDENT bob customid',
      'CHGNAME bob :New Real Name',
      'SETNAME :My New GECOS',
      'SWHOIS bob :is a Network Admin',
      'MODULE list',
    ]);
  });

  it('dispatches Ergo commands (KLINE, DLINE, UBAN, DEFCON, roleplay) cleanly and blocks Unreal/Anope commands', async () => {
    setupErgoOperProfile();

    await dispatchSlashCommand('/kline ANDKILL 2d *!*@bad.net Evading ban', 1, 'status');
    await dispatchSlashCommand('/kline *@bad.net 2d Evading ban', 1, 'status');
    await dispatchSlashCommand('/unkline *!*@bad.net', 1, 'status');
    await dispatchSlashCommand('/dline 192.0.2.0/24 7d Open proxy', 1, 'status');
    await dispatchSlashCommand('/undline 192.0.2.0/24', 1, 'status');
    await dispatchSlashCommand('/uban add 192.0.2.5 1d Flood', 1, 'status');
    await dispatchSlashCommand('/defcon 4', 1, 'status');
    await dispatchSlashCommand('/npc Gandalf You shall not pass!', 1, '#general');
    await dispatchSlashCommand('/scene The tavern falls silent.', 1, '#general');
    await dispatchSlashCommand('/ambience Rain taps on the window.', 1, '#general');

    expect(acked.map((a) => a.line)).toEqual([
      'KLINE ANDKILL 2d *!*@bad.net :Evading ban',
      'KLINE *@bad.net 2d :Evading ban',
      'UNKLINE *!*@bad.net',
      'DLINE 192.0.2.0/24 7d :Open proxy',
      'UNDLINE 192.0.2.0/24',
      'UBAN add 192.0.2.5 1d Flood',
      'DEFCON 4',
      'NPC #general Gandalf :You shall not pass!',
      'SCENE #general :The tavern falls silent.',
      'AMBIENCE #general :Rain taps on the window.',
    ]);

    // Unreal / Anope commands MUST be rejected locally on Ergo without sending wire lines
    const beforeCount = acked.length;
    await dispatchSlashCommand('/gline *@bad.host 7d Spam', 1, 'status');
    expect(lastMessageText('status')).toContain('not supported on Ergo');
    await dispatchSlashCommand('/os AKILL ADD +7d *@bad.isp Flood', 1, 'status');
    expect(lastMessageText('status')).toContain('does not exist on Ergo');
    await dispatchSlashCommand('/sapart bob #general Bye', 1, 'status');
    expect(lastMessageText('status')).toContain('SAPART');
    await dispatchSlashCommand('/chghost bob vhost.net', 1, 'status');
    expect(lastMessageText('status')).toContain('HostServ');
    expect(acked.length).toBe(beforeCount);
  });

  it('dispatches Anope & Ergo built-in service shortcuts and channel mode helpers when permitted', async () => {
    setupUnrealOperProfile();
    useBuffersStore.getState().setMembers(1, '#general', [
      { nick: 'Jawsh', user: 'jawsh', host: 'oper.net', modes: ['q'], away: false },
      { nick: 'spambot', user: 'bot', host: 'spam.example.org', modes: [], away: false },
    ]);

    await dispatchSlashCommand('/ns IDENTIFY secret', 1, 'status');
    await dispatchSlashCommand('/cs INFO #general', 1, 'status');
    await dispatchSlashCommand('/hs REQUEST cool.vhost', 1, 'status');
    await dispatchSlashCommand('/os AKILL ADD +7d *@bad.isp Flooding', 1, 'status');
    await dispatchSlashCommand('/ms LIST', 1, 'status');
    await dispatchSlashCommand('/bs BOTLIST', 1, 'status');
    await dispatchSlashCommand('/global Maintenance at midnight UTC', 1, 'status');
    await dispatchSlashCommand('/jupe bad.server Split server', 1, 'status');
    await dispatchSlashCommand('/owner Jawsh', 1, '#general');
    await dispatchSlashCommand('/protect Jawsh', 1, '#general');
    await dispatchSlashCommand('/kb spambot Go away', 1, '#general');

    expect(acked.map((a) => a.line)).toEqual([
      'PRIVMSG NickServ :IDENTIFY secret',
      'PRIVMSG ChanServ :INFO #general',
      'PRIVMSG HostServ :REQUEST cool.vhost',
      'PRIVMSG OperServ :AKILL ADD +7d *@bad.isp Flooding',
      'PRIVMSG MemoServ :LIST',
      'PRIVMSG BotServ :BOTLIST',
      'PRIVMSG Global :Maintenance at midnight UTC',
      'PRIVMSG OperServ :JUPE bad.server Split server',
      'MODE #general +q Jawsh',
      'MODE #general +a Jawsh',
      'MODE #general +b *!*@spam.example.org',
      'KICK #general spambot :Go away',
    ]);

    // Verify /nick, /topic, /kick use wsHub-compatible raw frames and /me, /msg use acked frames
    const ackedCountBefore = acked.length;
    await dispatchSlashCommand('/nick JawshAlt', 1, '#general');
    await dispatchSlashCommand('/topic Welcome to #general', 1, '#general');
    await dispatchSlashCommand('/kick spambot spam', 1, '#general');
    await dispatchSlashCommand('/me waves', 1, '#general');
    await dispatchSlashCommand('/msg Bob hi there', 1, '#general');
    expect(sent.filter((s) => s.type === 'raw').map((s) => s.line)).toEqual([
      'NICK JawshAlt',
      'TOPIC #general :Welcome to #general',
      'KICK #general spambot :spam',
    ]);
    expect(acked.slice(ackedCountBefore)).toEqual([
      { type: 'action', networkId: 1, target: '#general', text: 'waves' },
      { type: 'send', networkId: 1, target: 'Bob', text: 'hi there' },
    ]);

    // Block channel moderation / CAP / oper commands when user lacks privileges or CAPs
    setupErgoOperProfile(['message-tags']);
    const ergoNoRoleplay = useNetworksStore.getState().profileFor(1);
    useNetworksStore.getState().setProfile(1, {
      ...ergoNoRoleplay,
      availableChanModes: ergoNoRoleplay.availableChanModes.replace(/E/g, ''),
      roleplayEnabled: false,
    });
    const before = acked.length;
    await dispatchSlashCommand('/setname Blocked Name', 1, '#general');
    expect(lastMessageText('#general')).toContain('setname');
    await dispatchSlashCommand('/npc Gandalf Hi', 1, '#general');
    expect(lastMessageText('#general')).toContain('roleplay');

    // Non-oper cannot kick/kb without channel +h/+o
    useNetworksStore.setState({
      states: { 1: { networkId: 1, state: 'connected', nick: 'Jawsh', channels: ['#general'], userModes: 'i' } },
    });
    useBuffersStore.getState().setMembers(1, '#general', [
      { nick: 'Jawsh', user: 'jawsh', host: 'user.net', modes: [], away: false },
      { nick: 'spambot', user: 'bot', host: 'spam.example.org', modes: [], away: false },
    ]);
    await dispatchSlashCommand('/kb spambot No perms', 1, '#general');
    expect(lastMessageText('#general')).toContain('Requires channel operator');
    await dispatchSlashCommand('/kill spambot No oper', 1, '#general');
    expect(lastMessageText('#general')).toContain('Requires IRC operator');
    expect(acked.length).toBe(before);
  });

  it('treats /connect <server> as raw CONNECT when opered with server routing, and blocks otherwise', async () => {
    await dispatchSlashCommand('/connect hub2.irc.net 6697', 1, 'status');
    expect(acked).toEqual([]);
    expect(lastMessageText('status')).toContain('Requires IRC operator');

    setupErgoOperProfile();
    await dispatchSlashCommand('/connect hub2.irc.net 6697', 1, 'status');
    expect(acked).toEqual([]);
    expect(lastMessageText('status')).toContain('not supported on Ergo');

    setupUnrealOperProfile();
    await dispatchSlashCommand('/connect hub2.irc.net 6697', 1, 'status');
    expect(acked).toEqual([{ type: 'raw', networkId: 1, line: 'CONNECT hub2.irc.net 6697' }]);
  });
});
