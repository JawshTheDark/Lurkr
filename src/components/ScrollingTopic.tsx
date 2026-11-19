// Copyright (c) 2026 Brad Root
// SPDX-License-Identifier: MPL-2.0

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LinkedText } from './LinkedText';

interface ScrollingTopicProps {
  topic: string;
  networkId?: number | null;
}

/**
 * Single-line channel topic that truncates cleanly when idle and smoothly scrolls
 * horizontally on mouse hover (or wheel scrub) when its text overflows.
 */
export const ScrollingTopic: React.FC<ScrollingTopicProps> = ({ topic, networkId }) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLSpanElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [manualScroll, setManualScroll] = useState(false);
  const [overflowPx, setOverflowPx] = useState(0);

  const measureOverflow = useCallback(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) {
      setOverflowPx(0);
      return 0;
    }
    const diff = Math.max(0, Math.ceil(track.scrollWidth - viewport.clientWidth));
    setOverflowPx(diff);
    return diff;
  }, []);

  useEffect(() => {
    setHovered(false);
    setManualScroll(false);
    if (viewportRef.current) viewportRef.current.scrollLeft = 0;
    const frame = requestAnimationFrame(() => measureOverflow());
    return () => cancelAnimationFrame(frame);
  }, [topic, measureOverflow]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measureOverflow()) : null;
    ro?.observe(viewport);

    const onWheel = (e: WheelEvent) => {
      const diff = measureOverflow();
      if (diff <= 0) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta !== 0) {
        e.preventDefault();
        setManualScroll(true);
        viewport.scrollLeft = Math.max(0, Math.min(diff, viewport.scrollLeft + delta));
      }
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro?.disconnect();
      viewport.removeEventListener('wheel', onWheel);
    };
  }, [measureOverflow]);

  const handleMouseEnter = () => {
    measureOverflow();
    setManualScroll(false);
    setHovered(true);
  };

  const handleMouseLeave = () => {
    setHovered(false);
    setManualScroll(false);
    if (viewportRef.current) {
      viewportRef.current.scrollLeft = 0;
    }
  };

  const distance = overflowPx > 0 ? overflowPx + 12 : 0;
  const durationSec = distance > 0 ? Math.max(3.5, distance / 48) : 0;
  const animateActive = hovered && !manualScroll && overflowPx > 0;

  const trackClass = hovered
    ? animateActive
      ? 'topic-scroll-track topic-scroll-track-active'
      : 'topic-scroll-track'
    : 'topic-scroll-track topic-scroll-track-idle';

  const trackStyle = animateActive
    ? ({
        '--topic-scroll-dist': `-${distance}px`,
        '--topic-scroll-duration': `${durationSec.toFixed(2)}s`,
      } as React.CSSProperties)
    : undefined;

  return (
    <div
      ref={viewportRef}
      data-testid="channel-topic"
      title={topic}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="hidden md:block flex-1 min-w-0 border-l border-[var(--border)] pl-2 topic-scroll-viewport text-xs text-[var(--text-muted)]"
    >
      <span ref={trackRef} className={trackClass} style={trackStyle}>
        <LinkedText text={topic} networkId={networkId} />
      </span>
    </div>
  );
};
