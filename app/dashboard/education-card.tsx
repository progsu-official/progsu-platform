import Link from "next/link";
import { GraduationCap, Pencil } from "lucide-react";

// Replaces the old label/value "Profile" grid. Name and school were already in
// the page header, so the grid was mostly restating it; what's left here is the
// part nothing else on the dashboard shows — what you study, when you finish,
// and whether your school email is verified.

export type VerificationState = "verified" | "pending_domain" | "unverified" | "none";

export function EducationCard({
  school,
  degreeLine,
  standingLine,
  studentEmail,
  verification,
  pendingDomainName,
}: {
  school: string | null;
  degreeLine: string | null;
  standingLine: string | null;
  studentEmail: string | null;
  verification: VerificationState;
  pendingDomainName: string | null;
}) {
  return (
    <section
      aria-labelledby="education-heading"
      className="rounded-2xl border border-border/70 bg-card p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="education-heading" className="text-base font-semibold">
          Education
        </h2>
        <Link
          href="/dashboard/settings"
          aria-label="Edit education"
          title="Edit education"
          className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <Pencil size={16} strokeWidth={1.75} aria-hidden />
        </Link>
      </div>

      {school ? (
        <div className="mt-3 flex gap-3.5">
          <SchoolMark name={school} />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="font-semibold leading-snug text-foreground">{school}</p>
            {degreeLine ? (
              <p className="text-sm leading-snug text-foreground/90">{degreeLine}</p>
            ) : null}
            {standingLine ? (
              <p className="text-sm text-muted-foreground">{standingLine}</p>
            ) : null}

            {studentEmail ? (
              <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-sm">
                <span className="truncate text-muted-foreground">{studentEmail}</span>
                <VerificationChip
                  state={verification}
                  pendingDomainName={pendingDomainName}
                />
              </p>
            ) : (
              <p className="pt-2 text-sm text-muted-foreground">
                No school email yet.{" "}
                <Link
                  href="/onboarding/verify-email"
                  className="text-primary underline underline-offset-4"
                >
                  Verify one
                </Link>{" "}
                to be visible to recruiters.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-3.5">
          <span
            aria-hidden
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-muted/40"
          >
            <GraduationCap
              size={20}
              strokeWidth={1.5}
              className="text-muted-foreground"
            />
          </span>
          <p className="text-sm text-muted-foreground">
            No school on file.{" "}
            <Link
              href="/dashboard/settings"
              className="text-primary underline underline-offset-4"
            >
              Add your education
            </Link>
            .
          </p>
        </div>
      )}
    </section>
  );
}

// Institutions don't ship us logos, so a monogram stands in rather than a
// placeholder that pretends to be one.
function SchoolMark({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-sm font-bold tracking-tight text-primary ring-1 ring-inset ring-primary/20"
    >
      {initialsOf(name)}
    </span>
  );
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

function VerificationChip({
  state,
  pendingDomainName,
}: {
  state: VerificationState;
  pendingDomainName: string | null;
}) {
  if (state === "none") return null;

  if (state === "verified") {
    return (
      <span
        title="Verified via a code sent to this address"
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary"
      >
        Verified
      </span>
    );
  }

  const pending = state === "pending_domain";
  return (
    <span
      title={
        pending
          ? `${pendingDomainName} isn't on our verification list yet — we'll enable it soon.`
          : "Waiting for you to verify via an emailed code. Recruiters won't see your profile until then."
      }
      className="inline-flex shrink-0 cursor-help items-center rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-medium text-amber-300"
    >
      {pending ? "School coming soon" : "Unverified"}
    </span>
  );
}
