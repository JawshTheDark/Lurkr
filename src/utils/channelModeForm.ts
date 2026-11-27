// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

// The channel modal's mode form (#727), as pure functions: which rows to draw
// from the network's modeSpec, and what MODE changes an edit amounts to.
//
// The form holds only the rows the user TOUCHED (a draft), never a copy of the
// channel's modes taken when it opened. Everything else reads the live state,
// and Save diffs the draft against the live state at that moment. So another
// op's change while the modal is open shows up, and Save never re-sends or
// reverts it — the stale-baseline bug obby's modal has.

import type { IrcdFamily } from '../lib/networkCapabilities';
import type { ModeSpec, OutgoingModeChange } from '../shared/channelModes.js';

export type ModeCategory = 'core' | 'extended' | 'unknown';
export type ModeScope = 'oper' | 'services' | 'server';

export interface ModeMeta {
  name: string | null;
  description: string;
  placeholder?: string;
  hint?: string;
  category: ModeCategory;
  scope?: ModeScope;
}

interface ModeDef {
  name: string;
  description: string;
  placeholder?: string;
  hint?: string;
  scope?: ModeScope;
}

const CORE_MODE_DEFS: Record<string, ModeDef> = {
  n: {
    name: 'No outside messages',
    description: 'Only joined members can send messages to the channel.',
  },
  t: {
    name: 'Operator topic lock',
    description: 'Restricts changing the channel topic to channel operators.',
  },
  i: {
    name: 'Invite only',
    description: 'Requires an /INVITE or invite exception (+I) to join.',
  },
  m: {
    name: 'Moderated',
    description: 'Only voiced (+v) and privileged members can speak.',
  },
  s: {
    name: 'Secret',
    description: 'Hides the channel from /LIST, /WHO, and /WHOIS for outsiders.',
  },
  p: {
    name: 'Private',
    description: 'Disables /KNOCK and omits this channel from outsider /WHOIS.',
  },
  k: {
    name: 'Channel key',
    description: 'Requires a shared password parameter on /JOIN.',
    placeholder: 'channel key',
    hint: 'Shared join password',
  },
  l: {
    name: 'User limit',
    description: 'Caps the maximum number of concurrent members.',
    placeholder: 'max users',
    hint: 'Positive integer, e.g. 50',
  },
};

const SOLANUM_CHARYBDIS_DEFS: Record<string, ModeDef> = {
  B: {
    name: 'Restrict bots',
    description: 'Blocks bot-flagged clients (+B) unless exempt (+I) or voiced/opped.',
  },
  C: {
    name: 'Block CTCPs',
    description: 'Disallows CTCP commands in the channel except /me actions.',
  },
  c: {
    name: 'Color filter',
    description: 'Strips mIRC color, bold, underline, and formatting codes.',
  },
  f: {
    name: 'Channel forward',
    description: 'Forwards rejected joins (+i, +j, +l, +r, +S) to another channel.',
    placeholder: '#channel',
    hint: 'Target channel, e.g. #overflow',
  },
  F: {
    name: 'Enable forwarding',
    description: 'Allows operators of other channels to forward users here via +f.',
  },
  g: {
    name: 'Free invite',
    description: 'Allows any channel member to /INVITE users, even under +i.',
  },
  j: {
    name: 'Join throttle',
    description: 'Limits join bursts to n users per t seconds.',
    placeholder: 'joins:secs',
    hint: 'count:seconds, e.g. 3:10',
  },
  L: {
    name: 'Large ban list',
    description: 'Raises the maximum +beIq list entry limit for this channel.',
    scope: 'oper',
  },
  M: {
    name: 'Protect operators',
    description: 'Prevents IRC operators from being kicked from the channel.',
    scope: 'oper',
  },
  O: {
    name: 'IRC operators only',
    description: 'Restricts channel joining exclusively to IRC operators.',
    scope: 'oper',
  },
  A: {
    name: 'Server admins only',
    description: 'Restricts channel joining exclusively to server administrators.',
    scope: 'oper',
  },
  P: {
    name: 'Permanent channel',
    description: 'Keeps the channel alive when the last member parts.',
    scope: 'oper',
  },
  Q: {
    name: 'Block forwarding',
    description: 'Prevents other channels from forwarding users here via +f.',
  },
  r: {
    name: 'Block unidentified',
    description: 'Prevents users not identified to a services account from joining.',
  },
  R: {
    name: 'Silence unidentified',
    description: 'Blocks messages from users who are not identified to services.',
  },
  S: {
    name: 'TLS connections only',
    description: 'Only users connected over SSL/TLS may join the channel.',
  },
  T: {
    name: 'Block notices',
    description: 'Blocks /NOTICE messages sent to the channel.',
  },
  u: {
    name: 'Unfiltered',
    description: 'Delivers messages normally suppressed by server spam filtering.',
  },
  z: {
    name: 'Reduced moderation',
    description: 'Routes messages blocked by +m, +b, +q, or +R to channel ops instead.',
  },
};

