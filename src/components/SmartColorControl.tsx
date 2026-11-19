// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useMemo, useState } from 'react';
import { Palette, RotateCcw, Star, Sparkles } from 'lucide-react';
import {
  contrastRatio,
  formatRatio,
  harmonies,
  parseComputedRgb,
  parseHex,
  toHex,
} from '../lib/color';

const SUBTLE_BORDER = 'color-mix(in srgb, var(--fg) 15%, var(--border))';

/**
 * Resolves literal hex strings and `var(--...)` / CSS colors into `#rrggbb` so
 * native `<input type="color">` reflects the real live color instead of `#000000`.
 */
export function resolveCssColorToHex(
  rawValue: string,
  varLookup?: Record<string, string>,
): string {
  const trimmed = rawValue.trim();
  const parsed = parseHex(trimmed);
  if (parsed) return toHex(parsed);

  const varMatch = /^var\(\s*(--[a-zA-Z0-9_-]+)(?:\s*,\s*([^)]+))?\s*\)$/.exec(trimmed);
  if (varMatch && varLookup) {
    const looked = varLookup[varMatch[1]];
    if (looked && looked !== trimmed) {
      return resolveCssColorToHex(looked, varLookup);
    }
    if (varMatch[2]) {
      return resolveCssColorToHex(varMatch[2], varLookup);
    }
  }

  if (typeof document !== 'undefined' && document.documentElement) {
    if (varMatch) {
      const propVal = getComputedStyle(document.documentElement)
        .getPropertyValue(varMatch[1])
        .trim();
      if (propVal) {
        const direct = parseHex(propVal);
        if (direct) return toHex(direct);
      }
    }
    if (document.body && trimmed) {
      const probe = document.createElement('span');
      probe.style.color = trimmed;
      probe.style.display = 'none';
      document.body.appendChild(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      const rgb = parseComputedRgb(computed);
      if (rgb) return toHex(rgb);
    }
  }
  return '#a99dec';
}

interface SmartColorControlProps {
  label: string;
  settingKey?: string;
  value: string;
  defaultValue?: string;
  isModified?: boolean;
  contrastAgainst?: string;
  varLookup?: Record<string, string>;
  favorites?: string[];
  onToggleFavorite?: (hex: string) => void;
  onChange: (next: string) => void;
  onReset?: () => void;
}

