// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React from 'react';
import { AppModal } from './AppModal';
import { useDesktopUiStore } from '../stores/desktopUi';

interface KeyboardHelpModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: 'Ctrl / Cmd + K', desc: 'Open Quick Buffer Switcher' },
  { keys: 'Ctrl / Cmd + F', desc: 'Search messages' },
  { keys: 'Ctrl / Cmd + J', desc: 'Join IRC channel' },
  { keys: 'Ctrl / Cmd + L', desc: 'Browse channel directory (/LIST)' },
  { keys: 'Ctrl / Cmd + Shift + N', desc: 'Add IRC network' },
  { keys: 'Ctrl / Cmd + ,', desc: 'Open Settings & Preferences' },
  { keys: 'Alt + Up / Down', desc: 'Previous / next buffer' },
  { keys: 'F1', desc: 'Open IRC Commands Reference' },
  { keys: 'Tab', desc: 'Autocomplete nick, channel, or slash command' },
  { keys: 'Up / Down', desc: 'Recall previous sent messages (in empty/single-line input)' },
  { keys: 'Shift + Enter', desc: 'Insert newline in message composer' },
  { keys: 'Ctrl / Cmd + Shift + K', desc: 'Open mIRC Color & Formatting Picker (or Ctrl + K on macOS)' },
  { keys: 'Ctrl / Cmd + B / I / U', desc: 'Insert mIRC Bold / Italic / Underline formatting' },
  { keys: 'Ctrl / Cmd + Shift + S / R', desc: 'Insert mIRC Strikethrough / Reverse formatting' },
  { keys: 'Ctrl / Cmd + Shift + O', desc: 'Reset mIRC formatting (or Ctrl + O)' },
  { keys: 'Escape', desc: 'Cancel reply or close active modal' },
  { keys: 'Ctrl / Cmd + V', desc: 'Paste image/file to upload directly' },
];

export const KeyboardHelpModal: React.FC<KeyboardHelpModalProps> = ({ open, onClose }) => {
  return (
    <AppModal open={open} onClose={onClose} title="Keyboard Shortcuts" maxWidth="max-w-md">
      <div className="space-y-3">
        <div className="divide-y divide-[var(--border)]">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between py-2 text-xs gap-3">
              <span className="text-[var(--text-secondary)]">{s.desc}</span>
              <kbd className="rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-primary)] shrink-0">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-2.5">
          <button
            type="button"
            onClick={() => {
              onClose();
              useDesktopUiStore.getState().openCommands();
            }}
            className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            IRC Commands Reference…
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              useDesktopUiStore.getState().openAbout('program');
            }}
            className="rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            About Lurkr…
          </button>
        </div>
      </div>
    </AppModal>
  );
};
