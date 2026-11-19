// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { socketSend, socketSendWithAck } from '../../services/socketBus';
import { useBuffersStore, bufferKey } from '../../stores/buffers';
import { useNetworksStore } from '../../stores/networks';
import { isChannelTarget } from '../../shared/channels';
import {
  buildCapabilityContext,
  evaluateCommand,
  type CapabilityContext,
} from '../networkCapabilities';

export type SlashCommandCategory =
  | 'general'
  | 'channel'
  | 'oper'
  | 'unreal'
  | 'anope'
  | 'ergo'
  | 'services'
  | 'network';

export interface SlashCommandDef {
  name: string;
  args: string;
  description: string;
  category?: SlashCommandCategory;
}

export const OPER_SLASH_COMMANDS: SlashCommandDef[] = [
  // Channel / UnrealIRCd mode helpers
  { name: 'owner', args: '<nick...>', description: 'Give channel owner (+q, UnrealIRCd)', category: 'channel' },
  { name: 'deowner', args: '<nick...>', description: 'Remove channel owner (-q, UnrealIRCd)', category: 'channel' },
  { name: 'protect', args: '<nick...>', description: 'Give channel admin/protect (+a, UnrealIRCd)', category: 'channel' },
  { name: 'deprotect', args: '<nick...>', description: 'Remove channel admin/protect (-a, UnrealIRCd)', category: 'channel' },
  { name: 'ban', args: '<nick|mask...>', description: 'Set channel ban (+b)', category: 'channel' },
  { name: 'unban', args: '<mask...>', description: 'Remove channel ban (-b)', category: 'channel' },
  { name: 'kb', args: '<nick> [reason]', description: 'Ban and kick a user from the channel', category: 'channel' },
  { name: 'kickban', args: '<nick> [reason]', description: 'Ban and kick a user from the channel', category: 'channel' },
  { name: 'knock', args: '<#channel> [message]', description: 'Request invite to a +i channel', category: 'channel' },

  // Standard IRCOp commands
  { name: 'oper', args: '<name> [password]', description: 'Authenticate as IRC operator (password optional with certfp)', category: 'oper' },
  { name: 'deoper', args: '', description: 'Drop IRC operator status (MODE -o)', category: 'oper' },
  { name: 'kill', args: '<nick> [reason]', description: 'Disconnect a user from the network', category: 'oper' },
  { name: 'kline', args: '[ANDKILL] [duration] <mask> [reason]', description: 'Add server K-Line ban (Ergo/UnrealIRCd)', category: 'oper' },
  { name: 'unkline', args: '<mask>', description: 'Remove K-Line (Ergo; on UnrealIRCd use /kline -mask)', category: 'oper' },
  { name: 'wallops', args: '<message>', description: 'Send notice to +w users / opers', category: 'oper' },
  { name: 'globops', args: '<message>', description: 'Broadcast global message to IRC operators', category: 'oper' },
  { name: 'locops', args: '<message>', description: 'Send notice to local server operators', category: 'oper' },
  { name: 'chatops', args: '<message>', description: 'Send message to global ChatOps stream', category: 'oper' },
  { name: 'rehash', args: '[server|flag]', description: 'Reload server config, TLS, and MOTD', category: 'oper' },
  { name: 'squit', args: '<server> [reason]', description: 'Disconnect a linked IRC server', category: 'oper' },
  { name: 'restart', args: '[password|reason]', description: 'Restart the IRC server', category: 'oper' },
  { name: 'die', args: '[password|reason]', description: 'Shut down the IRC server', category: 'oper' },
  { name: 'operclose', args: '', description: 'Drop unknown/unregistered server connections (CLOSE)', category: 'oper' },
  { name: 'stats', args: '[flag] [server]', description: 'Query server statistics (g, k, o, c, u, ...)', category: 'oper' },
  { name: 'trace', args: '[target]', description: 'Trace server link or user connection path', category: 'oper' },
  { name: 'map', args: '[server]', description: 'Display network server topology map', category: 'oper' },
  { name: 'links', args: '[mask]', description: 'List linked servers', category: 'oper' },
  { name: 'lusers', args: '[mask] [server]', description: 'Show global user/channel/server counts', category: 'oper' },
  { name: 'admin', args: '[server]', description: 'Show server administrator info', category: 'oper' },
  { name: 'info', args: '[server]', description: 'Show server build/version info', category: 'oper' },
  { name: 'version', args: '[server]', description: 'Show IRCd version and ISUPPORT tokens', category: 'oper' },
  { name: 'motd', args: '[server]', description: 'Show server Message of the Day', category: 'oper' },
  { name: 'rules', args: '[server]', description: 'Show server rules', category: 'oper' },
  { name: 'time', args: '[server]', description: 'Query server clock time', category: 'oper' },
  { name: 'who', args: '<mask> [flags]', description: 'Query users matching mask (WHO / WHOX)', category: 'oper' },
  { name: 'whowas', args: '<nick> [count] [server]', description: 'Query historical nick information', category: 'oper' },
  { name: 'userhost', args: '<nick...>', description: 'Query user@host of nicks', category: 'oper' },
  { name: 'userip', args: '<nick...>', description: 'Query user@ip of nicks', category: 'oper' },
  { name: 'ison', args: '<nick...>', description: 'Check which nicks are online', category: 'oper' },
  { name: 'monitor', args: '<+|-|C|L|S> [nicks]', description: 'Server-side nick presence monitoring', category: 'oper' },

  // UnrealIRCd 6 commands
  { name: 'gline', args: '[[-]<mask>] [duration] [reason]', description: 'Add/remove network-wide User@Host G-Line (UnrealIRCd)', category: 'unreal' },
  { name: 'ungline', args: '<mask>', description: 'Remove a G-Line (UnrealIRCd GLINE -mask)', category: 'unreal' },
  { name: 'zline', args: '[[-]<ip>] [duration] [reason]', description: 'Add/remove local IP handshake Z-Line (UnrealIRCd)', category: 'unreal' },
  { name: 'unzline', args: '<ip>', description: 'Remove a Z-Line (UnrealIRCd ZLINE -ip)', category: 'unreal' },
  { name: 'gzline', args: '[[-]<ip>] [duration] [reason]', description: 'Add/remove global IP GZ-Line (UnrealIRCd)', category: 'unreal' },
  { name: 'ungzline', args: '<ip>', description: 'Remove a GZ-Line (UnrealIRCd GZLINE -ip)', category: 'unreal' },
  { name: 'shun', args: '[[-]<mask>] [duration] [reason]', description: 'Silence user commands globally (UnrealIRCd)', category: 'unreal' },
  { name: 'unshun', args: '<mask>', description: 'Remove a SHUN (UnrealIRCd SHUN -mask)', category: 'unreal' },
  { name: 'tempshun', args: '<[+|-]nick> [reason]', description: 'Session-only shun on a nick (UnrealIRCd)', category: 'unreal' },
  { name: 'untempshun', args: '<nick>', description: 'Remove TEMPSHUN from a nick (UnrealIRCd)', category: 'unreal' },
  { name: 'eline', args: '<mask> <types> [duration] [reason]', description: 'Add TKL ban exception (UnrealIRCd)', category: 'unreal' },
  { name: 'uneline', args: '<mask> [types]', description: 'Remove TKL ban exception (UnrealIRCd)', category: 'unreal' },
  { name: 'spamfilter', args: '[add|del] [type] [target] [action] [tkltime] [reason] [pattern]', description: 'Manage dynamic Spamfilter rules (UnrealIRCd)', category: 'unreal' },
  { name: 'sajoin', args: '<nick> [#channel]', description: 'Force user to join a channel (UnrealIRCd/Ergo)', category: 'unreal' },
  { name: 'sapart', args: '<nick> [#channel] [reason]', description: 'Force user to part a channel (UnrealIRCd)', category: 'unreal' },
  { name: 'samode', args: '[target] <modes> [args]', description: 'Force channel or user mode change (UnrealIRCd/Ergo)', category: 'unreal' },
  { name: 'sanick', args: '<nick> <newnick>', description: 'Force user nickname change (UnrealIRCd/Ergo)', category: 'unreal' },
  { name: 'sakill', args: '<nick> [reason]', description: 'Force kill user (UnrealIRCd)', category: 'unreal' },
  { name: 'satopic', args: '[#channel] <topic>', description: 'Force channel topic change', category: 'unreal' },
  { name: 'chghost', args: '<nick> <hostname>', description: 'Change connected user visible hostname', category: 'unreal' },
  { name: 'chgident', args: '<nick> <ident>', description: 'Change connected user ident/username', category: 'unreal' },
  { name: 'chgname', args: '<nick> <realname>', description: 'Change connected user realname (GECOS)', category: 'unreal' },
  { name: 'sethost', args: '<hostname>', description: 'Change your own visible hostname', category: 'unreal' },
  { name: 'setident', args: '<ident>', description: 'Change your own ident/username', category: 'unreal' },
  { name: 'setname', args: '<realname>', description: 'Change your own realname (GECOS)', category: 'unreal' },
  { name: 'swhois', args: '<nick> <[+|-]text>', description: 'Add/remove custom WHOIS info line (UnrealIRCd)', category: 'unreal' },
  { name: 'svsnick', args: '<nick> <newnick> [ts]', description: 'Services forced nick change', category: 'unreal' },
  { name: 'svsmode', args: '<target> <modes> [args]', description: 'Services forced mode change', category: 'unreal' },
  { name: 'svskill', args: '<nick> [reason]', description: 'Services forced kill', category: 'unreal' },
  { name: 'svsjoin', args: '<nick> <#channel>', description: 'Services forced channel join', category: 'unreal' },
  { name: 'svspart', args: '<nick> <#channel> [reason]', description: 'Services forced channel part', category: 'unreal' },
  { name: 'module', args: '[list|load|unload|reload] [name]', description: 'Inspect/manage UnrealIRCd modules', category: 'unreal' },
  { name: 'md', args: '<type> <target> <var> [value]', description: 'Inspect/set UnrealIRCd ModData (MD)', category: 'unreal' },
  { name: 'dns', args: '[option]', description: 'Inspect IRCd DNS cache/stats', category: 'unreal' },
  { name: 'tsctl', args: '<subcommand>', description: 'Timestamp synchronization diagnostics (TSCTL)', category: 'unreal' },
  { name: 'mkpasswd', args: '<type> <password>', description: 'Hash a password for oper config blocks', category: 'unreal' },
  { name: 'addmotd', args: '<line>', description: 'Append line to server MOTD (UnrealIRCd)', category: 'unreal' },
  { name: 'addomotd', args: '<line>', description: 'Append line to Oper MOTD (UnrealIRCd)', category: 'unreal' },
  { name: 'helpop', args: '[topic]', description: 'Query server HelpOp documentation (UnrealIRCd)', category: 'unreal' },
  { name: 'watch', args: '[+/-nick ...|C|L|S]', description: 'Manage UnrealIRCd nick WATCH list', category: 'unreal' },
  { name: 'silence', args: '[+/-mask ...]', description: 'Manage server-side SILENCE list', category: 'unreal' },

  // Ergo IRCd commands
  { name: 'dline', args: '[ANDKILL] [duration] <ip/cidr> [reason]', description: 'Ban IP or CIDR subnet (Ergo)', category: 'ergo' },
  { name: 'undline', args: '<ip/cidr>', description: 'Remove D-Line IP/CIDR ban (Ergo)', category: 'ergo' },
  { name: 'uban', args: '<add|del|list|info> ...', description: 'Ergo Unified Ban manager (IP, CIDR, mask, account)', category: 'ergo' },
  { name: 'defcon', args: '[1-5|status]', description: 'Ergo server DEFCON emergency restriction level', category: 'ergo' },
  { name: 'npc', args: '[#channel] <nick> <text>', description: 'Send Ergo roleplay NPC message', category: 'ergo' },
  { name: 'scene', args: '[#channel] <text>', description: 'Send Ergo roleplay SCENE message', category: 'ergo' },
  { name: 'ambience', args: '[#channel] <text>', description: 'Send Ergo roleplay AMBIENCE message', category: 'ergo' },

  // Services (Ergo built-in & Anope 2.0/2.1)
  { name: 'ns', args: '<subcommand> ...', description: 'Send command to NickServ (Ergo & Anope)', category: 'services' },
  { name: 'nickserv', args: '<subcommand> ...', description: 'Send command to NickServ (Ergo & Anope)', category: 'services' },
  { name: 'cs', args: '<subcommand> ...', description: 'Send command to ChanServ (Ergo & Anope)', category: 'services' },
  { name: 'chanserv', args: '<subcommand> ...', description: 'Send command to ChanServ (Ergo & Anope)', category: 'services' },
  { name: 'hs', args: '<subcommand> ...', description: 'Send command to HostServ (Ergo & Anope)', category: 'services' },
  { name: 'hostserv', args: '<subcommand> ...', description: 'Send command to HostServ (Ergo & Anope)', category: 'services' },

  // Anope 2.0/2.1 OperServ / MemoServ / BotServ / Global
  { name: 'os', args: '<subcommand> ...', description: 'Send command to OperServ (Anope)', category: 'anope' },
  { name: 'operserv', args: '<subcommand> ...', description: 'Send command to OperServ (Anope)', category: 'anope' },
  { name: 'ms', args: '<subcommand> ...', description: 'Send command to MemoServ (Anope)', category: 'anope' },
  { name: 'memoserv', args: '<subcommand> ...', description: 'Send command to MemoServ (Anope)', category: 'anope' },
  { name: 'bs', args: '<subcommand> ...', description: 'Send command to BotServ (Anope)', category: 'anope' },
  { name: 'botserv', args: '<subcommand> ...', description: 'Send command to BotServ (Anope)', category: 'anope' },
  { name: 'global', args: '<message>', description: 'Send network-wide Global notice (Anope Global)', category: 'anope' },
  { name: 'akill', args: '<add|del|list|view|clear> ...', description: 'Anope OperServ AKILL shorthand', category: 'anope' },
  { name: 'sqline', args: '<add|del|list|view> ...', description: 'Anope OperServ SQLINE nick ban shorthand', category: 'anope' },
  { name: 'szline', args: '<add|del|list|view> ...', description: 'Anope OperServ SZLINE IP ban shorthand', category: 'anope' },
  { name: 'snline', args: '<add|del|list|view> ...', description: 'Anope OperServ SNLINE ident ban shorthand', category: 'anope' },
  { name: 'sgline', args: '<add|del|list|view> ...', description: 'Anope OperServ SGLINE realname ban shorthand', category: 'anope' },
  { name: 'chankill', args: '<[+expiry] #channel> [reason]', description: 'Anope OperServ CHANKILL shorthand', category: 'anope' },
  { name: 'jupe', args: '<server> [reason]', description: 'Anope OperServ JUPE server shorthand', category: 'anope' },
  { name: 'oline', args: '<add|del|list> ...', description: 'Anope OperServ OPER list shorthand', category: 'anope' },
];

