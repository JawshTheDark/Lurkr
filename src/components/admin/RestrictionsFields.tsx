// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useState } from 'react';
import {
  hostListProblem,
  type AccountRestrictions,
} from '../../shared/accountRestrictions';

interface RestrictionsFieldsProps {
  value: AccountRestrictions;
  onChange: (next: AccountRestrictions) => void;
  disabled?: boolean;
}

function parseHosts(text: string): string[] {
  return text
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((h, i) => h === b[i]);
}

export const RestrictionsFields: React.FC<RestrictionsFieldsProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const anyNetwork = value.networks === null;
  const [hostsText, setHostsText] = useState(value.networks?.join(', ') ?? '');

  useEffect(() => {
    if (value.networks === null) return;
    if (sameList(value.networks, parseHosts(hostsText))) return;
    setHostsText(value.networks.join(', '));
  }, [value.networks]);

  const problem = value.networks !== null ? hostListProblem(value.networks) : null;

  return (
    <div className="space-y-2 text-xs">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={anyNetwork}
          disabled={disabled}
          onChange={(e) => {
            onChange({
              ...value,
              networks: e.target.checked ? null : parseHosts(hostsText),
            });
          }}
        />
        <span>Any network</span>
      </label>

      {!anyNetwork && (
        <label className="block space-y-1">
          <span className="text-[var(--text-secondary)]">Allowed hostnames</span>
          <input
            type="text"
            value={hostsText}
            disabled={disabled}
            placeholder="hostnames, comma-separated (e.g. irc.libera.chat)"
            spellCheck={false}
            autoCapitalize="off"
            onChange={(e) => {
              const raw = e.target.value;
              setHostsText(raw);
              onChange({ ...value, networks: parseHosts(raw) });
            }}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs"
          />
        </label>
      )}

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={value.uploads}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, uploads: e.target.checked })}
        />
        <span>May upload files</span>
      </label>

      {problem && <div className="text-[11px] text-amber-400">{problem}</div>}
    </div>
  );
};
