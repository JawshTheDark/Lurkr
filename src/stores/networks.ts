// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { api } from '../api';
import { useAuthStore } from './auth';
import { isVirtualKey } from '../lib/virtualBuffers';
import { dccChatPeer, isDccChatTarget } from '../shared/channels';
import type { MultilineLimits } from '../utils/messageSplit';
import { DEFAULT_PREFIX, type ModeSpec, type PrefixMode } from '../shared/channelModes';
import {
  createEmptyServerProfile,
  ingestServerLines,
  noteObservedServiceTargets,
  type NetworkServerProfile,
  type ServerLineInput,
} from '../lib/networkCapabilities';

export interface Network {
  id: number;
  name: string;
  host: string;
  port: number;
  nick: string;
  tls: boolean;
  [key: string]: unknown;
}

export interface ClientCertDigest {
  sha256: string;
  sha1: string;
  sha512: string;
  subject: string;
  validFrom: string;
  validTo: string;
}
export type ClientCertInfo = ClientCertDigest | { unusable: true };

export interface UserMetadataEntry {
  displayName?: string;
  avatarUrl?: string | null;
  pronouns?: string;
  homepage?: string;
  status?: string;
}

export interface MetadataLimits {
  maxSubs: number | null;
  maxKeys: number | null;
  maxValueBytes: number | null;
  beforeConnect: boolean;
}

export interface PeerPresenceEntry {
  nick: string;
  state: string | null;
  stateAt: string | null;
  awayMessage: string | null;
}

export interface AwayState {
  active: boolean;
  message: string | null;
  since: string | null;
  autoSet: boolean;
  backAt: string | null;
}

export interface PendingSend {
  id: string;
  target: string;
  kind: 'privmsg' | 'action' | 'notice';
  text: string;
  at?: string;
}

export interface NetworkState {
  networkId: number;
  channels: string[];
  state?: string;
  nick?: string;
  userModes?: string;
  away?: AwayState | null;
  peerPresence?: Record<string, PeerPresenceEntry>;
  peerAccounts?: Record<string, string>;
  userMetadata?: Record<string, UserMetadataEntry>;
  metadataLimits?: MetadataLimits | null;
  dccChats?: string[];
  dccSecureChats?: string[];
  dccChatOffers?: string[];
  lagMs?: number | null;
  sendQueueWaiting?: number;
  sendPending?: PendingSend[];
  multilineLimits?: MultilineLimits | null;
  modeSpec?: ModeSpec | null;
  canReact?: boolean;
  canAddReaction?: boolean;
  canRemoveReaction?: boolean;
  canReply?: boolean;
  canRedact?: boolean;
  userhostBytes?: number;
}

export interface ActiveBuffer {
  networkId: number;
  target: string;
  network: Network | undefined;
}

export function canDisconnect(state: string | null | undefined): boolean {
  return state === 'connected' || state === 'reconnecting';
}

export function isNetworkOper(state: NetworkState | null | undefined): boolean {
  if (!state || state.state !== 'connected') return false;
  return /[oO]/.test(state.userModes || '');
}

export function tagSupport(state: NetworkState | null | undefined): {
  react: boolean;
  unreact: boolean;
  reply: boolean;
  redact: boolean;
} {
  if (state?.state !== 'connected') {
    return { react: false, unreact: false, reply: false, redact: false };
  }
  const legacy = !!state.canReact;
  return {
    react: state.canAddReaction ?? legacy,
    unreact: state.canRemoveReaction ?? legacy,
    reply: state.canReply ?? legacy,
    redact: !!state.canRedact,
  };
}