const OPER_HANDLED_COMMANDS = new Set(OPER_SLASH_COMMANDS.map((c) => c.name.toLowerCase()));

export function getCapabilityContextFor(
  networkId: number | null,
  target?: string,
): CapabilityContext {
  const netStore = useNetworksStore.getState();
  const netState = networkId != null ? netStore.states[networkId] : undefined;
  const profile = networkId != null ? netStore.profileFor(networkId) : undefined;
  const buffers = useBuffersStore.getState();
  const buf = networkId != null && target ? buffers.byKey(bufferKey(networkId, target)) : undefined;
  const ownNick = netState?.nick;
  const selfMember =
    buf && ownNick
      ? buf.members.find((m) => m.nick.toLowerCase() === ownNick.toLowerCase())
      : undefined;
  return buildCapabilityContext(netState, profile, {
    selfChannelModes: selfMember?.modes,
    channelModes: buf?.modes,
    target,
  });
}

const DURATION_RE = /^(?:0|\d+(?:[smhdwMy]+\d*)+|\d+)$/i;

export function isDurationToken(tok: string | undefined): boolean {
  if (!tok) return false;
  if (tok.includes('.') || tok.includes(':') || tok.includes('@') || tok.includes('*')) {
    return false;
  }
  return DURATION_RE.test(tok);
}

