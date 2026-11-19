// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useState } from 'react';
import { AppModal } from './AppModal';
import { useUploadsStore } from '../stores/uploads';

interface LongMessageUploadModalProps {
  open: boolean;
  content: string;
  onClose: () => void;
  onSendAnyway: () => void;
  onUploaded: (url: string) => void;
}

export const LongMessageUploadModal: React.FC<LongMessageUploadModalProps> = ({
  open,
  content,
  onClose,
  onSendAnyway,
  onUploaded,
}) => {
  const [filename, setFilename] = useState('message.txt');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleUpload = async () => {
    setUploading(true);
    setError('');
    try {
      const res = await useUploadsStore
        .getState()
        .uploadText(content, filename.trim() || 'message.txt');
      if (res?.url) onUploaded(res.url);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title="Message exceeds IRC line budget"
      width="500px"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onSendAnyway}>
            Split &amp; send anyway
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={uploading}
            onClick={() => void handleUpload()}
          >
            {uploading ? 'Uploading...' : 'Upload as .txt'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <p style={{ margin: 0, fontSize: '0.9em', color: 'var(--fg-muted)' }}>
          Your message is {content.length} characters and would split into multiple IRC lines.
          You can upload it as a text file and share the link instead.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85em' }}>
          <span>Filename</span>
          <input
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            style={{
              padding: '6px 8px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--fg)',
            }}
          />
        </label>
        <pre
          style={{
            margin: 0,
            padding: '8px',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            maxHeight: '160px',
            overflow: 'auto',
            fontSize: '0.8em',
            whiteSpace: 'pre-wrap',
          }}
        >
          {content}
        </pre>
        {error && <div style={{ color: 'var(--bad)', fontSize: '0.85em' }}>{error}</div>}
      </div>
    </AppModal>
  );
};