interface NetworksStoreState {
  networks: Network[];
  states: Record<number | string, NetworkState>;
  profiles: Record<number | string, NetworkServerProfile>;
  activeKey: string | null;
  loaded: boolean;
  networkById: (id: number) => Network | null;
  profileFor: (networkId: number | null | undefined) => NetworkServerProfile;
  prefixFor: (networkId: number | null | undefined) => readonly PrefixMode[];
  isOwnNick: (networkId: number | null | undefined, nick: string | null | undefined) => boolean;
  peerFor: (networkId: number | string, nick: string) => PeerPresenceEntry | null;
  peerAccountFor: (networkId: number | string, nick: string) => string | null | undefined;
  metadataFor: (networkId: number | string | null | undefined, nick: string) => UserMetadataEntry | null;
  isDccChatLive: (networkId: number | string, target: string) => boolean;
  wasDccChatSecure: (networkId: number | string, target: string) => boolean;
  isDccChatSecure: (networkId: number | string, target: string) => boolean;
  activeBuffer: () => ActiveBuffer | null;
  fetchAll: () => Promise<void>;
  create: (payload: Partial<Network>) => Promise<Network>;
  update: (id: number, patch: Partial<Network>) => Promise<Network>;
  reorder: (ids: number[]) => Promise<void>;
  attachCertificate: (
    id: number,
    payload: { mode: 'generate' } | { mode: 'import'; cert: string; key: string },
  ) => Promise<ClientCertDigest>;
  removeCertificate: (id: number) => Promise<void>;
  remove: (id: number) => Promise<void>;
  connect: (id: number) => Promise<void>;
  disconnect: (id: number, reason?: string) => Promise<void>;
  reconnect: (id: number) => Promise<void>;
  dropBuffer: (networkId: number | string | null, target: string) => void;
  rekeyBuffer: (networkId: number | string | null, from: string, to: string) => void;
  setActive: (networkId: number | string | null, target: string) => void;
  clearActive: () => void;
  activateVirtual: (key: string) => void;
  applySnapshot: (networks: NetworkState[]) => void;
  applyState: (event: any) => void;
  applyOwnNick: (event: any) => void;
  applyUserMode: (event: any) => void;
  applyModeSpec: (event: any) => void;
  applyReactSupport: (event: any) => void;
  applyLineBudget: (event: any) => void;
  applyAwayState: (event: any) => void;
  applyPeerPresence: (networkId: number | string, nick: string, payload: any) => void;
  applyPeerAccount: (networkId: number | string, nick: string, account: string | null) => void;
  applyUserMetadata: (
    networkId: number | string,
    nick: string,
    values: UserMetadataEntry | null,
  ) => void;
  applyDccChatState: (networkId: number | string, nick: string, live: boolean, secure?: boolean) => void;
  applyLag: (event: any) => void;
  applySendQueue: (event: any) => void;
  applySendPending: (event: any) => void;
  applySendPendingDone: (event: any) => void;
  ingestServerEvents: (networkId: number | string, events: ServerLineInput[]) => void;
  noteServiceTargets: (networkId: number | string, targets: string[]) => void;
  setProfile: (networkId: number | string, profile: NetworkServerProfile) => void;
  reset: () => void;
}

export function activeBufferFrom(
  activeKey: string | null,
  networks: Network[],
): ActiveBuffer | null {
  if (!activeKey) return null;
  if (isVirtualKey(activeKey)) return null;
  if (!activeKey.includes('::')) return null;
  const [networkId, name] = activeKey.split('::');
  const id = Number(networkId);
  return { networkId: id, target: name, network: networks.find((n) => n.id === id) };
}

