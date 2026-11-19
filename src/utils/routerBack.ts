// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import type { NavigateFunction } from 'react-router-dom';

export function canGoBack(): boolean {
  try {
    return window.history.length > 1 && (window.history.state as { idx?: number } | null)?.idx !== 0;
  } catch {
    return false;
  }
}

export function backOrPush(navigate: NavigateFunction, fallback: string): void {
  if (canGoBack()) navigate(-1);
  else navigate(fallback);
}
