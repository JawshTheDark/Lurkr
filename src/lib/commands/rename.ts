// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

// `/rename`: rename a channel (IRCv3 draft/channel-rename, #858).

import { isChannelTarget } from '../../shared/channels';

export const RENAME_USAGE = 'usage: /rename [#chan] <#newname> [reason]';

export type RenameCommand = { line: string } | { error: string };

export function parseRename(
  rest: readonly string[],
  target: string,
  hasBuffer: (name: string) => boolean,
): RenameCommand {
  let from: string;
  let to: string | undefined;
  let reason: string;
  if (isChannelTarget(rest[0]) && isChannelTarget(rest[1]) && hasBuffer(rest[0])) {
    from = rest[0];
    to = rest[1];
    reason = rest.slice(2).join(' ');
  } else {
    from = target;
    to = rest[0];
    reason = rest.slice(1).join(' ');
  }
  if (!to) return { error: RENAME_USAGE };
  if (!isChannelTarget(to)) {
    return { error: `${RENAME_USAGE} — ${to} is not a channel name` };
  }
  if (!isChannelTarget(from)) {
    return { error: `${RENAME_USAGE} — name the channel, or run it inside one` };
  }
  if (to.includes(',') || from.includes(',')) {
    return { error: `${RENAME_USAGE} — a channel name cannot hold a comma` };
  }
  return { line: `RENAME ${from} ${to}${reason ? ` :${reason}` : ''}` };
}
