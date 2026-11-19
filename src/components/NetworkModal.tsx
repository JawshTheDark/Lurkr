// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useMemo, useState } from 'react';
import { Server, Shield, Search, KeyRound, Trash2 } from 'lucide-react';
import { AppModal } from './AppModal';
import { useNetworksStore, type Network } from '../stores/networks';
import { useToastsStore } from '../stores/toasts';
import {
  builtinNetworks as BUILTIN_NETWORKS,
  builtinNetworkTags as BUILTIN_TAGS,
  type BuiltinNetwork,
} from '../utils/builtinNetworks';

interface NetworkModalProps {
  open: boolean;
  editingNetwork?: Network | null;
  onClose: () => void;
}

export const NetworkModal: React.FC<NetworkModalProps> = ({
  open,
  editingNetwork,
  onClose,
}) => {
  const isEdit = !!editingNetwork;

  const [showPresets, setShowPresets] = useState(!isEdit);
  const [presetQuery, setPresetQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('all');

  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(6697);
  const [tls, setTls] = useState(true);
  const [rejectUnauthorized, setRejectUnauthorized] = useState(true);
  const [nick, setNick] = useState('');
  const [username, setUsername] = useState('');
  const [realname, setRealname] = useState('');
  const [password, setPassword] = useState('');
  const [saslUsername, setSaslUsername] = useState('');
  const [saslPassword, setSaslPassword] = useState('');
  const [autoConnect, setAutoConnect] = useState(true);
  const [channels, setChannels] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editingNetwork) {
      setShowPresets(false);
      setName(String(editingNetwork.name || ''));
      setHost(String(editingNetwork.host || ''));
      setPort(Number(editingNetwork.port || 6697));
      setTls(Boolean(editingNetwork.tls ?? true));
      setRejectUnauthorized(Boolean(editingNetwork.rejectUnauthorized ?? true));
      setNick(String(editingNetwork.nick || ''));
      setUsername(String(editingNetwork.username || ''));
      setRealname(String(editingNetwork.realname || ''));
      setPassword('');
      setSaslUsername(String(editingNetwork.saslUsername || ''));
      setSaslPassword('');
      setAutoConnect(Boolean(editingNetwork.autoConnect ?? true));
      setChannels('');
    } else {
      setShowPresets(true);
      setName('');
      setHost('');
      setPort(6697);
      setTls(true);
      setRejectUnauthorized(true);
      setNick('');
      setUsername('');
      setRealname('');
      setPassword('');
      setSaslUsername('');
      setSaslPassword('');
      setAutoConnect(true);
      setChannels('');
    }
  }, [open, editingNetwork]);

  const filteredBuiltins = useMemo(() => {
    const q = presetQuery.trim().toLowerCase();
    return BUILTIN_NETWORKS.filter((b) => {
      if (selectedTag !== 'all' && !b.tags.includes(selectedTag)) return false;
      if (!q) return true;
      return (
        b.name.toLowerCase().includes(q) ||
        b.host.toLowerCase().includes(q) ||
        b.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [presetQuery, selectedTag]);

  const applyPreset = (b: BuiltinNetwork) => {
    setName(b.name);
    setHost(b.host);
    setPort(b.port);
    setTls(b.tls);
    if (b.defaultChannel) setChannels(b.defaultChannel);
    setShowPresets(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim() || !host.trim() || !nick.trim()) {
      setError('Name, host, and nickname are required.');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        name: name.trim(),
        host: host.trim(),
        port: Number(port) || (tls ? 6697 : 6667),
        tls,
        rejectUnauthorized,
        nick: nick.trim(),
        username: username.trim() || nick.trim(),
        realname: realname.trim() || nick.trim(),
        autoConnect,
      };
      if (password) payload.password = password;
      if (saslUsername.trim()) payload.saslUsername = saslUsername.trim();
      if (saslPassword) payload.saslPassword = saslPassword;
      if (!isEdit && channels.trim()) {
        payload.channels = channels
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean);
      }

      if (isEdit && editingNetwork) {
        await useNetworksStore.getState().update(editingNetwork.id, payload);
        useToastsStore.getState().push('Network updated', 'success');
      } else {
        const created = await useNetworksStore.getState().create(payload);
        if (autoConnect && created?.id) {
          await useNetworksStore.getState().connect(created.id);
        }
        useToastsStore.getState().push(`Added ${name.trim()}`, 'success');
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save network');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingNetwork) return;
    setSaving(true);
    try {
      await useNetworksStore.getState().remove(editingNetwork.id);
      useToastsStore.getState().push('Network deleted', 'info');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete network');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${editingNetwork?.name}` : 'Add IRC Network'}
      maxWidth="max-w-xl"
    >
      {!isEdit && (
        <div className="mb-4 flex gap-2 border-b border-[var(--border)] pb-2">
          <button
            type="button"
            onClick={() => setShowPresets(true)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              showPresets
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            Browse Networks
          </button>
          <button
            type="button"
            onClick={() => setShowPresets(false)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              !showPresets
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            Custom Server
          </button>
        </div>
      )}

      {showPresets && !isEdit ? (
        <div className="space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
            <input
              type="text"
              value={presetQuery}
              onChange={(e) => setPresetQuery(e.target.value)}
              placeholder="Search networks (Libera, OFTC, EFNet...)"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] pl-8 pr-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedTag('all')}
              className={`rounded-full px-2.5 py-0.5 text-xs ${
                selectedTag === 'all'
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--border)]'
              }`}
            >
              All
            </button>
            {BUILTIN_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTag(tag)}
                className={`rounded-full px-2.5 py-0.5 text-xs ${
                  selectedTag === tag
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--border)]'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>

          <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
            {filteredBuiltins.map((b) => (
              <button
                key={b.host}
                type="button"
                onClick={() => applyPreset(b)}
                className="w-full flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-left hover:border-[var(--accent)]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-medium text-sm text-[var(--text-primary)]">
                    <Server className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                    <span className="truncate">{b.name}</span>
                    {b.saslLikelyRequired && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
                        SASL
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] truncate">
                    {b.host}:{b.port} {b.tls ? '(TLS)' : ''}
                  </div>
                </div>
                {b.users != null && (
                  <span className="text-xs text-[var(--text-muted)] shrink-0">
                    ~{b.users.toLocaleString()} users
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Network Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Libera.Chat"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Nickname
              </label>
              <input
                type="text"
                required
                value={nick}
                onChange={(e) => setNick(e.target.value)}
                placeholder="yournick"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Server Host
              </label>
              <input
                type="text"
                required
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="irc.libera.chat"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Port
              </label>
              <input
                type="number"
                required
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-[var(--text-secondary)]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={tls}
                onChange={(e) => {
                  setTls(e.target.checked);
                  if (port === 6667 && e.target.checked) setPort(6697);
                  if (port === 6697 && !e.target.checked) setPort(6667);
                }}
              />
              <Shield className="w-3.5 h-3.5 text-[var(--accent)]" /> Use TLS / SSL
            </label>
            {tls && (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!rejectUnauthorized}
                  onChange={(e) => setRejectUnauthorized(!e.target.checked)}
                />
                Allow self-signed cert
              </label>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoConnect}
                onChange={(e) => setAutoConnect(e.target.checked)}
              />
              Auto-connect
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Username (Ident)
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Realname (GECOS)
              </label>
              <input
                type="text"
                value={realname}
                onChange={(e) => setRealname(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-2.5 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
              <KeyRound className="w-3.5 h-3.5" /> Authentication (Optional)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={saslUsername}
                onChange={(e) => setSaslUsername(e.target.value)}
                placeholder="SASL username"
                className="w-full rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
              <input
                type="password"
                value={saslPassword}
                onChange={(e) => setSaslPassword(e.target.value)}
                placeholder={isEdit ? 'SASL password (leave blank to keep)' : 'SASL password'}
                className="w-full rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit ? 'Server password (leave blank to keep)' : 'Server password (PASS)'}
              className="w-full rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>

          {!isEdit && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Channels to join (comma-separated)
              </label>
              <input
                type="text"
                value={channels}
                onChange={(e) => setChannels(e.target.value)}
                placeholder="#lurker, #chat"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            {isEdit ? (
              <button
                type="button"
                disabled={saving}
                onClick={handleDelete}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete Network
              </button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Network'}
              </button>
            </div>
          </div>
        </form>
      )}
    </AppModal>
  );
};
