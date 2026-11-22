// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Pencil, Plus, ShieldOff, Trash2, X } from 'lucide-react';
import { CANONICAL_ORDER } from '../shared/ignoreLevels';
import { durationToExpiry, type IgnorePatternKind } from '../shared/parseIgnore';
import { type IgnoreEntryWithNetwork, useIgnoresStore } from '../stores/ignores';
import { useNetworksStore } from '../stores/networks';

interface IgnoreRulesPanelProps {
  defaultNetworkId?: number | null;
  listClassName?: string;
}

const MAX_PATTERN_LENGTH = 512;

// All concrete + mute modifier levels except ALL, never-surfaced CTCPS, and
// NOHIGHLIGHT (which has its own dedicated modifier checkbox).
const GRANULAR_LEVELS = CANONICAL_ORDER.filter(
  (l) => l !== 'ALL' && l !== 'CTCPS' && l !== 'NOHIGHLIGHT',
);

export const IgnoreRulesPanel: React.FC<IgnoreRulesPanelProps> = ({
  defaultNetworkId = null,
  listClassName = 'max-h-64 overflow-y-auto space-y-1.5',
}) => {
  const globalRules = useIgnoresStore((s) => s.global);
  const byNetwork = useIgnoresStore((s) => s.byNetwork);
  const allRules = useMemo(
    () => useIgnoresStore.getState().all(),
    [globalRules, byNetwork],
  );
  const networks = useNetworksStore((s) => s.networks);

  const [mask, setMask] = useState('');
  const [scopeNetworkId, setScopeNetworkId] = useState<string>(
    defaultNetworkId != null ? String(defaultNetworkId) : 'global',
  );
  const [channels, setChannels] = useState('');
  const [pattern, setPattern] = useState('');
  const [patternKind, setPatternKind] = useState<IgnorePatternKind>('substr');
  const [useAll, setUseAll] = useState(true);
  const [levels, setLevels] = useState<string[]>([]);
  const [noHighlight, setNoHighlight] = useState(false);
  const [isExcept, setIsExcept] = useState(false);
  const [expiry, setExpiry] = useState('');
  const [editing, setEditing] = useState<{
    id: number;
    networkId: number | null;
    expiresAt: string | null;
  } | null>(null);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!editing) {
      setScopeNetworkId(defaultNetworkId != null ? String(defaultNetworkId) : 'global');
    }
  }, [defaultNetworkId, editing]);

  const resetForm = () => {
    setMask('');
    setScopeNetworkId(defaultNetworkId != null ? String(defaultNetworkId) : 'global');
    setChannels('');
    setPattern('');
    setPatternKind('substr');
    setUseAll(true);
    setLevels([]);
    setNoHighlight(false);
    setIsExcept(false);
    setExpiry('');
    setEditing(null);
    setFormError('');
  };

  const toggleAllLevels = () => {
    setUseAll((prev) => {
      const next = !prev;
      if (next) setLevels([]);
      return next;
    });
  };

  const toggleLevel = (lvl: string) => {
    setUseAll(false);
    setLevels((prev) => (prev.includes(lvl) ? prev.filter((l) => l !== lvl) : [...prev, lvl]));
  };

  const startEdit = (entry: IgnoreEntryWithNetwork) => {
    setEditing({
      id: entry.id,
      networkId: entry.networkId,
      expiresAt: entry.expiresAt ?? null,
    });
    setMask(entry.mask ?? '');
    setScopeNetworkId(entry.networkId == null ? 'global' : String(entry.networkId));
    setChannels((entry.channels || []).join(' '));
    setPattern(entry.pattern ?? '');
    setPatternKind(entry.patternKind || 'substr');
    setIsExcept(!!entry.isExcept);
    setExpiry('');

    // Separate hide/mute levels from NOHIGHLIGHT so opening ['NOHIGHLIGHT']
    // keeps ALL unchecked instead of silently adding ALL on save (#775).
    const lv = entry.levels || [];
    const nonNoHighlight = lv.filter((l) => l !== 'NOHIGHLIGHT');
    const hasAll = nonNoHighlight.includes('ALL');
    setUseAll(hasAll);
    setLevels(hasAll ? [] : nonNoHighlight);
    setNoHighlight(lv.includes('NOHIGHLIGHT'));
    setFormError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const rawMask = mask.trim();
    const normalizedMask = !rawMask || rawMask === '*' ? null : rawMask;
    const channelList = channels
      .split(/[\s,]+/)
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
    const normalizedChannels = channelList.length > 0 ? channelList : null;
    const normalizedPattern = pattern.trim() || null;

    if (normalizedPattern && normalizedPattern.length > MAX_PATTERN_LENGTH) {
      setFormError(`Message text is too long (max ${MAX_PATTERN_LENGTH} characters).`);
      return;
    }
    if (normalizedPattern && patternKind === 'regex') {
      try {
        void new RegExp(normalizedPattern);
      } catch (err) {
        setFormError(`Invalid regex: ${(err as Error).message}`);
        return;
      }
    }

    const builtLevels: string[] = useAll ? ['ALL'] : [...levels];
    if (noHighlight) builtLevels.push('NOHIGHLIGHT');

    if (builtLevels.length === 0) {
      setFormError(
        'Pick at least one event type, or enable "Suppress highlights only — NOHIGHLIGHT".',
      );
      return;
    }

    const unscoped = !normalizedMask && !normalizedChannels && !normalizedPattern;
    if (unscoped && isExcept) {
      setFormError('An exception needs a mask, channel, or text pattern to whitelist.');
      return;
    }
    if (unscoped && builtLevels.includes('ALL')) {
      setFormError('That would hide everything — add a mask, channel, or text pattern.');
      return;
    }
    if (unscoped && !useAll && levels.length === 0 && noHighlight) {
      setFormError('That would silence every highlight — add a mask, channel, or text pattern.');
      return;
    }

    let expiresAt: string | null = editing?.expiresAt ?? null;
    const dur = expiry.trim();
    if (dur) {
      const iso = durationToExpiry(dur);
      if (!iso) {
        setFormError(`Invalid duration: ${dur}`);
        return;
      }
      expiresAt = iso;
    } else if (editing) {
      expiresAt = null;
    }

    const targetNetworkId = scopeNetworkId === 'global' ? null : Number(scopeNetworkId);
    const store = useIgnoresStore.getState();
    if (editing) {
      store.remove(editing.networkId, editing.id);
    }
    store.add({
      networkId: targetNetworkId,
      mask: normalizedMask,
      channels: normalizedChannels,
      pattern: normalizedPattern,
      patternKind,
      levels: builtLevels,
      isExcept,
      expiresAt,
    });
    resetForm();
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-3 space-y-3"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            value={mask}
            onChange={(e) => setMask(e.target.value)}
            placeholder="Nick or mask (e.g. troll!*@* or * for anyone)"
            aria-label="Ignore mask"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          />
          <select
            value={scopeNetworkId}
            onChange={(e) => setScopeNetworkId(e.target.value)}
            aria-label="Ignore scope"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="global">Global (All Networks)</option>
            {networks.map((n) => (
              <option key={n.id} value={String(n.id)}>
                {n.name}
              </option>
            ))}
          </select>
        </div>

        <input
          type="text"
          value={channels}
          onChange={(e) => setChannels(e.target.value)}
          placeholder="Channels (optional, e.g. #general #lobby)"
          aria-label="Ignore channels"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
        />

        <div className="flex flex-wrap sm:flex-nowrap gap-2">
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="Message text pattern (optional)"
            aria-label="Ignore message text pattern"
            className="flex-1 min-w-[160px] rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          />
          <select
            value={patternKind}
            onChange={(e) => setPatternKind(e.target.value as IgnorePatternKind)}
            aria-label="Pattern match mode"
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="substr">contains</option>
            <option value="full">whole word</option>
            <option value="regex">regex</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-[var(--text-muted)]">Event types</div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={useAll}
              onClick={toggleAllLevels}
              className="ignore-level-chip inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium"
            >
              {useAll && <Check className="w-3 h-3 shrink-0" aria-hidden="true" />}
              <span>ALL</span>
            </button>
            {GRANULAR_LEVELS.map((lvl) => {
              const active = !useAll && levels.includes(lvl);
              return (
                <button
                  key={lvl}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleLevel(lvl)}
                  className="ignore-level-chip inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium"
                >
                  {active && <Check className="w-3 h-3 shrink-0" aria-hidden="true" />}
                  <span>{lvl}</span>
                </button>
              );
            })}
          </div>

          <label className="flex items-center gap-2 pt-1 text-xs text-[var(--text-primary)] cursor-pointer select-none">
            <input
              type="checkbox"
              data-testid="ignore-nohighlight-checkbox"
              checked={noHighlight}
              onChange={(e) => {
                const checked = e.target.checked;
                setNoHighlight(checked);
                if (checked && useAll) {
                  setUseAll(false);
                } else if (!checked && !useAll && levels.length === 0) {
                  setUseAll(true);
                }
              }}
            />
            <span>Suppress highlights only (don't hide) — NOHIGHLIGHT</span>
          </label>
          {noHighlight && useAll && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
              <span>ALL is also selected, which hides messages too.</span>
              <button
                type="button"
                onClick={() => setUseAll(false)}
                className="text-[var(--accent)] underline hover:opacity-80"
              >
                Use NOHIGHLIGHT only
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isExcept}
              onChange={(e) => setIsExcept(e.target.checked)}
            />
            <span>Exception (whitelist)</span>
          </label>
          <input
            type="text"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            placeholder="Expires in (e.g. 7 days)"
            aria-label="Rule expiry duration"
            className="w-44 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>

        {formError && (
          <div className="rounded bg-red-500/10 border border-red-500/30 px-2.5 py-1.5 text-xs text-red-400">
            {formError}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          {editing && (
            <button
              type="button"
              onClick={resetForm}
              className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <X className="w-3.5 h-3.5" /> Cancel Edit
            </button>
          )}
          <button
            type="submit"
            className="flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            <Plus className="w-3.5 h-3.5" /> {editing ? 'Save Rule' : 'Add Rule'}
          </button>
        </div>
      </form>

      <div className={listClassName}>
        {allRules.length === 0 && (
          <div className="py-8 text-center text-xs text-[var(--text-muted)] flex flex-col items-center gap-2">
            <ShieldOff className="w-5 h-5 opacity-40" />
            <span>No ignore rules configured.</span>
          </div>
        )}
        {allRules.map((r) => {
          const details: string[] = [];
          if (r.channels?.length) details.push(r.channels.join(', '));
          if (r.pattern) {
            details.push(r.patternKind === 'regex' ? `/${r.pattern}/` : `"${r.pattern}"`);
          }
          if (r.isExcept) details.push('except');
          if (r.expiresAt) details.push(`expires ${new Date(r.expiresAt).toLocaleString()}`);
          return (
            <div
              key={`${r.networkId ?? 'g'}-${r.id}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <div className="font-medium text-[var(--text-primary)] truncate">
                  {r.mask || (r.pattern ? `(pattern: ${r.pattern})` : '*')}
                </div>
                <div className="text-[11px] text-[var(--text-muted)] truncate">
                  {r.networkId == null
                    ? 'Global'
                    : networks.find((n) => n.id === r.networkId)?.name || `Network #${r.networkId}`}{' '}
                  · {r.levels.join(', ')}
                  {details.length > 0 ? ` · ${details.join(' · ')}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  title="Edit rule"
                  aria-label="Edit ignore rule"
                  onClick={() => startEdit(r)}
                  className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="Delete rule"
                  aria-label="Delete ignore rule"
                  onClick={() => {
                    if (editing?.id === r.id) resetForm();
                    useIgnoresStore.getState().remove(r.networkId, r.id);
                  }}
                  className="rounded p-1 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-400"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
