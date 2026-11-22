// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';

export interface ContextMenuItem {
  label?: string;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
  onClick?: () => void;
  children?: ContextMenuItem[];
}

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MENU_PANEL_STYLE: React.CSSProperties = {
  background: 'var(--bg-soft)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  padding: '4px',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
};

function menuItemStyle(item: ContextMenuItem): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
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
    whiteSpace: 'nowrap',
  };
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ open, x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const subRowRef = useRef<HTMLDivElement | null>(null);
  const subMenuRef = useRef<HTMLDivElement | null>(null);
  const [openSubIdx, setOpenSubIdx] = useState<number | null>(null);
  const [subPos, setSubPos] = useState<{ openLeft: boolean; topOffset: number }>({
    openLeft: false,
    topOffset: 0,
  });

  const left = Math.max(8, Math.min(x, window.innerWidth - 210));
  const top = Math.max(8, Math.min(y, window.innerHeight - Math.min(items.length * 32 + 12, 360)));

  useEffect(() => {
    setOpenSubIdx(null);
  }, [open, x, y]);

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

  useLayoutEffect(() => {
    if (!open || openSubIdx === null) return;
    const fallbackOpenLeft = left + 205 + 250 > window.innerWidth - 8;
    const menuRect = ref.current?.getBoundingClientRect();
    const rowRect = subRowRef.current?.getBoundingClientRect();
    const subRect = subMenuRef.current?.getBoundingClientRect();

    const openLeft =
      menuRect && subRect && subRect.width > 0
        ? menuRect.right + subRect.width > window.innerWidth - 8 && menuRect.left - subRect.width >= 8
        : fallbackOpenLeft;

    let topOffset = 0;
    if (rowRect && subRect && subRect.height > 0 && rowRect.top + subRect.height > window.innerHeight - 8) {
      topOffset = Math.max(-rowRect.top + 8, window.innerHeight - 8 - subRect.height - rowRect.top);
    }

    setSubPos({ openLeft, topOffset });
  }, [open, openSubIdx, left]);

  if (!open || !items.length) return null;

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        ...MENU_PANEL_STYLE,
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        zIndex: 1200,
        minWidth: '185px',
      }}
    >
      {items.map((item, idx) => {
        if (item.divider) {
          return (
            <div
              key={`div-${idx}`}
              style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }}
            />
          );
        }
        const hasChildren = !!item.children?.length;
        const isSubOpen = hasChildren && openSubIdx === idx;
        return (
          <div
            key={`${item.label}-${idx}`}
            ref={isSubOpen ? subRowRef : undefined}
            style={{ position: 'relative' }}
            onMouseEnter={() => {
              if (!item.disabled && hasChildren) setOpenSubIdx(idx);
              else setOpenSubIdx(null);
            }}
          >
            <button
              type="button"
              disabled={item.disabled}
              aria-haspopup={hasChildren ? 'menu' : undefined}
              aria-expanded={hasChildren ? isSubOpen : undefined}
              onClick={() => {
                if (item.disabled) return;
                if (hasChildren) {
                  setOpenSubIdx(idx);
                  return;
                }
                onClose();
                item.onClick?.();
              }}
              style={{
                ...menuItemStyle(item),
                background: isSubOpen ? 'var(--alt-bg)' : 'transparent',
              }}
              onMouseEnter={(e) => {
                if (!item.disabled) e.currentTarget.style.background = 'var(--alt-bg)';
              }}
              onMouseLeave={(e) => {
                if (!isSubOpen) e.currentTarget.style.background = 'transparent';
              }}
            >
              <span>{item.label}</span>
              {hasChildren && <ChevronRight size={13} aria-hidden="true" />}
            </button>

            {isSubOpen && item.children && (
              <div
                ref={subMenuRef}
                role="menu"
                aria-label={item.label}
                style={{
                  ...MENU_PANEL_STYLE,
                  position: 'absolute',
                  top: `${subPos.topOffset}px`,
                  ...(subPos.openLeft
                    ? { right: 'calc(100% - 4px)', left: 'auto' }
                    : { left: 'calc(100% - 4px)', right: 'auto' }),
                  zIndex: 1201,
                  minWidth: '220px',
                  maxHeight: `${Math.max(160, window.innerHeight - 16)}px`,
                  overflowY: 'auto',
                }}
              >
                {item.children.map((sub, subIdx) =>
                  sub.divider ? (
                    <div
                      key={`sub-div-${subIdx}`}
                      style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }}
                    />
                  ) : (
                    <button
                      key={`${sub.label}-${subIdx}`}
                      type="button"
                      disabled={sub.disabled}
                      onClick={() => {
                        if (sub.disabled) return;
                        onClose();
                        sub.onClick?.();
                      }}
                      style={menuItemStyle(sub)}
                      onMouseEnter={(e) => {
                        if (!sub.disabled) e.currentTarget.style.background = 'var(--alt-bg)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <span>{sub.label}</span>
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
