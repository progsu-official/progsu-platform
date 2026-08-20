"use client";

import { Camera } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/app/_components/avatar";

import { AvatarDialog } from "./avatar-dialog";

// Opens the upload dialog in place. The scrim is hover/focus-only, but the
// corner badge is always visible so the affordance survives on touch, where
// there's no hover to reveal it.
export function AvatarButton({
  avatarUrl,
  displayName,
}: {
  avatarUrl: string | null;
  displayName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={avatarUrl ? "Change your profile photo" : "Add a profile photo"}
        aria-haspopup="dialog"
        className="group relative block h-24 w-24 shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      >
        <Avatar
          src={avatarUrl}
          name={displayName}
          className="h-24 w-24 rounded-full shadow-lg shadow-black/10 dark:shadow-black/30"
          textClassName="text-2xl"
        />
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
        >
          <Camera
            size={22}
            strokeWidth={1.75}
            className="scale-90 text-white transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-100 group-focus-visible:scale-100 motion-reduce:transition-none"
          />
        </span>
        <span
          aria-hidden
          className="absolute bottom-0.5 right-0.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-muted text-muted-foreground transition-colors duration-200 group-hover:bg-primary group-hover:text-primary-foreground motion-reduce:transition-none"
        >
          <Camera size={13} strokeWidth={2} />
        </span>
      </button>

      <AvatarDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
