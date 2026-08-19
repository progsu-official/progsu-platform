"use client";

import { useState } from "react";

// Avatar with a built-in initials fallback. Google-hosted OAuth avatars
// (lh3.googleusercontent.com) intermittently 429 when hotlinked, and legacy
// rows can point at dead URLs — onError degrades to the initial instead of
// a broken-image glyph.
export function Avatar({
  src,
  name,
  className,
  textClassName = "text-xs",
}: {
  src: string | null;
  name: string;
  className: string;
  textClassName?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${className} border border-border object-cover`}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={`${className} flex items-center justify-center border border-border bg-muted font-semibold uppercase text-muted-foreground ${textClassName}`}
    >
      {(name || "?").charAt(0)}
    </span>
  );
}