/**
 * Joins trailing tokens starting at `startIdx` with a leading `:` unless the
 * user already supplied one, preserving multi-word reasons on the IRC wire.
 */
export function formatTrailing(parts: string[], startIdx: number): string {
  const joined = parts.slice(startIdx).join(' ');
  if (!joined) return '';
  return joined.startsWith(':') ? joined : `:${joined}`;
}

/**
 * Formats KLINE / GLINE / DLINE / ZLINE / GZLINE / SHUN lines while supporting
 * both UnrealIRCd (`<mask> [duration] [:reason]`) and Ergo (`[ANDKILL] [duration] <mask> [:reason]`).
 */
export function formatTklBanLine(
  cmd: 'KLINE' | 'GLINE' | 'DLINE' | 'ZLINE' | 'GZLINE' | 'SHUN',
  parts: string[],
  supportsLeadingFlags = false,
): string {
  if (parts.length === 0) return cmd;

  let idx = 0;
  const out: string[] = [];

  if (supportsLeadingFlags) {
    while (idx < parts.length && (parts[idx].toUpperCase() === 'ANDKILL' || parts[idx].toUpperCase() === 'MYINFO')) {
      out.push(parts[idx].toUpperCase());
      idx++;
    }
  }

  if (idx >= parts.length) {
    return `${cmd} ${out.join(' ')}`.trim();
  }

  // Ergo leading-duration order: <duration> <mask> [reason...]
  if (supportsLeadingFlags && isDurationToken(parts[idx]) && idx + 1 < parts.length) {
    out.push(parts[idx]);
    idx++;
    out.push(parts[idx]);
    idx++;
    if (idx < parts.length) {
      out.push(formatTrailing(parts, idx));
    }
    return `${cmd} ${out.join(' ')}`;
  }

  const mask = parts[idx];
  out.push(mask);
  idx++;

  if (idx < parts.length) {
    if (mask.startsWith('-')) {
      out.push(...parts.slice(idx));
    } else if (isDurationToken(parts[idx])) {
      out.push(parts[idx]);
      idx++;
      if (idx < parts.length) {
        out.push(formatTrailing(parts, idx));
      }
    } else {
      out.push(formatTrailing(parts, idx));
    }
  }

  return `${cmd} ${out.join(' ')}`;
}

