// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { socketSendWithAck } from '../services/socketBus';
import { useToastsStore } from './toasts';

export type OperTab = 'bans' | 'users' | 'broadcast' | 'services' | 'server' | 'auth';

/**
 * Executes a raw IRC oper/admin line over the active socket and shows toast feedback.
 */
export async function executeOperRaw(
  networkId: number,
  line: string,
  successSummary?: string,
): Promise<boolean> {
  const ack = await socketSendWithAck({ type: 'raw', networkId, line });
  if (!ack.ok) {
    useToastsStore.getState().push({
      title: 'Oper Command Failed',
      body: ack.error || 'Command rejected or disconnected',
      kind: 'error',
    });
    return false;
  }
  useToastsStore.getState().push({
    title: 'Sent',
    body: successSummary || line,
    kind: 'info',
  });
  return true;
}

export interface OperPrefill {
  tab?: OperTab;
  networkId?: number | null;
  banType?: string;
  banMask?: string;
  banDuration?: string;
  banFlags?: string;
  banReason?: string;
  targetNick?: string;
  targetChannel?: string;
  userAction?: string;
  userValue?: string;
  broadcastType?: string;
  serviceName?: string;
  serviceCmd?: string;
}

interface OperStoreState {
  modalOpen: boolean;
  toolbarVisible: boolean;
  activeTab: OperTab;
  networkId: number | null;
  banType: string;
  banMask: string;
  banDuration: string;
  banFlags: string;
  banReason: string;
  targetNick: string;
  targetChannel: string;
  userAction: string;
  userValue: string;
  broadcastType: string;
  serviceName: string;
  serviceCmd: string;
  openModal: (prefill?: OperPrefill) => void;
  closeModal: () => void;
  setTab: (tab: OperTab) => void;
  setToolbarVisible: (visible: boolean) => void;
  toggleToolbar: () => void;
  reset: () => void;
}

const DEFAULTS = {
  modalOpen: false,
  toolbarVisible: true,
  activeTab: 'bans' as OperTab,
  networkId: null as number | null,
  banType: 'GLINE',
  banMask: '',
  banDuration: '7d',
  banFlags: '',
  banReason: '',
  targetNick: '',
  targetChannel: '',
  userAction: 'KILL',
  userValue: '',
  broadcastType: 'WALLOPS',
  serviceName: 'OperServ',
  serviceCmd: '',
};

export const useOperStore = create<OperStoreState>((set) => ({
  ...DEFAULTS,
  openModal: (prefill) =>
    set((s) => ({
      modalOpen: true,
      activeTab: prefill?.tab ?? s.activeTab,
      networkId: prefill?.networkId !== undefined ? prefill.networkId : s.networkId,
      banType: prefill?.banType ?? s.banType,
      banMask: prefill?.banMask !== undefined ? prefill.banMask : s.banMask,
      banDuration: prefill?.banDuration ?? s.banDuration,
      banFlags: prefill?.banFlags !== undefined ? prefill.banFlags : s.banFlags,
      banReason: prefill?.banReason !== undefined ? prefill.banReason : s.banReason,
      targetNick: prefill?.targetNick !== undefined ? prefill.targetNick : s.targetNick,
      targetChannel: prefill?.targetChannel !== undefined ? prefill.targetChannel : s.targetChannel,
      userAction: prefill?.userAction ?? s.userAction,
      userValue: prefill?.userValue !== undefined ? prefill.userValue : s.userValue,
      broadcastType: prefill?.broadcastType ?? s.broadcastType,
      serviceName: prefill?.serviceName ?? s.serviceName,
      serviceCmd: prefill?.serviceCmd !== undefined ? prefill.serviceCmd : s.serviceCmd,
    })),
  closeModal: () => set({ modalOpen: false }),
  setTab: (tab) => set({ activeTab: tab }),
  setToolbarVisible: (visible) => set({ toolbarVisible: visible }),
  toggleToolbar: () => set((s) => ({ toolbarVisible: !s.toolbarVisible })),
  reset: () => set(DEFAULTS),
}));
