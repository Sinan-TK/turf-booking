'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui';

/** The venue-type picker shows a facility's picture at 4:3; it is cropped to exactly that so nothing important gets cut off there. */
export const FACILITY_PHOTO_ASPECT = 4 / 3;
const DEFAULT_OUTPUT_WIDTH = 1200;
const MAX_ZOOM = 4;

type Offset = { x: number; y: number };

/**
 * Lets the admin frame a picture before it is uploaded: drag to move it, zoom with the slider, the mouse wheel or a pinch
 * of the trackpad, and the arrow keys to nudge. The frame has the card banner's shape, so what is inside it is exactly
 * what customers will see. "Use picture" hands back the framed part as WebP (JPEG where the browser cannot make WebP),
 * at most 1200px wide and never enlarged past the original.
 */
export function PhotoCropper({
  file,
  onCancel,
  onCropped,
  aspect = FACILITY_PHOTO_ASPECT,
  outputWidth = DEFAULT_OUTPUT_WIDTH,
  subject = 'picture',
}: {
  /** Width over height of the frame; the picture is cropped to exactly this shape. */
  aspect?: number;
  /** The widest the result is made, in pixels (never enlarged past the original). */
  outputWidth?: number;
  /** What is being framed, for the dialog's words. */
  subject?: string;
  file: File;
  onCancel: () => void;
  onCropped: (photo: Blob) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; start: Offset } | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  // The frame follows the dialog's width (phones and desktops alike).
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const watch = new ResizeObserver(() => setFrameWidth(el.clientWidth));
    watch.observe(el);
    setFrameWidth(el.clientWidth);
    return () => watch.disconnect();
  }, []);

  const frameHeight = frameWidth / aspect;
  // At zoom 1 the photo just covers the frame; every zoom is relative to that.
  const cover = natural ? Math.max(frameWidth / natural.w, frameHeight / natural.h) : 1;
  const scale = cover * zoom;
  const shownW = natural ? natural.w * scale : 0;
  const shownH = natural ? natural.h * scale : 0;

  /** Keeps the photo covering the whole frame: it can move only as far as its overhang. */
  const clamp = (o: Offset, w = shownW, h = shownH): Offset => {
    const maxX = Math.max(0, (w - frameWidth) / 2);
    const maxY = Math.max(0, (h - frameHeight) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, o.x)), y: Math.min(maxY, Math.max(-maxY, o.y)) };
  };

  function changeZoom(next: number) {
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    if (!natural) return setZoom(z);
    // Zoom around the frame's centre: the offset grows with the photo.
    const ratio = z / zoom;
    setZoom(z);
    setOffset((o) => clamp({ x: o.x * ratio, y: o.y * ratio }, natural.w * cover * z, natural.h * cover * z));
  }

  async function cropAndUse() {
    if (!natural || !url) return;
    setBusy(true);
    setError(null);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      // The framed part, in the photo's own pixels.
      const left = (frameWidth - shownW) / 2 + offset.x;
      const top = (frameHeight - shownH) / 2 + offset.y;
      const sx = -left / scale;
      const sy = -top / scale;
      const sw = frameWidth / scale;
      const sh = frameHeight / scale;
      const outW = Math.max(1, Math.round(Math.min(outputWidth, sw)));
      const outH = Math.max(1, Math.round(outW / aspect)); // a tiny picture must not round to an empty canvas
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      const encode = (type: string) => new Promise<Blob | null>((done) => canvas.toBlob(done, type, 0.82));
      const webp = await encode('image/webp');
      const photo = webp && webp.type === 'image/webp' ? webp : await encode('image/jpeg');
      if (!photo) throw new Error('This photo could not be prepared. Try another one.');
      onCropped(photo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This photo could not be prepared. Try another one.');
      setBusy(false);
    }
  }

  return (
    <Modal title={`Frame the ${subject}`} subtitle="Drag to move it and zoom to fit. Customers see exactly what is inside the frame." onClose={onCancel} busy={busy}>
      <div className="flex flex-col gap-4 px-6 py-5">
        <div
          ref={frame}
          tabIndex={0}
          role="application"
          aria-label="Picture frame. Drag, or use the arrow keys, to move the picture; plus and minus zoom."
          className="relative w-full cursor-grab touch-none select-none overflow-hidden rounded-xl bg-gray-100 outline-none ring-brand-500/40 focus-visible:ring-4 active:cursor-grabbing"
          style={{ aspectRatio: `${aspect}` }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: offset };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.id !== e.pointerId) return;
            setOffset(clamp({ x: d.start.x + e.clientX - d.x, y: d.start.y + e.clientY - d.y }));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onWheel={(e) => changeZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 40 : 10;
            const moves: Record<string, Offset> = { ArrowLeft: { x: step, y: 0 }, ArrowRight: { x: -step, y: 0 }, ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step } };
            if (moves[e.key]) {
              e.preventDefault();
              setOffset((o) => clamp({ x: o.x + moves[e.key]!.x, y: o.y + moves[e.key]!.y }));
            } else if (e.key === '+' || e.key === '=') changeZoom(zoom + 0.1);
            else if (e.key === '-') changeZoom(zoom - 0.1);
          }}
        >
          {url && (
            <img
              src={url}
              alt=""
              draggable={false}
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              onError={() => setError('This file could not be opened as a photo.')}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
              style={{ width: shownW || undefined, height: shownH || undefined, transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`, visibility: natural ? 'visible' : 'hidden' }}
            />
          )}
          {/* Rule-of-thirds guides help keep the subject centred. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className="border border-white/25" />
            ))}
          </div>
        </div>

        <label className="flex items-center gap-3 text-sm text-gray-600">
          <span className="w-12 shrink-0">Zoom</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => changeZoom(Number(e.target.value))}
            className="w-full accent-brand-600"
            aria-label="Zoom"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void cropAndUse()} disabled={busy || !natural}>
            {busy ? 'Preparing…' : 'Use picture'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
