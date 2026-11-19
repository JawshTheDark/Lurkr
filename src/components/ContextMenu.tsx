// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label?: string;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
  onClick?: () => void;
}

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ open, x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open || !items.length) return null;

  const left = Math.min(x, window.innerWidth - 210);
  const top = Math.min(y, window.innerHeight - Math.min(items.length * 32 + 12, 360));

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: 'fixed',
        left: `${Math.max(8, left)}px`,
        top: `${Math.max(8, top)}px`,
        zIndex: 1200,
        minWidth: '185px',
        background: 'var(--bg-soft)',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        padding: '4px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
      }}
    >
      {items.map((item, idx) =>
        item.divider ? (
          <div
            key={`div-${idx}`}
            style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }}
          />
        ) : (
          <button
            key={`${item.label}-${idx}`}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.onClick?.();
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 10px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              color: item.danger ? 'var(--bad)' : 'var(--fg)',
              opacity: item.disabled ? 0.45 : 1,
              cursor: item.disabled ? 'default' : 'pointer',
              fontSize: '0.9em',
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) e.currentTarget.style.background = 'var(--alt-bg)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
};
