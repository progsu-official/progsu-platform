"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import {
  OnbActionBar,
  OnbErrorBox,
  OnbIntro,
  OnbPrimaryButton,
  OnbSection,
  OnbSurface,
  onbInputFocusClasses,
  onbPanelClasses,
} from "@/app/onboarding/_components/shell";
import { Select } from "@/app/_components/select";
import { useGoogleSignIn } from "@/lib/hooks/use-google-sign-in";
import { submitGuestAnswers } from "@/lib/actions/events";
import {
  CLASS_STANDINGS,
  INTERESTED_ROLES,
  SMS_CONSENT_COPY,
} from "@/lib/actions/event-schemas";
import type { GuestClaimContext } from "@/lib/actions/events";
import { cn } from "@/lib/utils";

// Name, email and phone are already on file from the RSVP form; a verified
// .edu address and a resume are what still stand between someone and
// recruiter eligibility. Eight is therefore the real denominator, not a
// number picked to make the ring look good — see docs/16-guest-conversion §3.3.
const TOTAL_FIELDS = 8;
const FIELDS_FROM_RSVP = 3;

// Steps are the questions themselves. There is deliberately no welcome/intro
// step in front of them: the RSVP already succeeded, so a screen whose only
// job is to say so and offer a "Let's go" button is a tap that buys nothing.
// The confirmation rides along as one line above the first question instead.
const STEP_MAJOR = 0;
const STEP_GRADUATION = 1;
const STEP_ROLES = 2;

const STANDING_LABELS: Record<(typeof CLASS_STANDINGS)[number], string> = {
  freshman: "Freshman",
  sophomore: "Sophomore",
  junior: "Junior",
  senior: "Senior",
  graduate: "Grad student",
  phd: "PhD",
  alumni: "Alumni",
};

const ROLE_LABELS: Record<(typeof INTERESTED_ROLES)[number], string> = {
  software_engineering: "Software engineering",
  data_science: "Data science",
  data_engineering: "Data engineering",
  machine_learning: "Machine learning",
  product_management: "Product",
  ui_ux_design: "Design",
  devops_sre: "DevOps / SRE",
  cybersecurity: "Security",
  research: "Research",
  consulting: "Consulting",
  quant_finance: "Quant finance",
  other: "Something else",
};

type Answers = {
  major: string | null;
  majorOtherText: string;
  classStanding: (typeof CLASS_STANDINGS)[number] | null;
  gradYear: number | null;
  interestedRoles: (typeof INTERESTED_ROLES)[number][];
};

const chipBase =
  "rounded-full border px-3.5 py-2 text-[13.5px] font-medium leading-none transition-colors duration-150 motion-reduce:transition-none";
const chipOff = "border-border bg-card text-foreground hover:bg-muted/60";
const chipOn =
  "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.10)] text-[hsl(var(--primary))]";

