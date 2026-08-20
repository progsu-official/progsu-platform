"use client";

import { useState } from "react";

// School logo with a monogram fallback, same shape as the Avatar component:
// try the art, degrade on error rather than showing a broken-image glyph.
//
// Art lives at /public/schools/<slug>.png where <slug> is the school name
// slugified — "Georgia State University" -> georgia-state-university.png. That
// matches school_domains.school_slug, so adding a school's logo is dropping a
// file in, with no registry to keep in sync. Schools without art just show the
// monogram.

export function SchoolLogo({ name }: { name: string }) {
  const [failed, setFailed] = useState(false);
  const slug = slugifySchool(name);

  if (slug && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/schools/${slug}.png`}
        alt=""
        ref={(el) => {
          // The markup is server-rendered, so a missing file 404s before React
          // has attached onError — the event fires into nothing and the browser
          // paints its broken-image glyph instead of our fallback. Re-check the
          // decoded state on mount to catch that case.
          if (el && el.complete && el.naturalWidth === 0) setFailed(true);
        }}
        onError={() => setFailed(true)}
        className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-inset ring-border/60"
      />
    );
  }

  return (
    <span
      aria-hidden
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-sm font-bold tracking-tight text-primary ring-1 ring-inset ring-primary/20"
    >
      {initialsOf(name)}
    </span>
  );
}

export function slugifySchool(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SKIP_WORDS = new Set(["of", "the", "at", "and", "for", "&", "-"]);

function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter((w) => w && !SKIP_WORDS.has(w.toLowerCase()))
    .map((w) => w[0])
    .filter((c) => /[a-z0-9]/i.test(c));
  return letters.slice(0, 3).join("").toUpperCase() || "?";
}
