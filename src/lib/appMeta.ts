// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import type { DesktopAppInfo } from '../api';
import type { CapabilityContext } from './networkCapabilities';
import { formatServerSummary } from './networkCapabilities';

export const APP_NAME = 'Lurkr';
export const APP_VERSION =
  typeof __LURKR_VERSION__ !== 'undefined' && __LURKR_VERSION__ ? __LURKR_VERSION__ : '2.7.16';
export const APP_LICENSE = 'MPL-2.0';
export const APP_COPYRIGHT = 'Copyright (c) 2026 Brad Root';
export const APP_DESCRIPTION = 'Standalone React desktop client for Lurker IRC with full parity';

export interface DiagnosticsInput {
  appInfo?: DesktopAppInfo | null;
  serverUrl: string;
  edition: string;
  features: { linkPreviews: boolean; bouncer: boolean; dcc: boolean };
  username?: string | null;
  role?: string | null;
  networkName?: string;
  networkHost?: string;
  networkPort?: number;
  networkTls?: boolean;
  networkState?: string;
  nick?: string;
  lagMs?: number | null;
  capCtx?: CapabilityContext | null;
}

export function buildDiagnosticsReport(input: DiagnosticsInput): string {
  const lines: string[] = [
    `${APP_NAME} v${input.appInfo?.version || APP_VERSION} (${APP_LICENSE})`,
  ];
  if (input.appInfo) {
    lines.push(
      `Runtime: Electron ${input.appInfo.electron} / Chromium ${input.appInfo.chrome} / Node ${input.appInfo.node}`,
      `Platform: ${input.appInfo.platform} (${input.appInfo.arch})${
        input.appInfo.sessionType ? ` [${input.appInfo.sessionType}]` : ''
      }`,
      `User Data: ${input.appInfo.userDataPath}`,
    );
  }
  lines.push(
    `Lurkr Server: ${input.serverUrl || '(not set)'}`,
    `Edition: ${input.edition} | Account: ${input.username || '(signed out)'}${
      input.role ? ` (${input.role})` : ''
    }`,
    `Features: previews=${input.features.linkPreviews}, bouncer=${input.features.bouncer}, dcc=${input.features.dcc}`,
  );
  if (input.networkName) {
    const endpoint = input.networkHost
      ? `${input.networkHost}:${input.networkPort ?? ''}${input.networkTls ? ' (TLS)' : ''}`
      : '';
    lines.push(
      `Active Network: ${input.networkName}${endpoint ? ` [${endpoint}]` : ''} — ${input.networkState || 'unknown'}${
        input.nick ? ` as ${input.nick}` : ''
      }${typeof input.lagMs === 'number' ? ` (${input.lagMs}ms)` : ''}`,
    );
  }
  if (input.capCtx) {
    const summary = formatServerSummary(input.capCtx);
    lines.push(
      `IRCd: ${summary.softwareLabel} | Services: ${summary.servicesLabel} | Modes: ${summary.modesLabel}`,
      `CAPs (${summary.capsCount}): ${summary.capsList.join(', ') || '(none)'}`,
    );
    if (summary.isupportHighlights.length > 0) {
      lines.push(`ISUPPORT: ${summary.isupportHighlights.join(', ')}`);
    }
  }
  return lines.join('\n');
}
