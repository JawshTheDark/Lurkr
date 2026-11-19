// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { KeyRound, Lock, Loader2 } from 'lucide-react';
import { useAuthStore } from '../stores/auth';

export const InviteAcceptView: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'password' | 'passkey'>('password');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const ok =
        mode === 'passkey'
          ? await useAuthStore.getState().acceptInvite({ token, username: username.trim() })
          : await useAuthStore
              .getState()
              .acceptInviteWithPassword({ token, username: username.trim(), password });
      if (ok) {
        navigate('/');
      } else {
        setError(useAuthStore.getState().error || 'Failed to accept invite');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to accept invite');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] px-4">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6 shadow-2xl">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Accept Invitation</h1>
          <p className="text-xs text-[var(--text-muted)]">
            Set up your Lurkr account to join
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 rounded-lg bg-[var(--bg-primary)] p-1 border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setMode('password')}
            className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium ${
              mode === 'password'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            <Lock className="w-3.5 h-3.5" /> Password
          </button>
          <button
            type="button"
            onClick={() => setMode('passkey')}
            className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium ${
              mode === 'passkey'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" /> Passkey
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Username
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          {mode === 'password' && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
            Create Account
          </button>
        </form>
      </div>
    </div>
  );
};
