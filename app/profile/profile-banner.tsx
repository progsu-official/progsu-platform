"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ImagePlus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  BANNER_MIME_TYPES,
  MAX_BANNER_BYTES,
} from "@/lib/actions/banner-schemas";
import {
  createBannerUploadUrl,
  finalizeBannerUpload,
  removeBanner,
} from "@/lib/actions/banner";

const ACCEPT = BANNER_MIME_TYPES.join(",");
const MAX_MB = Math.round(MAX_BANNER_BYTES / (1024 * 1024));

/**
 * Editable header image. Same affordance as the avatar: a scrim on
 * hover/focus, but the controls stay reachable on touch where there is no
 * hover to reveal them.
 */
export function ProfileBanner({ bannerUrl }: { bannerUrl: string | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function upload(file: File) {
    if (!(BANNER_MIME_TYPES as readonly string[]).includes(file.type)) {
      setError("Use a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_BANNER_BYTES) {
      setError(`Banner must be ${MAX_MB} MB or smaller.`);
      return;
    }
    setError(null);

    startTransition(async () => {
      const created = await createBannerUploadUrl({
        mimeType: file.type as (typeof BANNER_MIME_TYPES)[number],
        fileSize: file.size,
      });
      if (!created.ok) {
        setError(created.error.message);
        return;
      }
      const put = await fetch(created.data.signedUrl, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!put.ok) {
        setError(`Upload failed (${put.status}).`);
        return;
      }
      const finalized = await finalizeBannerUpload({ path: created.data.path });
      if (!finalized.ok) {
        setError(finalized.error.message);
        return;
      }
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    });
  }

  function clear() {
    setError(null);
    startTransition(async () => {
      const result = await removeBanner();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "group relative isolate overflow-hidden rounded-2xl",
          "h-36 sm:h-48",
          bannerUrl ? "bg-muted" : "bg-primary/10"
        )}
      >
        {bannerUrl ? (
          // Raw img: banners are Supabase public URLs on a bucket next/image
          // has no remote pattern for, and they change per upload.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bannerUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="h-full w-full"
            style={{
              backgroundImage:
                "radial-gradient(60% 80% at 12% 0%, hsl(var(--primary) / 0.35), transparent 62%), radial-gradient(55% 75% at 88% 10%, hsl(var(--primary) / 0.22), transparent 58%)",
            }}
          />
        )}

        {/* Hover/focus scrim, mirroring AvatarButton. */}
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center gap-2 bg-black/45 transition-opacity duration-200",
            // opacity-0 still hit-tests. Left interactive, this scrim covers
            // the whole banner and swallows clicks on anything overlapping it.
            "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100",
            "focus-within:pointer-events-auto focus-within:opacity-100",
            "motion-reduce:transition-none",
            pending && "pointer-events-auto opacity-100"
          )}
        >
          <button
            type="button"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-sm font-medium text-neutral-900 shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-70"
          >
            <ImagePlus size={15} strokeWidth={1.75} aria-hidden />
            {pending
              ? "Working…"
              : bannerUrl
                ? "Change banner"
                : "Add a banner"}
          </button>
          {bannerUrl ? (
            <button
              type="button"
              disabled={pending}
              onClick={clear}
              aria-label="Remove banner"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white ring-1 ring-white/25 transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-70"
            >
              <Trash2 size={15} strokeWidth={1.75} aria-hidden />
            </button>
          ) : null}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
          }}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Read-only variant for peer-visible member cards. */
export function StaticBanner({ bannerUrl }: { bannerUrl: string | null }) {
  return (
    <div className="h-36 overflow-hidden rounded-2xl bg-muted sm:h-48">
      {bannerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={bannerUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <div
          aria-hidden
          className="h-full w-full"
          style={{
            backgroundImage:
              "radial-gradient(60% 80% at 12% 0%, hsl(var(--primary) / 0.35), transparent 62%), radial-gradient(55% 75% at 88% 10%, hsl(var(--primary) / 0.22), transparent 58%)",
          }}
        />
      )}
    </div>
  );
}
