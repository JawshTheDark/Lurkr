// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { parseIrcFormatting } from './nickColor';

export const IRC_BOLD = '\x02';
export const IRC_COLOR = '\x03';
export const IRC_RESET = '\x0f';
export const IRC_REVERSE = '\x16';
export const IRC_ITALIC = '\x1d';
export const IRC_STRIKE = '\x1e';
export const IRC_UNDERLINE = '\x1f';

export const MIRC_COLOR_NAMES: readonly string[] = [
  'White',
  'Black',
  'Navy',
  'Green',
  'Red',
  'Maroon',
  'Purple',
  'Orange',
  'Yellow',
  'Light Green',
  'Teal',
  'Cyan',
  'Royal Blue',
  'Pink',
  'Gray',
  'Light Gray',
];

const CONTROL_REGEX = /[\x02\x03\x04\x0f\x16\x1d\x1e\x1f]/;

export function hasIrcFormatting(text: string): boolean {
  return CONTROL_REGEX.test(text);
}

export function stripIrcFormatting(text: string): string {
  return parseIrcFormatting(text)
    .map((run) => run.text)
    .join('');
}

export function formatMircColorCode(fg: number | null, bg: number | null = null): string {
  if (fg == null && bg == null) return IRC_COLOR;
  const fgIdx = fg != null && fg >= 0 && fg <= 15 ? String(fg).padStart(2, '0') : null;
  const bgIdx = bg != null && bg >= 0 && bg <= 15 ? String(bg).padStart(2, '0') : null;
  if (fgIdx && bgIdx) return `${IRC_COLOR}${fgIdx},${bgIdx}`;
  if (fgIdx) return `${IRC_COLOR}${fgIdx}`;
  return IRC_COLOR;
}

export interface SelectionWrapResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Inserts an IRC control code at the caret, or wraps an active text selection
 * cleanly with opening and closing codes while protecting trailing digits after `\x03`.
 */
export function applyIrcControlAtSelection(opts: {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  openCode: string;
  closeCode?: string;
}): SelectionWrapResult {
  const { text, openCode } = opts;
  const start = Math.max(0, Math.min(text.length, opts.selectionStart));
  const end = Math.max(start, Math.min(text.length, opts.selectionEnd));

  if (start === end) {
    const next = text.slice(0, start) + openCode + text.slice(end);
    const caret = start + openCode.length;
    return { text: next, selectionStart: caret, selectionEnd: caret };
  }

  const selected = text.slice(start, end);
  let close = opts.closeCode ?? openCode;
  if (close === IRC_COLOR) {
    const nextChar = text[end];
    if (nextChar !== undefined && nextChar >= '0' && nextChar <= '9') {
      close = `${IRC_COLOR}99,99`;
    }
  }
  const next = text.slice(0, start) + openCode + selected + close + text.slice(end);
  const innerStart = start + openCode.length;
  return {
    text: next,
    selectionStart: innerStart,
    selectionEnd: innerStart + selected.length,
  };
}
