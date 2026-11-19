import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import {
  getPreviewCacheBackendKind,
  isCacheablePreviewUrl,
  peekCachedPreviewBlobUrl,
  resolveEncryptedPreviewImageUrl,
  useEncryptedPreviewCacheStore,
} from '../lib/encryptedPreviewCache';

export interface ResolvedPreviewImage {
  src: string | null;
  loading: boolean;
  failed: boolean;
}

export function useCachedPreviewImage(rawSrc: string | null | undefined): ResolvedPreviewImage {
  const cacheEnabled = useEncryptedPreviewCacheStore((s) => s.enabled);
  const backendKind = getPreviewCacheBackendKind();
  const shouldEncryptCache =
    cacheEnabled && backendKind !== 'none' && isCacheablePreviewUrl(rawSrc);

  const [resolved, setResolved] = useState<{
    raw: string | null | undefined;
    src: string | null;
    done: boolean;
    failed: boolean;
  }>(() => {
    if (!rawSrc || !shouldEncryptCache) {
      return { raw: rawSrc, src: rawSrc ?? null, done: true, failed: false };
    }
    const hit = peekCachedPreviewBlobUrl(rawSrc);
    if (hit) {
      return { raw: rawSrc, src: hit, done: true, failed: false };
    }
    return { raw: rawSrc, src: null, done: false, failed: false };
  });

  useEffect(() => {
    if (!rawSrc || !shouldEncryptCache) {
      setResolved({ raw: rawSrc, src: rawSrc ?? null, done: true, failed: false });
      return;
    }

    const hit = peekCachedPreviewBlobUrl(rawSrc);
    if (hit) {
      setResolved({ raw: rawSrc, src: hit, done: true, failed: false });
      return;
    }

    let cancelled = false;
    setResolved({ raw: rawSrc, src: null, done: false, failed: false });

    void resolveEncryptedPreviewImageUrl(rawSrc).then((blobUrl) => {
      if (cancelled) return;
      if (blobUrl) {
        setResolved({ raw: rawSrc, src: blobUrl, done: true, failed: false });
        return;
      }
      // On desktop Electron, session.fetch has session cookies & no CORS limits,
      // so failure indicates an actual broken/non-image URL rather than CORS:
      // avoid touching Chromium's unencrypted disk cache on desktop.
      if (getPreviewCacheBackendKind() === 'desktop') {
        setResolved({ raw: rawSrc, src: null, done: true, failed: true });
      } else {
        setResolved({ raw: rawSrc, src: rawSrc, done: true, failed: false });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [rawSrc, shouldEncryptCache]);

  if (!rawSrc || !shouldEncryptCache) {
    return { src: rawSrc ?? null, loading: false, failed: false };
  }
  if (resolved.raw !== rawSrc) {
    const hit = peekCachedPreviewBlobUrl(rawSrc);
    if (hit) return { src: hit, loading: false, failed: false };
    return { src: null, loading: true, failed: false };
  }
  return {
    src: resolved.src,
    loading: !resolved.done,
    failed: resolved.failed,
  };
}

export interface CachedPreviewImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string | null | undefined;
}

export function CachedPreviewImage({
  src: rawSrc,
  alt,
  className,
  style,
  onError,
  ...rest
}: CachedPreviewImageProps) {
  const { src, loading, failed } = useCachedPreviewImage(rawSrc);
  const firedErrorForRef = useRef<string | null>(null);

  useEffect(() => {
    if (failed && onError && rawSrc && firedErrorForRef.current !== rawSrc) {
      firedErrorForRef.current = rawSrc;
      onError({} as Parameters<NonNullable<typeof onError>>[0]);
    }
  }, [failed, onError, rawSrc]);

  if (!rawSrc || failed) return null;

  if (loading || !src) {
    return (
      <span
        role="img"
        aria-label={alt || 'Decrypting image preview'}
        aria-busy="true"
        className={className}
        style={{
          display: 'inline-block',
          minWidth: 32,
          minHeight: 32,
          backgroundColor: 'rgba(128, 128, 128, 0.14)',
          ...style,
        }}
      />
    );
  }

  return <img src={src} alt={alt} className={className} style={style} onError={onError} {...rest} />;
}