const UNREALIRCD_DEFS: Record<string, ModeDef> = {
  A: {
    name: 'Server admins only',
    description: 'Restricts entry to server and network administrators.',
    scope: 'oper',
  },
  c: {
    name: 'Block colors',
    description: 'Rejects messages containing mIRC or ANSI color codes.',
  },
  C: {
    name: 'Block CTCPs',
    description: 'Disallows CTCP commands sent to the channel (except /me).',
  },
  D: {
    name: 'Delayed joins',
    description: 'Hides JOIN messages until the user speaks or receives status.',
  },
  d: {
    name: 'Has delayed users',
    description: 'Temporary server flag while hidden +D users are still present.',
    scope: 'server',
  },
  f: {
    name: 'Flood protection',
    description: 'Detailed anti-flood rules for lines, joins, CTCPs, or nick changes.',
    placeholder: '[lines:type]:secs',
    hint: 'e.g. [5t#b]:3',
  },
  F: {
    name: 'Flood profile',
    description: 'Selects a named server anti-flood protection profile.',
    placeholder: 'profile',
    hint: 'Predefined profile name, e.g. normal',
  },
  G: {
    name: 'Filter profanity',
    description: 'Censors configured bad words from channel messages.',
  },
  H: {
    name: 'Channel history',
    description: 'Replays recent channel messages to newly joined users.',
    placeholder: 'lines:duration',
    hint: 'e.g. 50:24h',
  },
  K: {
    name: 'No /KNOCK',
    description: 'Disables the /KNOCK command on this channel.',
  },
  L: {
    name: 'Channel link',
    description: 'Redirects failed joins (+l, +i, +R, +z) to another channel.',
    placeholder: '#channel',
    hint: 'Fallback channel, e.g. #overflow',
  },
  M: {
    name: 'Registered only speak',
    description: 'Only authenticated or voiced/opped users can send messages.',
  },
  N: {
    name: 'No nick changes',
    description: 'Prevents members from changing nicks while in the channel.',
  },
  O: {
    name: 'IRC operators only',
    description: 'Restricts channel entry to IRC operators only.',
    scope: 'oper',
  },
  P: {
    name: 'Permanent channel',
    description: 'Preserves the channel and its settings when empty.',
    scope: 'oper',
  },
  Q: {
    name: 'No kicks',
    description: 'Disallows /KICK in the channel (services bypass).',
  },
  r: {
    name: 'Registered channel',
    description: 'Marks that this channel is registered with network services.',
    scope: 'services',
  },
  R: {
    name: 'Registered users only',
    description: 'Only users authenticated to network services may join.',
  },
  S: {
    name: 'Strip colors',
    description: 'Strips mIRC and ANSI formatting codes into plain text.',
  },
  T: {
    name: 'No notices',
    description: 'Blocks /NOTICE messages sent to the channel.',
  },
  u: {
    name: 'Auditorium',
    description: 'Hides non-op members from /NAMES and /WHO queries.',
  },
  V: {
    name: 'No /INVITE',
    description: 'Prevents channel members from inviting other users.',
  },
  z: {
    name: 'TLS connections only',
    description: 'Requires members to connect over SSL/TLS to join.',
  },
  Z: {
    name: 'All members via TLS',
    description: 'Server flag indicating all current members use SSL/TLS.',
    scope: 'server',
  },
};

