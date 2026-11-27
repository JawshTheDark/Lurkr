// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useMemo } from 'react';
import { Upload, WifiOff, Shield } from 'lucide-react';
import { activeBufferFrom, isNetworkOper, useNetworksStore } from '../stores/networks';
import { useOperStore } from '../stores/oper';
import { useUploadsStore } from '../stores/uploads';
import { useSocketConnected } from '../services/socket';
import { useAuthStore } from '../stores/auth';
import { useScrollStateStore } from '../stores/scrollState';

interface StatusBarProps {
  onOpenUploads?: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({ onOpenUploads }) => {
  const wsConnected = useSocketConnected();
  const activeKey = useNetworksStore((s) => s.activeKey);
  const networks = useNetworksStore((s) => s.networks);
  const activeBuffer = useMemo(
    () => activeBufferFrom(activeKey, networks),
    [activeKey, networks],
  );
  const states = useNetworksStore((s) => s.states);
  const uploadCurrent = useUploadsStore((s) => s.current);
  const failedAt = useUploadsStore((s) => s.failedAt);
  const failedMessage = useUploadsStore((s) => s.failedMessage);
  const isPaused = useAuthStore((s) => s.isPaused());
  const unreadAnchor = useScrollStateStore((s) => s.unreadAnchor);

  const netState = activeBuffer ? states[activeBuffer.networkId] : null;
  const isOper = isNetworkOper(netState);
  const lagMs = netState?.lagMs;
  const sendQueue =
    (netState?.sendPending?.length ?? 0) > 0
      ? netState!.sendPending!.length
      : (netState?.sendQueueWaiting ?? 0);
  const away = netState?.away;

  const renderUploadStatus = () => {
    if (uploadCurrent) {
      let label = `Uploading: ${uploadCurrent.progress}%`;
      if (uploadCurrent.phase === 'processing') {
        label = uploadCurrent.destination
          ? `Processing (${uploadCurrent.destination})…`
          : 'Processing…';
      } else if (uploadCurrent.phase === 'sending') {
        const dest = uploadCurrent.destination ? ` to ${uploadCurrent.destination}` : '';
        const pct = uploadCurrent.sentPercent != null ? ` ${uploadCurrent.sentPercent}%` : '…';
        label = `Sending${dest}${pct}`;
      }
      return (
        <span
          className="status-upload"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--accent)' }}
        >
          <Upload size={12} />
          <span>{label}</span>
        </span>
      );
    }
    if (failedAt) {
      return (
        <span
          title={failedMessage}
          onClick={onOpenUploads}
          style={{ color: 'var(--bad)', cursor: onOpenUploads ? 'pointer' : 'default' }}
        >
          Upload failed{failedMessage ? `: ${failedMessage}` : ''}
        </span>
      );
    }
    return null;
  };

  return (
    <div
      className="status-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '3px 12px',
        fontSize: '0.78em',
        background: 'var(--bg-soft)',
        borderTop: '1px solid var(--border)',
        color: 'var(--fg-muted)',
        gap: '12px',
        minHeight: '24px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        {!wsConnected && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--bad)' }}>
            <WifiOff size={12} /> Reconnecting…
          </span>
        )}
        {isPaused && (
          <span style={{ color: 'var(--warn)', fontWeight: 600 }}>Account paused (read-only)</span>
        )}
        {activeBuffer && netState && (
          <>
            {isOper && (
              <button
                type="button"
                data-testid="statusbar-oper-badge"
                onClick={() =>
                  useOperStore.getState().openModal({ tab: 'bans', networkId: activeBuffer.networkId })
                }
                title="IRC Operator active — click to open Oper Control Center"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  border: '1px solid rgba(245, 158, 11, 0.45)',
                  background: 'rgba(245, 158, 11, 0.16)',
                  color: '#fbbf24',
                  fontWeight: 700,
                  fontSize: '0.9em',
                  cursor: 'pointer',
                }}
              >
                <Shield size={10} />
                OPER
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                useOperStore.getState().openModal({
                  tab: isOper ? 'bans' : 'auth',
                  networkId: activeBuffer.networkId,
                })
              }
              title={
                isOper
                  ? 'Click to open Oper Control Center'
                  : netState.state === 'connected'
                    ? 'Click to authenticate as IRC Operator (/oper)'
                    : undefined
              }
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                color: 'inherit',
                font: 'inherit',
                cursor: netState.state === 'connected' ? 'pointer' : 'default',
              }}
            >
              {netState.nick || activeBuffer.network?.nick || ''}
              {netState.userModes ? ` (+${netState.userModes})` : ''}
            </button>
            {away?.active && (
              <span style={{ color: 'var(--warn)' }} title={away.message || 'Away'}>
                [away]
              </span>
            )}
            <span>
              {activeBuffer.network?.name || ''}:{' '}
              <strong style={{ color: netState.state === 'connected' ? 'var(--good)' : 'var(--fg-muted)' }}>
                {netState.state || 'disconnected'}
              </strong>
            </span>
            {typeof lagMs === 'number' && <span>{lagMs}ms</span>}
            {sendQueue > 0 && <span style={{ color: 'var(--warn)' }}>Queue: {sendQueue}</span>}
          </>
        )}
        {activeBuffer && unreadAnchor && (
          <button
            type="button"
            className="seg-jump-unread"
            data-testid="statusbar-jump-unread"
            title="Jump to unread messages"
            onClick={() => useScrollStateStore.getState().requestScrollToUnread()}
          >
            {unreadAnchor === 'down' ? 'Unread ↓' : 'Unread ↑'}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>{renderUploadStatus()}</div>
    </div>
  );
};
