// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useRef } from 'react';
import { Download, Check, X, Trash2, Upload, FileText } from 'lucide-react';
import { AppModal } from './AppModal';
import { useDccStore } from '../stores/dcc';
import { formatBytes } from '../utils/formatBytes';

export const DccModal: React.FC = () => {
  const open = useDccStore((s) => s.modalOpen);
  const tab = useDccStore((s) => s.modalTab);
  const transfers = useDccStore((s) => s.transfers);
  const files = useDccStore((s) => s.files);
  const sendPick = useDccStore((s) => s.sendPick);
  const uploadingFile = useDccStore((s) => s.uploadingFile);
  const uploadProgress = useDccStore((s) => s.uploadProgress);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      useDccStore.getState().fetchAll();
      useDccStore.getState().fetchFiles();
    }
  }, [open]);

  return (
    <AppModal
      open={open}
      onClose={() => useDccStore.getState().closeModal()}
      title="DCC File Transfers"
      maxWidth="max-w-2xl"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => useDccStore.getState().openModal('transfers', sendPick)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                tab === 'transfers'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              Transfers ({transfers.length})
            </button>
            <button
              type="button"
              onClick={() => useDccStore.getState().openModal('files', sendPick)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                tab === 'files'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              Files ({files.length})
            </button>
          </div>
          {tab === 'transfers' && transfers.length > 0 && (
            <button
              type="button"
              onClick={() => useDccStore.getState().clearCompleted()}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Clear Completed
            </button>
          )}
        </div>

        {tab === 'transfers' ? (
          <div className="max-h-80 overflow-y-auto space-y-2">
            {transfers.length === 0 && (
              <div className="py-10 text-center text-xs text-[var(--text-muted)]">
                No DCC transfers.
              </div>
            )}
            {transfers.map((t) => {
              const pct =
                t.advertised_size > 0
                  ? Math.min(100, Math.round((t.received_bytes / t.advertised_size) * 100))
                  : 0;
              return (
                <div
                  key={t.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-2.5 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--text-primary)] truncate">
                        {t.filename}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {t.direction === 'recv' ? 'From' : 'To'} {t.peer_nick} ·{' '}
                        {formatBytes(t.received_bytes)} / {formatBytes(t.advertised_size)} ·{' '}
                        <span className="capitalize">{t.state.replace('_', ' ')}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {t.state === 'pending_approval' && (
                        <>
                          <button
                            type="button"
                            onClick={() => useDccStore.getState().accept(t.id)}
                            className="rounded bg-emerald-600 p-1 text-white hover:bg-emerald-500"
                            title="Accept"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => useDccStore.getState().reject(t.id)}
                            className="rounded bg-red-600 p-1 text-white hover:bg-red-500"
                            title="Reject"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      {t.state === 'completed' && t.file_id && (
                        <a
                          href={useDccStore.getState().fileDownloadUrl(t.file_id)}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded border border-[var(--border)] p-1 text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                          title="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => useDccStore.getState().removeTransfer(t.id, false)}
                        className="rounded p-1 text-[var(--text-muted)] hover:text-red-400"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {(t.state === 'receiving' || t.state === 'sending') && (
                    <div className="h-1 w-full rounded bg-[var(--border)] overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                  {t.error && <div className="text-[11px] text-red-400">{t.error}</div>}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    await useDccStore.getState().uploadForSend(file);
                    e.target.value = '';
                  }
                }}
              />
              <button
                type="button"
                disabled={uploadingFile}
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" />
                {uploadingFile ? `Uploading ${uploadProgress}%...` : 'Upload File for DCC Send'}
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {files.length === 0 && (
                <div className="py-8 text-center text-xs text-[var(--text-muted)]">
                  No DCC files stored.
                </div>
              )}
              {files.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-[var(--accent)] shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--text-primary)] truncate">
                        {f.name}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {formatBytes(f.size)} · {f.origin}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {sendPick && (
                      <button
                        type="button"
                        onClick={() =>
                          useDccStore.getState().sendFile({
                            networkId: sendPick.networkId,
                            nick: sendPick.nick,
                            fileId: f.id,
                            passive: sendPick.passive,
                            secure: sendPick.secure,
                          })
                        }
                        className="rounded bg-[var(--accent)] px-2 py-1 text-[11px] text-white"
                      >
                        Send to {sendPick.nick}
                      </button>
                    )}
                    <a
                      href={useDccStore.getState().fileDownloadUrl(f.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border border-[var(--border)] p-1 text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => useDccStore.getState().deleteFile(f.id)}
                      className="rounded p-1 text-[var(--text-muted)] hover:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppModal>
  );
};
