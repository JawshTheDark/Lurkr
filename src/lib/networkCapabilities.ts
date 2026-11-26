// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import {
  DEFAULT_CHANMODES,
  DEFAULT_MAX_MODES,
  DEFAULT_PREFIX,
  hasRankAtLeast,
  type ModeSpec,
  type PrefixMode,
} from '../shared/channelModes';

export type IrcdFamily =
  | 'unrealircd'
  | 'ergo'
  | 'inspircd'
  | 'solanum'
  | 'charybdis'
  | 'hybrid'
  | 'ircu'
  | 'ngircd'
  | 'unknown';

export type ServicesFamily = 'anope' | 'atheme' | 'ergo' | 'none' | 'unknown';

export interface NetworkServerProfile {
  ircd: IrcdFamily;
  ircdVersion: string | null;
  services: ServicesFamily;
  negotiatedCaps: string[];
  capsKnown: boolean;
  isupport: Record<string, string | true>;
  isupportKnown: boolean;
  availableUserModes: string;
  availableChanModes: string;
  availableModesKnown: boolean;
  snomask: string;
  operClass: string | null;
  operCapabilities: string[];
  operCapabilitiesKnown: boolean;
  unsupportedCommands: string[];
  absentServices: string[];
  observedServices: string[];
  roleplayEnabled: boolean;
  detectedAt: number | null;
}

export interface NetworkCapabilitiesInput {
  state?: string;
  nick?: string;
  userModes?: string;
  metadataLimits?: unknown;
  multilineLimits?: unknown;
  modeSpec?: ModeSpec | null;
  canAddReaction?: boolean;
  canRemoveReaction?: boolean;
  canReply?: boolean;
  canRedact?: boolean;
}

export interface CapabilityContext {
  connected: boolean;
  profile: NetworkServerProfile;
  userModes: string;
  isOper: boolean;
  isGlobalOper: boolean;
  isLocalOnlyOper: boolean;
  caps: Set<string>;
  capsKnown: boolean;
  modeSpec: ModeSpec;
  selfChannelModes: string[];
  channelModes: string[];
  target?: string;
}

export interface CommandEvaluation {
  allowed: boolean;
  reason?: string;
  hint?: string;
}

export interface BanTypeSpec {
  value: string;
  command: string;
  label: string;
  hint: string;
}

export interface UserActionSpec {
  value: string;
  command: string;
  label: string;
  needsChannel?: boolean;
  needsValue?: string;
}

export interface BroadcastTypeSpec {
  value: string;
  command: string;
  label: string;
}

export interface QuickServerCmdSpec {
  cmd: string;
  command: string;
  label: string;
}

export interface UserModeToggleSpec {
  mode: string;
  label: string;
  operOnly?: boolean;
}

export function createEmptyServerProfile(): NetworkServerProfile {
  return {
    ircd: 'unknown',
    ircdVersion: null,
    services: 'unknown',
    negotiatedCaps: [],
    capsKnown: false,
    isupport: {},
    isupportKnown: false,
    availableUserModes: '',
    availableChanModes: '',
    availableModesKnown: false,
    snomask: '',
    operClass: null,
    operCapabilities: [],
    operCapabilitiesKnown: false,
    unsupportedCommands: [],
    absentServices: [],
    observedServices: [],
    roleplayEnabled: false,
    detectedAt: null,
  };
}

const KNOWN_SERVICE_NICKS = new Set([
  'nickserv',
  'chanserv',
  'hostserv',
  'operserv',
  'global',
  'memoserv',
  'botserv',
  'histserv',
  'saslserv',
]);

export const DEFAULT_MODE_SPEC: ModeSpec = {
  list: DEFAULT_CHANMODES[0],
  always: DEFAULT_CHANMODES[1],
  onSet: DEFAULT_CHANMODES[2],
  flags: DEFAULT_CHANMODES[3],
  prefix: DEFAULT_PREFIX.map((p) => ({ ...p })),
  maxModes: DEFAULT_MAX_MODES,
  topicLen: null,
};

export function detectIrcdFromVersion(version: string): IrcdFamily {
  const v = version.toLowerCase();
  if (v.includes('unrealircd')) return 'unrealircd';
  if (v.startsWith('ergo') || v.includes('/ergo') || v.includes('oragono')) return 'ergo';
  if (v.includes('inspircd')) return 'inspircd';
  if (v.includes('solanum')) return 'solanum';
  if (v.includes('charybdis')) return 'charybdis';
  if (v.includes('hybrid')) return 'hybrid';
  if (v.includes('ngircd')) return 'ngircd';
  if (v.includes('ircu') || v.includes('snircd') || v.includes('nefarious')) return 'ircu';
  return 'unknown';
}

function addUnique(list: string[], value: string): string[] {
  if (!value || list.includes(value)) return list;
  return [...list, value];
}

function removeItem(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : list;
}

function inferIrcdFromIsupport(tokens: Record<string, string | true>): IrcdFamily {
  if ('SAFERATE' in tokens || 'ERGO' in tokens) return 'ergo';
  if ('UHOSTINNAMES' in tokens && tokens.ELIST === 'U' && 'CHATHISTORY' in tokens) return 'ergo';
  const extban = typeof tokens.EXTBAN === 'string' ? tokens.EXTBAN : '';
  if ('HCN' in tokens && 'SAFELIST' in tokens && extban.startsWith('~')) return 'unrealircd';
  if ('CALLERID' in tokens && 'DEAF' in tokens && extban.startsWith('$')) return 'solanum';
  if ('MODULES' in tokens || (typeof tokens.ELIST === 'string' && tokens.ELIST.includes('B'))) {
    return 'inspircd';
  }
  return 'unknown';
}

function inferServices(profile: NetworkServerProfile): ServicesFamily {
  if (profile.ircd === 'ergo') return 'ergo';
  const obs = new Set(profile.observedServices);
  const abs = new Set(profile.absentServices);
  if (profile.services === 'anope' || profile.services === 'atheme' || profile.services === 'none') {
    if (profile.services === 'anope' && abs.has('operserv') && abs.has('nickserv')) return 'none';
    return profile.services;
  }
  if (obs.has('botserv')) return 'anope';
  if (obs.has('operserv') || obs.has('global') || obs.has('memoserv')) {
    return 'anope';
  }
  return profile.services;
}

const ERGO_CAP_SYNONYMS: Record<string, string[]> = {
  ban: ['ban'],
  kill: ['kill'],
  samode: ['samode'],
  sajoin: ['sajoin'],
  sanick: ['sanick'],
  rehash: ['rehash'],
  defcon: ['defcon'],
  massmessage: ['massmessage', 'wallops'],
  vhosts: ['vhosts', 'vhost'],
  saregister: ['saregister', 'accreg'],
  chanreg: ['chanreg'],
  die: ['die'],
  restart: ['restart'],
  history: ['history'],
  relaymsg: ['relaymsg'],
  roleplay: ['roleplay'],
};