const INSPIRCD_DEFS: Record<string, ModeDef> = {
  A: {
    name: 'Allow invites',
    description: 'Lets any member use /INVITE even when +i is set.',
  },
  B: {
    name: 'Block ALL CAPS',
    description: 'Blocks messages with excessive uppercase characters.',
  },
  c: {
    name: 'Block colors',
    description: 'Rejects messages containing mIRC color or formatting codes.',
  },
  C: {
    name: 'Block CTCPs',
    description: 'Blocks CTCP messages to the channel (except /me actions).',
  },
  d: {
    name: 'Delay messages',
    description: 'Requires new joins to wait N seconds before speaking.',
    placeholder: 'seconds',
    hint: 'Wait in seconds, e.g. 10',
  },
  D: {
    name: 'Delayed joins',
    description: 'Hides joins until a member speaks or gains status.',
  },
  f: {
    name: 'Message flood',
    description: 'Limits message frequency to prevent channel text flooding.',
    placeholder: 'lines:secs',
    hint: 'e.g. *5:3 or 5:3',
  },
  F: {
    name: 'Nick flood',
    description: 'Limits how frequently members can change nicknames.',
    placeholder: 'changes:secs',
    hint: 'e.g. 3:60',
  },
  g: {
    name: 'Keyword filter',
    description: 'Blocks messages matching configured channel filter patterns.',
    placeholder: 'pattern',
    hint: 'Blocked word or glob mask',
  },
  G: {
    name: 'Censor bad words',
    description: 'Filters or replaces configured profanity words.',
  },
  H: {
    name: 'Channel history',
    description: 'Replays recent channel history to joining users.',
    placeholder: 'lines:duration',
    hint: 'e.g. 50:1d',
  },
  j: {
    name: 'Join flood',
    description: 'Limits rapid channel joins per time interval.',
    placeholder: 'joins:secs',
    hint: 'e.g. 5:10',
  },
  J: {
    name: 'Kick rejoin cooldown',
    description: 'Blocks kicked users from rejoining for N seconds.',
    placeholder: 'seconds',
    hint: 'Cooldown in seconds, e.g. 30',
  },
  K: {
    name: 'No /KNOCK',
    description: 'Disables the /KNOCK command on this channel.',
  },
  L: {
    name: 'Redirect on full',
    description: 'Forwards overflow joins when +l user limit is reached.',
    placeholder: '#channel',
    hint: 'Target channel, e.g. #overflow',
  },
  M: {
    name: 'Registered only speak',
    description: 'Unregistered users cannot speak unless voiced or opped.',
  },
  N: {
    name: 'No nick changes',
    description: 'Disallows changing nicknames while inside the channel.',
  },
  O: {
    name: 'IRC operators only',
    description: 'Restricts joining exclusively to IRC operators.',
    scope: 'oper',
  },
  P: {
    name: 'Permanent channel',
    description: 'Prevents the channel from being destroyed when empty.',
    scope: 'oper',
  },
  Q: {
    name: 'Peace / no kicks',
    description: 'Blocks normal operator kicks (only U:Lines/services can kick).',
  },
  r: {
    name: 'Registered channel',
    description: 'Indicates this channel is registered with services.',
    scope: 'services',
  },
  R: {
    name: 'Registered users only',
    description: 'Only users authenticated to services can join.',
  },
  S: {
    name: 'Strip colors',
    description: 'Strips mIRC color and formatting codes from messages.',
  },
  T: {
    name: 'No notices',
    description: 'Blocks /NOTICE messages sent to the channel.',
  },
  u: {
    name: 'Auditorium',
    description: 'Hides non-operator members from /NAMES and /WHO.',
  },
  w: {
    name: 'Auto access',
    description: 'Automatically applies a prefix mode to matching join masks.',
    placeholder: 'flag:mask',
    hint: 'e.g. o:*!*@trusted.host',
  },
  X: {
    name: 'Op exemptions',
    description: 'Exempts a privilege rank from specified channel modes.',
    placeholder: 'flag:restriction',
  },
  z: {
    name: 'TLS connections only',
    description: 'Only users connected over SSL/TLS can join the channel.',
  },
  Z: {
    name: 'Named modes',
    description: 'Enables long-form named mode references in the channel.',
  },
};