async function sendRawWithAck(
  networkId: number,
  target: string,
  line: string,
  pushInfo: (networkId: number | null, target: string, text: string) => void,
): Promise<void> {
  const ack = await socketSendWithAck({ type: 'raw', networkId, line });
  if (!ack.ok && ack.error) {
    pushInfo(networkId, target, ack.error);
  }
}

export function getOwnNick(networkId: number): string {
  const netStore = useNetworksStore.getState();
  return (
    netStore.states[networkId]?.nick ||
    netStore.networks.find((n) => n.id === networkId)?.nick ||
    ''
  );
}

function resolveBanMasks(networkId: number, target: string, inputs: string[]): string[] {
  const buf = useBuffersStore.getState().buffers[bufferKey(networkId, target)];
  const members = buf?.members || [];
  return inputs.map((arg) => {
    if (arg.includes('!') || arg.includes('@') || arg.includes('*')) {
      return arg;
    }
    const lower = arg.toLowerCase();
    const member = members.find((m) => m.nick.toLowerCase() === lower);
    if (member?.host) {
      return `*!*@${member.host}`;
    }
    return `${arg}!*@*`;
  });
}

const SERVICE_ALIAS_MAP: Record<string, string> = {
  ns: 'NickServ',
  nickserv: 'NickServ',
  cs: 'ChanServ',
  chanserv: 'ChanServ',
  hs: 'HostServ',
  hostserv: 'HostServ',
  os: 'OperServ',
  operserv: 'OperServ',
  ms: 'MemoServ',
  memoserv: 'MemoServ',
  bs: 'BotServ',
  botserv: 'BotServ',
};