export function WelcomeFlow({
  token,
  context,
  majors,
}: {
  token: string;
  context: GuestClaimContext;
  majors: { slug: string; label: string }[];
}) {
  // Someone returning via the confirmation email who already answered skips
  // to the sign-in step rather than being asked twice.
  const [step, setStep] = useState(context.answered ? STEP_ROLES : STEP_MAJOR);
  const [answers, setAnswers] = useState<Answers>({
    major: null,
    majorOtherText: "",
    classStanding: null,
    gradYear: null,
    interestedRoles: [],
  });
  const [smsOptIn, setSmsOptIn] = useState(context.smsOptedIn);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const { pending: googlePending, error: googleError, signIn } = useGoogleSignIn();

  const answeredCount =
    (answers.major ? 1 : 0) +
    (answers.classStanding || answers.gradYear ? 1 : 0) +
    (answers.interestedRoles.length > 0 ? 1 : 0);
  const completed = FIELDS_FROM_RSVP + answeredCount;

  function persist() {
    return submitGuestAnswers({
      token,
      major: answers.major,
      majorOtherText: answers.major === "other" ? answers.majorOtherText : null,
      gradYear: answers.gradYear,
      classStanding: answers.classStanding,
      interestedRoles: answers.interestedRoles,
      smsOptIn,
    });
  }

  // Persist on every step advance, not once at the end. Someone who answers
  // one question and closes the tab is the common case, and that answer is
  // worth keeping — the whole reason this is a page and not a modal.
  function advance(to: number) {
    setError(null);
    startSaving(async () => {
      const res = await persist();
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setStep(to);
    });
  }

  function toggleRole(role: (typeof INTERESTED_ROLES)[number]) {
    setAnswers((a) => ({
      ...a,
      interestedRoles: a.interestedRoles.includes(role)
        ? a.interestedRoles.filter((r) => r !== role)
        : [...a.interestedRoles, role],
    }));
  }

  const thisYear = new Date().getFullYear();
  const gradYears = Array.from({ length: 8 }, (_, i) => thisYear + i);
  const onFinal = step === STEP_ROLES;

  return (
    <OnbSection>
      <OnbSurface>
        {step === STEP_MAJOR ? (
          <>
            <ConfirmationLine
              status={context.rsvpStatus}
              eventTitle={context.eventTitle}
            />
            <OnbIntro title="What are you studying?">
              Three quick questions, {context.firstName || "friend"} — this is
              the one anyone looking to hire reads first.
            </OnbIntro>
          </>
        ) : step === STEP_GRADUATION ? (
          <OnbIntro title="When do you graduate?">
            Internships and new-grad roles get filtered on this, so it decides
            what we send you.
          </OnbIntro>
        ) : (
          <OnbIntro title="What are you looking for?">
            {context.answered
              ? "Sign in to keep the answers you already gave."
              : "Last one. Pick as many as fit — you can change all of this later."}
          </OnbIntro>
        )}

        {step === STEP_MAJOR ? (
          <div className="mt-6 space-y-3">
            <Select
              id="welcome-major"
              value={answers.major ?? ""}
              onChange={(v) => setAnswers((a) => ({ ...a, major: v }))}
              options={majors.map((m) => ({ value: m.slug, label: m.label }))}
              placeholder="Pick your major"
              searchPlaceholder="Search majors"
            />
            {answers.major === "other" ? (
              <input
                type="text"
                value={answers.majorOtherText}
                onChange={(e) =>
                  setAnswers((a) => ({ ...a, majorOtherText: e.target.value }))
                }
                placeholder="What are you studying?"
                maxLength={120}
                className={cn(
                  "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm text-foreground placeholder:text-muted-foreground",
                  onbInputFocusClasses
                )}
              />
            ) : null}
          </div>
        ) : null}

        {step === STEP_GRADUATION ? (
          <div className="mt-6 space-y-4">
            <div className="flex flex-wrap gap-2">
              {CLASS_STANDINGS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={answers.classStanding === s}
                  onClick={() =>
                    setAnswers((a) => ({
                      ...a,
                      classStanding: a.classStanding === s ? null : s,
                    }))
                  }
                  className={cn(
                    chipBase,
                    answers.classStanding === s ? chipOn : chipOff
                  )}
                >
                  {STANDING_LABELS[s]}
                </button>
              ))}
            </div>
            <Select
              id="welcome-grad-year"
              value={answers.gradYear ? String(answers.gradYear) : ""}
              onChange={(v) =>
                setAnswers((a) => ({ ...a, gradYear: v ? Number(v) : null }))
              }
              options={gradYears.map((y) => ({
                value: String(y),
                label: `Graduating ${y}`,
              }))}
              placeholder="Pick a year"
            />
          </div>
        ) : null}

        {onFinal && !context.answered ? (
          <div className="mt-6 flex flex-wrap gap-2">
            {INTERESTED_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={answers.interestedRoles.includes(r)}
                onClick={() => toggleRole(r)}
                className={cn(
                  chipBase,
                  answers.interestedRoles.includes(r) ? chipOn : chipOff
                )}
              >
                {ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        ) : null}

        {onFinal ? (
          <div className="mt-6 space-y-4">
            <p className="text-[13.5px] leading-[1.5] text-muted-foreground">
              Sign in to keep these answers. What&apos;s left is a verified
              school email and a resume — those two are what recruiter exports
              actually require.
            </p>

            {!context.smsOptedIn ? (
              <label
                className={cn(
                  onbPanelClasses,
                  "flex cursor-pointer items-start gap-3 p-3.5"
                )}
              >
                <input
                  type="checkbox"
                  checked={smsOptIn}
                  onChange={(e) => setSmsOptIn(e.target.checked)}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[hsl(var(--primary))]"
                />
                <span className="text-[12.5px] leading-[1.5] text-muted-foreground">
                  {SMS_CONSENT_COPY}
                </span>
              </label>
            ) : null}

            {googleError ? <OnbErrorBox>{googleError}</OnbErrorBox> : null}
          </div>
        ) : null}

        {error ? <OnbErrorBox className="mt-4">{error}</OnbErrorBox> : null}

        {/* A hairline, not a card. It reports progress; it is not a section. */}
        <ProgressLine completed={completed} />
      </OnbSurface>

      <OnbActionBar>
        <div className="flex w-full max-w-[24rem] flex-col items-center gap-3">
          {onFinal ? (
            <OnbPrimaryButton
              loading={googlePending || saving}
              onClick={() =>
                startSaving(async () => {
                  // Save before leaving for Google — the redirect never comes
                  // back to this component.
                  await persist();
                  await signIn();
                })
              }
            >
              {googlePending ? "Redirecting…" : "Save this — sign in with Google"}
            </OnbPrimaryButton>
          ) : (
            <OnbPrimaryButton loading={saving} onClick={() => advance(step + 1)}>
              Continue
            </OnbPrimaryButton>
          )}

          {/* A text link, not a second button. The two are not equal choices
              and the layout should not pretend otherwise. */}
          {onFinal ? (
            <Link
              href={`/events/${context.eventSlug}`}
              className="rounded text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Not right now
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => advance(step + 1)}
              disabled={saving}
              className="rounded text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
            >
              Skip this one
            </button>
          )}
        </div>
      </OnbActionBar>
    </OnbSection>
  );
}

