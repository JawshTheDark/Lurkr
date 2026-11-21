// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import type { Alias } from '../../shared/aliases';
import type { SlashCommandDef } from './oper';

export interface UsagePart {
  readonly text: string;
  readonly active: boolean;
}

export interface UsageHint {
  readonly verb: string;
  readonly parts: readonly UsagePart[];
  readonly description: string;
}

const REST_ARG_NAMES = new Set([
  'reason',
  'message',
  'msg',
  'action',
  'text',
  'new topic',
  'topic',
  'command',
  'commands',
  'commands...',
  'line',
  'value',
  'pattern',
  'args',
  'packs',
]);

/**
 * Extract the slash-command verb once at least one whitespace follows it.
 * Returns null while still typing `/verb`, for `//escaped` text, or multiline input.
 */
export function usageVerb(value: string): string | null {
  if (!value || value[0] !== '/' || value[1] === '/' || value.includes('\n')) return null;
  const m = /^\/(\S+)\s/.exec(value);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Split a command `args` string on whitespace only at top-level bracket depth
 * so tokens like `[new topic]` or `[list|add <nick> [pattern]]` stay intact.
 */
export function tokenizeArgsSpec(argsSpec: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < argsSpec.length; i++) {
    const ch = argsSpec[i];
    if (ch === '<' || ch === '[') {
      depth += 1;
      current += ch;
    } else if (ch === '>' || ch === ']') {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (/\s/.test(ch) && depth === 0) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function isRestArgToken(token: string): boolean {
  if (token.includes('...')) return true;
  const inner = token.replace(/^[<\[]+|[>\]]+$/g, '').trim().toLowerCase();
  return REST_ARG_NAMES.has(inner);
}

interface ParsedTypedArgs {
  tokenIndex: number;
  activeTokenText: string;
  tokenCount: number;
}

function parseTypedArgsAtCaret(value: string, verbEnd: number, caret: number): ParsedTypedArgs {
  const after = value.slice(verbEnd, Math.max(verbEnd, Math.min(value.length, caret)));
  const tokens: Array<{ text: string; start: number; end: number }> = [];
  let i = 0;
  while (i < after.length) {
    while (i < after.length && /\s/.test(after[i])) i++;
    if (i >= after.length) break;
    const start = verbEnd + i;
    let tok = '';
    while (i < after.length && !/\s/.test(after[i])) {
      tok += after[i];
      i++;
    }
    tokens.push({ text: tok, start, end: verbEnd + i });
  }

  // Since slice ends at `caret`, if the final char before `caret` is whitespace,
  // the user is starting a new argument after `tokens.length` completed tokens.
  const trailingSpace = after.length > 0 && /\s/.test(after[after.length - 1]);
  if (trailingSpace || tokens.length === 0) {
    return {
      tokenIndex: tokens.length,
      activeTokenText: '',
      tokenCount: tokens.length,
    };
  }

  return {
    tokenIndex: tokens.length - 1,
    activeTokenText: tokens[tokens.length - 1].text,
    tokenCount: tokens.length,
  };
}

/**
 * Compute the persistent slash-command usage line and active argument slot
 * for the current composer input and caret position (#1369).
 */
export function usageHint(
  value: string,
  caret: number,
  availableCommands: readonly SlashCommandDef[],
  aliases: readonly Alias[] = [],
  isServerBuffer = false,
): UsageHint | null {
  if (!value || value[0] !== '/' || value[1] === '/' || value.includes('\n')) return null;
  const clampedCaret = Math.max(0, Math.min(value.length, caret));

  let verbEnd = 1;
  while (verbEnd < value.length && !/\s/.test(value[verbEnd])) verbEnd++;

  // Still typing the command name (or no trailing space yet): dropdown lists matching commands.
  if (verbEnd >= value.length || clampedCaret <= verbEnd) return null;

  const typedVerb = value.slice(1, verbEnd).toLowerCase();
  if (!typedVerb) return null;

  let displayVerb = typedVerb;
  let preArgsCount = 0;
  const matchedAlias = aliases.find((a) => a.name.toLowerCase() === typedVerb);
  if (matchedAlias) {
    const bodyTrimmed = matchedAlias.body.trim();
    if (!bodyTrimmed.startsWith('/')) {
      return {
        verb: typedVerb,
        parts: [{ text: `/${typedVerb}`, active: false }],
        description: `Alias → ${matchedAlias.body}`,
      };
    }
    const firstCmd = bodyTrimmed.split(';')[0].trim();
    const parts = firstCmd.split(/\s+/);
    displayVerb = parts[0].slice(1).toLowerCase();
    preArgsCount = Math.max(0, parts.length - 1);
  }

  const def = availableCommands.find((c) => c.name.toLowerCase() === displayVerb);
  if (!def) {
    // Unknown command or unavailable in server buffer (e.g. channel-only command on :server:).
    void isServerBuffer;
    return null;
  }

  const argTokens = def.args.trim() ? tokenizeArgsSpec(def.args.trim()) : [];
  if (argTokens.length === 0) {
    return {
      verb: typedVerb,
      parts: [{ text: `/${displayVerb}`, active: false }],
      description: def.description,
    };
  }

  const parsed = parseTypedArgsAtCaret(value, verbEnd, clampedCaret);
  const slotIdx = parsed.tokenIndex + preArgsCount;

  // Match typed flag or positional argument slot cleanly.
  let activeArgIdx = -1;
  if (slotIdx < argTokens.length) {
    activeArgIdx = slotIdx;
  } else if (isRestArgToken(argTokens[argTokens.length - 1])) {
    activeArgIdx = argTokens.length - 1;
  }

  // Special handling when typing an optional leading -flag (e.g. `-secure`)
  const activeWord = parsed.activeTokenText;
  if (
    activeWord.startsWith('-') &&
    activeArgIdx !== -1 &&
    !argTokens[activeArgIdx].includes(activeWord)
  ) {
    const flagSlot = argTokens.findIndex((tok) => tok.startsWith('[-') && tok.includes(activeWord));
    if (flagSlot !== -1) activeArgIdx = flagSlot;
  }

  return {
    verb: typedVerb,
    parts: [
      { text: `/${displayVerb}`, active: false },
      ...argTokens.map((tok, i) => ({
        text: tok,
        active: i === activeArgIdx,
      })),
    ],
    description: def.description,
  };
}
