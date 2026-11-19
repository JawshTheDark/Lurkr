// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getServerUrl,
  setServerUrl,
  resolveServerUrl,
  resolveWsBaseUrl,
} from '../api';

describe('api server URL resolution', () => {
  beforeEach(() => {
    localStorage.clear();
    setServerUrl('');
  });

  it('resolves relative paths against configured serverUrl', () => {
    setServerUrl('https://irc.example.com/');
    expect(getServerUrl()).toBe('https://irc.example.com');
    expect(resolveServerUrl('/api/me')).toBe('https://irc.example.com/api/me');
    expect(resolveServerUrl('https://cdn.example.com/a.png')).toBe(
      'https://cdn.example.com/a.png',
    );
  });

  it('derives wss:// or ws:// WebSocket base URL from serverUrl', () => {
    setServerUrl('https://irc.example.com:8443');
    expect(resolveWsBaseUrl()).toBe('wss://irc.example.com:8443/ws');

    setServerUrl('http://localhost:3000');
    expect(resolveWsBaseUrl()).toBe('ws://localhost:3000/ws');
  });
});
