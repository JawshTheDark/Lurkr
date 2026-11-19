// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';

let nextId = 1;
const actionHandlers = new Map<number, Array<() => void>>();

export type ToastKind =
  | 'highlight'
  | 'dm'
  | 'always_notify'
  | 'kicked'
  | 'notify'
  | 'info'
  | 'warn'
  | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
  tone?: 'good' | 'bad' | 'muted';
}

export interface ToastActionLabel {
  label: string;
  tone?: 'good' | 'bad' | 'muted';
}

export interface Toast {
  id: number;
  title: string;
  body: string;
  networkId?: number;
  target?: string;
  messageId?: number;
  kind: ToastKind;
  actions?: ToastActionLabel[];
  dismissible?: boolean;
}

export interface ToastOptions {
  title: string;
  body: string;
  networkId?: number;
  target?: string;
  messageId?: number;
  kind?: ToastKind;
  ttlMs?: number;
  action?: ToastAction;
  actions?: ToastAction[];
  dismissible?: boolean;
}

interface ToastsState {
  items: Toast[];
  push: {
    (opts: ToastOptions): number;
    (message: string, kind?: ToastKind | 'success'): number;
  };
  invokeAction: (id: number, index: number) => void;
  dismiss: (id: number) => void;
  clear: () => void;
}

export const useToastsStore = create<ToastsState>((set, get) => ({
  items: [],
  push: ((optsOrMsg: ToastOptions | string, kindArg?: ToastKind | 'success') => {
    const opts: ToastOptions =
      typeof optsOrMsg === 'string'
        ? {
            title: optsOrMsg,
            body: '',
            kind: kindArg === 'success' ? 'info' : kindArg || 'info',
          }
        : optsOrMsg;
    const {
      title,
      body,
      networkId,
      target,
      messageId,
      kind = 'highlight',
      ttlMs = 5000,
      action,
      actions,
      dismissible,
    } = opts;
    const id = nextId++;
    const all = actions ?? (action ? [action] : []);
    if (all.length) {
      actionHandlers.set(
        id,
        all.map((a) => a.onClick),
      );
    }
    const toast: Toast = {
      id,
      title,
      body,
      networkId,
      target,
      messageId,
      kind,
      ...(all.length ? { actions: all.map((a) => ({ label: a.label, tone: a.tone })) } : {}),
      ...(dismissible !== undefined ? { dismissible } : {}),
    };
    set((s) => ({ items: [...s.items, toast] }));
    if (ttlMs > 0) {
      setTimeout(() => get().dismiss(id), ttlMs);
    }
    return id;
  }) as ToastsState['push'],
  invokeAction: (id, index) => {
    const handlers = actionHandlers.get(id);
    const fn = handlers?.[index];
    get().dismiss(id);
    fn?.();
  },
  dismiss: (id) => {
    actionHandlers.delete(id);
    set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
  },
  clear: () => {
    actionHandlers.clear();
    set({ items: [] });
  },
}));
