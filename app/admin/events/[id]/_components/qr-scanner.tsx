"use client";

import jsQR from "jsqr";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { adminCheckInByToken } from "@/lib/actions/events";

// D12/§7.5: browser camera scan, no native app. jsQR runs everywhere
// (including iOS Safari, which never shipped the native BarcodeDetector
// API), so one code path instead of a native-API + fallback split.
export function QrScanner({ eventId }: { eventId: string }) {
  const router = useRouter();
  // Starts active: landing on this page from "Day-of check-in" should open
  // straight to a scanning camera, not require a second click. Stop/start
  // stays available as a manual toggle (privacy, battery, or if permission
  // was denied and the guest wants to retry).
  const [active, setActive] = useState(true);
  const [status, setStatus] = useState<
    { kind: "idle" }
    | { kind: "checking" }
    | { kind: "success" }
    | { kind: "already" }
    | { kind: "invalid"; message: string }
  >({ kind: "idle" });
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const lastTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        tick();
      } catch {
        setStatus({ kind: "invalid", message: "Camera access denied or unavailable." });
        setActive(false);
      }
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(frame.data, frame.width, frame.height);
          if (code?.data && !busyRef.current && code.data !== lastTokenRef.current) {
            void handleToken(code.data);
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    start();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function handleToken(token: string) {
    busyRef.current = true;
    lastTokenRef.current = token;
    setStatus({ kind: "checking" });
    const r = await adminCheckInByToken(token, eventId);
    busyRef.current = false;
    if (r.ok) {
      setStatus({ kind: "success" });
      router.refresh();
    } else if (r.error.message.toLowerCase().includes("already checked in")) {
      setStatus({ kind: "already" });
    } else {
      setStatus({ kind: "invalid", message: r.error.message });
    }
    // Allow re-scanning the same badge after a short pause (e.g. a genuine
    // re-tap), and clear the transient status so the next scan reads clean.
    setTimeout(() => {
      lastTokenRef.current = null;
      setStatus({ kind: "idle" });
    }, 2000);
  }

  return (
    <div className="space-y-3 rounded-md border p-4" data-event-id={eventId}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Scan QR</h3>
        <Button
          type="button"
          size="sm"
          variant={active ? "outline" : "default"}
          onClick={() => setActive((a) => !a)}
        >
          {active ? "Stop camera" : "Start camera"}
        </Button>
      </div>

      {active ? (
        <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-md bg-black">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          <canvas ref={canvasRef} className="hidden" />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Starts your camera to scan a guest&apos;s personal QR. Search the roster
          below to check someone in manually if a camera isn&apos;t available.
        </p>
      )}

      {status.kind === "checking" ? (
        <p className="text-sm text-muted-foreground">Checking…</p>
      ) : null}
      {status.kind === "success" ? (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          Checked in.
        </p>
      ) : null}
      {status.kind === "already" ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          Already checked in.
        </p>
      ) : null}
      {status.kind === "invalid" ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
