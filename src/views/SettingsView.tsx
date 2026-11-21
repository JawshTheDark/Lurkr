// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EncryptedPreviewCachePanel } from '../components/EncryptedPreviewCachePanel';
import { DesktopUpdaterPanel } from '../components/DesktopUpdaterPanel';
import {
  ArrowLeft,
  Palette,
  Bell,
  Shield,
  Download,
  Server,
  KeyRound,
  Plus,
  Trash2,
  Sliders,
  Radio,
  Terminal,
  RefreshCw,
} from 'lucide-react';
import { ThemeStudio } from '../components/ThemeStudio';
import { ColorListEditor, SmartColorControl } from '../components/SmartColorControl';
import { COLOR_VARS } from '../hooks/useTheme';
import { useSettingsStore } from '../stores/settings';
import { useThemesStore } from '../stores/themes';
import { useAuthStore } from '../stores/auth';
import { useConfigStore } from '../stores/config';
import { useHighlightRulesStore } from '../stores/highlightRules';
import { useDataExportStore } from '../stores/dataExport';
import { useAliasesStore } from '../stores/aliases';
import { useRelayBotsStore } from '../stores/relayBots';
import { useNetworksStore } from '../stores/networks';
import { useToastsStore } from '../stores/toasts';
import { useDesktopUiStore } from '../stores/desktopUi';
import { normalizeAliasBody, normalizeAliasName } from '../shared/aliases';
import {
  REGISTRY,
  CATEGORIES,
  getDefault,
} from '../utils/settingsRegistry';
import type { SettingOption, SettingValue } from '../shared/settingsRegistry';
import { getServerUrl, setServerUrl } from '../api';

type SectionId =
  | string
  | '_themes'
  | '_highlights'
  | '_aliases'
  | '_relays'
  | '_security'
  | '_export'
  | '_connection';