const ERGO_DEFS: Record<string, ModeDef> = {
  C: {
    name: 'Block CTCPs',
    description: 'Disallows CTCP commands in the channel (except /me actions).',
  },
  E: {
    name: 'Roleplay commands',
    description: 'Enables /NPC and /SCENE roleplay commands in the channel.',
  },
  f: {
    name: 'Channel forward',
    description: 'Forwards rejected joins to another channel.',
    placeholder: '#channel',
    hint: 'Target channel, e.g. #overflow',
  },
  M: {
    name: 'Registered only speak',
    description: 'Requires an authenticated account to speak in the channel.',
  },
  R: {
    name: 'Registered users only',
    description: 'Only users logged into a services account may join.',
  },
  u: {
    name: 'Auditorium',
    description: 'Limits member visibility in /NAMES and /WHO to channel staff.',
  },
  U: {
    name: 'Op-moderated',
    description: 'Routes messages blocked by +m/+M or muted bans (m:) to ops only.',
  },
  c: {
    name: 'Color filter',
    description: 'Strips mIRC color and formatting codes from messages.',
  },
  j: {
    name: 'Join throttle',
    description: 'Limits rapid channel joins per time window.',
    placeholder: 'joins:secs',
    hint: 'count:seconds, e.g. 3:10',
  },
};

const HYBRID_DEFS: Record<string, ModeDef> = {
  c: {
    name: 'No control codes',
    description: 'Blocks or strips color and formatting control codes.',
  },
  C: {
    name: 'Block CTCPs',
    description: 'Disallows CTCP commands sent to the channel.',
  },
  g: {
    name: 'Free invite',
    description: 'Allows any member to invite other users into the channel.',
  },
  M: {
    name: 'Registered only speak',
    description: 'Requires users to be identified with services to speak.',
  },
  O: {
    name: 'IRC operators only',
    description: 'Restricts joining exclusively to IRC operators.',
    scope: 'oper',
  },
  r: {
    name: 'Registered channel',
    description: 'Marks that this channel is registered with services.',
    scope: 'services',
  },
  R: {
    name: 'Registered users only',
    description: 'Only users identified to services may join.',
  },
  S: {
    name: 'TLS connections only',
    description: 'Requires SSL/TLS connections to join the channel.',
  },
  z: {
    name: 'Reduced moderation',
    description: 'Forwards blocked messages under +m/+b/+q to channel ops.',
  },
};

const NGIRCD_DEFS: Record<string, ModeDef> = {
  M: {
    name: 'Registered only speak',
    description: 'Only registered/identified users or ops may send messages.',
  },
  O: {
    name: 'IRC operators only',
    description: 'Restricts joining to IRC operators only.',
    scope: 'oper',
  },
  P: {
    name: 'Permanent channel',
    description: 'Keeps the channel persistent even when empty.',
    scope: 'oper',
  },
  Q: {
    name: 'No kicks',
    description: 'Disallows kicking members from the channel.',
  },
  r: {
    name: 'Registered channel',
    description: 'Indicates this channel is registered.',
    scope: 'services',
  },
  R: {
    name: 'Registered users only',
    description: 'Only registered users may join this channel.',
  },
  V: {
    name: 'No /INVITE',
    description: 'Prevents channel members from inviting others.',
  },
  z: {
    name: 'TLS connections only',
    description: 'Only users connected via SSL/TLS may join.',
  },
};

const IRCU_DEFS: Record<string, ModeDef> = {
  c: {
    name: 'No colors',
    description: 'Blocks or strips mIRC color codes from channel messages.',
  },
  C: {
    name: 'Block CTCPs',
    description: 'Disallows CTCP commands to the channel (except /me).',
  },
  D: {
    name: 'Delayed joins',
    description: 'Hides JOIN messages until users speak or receive status.',
  },
  d: {
    name: 'Has delayed users',
    description: 'Server flag while delayed hidden members remain in the channel.',
    scope: 'server',
  },
  M: {
    name: 'Registered only speak',
    description: 'Requires account authentication to speak in the channel.',
  },
  r: {
    name: 'Registered users only',
    description: 'Requires account authentication to join the channel.',
  },
  R: {
    name: 'Registered users only',
    description: 'Only account-authenticated users may join.',
  },
  u: {
    name: 'No quit/part text',
    description: 'Suppresses custom PART and QUIT messages.',
  },
};

