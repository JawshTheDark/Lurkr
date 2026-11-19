// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { api } from '../api';
import type { AccountRestrictions } from '../shared/accountRestrictions';
import type { RelayStatus } from '../shared/relayStatus';
import type { AdminUploader, UploaderDriver } from '../utils/uploaders';
import type { LiveClient, PushLogRow } from '../utils/pushLog';

const PUSH_LOG_PAGE = 100;
export const IDENT_STATUSES = ['on', 'off', 'failed', 'unknown'] as const;

export interface AdminIdent {
  status: (typeof IDENT_STATUSES)[number];
  host: 'server' | 'engine';
}

export interface AdminUser {
  id: number;
  username: string;
  role: 'admin' | 'user';
  createdAt: string;
  lastSeenAt?: string | null;
  isPaused?: boolean;
  ident?: string | null;
  effectiveIdent?: string;
  identConflict?: boolean;
  restrictions?: AccountRestrictions;
  recoveryExpiresAt?: string | null;
}

export interface AdminRecoveryLink {
  username: string;
  url: string;
  expiresAt: string;
}

export interface AdminLoginLockout {
  source: 'web' | 'bouncer';
  address: string;
  retryAfter: number;
  liftsAt: string;
}

export interface AdminLoginLockoutPolicy {
  maxFailures: number;
  windowMinutes: number;
  backoffMinutes: number;
}

export interface AdminInvite {
  token: string;
  url: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  usedAt: string | null;
  usedByUsername?: string | null;
  restrictions?: AccountRestrictions;
}

export interface AdminNetworkPreset {
  id: number;
  name: string;
  host: string;
  port: number;
  tls: boolean;
  saslLikelyRequired: boolean;
  channels: string[];
  tags: string[];
  users: number | null;
  channelCount: number | null;
  enabled: boolean;
  position: number;
}

export type AdminNetworkPresetInput = Omit<AdminNetworkPreset, 'id' | 'position' | 'enabled'>;

export interface AdminPushConfig {
  publicKey: string;
  vapidSubject: { subject: string; appleAccepts: boolean; ignored: string | null };
  transports: string[];
  relay: {
    url: string;
    enabled: boolean;
    devices: number;
    status: RelayStatus | null;
  };
}

export interface AdminPresenceRow {
  userId: number;
  username: string | null;
  openSockets: number;
  visibleSockets: number;
  sockets: LiveClient[];
  away: {
    networkId: number;
    active: boolean;
    autoSet: boolean;
    since: string | null;
    message: string | null;
  }[];
}

export type CeilingState = 'set' | 'none' | 'invalid';

export interface AdminStorageStats {
  generatedAt: string;
  approxBytesPerRow: number | null;
  database: { fileBytes: number; walBytes: number; reclaimableBytes: number };
  ceilings: {
    maxLines: number | null;
    maxLinesState: CeilingState;
    maxEventHours: number | null;
    maxEventHoursState: CeilingState;
    maxClosedBufferDays: number | null;
    maxClosedBufferDaysState: CeilingState;
  };
  users: Array<{ id: number; username: string; messageRows: number; buffers: number }>;
}

export interface AdminDccUser {
  id: number;
  username: string;
  chat: boolean;
  receive: boolean;
  send: boolean;
  limitBytes: number | null;
  usedBytes: number;
}

export interface AdminDccInfo {
  enabled: boolean;
  directory: string | null;
  maxFileBytes: number;
  allowPrivateHosts: boolean;
  freeDiskFloorBytes: number;
  users: AdminDccUser[];
}

function normalizeUser(raw: any): AdminUser {
  return {
    id: Number(raw.id),
    username: String(raw.username || ''),
    role: raw.role === 'admin' ? 'admin' : 'user',
    createdAt: raw.createdAt ?? raw.created_at ?? '',
    lastSeenAt: raw.lastSeenAt ?? raw.last_seen_at ?? null,
    isPaused: Boolean(raw.isPaused ?? raw.is_paused),
    ident: raw.ident ?? null,
    effectiveIdent: raw.effectiveIdent,
    identConflict: Boolean(raw.identConflict),
    restrictions: raw.restrictions,
    recoveryExpiresAt: raw.recoveryExpiresAt ?? null,
  };
}

