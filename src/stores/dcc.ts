// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { api, resolveServerUrl } from '../api';
import { uploadInChunks } from '../lib/chunkedUpload';
import { useConfigStore } from './config';

export { describePacks } from '../shared/xdcc';

export type DccState =
  | 'queued'
  | 'requested'
  | 'pending_approval'
  | 'connecting'
  | 'receiving'
  | 'stalled'
  | 'verifying'
  | 'offered'
  | 'sending'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'cancelled';

export type DccCrcStatus = 'ok' | 'mismatch' | 'absent' | 'unverified';

export interface DccTransfer {
  id: number;
  network_id: number | null;
  peer_nick: string;
  direction: 'recv' | 'send';
  filename: string;
  advertised_size: number;
  received_bytes: number;
  state: DccState;
  crc_status: DccCrcStatus | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  secure?: number;
  file_deleted_at?: string | null;
  destination_path?: string | null;
  file_id?: number | null;
  pack?: number | null;
  queue_seq?: number | null;
  attempt?: number;
  bot_acked_at?: string | null;
}

export interface DccFile {
  id: number;
  name: string;
  size: number;
  origin: 'received' | 'uploaded';
  created_at: string;
  transfer_id: number | null;
  peer_nick: string | null;
  network_id: number | null;
  crc_status: DccCrcStatus | null;
}

export interface DccSendPick {
  networkId: number;
  nick: string;
  passive: boolean;
  secure?: boolean;
}

export interface DccAccountConfig {
  chat: boolean;
  receive: boolean;
  send: boolean;
  passive: boolean;
  maxBytes: number;
  quotaBytes: number;
}

const ACTIVE_STATES = new Set<DccState>([
  'queued',
  'requested',
  'pending_approval',
  'connecting',
  'receiving',
  'stalled',
  'verifying',
  'offered',
  'sending',
]);

interface DccStoreState {
  transfers: DccTransfer[];
  files: DccFile[];
  config: DccAccountConfig | null;
  loaded: boolean;
  filesLoaded: boolean;
  modalOpen: boolean;
  modalTab: 'transfers' | 'files';
  sendPick: DccSendPick | null;
  uploadingFile: boolean;
  uploadProgress: number;
  activeCount: () => number;
  pendingCount: () => number;
  hasAnyActivity: () => boolean;
  openModal: (tab?: 'transfers' | 'files', sendPick?: DccSendPick | null) => void;
  closeModal: () => void;
  fetchAll: () => Promise<void>;
  fetchFiles: () => Promise<void>;
  fetchConfig: () => Promise<DccAccountConfig | null>;
  applyTransfer: (row: DccTransfer) => void;
  applyFile: (row: DccFile) => void;
  applyFileDeleted: (id: number) => void;
  applyTransfersCleared: () => void;
  accept: (id: number) => Promise<void>;
  reject: (id: number) => Promise<void>;
  cancel: (id: number) => Promise<void>;
  removeTransfer: (id: number, deletePartial?: boolean) => Promise<void>;
  clearCompleted: () => Promise<void>;
  uploadForSend: (file: File) => Promise<DccFile>;
  sendFile: (opts: {
    networkId: number;
    nick: string;
    fileId: number;
    passive?: boolean;
    secure?: boolean;
  }) => Promise<DccTransfer>;
  deleteFile: (id: number) => Promise<void>;
  fileDownloadUrl: (id: number) => string;
  openChat: (opts: {
    networkId: number;
    nick: string;
    passive?: boolean;
    secure?: boolean;
  }) => Promise<void>;
  closeChat: (opts: { networkId: number; nick: string }) => Promise<void>;
  enqueueXdcc: (opts: { networkId: number; bot: string; packs: number[] }) => Promise<void>;
  reset: () => void;
}