function parseOperCapTokens(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase().replace(/^["'`]|["'`.]+$/g, ''))
    .filter((s) => s.length >= 2 && /^[a-z0-9:_-]+$/.test(s));
}

export interface ServerLineInput {
  type?: string;
  nick?: string;
  target?: string;
  text?: string;
}

/**
 * Fold `:server:<networkId>` lines (backlog, history, or live IRC events) into
 * an updated `NetworkServerProfile`. Pure and idempotent over ordered events.
 */
export function ingestServerLines(
  base: NetworkServerProfile | undefined,
  events: ServerLineInput[],
): NetworkServerProfile {
  const prev = base ?? createEmptyServerProfile();
  let next: NetworkServerProfile = {
    ...prev,
    negotiatedCaps: [...prev.negotiatedCaps],
    isupport: { ...prev.isupport },
    operCapabilities: [...prev.operCapabilities],
    unsupportedCommands: [...prev.unsupportedCommands],
    absentServices: [...prev.absentServices],
    observedServices: [...prev.observedServices],
  };

  for (const ev of events) {
    if (!ev) continue;
    if (ev.nick) {
      const lowNick = ev.nick.toLowerCase();
      if (KNOWN_SERVICE_NICKS.has(lowNick)) {
        next.observedServices = addUnique(next.observedServices, lowNick);
        next.absentServices = removeItem(next.absentServices, lowNick);
      }
    }

    const text = (ev.text || '').trim();
    if (!text) continue;

    // 1. Lurker negotiated CAP summary line (`Negotiated capabilities: cap1 cap2`)
    const capMatch = /^Negotiated capabilities:\s*(.+)$/i.exec(text);
    if (capMatch) {
      const caps = capMatch[1]
        .split(/[\s,]+/)
        .map((c) => c.trim().toLowerCase())
        .filter((c) => c && c !== '(none)' && c !== 'none');
      next.negotiatedCaps = Array.from(new Set(caps)).sort();
      next.capsKnown = true;
      next.detectedAt = next.detectedAt ?? Date.now();
      for (const c of next.negotiatedCaps) {
        if (c.startsWith('ergo.chat/') || c.startsWith('oragono.chat/')) {
          if (next.ircd === 'unknown') next.ircd = 'ergo';
        } else if (c.startsWith('unrealircd.org/')) {
          if (next.ircd === 'unknown') next.ircd = 'unrealircd';
        } else if (c.startsWith('inspircd.org/')) {
          if (next.ircd === 'unknown') next.ircd = 'inspircd';
        } else if (c.startsWith('solanum.chat/')) {
          if (next.ircd === 'unknown') next.ircd = 'solanum';
        }
        if (c === 'roleplay' || c === 'draft/roleplay' || c === 'ergo.chat/roleplay') {
          next.roleplayEnabled = true;
        }
      }
      continue;
    }

    // 2. 001 Welcome resets ephemeral per-connection error/oper capability tracking
    if (/^Welcome to (?:the )?.+ IRC Network\b/i.test(text) || /^Welcome to /i.test(text)) {
      if (next.ircd !== 'unknown' || text.includes('IRC')) {
        next.unsupportedCommands = [];
        next.operCapabilities = [];
        next.operCapabilitiesKnown = false;
        next.operClass = null;
        next.snomask = '';
      }
      continue;
    }

    // 3. 002 RPL_YOURHOST
    const rpl002 = /^Your host is [^,]+,\s+running version\s+(\S+)/i.exec(text);
    if (rpl002) {
      const ver = rpl002[1].replace(/[.,]+$/, '');
      next.ircdVersion = ver;
      const detected = detectIrcdFromVersion(ver);
      if (detected !== 'unknown') next.ircd = detected;
      next.detectedAt = next.detectedAt ?? Date.now();
      continue;
    }

    // 4. 004 RPL_MYINFO: `<server> <version> <umodes> <cmodes> [<param_cmodes>]`
    if (!/\bare\b/i.test(text)) {
      const rpl004Text = text.replace(/^004\s+\S+\s+/, '');
      const rpl004 = /^(\S+)\s+(\S+)\s+([A-Za-z]+)\s+([A-Za-z]+)(?:\s+([A-Za-z*]+))?$/.exec(rpl004Text);
      if (
        rpl004 &&
        (rpl004[1].includes('.') ||
          detectIrcdFromVersion(rpl004[2]) !== 'unknown' ||
          rpl004[3].length >= 4)
      ) {
        const ver = rpl004[2].replace(/[.,]+$/, '');
        next.ircdVersion = ver;
        const detected = detectIrcdFromVersion(ver);
        if (detected !== 'unknown') next.ircd = detected;
        next.availableUserModes = rpl004[3];
        next.availableChanModes = rpl004[4];
        next.availableModesKnown = true;
        if (next.ircd === 'ergo' && next.availableChanModes.includes('E')) {
          next.roleplayEnabled = true;
        }
        next.detectedAt = next.detectedAt ?? Date.now();
        continue;
      }
    }

    // 5. 005 RPL_ISUPPORT
    const rpl005 = /^(?:005\s+\S+\s+)?(.+?)\s+:?are (?:supported|available) (?:by|on) this server$/i.exec(text);
    if (rpl005) {
      const rawTokens = rpl005[1].trim().split(/\s+/);
      for (const tok of rawTokens) {
        if (!tok || tok.startsWith(':')) continue;
        const eq = tok.indexOf('=');
        if (eq > 0) {
          const k = tok.slice(0, eq).toUpperCase();
          next.isupport[k] = tok.slice(eq + 1);
        } else {
          next.isupport[tok.toUpperCase()] = true;
        }
      }
      next.isupportKnown = true;
      if ('ROLEPLAY' in next.isupport) next.roleplayEnabled = true;
      if (next.ircd === 'unknown') {
        const guessed = inferIrcdFromIsupport(next.isupport);
        if (guessed !== 'unknown') next.ircd = guessed;
      }
      next.detectedAt = next.detectedAt ?? Date.now();
      continue;
    }

    // 6. 351 RPL_VERSION: `<version>[.] <server> ...`
    const rpl351 = /^(\S+)\s+(\S+)(?:\s+(.*))?$/.exec(text);
    if (rpl351 && !/^Server notice mask/i.test(text)) {
      const cleanVer = rpl351[1].replace(/\.+$/, '');
      const detected = detectIrcdFromVersion(cleanVer);
      if (detected !== 'unknown') {
        next.ircdVersion = cleanVer;
        next.ircd = detected;
        next.detectedAt = next.detectedAt ?? Date.now();
        continue;
      }
    }

    // 7. 008 RPL_SNOMASK
    const snoMatch = /Server notice mask\s*\(([+-]?[A-Za-z]+)\)/i.exec(text);
    if (snoMatch) {
      next.snomask = snoMatch[1].replace(/^\+/, '');
      continue;
    }

    // 8. 381 / Oper capabilities & operclass hints
    const capNotice = /(?:with\s+)?(?:oper\s+)?(?:capabilities|privileges|privs):\s*([a-z0-9_,:;\s-]+)\)?$/i.exec(
      text,
    );
    if (capNotice) {
      const parsed = parseOperCapTokens(capNotice[1]);
      if (parsed.length > 0) {
        next.operCapabilities = Array.from(new Set([...next.operCapabilities, ...parsed]));
        next.operCapabilitiesKnown = true;
      }
    }
    const classMatch =
      /oper(?:\s*class)?[:=]\s*["']?([a-zA-Z0-9_.-]+)["']?|oper\s*class\s+["']?([a-zA-Z0-9_.-]+)["']?/i.exec(
        text,
      );
    if (classMatch && /operclass|oper class|you are now an irc operator/i.test(text)) {
      next.operClass = classMatch[1] || classMatch[2] || null;
    }

    // 9. 421 Unknown command
    const unkMatch =
      /^(?:421\s+\S+\s+)?([A-Za-z0-9_]+)\s+:?Unknown command$/i.exec(text) ||
      /^Unknown command:\s*([A-Za-z0-9_]+)/i.exec(text);
    if (unkMatch) {
      const cmd = unkMatch[1].toUpperCase();
      next.unsupportedCommands = addUnique(next.unsupportedCommands, cmd);
      continue;
    }

    // 10. 401 No such nick for service targets
    const noNickMatch = /^([A-Za-z0-9_-]+)\s+:?No such nick(?:\/channel)?$/i.exec(text);
    if (noNickMatch) {
      const svc = noNickMatch[1].toLowerCase();
      if (KNOWN_SERVICE_NICKS.has(svc)) {
        next.absentServices = addUnique(next.absentServices, svc);
        next.observedServices = removeItem(next.observedServices, svc);
      }
      continue;
    }

    // 11. Services implementation clues in banners / notices / LINKS
    if (/\bAnope\b/i.test(text) && next.ircd !== 'ergo') {
      next.services = 'anope';
    } else if (/\bAtheme\b/i.test(text) && next.ircd !== 'ergo') {
      next.services = 'atheme';
    }
    for (const svc of KNOWN_SERVICE_NICKS) {
      if (new RegExp(`\\b${svc}\\b`, 'i').test(text)) {
        // Don't treat "OperServ not supported" or "No such nick" as present; only server/service notices or LINKS lines
        if (!/not supported|unknown|no such/i.test(text)) {
          if (ev.type === 'notice' || ev.type === 'motd' || /^services?\./i.test(text)) {
            if (ev.nick?.toLowerCase() === svc || /^services\./i.test(text)) {
              next.observedServices = addUnique(next.observedServices, svc);
            }
          }
        }
      }
    }
  }

  next.services = inferServices(next);
  return next;
}

export function noteObservedServiceTargets(
  base: NetworkServerProfile | undefined,
  targets: string[],
): NetworkServerProfile {
  const prev = base ?? createEmptyServerProfile();
  let observed = prev.observedServices;
  let absent = prev.absentServices;
  let changed = false;

  for (const raw of targets) {
    if (!raw) continue;
    const low = raw.toLowerCase();
    if (KNOWN_SERVICE_NICKS.has(low) && !observed.includes(low)) {
      observed = [...observed, low];
      absent = absent.filter((x) => x !== low);
      changed = true;
    }
  }

  if (!changed) return prev;
  const next: NetworkServerProfile = { ...prev, observedServices: observed, absentServices: absent };
  next.services = inferServices(next);
  return next;
}

export function buildCapabilityContext(
  netState: NetworkCapabilitiesInput | null | undefined,
  profile: NetworkServerProfile | undefined,
  options?: {
    selfChannelModes?: string[];
    channelModes?: string | string[] | null;
    target?: string;
  },
): CapabilityContext {
  const normalizedChannelModes: string[] = Array.isArray(options?.channelModes)
    ? options.channelModes
    : typeof options?.channelModes === 'string'
      ? options.channelModes
          .trim()
          .split(/\s+/)[0]
          .replace(/^[+-]+/, '')
          .split('')
          .filter(Boolean)
      : [];
  const prof = profile ?? createEmptyServerProfile();
  const userModes = netState?.userModes || '';
  const connected = netState?.state === 'connected';
  const isOper = connected && /[oO]/.test(userModes);
  const isLocalOnlyOper = isOper && userModes.includes('O') && !userModes.includes('o');
  const isGlobalOper = isOper && !isLocalOnlyOper;

  const caps = new Set<string>(prof.negotiatedCaps.map((c) => c.toLowerCase()));
  if (netState?.metadataLimits != null) caps.add('draft/metadata-2');
  if (netState?.multilineLimits != null) {
    caps.add('draft/multiline');
    caps.add('batch');
  }
  if (netState?.canRedact) caps.add('draft/message-redaction');
  if (netState?.canReply) caps.add('message-tags');
  if (netState?.canAddReaction) {
    caps.add('message-tags');
    caps.add('echo-message');
  }

  const capsKnown =
    prof.capsKnown ||
    netState?.metadataLimits !== undefined ||
    netState?.multilineLimits !== undefined ||
    netState?.canRedact !== undefined;

  const modeSpec = netState?.modeSpec ?? DEFAULT_MODE_SPEC;
  const effectiveProfile: NetworkServerProfile = {
    ...prof,
    services: inferServices(prof),
    roleplayEnabled:
      prof.roleplayEnabled ||
      caps.has('roleplay') ||
      caps.has('draft/roleplay') ||
      caps.has('ergo.chat/roleplay') ||
      'ROLEPLAY' in prof.isupport ||
      (prof.ircd === 'ergo' &&
        (prof.availableChanModes.includes('E') || normalizedChannelModes.includes('E'))),
  };

  return {
    connected,
    profile: effectiveProfile,
    userModes,
    isOper,
    isGlobalOper,
    isLocalOnlyOper,
    caps,
    capsKnown,
    modeSpec,
    selfChannelModes: options?.selfChannelModes || [],
    channelModes: normalizedChannelModes,
    target: options?.target,
  };
}

export function effectiveServicesFamily(ctx: CapabilityContext): ServicesFamily {
  const { profile, userModes, caps } = ctx;
  if (profile.ircd === 'ergo') return 'ergo';
  if (profile.services !== 'unknown') return profile.services;
  const obs = new Set(profile.observedServices);
  const abs = new Set(profile.absentServices);
  if (abs.has('operserv') && abs.has('nickserv')) return 'none';
  if (obs.has('botserv') || obs.has('operserv') || obs.has('global') || obs.has('memoserv')) {
    return 'anope';
  }
  // If UnrealIRCd/InspIRCd/Solanum shows registered-nick mode, SASL/account-notify, or NickServ/ChanServ
  if (
    (profile.ircd === 'unrealircd' ||
      profile.ircd === 'inspircd' ||
      profile.ircd === 'solanum' ||
      profile.ircd === 'charybdis') &&
    (obs.size > 0 || userModes.includes('r') || caps.has('sasl') || caps.has('account-notify'))
  ) {
    return 'anope';
  }
  return 'unknown';
}

function hasOperCap(ctx: CapabilityContext, capName: string): boolean {
  if (!ctx.profile.operCapabilitiesKnown) return true;
  const caps = ctx.profile.operCapabilities;
  if (caps.includes('*') || caps.includes('all') || caps.includes('admin')) return true;
  const synonyms = ERGO_CAP_SYNONYMS[capName] || [capName];
  return synonyms.some((syn) => caps.includes(syn) || caps.includes(`oper:${syn}`));
}

const UNIVERSAL_OPER_COMMANDS = new Set([
  'KILL',
  'KLINE',
  'WALLOPS',
  'LUSERS',
  'LINKS',
  'MAP',
  'STATS',
  'REHASH',
  'CONNECT',
  'SQUIT',
  'CLOSE',
  'RESTART',
  'DIE',
]);

const ERGO_OPER_COMMANDS = new Set([
  'KILL',
  'KLINE',
  'UNKLINE',
  'DLINE',
  'UNDLINE',
  'UBAN',
  'DEFCON',
  'SAJOIN',
  'SAMODE',
  'SANICK',
  'WALLOPS',
  'LUSERS',
  'STATS',
  'REHASH',
  'HELPOP',
  'DIE',
  'RESTART',
]);

const UNREAL_OPER_COMMANDS = new Set([
  'GLINE',
  'UNGLINE',
  'KLINE',
  'ZLINE',
  'UNZLINE',
  'GZLINE',
  'UNGZLINE',
  'SHUN',
  'UNSHUN',
  'TEMPSHUN',
  'UNTEMPSHUN',
  'ELINE',
  'UNELINE',
  'SPAMFILTER',
  'KILL',
  'SAKILL',
  'SVSKILL',
  'SVSNICK',
  'SVSMODE',
  'SVSJOIN',
  'SVSPART',
  'SAJOIN',
  'SAPART',
  'SAMODE',
  'SATOPIC',
  'SANICK',
  'CHGHOST',
  'CHGIDENT',
  'CHGNAME',
  'SWHOIS',
  'SETHOST',
  'SETIDENT',
  'WALLOPS',
  'GLOBOPS',
  'LOCOPS',
  'CHATOPS',
  'ADDMOTD',
  'ADDOMOTD',
  'MAP',
  'LINKS',
  'LUSERS',
  'STATS',
  'MODULE',
  'DNS',
  'MD',
  'TSCTL',
  'MKPASSWD',
  'HELPOP',
  'REHASH',
  'CONNECT',
  'SQUIT',
  'CLOSE',
  'RESTART',
  'DIE',
]);

const INSPIRCD_OPER_COMMANDS = new Set([
  'GLINE',
  'UNGLINE',
  'KLINE',
  'ZLINE',
  'ELINE',
  'KILL',
  'SAJOIN',
  'SAPART',
  'SAMODE',
  'SATOPIC',
  'SANICK',
  'CHGHOST',
  'CHGIDENT',
  'CHGNAME',
  'SETHOST',
  'SETIDENT',
  'WALLOPS',
  'GLOBOPS',
  'MAP',
  'LINKS',
  'LUSERS',
  'STATS',
  'HELPOP',
  'REHASH',
  'CONNECT',
  'SQUIT',
  'RESTART',
  'DIE',
]);

const SOLANUM_OPER_COMMANDS = new Set([
  'KLINE',
  'UNKLINE',
  'DLINE',
  'UNDLINE',
  'KILL',
  'OMODE',
  'WALLOPS',
  'GLOBOPS',
  'OPERWALL',
  'MAP',
  'LINKS',
  'LUSERS',
  'STATS',
  'TRACE',
  'PRIVS',
  'REHASH',
  'CONNECT',
  'SQUIT',
  'CLOSE',
  'RESTART',
  'DIE',
]);

const GLOBAL_ONLY_OPER_COMMANDS = new Set([
  'GLINE',
  'UNGLINE',
  'GZLINE',
  'UNGZLINE',
  'SHUN',
  'UNSHUN',
  'ELINE',
  'UNELINE',
  'SPAMFILTER',
  'SAKILL',
  'SVSKILL',
  'SVSNICK',
  'SVSMODE',
  'SVSJOIN',
  'SVSPART',
  'SAJOIN',
  'SAPART',
  'SAMODE',
  'SATOPIC',
  'SANICK',
  'CHGHOST',
  'CHGIDENT',
  'CHGNAME',
  'SWHOIS',
  'GLOBOPS',
  'OPERWALL',
  'ADDMOTD',
  'ADDOMOTD',
  'DEFCON',
  'UBAN',
  'CONNECT',
  'SQUIT',
  'MD',
  'TSCTL',
]);

const ALL_OPER_COMMANDS = new Set([
  ...UNIVERSAL_OPER_COMMANDS,
  ...ERGO_OPER_COMMANDS,
  ...UNREAL_OPER_COMMANDS,
  ...INSPIRCD_OPER_COMMANDS,
  ...SOLANUM_OPER_COMMANDS,
  'DEOPER',
  'OS',
  'OPERSERV',
  'GLOBAL',
  'JUPE',
  'AKILL',
  'CHANKILL',
  'OPERCLOSE',
  'HELPU',
]);

const ANOPE_OPER_COMMANDS = new Set([
  'OS',
  'OPERSERV',
  'GLOBAL',
  'JUPE',
  'AKILL',
  'SQLINE',
  'SZLINE',
  'SNLINE',
  'SGLINE',
  'CHANKILL',
  'OLINE',
]);

const ERGO_CAP_BY_COMMAND: Record<string, string> = {
  KLINE: 'ban',
  UNKLINE: 'ban',
  DLINE: 'ban',
  UNDLINE: 'ban',
  UBAN: 'ban',
  KILL: 'kill',
  SAJOIN: 'sajoin',
  SAMODE: 'samode',
  SANICK: 'sanick',
  REHASH: 'rehash',
  DEFCON: 'defcon',
  WALLOPS: 'massmessage',
  DIE: 'die',
  RESTART: 'restart',
};

const CHANNEL_PREFIX_CMD_RANK: Record<string, { mode: string; requiredRank: string }> = {
  owner: { mode: 'q', requiredRank: 'q' },
  deowner: { mode: 'q', requiredRank: 'q' },
  protect: { mode: 'a', requiredRank: 'q' },
  deprotect: { mode: 'a', requiredRank: 'q' },
  op: { mode: 'o', requiredRank: 'o' },
  deop: { mode: 'o', requiredRank: 'o' },
  halfop: { mode: 'h', requiredRank: 'o' },
  dehalfop: { mode: 'h', requiredRank: 'o' },
  voice: { mode: 'v', requiredRank: 'h' },
  devoice: { mode: 'v', requiredRank: 'h' },
};

const SERVICE_CMD_TARGET: Record<string, string> = {
  ns: 'nickserv',
  nickserv: 'nickserv',
  cs: 'chanserv',
  chanserv: 'chanserv',
  hs: 'hostserv',
  hostserv: 'hostserv',
  ms: 'memoserv',
  memoserv: 'memoserv',
  bs: 'botserv',
  botserv: 'botserv',
  os: 'operserv',
  operserv: 'operserv',
  global: 'global',
  jupe: 'operserv',
  akill: 'operserv',
  sqline: 'operserv',
  szline: 'operserv',
  snline: 'operserv',
  sgline: 'operserv',
  chankill: 'operserv',
  oline: 'operserv',
};

function commandSetForIrcd(ircd: IrcdFamily): Set<string> {
  switch (ircd) {
    case 'ergo':
      return ERGO_OPER_COMMANDS;
    case 'unrealircd':
      return UNREAL_OPER_COMMANDS;
    case 'inspircd':
      return INSPIRCD_OPER_COMMANDS;
    case 'solanum':
    case 'charybdis':
    case 'hybrid':
      return SOLANUM_OPER_COMMANDS;
    default:
      return UNIVERSAL_OPER_COMMANDS;
  }
}

export function prefixIncludes(prefix: readonly PrefixMode[], letter: string): boolean {
  return prefix.some((p) => p.mode === letter);
}

/**
 * Single-source-of-truth command/action evaluator used across slash autocomplete,
 * dispatch guards, OperToolbar, OperConsoleModal, and MemberList.
 */
export function evaluateCommand(ctx: CapabilityContext, rawCommand: string): CommandEvaluation {
  const cmdLower = rawCommand.trim().replace(/^\//, '').toLowerCase();
  const cmdUpper = cmdLower.toUpperCase();
  const { profile, caps, isOper, isLocalOnlyOper, modeSpec, selfChannelModes } = ctx;

  if (profile.unsupportedCommands.includes(cmdUpper)) {
    return { allowed: false, reason: `Server returned 421 Unknown command for ${cmdUpper}.` };
  }

  // User IRCv3 CAP-gated commands
  if (cmdLower === 'setname') {
    if (!caps.has('setname')) {
      return {
        allowed: false,
        reason: "SETNAME requires the IRCv3 'setname' CAP to be negotiated with this network.",
      };
    }
    return { allowed: true };
  }

  if (cmdLower === 'accept') {
    if (
      profile.isupportKnown &&
      !('CALLERID' in profile.isupport) &&
      !profile.availableUserModes.includes('g')
    ) {
      return { allowed: false, reason: 'This server does not advertise CALLERID (+g).' };
    }
    return { allowed: true };
  }

  if (cmdLower === 'knock') {
    if (profile.isupportKnown && !('KNOCK' in profile.isupport)) {
      return { allowed: false, reason: 'This server does not advertise KNOCK in ISUPPORT (005).' };
    }
    return { allowed: true };
  }

  if (cmdLower === 'react') {
    if (ctx.capsKnown && !caps.has('message-tags')) {
      return { allowed: false, reason: "REACT requires IRCv3 'message-tags' + 'echo-message'." };
    }
    return { allowed: true };
  }

  if (cmdLower === 'redact') {
    if (ctx.capsKnown && !caps.has('draft/message-redaction')) {
      return { allowed: false, reason: "REDACT requires IRCv3 'draft/message-redaction' CAP." };
    }
    return { allowed: true };
  }

  if (cmdLower === 'rename') {
    if (ctx.capsKnown && !caps.has('draft/channel-rename')) {
      return { allowed: false, reason: "RENAME requires IRCv3 'draft/channel-rename' CAP." };
    }
    return { allowed: true };
  }

  if (cmdLower === 'reply') {
    if (ctx.capsKnown && !caps.has('message-tags')) {
      return { allowed: false, reason: "REPLY requires IRCv3 'message-tags' CAP." };
    }
    return { allowed: true };
  }

  if (cmdLower === 'metadata') {
    if (ctx.capsKnown && !caps.has('draft/metadata-2')) {
      return { allowed: false, reason: "METADATA requires IRCv3 'draft/metadata-2' CAP." };
    }
    return { allowed: true };
  }

  if (cmdLower === 'monitor') {
    if (profile.isupportKnown && !('MONITOR' in profile.isupport) && !caps.has('monitor')) {
      return { allowed: false, reason: 'This server does not advertise MONITOR in ISUPPORT (005).' };
    }
    return { allowed: true };
  }

  if (cmdLower === 'watch') {
    const supported = 'WATCH' in profile.isupport || profile.ircd === 'unrealircd';
    if (!supported) {
      return {
        allowed: false,
        reason:
          profile.ircd === 'ergo'
            ? 'Ergo uses MONITOR (IRCv3), not WATCH.'
            : 'WATCH requires UnrealIRCd or WATCH advertisement in ISUPPORT (005).',
      };
    }
    return { allowed: true };
  }

  if (cmdLower === 'silence') {
    const supported =
      'SILENCE' in profile.isupport ||
      profile.ircd === 'unrealircd' ||
      profile.ircd === 'inspircd';
    if (!supported) {
      return {
        allowed: false,
        reason:
          profile.ircd === 'ergo'
            ? 'Ergo does not support server-side SILENCE.'
            : 'SILENCE requires SILENCE in ISUPPORT (005) (UnrealIRCd/InspIRCd).',
      };
    }
    return { allowed: true };
  }

  // Ergo Roleplay commands
  if (cmdLower === 'npc' || cmdLower === 'scene' || cmdLower === 'ambience') {
    if (profile.ircd !== 'ergo') {
      return {
        allowed: false,
        reason: `${cmdUpper} is an Ergo roleplay command and is not supported on ${
          profile.ircd === 'unknown' ? 'this server' : profile.ircd
        }.`,
      };
    }
    if (!profile.roleplayEnabled) {
      return {
        allowed: false,
        reason: 'Ergo roleplay is not enabled (no roleplay CAP / +E mode detected).',
      };
    }
    return { allowed: true };
  }

  // Channel prefix & moderation commands
  const prefixSpec = CHANNEL_PREFIX_CMD_RANK[cmdLower];
  if (prefixSpec) {
    if (!prefixIncludes(modeSpec.prefix, prefixSpec.mode)) {
      return {
        allowed: false,
        reason: `Channel mode +${prefixSpec.mode} is not in this network's PREFIX (${modeSpec.prefix
          .map((p) => p.mode)
          .join('')}).`,
      };
    }
    const canSamode =
      isOper && !isLocalOnlyOper && evaluateCommand(ctx, 'SAMODE').allowed;
    if (!hasRankAtLeast(selfChannelModes, modeSpec.prefix, prefixSpec.requiredRank) && !canSamode) {
      return {
        allowed: false,
        reason: `Requires channel rank +${prefixSpec.requiredRank} in this channel.`,
      };
    }
    return { allowed: true };
  }

  if (
    cmdLower === 'kick' ||
    cmdLower === 'kb' ||
    cmdLower === 'kickban' ||
    cmdLower === 'ban' ||
    cmdLower === 'unban'
  ) {
    if (
      (cmdLower === 'ban' || cmdLower === 'unban' || cmdLower === 'kb' || cmdLower === 'kickban') &&
      !modeSpec.list.includes('b')
    ) {
      return { allowed: false, reason: 'List mode +b is not advertised in CHANMODES.' };
    }
    const canSamode =
      (cmdLower === 'ban' || cmdLower === 'unban') &&
      isOper &&
      !isLocalOnlyOper &&
      evaluateCommand(ctx, 'SAMODE').allowed;
    if (!hasRankAtLeast(selfChannelModes, modeSpec.prefix, 'h') && !canSamode) {
      return {
        allowed: false,
        reason: 'Requires channel operator (+o or +h) status in this channel.',
      };
    }
    return { allowed: true };
  }

  // /oper login command and /close UI buffer command
  if (cmdLower === 'oper') {
    return ctx.connected
      ? { allowed: true }
      : { allowed: false, reason: 'Connect to the network first.' };
  }
  if (cmdLower === 'close') {
    return { allowed: true };
  }

  // Services commands
  const svcTarget = SERVICE_CMD_TARGET[cmdLower];
  if (svcTarget) {
    if (ANOPE_OPER_COMMANDS.has(cmdUpper) && !isOper) {
      return { allowed: false, reason: 'Requires IRC operator (+o/+O) status.' };
    }
    if (profile.absentServices.includes(svcTarget)) {
      return { allowed: false, reason: `${svcTarget} was not found on this network.` };
    }
    const svcFamily = effectiveServicesFamily(ctx);
    if (svcFamily === 'ergo') {
      if (svcTarget === 'operserv' || svcTarget === 'global' || svcTarget === 'memoserv' || svcTarget === 'botserv') {
        return {
          allowed: false,
          reason: `Ergo uses built-in NickServ, ChanServ, and HostServ — ${svcTarget} does not exist on Ergo.`,
        };
      }
      return { allowed: true };
    }
    if (svcFamily === 'none') {
      return { allowed: false, reason: 'No IRC services detected on this network.' };
    }
    if (svcFamily === 'atheme' && svcTarget === 'botserv') {
      return { allowed: false, reason: 'BotServ is Anope-specific and not standard on Atheme.' };
    }
    if (svcFamily === 'unknown' && !profile.observedServices.includes(svcTarget)) {
      return {
        allowed: false,
        reason: 'External IRC services have not been observed on this network.',
      };
    }
    if (ANOPE_OPER_COMMANDS.has(cmdUpper) && isLocalOnlyOper) {
      return { allowed: false, reason: 'Network OperServ/Global commands require global oper (+o).' };
    }
    return { allowed: true };
  }

  // Raw / oper commands
  const normalizedUpper =
    cmdUpper === 'OPERCLOSE'
      ? 'CLOSE'
      : cmdUpper === 'HELPU'
        ? 'HELPOP'
        : cmdUpper === 'UNGLINE'
          ? 'GLINE'
          : cmdUpper === 'UNZLINE'
            ? 'ZLINE'
            : cmdUpper === 'UNGZLINE'
              ? 'GZLINE'
              : cmdUpper === 'UNSHUN'
                ? 'SHUN'
                : cmdUpper === 'UNTEMPSHUN'
                  ? 'TEMPSHUN'
                  : cmdUpper === 'UNELINE'
                    ? 'ELINE'
                    : cmdUpper;

  if (profile.unsupportedCommands.includes(normalizedUpper)) {
    return { allowed: false, reason: `Server returned 421 Unknown command for ${normalizedUpper}.` };
  }

  if (!ALL_OPER_COMMANDS.has(cmdUpper) && !ALL_OPER_COMMANDS.has(normalizedUpper)) {
    return { allowed: true };
  }

  if (!isOper) {
    return { allowed: false, reason: 'Requires IRC operator (+o/+O) user mode.' };
  }

  if (cmdUpper === 'DEOPER') {
    return { allowed: true };
  }

  if (isLocalOnlyOper && GLOBAL_ONLY_OPER_COMMANDS.has(normalizedUpper)) {
    return {
      allowed: false,
      reason: 'Requires global IRC operator (+o); current mode is local oper (+O).',
    };
  }

  // Software dialect gating
  const allowedForIrcd = commandSetForIrcd(profile.ircd);
  if (!allowedForIrcd.has(normalizedUpper)) {
    if (profile.ircd === 'ergo') {
      const hint =
        normalizedUpper === 'GLINE' || normalizedUpper === 'GZLINE' || normalizedUpper === 'ZLINE'
          ? 'Use /kline, /dline, or /uban on Ergo.'
          : normalizedUpper === 'SAPART'
            ? 'Ergo does not have SAPART; use channel kick or SAMODE.'
            : normalizedUpper === 'CHGHOST'
              ? 'Ergo sets vhosts via HostServ (/hs SET), not CHGHOST.'
              : undefined;
      return {
        allowed: false,
        reason: `${normalizedUpper} is not supported on Ergo IRCd.${hint ? ` ${hint}` : ''}`,
        hint,
      };
    }
    if (profile.ircd === 'unrealircd') {
      const hint =
        normalizedUpper === 'UBAN' || normalizedUpper === 'DLINE' || normalizedUpper === 'UNDLINE'
          ? 'Use /gline, /kline, /zline, or /gzline on UnrealIRCd.'
          : normalizedUpper === 'DEFCON'
            ? 'Native /defcon is Ergo-specific; use Anope OperServ DEFCON if Anope is linked.'
            : normalizedUpper === 'UNKLINE'
              ? 'Use /kline -<mask> on UnrealIRCd.'
              : undefined;
      return {
        allowed: false,
        reason: `${normalizedUpper} is not supported on UnrealIRCd.${hint ? ` ${hint}` : ''}`,
        hint,
      };
    }
    return {
      allowed: false,
      reason:
        profile.ircd === 'unknown'
          ? `${normalizedUpper} is IRCd-specific and awaits server software identification (002/004/VERSION).`
          : `${normalizedUpper} is not supported by ${profile.ircd}.`,
    };
  }

  // CHGHOST CAP gating on UnrealIRCd / InspIRCd
  if (normalizedUpper === 'CHGHOST' && ctx.capsKnown && !caps.has('chghost')) {
    return {
      allowed: false,
      reason: "CHGHOST requires the IRCv3 'chghost' CAP on this network.",
    };
  }

  // Fine-grained oper capabilities (Ergo 381 operclass / Solanum PRIVS)
  if (profile.operCapabilitiesKnown) {
    const reqCap = ERGO_CAP_BY_COMMAND[normalizedUpper];
    if (reqCap && !hasOperCap(ctx, reqCap)) {
      return {
        allowed: false,
        reason: `Your operclass does not grant the '${reqCap}' capability.`,
      };
    }
  }

  return { allowed: true };
}

const ALL_BAN_TYPES: Array<BanTypeSpec & { kind: 'ircd' | 'anope' }> = [
  {
    value: 'GLINE',
    command: 'GLINE',
    kind: 'ircd',
    label: 'GLINE — Network User@Host Ban (UnrealIRCd)',
    hint: '*@host.example or ~account:name',
  },
  {
    value: 'KLINE',
    command: 'KLINE',
    kind: 'ircd',
    label: 'KLINE — User@Host Server Ban',
    hint: '*!*@host or user@host',
  },
  {
    value: 'DLINE',
    command: 'DLINE',
    kind: 'ircd',
    label: 'DLINE — IP / CIDR Subnet Ban',
    hint: '192.0.2.0/24 or 203.0.113.10',
  },
  {
    value: 'ZLINE',
    command: 'ZLINE',
    kind: 'ircd',
    label: 'ZLINE — Local IP Drop',
    hint: '203.0.113.10 or 198.51.100.*',
  },
  {
    value: 'GZLINE',
    command: 'GZLINE',
    kind: 'ircd',
    label: 'GZLINE — Global IP Drop (UnrealIRCd)',
    hint: '203.0.113.10',
  },
  {
    value: 'SHUN',
    command: 'SHUN',
    kind: 'ircd',
    label: 'SHUN — Silence Commands Globally (UnrealIRCd)',
    hint: '*@host.example',
  },
  {
    value: 'TEMPSHUN',
    command: 'TEMPSHUN',
    kind: 'ircd',
    label: 'TEMPSHUN — Session Shun by Nick (UnrealIRCd)',
    hint: 'nickname',
  },
  {
    value: 'ELINE',
    command: 'ELINE',
    kind: 'ircd',
    label: 'ELINE — TKL Ban Exception',
    hint: '*@trusted.host',
  },
  {
    value: 'UBAN ADD',
    command: 'UBAN',
    kind: 'ircd',
    label: 'UBAN — Unified Account/IP/Mask Ban (Ergo)',
    hint: '192.0.2.0/24, *!*@host, or account',
  },
  {
    value: 'SPAMFILTER',
    command: 'SPAMFILTER',
    kind: 'ircd',
    label: 'SPAMFILTER — Message Filter Rule (UnrealIRCd)',
    hint: 'regex or simple pattern',
  },
  {
    value: 'OS AKILL',
    command: 'AKILL',
    kind: 'anope',
    label: 'OperServ AKILL — Global Services Ban',
    hint: '*@host.example',
  },
  {
    value: 'OS SQLINE',
    command: 'OS',
    kind: 'anope',
    label: 'OperServ SQLINE — Nick Mask Ban',
    hint: 'badnick*',
  },
  {
    value: 'OS SZLINE',
    command: 'OS',
    kind: 'anope',
    label: 'OperServ SZLINE — IP Ban',
    hint: '203.0.113.*',
  },
  {
    value: 'OS SNLINE',
    command: 'OS',
    kind: 'anope',
    label: 'OperServ SNLINE — Ident Ban (Anope)',
    hint: 'badident',
  },
  {
    value: 'OS SGLINE',
    command: 'OS',
    kind: 'anope',
    label: 'OperServ SGLINE — Realname Ban (Anope)',
    hint: 'bad realname',
  },
];

export function getAvailableBanTypes(ctx: CapabilityContext): BanTypeSpec[] {
  const svc = effectiveServicesFamily(ctx);
  return ALL_BAN_TYPES.filter((b) => {
    if (!evaluateCommand(ctx, b.command).allowed) return false;
    if (b.kind === 'anope') {
      if (svc === 'ergo' || svc === 'none' || svc === 'unknown') return false;
      if (svc === 'atheme' && (b.value === 'OS SNLINE' || b.value === 'OS SGLINE')) return false;
    }
    return true;
  });
}

const ALL_USER_ACTIONS: UserActionSpec[] = [
  { value: 'KILL', command: 'KILL', label: 'KILL — Disconnect User', needsValue: 'Reason' },
  { value: 'SAKILL', command: 'SAKILL', label: 'SAKILL — Force Kill (UnrealIRCd)', needsValue: 'Reason' },
  { value: 'SVSKILL', command: 'SVSKILL', label: 'SVSKILL — Services Kill', needsValue: 'Reason' },
  { value: 'SAJOIN', command: 'SAJOIN', label: 'SAJOIN — Force Join Channel', needsChannel: true },
  {
    value: 'SAPART',
    command: 'SAPART',
    label: 'SAPART — Force Part Channel',
    needsChannel: true,
    needsValue: 'Optional Reason',
  },
  { value: 'SAMODE', command: 'SAMODE', label: 'SAMODE — Force Channel/User Modes', needsValue: 'Modes (e.g. +m, -o nick)' },
  { value: 'OMODE', command: 'OMODE', label: 'OMODE — Oper Channel Mode (Solanum)', needsValue: 'Modes (e.g. +m, -o nick)' },
  {
    value: 'SATOPIC',
    command: 'SATOPIC',
    label: 'SATOPIC — Force Channel Topic',
    needsChannel: true,
    needsValue: 'New Topic',
  },
  { value: 'SANICK', command: 'SANICK', label: 'SANICK — Force Nickname Change', needsValue: 'New Nickname' },
  { value: 'CHGHOST', command: 'CHGHOST', label: 'CHGHOST — Change User Hostname', needsValue: 'New Hostname' },
  { value: 'CHGIDENT', command: 'CHGIDENT', label: 'CHGIDENT — Change User Ident', needsValue: 'New Ident' },
  { value: 'CHGNAME', command: 'CHGNAME', label: 'CHGNAME — Change User Realname', needsValue: 'New Realname' },
  { value: 'SWHOIS', command: 'SWHOIS', label: 'SWHOIS — Set Extra WHOIS Line', needsValue: 'WHOIS text or - to clear' },
  { value: 'SETHOST', command: 'SETHOST', label: 'SETHOST — Change Own vHost', needsValue: 'New Hostname' },
  { value: 'SETIDENT', command: 'SETIDENT', label: 'SETIDENT — Change Own Ident', needsValue: 'New Ident' },
  { value: 'SETNAME', command: 'SETNAME', label: 'SETNAME — Change Own Realname (CAP setname)', needsValue: 'New Realname' },
];

export function getAvailableUserActions(ctx: CapabilityContext): UserActionSpec[] {
  return ALL_USER_ACTIONS.filter((a) => evaluateCommand(ctx, a.command).allowed);
}

const ALL_BROADCAST_TYPES: BroadcastTypeSpec[] = [
  { value: 'WALLOPS', command: 'WALLOPS', label: 'WALLOPS — Notice to +w users / opers' },
  { value: 'GLOBOPS', command: 'GLOBOPS', label: 'GLOBOPS — Global oper notice' },
  { value: 'OPERWALL', command: 'OPERWALL', label: 'OPERWALL — Oper wall notice (Solanum)' },
  { value: 'LOCOPS', command: 'LOCOPS', label: 'LOCOPS — Local server oper notice' },
  { value: 'CHATOPS', command: 'CHATOPS', label: 'CHATOPS — Oper chat channel broadcast' },
  { value: 'GLOBAL', command: 'GLOBAL', label: 'Global (Services) — Network-wide notice to all users' },
  { value: 'ADDMOTD', command: 'ADDMOTD', label: 'ADDMOTD — Append line to MOTD (UnrealIRCd)' },
  { value: 'ADDOMOTD', command: 'ADDOMOTD', label: 'ADDOMOTD — Append line to Oper MOTD (UnrealIRCd)' },
  { value: 'NPC', command: 'NPC', label: 'NPC — Ergo Roleplay NPC line' },
  { value: 'SCENE', command: 'SCENE', label: 'SCENE — Ergo Roleplay SCENE narration' },
  { value: 'AMBIENCE', command: 'AMBIENCE', label: 'AMBIENCE — Ergo Roleplay AMBIENCE message' },
];

export function getAvailableBroadcastTypes(ctx: CapabilityContext): BroadcastTypeSpec[] {
  return ALL_BROADCAST_TYPES.filter((b) => evaluateCommand(ctx, b.command).allowed);
}

export function supportsDefcon(ctx: CapabilityContext): { ergo: boolean; anope: boolean } {
  const svc = effectiveServicesFamily(ctx);
  return {
    ergo: evaluateCommand(ctx, 'DEFCON').allowed,
    anope:
      ctx.isGlobalOper &&
      svc === 'anope' &&
      ctx.profile.ircd !== 'ergo' &&
      !ctx.profile.absentServices.includes('operserv'),
  };
}

export function supportsAndKillFlag(ctx: CapabilityContext): boolean {
  return ctx.profile.ircd === 'ergo';
}

export function supportsRehashTlsFlag(ctx: CapabilityContext): boolean {
  return ctx.profile.ircd === 'unrealircd' && evaluateCommand(ctx, 'REHASH').allowed;
}

export function supportsServerRouting(ctx: CapabilityContext): boolean {
  return (
    ctx.profile.ircd !== 'ergo' &&
    evaluateCommand(ctx, 'CONNECT').allowed &&
    evaluateCommand(ctx, 'SQUIT').allowed
  );
}

export function getAvailableServices(ctx: CapabilityContext): string[] {
  const svc = effectiveServicesFamily(ctx);
  const abs = new Set(ctx.profile.absentServices);
  const candidates: string[] = [];

  if (svc === 'ergo') {
    for (const s of ['NickServ', 'ChanServ', 'HostServ']) {
      if (!abs.has(s.toLowerCase())) candidates.push(s);
    }
    return candidates;
  }

  if (svc === 'anope' || svc === 'atheme') {
    if (ctx.isGlobalOper && !abs.has('operserv')) candidates.push('OperServ');
    for (const s of ['NickServ', 'ChanServ', 'HostServ', 'MemoServ']) {
      if (!abs.has(s.toLowerCase())) candidates.push(s);
    }
    if (svc === 'anope' && !abs.has('botserv')) candidates.push('BotServ');
    return candidates;
  }

  // Fallback when unknown: only expose actually observed services
  for (const raw of ctx.profile.observedServices) {
    if (abs.has(raw)) continue;
    if (raw === 'operserv' && !ctx.isGlobalOper) continue;
    if (raw === 'global') continue;
    const titled = raw.replace(/serv$/, 'Serv').replace(/^(.)/, (m) => m.toUpperCase());
    if (!candidates.includes(titled)) candidates.push(titled);
  }
  return candidates;
}

export function getServicePresets(ctx: CapabilityContext, serviceName: string): string[] {
  const isErgo = ctx.profile.ircd === 'ergo';
  const svc = serviceName.toLowerCase();

  if (svc === 'operserv') {
    return [
      'HELP',
      'STATS ALL',
      'AKILL LIST',
      'AKILL ADD +7d ',
      'AKILL DEL ',
      'SQLINE LIST',
      'SZLINE LIST',
      'SNLINE LIST',
      'SGLINE LIST',
      'SESSION LIST',
      'EXCEPTION LIST',
      'OPER LIST',
      'JUPE ',
      'CHANKILL ',
      'DEFCON ',
      'RELOAD',
      'UPDATE',
      'LOGSEARCH ',
      'MODLOAD ',
      'MODUNLOAD ',
      'NOOP ',
    ];
  }

  if (svc === 'nickserv') {
    if (isErgo) {
      return [
        'HELP',
        'INFO ',
        'STATUS ',
        'IDENTIFY ',
        'REGISTER ',
        'GHOST ',
        'CERT LIST',
        ...(ctx.isOper ? ['SASET ', 'SUSPEND ', 'UNSUSPEND ', 'SAREGISTER ', 'SADROP '] : []),
      ];
    }
    return [
      'HELP',
      'INFO ',
      'LIST *',
      'STATUS ',
      'IDENTIFY ',
      'REGISTER ',
      'GHOST ',
      'RECOVER ',
      'CERT LIST',
      ...(ctx.isOper ? ['SAREGISTER ', 'SADROP ', 'SUSPEND ', 'UNSUSPEND ', 'SASET '] : []),
    ];
  }

  if (svc === 'chanserv') {
    if (isErgo) {
      return [
        'HELP',
        'INFO ',
        'OP ',
        'DEOP ',
        'AMODE ',
        'CLEAR ',
        ...(ctx.isOper ? ['SUSPEND ', 'UNSUSPEND ', 'PURGE '] : []),
      ];
    }
    return [
      'HELP',
      'INFO ',
      'LIST *',
      'OP ',
      'DEOP ',
      'ACCESS ',
      'AKICK ',
      'AMODE ',
      'SET ',
      'TOPIC ',
      'CLEAR ',
      ...(ctx.isOper ? ['SUSPEND ', 'UNSUSPEND ', 'FORBID ', 'DROP '] : []),
    ];
  }

  if (svc === 'hostserv') {
    if (isErgo) {
      return [
        'HELP',
        'STATUS ',
        'ON',
        'OFF',
        'REQUEST ',
        ...(ctx.isOper ? ['SET ', 'DEL ', 'WAITING'] : []),
      ];
    }
    return [
      'HELP',
      'ON',
      'OFF',
      'REQUEST ',
      ...(ctx.isOper ? ['SET ', 'SETALL ', 'DEL ', 'DELALL ', 'ACTIVATE ', 'REJECT ', 'WAITING', 'LIST'] : []),
    ];
  }

  if (svc === 'memoserv') return ['HELP', 'LIST', 'READ ', 'SEND ', 'DEL ', 'RSEND '];
  if (svc === 'botserv') return ['HELP', 'BOTLIST', 'ASSIGN ', 'UNASSIGN ', 'ACT ', 'SAY ', 'KICK '];
  return ['HELP'];
}

const ALL_QUICK_SERVER_CMDS: QuickServerCmdSpec[] = [
  { cmd: 'MAP', command: 'MAP', label: 'MAP' },
  { cmd: 'LINKS', command: 'LINKS', label: 'LINKS' },
  { cmd: 'LUSERS', command: 'LUSERS', label: 'LUSERS' },
  { cmd: 'STATS o', command: 'STATS', label: 'STATS o (Opers)' },
  { cmd: 'STATS c', command: 'STATS', label: 'STATS c (Links)' },
  { cmd: 'STATS u', command: 'STATS', label: 'STATS u (Uptime)' },
  { cmd: 'STATS g', command: 'GLINE', label: 'STATS g (GLINEs)' },
  { cmd: 'STATS s', command: 'SHUN', label: 'STATS s (Shuns)' },
  { cmd: 'STATS G', command: 'GZLINE', label: 'STATS G (GZLINEs)' },
  { cmd: 'STATS k', command: 'KLINE', label: 'STATS k (KLINEs)' },
  { cmd: 'STATS d', command: 'DLINE', label: 'STATS d (DLINEs)' },
  { cmd: 'UBAN LIST', command: 'UBAN', label: 'UBAN LIST (Ergo)' },
  { cmd: 'DEFCON', command: 'DEFCON', label: 'DEFCON Status (Ergo)' },
  { cmd: 'PRIVS', command: 'PRIVS', label: 'PRIVS (Solanum)' },
  { cmd: 'TRACE', command: 'TRACE', label: 'TRACE' },
  { cmd: 'MODULE list', command: 'MODULE', label: 'MODULE list' },
  { cmd: 'DNS', command: 'DNS', label: 'DNS stats' },
  { cmd: 'HELPOP', command: 'HELPOP', label: 'HELPOP' },
  { cmd: 'VERSION', command: 'VERSION', label: 'VERSION' },
];

export function getAvailableQuickServerCmds(ctx: CapabilityContext): QuickServerCmdSpec[] {
  return ALL_QUICK_SERVER_CMDS.filter((c) => {
    if (c.cmd === 'VERSION') return ctx.connected;
    if (ctx.profile.ircd === 'ergo' && (c.cmd === 'STATS c' || c.cmd === 'STATS k')) {
      // Ergo uses UBAN LIST for inspecting active bans, not STATS k / multi-server STATS c
      return false;
    }
    return evaluateCommand(ctx, c.command).allowed;
  });
}

const KNOWN_USER_MODES: Array<{ mode: string; label: string; operOnly?: boolean; requireCallerId?: boolean }> = [
  { mode: 'i', label: '+i Invisible' },
  { mode: 'w', label: '+w Receive Wallops' },
  { mode: 'Z', label: '+Z TLS-only PMs' },
  { mode: 'R', label: '+R Registered-only PMs' },
  { mode: 'g', label: '+g CallerID', requireCallerId: true },
  { mode: 'T', label: '+T Block CTCP' },
  { mode: 'p', label: '+p Hide Channels' },
  { mode: 's', label: '+s Server Notices (Snomask)', operOnly: true },
  { mode: 'H', label: '+H Hide Oper in WHOIS', operOnly: true },
  { mode: 'W', label: '+W WHOIS Notification', operOnly: true },
];

export function getConfigurableUserModes(ctx: CapabilityContext): UserModeToggleSpec[] {
  const avail = ctx.profile.availableUserModes;
  const modesKnown = ctx.profile.availableModesKnown;
  return KNOWN_USER_MODES.filter((spec) => {
    if (spec.operOnly && !ctx.isOper) return false;
    if (modesKnown && !avail.includes(spec.mode) && !ctx.userModes.includes(spec.mode)) {
      return false;
    }
    if (
      spec.requireCallerId &&
      ctx.profile.isupportKnown &&
      !('CALLERID' in ctx.profile.isupport) &&
      !avail.includes('g')
    ) {
      return false;
    }
    return true;
  });
}

export function supportsSnomaskEdit(ctx: CapabilityContext): boolean {
  if (!ctx.isOper) return false;
  if (ctx.userModes.includes('s')) return true;
  if (ctx.profile.availableModesKnown) return ctx.profile.availableUserModes.includes('s');
  return ctx.profile.ircd === 'unrealircd' || ctx.profile.ircd === 'ergo' || ctx.profile.ircd === 'inspircd';
}

export function formatServerSummary(ctx: CapabilityContext): {
  softwareLabel: string;
  servicesLabel: string;
  capsCount: number;
  capsList: string[];
  isupportHighlights: string[];
  modesLabel: string;
} {
  const { profile, caps, userModes } = ctx;
  const softwareNames: Record<IrcdFamily, string> = {
    unrealircd: 'UnrealIRCd',
    ergo: 'Ergo',
    inspircd: 'InspIRCd',
    solanum: 'Solanum',
    charybdis: 'Charybdis',
    hybrid: 'Hybrid',
    ircu: 'ircu',
    ngircd: 'ngIRCd',
    unknown: 'Unknown IRCd',
  };
  const servicesNames: Record<ServicesFamily, string> = {
    anope: 'Anope',
    atheme: 'Atheme',
    ergo: 'Ergo Built-in',
    none: 'No Services',
    unknown: 'Services Unknown',
  };

  const softwareLabel = profile.ircdVersion
    ? `${softwareNames[profile.ircd]} (${profile.ircdVersion})`
    : softwareNames[profile.ircd];

  const svc = effectiveServicesFamily(ctx);
  const servicesLabel = servicesNames[svc];
  const capsList = Array.from(caps).sort();

  const highlightKeys = ['NETWORK', 'PREFIX', 'EXTBAN', 'ELIST', 'CHATHISTORY', 'MONITOR', 'SAFERATE', 'CALLERID'];
  const isupportHighlights: string[] = [];
  for (const k of highlightKeys) {
    if (k in profile.isupport) {
      const v = profile.isupport[k];
      isupportHighlights.push(v === true ? k : `${k}=${v}`);
    }
  }

  return {
    softwareLabel,
    servicesLabel,
    capsCount: capsList.length,
    capsList,
    isupportHighlights,
    modesLabel: userModes ? `+${userModes}` : '(none)',
  };
}

const CHANNEL_BUFFER_ONLY_COMMANDS = new Set([
  'owner',
  'deowner',
  'protect',
  'deprotect',
  'op',
  'deop',
  'halfop',
  'dehalfop',
  'voice',
  'devoice',
  'kick',
  'ban',
  'unban',
  'kb',
  'kickban',
]);

/**
 * Filters a list of slash commands down to those permitted and supported in the
 * given CapabilityContext (software dialect, CAPs, user/oper modes, channel rank).
 */
export function getAvailableSlashCommands<T extends { name: string }>(
  commands: readonly T[],
  ctx: CapabilityContext,
  options?: { inChannel?: boolean },
): T[] {
  const inChannel =
    options?.inChannel ??
    (ctx.channelModes.length > 0 || Boolean(ctx.target && /^[#&]/.test(ctx.target)));
  return commands.filter((c) => {
    const low = c.name.toLowerCase();
    if (!inChannel && CHANNEL_BUFFER_ONLY_COMMANDS.has(low)) {
      return false;
    }
    if (low === 'oper' && !ctx.connected) {
      return false;
    }
    if (low === 'connect' && ctx.connected && (!ctx.isOper || !supportsServerRouting(ctx))) {
      return false;
    }
    return evaluateCommand(ctx, low).allowed;
  });
}
