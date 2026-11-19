// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Lock, Server, ShieldCheck, Loader2 } from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { useConfigStore } from '../stores/config';
import { getServerUrl, setServerUrl } from '../api';
import { useToastsStore } from '../stores/toasts';
import { useDesktopUiStore } from '../stores/desktopUi';

export const LoginView: React.FC = () => {
  const navigate = useNavigate();
  const setupStatus = useAuthStore((s) => s.setupStatus);
  const authError = useAuthStore((s) => s.error);

  const [serverInput, setServerInput] = useState(getServerUrl() || 'http://localhost:3000');
  const [allowSelfSigned, setAllowSelfSigned] = useState(false);
  const [showServerConfig, setShowServerConfig] = useState(!getServerUrl() || Boolean(authError));

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'password' | 'passkey'>('password');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const loginShowServerConfigNonce = useDesktopUiStore((s) => s.loginShowServerConfigNonce);

  useEffect(() => {
    if (loginShowServerConfigNonce > 0) {
      setShowServerConfig(true);
    }
  }, [loginShowServerConfigNonce]);

  useEffect(() => {
    if (window.lurkerDesktop?.getConfig) {
      window.lurkerDesktop.getConfig().then((cfg) => {
        if (cfg.serverUrl) setServerInput(cfg.serverUrl);
        setAllowSelfSigned(!!cfg.allowSelfSigned);
      });
    }
  }, []);

  useEffect(() => {
    if (getServerUrl() || typeof window.lurkerDesktop === 'undefined') {
      useAuthStore.getState().fetchSetupStatus();
    }
  }, []);

  const handleSaveServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    try {
      setServerUrl(serverInput);
      if (window.lurkerDesktop?.setConfig) {
        await window.lurkerDesktop.setConfig({ serverUrl: serverInput, allowSelfSigned });
      }
      useAuthStore.setState({ error: null });
      await useConfigStore.getState().fetch();
      await useAuthStore.getState().fetchSetupStatus();
      setShowServerConfig(false);
      useToastsStore.getState().push('Connected to server', 'success');
    } catch (err: any) {
      setLocalError(err?.message || 'Failed to connect to server');
    }
  };

  const needsSetup = setupStatus?.needsSetup === true;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    setBusy(true);
    try {
      let ok = false;
      if (needsSetup) {
        if (authMode === 'passkey') {
          ok = Boolean(
            await useAuthStore.getState().setupFirstPasskey({ username: username.trim() }),
          );
        } else {
          ok = Boolean(
            await useAuthStore
              .getState()
              .setupFirstPassword({ username: username.trim(), password }),
          );
        }
      } else {
        if (authMode === 'passkey') {
          ok = Boolean(await useAuthStore.getState().loginWithPasskey());
        } else {
          ok = Boolean(
            await useAuthStore
              .getState()
              .loginWithPassword({ username: username.trim(), password }),
          );
        }
      }
      if (ok) {
        navigate('/');
      }
    } catch (err: any) {
      setLocalError(err?.message || 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] px-4 py-8">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6 shadow-2xl">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Lurkr
          </h1>
          <p className="text-xs text-[var(--text-muted)]">
            {needsSetup ? 'Create your administrator account' : 'Sign in to your IRC bouncer'}
          </p>
        </div>

        {/* Electron Server URL Configuration */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-[var(--text-secondary)] min-w-0">
              <Server className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
              <span className="truncate font-mono">
                {getServerUrl() || 'No server configured'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowServerConfig((v) => !v)}
              className="text-[var(--accent)] hover:underline shrink-0 ml-2"
            >
              {showServerConfig ? 'Hide' : 'Change'}
            </button>
          </div>

          {showServerConfig && (
            <form onSubmit={handleSaveServer} className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
              <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                Lurker Server URL
              </label>
              <input
                type="url"
                required
                value={serverInput}
                onChange={(e) => setServerInput(e.target.value)}
                placeholder="https://irc.example.com"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
              <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowSelfSigned}
                  onChange={(e) => setAllowSelfSigned(e.target.checked)}
                />
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                Allow self-signed TLS certificate
              </label>
              <button
                type="submit"
                className="w-full rounded-lg bg-[var(--accent)] py-1.5 text-xs font-medium text-white hover:opacity-90"
              >
                Connect to Server
              </button>
            </form>
          )}
        </div>

        {(localError || authError) && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {localError || authError}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 rounded-lg bg-[var(--bg-primary)] p-1 border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setAuthMode('password')}
            className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium ${
              authMode === 'password'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Lock className="w-3.5 h-3.5" /> Password
          </button>
          <button
            type="button"
            onClick={() => setAuthMode('passkey')}
            className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium ${
              authMode === 'passkey'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" /> Passkey
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Username {authMode === 'passkey' && !needsSetup ? '(optional)' : ''}
            </label>
            <input
              type="text"
              required={authMode === 'password' || needsSetup}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              autoComplete="username"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>

          {authMode === 'password' && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={needsSetup ? 'new-password' : 'current-password'}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {needsSetup
              ? authMode === 'passkey'
                ? 'Create Admin with Passkey'
                : 'Create Admin Account'
              : authMode === 'passkey'
                ? 'Sign in with Passkey'
                : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};
