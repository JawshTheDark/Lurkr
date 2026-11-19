// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { api } from '../api';

export const OAuthAuthorizeView: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const clientId = params.get('client_id') || '';
  const redirectUri = params.get('redirect_uri') || '';
  const scope = params.get('scope') || 'read';
  const state = params.get('state') || '';

  const respond = async (approved: boolean) => {
    setBusy(true);
    setError('');
    try {
      const res = await api('/api/oauth/authorize', {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope,
          state,
          approved,
        }),
      });
      if (res?.redirectTo) {
        window.location.href = res.redirectTo;
      } else {
        navigate('/');
      }
    } catch (err: any) {
      setError(err?.message || 'Authorization request failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] px-4">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6 shadow-2xl">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-6 h-6 text-[var(--accent)]" />
          <div>
            <h1 className="text-lg font-bold text-[var(--text-primary)]">
              Authorize Application
            </h1>
            <p className="text-xs text-[var(--text-muted)]">
              Client <span className="font-mono">{clientId || 'unknown'}</span> requests access
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-3 text-xs space-y-1">
          <div>
            <span className="text-[var(--text-muted)]">Requested scope:</span>{' '}
            <span className="font-mono text-[var(--text-primary)]">{scope}</span>
          </div>
          {redirectUri && (
            <div className="truncate">
              <span className="text-[var(--text-muted)]">Redirect:</span>{' '}
              <span className="font-mono text-[var(--text-primary)]">{redirectUri}</span>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => respond(false)}
            className="flex-1 rounded-lg border border-[var(--border)] py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            Deny
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => respond(true)}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] py-2 text-xs font-medium text-white hover:opacity-90"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Approve
          </button>
        </div>
      </div>
    </div>
  );
};
