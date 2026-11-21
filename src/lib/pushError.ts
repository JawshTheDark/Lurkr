// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

/**
 * Formats a browser PushManager subscribe failure with actionable guidance (#1379)
 * when Chromium/Firefox rejects registration before reaching the Lurker server.
 */
export function subscribeErrorMessage(err: unknown, isBrave = false): string {
  const errObj = err && typeof err === 'object' ? (err as { name?: unknown; message?: unknown }) : null;
  const name = typeof errObj?.name === 'string' ? errObj.name : '';
  const detail = typeof errObj?.message === 'string' ? errObj.message : '';
  if (name !== 'AbortError') return detail || 'failed to enable';
  const hint = isBrave
    ? 'Brave couldn\'t reach its push service. Turn on "Use Google services for push messaging" in brave://settings/privacy and restart Brave.'
    : "This browser couldn't reach its push service. A DNS filter, ad blocker or firewall may be blocking it.";
  return detail ? `${hint} (${detail})` : hint;
}
