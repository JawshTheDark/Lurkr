// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect } from 'react';
import { Download, ExternalLink, X } from 'lucide-react';
import { useMediaViewerStore } from '../hooks/useMediaViewer';
import { resolveServerUrl } from '../api';
import { openExternalUrl } from '../lib/externalUrl';
import { useCachedPreviewImage } from './CachedPreviewImage';

export const MediaViewerModal: React.FC = () => {
  const item = useMediaViewerStore((s) => s.item);
  const close = useMediaViewerStore((s) => s.close);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, close]);

  const mediaSrc = item ? resolveServerUrl(item.src || item.url) : '';
  const imagePreview = useCachedPreviewImage(item && item.kind === 'image' ? mediaSrc : null);

  if (!item) return null;

  const openUrl = resolveServerUrl(item.url);
  const displayImageSrc = item.kind === 'image' ? imagePreview.src : mediaSrc;
  const downloadHref = item.kind === 'image' ? imagePreview.src || mediaSrc : mediaSrc;

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1500,
        background: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '14px',
          right: '16px',
          display: 'flex',
          gap: '8px',
        }}
      >
        <a
          href={downloadHref}
          download={item.filename || true}
          title="Download"
          style={{
            background: 'var(--bg-soft)',
            border: '1px solid var(--border)',
            color: 'var(--fg)',
            borderRadius: '6px',
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            textDecoration: 'none',
            fontSize: '0.85em',
          }}
        >
          <Download size={15} /> Download
        </a>
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            openExternalUrl(openUrl);
          }}
          style={{
            background: 'var(--bg-soft)',
            border: '1px solid var(--border)',
            color: 'var(--fg)',
            borderRadius: '6px',
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            cursor: 'pointer',
            textDecoration: 'none',
            fontSize: '0.85em',
          }}
        >
          <ExternalLink size={15} /> Open
        </a>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          style={{
            background: 'var(--bg-soft)',
            border: '1px solid var(--border)',
            color: 'var(--fg)',
            borderRadius: '6px',
            padding: '6px 8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <X size={16} />
        </button>
      </div>

      {item.kind === 'image' && imagePreview.loading && (
        <div
          style={{
            padding: '28px 36px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            background: 'var(--bg-soft)',
            color: 'var(--fg-muted)',
            fontSize: '0.9em',
          }}
        >
          Decrypting preview…
        </div>
      )}
      {item.kind === 'image' && !imagePreview.loading && displayImageSrc && (
        <img
          src={displayImageSrc}
          alt={item.title || item.filename || 'Image'}
          style={{
            maxWidth: '92vw',
            maxHeight: '84vh',
            objectFit: 'contain',
            borderRadius: '4px',
          }}
        />
      )}
      {item.kind === 'video' && (
        <video
          src={mediaSrc}
          controls
          autoPlay
          style={{ maxWidth: '92vw', maxHeight: '84vh', borderRadius: '4px' }}
        />
      )}
      {item.kind === 'audio' && (
        <audio src={mediaSrc} controls autoPlay style={{ width: 'min(480px, 90vw)' }} />
      )}

      {(item.title || item.filename) && (
        <div style={{ marginTop: '10px', color: 'var(--fg-muted)', fontSize: '0.85em' }}>
          {item.title || item.filename}
        </div>
      )}
    </div>
  );
};