function normalizeInvite(raw: any): AdminInvite {
  const token = String(raw.token || '');
  const usedAt = raw.usedAt ?? null;
  const expiresAt = raw.expiresAt ?? null;
  let status = typeof raw.status === 'string' && raw.status ? raw.status : 'pending';
  if (!raw.status) {
    if (usedAt) status = 'consumed';
    else if (expiresAt && Date.parse(expiresAt) < Date.now()) status = 'expired';
  }
  return {
    token,
    url: raw.url || (token ? `/invite/${token}` : ''),
    status,
    createdAt: raw.createdAt ?? '',
    expiresAt,
    usedAt,
    usedByUsername: raw.usedByUsername ?? raw.usedBy ?? null,
    restrictions: raw.restrictions,
  };
}

function normalizeNetworkPreset(raw: any): AdminNetworkPreset {
  return {
    id: Number(raw.id),
    name: String(raw.name || ''),
    host: String(raw.host || ''),
    port: Number(raw.port || 6697),
    tls: raw.tls !== false,
    saslLikelyRequired: Boolean(raw.saslLikelyRequired),
    channels: Array.isArray(raw.channels) ? raw.channels : [],
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    users: typeof raw.users === 'number' ? raw.users : null,
    channelCount: typeof raw.channelCount === 'number' ? raw.channelCount : null,
    enabled: raw.enabled !== false,
    position: Number(raw.position ?? 0),
  };
}

interface AdminState {
  users: AdminUser[];
  usersLoaded: boolean;
  identConfig: AdminIdent;
  invites: AdminInvite[];
  invitesLoaded: boolean;
  lockouts: AdminLoginLockout[];
  lockoutPolicy: AdminLoginLockoutPolicy | null;
  lockoutsLoaded: boolean;
  uploaders: AdminUploader[];
  uploaderDrivers: UploaderDriver[];
  allowUserDefinedUploaders: boolean;
  uploadersManaged: boolean;
  uploadCeilingMb: number | null;
  uploadersLoaded: boolean;
  networks: AdminNetworkPreset[];
  allowUserDefinedNetworks: boolean;
  networksLoaded: boolean;
  pushLog: PushLogRow[];
  pushLogLoaded: boolean;
  pushLogHasMore: boolean;
  pushConfig: AdminPushConfig | null;
  relayStatus: RelayStatus | null;
  presence: AdminPresenceRow[];
  presenceLoaded: boolean;
  storage: AdminStorageStats | null;
  dcc: AdminDccInfo | null;
  jitsiUrl: string | null | undefined;
  generalLoaded: boolean;

  fetchUsers: () => Promise<void>;
  deleteUser: (id: number) => Promise<void>;
  pauseUser: (id: number) => Promise<void>;
  resumeUser: (id: number) => Promise<void>;
  setUserRestrictions: (id: number, restrictions: AccountRestrictions) => Promise<void>;
  setUserIdent: (id: number, ident: string | null) => Promise<void>;
  createRecovery: (id: number) => Promise<AdminRecoveryLink>;
  deleteRecovery: (id: number) => Promise<void>;
  fetchLockouts: () => Promise<void>;
  clearLockouts: () => Promise<void>;
  fetchInvites: () => Promise<void>;
  createInvite: (opts?: {
    expiresInDays?: number;
    restrictions?: AccountRestrictions;
  }) => Promise<AdminInvite>;
  deleteInvite: (token: string) => Promise<void>;
  fetchUploaders: () => Promise<void>;
  createUploader: (body: { driver: string; label: string; values: Record<string, string> }) => Promise<void>;
  updateUploader: (
    id: number,
    body: {
      label?: string;
      values?: Record<string, string>;
      enabled?: boolean;
      offeredToUsers?: boolean;
    },
  ) => Promise<void>;
  setDefaultUploader: (id: number) => Promise<void>;
  deleteUploader: (id: number) => Promise<void>;
  setAllowUserDefinedUploaders: (allowUserDefined: boolean) => Promise<void>;
  setUploadCeilingMb: (maxUploadMb: number) => Promise<void>;
  fetchNetworks: () => Promise<void>;
  createNetwork: (body: AdminNetworkPresetInput) => Promise<void>;
  updateNetwork: (id: number, body: Partial<AdminNetworkPresetInput>) => Promise<void>;
  deleteNetwork: (id: number) => Promise<void>;
  setNetworkPolicy: (allowUserDefined: boolean) => Promise<void>;
  fetchPushLog: () => Promise<void>;
  fetchOlderPushLog: () => Promise<void>;
  fetchPresence: () => Promise<void>;
  fetchPushConfig: () => Promise<void>;
  refreshRelayStatus: () => Promise<void>;
  checkPushRelay: () => Promise<void>;
  setPushRelayEnabled: (enabled: boolean) => Promise<void>;
  fetchStorage: (force?: boolean) => Promise<void>;
  fetchDcc: () => Promise<void>;
  updateUserDcc: (
    id: number,
    body: { chat?: boolean; receive?: boolean; send?: boolean; limitBytes?: number | null },
  ) => Promise<void>;
  fetchGeneral: () => Promise<void>;
  setJitsiUrl: (url: string) => Promise<void>;
  reset: () => void;
}

