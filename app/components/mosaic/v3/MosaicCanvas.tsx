'use client';

import { useEffect, useRef } from 'react';
import type { WindyWebcam } from '@/app/lib/types';
import type { Layout } from './engine/types';
import {
  commit,
  createMotionState,
  isSettled,
  sample,
  type MotionConfig,
} from './motion';

interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
  webcam: WindyWebcam;
}

/**
 * Draws the composed layout through the motion layer. dpr-scaled, black
 * backdrop, drawImage only — frames come from a host with no CORS headers, so
 * the canvas is tainted and reading pixels back would throw. Click hit-testing
 * uses rects captured at draw time rather than the canvas itself.
 *
 * The render loop parks itself whenever every track has settled and no frame
 * is mid-crossfade, so a kiosk sitting on a still composition costs nothing.
 * In `cut` mode that is every frame but the one after a commit, which is
 * exactly what this component did before the motion layer existed.
 */
export function MosaicCanvas({
  layout,
  byId,
  width,
  height,
  motion,
  crossfadeMs,
  panelSlot,
  onSelect,
}: {
  layout: Layout;
  byId: Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>;
  width: number;
  height: number;
  motion: MotionConfig;
  crossfadeMs: number;
  panelSlot: 0 | 1;
  onSelect?: (webcam: WindyWebcam) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitRectsRef = useRef<HitRect[]>([]);
  const stateRef = useRef(createMotionState());
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  // Per-tile image crossfade. Geometry lives in the motion layer; which frame
  // is drawn into that geometry is this component's business.
  const fadesRef = useRef(
    new Map<number, { prev: HTMLImageElement | null; current: HTMLImageElement; startedAt: number }>()
  );
  // Latest props, read inside the loop without restarting it.
  const propsRef = useRef({ layout, byId, width, height, motion, crossfadeMs, panelSlot });
  propsRef.current = { layout, byId, width, height, motion, crossfadeMs, panelSlot };

  // Size the backing store. Separate from the loop so a resize does not
  // discard motion state.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.resetTransform?.();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }, [width, height]);

  useEffect(() => {
    const draw = (now: number) => {
      rafRef.current = null;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const p = propsRef.current;
      const dt = lastTimeRef.current === 0 ? 16 : now - lastTimeRef.current;
      lastTimeRef.current = now;

      const frames = sample(stateRef.current, now, dt, p.motion);

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, p.width, p.height);

      const hits: HitRect[] = [];
      for (const frame of frames) {
        const entry = p.byId.get(frame.id);
        const fade = fadesRef.current.get(frame.id);
        const image = entry?.img ?? fade?.current;
        if (!image) continue;

        const base = Math.max(0, Math.min(1, frame.opacity));
        // A tile whose frame just changed shows the old one underneath until
        // the new one has faded up over it.
        if (fade?.prev) {
          const t = p.crossfadeMs <= 0 ? 1 : (now - fade.startedAt) / p.crossfadeMs;
          if (t >= 1) {
            fade.prev = null;
          } else {
            ctx.globalAlpha = base;
            ctx.drawImage(fade.prev, frame.x, frame.y, frame.width, frame.height);
            ctx.globalAlpha = base * Math.max(0, t);
          }
        } else {
          ctx.globalAlpha = base;
        }

        ctx.drawImage(image, frame.x, frame.y, frame.width, frame.height);
        ctx.globalAlpha = 1;

        if (entry) {
          hits.push({
            x: frame.x, y: frame.y, w: frame.width, h: frame.height, webcam: entry.webcam,
          });
        }
      }
      hitRectsRef.current = hits;

      const fading = [...fadesRef.current.values()].some(
        (f) => f.prev && now - f.startedAt < p.crossfadeMs
      );
      if (!isSettled(stateRef.current, p.motion, now) || fading) {
        rafRef.current = requestAnimationFrame(draw);
      }
    };

    const p = propsRef.current;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // Note which tiles arrived with a different frame than they had before,
    // then hand the new geometry to the motion layer.
    for (const [id, entry] of p.byId) {
      const fade = fadesRef.current.get(id);
      if (!fade) {
        fadesRef.current.set(id, { prev: null, current: entry.img, startedAt: now });
      } else if (fade.current !== entry.img) {
        fade.prev = fade.current;
        fade.current = entry.img;
        fade.startedAt = now;
      }
    }
    for (const id of [...fadesRef.current.keys()]) {
      if (!p.byId.has(id)) fadesRef.current.delete(id);
    }

    commit(
      stateRef.current,
      layout.tiles.map((t) => ({
        id: t.id, x: t.x, y: t.y, width: t.width, height: t.height, lat: t.lat,
      })),
      p.motion,
      now,
      { panelWidth: p.width, panelSlot: p.panelSlot }
    );

    if (rafRef.current === null) rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [layout, byId, width, height, motion, crossfadeMs, panelSlot]);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSelect) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    for (const hit of hitRectsRef.current) {
      if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) {
        onSelect(hit.webcam);
        return;
      }
    }
  };

  return <canvas ref={canvasRef} onClick={handleClick} />;
}
