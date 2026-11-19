// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  Copy,
  Info,
  Network as NetworkIcon,
  Server,
  Shield,
  Terminal,
} from 'lucide-react';
import { AppModal } from './AppModal';
import { getServerUrl, type DesktopAppInfo } from '../api';
import { useAuthStore } from '../stores/auth';
import { useConfigStore } from '../stores/config';
import { activeBufferFrom, isNetworkOper, useNetworksStore } from '../stores/networks';
import { useToastsStore } from '../stores/toasts';
import { useDesktopUiStore } from '../stores/desktopUi';
import { buildCapabilityContext, formatServerSummary } from '../lib/networkCapabilities';
import { dispatchSlashCommand } from '../lib/commands/dispatch';
import {
  APP_COPYRIGHT,
  APP_DESCRIPTION,
  APP_LICENSE,
  APP_NAME,
  APP_VERSION,
  buildDiagnosticsReport,
} from '../lib/appMeta';

export const AboutModal: React.FC = () => {
  const navigate = useNavigate();
  const open = useDesktopUiStore((s) => s.aboutOpen);
  const tab = useDesktopUiStore((s) => s.aboutTab);
  const close = useDesktopUiStore((s) => s.closeAbout);
  const openAbout = useDesktopUiStore((s) => s.openAbout);
  const openCommands = useDesktopUiStore((s) => s.openCommands);

  const user = useAuthStore((s) => s.user);
  const edition = useConfigStore((s) => s.edition);
  const features = useConfigStore((s) => s.features);

  const activeKey = useNetworksStore((s) => s.activeKey);
  const networks = useNetworksStore((s) => s.networks);
  const states = useNetworksStore((s) => s.states);
  const profiles = useNetworksStore((s) => s.profiles);

  const activeBuffer = useMemo(
    () => activeBufferFrom(activeKey, networks),
    [activeKey, networks],
  );
  const netState = activeBuffer ? states[activeBuffer.networkId] : null;
  const profile = activeBuffer ? profiles[activeBuffer.networkId] : undefined;
  const capCtx = useMemo(
    () =>
      netState
        ? buildCapabilityContext(netState, profile, { target: activeBuffer?.target })
        : null,
    [netState, profile, activeBuffer?.target],
  );
  const capSummary = useMemo(() => (capCtx ? formatServerSummary(capCtx) : null), [capCtx]);

  const [appInfo, setAppInfo] = useState<DesktopAppInfo | null>(null);
  const [allowSelfSigned, setAllowSelfSigned] = useState<boolean>(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    if (window.lurkerDesktop?.getAppInfo) {
      void window.lurkerDesktop.getAppInfo().then(setAppInfo).catch(() => {});
    }
    if (window.lurkerDesktop?.getConfig) {
      void window.lurkerDesktop
        .getConfig()
        .then((cfg) => setAllowSelfSigned(Boolean(cfg.allowSelfSigned)))
        .catch(() => {});
    }
  }, [open]);

  const serverUrl = getServerUrl();

  const handleCopyDiagnostics = async () => {
    const report = buildDiagnosticsReport({
      appInfo,
      serverUrl,
      edition,
      features,
      username: user?.username,
      role: user?.role,
      networkName: activeBuffer?.network?.name,
      networkHost: activeBuffer?.network?.host,
      networkPort: activeBuffer?.network?.port,
      networkTls: activeBuffer?.network?.tls,
      networkState: netState?.state,
      nick: netState?.nick || activeBuffer?.network?.nick,
      lagMs: netState?.lagMs,
      capCtx,
    });
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      useToastsStore.getState().push('Diagnostics copied to clipboard', 'success');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      useToastsStore.getState().push('Could not access clipboard', 'error');
    }
  };

  return (
    <AppModal
      open={open}
      onClose={close}
      title={
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-[var(--accent)]" />
          <span>About {APP_NAME}</span>
        </div>
      }
      maxWidth="max-w-xl"
    >
      <div className="space-y-4">
        {/* Program Identity Header */}
        <div className="flex items-center gap-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-3.5">
          <img
            src="./lurker-icon-192.png"
            alt={APP_NAME}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
            className="w-12 h-12 rounded-xl shrink-0 bg-[var(--bg-secondary)]"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-bold text-[var(--text-primary)]">{APP_NAME}</span>
              <span className="rounded bg-[var(--accent)]/15 px-2 py-0.5 text-[11px] font-mono text-[var(--accent)]">
                v{appInfo?.version || APP_VERSION}
              </span>
              <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-muted)]">
                {APP_LICENSE}
              </span>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">{APP_DESCRIPTION}</p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{APP_COPYRIGHT}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[var(--border)]">
          <button
            type="button"
            onClick={() => openAbout('program')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
              tab === 'program'
                ? 'border-[var(--accent)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            Program &amp; Runtime
          </button>
          <button
            type="button"
            onClick={() => openAbout('network')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
              tab === 'network'
                ? 'border-[var(--accent)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <NetworkIcon className="w-3.5 h-3.5" />
            Active IRC Network &amp; CAPs
          </button>
        </div>

        {tab === 'program' ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] divide-y divide-[var(--border)] text-xs">
              <div className="flex items-center justify-between px-3 py-2 gap-3">
                <span className="text-[var(--text-muted)]">Lurkr Server</span>
                <span className="font-mono text-[var(--text-primary)] truncate">
                  {serverUrl || 'Not configured'}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2 gap-3">
                <span className="text-[var(--text-muted)]">Server Edition</span>
                <span className="font-mono text-[var(--text-primary)] capitalize">{edition}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2 gap-3">
                <span className="text-[var(--text-muted)]">Signed-in Account</span>
                <span className="text-[var(--text-primary)]">
                  {user ? `${user.username} (${user.role})` : 'Signed out'}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2 gap-3">
                <span className="text-[var(--text-muted)]">Server Features</span>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px]">
                    Previews: {features.linkPreviews ? 'On' : 'Off'}
                  </span>
                  <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px]">
                    Bouncer: {features.bouncer ? 'On' : 'Off'}
                  </span>
                  <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px]">
                    DCC: {features.dcc ? 'On' : 'Off'}
                  </span>
                </div>
              </div>
              {appInfo && (
                <>
                  <div className="flex items-center justify-between px-3 py-2 gap-3">
                    <span className="text-[var(--text-muted)]">Desktop Stack</span>
                    <span className="font-mono text-[11px] text-[var(--text-primary)]">
                      Electron {appInfo.electron} · Chromium {appInfo.chrome} · Node {appInfo.node}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 gap-3">
                    <span className="text-[var(--text-muted)]">Platform &amp; Session</span>
                    <span className="font-mono text-[11px] text-[var(--text-primary)]">
                      {appInfo.platform} ({appInfo.arch})
                      {appInfo.sessionType ? ` · ${appInfo.sessionType}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 gap-3">
                    <span className="text-[var(--text-muted)]">Self-Signed TLS</span>
                    <span className="text-[var(--text-primary)]">
                      {allowSelfSigned ? 'Allowed' : 'Strict Verification'}
                    </span>
                  </div>
                  <div className="px-3 py-2 space-y-0.5">
                    <div className="text-[var(--text-muted)]">User Data Directory</div>
                    <div className="font-mono text-[11px] text-[var(--text-secondary)] break-all">
                      {appInfo.userDataPath}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {activeBuffer?.network && netState ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-3.5 space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[11px] text-[var(--text-muted)]">Network</div>
                    <div className="font-semibold text-[var(--text-primary)]">
                      {activeBuffer.network.name}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[var(--text-muted)]">Endpoint</div>
                    <div className="font-mono text-[var(--text-primary)]">
                      {activeBuffer.network.host}:{activeBuffer.network.port}
                      {activeBuffer.network.tls ? ' (TLS)' : ''}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[var(--text-muted)]">Status &amp; Latency</div>
                    <div className="text-[var(--text-primary)]">
                      {netState.state || 'disconnected'}
                      {typeof netState.lagMs === 'number' ? ` · ${netState.lagMs}ms` : ''}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[var(--text-muted)]">Nick &amp; User Modes</div>
                    <div className="font-mono text-[var(--text-primary)] flex items-center gap-1.5">
                      <span>{netState.nick || activeBuffer.network.nick}</span>
                      {capSummary && <span>({capSummary.modesLabel})</span>}
                      {isNetworkOper(netState) && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                          <Shield className="w-2.5 h-2.5" /> OPER
                        </span>
                      )}
                    </div>
                  </div>
                  {capSummary && (
                    <>
                      <div>
                        <div className="text-[11px] text-[var(--text-muted)]">IRCd Software</div>
                        <div className="text-[var(--text-primary)]">{capSummary.softwareLabel}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-[var(--text-muted)]">Services</div>
                        <div className="text-[var(--text-primary)]">{capSummary.servicesLabel}</div>
                      </div>
                    </>
                  )}
                </div>

                {capSummary && capSummary.capsList.length > 0 && (
                  <div className="space-y-1 border-t border-[var(--border)] pt-2.5">
                    <div className="text-[11px] text-[var(--text-muted)]">
                      Negotiated IRCv3 CAPs ({capSummary.capsCount})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {capSummary.capsList.map((cap) => (
                        <span
                          key={cap}
                          className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]"
                        >
                          {cap}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {capSummary && capSummary.isupportHighlights.length > 0 && (
                  <div className="space-y-1 border-t border-[var(--border)] pt-2.5">
                    <div className="text-[11px] text-[var(--text-muted)]">ISUPPORT Highlights</div>
                    <div className="flex flex-wrap gap-1">
                      {capSummary.isupportHighlights.map((tok) => (
                        <span
                          key={tok}
                          className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]"
                        >
                          {tok}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-5 text-center text-xs text-[var(--text-muted)]">
                Connect and select an IRC network to inspect its IRCd software, CAPs, and ISUPPORT tokens.
              </div>
            )}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyDiagnostics}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy Diagnostics'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                close();
                openCommands();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>IRC Commands</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            {activeBuffer && netState?.state === 'connected' && (
              <button
                type="button"
                onClick={() => {
                  void dispatchSlashCommand('/version', activeBuffer.networkId, activeBuffer.target);
                  useToastsStore.getState().push('Requested /VERSION from server', 'info');
                }}
                className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                Query /VERSION
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                close();
                if (user) {
                  useDesktopUiStore.getState().requestSettingsSection('_connection');
                  navigate('/settings');
                } else {
                  useDesktopUiStore.getState().triggerLoginServerConfig();
                  navigate('/login');
                }
              }}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              Connection Settings
            </button>
          </div>
        </div>
      </div>
    </AppModal>
  );
};
