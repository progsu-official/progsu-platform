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
const chipOff =
  "border-border bg-card text-foreground hover:bg-muted/60";
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
  // straight to the sign-in step rather than being asked twice.
  const [step, setStep] = useState(context.answered ? 3 : 0);
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
  const { pending: googlePending, error: googleError, signIn } =
    useGoogleSignIn();

  const answeredCount =
    (answers.major ? 1 : 0) +
    (answers.classStanding || answers.gradYear ? 1 : 0) +
    (answers.interestedRoles.length > 0 ? 1 : 0);
  const completed = FIELDS_FROM_RSVP + answeredCount;

  // Persist on every step advance, not once at the end. Someone who answers
  // two questions and closes the tab is the common case, and their answers
  // are worth keeping — that is the whole reason this is a page and not a
  // modal.
  function advance(to: number) {
    setError(null);
    startSaving(async () => {
      const res = await submitGuestAnswers({
        token,
        major: answers.major,
        majorOtherText: answers.major === "other" ? answers.majorOtherText : null,
        gradYear: answers.gradYear,
        classStanding: answers.classStanding,
        interestedRoles: answers.interestedRoles,
        smsOptIn,
      });
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

  return (
    <OnbSection>
      <OnbSurface>
        {step === 0 ? (
          <OnbIntro title={`You're in, ${context.firstName || "friend"}.`}>
            {context.rsvpStatus === "waitlisted"
              ? `You're on the waitlist for ${context.eventTitle}. Members get first call on spots that open up — worth two minutes.`
              : `We'll email you the details for ${context.eventTitle}. While you're here — three quick questions.`}
          </OnbIntro>
        ) : step === 1 ? (
          <OnbIntro title="What are you studying?">
            This is the first thing anyone looking to hire looks at.
          </OnbIntro>
        ) : step === 2 ? (
          <OnbIntro title="When do you graduate?">
            Internships and new-grad roles get filtered on this, so it decides
            what we send you.
          </OnbIntro>
        ) : (
          <OnbIntro title="What are you looking for?">
            Pick as many as fit. You can change all of this later.
          </OnbIntro>
        )}

        {step === 0 ? (
          <div className={cn(onbPanelClasses, "mt-6")}>
            <ProgressLine completed={FIELDS_FROM_RSVP} />
            <p className="mt-3 text-[13.5px] leading-[1.5] text-muted-foreground">
              Name, email and phone are already saved. Three more answers and a
              sign-in puts a real profile behind your RSVP — which is what gets
              you into the exports we send recruiters.
            </p>
          </div>
        ) : null}

        {step === 1 ? (
          <div className={cn(onbPanelClasses, "mt-6 space-y-3")}>
            <label htmlFor="welcome-major" className="sr-only">
              Major
            </label>
            <select
              id="welcome-major"
              value={answers.major ?? ""}
              onChange={(e) =>
                setAnswers((a) => ({ ...a, major: e.target.value || null }))
              }
              className={cn(
                "h-12 w-full rounded-[14px] border border-border bg-card px-4 text-[15px] text-foreground",
                onbInputFocusClasses
              )}
            >
              <option value="">Pick your major</option>
              {majors.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.label}
                </option>
              ))}
            </select>
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
                  "h-12 w-full rounded-[14px] border border-border bg-card px-4 text-[15px] text-foreground placeholder:text-muted-foreground",
                  onbInputFocusClasses
                )}
              />
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className={cn(onbPanelClasses, "mt-6 space-y-4")}>
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
            <div>
              <label
                htmlFor="welcome-grad-year"
                className="mb-2 block text-[13px] text-muted-foreground"
              >
                Graduating in
              </label>
              <select
                id="welcome-grad-year"
                value={answers.gradYear ?? ""}
                onChange={(e) =>
                  setAnswers((a) => ({
                    ...a,
                    gradYear: e.target.value ? Number(e.target.value) : null,
                  }))
                }
                className={cn(
                  "h-12 w-full rounded-[14px] border border-border bg-card px-4 text-[15px] text-foreground",
                  onbInputFocusClasses
                )}
              >
                <option value="">Pick a year</option>
                {gradYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}

        {step === 3 && !context.answered ? (
          <div className={cn(onbPanelClasses, "mt-6")}>
            <div className="flex flex-wrap gap-2">
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
          </div>
        ) : null}

        {step === 3 ? (
          <div className={cn(onbPanelClasses, "mt-4 space-y-4")}>
            <ProgressLine completed={completed} />
            <p className="text-[13.5px] leading-[1.5] text-muted-foreground">
              Sign in to keep these answers. What&apos;s left is a verified
              school email and a resume — those two are what recruiter exports
              actually require.
            </p>

            {!context.smsOptedIn ? (
              <label className="flex cursor-pointer items-start gap-3 rounded-[14px] border border-border bg-card p-3.5">
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
      </OnbSurface>

      <OnbActionBar>
        <div className="flex w-full max-w-[24rem] flex-col items-center gap-3">
          {step === 3 ? (
            <OnbPrimaryButton
              loading={googlePending || saving}
              onClick={() =>
                startSaving(async () => {
                  // Save the SMS choice before leaving for Google — the
                  // redirect never comes back to this component.
                  await submitGuestAnswers({
                    token,
                    major: answers.major,
                    majorOtherText:
                      answers.major === "other" ? answers.majorOtherText : null,
                    gradYear: answers.gradYear,
                    classStanding: answers.classStanding,
                    interestedRoles: answers.interestedRoles,
                    smsOptIn,
                  });
                  await signIn();
                })
              }
            >
              {googlePending ? "Redirecting…" : "Save this — sign in with Google"}
            </OnbPrimaryButton>
          ) : (
            <OnbPrimaryButton loading={saving} onClick={() => advance(step + 1)}>
              {step === 0 ? "Let's go" : "Continue"}
            </OnbPrimaryButton>
          )}

          {/* A text link, not a second button. The two are not equal choices
              and the layout should not pretend otherwise. */}
          {step === 3 ? (
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

function ProgressLine({ completed }: { completed: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[13px]">
        <span className="font-medium text-foreground">
          {completed} of {TOTAL_FIELDS} done
        </span>
        {completed >= TOTAL_FIELDS - 2 ? (
          <span className="inline-flex items-center gap-1 text-[hsl(var(--primary))]">
            <Check size={13} strokeWidth={2.5} aria-hidden />
            nearly there
          </span>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-valuenow={completed}
        aria-valuemin={0}
        aria-valuemax={TOTAL_FIELDS}
        aria-label="Profile completion"
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.08]"
      >
        <div
          className="h-full rounded-full bg-[hsl(var(--primary))] transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${(completed / TOTAL_FIELDS) * 100}%` }}
        />
      </div>
    </div>
  );
}
