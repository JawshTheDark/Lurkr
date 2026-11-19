// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Check,
  Copy,
  Eye,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileText,
  FileVideo,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { AppModal } from './AppModal';
import {
  useUploadsStore,
  getCanInsert,
  subscribeCanInsert,
  type UploadItem,
  type UploadKind,
} from '../stores/uploads';
import { useAuthStore } from '../stores/auth';
import { useMediaViewerStore } from '../hooks/useMediaViewer';
import { resolveServerUrl } from '../api';

interface UploadsModalProps {
  open: boolean;
  onClose: () => void;
}

const KIND_TABS: Array<{ id: UploadKind | null; label: string }> = [
  { id: null, label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'text', label: 'Text' },
];

function KindIcon({ mime }: { mime: string | null }) {
  if (!mime) return <FileIcon size={28} />;
  if (mime.startsWith('video/')) return <FileVideo size={28} />;
  if (mime.startsWith('audio/')) return <FileAudio size={28} />;
  if (mime.startsWith('text/') || mime === 'application/json') return <FileText size={28} />;
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip') || mime.includes('7z')) {
    return <FileArchive size={28} />;
  }
  return <FileIcon size={28} />;
}

export const UploadsModal: React.FC<UploadsModalProps> = ({ open, onClose }) => {
  const recent = useUploadsStore((s) => s.recent);
  const loading = useUploadsStore((s) => s.loading);
  const hasMore = useUploadsStore((s) => s.hasMore);
  const listError = useUploadsStore((s) => s.listError);
  const query = useUploadsStore((s) => s.query);
  const kind = useUploadsStore((s) => s.kind);
  const favoritesOnly = useUploadsStore((s) => s.favoritesOnly);
  const current = useUploadsStore((s) => s.current);
  const failedMessage = useUploadsStore((s) => s.failedMessage);
  const canUpload = useAuthStore((s) => s.canUpload());
  const canInsert = useSyncExternalStore(subscribeCanInsert, getCanInsert, () => false);

  const [searchInput, setSearchInput] = useState(query);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [deleteFailedIds, setDeleteFailedIds] = useState<Record<number, boolean>>({});
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    void useUploadsStore.getState().loadRecent();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (searchInput !== useUploadsStore.getState().query) {
        void useUploadsStore.getState().setFilters({ query: searchInput });
      }
    }, 220);
    return () => clearTimeout(t);
  }, [searchInput, open]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const file = files[0];
    try {
      await useUploadsStore.getState().upload(file, file.name, { insert: false });
    } catch {
      // handled by store failedMessage
    }
  };

  const handleCopy = async (item: UploadItem) => {
    try {
      await navigator.clipboard.writeText(item.url);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((cur) => (cur === item.id ? null : cur)), 1500);
    } catch {
      /* ignore */
    }
  };

  const handleDelete = async (item: UploadItem) => {
    const canDelete = item.can_delete && !item.removed && !deleteFailedIds[item.id];
    if (canDelete) {
      try {
        await useUploadsStore.getState().remove(item.id);
      } catch {
        setDeleteFailedIds((m) => ({ ...m, [item.id]: true }));
      }
    } else {
      await useUploadsStore.getState().forget(item.id);
    }
  };

  const favoritesTruncated = useUploadsStore.getState().favoritesTruncated();

  return (
    <AppModal
      open={open}
      onClose={onClose}
      width="760px"
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <span>Uploads</span>
          {canUpload && (
            <button
              type="button"
              disabled={!!current}
              onClick={() => fileInputRef.current?.click()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 10px',
                borderRadius: '5px',
                border: '1px solid var(--border)',
                background: 'var(--accent)',
                color: '#000',
                fontWeight: 600,
                fontSize: '0.82em',
                cursor: current ? 'wait' : 'pointer',
              }}
            >
              <Upload size={14} />
              {current
                ? current.phase === 'processing'
                  ? current.destination === 'MP4' || current.destination === 'M4A'
                    ? `Converting to ${current.destination}...`
                    : 'Processing...'
                  : `Uploading ${current.progress}%`
                : 'Upload file'}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            hidden
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      }
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (canUpload) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (canUpload) void handleFiles(e.dataTransfer.files);
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          minHeight: '360px',
          outline: dragOver ? '2px dashed var(--accent)' : 'none',
          borderRadius: '6px',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          <div
            style={{
              flex: '1 1 200px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: '5px',
              padding: '4px 8px',
            }}
          >
            <Search size={14} style={{ color: 'var(--fg-muted)' }} />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search filename..."
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                color: 'var(--fg)',
                outline: 'none',
                fontSize: '0.9em',
              }}
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--fg-muted)',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => void useUploadsStore.getState().setFilters({ favoritesOnly: !favoritesOnly })}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 10px',
              borderRadius: '5px',
              border: '1px solid var(--border)',
              background: favoritesOnly ? 'var(--accent)' : 'var(--bg)',
              color: favoritesOnly ? '#000' : 'var(--fg)',
              cursor: 'pointer',
              fontSize: '0.85em',
              fontWeight: favoritesOnly ? 600 : 400,
            }}
          >
            <Star size={14} fill={favoritesOnly ? 'currentColor' : 'none'} />
            Starred
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {KIND_TABS.map((tab) => {
            const active = kind === tab.id;
            return (
              <button
                key={tab.label}
                type="button"
                onClick={() => void useUploadsStore.getState().setFilters({ kind: tab.id })}
                style={{
                  padding: '4px 10px',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  background: active ? 'var(--alt-bg)' : 'transparent',
                  color: active ? 'var(--fg)' : 'var(--fg-muted)',
                  fontWeight: active ? 600 : 400,
                  cursor: 'pointer',
                  fontSize: '0.82em',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {favoritesTruncated && (
          <div style={{ fontSize: '0.82em', color: 'var(--warn)' }}>
            Showing the 200 most recently starred uploads.
          </div>
        )}

        {failedMessage && (
          <div style={{ color: 'var(--bad)', fontSize: '0.9em' }}>{failedMessage}</div>
        )}
        {listError && <div style={{ color: 'var(--bad)', fontSize: '0.9em' }}>{listError}</div>}

        {!loading && recent.length === 0 && (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--fg-muted)' }}>
            No uploads found. {canUpload ? 'Drop a file here or click Upload file.' : ''}
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(152px, 1fr))',
            gap: '10px',
          }}
        >
          {recent.map((item) => {
            const thumb = item.thumbnail_url ? resolveServerUrl(item.thumbnail_url) : null;
            const isImage = item.mime?.startsWith('image/');
            const isVideo = item.mime?.startsWith('video/');
            const isAudio = item.mime?.startsWith('audio/');
            const canPreview = !item.removed && (isImage || isVideo || isAudio);
            const isDel = item.can_delete && !item.removed && !deleteFailedIds[item.id];
            return (
              <div
                key={item.id}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  background: 'var(--bg)',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  opacity: item.removed ? 0.55 : 1,
                }}
              >
                <div
                  style={{
                    height: '104px',
                    background: 'var(--alt-bg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  {thumb && !item.removed ? (
                    <img
                      src={thumb}
                      alt={item.filename || ''}
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{ color: 'var(--fg-muted)' }}>
                      <KindIcon mime={item.mime} />
                    </div>
                  )}
                  {!item.removed && (
                    <button
                      type="button"
                      title={item.favorite ? 'Unstar' : 'Star'}
                      onClick={() => void useUploadsStore.getState().setFavorite(item.id, !item.favorite)}
                      style={{
                        position: 'absolute',
                        top: '5px',
                        right: '5px',
                        background: 'rgba(0,0,0,0.55)',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '4px',
                        color: item.favorite ? 'var(--warn)' : '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                      }}
                    >
                      <Star size={13} fill={item.favorite ? 'currentColor' : 'none'} />
                    </button>
                  )}
                </div>

                <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div
                    title={item.filename || item.url}
                    style={{
                      fontSize: '0.8em',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {item.removed ? '(removed)' : item.filename || 'upload'}
                  </div>
                  <div style={{ display: 'flex', gap: '4px', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {canInsert && !item.removed && (
                        <button
                          type="button"
                          title="Insert URL into message"
                          onClick={() => {
                            useUploadsStore.getState().requestInsert(item.url);
                            onClose();
                          }}
                          style={{
                            padding: '3px 6px',
                            borderRadius: '4px',
                            border: '1px solid var(--border)',
                            background: 'var(--accent)',
                            color: '#000',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                            fontSize: '0.75em',
                            fontWeight: 600,
                          }}
                        >
                          <Plus size={12} /> Insert
                        </button>
                      )}
                      {!item.removed && (
                        <button
                          type="button"
                          title="Copy URL"
                          onClick={() => void handleCopy(item)}
                          style={{
                            padding: '3px 6px',
                            borderRadius: '4px',
                            border: '1px solid var(--border)',
                            background: 'var(--bg-soft)',
                            color: 'var(--fg)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          {copiedId === item.id ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      )}
                      {canPreview && (
                        <button
                          type="button"
                          title="Preview"
                          onClick={() =>
                            useMediaViewerStore.getState().open({
                              url: item.url,
                              kind: isImage ? 'image' : isVideo ? 'video' : 'audio',
                              filename: item.filename || undefined,
                              mime: item.mime || undefined,
                            })
                          }
                          style={{
                            padding: '3px 6px',
                            borderRadius: '4px',
                            border: '1px solid var(--border)',
                            background: 'var(--bg-soft)',
                            color: 'var(--fg)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <Eye size={12} />
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      title={isDel ? 'Delete file' : 'Remove from list'}
                      onClick={() => void handleDelete(item)}
                      style={{
                        padding: '3px 6px',
                        borderRadius: '4px',
                        border: '1px solid var(--border)',
                        background: 'transparent',
                        color: 'var(--bad)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {hasMore && (
          <div style={{ textAlign: 'center', paddingTop: '6px' }}>
            <button
              type="button"
              disabled={loading}
              onClick={() => void useUploadsStore.getState().loadMore()}
              style={{
                padding: '6px 14px',
                borderRadius: '5px',
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--fg)',
                cursor: 'pointer',
              }}
            >
              {loading ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </AppModal>
  );
};
