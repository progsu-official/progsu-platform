"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { createClient as createBrowserClient } from "@/lib/supabase/browser";
import {
  createEventCoverUploadUrl,
  deleteEventCover,
  updateEvent,
} from "@/lib/actions/events";
import {
  EVENT_COVER_MIME_TYPES,
  MAX_EVENT_COVER_BYTES,
} from "@/lib/actions/event-schemas";

const EVENT_COVERS_BUCKET = "event-covers";
const ACCEPTED_MIMES = EVENT_COVER_MIME_TYPES as readonly string[];
const ACCEPT_ATTR = ACCEPTED_MIMES.join(",");
const MAX_MB = Math.round(MAX_EVENT_COVER_BYTES / (1024 * 1024));

type Props = {
  eventId: string;
  currentPath: string | null;
  currentUrl: string | null;
};

export function CoverUploader({ eventId, currentPath, currentUrl }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function runUpload(file: File) {
    if (!ACCEPTED_MIMES.includes(file.type)) {
      setError("Only JPEG, PNG, or WebP images are allowed.");
      return;
    }
    if (file.size > MAX_EVENT_COVER_BYTES) {
      setError(`Image must be ${MAX_MB} MB or less.`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const signed = await createEventCoverUploadUrl({
        eventId,
        contentType: file.type as (typeof EVENT_COVER_MIME_TYPES)[number],
        fileSize: file.size,
      });
      if (!signed.ok) {
        setError(signed.error.message);
        return;
      }

      const supabase = createBrowserClient();
      const { error: uploadErr } = await supabase.storage
        .from(EVENT_COVERS_BUCKET)
        .uploadToSignedUrl(signed.data.path, signed.data.token, file, {
          contentType: file.type,
        });
      if (uploadErr) {
        setError(uploadErr.message);
        return;
      }

      const upd = await updateEvent(eventId, {
        cover_image_path: signed.data.path,
      });
      if (!upd.ok) {
        setError(upd.error.message);
        return;
      }

      // Reset the file input so selecting the same name again re-triggers.
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    });
  }

  function runRemove() {
    setError(null);
    startTransition(async () => {
      const r = await deleteEventCover(eventId);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-4">
        {currentUrl ? (
          // Plain <img>: Next/Image needs a remote-patterns config per origin
          // and covers come from Supabase signed URLs, which expire. Raw img
          // avoids that dance.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentUrl}
            alt="Event cover"
            className="h-32 w-52 rounded-md border object-cover"
          />
        ) : (
          <div className="flex h-32 w-52 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
            No cover
          </div>
        )}
        <div className="flex-1 space-y-2">
          <p className="text-xs text-muted-foreground">
            JPEG, PNG, or WebP. Up to {MAX_MB} MB. Recommended ~ 1600×900.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={pending}
            >
              {currentPath ? "Replace cover" : "Upload cover"}
            </Button>
            {currentPath ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={runRemove}
                disabled={pending}
              >
                Remove
              </Button>
            ) : null}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) runUpload(f);
            }}
          />
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
