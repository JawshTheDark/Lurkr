// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React from 'react';
import { X } from 'lucide-react';
import { useToastsStore } from '../stores/toasts';
import { jumpToMessage } from '../lib/jumpToMessage';

export const ToastsOverlay: React.FC = () => {
  const items = useToastsStore((s) => s.items);
  const dismiss = useToastsStore((s) => s.dismiss);
  const invokeAction = useToastsStore((s) => s.invokeAction);

  if (!items.length) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '14px',
        right: '14px',
        zIndex: 1400,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxWidth: '340px',
        width: 'calc(100vw - 28px)',
        pointerEvents: 'none',
      }}
    >
      {items.map((t) => {
        const borderColor =
          t.kind === 'error'
            ? 'var(--bad)'
            : t.kind === 'warn'
              ? 'var(--warn)'
              : t.kind === 'highlight' || t.kind === 'dm'
                ? 'var(--accent)'
                : 'var(--border)';
        return (
          <div
            key={t.id}
            onClick={() => {
              if (t.networkId != null && t.target) {
                jumpToMessage({
                  networkId: t.networkId,
                  target: t.target,
                  messageId: t.messageId ?? null,
                  onAfterActivate: () => dismiss(t.id),
                });
              }
            }}
            style={{
              pointerEvents: 'auto',
              background: 'var(--bg-soft)',
              color: 'var(--fg)',
              border: `1px solid ${borderColor}`,
              borderLeft: `4px solid ${borderColor}`,
              borderRadius: '6px',
              padding: '10px 12px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
              cursor: t.networkId != null && t.target ? 'pointer' : 'default',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <strong style={{ fontSize: '0.9em' }}>{t.title}</strong>
              {t.dismissible !== false && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    dismiss(t.id);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--fg-muted)',
                    cursor: 'pointer',
                    padding: '2px',
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {t.body && (
              <div style={{ fontSize: '0.85em', color: 'var(--fg-muted)', marginTop: '4px', wordBreak: 'break-word' }}>
                {t.body}
              </div>
            )}
            {t.actions && t.actions.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                {t.actions.map((act, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      invokeAction(t.id, idx);
                    }}
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.8em',
                      borderRadius: '4px',
                      border: '1px solid var(--border)',
                      background:
                        act.tone === 'good'
                          ? 'var(--good)'
                          : act.tone === 'bad'
                            ? 'var(--bad)'
                            : 'var(--alt-bg)',
                      color: act.tone === 'good' || act.tone === 'bad' ? '#000' : 'var(--fg)',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    {act.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