const UNKNOWN_COMMON_DEFS: Record<string, ModeDef> = {
  c: {
    name: 'No colors / formatting',
    description: 'Blocks or strips mIRC color and formatting codes.',
  },
  C: {
    name: 'Block CTCPs',
    description: 'Blocks CTCP commands sent to the channel (except /me).',
  },
  D: {
    name: 'Delayed joins',
    description: 'Hides user joins until they speak or gain channel status.',
  },
  H: {
    name: 'Channel history',
    description: 'Replays recent history lines to newly joined users.',
    placeholder: 'lines:duration',
  },
  j: {
    name: 'Join throttle',
    description: 'Rate-limits rapid channel joins per time interval.',
    placeholder: 'joins:secs',
  },
  K: {
    name: 'No /KNOCK',
    description: 'Disables the /KNOCK command on this channel.',
  },
  N: {
    name: 'No nick changes',
    description: 'Prevents nickname changes while in the channel.',
  },
  O: {
    name: 'IRC operators only',
    description: 'Restricts joining exclusively to IRC operators.',
    scope: 'oper',
  },
  P: {
    name: 'Permanent channel',
    description: 'Preserves the channel when all users leave.',
    scope: 'oper',
  },
  T: {
    name: 'Block notices',
    description: 'Disallows /NOTICE messages sent to the channel.',
  },
};

const IRCD_MAP: Record<IrcdFamily, Record<string, ModeDef>> = {
  solanum: SOLANUM_CHARYBDIS_DEFS,
  charybdis: SOLANUM_CHARYBDIS_DEFS,
  unrealircd: UNREALIRCD_DEFS,
  inspircd: INSPIRCD_DEFS,
  ergo: ERGO_DEFS,
  hybrid: HYBRID_DEFS,
  ngircd: NGIRCD_DEFS,
  ircu: IRCU_DEFS,
  unknown: UNKNOWN_COMMON_DEFS,
};

/** Describe a single channel mode letter using the detected IRCd family. */
export function describeModeMeta(letter: string, ircd: IrcdFamily = 'unknown'): ModeMeta {
  if (Object.hasOwn(CORE_MODE_DEFS, letter)) {
    return { ...CORE_MODE_DEFS[letter], category: 'core' };
  }
  const familyMap = IRCD_MAP[ircd] ?? UNKNOWN_COMMON_DEFS;
  if (Object.hasOwn(familyMap, letter)) {
    return { ...familyMap[letter], category: 'extended' };
  }
  return {
    name: null,
    description: 'Server-specific channel mode advertised in ISUPPORT CHANMODES.',
    category: 'unknown',
  };
}

/** A list mode's tab label, for the letters the server can fetch. */
export const LIST_NAMES: Record<string, string> = {
  b: 'Bans',
  e: 'Exceptions',
  I: 'Invites',
  q: 'Quiets',
};

export interface ExtbanHint {
  prefix: string;
  label: string;
  example: string;
}

export interface ListModeInfo {
  letter: string;
  label: string;
  description: string;
  maskPlaceholder: string;
  maxEntries: number | null;
  extbanHints: ExtbanHint[];
}

