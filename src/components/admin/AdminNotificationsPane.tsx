// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useState } from 'react';
import { RefreshCw, Copy } from 'lucide-react';
import { useAdminStore, type AdminPresenceRow } from '../../stores/admin';
import { useToastsStore } from '../../stores/toasts';
import type { RelayStatus } from '../../shared/relayStatus';
import { formatDateTime } from '../../utils/timestamp';
import {
  clientText,
  kindLabel,
  outcomeLabel,
  pushLogText,
  subjectLabel,
} from '../../utils/pushLog';

function describeRelayStatus(s: RelayStatus, host: string): { text: string; ok: boolean } {
  switch (s.state) {
    case 'active':
      if (s.comped) return { text: 'Comped', ok: true };
      if (s.paidThrough) return { text: `Active — paid through ${s.paidThrough.slice(0, 10)}`, ok: true };
      return { text: 'Active', ok: true };
    case 'inactive':
      return s.registered
        ? { text: `This server's key is not active on ${host}`, ok: false }
        : { text: `${host} does not recognize this server's key`, ok: false };
    case 'unauthorized':
      return { text: `${host} could not verify this server's key`, ok: false };
    case 'refused':
      return { text: `${host} refused status check (HTTP ${s.httpStatus})`, ok: false };
    case 'unreachable':
      return { text: `Could not reach ${host}`, ok: false };
  }
}

function socketSummary(row: AdminPresenceRow): string {
  const n = row.openSockets === 1 ? '1 client' : `${row.openSockets} clients`;
  return row.visibleSockets ? `${n}, ${row.visibleSockets} visible` : `${n}, none visible`;
}