const OPERSERV_SUBCMD_MAP: Record<string, string> = {
  akill: 'AKILL',
  sqline: 'SQLINE',
  szline: 'SZLINE',
  snline: 'SNLINE',
  sgline: 'SGLINE',
  chankill: 'CHANKILL',
  jupe: 'JUPE',
  oline: 'OPER',
};

const SIMPLE_RAW_COMMANDS = new Set([
  'rehash',
  'stats',
  'trace',
  'map',
  'links',
  'lusers',
  'admin',
  'info',
  'version',
  'motd',
  'rules',
  'time',
  'who',
  'whowas',
  'userhost',
  'userip',
  'ison',
  'monitor',
  'module',
  'md',
  'dns',
  'tsctl',
  'mkpasswd',
  'helpop',
  'watch',
  'silence',
  'uban',
  'defcon',
]);

export async function dispatchOperCommand(
  cmd: string,
  rest: string,
  parts: string[],
  networkId: number | null,
  target: string,
  pushInfo: (networkId: number | null, target: string, text: string) => void,
): Promise<boolean> {
  const requireNet = (): number | null => {
    if (networkId == null) {
      pushInfo(networkId, target, 'No active network');
      return null;
    }
    return networkId;
  };

  if (OPER_HANDLED_COMMANDS.has(cmd)) {
    const nid = requireNet();
    if (nid == null) return true;
    const capCtx = getCapabilityContextFor(nid, target);
    const evalRes = evaluateCommand(capCtx, cmd);
    if (!evalRes.allowed) {
      pushInfo(nid, target, evalRes.reason || `/${cmd} is not available on this network.`);
      return true;
    }
  }

  // Service shortcuts (/ns, /cs, /hs, /os, /ms, /bs and full names)
  const serviceTarget = SERVICE_ALIAS_MAP[cmd];
  if (serviceTarget) {
    const nid = requireNet();
    if (nid == null) return true;
    const msg = rest || 'HELP';
    await sendRawWithAck(nid, target, `PRIVMSG ${serviceTarget} :${msg}`, pushInfo);
    return true;
  }

  // Direct Anope OperServ subcommand wrappers (/akill, /sqline, /jupe, etc.)
  const osSubcmd = OPERSERV_SUBCMD_MAP[cmd];
  if (osSubcmd) {
    const nid = requireNet();
    if (nid == null) return true;
    const msg = rest ? `${osSubcmd} ${rest}` : `${osSubcmd} HELP`;
    await sendRawWithAck(nid, target, `PRIVMSG OperServ :${msg}`, pushInfo);
    return true;
  }

  if (cmd === 'global') {
    const nid = requireNet();
    if (nid == null) return true;
    if (!rest) {
      pushInfo(nid, target, 'Usage: /global <message>');
      return true;
    }
    await sendRawWithAck(nid, target, `PRIVMSG Global :${rest}`, pushInfo);
    return true;
  }

  if (SIMPLE_RAW_COMMANDS.has(cmd)) {
    const nid = requireNet();
    if (nid == null) return true;
    const upper = cmd.toUpperCase();
    await sendRawWithAck(nid, target, rest ? `${upper} ${rest}` : upper, pushInfo);
    return true;
  }

  switch (cmd) {
    // Channel mode helpers (UnrealIRCd +q / +a, +b / -b, kickban)
    case 'owner':
    case 'deowner':
    case 'protect':
    case 'deprotect': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!isChannelTarget(target) || parts.length === 0) {
        pushInfo(nid, target, `Usage (in a channel): /${cmd} <nick...>`);
        return true;
      }
      const sign = cmd.startsWith('de') ? '-' : '+';
      const flag = cmd.includes('owner') ? 'q' : 'a';
      await sendRawWithAck(
        nid,
        target,
        `MODE ${target} ${sign}${flag.repeat(parts.length)} ${parts.join(' ')}`,
        pushInfo,
      );
      return true;
    }
    case 'ban':
    case 'unban': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!isChannelTarget(target) || parts.length === 0) {
        pushInfo(nid, target, `Usage (in a channel): /${cmd} <nick|mask...>`);
        return true;
      }
      const sign = cmd === 'unban' ? '-' : '+';
      const masks = cmd === 'unban' ? parts : resolveBanMasks(nid, target, parts);
      await sendRawWithAck(
        nid,
        target,
        `MODE ${target} ${sign}${'b'.repeat(masks.length)} ${masks.join(' ')}`,
        pushInfo,
      );
      return true;
    }
    case 'kb':
    case 'kickban': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!isChannelTarget(target) || !parts[0]) {
        pushInfo(nid, target, `Usage (in a channel): /${cmd} <nick> [reason]`);
        return true;
      }
      const nick = parts[0];
      const reason = rest.slice(nick.length).trim();
      const [mask] = resolveBanMasks(nid, target, [nick]);
      await sendRawWithAck(nid, target, `MODE ${target} +b ${mask}`, pushInfo);
      await sendRawWithAck(
        nid,
        target,
        reason ? `KICK ${target} ${nick} :${reason}` : `KICK ${target} ${nick}`,
        pushInfo,
      );
      return true;
    }
    case 'knock': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!parts[0]) {
        pushInfo(nid, target, 'Usage: /knock <#channel> [message]');
        return true;
      }
      const line =
        parts.length > 1 ? `KNOCK ${parts[0]} ${formatTrailing(parts, 1)}` : `KNOCK ${parts[0]}`;
      await sendRawWithAck(nid, target, line, pushInfo);
      return true;
    }

    // Standard IRCOp
    case 'oper': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!parts[0]) {
        pushInfo(nid, target, 'Usage: /oper <name> [password]');
        return true;
      }
      const password = parts.length > 1 ? rest.slice(parts[0].length).trim() : '';
      await sendRawWithAck(nid, target, password ? `OPER ${parts[0]} ${password}` : `OPER ${parts[0]}`, pushInfo);
      return true;
    }
    case 'deoper': {
      const nid = requireNet();
      if (nid == null) return true;
      const ownNick = getOwnNick(nid);
      if (!ownNick) {
        pushInfo(nid, target, 'Cannot determine current nickname');
        return true;
      }
      await sendRawWithAck(nid, target, `MODE ${ownNick} -o`, pushInfo);
      return true;
    }
    case 'kill':
    case 'sakill':
    case 'svskill': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!parts[0]) {
        pushInfo(nid, target, `Usage: /${cmd} <nick> [reason]`);
        return true;
      }
      const upper = cmd.toUpperCase();
      const reason = parts.length > 1 ? formatTrailing(parts, 1) : ':Killed by operator';
      await sendRawWithAck(nid, target, `${upper} ${parts[0]} ${reason}`, pushInfo);
      return true;
    }
    case 'wallops':
    case 'globops':
    case 'locops':
    case 'chatops':
    case 'addmotd':
    case 'addomotd': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!rest) {
        pushInfo(nid, target, `Usage: /${cmd} <message>`);
        return true;
      }
      const upper = cmd.toUpperCase();
      await sendRawWithAck(nid, target, `${upper} ${rest.startsWith(':') ? rest : `:${rest}`}`, pushInfo);
      return true;
    }
    case 'squit': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!parts[0]) {
        pushInfo(nid, target, 'Usage: /squit <server> [reason]');
        return true;
      }
      const line =
        parts.length > 1 ? `SQUIT ${parts[0]} ${formatTrailing(parts, 1)}` : `SQUIT ${parts[0]}`;
      await sendRawWithAck(nid, target, line, pushInfo);
      return true;
    }
    case 'restart':
    case 'die': {
      const nid = requireNet();
      if (nid == null) return true;
      const upper = cmd.toUpperCase();
      const line = rest ? `${upper} ${rest.startsWith(':') ? rest : `:${rest}`}` : upper;
      await sendRawWithAck(nid, target, line, pushInfo);
      return true;
    }
    case 'operclose': {
      const nid = requireNet();
      if (nid == null) return true;
      await sendRawWithAck(nid, target, 'CLOSE', pushInfo);
      return true;
    }

    // TKL / Ban Lines (UnrealIRCd + Ergo)
    case 'kline':
    case 'dline': {
      const nid = requireNet();
      if (nid == null) return true;
      const capCtx = getCapabilityContextFor(nid, target);
      const supportsLeading = capCtx.profile.ircd === 'ergo' || capCtx.profile.ircd === 'unknown';
      await sendRawWithAck(
        nid,
        target,
        formatTklBanLine(cmd.toUpperCase() as 'KLINE' | 'DLINE', parts, supportsLeading),
        pushInfo,
      );
      return true;
    }
    case 'gline':
    case 'zline':
    case 'gzline':
    case 'shun': {
      const nid = requireNet();
      if (nid == null) return true;
      await sendRawWithAck(
        nid,
        target,
        formatTklBanLine(cmd.toUpperCase() as 'GLINE' | 'ZLINE' | 'GZLINE' | 'SHUN', parts, false),
        pushInfo,
      );
      return true;
    }
    case 'unkline':
    case 'undline': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!parts[0]) {
        pushInfo(nid, target, `Usage: /${cmd} <mask>`);
        return true;
      }
      await sendRawWithAck(nid, target, `${cmd.toUpperCase()} ${parts[0]}`, pushInfo);
      return true;
    }
    case 'ungline':
    case 'unzline':
    case 'ungzline':
    case 'unshun': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!parts[0]) {
        pushInfo(nid, target, `Usage: /${cmd} <mask>`);
        return true;
      }
      const baseCmd = cmd.slice(2).toUpperCase();
      await sendRawWithAck(nid, target, `${baseCmd} -${parts[0].replace(/^-+/, '')}`, pushInfo);
      return true;
    }
    case 'tempshun': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!parts[0]) {
        pushInfo(nid, target, 'Usage: /tempshun <[+|-]nick> [reason]');
        return true;
      }
      const line =
        parts.length > 1 ? `TEMPSHUN ${parts[0]} ${formatTrailing(parts, 1)}` : `TEMPSHUN ${parts[0]}`;
      await sendRawWithAck(nid, target, line, pushInfo);
      return true;
    }
    case 'untempshun': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!parts[0]) {
        pushInfo(nid, target, 'Usage: /untempshun <nick>');
        return true;
      }
      await sendRawWithAck(nid, target, `TEMPSHUN -${parts[0].replace(/^[-+]+/, '')}`, pushInfo);
      return true;
    }
    case 'eline': {
      const nid = requireNet();
      if (nid == null) return true;
      if (parts.length === 0) {
        await sendRawWithAck(nid, target, 'ELINE', pushInfo);
        return true;
      }
      if (parts[0].startsWith('-')) {
        await sendRawWithAck(nid, target, `ELINE ${parts.join(' ')}`, pushInfo);
        return true;
      }
      if (parts.length >= 4) {
        await sendRawWithAck(
          nid,
          target,
          `ELINE ${parts[0]} ${parts[1]} ${parts[2]} ${formatTrailing(parts, 3)}`,
          pushInfo,
        );
        return true;
      }
      await sendRawWithAck(nid, target, `ELINE ${rest}`, pushInfo);
      return true;
    }
    case 'uneline': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!parts[0]) {
        pushInfo(nid, target, 'Usage: /uneline <mask> [bantypes]');
        return true;
      }
      const mask = `-${parts[0].replace(/^-+/, '')}`;
      await sendRawWithAck(
        nid,
        target,
        parts[1] ? `ELINE ${mask} ${parts[1]}` : `ELINE ${mask}`,
        pushInfo,
      );
      return true;
    }
    case 'spamfilter': {
      const nid = requireNet();
      if (nid == null) return true;
      if (parts.length >= 7) {
        await sendRawWithAck(
          nid,
          target,
          `SPAMFILTER ${parts.slice(0, 6).join(' ')} ${formatTrailing(parts, 6)}`,
          pushInfo,
        );
        return true;
      }
      await sendRawWithAck(nid, target, rest ? `SPAMFILTER ${rest}` : 'SPAMFILTER', pushInfo);
      return true;
    }

    // SA* / SVS* / Identity commands
    case 'sajoin':
    case 'svsjoin': {
      const nid = requireNet();
      if (nid == null) return true;
      const nick = parts[0];
      const ch = parts[1] || (isChannelTarget(target) ? target : '');
      if (!nick || !ch) {
        pushInfo(nid, target, `Usage: /${cmd} <nick> <#channel>`);
        return true;
      }
      await sendRawWithAck(nid, target, `${cmd.toUpperCase()} ${nick} ${ch}`, pushInfo);
      return true;
    }
    case 'sapart':
    case 'svspart': {
      const nid = requireNet();
      if (nid == null) return true;
      const nick = parts[0];
      const hasExplicitCh = isChannelTarget(parts[1]);
      const ch = hasExplicitCh ? parts[1] : isChannelTarget(target) ? target : parts[1] || '';
      if (!nick || !ch) {
        pushInfo(nid, target, `Usage: /${cmd} <nick> <#channel> [reason]`);
        return true;
      }
      const reasonStart = hasExplicitCh ? 2 : 1;
      const line =
        parts.length > reasonStart
          ? `${cmd.toUpperCase()} ${nick} ${ch} ${formatTrailing(parts, reasonStart)}`
          : `${cmd.toUpperCase()} ${nick} ${ch}`;
      await sendRawWithAck(nid, target, line, pushInfo);
      return true;
    }
    case 'samode':
    case 'svsmode': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!rest) {
        pushInfo(nid, target, `Usage: /${cmd} [target] <modes> [args]`);
        return true;
      }
      const startsWithSign = parts[0]?.startsWith('+') || parts[0]?.startsWith('-');
      const modeTarget = startsWithSign
        ? isChannelTarget(target)
          ? target
          : getOwnNick(nid) || target
        : '';
      const line = startsWithSign && modeTarget ? `${cmd.toUpperCase()} ${modeTarget} ${rest}` : `${cmd.toUpperCase()} ${rest}`;
      await sendRawWithAck(nid, target, line, pushInfo);
      return true;
    }
    case 'sanick':
    case 'svsnick': {
      const nid = requireNet();
      if (nid == null) return true;
      if (parts.length < 2) {
        pushInfo(nid, target, `Usage: /${cmd} <nick> <newnick>`);
        return true;
      }
      await sendRawWithAck(nid, target, `${cmd.toUpperCase()} ${rest}`, pushInfo);
      return true;
    }
    case 'satopic': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!rest) {
        pushInfo(nid, target, 'Usage: /satopic [#channel] <topic>');
        return true;
      }
      if (isChannelTarget(parts[0]) && parts.length > 1) {
        await sendRawWithAck(nid, target, `SATOPIC ${parts[0]} ${formatTrailing(parts, 1)}`, pushInfo);
      } else if (isChannelTarget(target)) {
        await sendRawWithAck(nid, target, `SATOPIC ${target} ${rest.startsWith(':') ? rest : `:${rest}`}`, pushInfo);
      } else {
        pushInfo(nid, target, 'Usage: /satopic <#channel> <topic>');
      }
      return true;
    }
    case 'chghost':
    case 'chgident': {
      const nid = requireNet();
      if (nid == null) return true;
      if (parts.length < 2) {
        pushInfo(nid, target, `Usage: /${cmd} <nick> <value>`);
        return true;
      }
      await sendRawWithAck(nid, target, `${cmd.toUpperCase()} ${parts[0]} ${parts[1]}`, pushInfo);
      return true;
    }
    case 'chgname':
    case 'swhois': {
      const nid = requireNet();
      if (nid == null) return true;
      if (parts.length < 2) {
        pushInfo(nid, target, `Usage: /${cmd} <nick> <text>`);
        return true;
      }
      await sendRawWithAck(nid, target, `${cmd.toUpperCase()} ${parts[0]} ${formatTrailing(parts, 1)}`, pushInfo);
      return true;
    }
    case 'sethost':
    case 'setident': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!parts[0]) {
        pushInfo(nid, target, `Usage: /${cmd} <value>`);
        return true;
      }
      await sendRawWithAck(nid, target, `${cmd.toUpperCase()} ${parts[0]}`, pushInfo);
      return true;
    }
    case 'setname': {
      const nid = requireNet();
      if (nid == null) return true;
      if (!rest) {
        pushInfo(nid, target, 'Usage: /setname <realname>');
        return true;
      }
      await sendRawWithAck(nid, target, `SETNAME ${rest.startsWith(':') ? rest : `:${rest}`}`, pushInfo);
      return true;
    }

    // Ergo roleplay extensions
    case 'npc': {
      const nid = requireNet();
      if (nid == null) return true;
      if (isChannelTarget(parts[0]) && parts.length >= 3) {
        await sendRawWithAck(nid, target, `NPC ${parts[0]} ${parts[1]} ${formatTrailing(parts, 2)}`, pushInfo);
      } else if (isChannelTarget(target) && parts.length >= 2) {
        await sendRawWithAck(nid, target, `NPC ${target} ${parts[0]} ${formatTrailing(parts, 1)}`, pushInfo);
      } else {
        pushInfo(nid, target, 'Usage: /npc [#channel] <nick> <text>');
      }
      return true;
    }
    case 'scene':
    case 'ambience': {
      const nid = requireNet();
      if (nid == null) return true;
      const upper = cmd.toUpperCase();
      if (isChannelTarget(parts[0]) && parts.length >= 2) {
        await sendRawWithAck(nid, target, `${upper} ${parts[0]} ${formatTrailing(parts, 1)}`, pushInfo);
      } else if (isChannelTarget(target) && rest) {
        await sendRawWithAck(nid, target, `${upper} ${target} ${rest.startsWith(':') ? rest : `:${rest}`}`, pushInfo);
      } else {
        pushInfo(nid, target, `Usage: /${cmd} [#channel] <text>`);
      }
      return true;
    }

    default:
      return false;
  }
}
