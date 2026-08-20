"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ImagePlus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { removeBanner } from "@/lib/actions/banner";

import { BannerDialog } from "./banner-dialog";

/**
 * Editable header image. Same affordance as the avatar: a scrim on
 * hover/focus, but the controls stay reachable on touch where there is no
 * hover to reveal them. Picking the image opens the same crop dialog the
 * avatar uses, so a banner gets framed rather than dropped in raw.
 */
export function ProfileBanner({ bannerUrl }: { bannerUrl: string | null }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
            onClick={() => setDialogOpen(true)}
            aria-haspopup="dialog"
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
      </div>

      <BannerDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        hasBanner={Boolean(bannerUrl)}
      />

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