const DEFAULT_IDENT: AdminIdent = { status: 'off', host: 'server' };

export const useAdminStore = create<AdminState>((set, get) => ({
  users: [],
  usersLoaded: false,
  identConfig: DEFAULT_IDENT,
  invites: [],
  invitesLoaded: false,
  lockouts: [],
  lockoutPolicy: null,
  lockoutsLoaded: false,
  uploaders: [],
  uploaderDrivers: [],
  allowUserDefinedUploaders: true,
  uploadersManaged: false,
  uploadCeilingMb: null,
  uploadersLoaded: false,
  networks: [],
  allowUserDefinedNetworks: true,
  networksLoaded: false,
  pushLog: [],
  pushLogLoaded: false,
  pushLogHasMore: false,
  pushConfig: null,
  relayStatus: null,
  presence: [],
  presenceLoaded: false,
  storage: null,
  dcc: null,
  jitsiUrl: undefined,
  generalLoaded: false,

  fetchUsers: async () => {
    const data = await api<{ users?: any[]; ident?: { status?: string; host?: string } }>(
      '/api/admin/users',
    );
    const status = IDENT_STATUSES.includes((data.ident?.status ?? '') as any)
      ? (data.ident!.status as AdminIdent['status'])
      : 'unknown';
    const host: AdminIdent['host'] = data.ident?.host === 'engine' ? 'engine' : 'server';
    set({
      users: (data.users || []).map(normalizeUser),
      identConfig: { status, host },
      usersLoaded: true,
    });
  },
  deleteUser: async (id) => {
    await api(`/api/admin/users/${id}`, { method: 'DELETE' });
    set((s) => ({ users: s.users.filter((u) => u.id !== id) }));
  },
  pauseUser: async (id) => {
    await api(`/api/admin/users/${id}/pause`, { method: 'POST' });
    set((s) => ({
      users: s.users.map((u) => (u.id === id ? { ...u, isPaused: true } : u)),
    }));
  },
  resumeUser: async (id) => {
    await api(`/api/admin/users/${id}/resume`, { method: 'POST' });
    set((s) => ({
      users: s.users.map((u) => (u.id === id ? { ...u, isPaused: false } : u)),
    }));
  },
  setUserRestrictions: async (id, restrictions) => {
    const res = await api<{ restrictions: AccountRestrictions }>(
      `/api/admin/users/${id}/restrictions`,
      { method: 'PUT', body: restrictions },
    );
    set((s) => ({
      users: s.users.map((u) => (u.id === id ? { ...u, restrictions: res.restrictions } : u)),
    }));
  },
  setUserIdent: async (id, ident) => {
    const res = await api<{ ident: string | null; effectiveIdent: string }>(
      `/api/admin/users/${id}/ident`,
      { method: 'PUT', body: { ident } },
    );
    set((s) => ({
      users: s.users.map((u) =>
        u.id === id ? { ...u, ident: res.ident ?? null, effectiveIdent: res.effectiveIdent } : u,
      ),
    }));
    await get().fetchUsers().catch(() => {});
  },
  createRecovery: async (id) => {
    const { recovery } = await api<{ recovery: AdminRecoveryLink }>(
      `/api/admin/users/${id}/recovery`,
      { method: 'POST' },
    );
    set((s) => ({
      users: s.users.map((u) =>
        u.id === id ? { ...u, recoveryExpiresAt: recovery.expiresAt } : u,
      ),
    }));
    return recovery;
  },
  deleteRecovery: async (id) => {
    await api(`/api/admin/users/${id}/recovery`, { method: 'DELETE' });
    set((s) => ({
      users: s.users.map((u) => (u.id === id ? { ...u, recoveryExpiresAt: null } : u)),
    }));
  },
  fetchLockouts: async () => {
    const { lockouts, policy } = await api<{
      lockouts?: AdminLoginLockout[];
      policy?: AdminLoginLockoutPolicy;
    }>('/api/admin/login-lockouts');
    set({
      lockouts: lockouts || [],
      lockoutPolicy: policy || null,
      lockoutsLoaded: true,
    });
  },
  clearLockouts: async () => {
    await api('/api/admin/login-lockouts', { method: 'DELETE' });
    set({ lockouts: [] });
  },
  fetchInvites: async () => {
    const { invites } = await api<{ invites?: any[] }>('/api/admin/invites');
    set({ invites: (invites || []).map(normalizeInvite), invitesLoaded: true });
  },
  createInvite: async (opts = {}) => {
    const { invite } = await api<{ invite: any }>('/api/admin/invites', {
      method: 'POST',
      body: {
        ...(opts.expiresInDays ? { expiresInDays: opts.expiresInDays } : {}),
        ...(opts.restrictions ? { restrictions: opts.restrictions } : {}),
      },
    });
    const normalized = normalizeInvite(invite);
    set((s) => ({ invites: [normalized, ...s.invites] }));
    return normalized;
  },
  deleteInvite: async (token) => {
    await api(`/api/admin/invites/${encodeURIComponent(token)}`, { method: 'DELETE' });
    set((s) => ({ invites: s.invites.filter((i) => i.token !== token) }));
  },
  fetchUploaders: async () => {
    const data = await api<{
      uploaders?: AdminUploader[];
      drivers?: UploaderDriver[];
      allowUserDefined?: boolean;
      managed?: boolean;
      maxUploadMb?: number | null;
    }>('/api/admin/uploaders');
    set({
      uploaders: data.uploaders || [],
      uploaderDrivers: data.drivers || [],
      allowUserDefinedUploaders: data.allowUserDefined !== false,
      uploadersManaged: !!data.managed,
      uploadCeilingMb: typeof data.maxUploadMb === 'number' ? data.maxUploadMb : null,
      uploadersLoaded: true,
    });
  },
  createUploader: async (body) => {
    await api('/api/admin/uploaders', { method: 'POST', body });
    await get().fetchUploaders();
  },
  updateUploader: async (id, body) => {
    await api(`/api/admin/uploaders/${id}`, { method: 'PATCH', body });
    await get().fetchUploaders();
  },
  setDefaultUploader: async (id) => {
    await api(`/api/admin/uploaders/${id}/default`, { method: 'PUT' });
    await get().fetchUploaders();
  },
  deleteUploader: async (id) => {
    await api(`/api/admin/uploaders/${id}`, { method: 'DELETE' });
    await get().fetchUploaders();
  },
  setAllowUserDefinedUploaders: async (allowUserDefined) => {
    await api('/api/admin/uploaders/policy', {
      method: 'PUT',
      body: { allowUserDefined },
    });
    set({ allowUserDefinedUploaders: allowUserDefined });
  },
  setUploadCeilingMb: async (maxUploadMb) => {
    const data = await api<{ maxUploadMb?: number }>('/api/admin/uploaders/ceiling', {
      method: 'PUT',
      body: { maxUploadMb },
    });
    set({
      uploadCeilingMb: typeof data.maxUploadMb === 'number' ? data.maxUploadMb : maxUploadMb,
    });
  },
  fetchNetworks: async () => {
    const data = await api<{ presets?: any[]; networks?: any[]; allowUserDefined?: boolean }>(
      '/api/admin/networks',
    );
    const list = data.presets ?? data.networks ?? [];
    set({
      networks: list.map(normalizeNetworkPreset),
      allowUserDefinedNetworks: data.allowUserDefined !== false,
      networksLoaded: true,
    });
  },
  createNetwork: async (body) => {
    await api('/api/admin/networks', { method: 'POST', body });
    await get().fetchNetworks();
  },
  updateNetwork: async (id, body) => {
    await api(`/api/admin/networks/${id}`, { method: 'PATCH', body });
    await get().fetchNetworks();
  },
  deleteNetwork: async (id) => {
    await api(`/api/admin/networks/${id}`, { method: 'DELETE' });
    await get().fetchNetworks();
  },
  setNetworkPolicy: async (allowUserDefined) => {
    await api('/api/admin/networks/policy', { method: 'PUT', body: { allowUserDefined } });
    await get().fetchNetworks();
  },
  fetchPushLog: async () => {
    const { log } = await api<{ log?: PushLogRow[] }>('/api/admin/push/log');
    const rows = log || [];
    set({
      pushLog: rows,
      pushLogLoaded: true,
      pushLogHasMore: rows.length >= PUSH_LOG_PAGE,
    });
  },
  fetchOlderPushLog: async () => {
    const last = get().pushLog.at(-1);
    if (!last) return;
    const { log } = await api<{ log?: PushLogRow[] }>(`/api/admin/push/log?before=${last.id}`);
    const older = log || [];
    set((s) => ({
      pushLog: [...s.pushLog, ...older],
      pushLogHasMore: older.length >= PUSH_LOG_PAGE,
    }));
  },
  fetchPresence: async () => {
    const { presence } = await api<{ presence?: AdminPresenceRow[] }>('/api/admin/presence');
    set({ presence: presence || [], presenceLoaded: true });
  },
  fetchPushConfig: async () => {
    const data = await api<AdminPushConfig>('/api/admin/push');
    set((s) => ({
      pushConfig: data,
      relayStatus: s.relayStatus ?? data.relay?.status ?? null,
    }));
  },
  refreshRelayStatus: async () => {
    const { status } = await api<{ status: RelayStatus | null }>('/api/admin/push/relay/status');
    set({ relayStatus: status });
  },
  checkPushRelay: async () => {
    const data = await api<AdminPushConfig>('/api/admin/push/relay/check', { method: 'POST' });
    set({ relayStatus: data.relay?.status ?? null });
  },
  setPushRelayEnabled: async (enabled) => {
    const data = await api<AdminPushConfig>('/api/admin/push/relay', {
      method: 'PUT',
      body: { enabled },
    });
    set({
      pushConfig: data,
      ...(data.relay?.status ? { relayStatus: data.relay.status } : {}),
    });
  },
  fetchStorage: async (force = false) => {
    const data = await api<AdminStorageStats>(`/api/admin/storage${force ? '?refresh=1' : ''}`);
    set({ storage: data });
  },
  fetchDcc: async () => {
    const data = await api<AdminDccInfo>('/api/admin/dcc');
    set({ dcc: data });
  },
  updateUserDcc: async (id, body) => {
    const updated = await api<{
      chat: boolean;
      receive: boolean;
      send: boolean;
      limitBytes: number | null;
    }>(`/api/admin/dcc/users/${id}`, {
      method: 'PUT',
      body,
    });
    set((s) => ({
      dcc: s.dcc
        ? {
            ...s.dcc,
            users: s.dcc.users.map((u) => (u.id === id ? { ...u, ...updated } : u)),
          }
        : null,
    }));
  },
  fetchGeneral: async () => {
    const data = await api<{ jitsiUrl?: unknown }>('/api/admin/general');
    set({
      jitsiUrl: typeof data.jitsiUrl === 'string' ? data.jitsiUrl : null,
      generalLoaded: true,
    });
  },
  setJitsiUrl: async (url) => {
    const data = await api<{ jitsiUrl?: unknown }>('/api/admin/general/jitsi', {
      method: 'PUT',
      body: { url },
    });
    set({
      jitsiUrl: typeof data.jitsiUrl === 'string' ? data.jitsiUrl : null,
      generalLoaded: true,
    });
  },
  reset: () =>
    set({
      users: [],
      usersLoaded: false,
      identConfig: DEFAULT_IDENT,
      invites: [],
      invitesLoaded: false,
      lockouts: [],
      lockoutPolicy: null,
      lockoutsLoaded: false,
      uploaders: [],
      uploaderDrivers: [],
      allowUserDefinedUploaders: true,
      uploadersManaged: false,
      uploadCeilingMb: null,
      uploadersLoaded: false,
      networks: [],
      allowUserDefinedNetworks: true,
      networksLoaded: false,
      pushLog: [],
      pushLogLoaded: false,
      pushLogHasMore: false,
      pushConfig: null,
      relayStatus: null,
      presence: [],
      presenceLoaded: false,
      storage: null,
      dcc: null,
      jitsiUrl: undefined,
      generalLoaded: false,
    }),
}));