// The RSVP is already done by the time this page renders. This says so once,
// quietly, above the first question — rather than spending a whole step on it.
function ConfirmationLine({
  status,
  eventTitle,
}: {
  status: GuestClaimContext["rsvpStatus"];
  eventTitle: string;
}) {
  return (
    <p className="mb-4 flex items-center justify-center gap-2 text-[13px] text-muted-foreground">
      <span
        aria-hidden
        className="flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]"
      >
        <Check size={12} strokeWidth={3} />
      </span>
      <span className="truncate">
        {status === "waitlisted" ? "Waitlisted for" : "You're in —"}{" "}
        <span className="text-foreground">{eventTitle}</span>
      </span>
    </p>
  );
}

function ProgressLine({ completed }: { completed: number }) {
  return (
    <div className="mt-8">
      <div
        role="progressbar"
        aria-valuenow={completed}
        aria-valuemin={0}
        aria-valuemax={TOTAL_FIELDS}
        aria-label="Profile completion"
        className="h-1 w-full overflow-hidden rounded-full bg-foreground/[0.08]"
      >
        <div
          className="h-full rounded-full bg-[hsl(var(--primary))] transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${(completed / TOTAL_FIELDS) * 100}%` }}
        />
      </div>
      <p className="mt-2 text-center text-[12px] text-muted-foreground">
        {completed} of {TOTAL_FIELDS} done
      </p>
    </div>
  );
}
