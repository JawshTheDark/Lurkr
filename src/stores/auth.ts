// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { api, clearAuthRecoveryGuard } from '../api';
import { resetSession } from './sessionReset';
import { useConfigStore } from './config';
import {
  clearEncryptedCache,
  useEncryptedPreviewCacheStore,
} from '../lib/encryptedPreviewCache';
import type { AccountRestrictions } from '../shared/accountRestrictions';

export interface AuthUser {
  id: number;
  username: string;
  role: 'admin' | 'user';
  is_paused?: boolean;
  restrictions?: AccountRestrictions;
}

export interface SetupStatus {
  needsSetup: boolean;
  mode?: string;
  username?: string;
}

export interface Passkey {
  id: string;
  label: string | null;
  createdAt: string;
}

let inflight: Promise<AuthUser | null> | null = null;

function friendlyError(err: any, fallback: string): string {
  if (!err) return fallback;
  if (err.name === 'NotAllowedError') return 'cancelled';
  if (err.name === 'InvalidStateError') return 'this passkey is already registered';
  return err.message || fallback;
}

interface AuthState {
  user: AuthUser | null;
  checked: boolean;
  error: string | null;
  setupStatus: SetupStatus | null;
  isPaused: () => boolean;
  isAdmin: () => boolean;
  allowedNetworkHosts: () => string[] | null;
  canUpload: () => boolean;
  uploadsOffTitle: () => string;
  adoptSession: (user: AuthUser) => void;
  setPaused: (paused: boolean) => void;
  setRestrictions: (restrictions: AccountRestrictions) => void;
  fetchMe: () => Promise<AuthUser | null>;
  fetchHostedAccountEmail: () => Promise<string | null>;
  fetchHostedAccount: () => Promise<{ id: number; email: string } | null>;
  fetchSetupStatus: () => Promise<SetupStatus | null>;
  fetchAuthMethods: () => Promise<{ passkey: boolean; [key: string]: unknown }>;
  loginWithPasskey: () => Promise<AuthUser>;
  setupFirstPasskey: (opts?: { username?: string }) => Promise<AuthUser>;
  setupFirstPassword: (opts?: { username?: string; password?: string }) => Promise<AuthUser>;
  loginWithPassword: (opts?: { username?: string; password?: string }) => Promise<AuthUser>;
  fetchInviteStatus: (token: string) => Promise<any>;
  acceptInvite: (opts?: { token?: string; username?: string; label?: string }) => Promise<AuthUser>;
  acceptInviteWithPassword: (opts?: {
    token?: string;
    username?: string;
    password?: string;
  }) => Promise<AuthUser>;
  fetchRecoveryStatus: (token: string) => Promise<any>;
  recoverWithPassword: (opts?: { token?: string; password?: string }) => Promise<AuthUser>;
  recoverWithPasskey: (opts?: { token?: string; label?: string }) => Promise<AuthUser>;
  addPasskey: (opts?: { label?: string }) => Promise<Passkey>;
  listPasskeys: () => Promise<Passkey[]>;
  renamePasskey: (id: string, label: string) => Promise<void>;
  deletePasskey: (id: string) => Promise<void>;
  fetchPasswordStatus: () => Promise<boolean>;
  setPassword: (opts?: { password?: string; currentPassword?: string }) => Promise<void>;
  removePassword: () => Promise<void>;
  logout: () => Promise<boolean>;
  clearError: () => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  checked: false,
  error: null,
  setupStatus: null,
  isPaused: () => get().user?.is_paused === true,
  isAdmin: () => get().user?.role === 'admin',
  allowedNetworkHosts: () => get().user?.restrictions?.networks ?? null,
  canUpload: () => get().user?.restrictions?.uploads !== false,
  uploadsOffTitle: () =>
    useConfigStore.getState().edition === 'node'
      ? 'subscribe to upload files'
      : 'uploads are not enabled for this account',
  adoptSession: (user) => {
    set({ user, checked: true });
    clearAuthRecoveryGuard();
  },
  setPaused: (paused) => {
    const u = get().user;
    if (u) set({ user: { ...u, is_paused: paused } });
  },
  setRestrictions: (restrictions) => {
    const u = get().user;
    if (u) set({ user: { ...u, restrictions } });
  },
  fetchMe: async () => {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const { user } = await api('/api/auth/me', {
          signal: AbortSignal.timeout(6000),
        });
        set({ user, checked: true, error: null });
        if (user) clearAuthRecoveryGuard();
      } catch (err: any) {
        if (err?.status === 401) {
          set({ user: null, checked: true, error: null });
        } else {
          set({
            user: null,
            checked: true,
            error: err?.message || 'Unable to reach Lurker server',
          });
        }
      }
      return get().user;
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  },
  fetchHostedAccountEmail: async () => (await get().fetchHostedAccount())?.email ?? null,
  fetchHostedAccount: async () => {
    try {
      const { account } = await api('/_cp/auth/me');
      return typeof account?.id === 'number' && typeof account?.email === 'string'
        ? { id: account.id, email: account.email }
        : null;
    } catch {
      return null;
    }
  },
  fetchSetupStatus: async () => {
    try {
      const setupStatus = await api('/api/auth/setup-status');
      set({ setupStatus });
    } catch {
      set({ setupStatus: { needsSetup: false } });
    }
    return get().setupStatus;
  },
  fetchAuthMethods: async () => {
    try {
      return await api('/api/auth/auth-methods');
    } catch {
      return { passkey: false };
    }
  },
  loginWithPasskey: async () => {
    set({ error: null });
    try {
      const { options } = await api('/api/auth/login/options', { method: 'POST' });
      const response = await startAuthentication({ optionsJSON: options });
      const { user } = await api('/api/auth/login/verify', {
        method: 'POST',
        body: { response },
      });
      get().adoptSession(user);
      return user as AuthUser;
    } catch (err: any) {
      set({ error: friendlyError(err, 'login failed') });
      throw err;
    }
  },
  setupFirstPasskey: async ({ username } = {}) => {
    set({ error: null });
    try {
      const { options } = await api('/api/auth/setup/options', {
        method: 'POST',
        body: { username },
      });
      const response = await startRegistration({ optionsJSON: options });
      const { user } = await api('/api/auth/setup/verify', {
        method: 'POST',
        body: { response },
      });
      get().adoptSession(user);
      set({ setupStatus: { needsSetup: false } });
      return user as AuthUser;
    } catch (err: any) {
      set({ error: friendlyError(err, 'setup failed') });
      throw err;
    }
  },
  setupFirstPassword: async ({ username, password } = {}) => {
    set({ error: null });
    try {
      const { user } = await api('/api/auth/setup/password', {
        method: 'POST',
        body: { username, password },
      });
      get().adoptSession(user);
      set({ setupStatus: { needsSetup: false } });
      return user as AuthUser;
    } catch (err: any) {
      set({ error: friendlyError(err, 'setup failed') });
      throw err;
    }
  },
  loginWithPassword: async ({ username, password } = {}) => {
    set({ error: null });
    try {
      const { user } = await api('/api/auth/login/password', {
        method: 'POST',
        body: { username, password },
      });
      get().adoptSession(user);
      return user as AuthUser;
    } catch (err: any) {
      set({ error: friendlyError(err, 'login failed') });
      throw err;
    }
  },
  fetchInviteStatus: async (token) => api(`/api/auth/invite/${encodeURIComponent(token)}`),
  acceptInvite: async ({ token, username, label } = {}) => {
    set({ error: null });
    try {
      const { options } = await api(`/api/auth/invite/${encodeURIComponent(token!)}/options`, {
        method: 'POST',
        body: { username },
      });
      const response = await startRegistration({ optionsJSON: options });
      const { user } = await api(`/api/auth/invite/${encodeURIComponent(token!)}/verify`, {
        method: 'POST',
        body: { response, label },
      });
      set({ user: null });
      resetSession();
      get().adoptSession(user);
      return user as AuthUser;
    } catch (err: any) {
      set({ error: friendlyError(err, 'invite redemption failed') });
      throw err;
    }
  },
  acceptInviteWithPassword: async ({ token, username, password } = {}) => {
    set({ error: null });
    try {
      const { user } = await api(`/api/auth/invite/${encodeURIComponent(token!)}/password`, {
        method: 'POST',
        body: { username, password },
      });
      set({ user: null });
      resetSession();
      get().adoptSession(user);
      return user as AuthUser;
    } catch (err: any) {
      set({ error: friendlyError(err, 'invite redemption failed') });
      throw err;
    }
  },
  fetchRecoveryStatus: async (token) => api(`/api/auth/recovery/${encodeURIComponent(token)}`),
  recoverWithPassword: async ({ token, password } = {}) => {
    set({ error: null });
    try {
      const { user } = await api(`/api/auth/recovery/${encodeURIComponent(token!)}/password`, {
        method: 'POST',
        body: { password },
      });
      set({ user: null });
      resetSession();
      get().adoptSession(user);
      return user as AuthUser;
    } catch (err: any) {
      set({ error: friendlyError(err, 'account recovery failed') });
      throw err;
    }
  },
  recoverWithPasskey: async ({ token, label } = {}) => {
    set({ error: null });
    try {
      const { options } = await api(`/api/auth/recovery/${encodeURIComponent(token!)}/options`, {
        method: 'POST',
      });
      const response = await startRegistration({ optionsJSON: options });
      const { user } = await api(`/api/auth/recovery/${encodeURIComponent(token!)}/verify`, {
        method: 'POST',
        body: { response, label },
      });
      set({ user: null });
      resetSession();
      get().adoptSession(user);
      return user as AuthUser;
    } catch (err: any) {
      set({ error: friendlyError(err, 'account recovery failed') });
      throw err;
    }
  },
  addPasskey: async ({ label } = {}) => {
    const { options } = await api('/api/auth/passkeys/options', { method: 'POST' });
    const response = await startRegistration({ optionsJSON: options });
    const { passkey } = await api('/api/auth/passkeys/verify', {
      method: 'POST',
      body: { response, label },
    });
    return passkey as Passkey;
  },
  listPasskeys: async () => {
    const { passkeys } = await api('/api/auth/passkeys');
    return passkeys as Passkey[];
  },
  renamePasskey: async (id, label) => {
    await api(`/api/auth/passkeys/${id}`, { method: 'PATCH', body: { label } });
  },
  deletePasskey: async (id) => {
    await api(`/api/auth/passkeys/${id}`, { method: 'DELETE' });
  },
  fetchPasswordStatus: async () => {
    try {
      const { hasPassword } = await api('/api/auth/password');
      return !!hasPassword;
    } catch {
      return false;
    }
  },
  setPassword: async ({ password, currentPassword } = {}) => {
    await api('/api/auth/password', {
      method: 'PUT',
      body: { password, currentPassword },
    });
  },
  removePassword: async () => {
    await api('/api/auth/password', { method: 'DELETE' });
  },
  logout: async () => {
    let signedOut = true;
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      signedOut = false;
    }
    if (useConfigStore.getState().edition === 'node') {
      try {
        await api('/_cp/auth/logout', { method: 'POST' });
      } catch {
        signedOut = false;
      }
    }
    set({ user: null });
    resetSession();
    if (useEncryptedPreviewCacheStore.getState().clearOnLogout) {
      void clearEncryptedCache();
    }
    return signedOut;
  },
  clearError: () => set({ error: null }),
  reset: () => set({ user: null, checked: false, error: null, setupStatus: null }),
}));