export const SmartColorControl: React.FC<SmartColorControlProps> = ({
  label,
  settingKey,
  value,
  isModified,
  contrastAgainst,
  varLookup,
  favorites = [],
  onToggleFavorite,
  onChange,
  onReset,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const resolvedHex = useMemo(
    () => resolveCssColorToHex(value || '#000000', varLookup),
    [value, varLookup],
  );

  const contrast = useMemo(() => {
    if (!contrastAgainst) return null;
    const bgHex = resolveCssColorToHex(contrastAgainst, varLookup);
    const fgRgb = parseHex(resolvedHex);
    const bgRgb = parseHex(bgHex);
    if (!fgRgb || !bgRgb) return null;
    const ratio = contrastRatio(fgRgb, bgRgb);
    return {
      ratio,
      text: formatRatio(ratio),
      tier: ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA+' : 'Low',
    };
  }, [resolvedHex, contrastAgainst, varLookup]);

  const swatches = useMemo(() => {
    const rgb = parseHex(resolvedHex);
    return rgb ? harmonies(rgb) : [];
  }, [resolvedHex]);

  const isFav = favorites.some((f) => f.toLowerCase() === resolvedHex.toLowerCase());

  return (
    <div
      className="rounded-lg p-2.5 space-y-2"
      style={{
        background: 'var(--bg)',
        border: `1px solid ${SUBTLE_BORDER}`,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-[var(--fg)] truncate">{label}</div>
          {settingKey && (
            <div className="text-[10px] font-mono text-[var(--fg-muted)] truncate">
              {settingKey}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {contrast && (
            <span
              title={`WCAG contrast vs background: ${contrast.text}`}
              className="rounded px-1.5 py-0.5 text-[10px] font-mono font-medium"
              style={{
                background: 'var(--bg-soft)',
                border: `1px solid ${SUBTLE_BORDER}`,
                color:
                  contrast.tier === 'Low'
                    ? 'var(--warn)'
                    : contrast.tier === 'AAA' || contrast.tier === 'AA'
                      ? 'var(--good)'
                      : 'var(--fg-muted)',
              }}
            >
              {contrast.text} {contrast.tier}
            </span>
          )}

          <input
            type="color"
            aria-label={`${label} color picker`}
            value={resolvedHex}
            onChange={(e) => onChange(e.target.value)}
            className="h-7 w-9 rounded cursor-pointer bg-transparent shrink-0"
            style={{ border: `1px solid ${SUBTLE_BORDER}` }}
          />

          <input
            type="text"
            aria-label={`${label} CSS color value`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-28 rounded px-2 py-1 text-[11px] font-mono text-[var(--fg)] focus:outline-none"
            style={{
              background: 'var(--bg-soft)',
              border: `1px solid ${SUBTLE_BORDER}`,
            }}
          />

          <button
            type="button"
            onClick={() => setDrawerOpen((o) => !o)}
            title="Harmonies & favorite swatches"
            className="p-1.5 rounded hover:opacity-90"
            style={{
              background: drawerOpen ? 'var(--accent)' : 'var(--bg-soft)',
              color: drawerOpen ? 'var(--bg)' : 'var(--fg-muted)',
              border: `1px solid ${SUBTLE_BORDER}`,
            }}
          >
            <Palette className="w-3.5 h-3.5" />
          </button>

          {onToggleFavorite && (
            <button
              type="button"
              onClick={() => onToggleFavorite(resolvedHex)}
              title={isFav ? 'Remove from favorites' : 'Save color to favorites'}
              className="p-1.5 rounded hover:opacity-90"
              style={{
                background: 'var(--bg-soft)',
                border: `1px solid ${SUBTLE_BORDER}`,
                color: isFav ? 'var(--warn)' : 'var(--fg-muted)',
              }}
            >
              <Star className="w-3.5 h-3.5" fill={isFav ? 'currentColor' : 'none'} />
            </button>
          )}

          {isModified && onReset && (
            <button
              type="button"
              onClick={onReset}
              title="Reset to theme default"
              className="p-1.5 rounded hover:opacity-90 text-[var(--fg-muted)]"
              style={{
                background: 'var(--bg-soft)',
                border: `1px solid ${SUBTLE_BORDER}`,
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {drawerOpen && (
        <div
          className="pt-2 space-y-2 border-t text-[11px]"
          style={{ borderColor: SUBTLE_BORDER }}
        >
          {swatches.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[var(--fg-muted)] mr-1">Harmonies:</span>
              {swatches.map((s) => (
                <button
                  key={`${s.label}-${s.hex}`}
                  type="button"
                  title={`${s.label}: ${s.hex}`}
                  onClick={() => onChange(s.hex)}
                  className="w-5 h-5 rounded cursor-pointer hover:scale-110 transition-transform"
                  style={{ background: s.hex, border: `1px solid ${SUBTLE_BORDER}` }}
                />
              ))}
            </div>
          )}
          {favorites.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[var(--fg-muted)] mr-1">Favorites:</span>
              {favorites.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  title={hex}
                  onClick={() => onChange(hex)}
                  className="w-5 h-5 rounded cursor-pointer hover:scale-110 transition-transform"
                  style={{ background: hex, border: `1px solid ${SUBTLE_BORDER}` }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const MIRC_LABELS = [
  '0 White',
  '1 Black',
  '2 Navy',
  '3 Green',
  '4 Red',
  '5 Maroon',
  '6 Purple',
  '7 Orange',
  '8 Yellow',
  '9 Lime',
  '10 Teal',
  '11 Cyan',
  '12 Blue',
  '13 Magenta',
  '14 Gray',
  '15 Light Gray',
];

interface ColorListEditorProps {
  title: string;
  subtitle?: string;
  colors: string[];
  labeled?: boolean;
  canAddRemove?: boolean;
  onGenerate?: () => void;
  onReset?: () => void;
  onChange: (next: string[]) => void;
}

export const ColorListEditor: React.FC<ColorListEditorProps> = ({
  title,
  subtitle,
  colors,
  labeled = false,
  canAddRemove = false,
  onGenerate,
  onReset,
  onChange,
}) => {
  const updateSlot = (idx: number, val: string) => {
    const next = [...colors];
    next[idx] = val;
    onChange(next);
  };

  return (
    <div
      className="rounded-lg p-3.5 space-y-3"
      style={{
        background: 'var(--bg)',
        border: `1px solid ${SUBTLE_BORDER}`,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold text-[var(--fg)] m-0">{title}</h4>
          {subtitle && <p className="text-[11px] text-[var(--fg-muted)] m-0">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {onGenerate && (
            <button
              type="button"
              onClick={onGenerate}
              className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium hover:opacity-90"
              style={{ background: 'var(--accent)', color: 'var(--bg)' }}
            >
              <Sparkles className="w-3 h-3" />
              <span>Auto-Generate from Accent</span>
            </button>
          )}
          {canAddRemove && (
            <button
              type="button"
              onClick={() => onChange([...colors, '#a99dec'])}
              className="rounded px-2 py-1 text-[11px] font-medium hover:opacity-90"
              style={{
                background: 'var(--bg-soft)',
                border: `1px solid ${SUBTLE_BORDER}`,
                color: 'var(--fg)',
              }}
            >
              + Add Slot
            </button>
          )}
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
              style={{
                background: 'var(--bg-soft)',
                border: `1px solid ${SUBTLE_BORDER}`,
              }}
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
        {colors.map((c, idx) => {
          const hex = resolveCssColorToHex(c);
          return (
            <div
              key={`${idx}-${labeled ? MIRC_LABELS[idx] : 'slot'}`}
              className="flex items-center gap-1.5 rounded px-2 py-1"
              style={{
                background: 'var(--bg-soft)',
                border: `1px solid ${SUBTLE_BORDER}`,
              }}
            >
              <input
                type="color"
                aria-label={`${title} color ${idx + 1}`}
                value={hex}
                onChange={(e) => updateSlot(idx, e.target.value)}
                className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] text-[var(--fg-muted)] truncate">
                  {labeled ? MIRC_LABELS[idx] || `#${idx}` : `#${idx + 1}`}
                </div>
                <div className="text-[10px] font-mono text-[var(--fg)] truncate">{c}</div>
              </div>
              {canAddRemove && colors.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange(colors.filter((_, i) => i !== idx))}
                  title="Remove slot"
                  className="text-[11px] text-[var(--fg-muted)] hover:text-[var(--bad)] px-0.5"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