export const AdminNotificationsPane: React.FC = () => {
  const push = useAdminStore((s) => s.pushConfig);
  const relayStatus = useAdminStore((s) => s.relayStatus);
  const presence = useAdminStore((s) => s.presence);
  const presenceLoaded = useAdminStore((s) => s.presenceLoaded);
  const pushLog = useAdminStore((s) => s.pushLog);
  const pushLogLoaded = useAdminStore((s) => s.pushLogLoaded);
  const pushLogHasMore = useAdminStore((s) => s.pushLogHasMore);

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedLog, setCopiedLog] = useState(false);

  const loadPresenceAndLog = () => {
    void useAdminStore.getState().fetchPushLog().catch(() => {});
    void useAdminStore.getState().fetchPresence().catch(() => {});
  };

  useEffect(() => {
    setError('');
    void (async () => {
      try {
        await useAdminStore.getState().fetchPushConfig();
        if (useAdminStore.getState().pushConfig?.relay?.enabled) {
          useAdminStore.getState().refreshRelayStatus().catch(() => {});
        }
      } catch (err: any) {
        setError(err?.message || 'Failed to load notification settings');
      }
      loadPresenceAndLog();
    })();
  }, []);

  const isNative = Boolean(
    push?.transports?.includes('apns') && push?.transports?.includes('fcm'),
  );
  let relayHost = 'push.lurker.chat';
  if (push?.relay?.url) {
    try {
      relayHost = new URL(push.relay.url).host;
    } catch {
      relayHost = push.relay.url;
    }
  }
  const statusInfo = relayStatus ? describeRelayStatus(relayStatus, relayHost) : null;
  const deviceCount = push?.relay?.devices ?? 0;

  return (
    <div className="space-y-5 text-xs">
      <div>
        <h2 className="text-sm font-semibold">Notifications</h2>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Push relay configuration, connected clients, and recent push delivery activity.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400">
          {error}
        </div>
      )}

      {push && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 space-y-3">
          {push.vapidSubject && !push.vapidSubject.appleAccepts && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400">
              Safari and home-screen web apps on iPhone will refuse web push until{' '}
              <code>VAPID_SUBJECT</code> is set to a <code>mailto:</code> address or{' '}
              <code>https://</code> URL.
            </div>
          )}

          {isNative ? (
            <p className="text-[var(--text-secondary)]">
              This server sends notifications to browsers and official mobile apps directly.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-[var(--text-secondary)]">
                Browsers receive notifications directly. iOS and Android apps use{' '}
                <strong className="text-[var(--text-primary)]">{relayHost}</strong> to forward encrypted push payloads.
              </p>

              <div className="space-y-1">
                <div className="text-[11px] font-medium text-[var(--text-muted)]">Server Key</div>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="flex-1 truncate rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2.5 py-1.5 font-mono text-[11px] select-all">
                    {push.publicKey}
                  </code>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard?.writeText(push.publicKey).catch(() => {});
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 1500);
                    }}
                    className="rounded-lg border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--bg-hover)]"
                  >
                    {copiedKey ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={checking || busy}
                  onClick={async () => {
                    setError('');
                    setChecking(true);
                    try {
                      await useAdminStore.getState().checkPushRelay();
                    } catch (err: any) {
                      setError(err?.message || 'Failed to check relay registration');
                    } finally {
                      setChecking(false);
                    }
                  }}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--bg-hover)]"
                >
                  {checking ? 'Checking...' : 'Check Registration'}
                </button>
                {statusInfo && (
                  <span className={statusInfo.ok ? 'text-emerald-400' : 'text-red-400'}>
                    {statusInfo.text}
                  </span>
                )}
              </div>
            </div>
          )}

          {(!isNative || push.relay?.enabled) && (
            <div className="pt-2 border-t border-[var(--border)] space-y-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!push.relay?.enabled}
                  disabled={busy || checking}
                  onChange={async (e) => {
                    const enabled = e.target.checked;
                    if (
                      !enabled &&
                      deviceCount > 0 &&
                      typeof window.confirm === 'function' &&
                      !window.confirm(`Turn off the relay? ${deviceCount} registered device(s) will stop getting notifications.`)
                    ) {
                      return;
                    }
                    setError('');
                    setBusy(true);
                    try {
                      await useAdminStore.getState().setPushRelayEnabled(enabled);
                    } catch (err: any) {
                      setError(err?.message || 'Failed to toggle push relay');
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
                <span>Use {relayHost} for iOS and Android apps</span>
              </label>
              <div className="text-[11px] text-[var(--text-muted)]">
                {push.relay?.enabled
                  ? `${deviceCount} ${deviceCount === 1 ? 'device' : 'devices'} registered through the relay.`
                  : `While disabled, mobile apps do not contact ${relayHost}.`}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Connected Clients ({presence.length})
          </h3>
          <button
            type="button"
            onClick={loadPresenceAndLog}
            className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--bg-hover)]"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {!presenceLoaded ? (
          <div className="text-[var(--text-muted)]">Loading connected clients...</div>
        ) : presence.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 text-[var(--text-muted)]">
            Nobody is connected.
          </div>
        ) : (
          <div className="space-y-2">
            {presence.map((row) => (
              <div
                key={row.userId}
                className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2.5 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[var(--text-primary)]">
                    {row.username || `User #${row.userId}`}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">{socketSummary(row)}</span>
                </div>
                <ul className="space-y-0.5 text-[11px] text-[var(--text-muted)]">
                  {row.sockets.map((c, idx) => (
                    <li key={idx}>{clientText(c)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Recent Pushes
          </h3>
          <button
            type="button"
            disabled={pushLog.length === 0}
            onClick={async () => {
              await navigator.clipboard?.writeText(pushLogText(pushLog)).catch(() => {});
              setCopiedLog(true);
              setTimeout(() => setCopiedLog(false), 1500);
              useToastsStore.getState().push('Push log copied', 'info');
            }}
            className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--bg-hover)] disabled:opacity-45"
          >
            <Copy className="w-3 h-3" /> {copiedLog ? 'Copied' : 'Copy Log'}
          </button>
        </div>

        {!pushLogLoaded ? (
          <div className="text-[var(--text-muted)]">Loading push log...</div>
        ) : pushLog.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 text-[var(--text-muted)]">
            Nothing in the last week.
          </div>
        ) : (
          <div className="space-y-1.5">
            {pushLog.map((row) => (
              <div
                key={row.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-[11px] flex flex-wrap items-baseline justify-between gap-2"
              >
                <div className="min-w-0">
                  <span className="font-medium text-[var(--text-primary)]">
                    {row.username || `user ${row.user_id}`}
                  </span>{' '}
                  <span className="text-[var(--text-secondary)]">
                    {kindLabel(row.kind)} · {subjectLabel(row)}
                  </span>{' '}
                  <span
                    className={
                      row.outcome === 'failed'
                        ? 'text-red-400'
                        : row.outcome === 'sent'
                          ? 'text-emerald-400'
                          : 'text-[var(--text-muted)]'
                    }
                  >
                    — {outcomeLabel(row)}
                  </span>
                </div>
                <span className="text-[var(--text-muted)] shrink-0">{formatDateTime(row.at)}</span>
              </div>
            ))}
          </div>
        )}

        {pushLogHasMore && (
          <button
            type="button"
            disabled={olderBusy}
            onClick={async () => {
              setOlderBusy(true);
              try {
                await useAdminStore.getState().fetchOlderPushLog();
              } catch (err: any) {
                setError(err?.message || 'Failed to load older push rows');
              } finally {
                setOlderBusy(false);
              }
            }}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--bg-hover)]"
          >
            {olderBusy ? 'Loading...' : 'Show Older'}
          </button>
        )}
      </div>
    </div>
  );
};
