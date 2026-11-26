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
  return (
    <>
      <label className="channel-mode-toggle">
        <input
          type="checkbox"
          checked={state.on}
          disabled={disabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="truncate">{row.name ?? `+${row.letter}`}</span>
      </label>
      {row.kind !== 'flag' && (
        <>
          <input
            className="channel-mode-param"
            type={row.kind === 'key' && !revealed ? 'password' : 'text'}
            value={state.value}
            placeholder={row.kind === 'key' && state.on ? 'Key is set' : ''}
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
      <span className="channel-mode-tag">{row.name ? `+${row.letter}` : ''}</span>
    </>
  );
};
