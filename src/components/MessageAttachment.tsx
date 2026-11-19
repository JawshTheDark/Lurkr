// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useState } from 'react';
import { ExternalLink, Play, Film, Music } from 'lucide-react';
import { useLinkPreview } from '../hooks/useLinkPreview';
import { useMediaViewerStore } from '../hooks/useMediaViewer';
import { resolveServerUrl } from '../api';
import { openExternalUrl, resolveExternalHref } from '../lib/externalUrl';
import { CachedPreviewImage } from './CachedPreviewImage';

interface MessageAttachmentProps {
  url: string;
  inlineMedia: boolean;
  linkPreviews: boolean;
}

function defaultHeading(targetUrl: string, title?: string, siteName?: string): string {
  if (title) return title;
  if (siteName) return siteName;
  try {
    return new URL(targetUrl).hostname || targetUrl;
  } catch {
    return targetUrl;
  }
}

export const MessageAttachment: React.FC<MessageAttachmentProps> = ({
  url,
  inlineMedia,
  linkPreviews,
}) => {
  const preview = useLinkPreview(url);
  const openViewer = useMediaViewerStore((s) => s.open);
  const [embedActive, setEmbedActive] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);

  useEffect(() => {
    setThumbFailed(false);
  }, [preview?.thumb]);

  if (!preview || preview.status !== 'ok') return null;

  const targetUrl = resolveExternalHref(preview.url || url);

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    openExternalUrl(targetUrl);
  };

  if (preview.kind === 'image' && inlineMedia && preview.src) {
    const src = resolveServerUrl(preview.src);
    return (
      <div className="msg-attachment msg-attachment-image" style={{ marginTop: '4px' }}>
        <CachedPreviewImage
          src={src}
          alt={preview.title || 'Image'}
          loading="lazy"
          onClick={() => openViewer({ url: targetUrl, src, kind: 'image', title: preview.title })}
          style={{
            maxWidth: '360px',
            maxHeight: '240px',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            cursor: 'pointer',
            display: 'block',
          }}
        />
      </div>
    );
  }

  if ((preview.kind === 'video' || preview.kind === 'audio') && (inlineMedia || linkPreviews)) {
    const heading = defaultHeading(targetUrl, preview.title, preview.siteName);
    if (inlineMedia && preview.src) {
      const src = resolveServerUrl(preview.src);
      return (
        <div
          className={`msg-attachment msg-attachment-${preview.kind}`}
          style={{ marginTop: '4px', maxWidth: '400px' }}
        >
          {preview.kind === 'video' ? (
            <video
              src={src}
              controls
              preload="metadata"
              style={{
                maxWidth: '400px',
                maxHeight: '260px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                display: 'block',
              }}
            />
          ) : (
            <audio src={src} controls preload="metadata" style={{ maxWidth: '360px', display: 'block' }} />
          )}
          <a
            href={targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleLinkClick}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              marginTop: '3px',
              fontSize: '0.78em',
              color: 'var(--link)',
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '360px' }}>
              {heading}
            </span>
            <ExternalLink size={11} style={{ flexShrink: 0 }} />
          </a>
        </div>
      );
    }

    return (
      <a
        href={targetUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleLinkClick}
        className={`msg-attachment msg-attachment-${preview.kind}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginTop: '4px',
          maxWidth: '420px',
          padding: '8px 10px',
          background: 'var(--bg-soft)',
          border: '1px solid var(--border)',
          borderLeft: '3px solid var(--accent)',
          borderRadius: '6px',
          textDecoration: 'none',
          color: 'var(--fg)',
          cursor: 'pointer',
        }}
      >
        {preview.thumb && !thumbFailed ? (
          <CachedPreviewImage
            src={resolveServerUrl(preview.thumb)}
            alt=""
            onError={() => setThumbFailed(true)}
            style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }}
          />
        ) : (
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '4px',
              background: 'var(--embed-bg, rgba(255,255,255,0.05))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: 'var(--fg-muted)',
            }}
          >
            {preview.kind === 'video' ? <Film size={16} /> : <Music size={16} />}
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '0.88em', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {heading}
            </span>
            <ExternalLink size={12} style={{ flexShrink: 0, color: 'var(--fg-muted)' }} />
          </div>
          <div style={{ fontSize: '0.78em', color: 'var(--fg-muted)' }}>
            {preview.mime || (preview.kind === 'video' ? 'Video' : 'Audio')}
          </div>
        </div>
      </a>
    );
  }

  if (preview.kind === 'video-embed' && linkPreviews && preview.embedUrl) {
    const heading = defaultHeading(targetUrl, preview.title, preview.siteName);
    return (
      <div
        className="msg-attachment msg-attachment-embed"
        style={{
          marginTop: '4px',
          maxWidth: '420px',
          border: '1px solid var(--border)',
          borderLeft: '3px solid var(--accent)',
          borderRadius: '6px',
          overflow: 'hidden',
          background: 'var(--bg-soft)',
        }}
      >
        <div
          style={{
            padding: '7px 10px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <a
            href={targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleLinkClick}
            style={{
              minWidth: 0,
              flex: 1,
              fontSize: '0.88em',
              fontWeight: 600,
              color: 'var(--fg)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              cursor: 'pointer',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {heading}
            </span>
            <ExternalLink size={12} style={{ flexShrink: 0, color: 'var(--fg-muted)' }} />
          </a>
        </div>
        {embedActive ? (
          <iframe
            src={preview.embedUrl}
            title={heading}
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            style={{ width: '100%', height: '236px', border: 'none', display: 'block' }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEmbedActive(true)}
            aria-label={`Play ${heading}`}
            style={{
              position: 'relative',
              cursor: 'pointer',
              display: 'block',
              width: '100%',
              padding: 0,
              border: 'none',
              background: 'transparent',
              color: 'var(--fg)',
              textAlign: 'left',
            }}
          >
            {preview.thumb && !thumbFailed && (
              <CachedPreviewImage
                src={resolveServerUrl(preview.thumb)}
                alt=""
                onError={() => setThumbFailed(true)}
                style={{ width: '100%', maxHeight: '220px', objectFit: 'cover', display: 'block' }}
              />
            )}
            <div style={{ padding: '7px 10px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8em', color: 'var(--fg-muted)' }}>
              <Play size={14} />
              <span>Play inline</span>
            </div>
          </button>
        )}
      </div>
    );
  }

  if (
    preview.kind === 'page' &&
    linkPreviews &&
    (preview.title || preview.description || preview.thumb || preview.siteName)
  ) {
    const pageHeading = defaultHeading(targetUrl, preview.title, preview.siteName);
    return (
      <a
        href={targetUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleLinkClick}
        style={{
          display: 'flex',
          gap: '10px',
          marginTop: '4px',
          maxWidth: '460px',
          padding: '8px 10px',
          background: 'var(--bg-soft)',
          border: '1px solid var(--border)',
          borderLeft: '3px solid var(--accent)',
          borderRadius: '6px',
          textDecoration: 'none',
          color: 'var(--fg)',
          cursor: 'pointer',
        }}
      >
        {preview.thumb && !thumbFailed && (
          <CachedPreviewImage
            src={resolveServerUrl(preview.thumb)}
            alt=""
            onError={() => setThumbFailed(true)}
            style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }}
          />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          {preview.siteName && (
            <div style={{ fontSize: '0.75em', color: 'var(--fg-muted)' }}>{preview.siteName}</div>
          )}
          <div style={{ fontSize: '0.88em', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {pageHeading}
            </span>
            <ExternalLink size={12} style={{ flexShrink: 0, color: 'var(--fg-muted)' }} />
          </div>
          {preview.description && (
            <div
              style={{
                fontSize: '0.8em',
                color: 'var(--fg-muted)',
                marginTop: '2px',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {preview.description}
            </div>
          )}
        </div>
      </a>
    );
  }

  return null;
};
