"use client";

import { Camera } from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/app/_components/avatar";

import { AvatarDialog } from "./avatar-dialog";

// Opens the upload dialog in place. The corner badge is gone: the note bubble
// sits directly above the avatar, and two overlapping affordances on one
// target read as clutter. The hover/focus scrim carries it, and the button
// keeps its aria-label for anyone who never sees a hover state.
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
        className="group relative block h-32 w-32 shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background sm:h-40 sm:w-40"
      >
        <Avatar
          src={avatarUrl}
          name={displayName}
          className="h-32 w-32 rounded-full shadow-lg shadow-black/10 dark:shadow-black/30 sm:h-40 sm:w-40"
          textClassName="text-4xl sm:text-5xl"
        />
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
        >
          <Camera
            size={30}
            strokeWidth={1.75}
            className="scale-90 text-white transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-100 group-focus-visible:scale-100 motion-reduce:transition-none"
          />
        </span>
      </button>

      <AvatarDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
