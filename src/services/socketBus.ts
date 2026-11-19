// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

export interface AckResult {
  ok: boolean;
  error?: string;
  data?: unknown;
}

type SendFn = (payload: Record<string, unknown>) => boolean;
type SendWithAckFn = (payload: Record<string, unknown>) => Promise<AckResult>;

let sendImpl: SendFn = () => false;
let sendWithAckImpl: SendWithAckFn = async () => ({ ok: false, error: 'not connected' });

export function registerSocketSenders(send: SendFn, sendWithAck: SendWithAckFn): void {
  sendImpl = send;
  sendWithAckImpl = sendWithAck;
}

export function socketSend(payload: Record<string, unknown>): boolean {
  return sendImpl(payload);
}

export function socketSendWithAck(payload: Record<string, unknown>): Promise<AckResult> {
  return sendWithAckImpl(payload);
}
