"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  createAvatarUploadUrl,
  finalizeAvatarUpload,
  removeAvatar,
} from "@/lib/actions/avatar";
import { Avatar } from "@/app/_components/avatar";

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"] as const;

export function PhotoSettings({
  currentAvatarUrl,
  displayName,
}: {
  currentAvatarUrl: string | null;
  displayName: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "uploading" }
    | { kind: "saved" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  function onPick(f: File | null) {
    if (!f) return;
    if (!ACCEPTED.includes(f.type as (typeof ACCEPTED)[number])) {
      setStatus({ kind: "error", message: "Pick a JPEG, PNG, or WebP image." });
      return;
    }
    if (f.size > MAX_BYTES) {
      setStatus({ kind: "error", message: "Photo is larger than 2 MB." });
      return;
    }
    setStatus({ kind: "uploading" });
    startTransition(async () => {
      const created = await createAvatarUploadUrl({
        mimeType: f.type as (typeof ACCEPTED)[number],
        fileSize: f.size,
      });
      if (!created.ok) {
        setStatus({ kind: "error", message: created.error.message });
        return;
      }
      const put = await fetch(created.data.signedUrl, {
        method: "PUT",
        headers: { "content-type": f.type },
        body: f,
      });
      if (!put.ok) {
        setStatus({ kind: "error", message: `Upload failed (${put.status}).` });
        return;
      }
      const finalized = await finalizeAvatarUpload({ path: created.data.path });
      if (!finalized.ok) {
        setStatus({ kind: "error", message: finalized.error.message });
        return;
      }
      setPreview(finalized.data.avatarUrl);
      setStatus({ kind: "saved" });
      router.refresh();
    });
  }

  function onRemove() {
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const res = await removeAvatar();
      if (!res.ok) {
        setStatus({ kind: "error", message: res.error.message });
        return;
      }
      setPreview(null);
      router.refresh();
    });
  }

  const shownUrl = preview ?? currentAvatarUrl;

  return (
    <div className="flex flex-wrap items-center gap-5 rounded-2xl glass p-5">
      <Avatar
        key={shownUrl ?? "none"}
        src={shownUrl}
        name={displayName}
        className="h-20 w-20 rounded-full"
        textClassName="text-xl"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium text-foreground">Profile photo</p>
        <p className="text-sm text-muted-foreground">
          A clear headshot helps hosts recognize you at check-in and makes
          your member card stand out to recruiters. JPEG, PNG, or WebP, up
          to 2 MB.
        </p>
        {status.kind === "error" ? (
          <p role="alert" className="text-sm text-destructive">
            {status.message}
          </p>
        ) : status.kind === "saved" ? (
          <p className="text-sm text-primary">Photo updated.</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(",")}
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          size="sm"
          className="rounded-full"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
        >
          {status.kind === "uploading" || pending
            ? "Uploading…"
            : shownUrl
              ? "Replace"
              : "Upload photo"}
        </Button>
        {shownUrl ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={pending}
            onClick={onRemove}
          >
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}
