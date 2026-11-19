// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import { create } from 'zustand';
import { api } from '../api';
import { uploadInChunks } from '../lib/chunkedUpload';

export interface ExportJob {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  progress?: number;
  downloadUrl?: string;
  error?: string;
}

interface DataExportState {
  job: ExportJob | null;
  importing: boolean;
  importProgress: number;
  importError: string;
  importResult: unknown | null;
  startExport: () => Promise<ExportJob>;
  applyFrame: (frame: ExportJob) => void;
  importArchive: (file: File) => Promise<unknown>;
  reset: () => void;
}

export const useDataExportStore = create<DataExportState>((set) => ({
  job: null,
  importing: false,
  importProgress: 0,
  importError: '',
  importResult: null,
  startExport: async () => {
    const { job } = await api('/api/exports', { method: 'POST' });
    set({ job });
    return job;
  },
  applyFrame: (frame) => set({ job: frame }),
  importArchive: async (file) => {
    set({ importing: true, importProgress: 0, importError: '', importResult: null });
    try {
      const result = await uploadInChunks(file, {
        purpose: 'import',
        filename: file.name,
        onProgress: (pct) => set({ importProgress: pct }),
      });
      set({ importResult: result });
      return result;
    } catch (err: any) {
      set({ importError: err?.message || 'import failed' });
      throw err;
    } finally {
      set({ importing: false });
    }
  },
  reset: () =>
    set({
      job: null,
      importing: false,
      importProgress: 0,
      importError: '',
      importResult: null,
    }),
}));
