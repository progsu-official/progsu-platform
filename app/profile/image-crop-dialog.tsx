"use client";

import { ImagePlus, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

// Photo upload + crop, in place. Previously the avatar linked to settings and
// the member lost their place; nothing about picking a photo needs a page.
//
// Two stages: pick, then adjust. The crop viewport is WYSIWYG — the same
// scale/offset that positions the preview <img> drives the canvas draw, so what
// lands in the frame is exactly what gets uploaded.
//
// Shape-agnostic: the avatar passes a square frame with a circular mask, the
// banner a wide rectangle. Everything else — the drag/zoom math, the export,
// the focus trap — is identical, which is the whole reason this lives here.

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

type Stage =
  | { kind: "pick" }
  | { kind: "adjust"; url: string; width: number; height: number }
  | { kind: "uploading" };

export type ImageCropDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Uploads the cropped JPEG. Resolves to an error message, or null on success. */
  onUpload: (blob: Blob) => Promise<string | null>;
  /** Crop frame width / height. 1 = square. */
  aspect: number;
  outputWidth: number;
  outputHeight: number;
  shape: "circle" | "rect";
  maxBytes: number;
  acceptedMimeTypes: readonly string[];
  /** Caps the in-memory working image so a 48MP phone photo isn't held at full size. */
  workingMaxPx?: number;
  labels: {
    /** aria-label on the dialog. */
    dialog: string;
    pickTitle: string;
    adjustTitle: string;
    pickCta: string;
    hint: string;
    confirm: string;
    uploading: string;
  };
  /** Tailwind max-width for the panel. */
  widthClassName?: string;
};

