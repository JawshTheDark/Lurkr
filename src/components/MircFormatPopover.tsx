// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useState } from 'react';
import { IRC_COLOR, MIRC_COLOR_NAMES, formatMircColorCode } from '../utils/mircFormat';
import { getMircPalette } from '../lib/nickTheme';
import { useSettingsStore } from '../stores/settings';
import { useThemesStore } from '../stores/themes';

interface MircFormatPopoverProps {
  open: boolean;
  onClose: () => void;
  onApplyStyle: (code: string) => void;
  onApplyColor: (fg: number | null, bg: number | null) => void;
  onResetAll: () => void;
}

export const MircFormatPopover: React.FC<MircFormatPopoverProps> = ({
  open,
  onClose,
  onApplyStyle,
  onApplyColor,
  onResetAll,
}) => {
  useSettingsStore((s) => s.values);
  useThemesStore((s) => s.saved);

  const [target, setTarget] = useState<'fg' | 'bg'>('fg');
  const [pendingFg, setPendingFg] = useState<number | null>(null);
  const [quickCode, setQuickCode] = useState('');

  useEffect(() => {
    if (!open) {
      setTarget('fg');
      setPendingFg(null);
      setQuickCode('');
    }
  }, [open]);

  if (!open) return null;

  const palette = getMircPalette();

  const handleSwatchClick = (idx: number) => {
    if (target === 'bg') {
      const fgToUse = pendingFg ?? 0;
      onApplyColor(fgToUse, idx);
      onClose();
      return;
    }
    onApplyColor(idx, null);
    onClose();
  };

  const handleSwatchContextMenu = (e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    const fgToUse = pendingFg ?? 0;
    onApplyColor(fgToUse, idx);
    onClose();
  };

  const handleQuickSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const m = quickCode.trim().match(/^(\d{1,2})(?:\s*,\s*(\d{1,2}))?$/);
    if (!m) return;
    const fg = Number(m[1]);
    const bg = m[2] !== undefined ? Number(m[2]) : null;
    if (fg > 15 || (bg !== null && bg > 15)) return;
    onApplyColor(fg, bg);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label="mIRC text formatting and color picker"
      className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-2xl p-3 w-72 text-xs space-y-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-[var(--text-primary)]">mIRC Formatting &amp; Color</span>
        <span className="text-[10px] text-[var(--text-muted)] font-mono">Ctrl+Shift+K</span>
      </div>

      {/* Text Style Buttons */}
      <div className="flex items-center gap-1 flex-wrap">
        <button
          type="button"
          onClick={() => onApplyStyle('\x02')}
          title="Bold (Ctrl/Cmd+B)"
          className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 font-bold hover:bg-[var(--bg-hover)]"
        >
          B
        </button>
        <button
          type="button"
          onClick={() => onApplyStyle('\x1d')}
          title="Italic (Ctrl/Cmd+I)"
          className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 italic hover:bg-[var(--bg-hover)]"
        >
          I
        </button>
        <button
          type="button"
          onClick={() => onApplyStyle('\x1f')}
          title="Underline (Ctrl/Cmd+U)"
          className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 underline hover:bg-[var(--bg-hover)]"
        >
          U
        </button>
        <button
          type="button"
          onClick={() => onApplyStyle('\x1e')}
          title="Strikethrough (Ctrl/Cmd+Shift+S)"
          className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 line-through hover:bg-[var(--bg-hover)]"
        >
          S
        </button>
        <button
          type="button"
          onClick={() => onApplyStyle('\x16')}
          title="Reverse FG/BG (Ctrl/Cmd+Shift+R)"
          className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 hover:bg-[var(--bg-hover)]"
        >
          Rev
        </button>
        <button
          type="button"
          onClick={() => {
            onApplyStyle(IRC_COLOR);
            onClose();
          }}
          title="Close / End Color"
          className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        >
          End Color
        </button>
        <button
          type="button"
          onClick={() => {
            onResetAll();
            onClose();
          }}
          title="Reset All Formatting (Ctrl+O)"
          className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        >
          Reset
        </button>
      </div>

      {/* FG / BG Mode Tabs */}
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-0.5">
          <button
            type="button"
            onClick={() => setTarget('fg')}
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
              target === 'fg'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Text Color (FG)
          </button>
          <button
            type="button"
            onClick={() => setTarget('bg')}
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
              target === 'bg'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Background (BG)
          </button>
        </div>
        {pendingFg !== null && (
          <span className="font-mono text-[10px] text-[var(--text-muted)]">
            FG {String(pendingFg).padStart(2, '0')}
          </span>
        )}
      </div>

      {/* Classic 16-Color mIRC Swatch Grid */}
      <div className="grid grid-cols-8 gap-1">
        {Array.from({ length: 16 }, (_, idx) => {
          const hex = palette[idx] || '#ffffff';
          const num = String(idx).padStart(2, '0');
          const darkText = idx === 0 || idx === 7 || idx === 8 || idx === 9 || idx === 11 || idx === 15;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleSwatchClick(idx)}
              onMouseDown={(e) => {
                // Alt-click picks FG for combining with BG right after.
                if (e.altKey) {
                  e.preventDefault();
                  setPendingFg(idx);
                  setTarget('bg');
                }
              }}
              onContextMenu={(e) => handleSwatchContextMenu(e, idx)}
              title={`${num} ${MIRC_COLOR_NAMES[idx]} (click: ${target.toUpperCase()}, right-click: BG, Alt+click: stage FG)`}
              className="h-6 rounded border border-black/30 font-mono text-[10px] font-bold flex items-center justify-center transition-transform hover:scale-110 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              style={{
                backgroundColor: hex,
                color: darkText ? '#111111' : '#ffffff',
              }}
            >
              {num}
            </button>
          );
        })}
      </div>

      {/* Numeric mIRC Code Entry */}
      <form onSubmit={handleQuickSubmit} className="flex items-center gap-1.5">
        <input
          type="text"
          value={quickCode}
          onChange={(e) => setQuickCode(e.target.value)}
          placeholder="Code e.g. 04 or 04,01"
          aria-label="mIRC color code"
          className="flex-1 min-w-0 rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)]"
        />
        <button
          type="submit"
          className="rounded bg-[var(--accent)] px-2 py-1 text-[11px] font-medium text-white hover:opacity-90"
        >
          Apply
        </button>
      </form>
      <div className="text-[10px] text-[var(--text-muted)]">
        Tip: Right-click or Alt+click FG then pick BG for{' '}
        <span className="font-mono">{formatMircColorCode(4, 1).replace('\x03', '^K')}</span> two-tone colors.
      </div>
    </div>
  );
};
