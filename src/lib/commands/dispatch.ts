// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { socketSend, socketSendWithAck } from '../../services/socketBus';
import { useBuffersStore, idFor } from '../../stores/buffers';
import { useNetworksStore } from '../../stores/networks';
import { useSettingsStore } from '../../stores/settings';
import { useThemesStore } from '../../stores/themes';
import { useWhoisStore } from '../../stores/whois';
import { useChanlistStore } from '../../stores/chanlist';
import { useDccStore } from '../../stores/dcc';
import { useIgnoresStore } from '../../stores/ignores';
import { useRelayBotsStore } from '../../stores/relayBots';
import { useAliasesStore } from '../../stores/aliases';
import { useConfigStore } from '../../stores/config';
import { isChannelTarget } from '../../shared/channels';
import { resolveAliases } from '../../shared/aliases';
import { jitsiRoomUrl } from '../../shared/jitsi';
import { parseIgnoreArgs } from '../../shared/parseIgnore';
import { parseDccCommand } from './dcc';
import { parseXdccCommand } from './xdcc';
import { parseRelayCommand } from './relay';
import { parseAliasArgs, aliasListLines } from './alias';
import { parseRename } from './rename';
import {
  OPER_SLASH_COMMANDS,
  dispatchOperCommand,
  getCapabilityContextFor,
  getOwnNick,
  type SlashCommandCategory,
  type SlashCommandDef,
} from './oper';
import {
  evaluateCommand,
  formatServerSummary,
  getAvailableSlashCommands,
} from '../networkCapabilities';

export type { SlashCommandCategory, SlashCommandDef };

const CORE_SLASH_COMMANDS: SlashCommandDef[] = [
  { name: 'join', args: '<#channel> [key]', description: 'Join a channel', category: 'channel' },
  { name: 'part', args: '[#channel] [reason]', description: 'Leave a channel', category: 'channel' },
  { name: 'cycle', args: '[#channel]', description: 'Part and rejoin a channel', category: 'channel' },
  { name: 'msg', args: '<nick> <message>', description: 'Send a private message', category: 'general' },
  { name: 'query', args: '<nick> [message]', description: 'Open a DM buffer', category: 'general' },
  { name: 'me', args: '<action>', description: 'Send an action (/me)', category: 'general' },
  { name: 'notice', args: '<target> <message>', description: 'Send a NOTICE', category: 'general' },
  { name: 'nick', args: '<newnick>', description: 'Change your nickname', category: 'general' },
  { name: 'topic', args: '[new topic]', description: 'View or set channel topic', category: 'channel' },
  { name: 'kick', args: '<nick> [reason]', description: 'Kick a user from the channel', category: 'channel' },
  { name: 'mode', args: '[target] <modes> [args]', description: 'Set or query modes', category: 'channel' },
  { name: 'op', args: '<nick...>', description: 'Give operator (+o)', category: 'channel' },
  { name: 'deop', args: '<nick...>', description: 'Remove operator (-o)', category: 'channel' },
  { name: 'halfop', args: '<nick...>', description: 'Give half-operator (+h)', category: 'channel' },
  { name: 'dehalfop', args: '<nick...>', description: 'Remove half-operator (-h)', category: 'channel' },
  { name: 'voice', args: '<nick...>', description: 'Give voice (+v)', category: 'channel' },
  { name: 'devoice', args: '<nick...>', description: 'Remove voice (-v)', category: 'channel' },
  { name: 'whois', args: '[nick]', description: 'Query user information', category: 'general' },
  { name: 'invite', args: '<nick> [#channel]', description: 'Invite a user to a channel', category: 'channel' },
  { name: 'list', args: '', description: 'List channels on the network', category: 'network' },
  { name: 'away', args: '[message]', description: 'Set away status', category: 'general' },
  { name: 'back', args: '', description: 'Clear away status', category: 'general' },
  { name: 'clear', args: '', description: 'Clear current buffer scrollback', category: 'general' },
  { name: 'unclear', args: '', description: 'Restore cleared scrollback', category: 'general' },
  { name: 'close', args: '', description: 'Close current buffer', category: 'general' },
  { name: 'raw', args: '<command>', description: 'Send raw IRC line', category: 'general' },
  { name: 'quote', args: '<command>', description: 'Alias for /raw (send raw IRC line)', category: 'general' },
  { name: 'set', args: '<key> <value>', description: 'Change a setting', category: 'general' },
  { name: 'theme', args: '<name|id>', description: 'Switch active theme', category: 'general' },
  { name: 'dcc', args: '<chat|send|close> ...', description: 'DCC chat or file transfer', category: 'general' },
  { name: 'xdcc', args: '<bot> <packs>', description: 'Queue XDCC pack request', category: 'general' },
  {
    name: 'ignore',
    args: '[-regexp|-full] [-except] [-network] [-time <dur>] <mask|#chan> [LEVELS...]',
    description: 'List or add ignore rules (supports ALL, PUBLIC, MSGS, NOHIGHLIGHT, NOUNREAD, NONOTIFY)',
    category: 'general',
  },
  { name: 'unignore', args: '<id>', description: 'Remove an ignore rule', category: 'general' },
  { name: 'relay', args: '[list|add <nick> [pattern]|remove <nick>]', description: 'Manage relay/Janus bridge bots on this network', category: 'network' },
  { name: 'alias', args: '[name [commands...]|-name]', description: 'List, define, or remove command aliases', category: 'general' },
  { name: 'unalias', args: '<name>', description: 'Remove a command alias', category: 'general' },
  { name: 'say', args: '<text>', description: 'Send a plain chat message (useful in aliases)', category: 'general' },
  { name: 'jitsi', args: '[room]', description: 'Start a Jitsi Meet video call and post the link', category: 'general' },
  { name: 'rename', args: '[#chan] <#newname> [reason]', description: 'Rename an IRC channel (draft/channel-rename)', category: 'channel' },
  { name: 'connect', args: '[server [port] [remote]]', description: 'Connect current network or link IRC server (CONNECT)', category: 'network' },
  { name: 'disconnect', args: '[reason]', description: 'Disconnect current network', category: 'network' },
  { name: 'reconnect', args: '', description: 'Reconnect current network', category: 'network' },
  { name: 'commands', args: '[filter]', description: 'Show available IRC & client commands', category: 'general' },
  { name: 'help', args: '[oper|unreal|anope|ergo|services|command]', description: 'Show available commands or category help', category: 'general' },
];

