// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { resolveServerUrl } from '../api';

/**
 * Resolves a link or preview href into a safe absolute http(s) URL when possible.
 */
export function resolveExternalHref(rawUrl: string | null | undefined): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) {
    return resolveServerUrl(trimmed);
  }
  return trimmed;
}

/**
 * Opens an external http(s) URL in the user's system browser (Electron) or a new tab (web).
 */
export function openExternalUrl(rawUrl: string | null | undefined): void {
  const url = resolveExternalHref(rawUrl);
  if (!/^https?:\/\//i.test(url)) return;

  if (window.lurkerDesktop?.openExternal) {
    void Promise.resolve(window.lurkerDesktop.openExternal(url)).catch(() => {
      window.open(url, '_blank', 'noopener,noreferrer');
    });
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