export const useNetworksStore = create<NetworksStoreState>((set, get) => ({
  networks: [],
  states: {},
  profiles: {},
  activeKey: null,
  loaded: false,

  networkById: (id) => get().networks.find((n) => n.id === id) || null,
  profileFor: (networkId) =>
    (networkId != null ? get().profiles[networkId] : null) ?? createEmptyServerProfile(),
  prefixFor: (networkId) =>
    (networkId != null ? get().states[networkId]?.modeSpec?.prefix : null) ?? DEFAULT_PREFIX,
  isOwnNick: (networkId, nick) => {
    const own = networkId != null ? get().states[networkId]?.nick : null;
    return !!own && !!nick && own.toLowerCase() === nick.toLowerCase();
  },
  peerFor: (networkId, nick) => {
    if (isDccChatTarget(nick)) return null;
    const netState = get().states[networkId];
    if (netState && netState.state !== 'connected') {
      return { nick, state: 'offline', stateAt: null, awayMessage: null };
    }
    return netState?.peerPresence?.[nick.toLowerCase()] ?? null;
  },
  peerAccountFor: (networkId, nick) => {
    const netState = get().states[networkId];
    if (!netState || netState.state !== 'connected') return null;
    if (!netState.peerAccounts) return undefined;
    return netState.peerAccounts[nick.toLowerCase()] ?? null;
  },
  metadataFor: (networkId, nick) => {
    if (networkId == null || !nick) return null;
    return get().states[networkId]?.userMetadata?.[nick.toLowerCase()] ?? null;
  },
  isDccChatLive: (networkId, target) => {
    const peer = dccChatPeer(target).toLowerCase();
    return (get().states[networkId]?.dccChats ?? []).some((n) => n.toLowerCase() === peer);
  },
  wasDccChatSecure: (networkId, target) => {
    const peer = dccChatPeer(target).toLowerCase();
    return (get().states[networkId]?.dccSecureChats ?? []).some((n) => n.toLowerCase() === peer);
  },
  isDccChatSecure: (networkId, target) =>
    get().isDccChatLive(networkId, target) && get().wasDccChatSecure(networkId, target),

  activeBuffer: () => activeBufferFrom(get().activeKey, get().networks),

  fetchAll: async () => {
    const { networks } = await api('/api/networks');
    set({ networks, loaded: true });
  },
  create: async (payload) => {
    const { network } = await api('/api/networks', { method: 'POST', body: payload });
    set((s) => ({ networks: [...s.networks, network] }));
    return network as Network;
  },
  update: async (id, patch) => {
    const { network } = await api(`/api/networks/${id}`, { method: 'PATCH', body: patch });
    set((s) => ({
      networks: s.networks.map((n) => (n.id === id ? network : n)),
    }));
    return network as Network;
  },
  reorder: async (ids) => {
    try {
      const { networks } = await api('/api/networks/reorder', {
        method: 'POST',
        body: { ids },
      });
      set({ networks });
    } catch (err: any) {
      if (err?.status === 409 && Array.isArray(err.data?.networks)) {
        set({ networks: err.data.networks });
      }
      throw err;
    }
  },
  attachCertificate: async (id, payload) => {
    const { network, certificate } = await api(`/api/networks/${id}/certificate`, {
      method: 'POST',
      body: payload,
    });
    set((s) => ({
      networks: s.networks.map((n) => (n.id === id ? network : n)),
    }));
    return certificate as ClientCertDigest;
  },
  removeCertificate: async (id) => {
    const { network } = await api(`/api/networks/${id}/certificate`, { method: 'DELETE' });
    set((s) => ({
      networks: s.networks.map((n) => (n.id === id ? network : n)),
    }));
  },
  remove: async (id) => {
    await api(`/api/networks/${id}`, { method: 'DELETE' });
    set((s) => {
      const nextStates = { ...s.states };
      delete nextStates[id];
      return {
        networks: s.networks.filter((n) => n.id !== id),
        states: nextStates,
        activeKey: s.activeKey?.startsWith(`${id}::`) ? null : s.activeKey,
      };
    });
  },
  connect: async (id) => {
    if (useAuthStore.getState().isPaused()) return;
    await api(`/api/networks/${id}/connect`, { method: 'POST' });
  },
  disconnect: async (id, reason) => {
    if (useAuthStore.getState().isPaused()) return;
    await api(`/api/networks/${id}/disconnect`, {
      method: 'POST',
      ...(reason ? { body: { reason } } : {}),
    });
  },
  reconnect: async (id) => {
    if (useAuthStore.getState().isPaused()) return;
    await api(`/api/networks/${id}/reconnect`, { method: 'POST' });
  },
  dropBuffer: (networkId, target) => {
    const k = networkId == null ? target : `${networkId}::${target}`;
    if (get().activeKey === k) set({ activeKey: null });
  },
  rekeyBuffer: (networkId, from, to) => {
    const fromKey = networkId == null ? from : `${networkId}::${from}`;
    if (get().activeKey === fromKey) {
      set({ activeKey: networkId == null ? to : `${networkId}::${to}` });
    }
  },
  setActive: (networkId, target) => {
    set({ activeKey: networkId == null ? target : `${networkId}::${target}` });
  },
  clearActive: () => set({ activeKey: null }),
  activateVirtual: (key) => set({ activeKey: key }),

  applySnapshot: (networks) => {
    const prevStates = get().states;
    const prevProfiles = get().profiles;
    const map: Record<number | string, NetworkState> = {};
    const profileMap: Record<number | string, NetworkServerProfile> = { ...prevProfiles };
    for (const snap of networks) {
      const has = (list: string[] | undefined, nick: string) =>
        (list ?? []).some((n) => n.toLowerCase() === nick.toLowerCase());
      const remembered = (prevStates[snap.networkId]?.dccSecureChats ?? []).filter(
        (n) => !has(snap.dccSecureChats, n) && !has(snap.dccChats, n),
      );
      map[snap.networkId] = remembered.length
        ? { ...snap, dccSecureChats: [...(snap.dccSecureChats ?? []), ...remembered] }
        : snap;
      if (!profileMap[snap.networkId]) {
        profileMap[snap.networkId] = createEmptyServerProfile();
      }
    }
    set({ states: map, profiles: profileMap });
  },

  applyState: (event) =>
    set((s) => {
      const existing = s.states[event.networkId] || { networkId: event.networkId, channels: [] };
      return {
        states: {
          ...s.states,
          [event.networkId]: {
            ...existing,
            state: event.state,
            nick: event.nick || existing.nick,
          },
        },
      };
    }),

  applyOwnNick: (event) =>
    set((s) => {
      const existing = s.states[event.networkId];
      if (!existing || !event.nick) return s;
      return {
        states: { ...s.states, [event.networkId]: { ...existing, nick: event.nick } },
      };
    }),

  applyUserMode: (event) =>
    set((s) => {
      const existing = s.states[event.networkId] || { networkId: event.networkId, channels: [] };
      return {
        states: {
          ...s.states,
          [event.networkId]: {
            ...existing,
            userModes: typeof event.modes === 'string' ? event.modes : '',
          },
        },
      };
    }),

  applyModeSpec: (event) =>
    set((s) => {
      const existing = s.states[event.networkId] || { networkId: event.networkId, channels: [] };
      return {
        states: {
          ...s.states,
          [event.networkId]: { ...existing, modeSpec: event.modeSpec ?? null },
        },
      };
    }),

  applyReactSupport: (event) =>
    set((s) => {
      const existing = s.states[event.networkId] || { networkId: event.networkId, channels: [] };
      return {
        states: {
          ...s.states,
          [event.networkId]: {
            ...existing,
            canReact: !!event.canReact,
            canAddReaction: event.canAddReaction,
            canRemoveReaction: event.canRemoveReaction,
            canReply: event.canReply,
            canRedact: event.canRedact,
          },
        },
      };
    }),

  applyLineBudget: (event) => {
    if (typeof event.userhostBytes !== 'number') return;
    set((s) => {
      const existing = s.states[event.networkId] || { networkId: event.networkId, channels: [] };
      return {
        states: {
          ...s.states,
          [event.networkId]: { ...existing, userhostBytes: event.userhostBytes },
        },
      };
    });
  },

  applyAwayState: (event) =>
    set((s) => {
      const existing = s.states[event.networkId] || { networkId: event.networkId, channels: [] };
      return {
        states: {
          ...s.states,
          [event.networkId]: { ...existing, away: event.away || null },
        },
      };
    }),

  applyPeerPresence: (networkId, nick, payload) => {
    if (!networkId || !nick) return;
    set((s) => {
      const existing = s.states[networkId] || { networkId: Number(networkId), channels: [] };
      const peerPresence = {
        ...existing.peerPresence,
        [nick.toLowerCase()]: {
          nick,
          state: payload?.state || null,
          stateAt: payload?.stateAt || null,
          awayMessage: payload?.awayMessage || null,
        },
      };
      return {
        states: { ...s.states, [networkId]: { ...existing, peerPresence } },
      };
    });
  },

  applyUserMetadata: (networkId, nick, values) => {
    if (!networkId || !nick) return;
    set((s) => {
      const existing = s.states[networkId] || { networkId: Number(networkId), channels: [] };
      const userMetadata = { ...existing.userMetadata };
      if (values) userMetadata[nick.toLowerCase()] = values;
      else delete userMetadata[nick.toLowerCase()];
      return {
        states: { ...s.states, [networkId]: { ...existing, userMetadata } },
      };
    });
  },

  applyDccChatState: (networkId, nick, live, secure = false) => {
    if (!networkId || !nick) return;
    set((s) => {
      const existing = s.states[networkId] || { networkId: Number(networkId), channels: [] };
      const lower = nick.toLowerCase();
      const others = (existing.dccChats ?? []).filter((n) => n.toLowerCase() !== lower);
      const otherSecure = (existing.dccSecureChats ?? []).filter((n) => n.toLowerCase() !== lower);
      const secureChats = !live
        ? (existing.dccSecureChats ?? [])
        : secure
          ? [...otherSecure, nick]
          : otherSecure;
      return {
        states: {
          ...s.states,
          [networkId]: {
            ...existing,
            dccChats: live ? [...others, nick] : others,
            dccSecureChats: secureChats,
          },
        },
      };
    });
  },

  applyLag: (event) =>
    set((s) => {
      const existing = s.states[event.networkId] || { networkId: event.networkId, channels: [] };
      const v = event.lagMs;
      return {
        states: {
          ...s.states,
          [event.networkId]: { ...existing, lagMs: typeof v === 'number' ? v : null },
        },
      };
    }),

  applySendQueue: (event) =>
    set((s) => {
      const existing = s.states[event.networkId] || { networkId: event.networkId, channels: [] };
      const v = event.waiting;
      return {
        states: {
          ...s.states,
          [event.networkId]: { ...existing, sendQueueWaiting: typeof v === 'number' ? v : 0 },
        },
      };
    }),

  applyPeerAccount: (networkId, nick, account) => {
    if (!networkId || !nick) return;
    set((s) => {
      const existing = s.states[networkId] || { networkId: Number(networkId), channels: [] };
      const peerAccounts = { ...existing.peerAccounts };
      if (account) peerAccounts[nick.toLowerCase()] = account;
      else delete peerAccounts[nick.toLowerCase()];
      return {
        states: { ...s.states, [networkId]: { ...existing, peerAccounts } },
      };
    });
  },

  applySendPending: (event) => {
    const pending = event?.pending;
    if (typeof pending?.id !== 'string' || typeof pending.target !== 'string') return;
    set((s) => {
      const existing = s.states[event.networkId] || { networkId: event.networkId, channels: [] };
      const held = existing.sendPending ?? [];
      if (held.some((p) => p.id === pending.id)) return s;
      return {
        states: {
          ...s.states,
          [event.networkId]: {
            ...existing,
            sendPending: [
              ...held,
              {
                id: pending.id,
                target: pending.target,
                kind: pending.kind,
                text: String(pending.text ?? ''),
                at: pending.at,
              },
            ],
          },
        },
      };
    });
  },

  applySendPendingDone: (event) => {
    set((s) => {
      const existing = s.states[event?.networkId];
      if (!existing?.sendPending?.some((p) => p.id === event.pendingId)) return s;
      return {
        states: {
          ...s.states,
          [event.networkId]: {
            ...existing,
            sendPending: existing.sendPending.filter((p) => p.id !== event.pendingId),
          },
        },
      };
    });
  },

  ingestServerEvents: (networkId, events) => {
    if (networkId == null || !Array.isArray(events) || events.length === 0) return;
    set((s) => {
      const prev = s.profiles[networkId] ?? createEmptyServerProfile();
      const next = ingestServerLines(prev, events);
      if (JSON.stringify(prev) === JSON.stringify(next)) return s;
      return { profiles: { ...s.profiles, [networkId]: next } };
    });
  },

  noteServiceTargets: (networkId, targets) => {
    if (networkId == null || !targets.length) return;
    set((s) => {
      const prev = s.profiles[networkId] ?? createEmptyServerProfile();
      const next = noteObservedServiceTargets(prev, targets);
      if (next === prev) return s;
      return { profiles: { ...s.profiles, [networkId]: next } };
    });
  },

  setProfile: (networkId, profile) => {
    set((s) => ({ profiles: { ...s.profiles, [networkId]: profile } }));
  },

  reset: () => set({ networks: [], states: {}, profiles: {}, activeKey: null, loaded: false }),
}));
