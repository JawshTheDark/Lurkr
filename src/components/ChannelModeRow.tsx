// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { DraftRow, ModeRow } from '../utils/channelModeForm';

interface ChannelModeRowProps {
  row: ModeRow;
  state: DraftRow;
  disabled: boolean;
  revealed?: boolean;
  canReveal?: boolean;
  onToggle: (on: boolean) => void;
  onValue: (value: string) => void;
  onReveal?: () => void;
}

export const ChannelModeRow: React.FC<ChannelModeRowProps> = ({
  row,
  state,
  disabled,
  revealed = false,
  canReveal = false,
  onToggle,
  onValue,
  onReveal,
}) => {
  const placeholder =
    row.kind === 'key' && state.on ? 'Key is set' : row.placeholder ?? '';
  const scopeLabel =
    row.scope === 'oper'
      ? 'Oper'
      : row.scope === 'services'
        ? 'Services'
        : row.scope === 'server'
          ? 'Server'
          : null;

  return (
    <>
      <label
        className="channel-mode-toggle"
        title={`+${row.letter} — ${row.name ?? 'Custom mode'}: ${row.description}`}
      >
        <input
          type="checkbox"
          checked={state.on}
          disabled={disabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="channel-mode-copy">
          <span className="channel-mode-title-line">
            <span className="channel-mode-name">{row.name ?? `Mode +${row.letter}`}</span>
            {scopeLabel && (
              <span className={`channel-mode-scope scope-${row.scope}`}>{scopeLabel}</span>
            )}
          </span>
          {row.description && (
            <span className="channel-mode-desc">
              {row.description}
              {row.hint && (row.kind !== 'key' || !state.on) ? ` (${row.hint})` : ''}
            </span>
          )}
        </span>
      </label>
      {row.kind !== 'flag' && (
        <>
          <input
            className="channel-mode-param"
            type={row.kind === 'key' && !revealed ? 'password' : 'text'}
            value={state.value}
            placeholder={placeholder}
            disabled={disabled || !state.on}
            aria-label={`+${row.letter} value`}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => onValue(e.target.value)}
          />
          <span className="channel-reveal-slot">
            {row.kind === 'key' && canReveal && (
              <button
                type="button"
                className="channel-icon-btn"
                title={revealed ? 'Hide key' : 'Show key'}
                aria-label={revealed ? 'Hide key' : 'Show key'}
                onClick={() => onReveal?.()}
              >
                {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            )}
          </span>
        </>
      )}
      <span className="channel-mode-tag">+{row.letter}</span>
    </>
  );
};