export const useDccStore = create<DccStoreState>((set, get) => ({
  transfers: [],
  files: [],
  config: null,
  loaded: false,
  filesLoaded: false,
  modalOpen: false,
  modalTab: 'transfers',
  sendPick: null,
  uploadingFile: false,
  uploadProgress: 0,

  activeCount: () => get().transfers.filter((t) => ACTIVE_STATES.has(t.state)).length,
  pendingCount: () => get().transfers.filter((t) => t.state === 'pending_approval').length,
  hasAnyActivity: () => get().transfers.length > 0 || get().files.length > 0,

  openModal: (tab = 'transfers', sendPick = null) =>
    set({ modalOpen: true, modalTab: tab, sendPick }),
  closeModal: () => set({ modalOpen: false, sendPick: null }),

  fetchAll: async () => {
    if (!useConfigStore.getState().features.dcc) return;
    try {
      const data = await api<{ transfers?: DccTransfer[]; files?: DccFile[]; config?: DccAccountConfig }>('/api/dcc');
      set({
        transfers: data.transfers || [],
        ...(data.files ? { files: data.files, filesLoaded: true } : {}),
        ...(data.config ? { config: data.config } : {}),
        loaded: true,
      });
    } catch {
      /* ignore if DCC disabled */
    }
  },

  fetchFiles: async () => {
    if (!useConfigStore.getState().features.dcc) return;
    const { files } = await api<{ files: DccFile[] }>('/api/dcc/files');
    set({ files: files || [], filesLoaded: true });
  },

  fetchConfig: async () => {
    if (!useConfigStore.getState().features.dcc) return null;
    try {
      const config = await api<DccAccountConfig>('/api/dcc/config');
      set({ config });
      return config;
    } catch {
      return null;
    }
  },

  applyTransfer: (row) =>
    set((s) => {
      const idx = s.transfers.findIndex((t) => t.id === row.id);
      if (idx >= 0) {
        const next = [...s.transfers];
        next[idx] = row;
        return { transfers: next };
      }
      return { transfers: [row, ...s.transfers] };
    }),

  applyFile: (row) =>
    set((s) => {
      const idx = s.files.findIndex((f) => f.id === row.id);
      if (idx >= 0) {
        const next = [...s.files];
        next[idx] = row;
        return { files: next };
      }
      return { files: [row, ...s.files] };
    }),

  applyFileDeleted: (id) =>
    set((s) => ({
      files: s.files.filter((f) => f.id !== id),
    })),

  applyTransfersCleared: () =>
    set((s) => ({
      transfers: s.transfers.filter((t) => ACTIVE_STATES.has(t.state)),
    })),

  accept: async (id) => {
    const { transfer } = await api<{ transfer: DccTransfer }>(`/api/dcc/${id}/accept`, {
      method: 'POST',
    });
    if (transfer) get().applyTransfer(transfer);
  },

  reject: async (id) => {
    const { transfer } = await api<{ transfer: DccTransfer }>(`/api/dcc/${id}/reject`, {
      method: 'POST',
    });
    if (transfer) get().applyTransfer(transfer);
  },

  cancel: async (id) => {
    const { transfer } = await api<{ transfer: DccTransfer }>(`/api/dcc/${id}/cancel`, {
      method: 'POST',
    });
    if (transfer) get().applyTransfer(transfer);
  },

  removeTransfer: async (id, deletePartial = false) => {
    await api(`/api/dcc/${id}${deletePartial ? '?partial=delete' : ''}`, { method: 'DELETE' });
    set((s) => ({ transfers: s.transfers.filter((t) => t.id !== id) }));
  },

  clearCompleted: async () => {
    await api('/api/dcc/clear', { method: 'POST' });
    get().applyTransfersCleared();
  },

  uploadForSend: async (file) => {
    set({ uploadingFile: true, uploadProgress: 0 });
    try {
      const res = await uploadInChunks<{ file: DccFile }>(file, {
        purpose: 'dcc-send',
        filename: file.name,
        onProgress: (pct) => set({ uploadProgress: pct }),
      });
      if (res.file) get().applyFile(res.file);
      return res.file;
    } finally {
      set({ uploadingFile: false, uploadProgress: 0 });
    }
  },

  sendFile: async ({ networkId, nick, fileId, passive = false, secure = false }) => {
    const { transfer } = await api<{ transfer: DccTransfer }>('/api/dcc/send', {
      method: 'POST',
      body: { networkId, nick, fileId, passive, secure },
    });
    if (transfer) get().applyTransfer(transfer);
    return transfer;
  },

  deleteFile: async (id) => {
    await api(`/api/dcc/files/${id}`, { method: 'DELETE' });
    get().applyFileDeleted(id);
  },

  fileDownloadUrl: (id) => resolveServerUrl(`/api/dcc/files/${id}/download`),

  openChat: async ({ networkId, nick, passive = false, secure = false }) => {
    await api('/api/dcc/chat', { method: 'POST', body: { networkId, nick, passive, secure } });
  },

  closeChat: async ({ networkId, nick }) => {
    await api('/api/dcc/chat/close', { method: 'POST', body: { networkId, nick } });
  },

  enqueueXdcc: async ({ networkId, bot, packs }) => {
    const { transfers } = await api<{ transfers?: DccTransfer[] }>('/api/dcc/xdcc', {
      method: 'POST',
      body: { networkId, bot, packs },
    });
    for (const t of transfers || []) get().applyTransfer(t);
  },

  reset: () =>
    set({
      transfers: [],
      files: [],
      config: null,
      loaded: false,
      filesLoaded: false,
      modalOpen: false,
      sendPick: null,
      uploadingFile: false,
      uploadProgress: 0,
    }),
}));