export const SettingsView: React.FC = () => {
  const navigate = useNavigate();
  const values = useSettingsStore((s) => s.values);
  const savedThemes = useThemesStore((s) => s.saved);
  const themesAll = useMemo(() => useThemesStore.getState().all(), [savedThemes]);
  const activeThemeId = useMemo(
    () => useThemesStore.getState().activeThemeId(),
    [values, savedThemes],
  );
  void themesAll;
  void activeThemeId;
  const highlightRules = useHighlightRulesStore((s) => s.rules);
  const aliases = useAliasesStore((s) => s.aliases);
  const networks = useNetworksStore((s) => s.networks);
  const relayBotsByKey = useRelayBotsStore((s) => s.byKey);
  const exportJob = useDataExportStore((s) => s.job);
  const importing = useDataExportStore((s) => s.importing);
  const configChecked = useConfigStore((s) => s.checked);
  const linkPreviewsEnabled = useConfigStore((s) => s.features.linkPreviews);

  const [section, setSection] = useState<SectionId>(CATEGORIES[0]?.id || '_themes');
  const requestedSettingsSection = useDesktopUiStore((s) => s.requestedSettingsSection);

  useEffect(() => {
    if (requestedSettingsSection) {
      setSection(requestedSettingsSection);
      useDesktopUiStore.getState().requestSettingsSection(null);
    }
  }, [requestedSettingsSection]);
  const [newRulePattern, setNewRulePattern] = useState('');
  const [newRuleRegex, setNewRuleRegex] = useState(false);

  // Command aliases state
  const [newAliasName, setNewAliasName] = useState('');
  const [newAliasBody, setNewAliasBody] = useState('');

  // Relay bots state
  const [relayNetId, setRelayNetId] = useState<number>(() => networks[0]?.id ?? 0);
  const [newRelayNick, setNewRelayNick] = useState('');
  const [newRelayPattern, setNewRelayPattern] = useState('');

  useEffect(() => {
    if (!relayNetId && networks[0]?.id) {
      setRelayNetId(networks[0].id);
    }
  }, [networks, relayNetId]);

  // Security state
  const [passkeys, setPasskeys] = useState<any[]>([]);
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Server connection state
  const [serverInput, setServerInput] = useState(getServerUrl());
  const [allowSelfSigned, setAllowSelfSigned] = useState(false);

  useEffect(() => {
    useThemesStore.getState().fetchAll().catch(() => {});
    useHighlightRulesStore.getState().fetchAll().catch(() => {});
    useAliasesStore.getState().fetchAll().catch(() => {});
    useAuthStore
      .getState()
      .listPasskeys()
      .then((res) => setPasskeys(res || []))
      .catch(() => {});
    useAuthStore
      .getState()
      .fetchPasswordStatus()
      .then((res) => setHasPassword(!!res))
      .catch(() => {});
    if (window.lurkerDesktop?.getConfig) {
      window.lurkerDesktop.getConfig().then((cfg) => {
        if (cfg.serverUrl) setServerInput(cfg.serverUrl);
        setAllowSelfSigned(!!cfg.allowSelfSigned);
      });
    }
  }, []);

  const optionsByCategory = useMemo(() => {
    const map: Record<string, SettingOption[]> = {};
    for (const opt of REGISTRY) {
      const cat = opt.category || 'general';
      if (!map[cat]) map[cat] = [];
      map[cat].push(opt);
    }
    return map;
  }, []);

  const updateSetting = async (key: string, val: SettingValue) => {
    try {
      await useSettingsStore.getState().setValue(key, val);
    } catch (err: any) {
      useToastsStore.getState().push(err?.message || 'Failed to update setting', 'error');
    }
  };

  const colorVarLookup = useMemo(() => {
    const map: Record<string, string> = {};
    const settings = useSettingsStore.getState();
    for (const [k, cssVar] of Object.entries(COLOR_VARS)) {
      const val = settings.effective(k);
      if (typeof val === 'string' && !val.startsWith('var(')) {
        map[cssVar] = val;
      }
    }
    return map;
  }, [values, savedThemes]);

  const renderSettingControl = (opt: SettingOption) => {
    const current = useSettingsStore.getState().effective(opt.key) ?? getDefault(opt.key);
    if (opt.type === 'bool') {
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(current)}
            onChange={(e) => updateSetting(opt.key, e.target.checked)}
          />
          <span className="text-xs text-[var(--text-secondary)]">
            {Boolean(current) ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      );
    }
    if (opt.type === 'enum') {
      const choices = 'choices' in opt && Array.isArray(opt.choices) ? opt.choices : [];
      const legacyOpts = 'options' in opt && Array.isArray((opt as any).options) ? (opt as any).options : [];
      const opts = (choices.length > 0 ? choices : legacyOpts) as Array<{ value: string; label: string } | string>;
      const choiceLabels =
        'choiceLabels' in opt && opt.choiceLabels
          ? (opt.choiceLabels as Readonly<Record<string, string>>)
          : undefined;
      return (
        <select
          value={String(current ?? '')}
          onChange={(e) => updateSetting(opt.key, e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
        >
          {opts.map((o) => {
            const v = typeof o === 'string' ? o : o.value;
            const l = typeof o === 'string' ? (choiceLabels?.[v] || v) : o.label;
            return (
              <option key={v} value={v}>
                {l}
              </option>
            );
          })}
        </select>
      );
    }
    if (opt.type === 'color') {
      return (
        <SmartColorControl
          label={opt.label}
          value={String(current ?? '#000000')}
          contrastAgainst={
            opt.key === 'look.color.bg'
              ? undefined
              : String(useSettingsStore.getState().effective('look.color.bg') ?? '#212022')
          }
          varLookup={colorVarLookup}
          isModified={useSettingsStore.getState().isModified(opt.key)}
          onChange={(next) => void updateSetting(opt.key, next)}
          onReset={() => void useSettingsStore.getState().resetKey(opt.key)}
        />
      );
    }
    if (opt.key === 'look.nick.colors' || opt.key === 'look.color.mirc_colors') {
      const arr = Array.isArray(current) ? current.map(String) : [];
      return (
        <div className="w-full">
          <ColorListEditor
            title={opt.label}
            labeled={opt.key === 'look.color.mirc_colors'}
            canAddRemove={opt.key === 'look.nick.colors'}
            colors={arr}
            onChange={(next) => void updateSetting(opt.key, next)}
            onReset={() => void useSettingsStore.getState().resetKey(opt.key)}
          />
        </div>
      );
    }
    if (opt.type === 'int') {
      return (
        <input
          type="number"
          value={Number(current ?? 0)}
          onChange={(e) => updateSetting(opt.key, Number(e.target.value))}
          className="w-32 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
        />
      );
    }
    if (opt.type === 'string-list') {
      const arr = Array.isArray(current) ? current : [];
      return (
        <input
          type="text"
          value={arr.join(', ')}
          onChange={(e) =>
            updateSetting(
              opt.key,
              e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          placeholder="Comma-separated values"
          className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
        />
      );
    }
    return (
      <input
        type={opt.type === 'secret' ? 'password' : 'text'}
        value={String(current ?? '')}
        onChange={(e) => updateSetting(opt.key, e.target.value)}
        className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
      />
    );
  };

  return (
    <div className="h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] flex flex-col">
      <header className="shrink-0 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs hover:bg-[var(--bg-hover)]"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Chat
          </button>
          <h1 className="text-base font-semibold">Settings</h1>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col md:flex-row max-w-6xl w-full mx-auto">
        <nav className="w-full md:w-60 shrink-0 max-h-44 md:max-h-none overflow-y-auto scroll-region border-b md:border-b-0 md:border-r border-[var(--border)] p-3 space-y-1">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Preferences
          </div>
          {CATEGORIES.filter((c) => optionsByCategory[c.id]?.length).map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSection(cat.id)}
              className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-left ${
                section === cat.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <Sliders className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{cat.label}</span>
            </button>
          ))}

          <div className="pt-3 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Workspace & Account
          </div>
          {[
            { id: '_themes', label: 'Themes', icon: Palette },
            { id: '_highlights', label: 'Highlight Rules', icon: Bell },
            { id: '_aliases', label: 'Command Aliases', icon: Terminal },
            { id: '_relays', label: 'Relay / Janus Bots', icon: Radio },
            { id: '_security', label: 'Security & Passkeys', icon: Shield },
            { id: '_export', label: 'Data Export / Import', icon: Download },
            { id: '_connection', label: 'Server Connection', icon: Server },
            { id: '_updates', label: 'Desktop Updates', icon: RefreshCw },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-left ${
                  section === item.id
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <main className="flex-1 min-h-0 p-5 overflow-y-auto scroll-region space-y-5">
          {section === '_themes' && <ThemeStudio />}

          {section === '_highlights' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Custom Highlight Rules</h2>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newRulePattern.trim()) return;
                  await useHighlightRulesStore.getState().create({
                    pattern: newRulePattern.trim(),
                    kind: newRuleRegex ? 'regex' : 'substring',
                  });
                  setNewRulePattern('');
                }}
                className="flex flex-wrap items-center gap-2"
              >
                <input
                  type="text"
                  value={newRulePattern}
                  onChange={(e) => setNewRulePattern(e.target.value)}
                  placeholder="Keyword or regex pattern..."
                  className="flex-1 min-w-[200px] max-w-sm rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs"
                />
                <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={newRuleRegex}
                    onChange={(e) => setNewRuleRegex(e.target.checked)}
                  />
                  Regex
                </label>
                <button
                  type="submit"
                  className="flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Rule
                </button>
              </form>

              <div className="space-y-1.5">
                {highlightRules.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs"
                  >
                    <span>
                      <code className="font-mono">{r.pattern}</code>{' '}
                      {r.kind === 'regex' && (
                        <span className="ml-1 rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                          regex
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => useHighlightRulesStore.getState().remove(r.id)}
                      className="text-[var(--text-muted)] hover:text-red-400 p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {section === '_security' && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold">Security & Passkeys</h2>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Passkeys</div>
                  <button
                    type="button"
                    onClick={async () => {
                      await useAuthStore.getState().addPasskey();
                      const res = await useAuthStore.getState().listPasskeys();
                      setPasskeys(res || []);
                    }}
                    className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white"
                  >
                    <KeyRound className="w-3.5 h-3.5" /> Add Passkey
                  </button>
                </div>
                <div className="space-y-1.5">
                  {passkeys.length === 0 && (
                    <div className="text-xs text-[var(--text-muted)]">No passkeys registered.</div>
                  )}
                  {passkeys.map((pk) => (
                    <div
                      key={pk.id}
                      className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-xs"
                    >
                      <span>{pk.name || `Passkey #${pk.id}`}</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await useAuthStore.getState().deletePasskey(pk.id);
                          setPasskeys((prev) => prev.filter((p) => p.id !== pk.id));
                        }}
                        className="text-[var(--text-muted)] hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await useAuthStore
                    .getState()
                    .setPassword({
                      password: newPassword,
                      ...(hasPassword ? { currentPassword } : {}),
                    });
                  setCurrentPassword('');
                  setNewPassword('');
                  setHasPassword(true);
                  useToastsStore.getState().push('Password updated', 'success');
                }}
                className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 space-y-3"
              >
                <div className="text-sm font-medium">
                  {hasPassword ? 'Change Password' : 'Set Password'}
                </div>
                {hasPassword && (
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Current password"
                    className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs"
                  />
                )}
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password"
                  className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs block"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white"
                >
                  Save Password
                </button>
              </form>
              <EncryptedPreviewCachePanel />
            </div>
          )}

          {section === '_export' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Data Export & Import</h2>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 space-y-3">
                <p className="text-xs text-[var(--text-secondary)]">
                  Export your networks, buffers, messages, and settings as a portable archive.
                </p>
                <button
                  type="button"
                  onClick={() => useDataExportStore.getState().startExport()}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white"
                >
                  Start Export
                </button>
                {exportJob && (
                  <div className="text-xs text-[var(--text-secondary)]">
                    Status: <strong className="capitalize">{exportJob.status}</strong>
                    {exportJob.downloadUrl && (
                      <a
                        href={exportJob.downloadUrl}
                        className="ml-2 text-[var(--accent)] underline"
                      >
                        Download Archive
                      </a>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 space-y-2">
                <div className="text-sm font-medium">Import Archive</div>
                <input
                  type="file"
                  disabled={importing}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      await useDataExportStore.getState().importArchive(f);
                      useToastsStore.getState().push('Import completed', 'success');
                    }
                  }}
                  className="text-xs"
                />
              </div>
            </div>
          )}

          {section === '_aliases' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Command Aliases</h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Define custom slash commands (e.g. <code>j</code> → <code>/join $1</code> or{' '}
                  <code>slap</code> → <code>/me slaps $1</code>). Same list used by{' '}
                  <code>/alias</code>.
                </p>
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const nameRes = normalizeAliasName(newAliasName);
                  if (!nameRes.ok) {
                    useToastsStore.getState().push(nameRes.error, 'error');
                    return;
                  }
                  const bodyRes = normalizeAliasBody(newAliasBody);
                  if (!bodyRes.ok) {
                    useToastsStore.getState().push(bodyRes.error, 'error');
                    return;
                  }
                  try {
                    await useAliasesStore.getState().set(nameRes.name, bodyRes.body);
                    setNewAliasName('');
                    setNewAliasBody('');
                    useToastsStore.getState().push(`Saved alias /${nameRes.name}`, 'success');
                  } catch (err: any) {
                    useToastsStore.getState().push(err?.message || 'Failed to save alias', 'error');
                  }
                }}
                className="flex flex-wrap gap-2"
              >
                <input
                  type="text"
                  value={newAliasName}
                  onChange={(e) => setNewAliasName(e.target.value)}
                  placeholder="Alias name (e.g. wii)"
                  className="w-40 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs"
                />
                <input
                  type="text"
                  value={newAliasBody}
                  onChange={(e) => setNewAliasBody(e.target.value)}
                  placeholder="Expansion (e.g. /whois $1 $1)"
                  className="flex-1 min-w-[200px] rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-mono"
                />
                <button
                  type="submit"
                  className="flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Alias
                </button>
              </form>

              <div className="space-y-1.5">
                {aliases.length === 0 ? (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 text-xs text-[var(--text-muted)]">
                    No command aliases configured yet.
                  </div>
                ) : (
                  aliases.map((a) => (
                    <div
                      key={a.name}
                      className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3.5 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-mono font-semibold text-[var(--accent)]">
                          /{a.name}
                        </span>
                        <span className="mx-2 text-[var(--text-muted)]">→</span>
                        <span className="font-mono text-[var(--text-primary)] break-all">
                          {a.body}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void useAliasesStore.getState().remove(a.name)}
                        className="text-[var(--text-muted)] hover:text-red-400 p-1 shrink-0"
                        title={`Delete /${a.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {section === '_relays' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Relay / Janus Bots</h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Mark bridge bots (e.g. <code>EyeBridge</code>, <code>Janus</code>, Matterbridge)
                  per network to unwrap <code>[source] &lt;nick&gt; message</code> envelopes and
                  attribute messages to the bridged speaker.
                </p>
              </div>
              {networks.length === 0 ? (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 text-xs text-[var(--text-muted)]">
                  Add an IRC network first to configure relay bots.
                </div>
              ) : (
                <>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const nick = newRelayNick.trim();
                      if (!nick || !relayNetId) return;
                      useRelayBotsStore
                        .getState()
                        .setRelay(relayNetId, nick, true, newRelayPattern.trim());
                      setNewRelayNick('');
                      setNewRelayPattern('');
                      useToastsStore.getState().push(`Marked ${nick} as relay bot`, 'success');
                    }}
                    className="flex flex-wrap gap-2"
                  >
                    <select
                      value={relayNetId}
                      onChange={(e) => setRelayNetId(Number(e.target.value))}
                      className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs"
                    >
                      {networks.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={newRelayNick}
                      onChange={(e) => setNewRelayNick(e.target.value)}
                      placeholder="Bot nick (e.g. EyeBridge)"
                      className="w-44 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs"
                    />
                    <input
                      type="text"
                      value={newRelayPattern}
                      onChange={(e) => setNewRelayPattern(e.target.value)}
                      placeholder="Optional pattern (default: [{source}] <{nick}> {message})"
                      className="flex-1 min-w-[220px] rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-mono"
                    />
                    <button
                      type="submit"
                      className="flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white"
                    >
                      <Plus className="w-3.5 h-3.5" /> Mark Bot
                    </button>
                  </form>

                  <div className="space-y-1.5">
                    {(() => {
                      void relayBotsByKey;
                      const list = useRelayBotsStore.getState().listForNetwork(relayNetId);
                      if (list.length === 0) {
                        return (
                          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 text-xs text-[var(--text-muted)]">
                            No relay bots marked on this network.
                          </div>
                        );
                      }
                      return list.map((b) => (
                        <div
                          key={b.nick}
                          className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3.5 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <span className="font-semibold text-[var(--text-primary)]">
                              {b.nick}
                            </span>
                            <span className="ml-2 font-mono text-[11px] text-[var(--text-muted)]">
                              {b.pattern || 'Default ([{source}] <{nick}> {message}, <{nick}> {message})'}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              useRelayBotsStore.getState().setRelay(relayNetId, b.nick, false)
                            }
                            className="text-[var(--text-muted)] hover:text-red-400 p-1 shrink-0"
                            title={`Unmark ${b.nick}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ));
                    })()}
                  </div>
                </>
              )}
            </div>
          )}

          {section === '_connection' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Server Connection</h2>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setServerUrl(serverInput);
                  if (window.lurkerDesktop?.setConfig) {
                    await window.lurkerDesktop.setConfig({
                      serverUrl: serverInput,
                      allowSelfSigned,
                    });
                  }
                  useToastsStore.getState().push('Server URL saved', 'success');
                }}
                className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 space-y-3 max-w-md"
              >
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                    Lurker Server URL
                  </label>
                  <input
                    type="url"
                    required
                    value={serverInput}
                    onChange={(e) => setServerInput(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={allowSelfSigned}
                    onChange={(e) => setAllowSelfSigned(e.target.checked)}
                  />
                  Allow self-signed TLS certificate
                </label>
                <button
                  type="submit"
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white"
                >
                  Save Connection
                </button>
              </form>
            </div>
          )}

          {section === '_updates' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Desktop Updates</h2>
              <DesktopUpdaterPanel />
            </div>
          )}

          {!String(section).startsWith('_') && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">
                {CATEGORIES.find((c) => c.id === section)?.label || section}
              </h2>
              {section === 'appearance' && (
                <div
                  className="rounded-xl p-4 flex flex-wrap items-center justify-between gap-3"
                  style={{
                    background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-secondary))',
                    border: '1px solid color-mix(in srgb, var(--accent) 40%, var(--border))',
                  }}
                >
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      Theme Studio & Custom CSS
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      Browse 14+ palettes, live-preview colors with WCAG contrast badges, set wallpapers/glassmorphism, edit custom CSS, or import VS Code / Base16 JSON.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSection('_themes')}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold hover:opacity-90 shrink-0"
                    style={{ background: 'var(--accent)', color: 'var(--bg)' }}
                  >
                    <Palette className="w-3.5 h-3.5" />
                    <span>Open Theme Studio</span>
                  </button>
                </div>
              )}
              <div className="space-y-3">
                {(optionsByCategory[section] || []).map((opt) => {
                  const fullWidth =
                    opt.key === 'look.nick.colors' ||
                    opt.key === 'look.color.mirc_colors' ||
                    opt.type === 'color';
                  return (
                    <div
                      key={opt.key}
                      className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3.5 space-y-2"
                    >
                      <div
                        className={
                          fullWidth
                            ? 'space-y-2'
                            : 'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2'
                        }
                      >
                        <div>
                          <div className="text-sm font-medium text-[var(--text-primary)]">
                            {opt.label}
                          </div>
                          <div className="text-[11px] font-mono text-[var(--text-muted)]">
                            {opt.key}
                          </div>
                        </div>
                        <div className={fullWidth ? 'w-full' : ''}>{renderSettingControl(opt)}</div>
                      </div>
                      {opt.description && (
                        <p className="text-xs text-[var(--text-secondary)]">
                          {opt.description}
                        </p>
                      )}
                    </div>
                  );
                })}
                {section === 'appearance' && (optionsByCategory['avatars']?.length ?? 0) > 0 && (
                  <div className="pt-2 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                        Avatars
                      </h3>
                      {configChecked && !linkPreviewsEnabled && (
                        <p
                          data-testid="avatars-need-previews-note"
                          className="text-xs text-[var(--text-muted)]"
                        >
                          To display avatars, you need <code>lurker-previews</code>.
                        </p>
                      )}
                    </div>
                    {(optionsByCategory['avatars'] || []).map((opt) => (
                      <div
                        key={opt.key}
                        className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3.5 space-y-2"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium text-[var(--text-primary)]">
                              {opt.label}
                            </div>
                            <div className="text-[11px] font-mono text-[var(--text-muted)]">
                              {opt.key}
                            </div>
                          </div>
                          <div>{renderSettingControl(opt)}</div>
                        </div>
                        {opt.description && (
                          <p className="text-xs text-[var(--text-secondary)]">
                            {opt.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
