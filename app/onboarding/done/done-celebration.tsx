"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { OnbIntro, OnbSection, OnbSurface } from "../_components/shell";
import { usePreview } from "../_components/preview";

// The last beat, and the only screen in the funnel with nothing to press.
//
// It used to be a title, a line of text, and a "Go to my profile" button next
// to a timer that navigated anyway — so the button was either never used or
// raced the redirect. Now it plays and hands off: the emoji arrives, the copy
// rises behind it, the whole group lifts and blurs out, and the navigation
// happens under the exit so the profile page feels like the same motion
// continuing rather than a new page appearing.
const HOLD_MS = 2000;
const EXIT_MS = 460;

export function DoneCelebration() {
  const router = useRouter();
  const preview = usePreview();
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const toExit = setTimeout(() => setLeaving(true), HOLD_MS);
    const toProfile = setTimeout(() => {
      if (preview) preview.advance("/profile");
      else router.push("/profile");
    }, HOLD_MS + EXIT_MS);
    return () => {
      clearTimeout(toExit);
      clearTimeout(toProfile);
    };
  }, [router, preview]);

  return (
    <OnbSection fill center>
      <OnbSurface>
        <div
          className={`flex flex-col items-center gap-5 text-center ${
            leaving ? "onb-done-leaving" : ""
          }`}
        >
          <span
            aria-hidden
            className="onb-done-pop text-[64px] leading-none"
          >
            🥳
          </span>
          <div className="onb-done-rise">
            <OnbIntro title="Let’s gooo" />
          </div>
          {/* aria-live so the handoff is announced; the visual cue is motion,
              which a screen reader cannot use. */}
          <p
            aria-live="polite"
            className="onb-done-rise-late text-[14px] text-muted-foreground"
          >
            Bringing you to your profile…
          </p>
        </div>
      </OnbSurface>
    </OnbSection>
  );
}