export const SLASH_COMMANDS: SlashCommandDef[] = [
  ...CORE_SLASH_COMMANDS,
  ...OPER_SLASH_COMMANDS,
];

export function pushLocalInfo(
  networkId: number | null,
  target: string,
  text: string,
): void {
  useBuffersStore.getState().pushLive({
    networkId,
    target,
    type: 'motd',
    text,
    time: new Date().toISOString(),
  });
}

export async function dispatchSlashCommand(
  rawLine: string,
  networkId: number | null,
  target: string,
  replyTo?: number,
  expanded = false,
): Promise<boolean> {
  const trimmed = rawLine.trim();
  if (!trimmed.startsWith('/')) return false;

  const spaceIdx = trimmed.indexOf(' ');
  const cmd = (spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)).toLowerCase();
  const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
  const parts = rest ? rest.split(/\s+/) : [];

  const buffers = useBuffersStore.getState();
  const networks = useNetworksStore.getState();

  if (!expanded) {
    const aliasStore = useAliasesStore.getState();
    await aliasStore.settled();
    const matchedAlias = aliasStore.find(cmd);
    if (matchedAlias) {
      const resolved = resolveAliases(trimmed, aliasStore.aliases, {
        channel: target || '',
        nick: networkId != null ? getOwnNick(networkId) : '',
        network: networkId != null ? networks.networkById(networkId)?.name || '' : '',
      });
      if (resolved.tooMany) {
        pushLocalInfo(networkId, target, '/alias: too many commands expanded');
        return true;
      }
      if (resolved.stoppedAt) {
        pushLocalInfo(networkId, target, `/alias: alias loop or depth limit at /${resolved.stoppedAt}`);
        return true;
      }
      for (const line of resolved.lines) {
        await dispatchSlashCommand(line, networkId, target, replyTo, true);
      }
      return true;
    }
  }

  const requireNet = (): number | null => {
    if (networkId == null) {
      pushLocalInfo(networkId, target, `/${cmd}: no active network`);
      return null;
    }
    return networkId;
  };

  switch (cmd) {
    case 'j':
    case 'join': {
      const nid = requireNet();
      if (nid == null) return true;
      const ch = parts[0];
      if (!ch) {
        pushLocalInfo(nid, target, 'Usage: /join <#channel> [key]');
        return true;
      }
      buffers.joinOrActivate(nid, ch, parts[1]);
      return true;
    }
    case 'part':
    case 'leave': {
      const nid = requireNet();
      if (nid == null) return true;
      const ch = parts[0] && isChannelTarget(parts[0]) ? parts[0] : target;
      const reason =
        parts[0] && isChannelTarget(parts[0]) ? parts.slice(1).join(' ') : rest;
      if (!isChannelTarget(ch)) {
        pushLocalInfo(nid, target, 'Usage: /part [#channel] [reason]');
        return true;
      }
      socketSend({ type: 'part', networkId: nid, channel: ch, reason: reason || undefined });
      return true;
    }
    case 'cycle': {
      const nid = requireNet();
      if (nid == null) return true;
      const ch = parts[0] || target;
      if (!isChannelTarget(ch)) return true;
      socketSend({ type: 'part', networkId: nid, channel: ch });
      setTimeout(() => buffers.joinOrActivate(nid, ch), 350);
      return true;
    }
    case 'msg':
    case 'query': {
      const nid = requireNet();
      if (nid == null) return true;
      const nick = parts[0];
      const msg = spaceIdx === -1 ? '' : rest.slice(nick?.length ?? 0).trim();
      if (!nick) {
        pushLocalInfo(nid, target, `Usage: /${cmd} <nick> [message]`);
        return true;
      }
      buffers.openDm(nid, nick);
      if (msg) {
        const ack = await socketSendWithAck({
          type: 'send',
          networkId: nid,
          target: nick,
          text: msg,
        });
        if (!ack.ok && ack.error) pushLocalInfo(nid, target, ack.error);
      }
      return true;
    }
    case 'me':
    case 'action': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!rest) return true;
      const ack = await socketSendWithAck({
        type: 'action',
        networkId: nid,
        target,
        text: rest,
        ...(typeof replyTo === 'number' && Number.isInteger(replyTo) ? { replyTo } : {}),
      });
      if (!ack.ok && ack.error) pushLocalInfo(nid, target, ack.error);
      return true;
    }
    case 'notice': {
      const nid = requireNet();
      if (nid == null) return true;
      const to = parts[0];
      const msg = rest.slice(to?.length ?? 0).trim();
      if (!to || !msg) {
        pushLocalInfo(nid, target, 'Usage: /notice <target> <message>');
        return true;
      }
      const ack = await socketSendWithAck({ type: 'notice', networkId: nid, target: to, text: msg });
      if (!ack.ok && ack.error) pushLocalInfo(nid, target, ack.error);
      return true;
    }
    case 'nick': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!parts[0]) {
        pushLocalInfo(nid, target, 'Usage: /nick <newnick>');
        return true;
      }
      socketSend({ type: 'raw', networkId: nid, line: `NICK ${parts[0]}` });
      return true;
    }
    case 'topic': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!isChannelTarget(target)) {
        pushLocalInfo(nid, target, '/topic only works in a channel');
        return true;
      }
      if (!rest) {
        const buf = buffers.byKey(`${nid}::${target}`);
        pushLocalInfo(nid, target, buf?.topic ? `Topic: ${buf.topic}` : 'No topic set');
      } else {
        socketSend({ type: 'raw', networkId: nid, line: `TOPIC ${target} :${rest}` });
      }
      return true;
    }
    case 'kick': {
      const nid = requireNet();
      if (nid == null) return true;
      const nick = parts[0];
      if (!isChannelTarget(target)) {
        pushLocalInfo(nid, target, '/kick only works in a channel');
        return true;
      }
      const capCtx = getCapabilityContextFor(nid, target);
      const evalRes = evaluateCommand(capCtx, 'kick');
      if (!evalRes.allowed) {
        pushLocalInfo(nid, target, evalRes.reason || '/kick is not permitted in this channel');
        return true;
      }
      if (!nick) {
        pushLocalInfo(nid, target, 'Usage: /kick <nick> [reason]');
        return true;
      }
      const reason = rest.slice(nick.length).trim();
      socketSend({
        type: 'raw',
        networkId: nid,
        line: reason ? `KICK ${target} ${nick} :${reason}` : `KICK ${target} ${nick}`,
      });
      return true;
    }
    case 'mode': {
      const nid = requireNet();
      if (nid == null) return true;
      const ownNick = getOwnNick(nid);
      if (!rest) {
        const modeTarget = isChannelTarget(target) ? target : ownNick || target;
        if (!modeTarget) {
          pushLocalInfo(nid, target, 'Usage: /mode [target] <modes> [args]');
          return true;
        }
        socketSend({ type: 'raw', networkId: nid, line: `MODE ${modeTarget}` });
        return true;
      }
      const first = parts[0] || '';
      if (first.startsWith('+') || first.startsWith('-')) {
        const modeTarget = isChannelTarget(target) ? target : ownNick || target;
        socketSend({ type: 'raw', networkId: nid, line: `MODE ${modeTarget} ${rest}` });
      } else {
        socketSend({ type: 'raw', networkId: nid, line: `MODE ${rest}` });
      }
      return true;
    }
    case 'op':
    case 'deop':
    case 'voice':
    case 'devoice':
    case 'halfop':
    case 'dehalfop': {
      const nid = requireNet();
      if (nid == null || !isChannelTarget(target) || parts.length === 0) return true;
      const capCtx = getCapabilityContextFor(nid, target);
      const evalRes = evaluateCommand(capCtx, cmd);
      if (!evalRes.allowed) {
        pushLocalInfo(nid, target, evalRes.reason || `/${cmd} is not permitted in this channel`);
        return true;
      }
      const sign = cmd.startsWith('de') ? '-' : '+';
      const flag = cmd.includes('op') ? (cmd.includes('half') ? 'h' : 'o') : 'v';
      socketSend({
        type: 'raw',
        networkId: nid,
        line: `MODE ${target} ${sign}${flag.repeat(parts.length)} ${parts.join(' ')}`,
      });
      return true;
    }
    case 'whois': {
      const nid = requireNet();
      if (nid == null) return true;
      const activeBuf = target ? buffers.byKey(`${nid}::${target}`) : undefined;
      const whoisTarget =
        parts[0] ||
        (activeBuf && (activeBuf.kind === 'dm' || activeBuf.kind === 'dcc') ? target : '');
      if (!whoisTarget) {
        pushLocalInfo(nid, target, 'Usage: /whois <nick>');
        return true;
      }
      useWhoisStore.getState().request(nid, whoisTarget);
      return true;
    }
    case 'invite': {
      const nid = requireNet();
      if (nid == null || !parts[0]) return true;
      const ch = parts[1] || target;
      socketSend({ type: 'raw', networkId: nid, line: `INVITE ${parts[0]} ${ch}` });
      return true;
    }
    case 'list': {
      const nid = requireNet();
      if (nid == null) return true;
      useChanlistStore.getState().request(nid, true);
      return true;
    }
    case 'away': {
      const nid = requireNet();
      if (nid == null) return true;
      socketSend({ type: 'away', networkId: nid, message: rest || 'Away' });
      return true;
    }
    case 'back': {
      const nid = requireNet();
      if (nid == null) return true;
      socketSend({ type: 'away', networkId: nid, message: '' });
      return true;
    }
    case 'clear':
      buffers.clearBuffer(networkId, target);
      return true;
    case 'unclear':
      buffers.unclearBuffer(networkId, target);
      return true;
    case 'close': {
      const nid = requireNet();
      if (nid == null) return true;
      socketSend({
        type: 'close-buffer',
        bufferId: idFor(nid, target),
        networkId: nid,
        target,
      });
      return true;
    }
    case 'raw':
    case 'quote': {
      const nid = requireNet();
      if (nid == null || !rest) return true;
      socketSend({ type: 'raw', networkId: nid, line: rest });
      return true;
    }
    case 'connect': {
      const nid = requireNet();
      if (nid == null) return true;
      if (rest) {
        const capCtx = getCapabilityContextFor(nid, target);
        const evalRes = evaluateCommand(capCtx, 'CONNECT');
        if (!evalRes.allowed) {
          pushLocalInfo(nid, target, evalRes.reason || 'Server CONNECT is not allowed.');
          return true;
        }
        const ack = await socketSendWithAck({ type: 'raw', networkId: nid, line: `CONNECT ${rest}` });
        if (!ack.ok && ack.error) pushLocalInfo(nid, target, ack.error);
      } else {
        void networks.connect(nid);
      }
      return true;
    }
    case 'disconnect': {
      const nid = requireNet();
      if (nid != null) void networks.disconnect(nid, rest || undefined);
      return true;
    }
    case 'reconnect': {
      const nid = requireNet();
      if (nid != null) void networks.reconnect(nid);
      return true;
    }
    case 'set': {
      if (parts.length < 2) {
        pushLocalInfo(networkId, target, 'Usage: /set <key> <value>');
        return true;
      }
      const key = parts[0];
      const rawVal = rest.slice(key.length).trim();
      let val: any = rawVal;
      if (rawVal === 'true') val = true;
      else if (rawVal === 'false') val = false;
      else if (/^-?\d+(\.\d+)?$/.test(rawVal)) val = Number(rawVal);
      await useSettingsStore.getState().setValue(key, val);
      pushLocalInfo(networkId, target, `Set ${key} = ${JSON.stringify(val)}`);
      return true;
    }
    case 'theme': {
      if (!rest) {
        const themes = useThemesStore.getState().all();
        pushLocalInfo(
          networkId,
          target,
          `Available themes: ${themes.map((t: any) => `${t.name} (${t.id})`).join(', ')}`,
        );
        return true;
      }
      const themes = useThemesStore.getState().all();
      const match = themes.find(
        (t: any) => t.id.toLowerCase() === rest.toLowerCase() || t.name.toLowerCase() === rest.toLowerCase(),
      );
      if (!match) {
        pushLocalInfo(networkId, target, `Unknown theme: ${rest}`);
        return true;
      }
      await useThemesStore.getState().applyTheme(match.id);
      pushLocalInfo(networkId, target, `Applied theme: ${match.name}`);
      return true;
    }
    case 'ignore': {
      const store = useIgnoresStore.getState();
      if (!rest) {
        const list = store.all();
        if (list.length === 0) {
          pushLocalInfo(networkId, target, 'No ignore rules set.');
        } else {
          for (const r of list) {
            const scope = r.networkId == null ? 'global' : `net#${r.networkId}`;
            const subj = r.mask || (r.pattern ? `pattern "${r.pattern}"` : '*');
            const extra = [
              r.levels.join(','),
              r.channels?.length ? r.channels.join(',') : '',
              r.isExcept ? 'except' : '',
            ]
              .filter(Boolean)
              .join(' ');
            pushLocalInfo(networkId, target, `#${r.id} [${scope}] ${subj} (${extra})`);
          }
        }
        return true;
      }
      const parsed = parseIgnoreArgs(rest);
      if (parsed.error) {
        pushLocalInfo(networkId, target, `/ignore: ${parsed.error}`);
        return true;
      }
      if (parsed.scopeNetwork && networkId == null) {
        pushLocalInfo(networkId, target, '/ignore: -network requires an active network.');
        return true;
      }
      const scopeNetId = parsed.scopeNetwork ? networkId : null;
      store.add({
        networkId: scopeNetId,
        mask: parsed.mask,
        channels: parsed.channels,
        pattern: parsed.pattern,
        patternKind: parsed.patternKind,
        levels: parsed.levels,
        isExcept: parsed.isExcept,
        expiresAt: parsed.expiresAt,
      });
      const subj = parsed.mask || (parsed.pattern ? `"${parsed.pattern}"` : '*');
      const scopeLabel = scopeNetId == null ? 'global' : 'network';
      pushLocalInfo(
        networkId,
        target,
        `Added ${scopeLabel} ignore rule for ${subj} (${parsed.levels.join(', ')})`,
      );
      return true;
    }
    case 'unignore': {
      const id = Number(parts[0]);
      if (!Number.isFinite(id)) return true;
      useIgnoresStore.getState().remove(networkId, id);
      pushLocalInfo(networkId, target, `Removed ignore rule #${id}`);
      return true;
    }
    case 'dcc': {
      const nid = requireNet();
      if (nid == null) return true;
      const parsed = parseDccCommand(rest);
      if (parsed.kind === 'error') {
        pushLocalInfo(nid, target, parsed.message);
        return true;
      }
      if (parsed.kind === 'list' || parsed.kind === 'files') {
        useDccStore.getState().openModal(parsed.kind === 'files' ? 'files' : 'transfers');
      } else if (parsed.kind === 'chat') {
        await useDccStore.getState().openChat({
          networkId: nid,
          nick: parsed.nick,
          passive: parsed.passive,
          secure: parsed.secure,
        });
      } else if (parsed.kind === 'chatClose') {
        await useDccStore.getState().closeChat({ networkId: nid, nick: parsed.nick });
      } else if (parsed.kind === 'send') {
        useDccStore.getState().openModal('files', {
          networkId: nid,
          nick: parsed.nick,
          passive: parsed.passive,
          secure: parsed.secure,
        });
      }
      return true;
    }
    case 'xdcc': {
      const nid = requireNet();
      if (nid == null) return true;
      const parsed = parseXdccCommand(rest);
      if (parsed.kind === 'error') {
        pushLocalInfo(nid, target, parsed.message);
        return true;
      }
      if (parsed.kind === 'add') {
        await useDccStore.getState().enqueueXdcc({
          networkId: nid,
          bot: parsed.bot,
          packs: parsed.packs,
        });
        pushLocalInfo(nid, target, `Queued XDCC packs from ${parsed.bot}: ${parsed.packs.join(', ')}`);
      }
      return true;
    }
    case 'relay': {
      const nid = requireNet();
      if (nid == null) return true;
      const parsed = parseRelayCommand(rest);
      const relayStore = useRelayBotsStore.getState();
      if (parsed.kind === 'error') {
        pushLocalInfo(nid, target, `/relay: ${parsed.message}`);
        return true;
      }
      if (parsed.kind === 'list') {
        const list = relayStore.listForNetwork(nid);
        if (!list.length) {
          pushLocalInfo(
            nid,
            target,
            'No relay bots marked on this network. Use /relay add <nick> [pattern] or right-click a bot nick.',
          );
          return true;
        }
        const lines = list.map((b) => `  ${b.nick}${b.pattern ? ` — ${b.pattern}` : ''}`);
        pushLocalInfo(nid, target, `Relay bots (${list.length}):\n${lines.join('\n')}`);
        return true;
      }
      if (parsed.kind === 'add') {
        relayStore.setRelay(nid, parsed.nick, true, parsed.pattern);
        pushLocalInfo(
          nid,
          target,
          `Marked ${parsed.nick} as a relay bot${parsed.pattern ? ` (pattern: ${parsed.pattern})` : ''}.`,
        );
        return true;
      }
      relayStore.setRelay(nid, parsed.nick, false);
      pushLocalInfo(nid, target, `Unmarked ${parsed.nick} as a relay bot.`);
      return true;
    }
    case 'alias':
    case 'unalias': {
      const argLine =
        cmd === 'unalias' ? (rest ? `-${rest.replace(/^-/, '')}` : '') : rest;
      const parsed = parseAliasArgs(argLine);
      const aliasStore = useAliasesStore.getState();
      if (parsed.kind === 'error') {
        pushLocalInfo(networkId, target, `/${cmd}: ${parsed.error}`);
        return true;
      }
      if (parsed.kind === 'list') {
        await aliasStore.settled();
        pushLocalInfo(networkId, target, aliasListLines(aliasStore.aliases, parsed.prefix).join('\n'));
        return true;
      }
      if (parsed.kind === 'remove') {
        try {
          await aliasStore.remove(parsed.name);
          pushLocalInfo(networkId, target, `Removed alias /${parsed.name}`);
        } catch (err: any) {
          pushLocalInfo(networkId, target, `/${cmd}: ${err?.message || 'failed to remove alias'}`);
        }
        return true;
      }
      try {
        const { alias, created } = await aliasStore.set(parsed.name, parsed.body);
        pushLocalInfo(
          networkId,
          target,
          `${created ? 'Added' : 'Updated'} alias /${alias.name} → ${alias.body}`,
        );
      } catch (err: any) {
        pushLocalInfo(networkId, target, `/alias: ${err?.message || 'failed to save alias'}`);
      }
      return true;
    }
    case 'say': {
      const nid = requireNet();
      if (nid == null) return true;
      const body = rest.trim();
      if (!body) {
        pushLocalInfo(nid, target, 'Usage: /say <text>');
        return true;
      }
      const ack = await socketSendWithAck({
        type: 'send',
        networkId: nid,
        target,
        text: body,
        ...(typeof replyTo === 'number' && Number.isInteger(replyTo) ? { replyTo } : {}),
      });
      if (!ack.ok && ack.error) pushLocalInfo(nid, target, ack.error);
      return true;
    }
    case 'jitsi': {
      const nid = requireNet();
      if (nid == null) return true;
      const slug = rest.replace(/[^a-zA-Z0-9_-]/g, '');
      const roomId = slug || Math.random().toString(36).slice(2, 10);
      const userBase = useSettingsStore.getState().effective('chat.jitsi_url');
      const instanceBase = useConfigStore.getState().jitsiUrl;
      const roomUrl = jitsiRoomUrl(roomId, userBase, instanceBase);
      if (!roomUrl) {
        pushLocalInfo(
          nid,
          target,
          '/jitsi: chat.jitsi_url is not a valid http(s) URL without query or fragment',
        );
        return true;
      }
      const ack = await socketSendWithAck({
        type: 'send',
        networkId: nid,
        target,
        text: roomUrl,
        ...(typeof replyTo === 'number' && Number.isInteger(replyTo) ? { replyTo } : {}),
      });
      if (!ack.ok && ack.error) pushLocalInfo(nid, target, ack.error);
      return true;
    }
    case 'rename': {
      const nid = requireNet();
      if (nid == null) return true;
      const capCtx = getCapabilityContextFor(nid, target);
      const evalRes = evaluateCommand(capCtx, 'rename');
      if (!evalRes.allowed) {
        pushLocalInfo(nid, target, evalRes.reason || '/rename is not supported on this network');
        return true;
      }
      const parsed = parseRename(parts, target, (name) =>
        Object.values(buffers.buffers).some(
          (b) => b.networkId === nid && b.target.toLowerCase() === name.toLowerCase(),
        ),
      );
      if ('error' in parsed) {
        pushLocalInfo(nid, target, parsed.error);
        return true;
      }
      const ack = await socketSendWithAck({ type: 'raw', networkId: nid, line: parsed.line });
      if (!ack.ok && ack.error) pushLocalInfo(nid, target, ack.error);
      return true;
    }
    case 'commands':
    case 'help': {
      const q = parts[0]?.toLowerCase().replace(/^\/+/, '') || '';
      const capCtx = getCapabilityContextFor(networkId, target);
      const summary = formatServerSummary(capCtx);
      const inChannel = isChannelTarget(target);
      const available = getAvailableSlashCommands(SLASH_COMMANDS, capCtx, { inChannel });

      if (!q) {
        const generalAvail = available
          .filter((c) => !['oper', 'unreal', 'anope', 'ergo', 'services'].includes(c.category || 'general'))
          .map((c) => `/${c.name}`);
        const operAvail = available
          .filter((c) => ['oper', 'unreal', 'anope', 'ergo', 'services'].includes(c.category || 'general'))
          .map((c) => `/${c.name}`);
        const lines = [
          `[${summary.softwareLabel} · ${summary.servicesLabel} · Modes ${summary.modesLabel} · CAPs ${summary.capsCount}]`,
          `Available commands (${generalAvail.length}): ${generalAvail.join(', ')}`,
        ];
        if (operAvail.length > 0) {
          lines.push(`Available oper/services (${operAvail.length}): ${operAvail.join(', ')}`);
        }
        lines.push(
          'Type /help <command> or /help <oper|unreal|anope|ergo|services|channel|network> for details.',
        );
        pushLocalInfo(networkId, target, lines.join('\n'));
        return true;
      }

      const categoryAliases: Record<string, SlashCommandCategory[]> = {
        general: ['general'],
        channel: ['channel'],
        network: ['network'],
        oper: ['oper'],
        unreal: ['unreal'],
        unrealircd: ['unreal'],
        anope: ['anope', 'services'],
        ergo: ['ergo', 'services'],
        services: ['services', 'anope'],
      };
      const matchedCats = categoryAliases[q];
      if (matchedCats) {
        const items = available.filter((c) => matchedCats.includes(c.category || 'general'));
        if (items.length === 0) {
          pushLocalInfo(
            networkId,
            target,
            `No ${q.toUpperCase()} commands are available on ${summary.softwareLabel} (${summary.servicesLabel}, modes ${summary.modesLabel}).`,
          );
          return true;
        }
        const lines = items.map(
          (c) => `/${c.name}${c.args ? ` ${c.args}` : ''} — ${c.description}`,
        );
        pushLocalInfo(
          networkId,
          target,
          `[${q.toUpperCase()} available commands (${items.length}) on ${summary.softwareLabel}]\n${lines.join('\n')}`,
        );
        return true;
      }

      const exact = SLASH_COMMANDS.find((c) => c.name.toLowerCase() === q);
      if (exact) {
        const evalRes = evaluateCommand(capCtx, exact.name);
        const statusLine = evalRes.allowed
          ? ''
          : `\n[Unavailable here: ${evalRes.reason || 'not supported for current capabilities/modes'}]`;
        pushLocalInfo(
          networkId,
          target,
          `/${exact.name}${exact.args ? ` ${exact.args}` : ''} — ${exact.description}${statusLine}`,
        );
        return true;
      }

      const partials = available.filter(
        (c) => c.name.includes(q) || c.description.toLowerCase().includes(q),
      );
      if (partials.length > 0) {
        pushLocalInfo(
          networkId,
          target,
          `Available matches for "${q}":\n${partials
            .slice(0, 20)
            .map((c) => `/${c.name}${c.args ? ` ${c.args}` : ''} — ${c.description}`)
            .join('\n')}`,
        );
      } else {
        const blockedMatches = SLASH_COMMANDS.filter(
          (c) => c.name.includes(q) || c.description.toLowerCase().includes(q),
        );
        if (blockedMatches.length > 0) {
          const sample = blockedMatches[0];
          const reason = evaluateCommand(capCtx, sample.name).reason;
          pushLocalInfo(
            networkId,
            target,
            `No available matches for "${q}" on ${summary.softwareLabel} (${blockedMatches.length} hidden; e.g. /${sample.name}: ${reason || 'unavailable'}).`,
          );
        } else {
          pushLocalInfo(
            networkId,
            target,
            `Unknown command or topic "${q}". Type /help or /help <oper|unreal|anope|ergo|services|channel>.`,
          );
        }
      }
      return true;
    }
    default: {
      if (await dispatchOperCommand(cmd, rest, parts, networkId, target, pushLocalInfo)) {
        return true;
      }
      const nid = requireNet();
      if (nid == null) return true;
      const capCtx = getCapabilityContextFor(nid, target);
      const evalRes = evaluateCommand(capCtx, cmd);
      if (!evalRes.allowed) {
        pushLocalInfo(nid, target, evalRes.reason || `/${cmd} is not available on this network.`);
        return true;
      }
      const ack = await socketSendWithAck({
        type: 'raw',
        networkId: nid,
        line: `${cmd.toUpperCase()}${rest ? ` ${rest}` : ''}`,
      });
      if (!ack.ok && ack.error) pushLocalInfo(nid, target, ack.error);
      return true;
    }
  }
}