export function parseMaxListForMode(
  maxListToken: string | true | undefined,
  letter: string,
): number | null {
  if (typeof maxListToken !== 'string' || !maxListToken) return null;
  for (const part of maxListToken.split(',')) {
    const [letters, countRaw] = part.split(':');
    if (letters && countRaw && letters.includes(letter)) {
      const n = Number.parseInt(countRaw, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

export function listExtbanHints(
  ircd: IrcdFamily,
  extbanToken: string | true | undefined,
  letter: string,
): ExtbanHint[] {
  if (letter === 'I' && ircd === 'ergo') return [];
  const raw = typeof extbanToken === 'string' ? extbanToken : '';
  const [prefixPart, typesPart = ''] = raw.split(',', 2);
  const hints: ExtbanHint[] = [];

  if (ircd === 'solanum' || ircd === 'charybdis' || prefixPart === '$') {
    const allowed = typesPart || 'agjrxz';
    if (allowed.includes('a')) {
      hints.push({ prefix: '$a:', label: 'Account name', example: '$a:alice' });
    }
    if (allowed.includes('r')) {
      hints.push({ prefix: '$r:', label: 'Realname / gecos', example: '$r:*bot*' });
    }
    if (allowed.includes('x')) {
      hints.push({ prefix: '$x:', label: 'Full n!u@h#gecos', example: '$x:*!*@*#spam*' });
    }
    if (allowed.includes('j') && (letter === 'b' || letter === 'q' || letter === 'e')) {
      hints.push({ prefix: '$j:', label: 'Banned in channel', example: '$j:#other' });
    }
    if (allowed.includes('z')) {
      hints.push({ prefix: '$z', label: 'TLS-connected clients', example: '$z' });
    }
    if (allowed.includes('g')) {
      hints.push({ prefix: '$g:', label: 'Unidentified guests', example: '$g:*!*@*.isp.net' });
    }
    return hints;
  }

  if (ircd === 'ergo') {
    if (letter === 'b') {
      hints.push({ prefix: 'm:', label: 'Mute mask (speak/nick only)', example: 'm:*!*@host' });
    }
    return hints;
  }

  if (ircd === 'unrealircd' || prefixPart === '~') {
    hints.push({ prefix: '~account:', label: 'Account name', example: '~account:alice' });
    if (letter === 'b') {
      hints.push({ prefix: '~quiet:', label: 'Mute without kick/ban', example: '~quiet:*!*@host' });
    }
    hints.push({ prefix: '~realname:', label: 'Realname / gecos', example: '~realname:*bot*' });
    hints.push({ prefix: '~certfp:', label: 'TLS cert fingerprint', example: '~certfp:sha256...' });
    return hints;
  }

  if (ircd === 'inspircd') {
    if (!typesPart || typesPart.includes('R')) {
      hints.push({ prefix: 'R:', label: 'Services account', example: 'R:alice' });
    }
    if ((!typesPart || typesPart.includes('m')) && letter === 'b') {
      hints.push({ prefix: 'm:', label: 'Mute mask', example: 'm:*!*@host' });
    }
    if (!typesPart || typesPart.includes('r')) {
      hints.push({ prefix: 'r:', label: 'Realname / gecos', example: 'r:*bot*' });
    }
    if ((!typesPart || typesPart.includes('j')) && (letter === 'b' || letter === 'e')) {
      hints.push({ prefix: 'j:', label: 'In channel', example: 'j:#other' });
    }
    return hints;
  }

  return hints;
}

export function describeListMode(
  letter: string,
  ircd: IrcdFamily = 'unknown',
  isupport?: Record<string, string | true>,
): ListModeInfo {
  const label = LIST_NAMES[letter] ?? `Mode +${letter}`;
  let description = `Entries matching +${letter} masks.`;
  if (letter === 'b') {
    description =
      ircd === 'ergo'
        ? 'Prevents matching masks from joining or speaking. Prefix m: mutes without kicking.'
        : 'Prevents matching nick!user@host masks (or extbans) from joining or speaking.';
  } else if (letter === 'e') {
    description =
      ircd === 'solanum' || ircd === 'charybdis'
        ? 'Exempts matching masks from both channel bans (+b) and quiets (+q).'
        : 'Exempts matching masks from channel bans (+b).';
  } else if (letter === 'I') {
    description =
      ircd === 'solanum' || ircd === 'charybdis'
        ? 'Allows matching masks to join without an /INVITE when +i or +r is set.'
        : 'Allows matching masks to join an invite-only (+i) channel without an /INVITE.';
  } else if (letter === 'q') {
    description =
      'Mutes matching users so they stay in the channel but cannot speak or change nicks.';
  }

  return {
    letter,
    label,
    description,
    maskPlaceholder:
      ircd === 'solanum' || ircd === 'charybdis'
        ? 'nick!user@host or $a:account'
        : ircd === 'unrealircd'
          ? 'nick!user@host or ~account:name'
          : ircd === 'ergo' && letter === 'b'
            ? 'nick!user@host or m:mask'
            : 'nick!user@host',
    maxEntries: parseMaxListForMode(isupport?.MAXLIST, letter),
    extbanHints: listExtbanHints(ircd, isupport?.EXTBAN, letter),
  };
}

export function modeName(letter: string, ircd: IrcdFamily = 'unknown'): string | null {
  return describeModeMeta(letter, ircd).name;
}

/** How a row is edited. */
export type RowKind = 'flag' | 'param' | 'key';

export interface ModeRow {
  letter: string;
  kind: RowKind;
  name: string | null;
  description: string;
  placeholder?: string;
  hint?: string;
  category: ModeCategory;
  scope?: ModeScope;
}

/**
 * The rows to draw: every flag and param mode the network advertises, core and
 * recognized software modes first. List modes have their own tabs, and prefix
 * modes are people, not the channel.
 */
export function modeRows(spec: ModeSpec, ircd: IrcdFamily = 'unknown'): ModeRow[] {
  const rows: ModeRow[] = [];
  for (const letter of spec.flags) {
    const meta = describeModeMeta(letter, ircd);
    rows.push({ letter, kind: 'flag', ...meta });
  }
  for (const letter of spec.always + spec.onSet) {
    const meta = describeModeMeta(letter, ircd);
    rows.push({ letter, kind: letter === 'k' ? 'key' : 'param', ...meta });
  }
  return rows.toSorted((a, b) => categoryOrder(a) - categoryOrder(b));
}

function categoryOrder(row: ModeRow): number {
  if (row.category === 'core') {
    return Object.keys(CORE_MODE_DEFS).indexOf(row.letter);
  }
  if (row.category === 'extended') return 100;
  return 200;
}

/** One row as the user left it. For the key, '' or the current key keeps it. */
export interface DraftRow {
  on: boolean;
  value: string;
}

export interface LiveModes {
  /** Every set letter, e.g. 'ntkl'. */
  modes: string;
  /** Values of set param modes. The server never sends the key; the modal puts
   *  the one we joined with here once it has fetched it, so an untouched key
   *  field reads as "keep". */
  params: Record<string, string>;
}

export function liveRow(live: LiveModes, letter: string): DraftRow {
  return { on: live.modes.includes(letter), value: live.params[letter] ?? '' };
}

/**
 * The MODE changes that turn the live state into the draft, or the first
 * problem that stops it. Rows the draft left alone are not looked at.
 */
export function modeChanges(
  spec: ModeSpec,
  live: LiveModes,
  draft: Record<string, DraftRow>,
): { changes: OutgoingModeChange[] } | { error: string } {
  const changes: OutgoingModeChange[] = [];
  const kindOf = new Map(modeRows(spec).map((r) => [r.letter, r.kind]));
  for (const [letter, want] of Object.entries(draft)) {
    const kind = kindOf.get(letter);
    if (!kind) continue;
    const was = liveRow(live, letter);
    const value = want.value.trim();
    if (kind === 'flag') {
      if (want.on !== was.on) changes.push({ sign: want.on ? '+' : '-', letter });
      continue;
    }
    if (!want.on) {
      if (!was.on) continue;
      // A B-group mode names its value to unset it (`*` when we never learned
      // it); the server fills in -k's.
      const needsParam = spec.always.includes(letter) && kind !== 'key';
      changes.push(
        needsParam ? { sign: '-', letter, param: was.value || '*' } : { sign: '-', letter },
      );
      continue;
    }
    // Only now: a value being turned off doesn't need to be a valid one.
    if (/\s/.test(value)) return { error: `+${letter} can't contain spaces` };
    if (kind === 'key') {
      if (!value) {
        if (!was.on) return { error: 'Enter a key' };
        continue; // on, and no new key: keep the one it has
      }
      if (was.on && value === was.value) continue;
      // Replacing a key: several ircds answer a bare +k over an existing one
      // with 467, so take the old one off first.
      if (was.on) changes.push({ sign: '-', letter });
      changes.push({ sign: '+', letter, param: value });
      continue;
    }
    if (!value) return { error: `Enter a value for +${letter}` };
    if (!was.on || value !== was.value) changes.push({ sign: '+', letter, param: value });
  }
  return { changes };
}

/** A topic's length as the server counts it: bytes, not characters. */
export function topicBytes(topic: string): number {
  return new TextEncoder().encode(topic).length;
}