export function ImageCropDialog({
  open,
  onClose,
  onUpload,
  aspect,
  outputWidth,
  outputHeight,
  shape,
  maxBytes,
  acceptedMimeTypes,
  workingMaxPx = 1600,
  labels,
  widthClassName = "max-w-md",
}: ImageCropDialogProps) {
  const [stage, setStage] = useState<Stage>({ kind: "pick" });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  // Measured, not read from the ref during render. geometry() runs while
  // rendering, and on the first adjust-stage pass the ref is still null, so it
  // fell back to a hardcoded width and sized the image for a viewport that was
  // never on screen. Nothing re-rendered afterwards, so the wrong scale stuck
  // until the zoom slider happened to force one -- which is why nudging zoom
  // "fixed" it.
  const [viewportWidth, setViewportWidth] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ id: number; x: number; y: number } | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setStage({ kind: "pick" });
    setError(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  // Measure the crop viewport as soon as it exists, and keep measuring it.
  // Layout effect so the corrected width lands before the browser paints,
  // rather than showing one frame at the fallback scale. ResizeObserver covers
  // the dialog reflowing on rotate or a window resize mid-crop.
  const stageKind = stage.kind;
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (stageKind !== "adjust" || !el) return;
    setViewportWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.target.clientWidth;
      if (next > 0) setViewportWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [stageKind]);

  // Escape + focus trap + scroll lock.
  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables?.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [open, close]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  async function acceptFile(file: File | null | undefined) {
    if (!file) return;
    setError(null);
    if (!acceptedMimeTypes.includes(file.type)) {
      setError("Pick a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > maxBytes) {
      setError(
        `That image is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`
      );
      return;
    }

    try {
      // from-image applies EXIF rotation. Without it, photos taken on a phone
      // preview upright but export sideways, because canvas reads raw pixels.
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      const longest = Math.max(bitmap.width, bitmap.height);
      const k = longest > workingMaxPx ? workingMaxPx / longest : 1;
      const w = Math.round(bitmap.width * k);
      const h = Math.round(bitmap.height * k);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();

      const blob: Blob | null = await new Promise((res) =>
        canvas.toBlob(res, "image/jpeg", 0.92)
      );
      if (!blob) throw new Error("Couldn't read that image");

      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = URL.createObjectURL(blob);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setStage({ kind: "adjust", url: objectUrlRef.current, width: w, height: h });
    } catch {
      setError("Couldn't read that image. Try a different file.");
    }
  }

  // Geometry shared by the preview and the export so they can't disagree.
  function geometry(width: number, height: number) {
    const vw = viewportWidth || viewportRef.current?.clientWidth || 288;
    const vh = vw / aspect;
    const base = Math.max(vw / width, vh / height); // cover
    const eff = base * zoom;
    const maxX = Math.max(0, (width * eff - vw) / 2);
    const maxY = Math.max(0, (height * eff - vh) / 2);
    return { vw, vh, eff, maxX, maxY };
  }

  function clampOffset(next: { x: number; y: number }, width: number, height: number) {
    const { maxX, maxY } = geometry(width, height);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (stage.kind !== "adjust") return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (stage.kind !== "adjust" || dragState.current?.id !== e.pointerId) return;
    const dx = e.clientX - dragState.current.x;
    const dy = e.clientY - dragState.current.y;
    dragState.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setOffset((o) => clampOffset({ x: o.x + dx, y: o.y + dy }, stage.width, stage.height));
  }
  function onPointerUp(e: React.PointerEvent) {
    if (dragState.current?.id === e.pointerId) dragState.current = null;
  }

  // Keyboard pan, so cropping doesn't require a pointer.
  function onViewportKeyDown(e: React.KeyboardEvent) {
    if (stage.kind !== "adjust") return;
    const step = e.shiftKey ? 24 : 8;
    const map: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = map[e.key];
    if (!delta) return;
    e.preventDefault();
    setOffset((o) =>
      clampOffset({ x: o.x + delta[0], y: o.y + delta[1] }, stage.width, stage.height)
    );
  }

  async function onConfirm() {
    if (stage.kind !== "adjust") return;
    const img = imgRef.current;
    if (!img) return;
    setError(null);

    const { vw, vh, eff } = geometry(stage.width, stage.height);
    // Region of the source image currently framed by the crop window.
    const sw = vw / eff;
    const sh = vh / eff;
    const sx = stage.width / 2 - sw / 2 - offset.x / eff;
    const sy = stage.height / 2 - sh / 2 - offset.y / eff;

    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Couldn't process that image.");
      return;
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);

    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob(res, "image/jpeg", 0.92)
    );
    if (!blob) {
      setError("Couldn't process that image.");
      return;
    }

    const back = { url: stage.url, width: stage.width, height: stage.height };
    setStage({ kind: "uploading" });
    const uploadError = await onUpload(blob);
    if (uploadError) {
      setError(uploadError);
      setStage({ kind: "adjust", ...back });
      return;
    }
    close();
  }

  if (!open) return null;

  const adjusting = stage.kind === "adjust";
  const geo = adjusting ? geometry(stage.width, stage.height) : null;
  const circular = shape === "circle";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={labels.dialog}
        className={`glass-blur w-full overflow-hidden rounded-[1.75rem] ${widthClassName}`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <h2 className="text-base font-semibold">
            {adjusting ? labels.adjustTitle : labels.pickTitle}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        <div className="px-5 pb-5">
          {stage.kind === "pick" ? (
            <>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void acceptFile(e.dataTransfer.files?.[0]);
                }}
                style={{ aspectRatio: aspect }}
                className={`flex w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed px-6 text-center transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  dragging
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50 hover:bg-primary/[0.04]"
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-14 w-14 items-center justify-center rounded-2xl transition-colors duration-200 ${
                    dragging
                      ? "bg-primary/20 text-primary"
                      : "bg-muted/70 text-muted-foreground"
                  }`}
                >
                  <ImagePlus size={24} strokeWidth={1.5} />
                </span>
                <span className="text-sm font-medium text-foreground">
                  {dragging ? "Drop to upload" : labels.pickCta}
                </span>
                <span className="text-xs text-muted-foreground">
                  Drag one in, or click to pick a file
                </span>
                <span className="text-[11px] text-muted-foreground/80">
                  {labels.hint}
                </span>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept={acceptedMimeTypes.join(",")}
                className="sr-only"
                onChange={(e) => void acceptFile(e.target.files?.[0])}
              />
            </>
          ) : null}

          {adjusting && geo ? (
            <>
              <div
                ref={viewportRef}
                tabIndex={0}
                role="application"
                aria-label="Drag or use arrow keys to reposition your photo"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={onViewportKeyDown}
                style={{ aspectRatio: aspect }}
                className="relative w-full cursor-grab touch-none overflow-hidden rounded-3xl bg-muted active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={stage.url}
                  alt=""
                  draggable={false}
                  style={{
                    width: stage.width * geo.eff,
                    height: stage.height * geo.eff,
                    transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                  }}
                  className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
                />
                {/* Circular mask: everything outside the circle dims, so the
                    frame shows exactly what the avatar will contain. A
                    rectangular crop needs no mask — the viewport is the frame. */}
                {circular ? (
                  <>
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-3xl shadow-[0_0_0_9999px_hsl(0_0%_0%/0.45)_inset] [clip-path:circle(50%_at_50%_50%)]"
                    />
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-white/40"
                      style={{ clipPath: "circle(50% at 50% 50%)" }}
                    />
                  </>
                ) : (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/40"
                  />
                )}
              </div>

              <label className="mt-4 block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Zoom
                </span>
                <input
                  type="range"
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  step={0.01}
                  value={zoom}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setZoom(next);
                    // Re-clamp so zooming out can't leave a gap at the edges.
                    setOffset((o) => clampOffset(o, stage.width, stage.height));
                  }}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[hsl(var(--primary))]"
                />
              </label>
            </>
          ) : null}

          {stage.kind === "uploading" ? (
            <div
              style={{ aspectRatio: aspect }}
              className="flex w-full flex-col items-center justify-center gap-3"
            >
              <Loader2
                size={26}
                strokeWidth={1.75}
                className="animate-spin text-primary motion-reduce:animate-none"
                aria-hidden
              />
              <p role="status" className="text-sm text-muted-foreground">
                {labels.uploading}
              </p>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {adjusting ? (
            <div className="mt-5 flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={reset}
              >
                Choose another
              </Button>
              <Button
                type="button"
                size="sm"
                className="rounded-full"
                onClick={() => void onConfirm()}
              >
                {labels.confirm}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
