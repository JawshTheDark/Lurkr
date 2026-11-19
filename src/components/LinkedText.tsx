// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useState } from 'react';
import { URL_PATTERN_SOURCE } from '../shared/urlPattern';
import { useBuffersStore } from '../stores/buffers';
import { useSettingsStore } from '../stores/settings';
import { useThemesStore } from '../stores/themes';
import { getMircPalette } from '../lib/nickTheme';
import { openExternalUrl } from '../lib/externalUrl';

interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  mono?: boolean;
  fg?: string;
  bg?: string;
  spoiler?: boolean;
}

function parseIrcSegments(input: string, mircPalette: readonly string[]): Segment[] {
  const out: Segment[] = [];
  let bold = false;
  let italic = false;
  let underline = false;
  let strike = false;
  let mono = false;
  let fg: string | undefined;
  let bg: string | undefined;
  let buf = '';

  const flush = () => {
    if (!buf) return;
    out.push({ text: buf, bold, italic, underline, strike, mono, fg, bg });
    buf = '';
  };

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 0x02) {
      flush();
      bold = !bold;
    } else if (code === 0x1d) {
      flush();
      italic = !italic;
    } else if (code === 0x1f) {
      flush();
      underline = !underline;
    } else if (code === 0x1e) {
      flush();
      strike = !strike;
    } else if (code === 0x11) {
      flush();
      mono = !mono;
    } else if (code === 0x0f) {
      flush();
      bold = italic = underline = strike = mono = false;
      fg = bg = undefined;
    } else if (code === 0x03) {
      flush();
      const rest = input.slice(i + 1);
      const m = rest.match(/^(\d{1,2})(?:,(\d{1,2}))?/);
      if (m) {
        fg = mircPalette[Number(m[1])];
        if (m[2] !== undefined) bg = mircPalette[Number(m[2])];
        i += m[0].length;
      } else {
        fg = bg = undefined;
      }
    } else {
      buf += input[i];
    }
  }
  flush();
  return out;
}

const SpoilerSpan: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={() => setRevealed((r) => !r)}
      title={revealed ? undefined : 'Click to reveal spoiler'}
      style={{
        background: revealed ? 'var(--alt-bg)' : 'var(--fg)',
        color: revealed ? 'inherit' : 'transparent',
        borderRadius: '3px',
        padding: '0 3px',
        cursor: 'pointer',
        userSelect: revealed ? 'text' : 'none',
      }}
    >
      {children}
    </span>
  );
};

interface LinkedTextProps {
  text: string;
  networkId?: number | null;
}

export const LinkedText: React.FC<LinkedTextProps> = ({ text, networkId }) => {
  const _settingVals = useSettingsStore((s) => s.values);
  const _savedThemes = useThemesStore((s) => s.saved);
  void _settingVals;
  void _savedThemes;
  if (!text) return null;
  const segments = parseIrcSegments(text, getMircPalette());

  const renderRichText = (str: string, keyPrefix: string) => {
    const parts: React.ReactNode[] = [];
    const tokenRe = new RegExp(`(${URL_PATTERN_SOURCE}|\\|\\|[^|]+\\|\\|)`, 'gi');
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(str)) !== null) {
      if (m.index > last) {
        parts.push(str.slice(last, m.index));
      }
      const tok = m[0];
      if (tok.startsWith('||') && tok.endsWith('||') && tok.length > 4) {
        parts.push(
          <SpoilerSpan key={`${keyPrefix}-sp-${m.index}`}>{tok.slice(2, -2)}</SpoilerSpan>,
        );
      } else if (/^https?:\/\//i.test(tok)) {
        parts.push(
          <a
            key={`${keyPrefix}-url-${m.index}`}
            href={tok}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              openExternalUrl(tok);
            }}
            style={{ color: 'var(--link)', textDecoration: 'underline', wordBreak: 'break-all' }}
          >
            {tok}
          </a>,
        );
      } else {
        parts.push(tok);
      }
      last = m.index + tok.length;
    }
    if (last < str.length) {
      const tail = str.slice(last);
      // Linkify #channel mentions if networkId is known
      if (networkId != null) {
        const chParts = tail.split(/(#[a-zA-Z0-9_\-.+#]+)/g);
        chParts.forEach((p, idx) => {
          if (/^#[a-zA-Z0-9_\-.+#]+$/.test(p)) {
            parts.push(
              <a
                key={`${keyPrefix}-ch-${last}-${idx}`}
                href={`#join-${p}`}
                onClick={(e) => {
                  e.preventDefault();
                  useBuffersStore.getState().joinOrToast(networkId, p);
                }}
                style={{ color: 'var(--link)', cursor: 'pointer' }}
              >
                {p}
              </a>,
            );
          } else if (p) {
            parts.push(p);
          }
        });
      } else {
        parts.push(tail);
      }
    }
    return parts;
  };

  return (
    <>
      {segments.map((seg, idx) => {
        const style: React.CSSProperties = {
          fontWeight: seg.bold ? 700 : undefined,
          fontStyle: seg.italic ? 'italic' : undefined,
          textDecoration:
            [seg.underline ? 'underline' : '', seg.strike ? 'line-through' : '']
              .filter(Boolean)
              .join(' ') || undefined,
          fontFamily: seg.mono ? 'var(--mono)' : undefined,
          color: seg.fg,
          backgroundColor: seg.bg,
        };
        return (
          <span key={idx} style={style}>
            {renderRichText(seg.text, `s${idx}`)}
          </span>
        );
      })}
    </>
  );
};
