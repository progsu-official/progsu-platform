"use client";

import { Briefcase, Check, Mail, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import { recordConsents } from "@/lib/actions/consent";
import {
  CONSENT_LABELS,
  type ConsentType,
} from "@/lib/actions/consent-schemas";

import {
  OnbActionBar,
  OnbErrorBox,
  OnbIntro,
  OnbPrimaryButton,
  OnbSecondaryButton,
  OnbSurface,
} from "../_components/shell";
import { usePreview } from "../_components/preview";
import { CascadeItem, Reveal } from "../_components/reveal";

type Acceptances = Record<ConsentType, boolean>;

// Well past the 450ms glide and its ~90ms cascade tail. The extra time is the
// point rather than a side effect: the opt-ins need long enough on screen to
// actually get read, and a button that is already live is a button people
// press before reading anything.
const REVEAL_SETTLE_MS = 2200;

const linkClasses = "text-primary underline underline-offset-4";

// prefillRequired pre-checks the three required boxes — only ever true in
// ONBOARDING_TEST_MODE so a walkthrough finishes on a single click.
//
// The opt-ins below are NEVER pre-checked, deliberately: consents is an
// append-only audit ledger (version + ip + user agent per row), and a
// pre-checked box is not valid consent for sms under the TCPA. Conversion
// comes from the benefit framing and the one-tap "Turn all on" chip instead.
export function ConsentForm({
  hasPhone,
  prefillRequired = false,
}: {
  hasPhone: boolean;
  prefillRequired?: boolean;
}) {
  const router = useRouter();
  const preview = usePreview();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<Acceptances>({
    privacy_policy: prefillRequired,
    terms_of_service: prefillRequired,
    age_confirmation: prefillRequired,
    recruiter_resume_sharing: false,
    email_marketing: false,
    sms_marketing: false,
  });
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);

  // The optional block only appears once the required three are agreed, so the
  // screen opens as three checkboxes rather than six rows plus a header.
  const requiredDone =
    !!state.privacy_policy && !!state.terms_of_service && !!state.age_confirmation;

  // Submit stays inert until the reveal has actually played. Two reasons, and
  // the second is the honest one: a button that is live before the options
  // exist lets someone finish without ever seeing them, and holding it for the
  // length of the animation means the opt-ins are on screen and settled at the
  // moment their attention lands on the CTA.
  const [ctaArmed, setCtaArmed] = useState(false);
  useEffect(() => {
    if (!requiredDone) {
      setCtaArmed(false);
      return;
    }
    const t = setTimeout(() => setCtaArmed(true), REVEAL_SETTLE_MS);
    return () => clearTimeout(t);
  }, [requiredDone]);

  function toggle(type: ConsentType, value: boolean) {
    setState((s) => ({ ...s, [type]: value }));
  }

  const allOptInsOn =
    state.recruiter_resume_sharing &&
    state.email_marketing &&
    (!hasPhone || state.sms_marketing);

  function turnAllOn() {
    setState((s) => ({
      ...s,
      recruiter_resume_sharing: true,
      email_marketing: true,
      sms_marketing: hasPhone ? true : s.sms_marketing,
    }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (preview) return preview.advance("/onboarding/done");
    setError(null);
    startTransition(async () => {
      // a thrown action (network drop, stale deployment) must land in the
      // inline error box, not the root error boundary — state survives.
      let result: Awaited<ReturnType<typeof recordConsents>>;
      try {
        result = await recordConsents({ acceptances: state });
      } catch {
        setError({
          message: "That didn't save. Try again.",
        });
        return;
      }
      if (!result.ok) {
        setError({
          message: result.error.message,
          field: result.error.field,
        });
        return;
      }
      router.push("/onboarding/done");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <OnbSurface>
        <OnbIntro title="One last thing">
The required bits take ten seconds. The rest decides what you actually get out of Progsu.
        </OnbIntro>

        {/* Checkbox copy is the canonical CONSENT_LABELS map (the strings the
            consent audit stores), lowercased into the funnel's voice; the
            privacy/terms rows wrap the document names in links. */}
        <fieldset className="mt-2 space-y-2.5">
          <legend className="sr-only">required</legend>
          <CheckRow
            id="c-privacy"
            checked={!!state.privacy_policy}
            onChange={(v) => toggle("privacy_policy", v)}
            errorField={error?.field}
            errorKey="privacy_policy"
            label={
              <>
                I&apos;ve read and agree to the{" "}
                <Link href="/privacy" className={linkClasses}>
                  {CONSENT_LABELS.privacy_policy}
                </Link>
              </>
            }
          />
          <CheckRow
            id="c-terms"
            checked={!!state.terms_of_service}
            onChange={(v) => toggle("terms_of_service", v)}
            errorField={error?.field}
            errorKey="terms_of_service"
            label={
              <>
                I&apos;ve read and agree to the{" "}
                <Link href="/terms" className={linkClasses}>
                  {CONSENT_LABELS.terms_of_service}
                </Link>
              </>
            }
          />
          <CheckRow
            id="c-age"
            checked={!!state.age_confirmation}
            onChange={(v) => toggle("age_confirmation", v)}
            errorField={error?.field}
            errorKey="age_confirmation"
            label={CONSENT_LABELS.age_confirmation}
          />
        </fieldset>

        <Reveal open={requiredDone}>
        <CascadeItem index={0}>
        <div className="flex items-end justify-between gap-3 pb-3 pt-6">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Make Progsu work for you
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Recommended. Change any of these whenever you want.
            </p>
          </div>
          {/* one persistent button: swapping it for a static chip on
              activation would drop keyboard focus to <body> */}
          <button
            type="button"
            aria-disabled={allOptInsOn}
            onClick={allOptInsOn ? undefined : turnAllOn}
            className={cn(
              "inline-flex flex-none items-center gap-1.5 rounded-full border border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.06)] px-3 py-1.5 text-xs font-medium text-primary transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
              allOptInsOn
                ? "cursor-default"
                : "hover:bg-[hsl(var(--primary)/0.12)]",
            )}
          >
            {allOptInsOn ? (
              <>
                <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
                all on
              </>
            ) : (
              "Turn all on"
            )}
          </button>
          <span aria-live="polite" className="sr-only">
            {allOptInsOn ? "All optional updates are on." : ""}
          </span>
        </div>

        <fieldset className="space-y-2.5">
          <legend className="sr-only">Recommended</legend>
          <OptInRow
            id="c-recruiter"
            checked={!!state.recruiter_resume_sharing}
            onChange={(v) => toggle("recruiter_resume_sharing", v)}
            icon={<Briefcase aria-hidden className="h-5 w-5" strokeWidth={1.75} />}
            label={CONSENT_LABELS.recruiter_resume_sharing}
            badge="Recommended"
            hint="This is how sponsors and recruiters find people to interview. Progsu never sells your data."
          />
          <OptInRow
            id="c-email"
            checked={!!state.email_marketing}
            onChange={(v) => toggle("email_marketing", v)}
            icon={<Mail aria-hidden className="h-5 w-5" strokeWidth={1.75} />}
            label={CONSENT_LABELS.email_marketing}
            hint="Event drops, deadlines, and opportunities. The useful stuff only."
          />
          <OptInRow
            id="c-sms"
            checked={!!state.sms_marketing}
            onChange={(v) => toggle("sms_marketing", v)}
            disabled={!hasPhone}
            icon={
              <MessageCircle aria-hidden className="h-5 w-5" strokeWidth={1.75} />
            }
            label={CONSENT_LABELS.sms_marketing}
            hint={
              hasPhone
                ? "The fastest ping when spots open up. Message & data rates may apply, reply STOP to unsubscribe."
                : "Add a phone number to your profile first to turn this on."
            }
            errorField={error?.field}
            errorKey="sms_marketing"
            // sms is optional — "required." would be wrong; surface the
            // server's actual instruction (add a phone number) instead
            errorMessage={error?.message}
          />
        </fieldset>

        </CascadeItem>
        </Reveal>

        {error && !error.field ? (
          <OnbErrorBox className="mt-5 text-center">
            {error.message}
          </OnbErrorBox>
        ) : null}
      </OnbSurface>

      <OnbActionBar>
        <div className="flex w-full max-w-[24rem] flex-col items-center gap-2.5">
          <div className="flex w-full items-center gap-3">
            <OnbSecondaryButton
              size="cta"
              className="w-auto flex-none px-5"
              disabled={pending}
              onClick={() => router.push("/onboarding/resume")}
            >
              Back
            </OnbSecondaryButton>
            <OnbPrimaryButton
              type="submit"
              loading={pending}
              disabled={!ctaArmed}
              className="flex-1"
            >
              Save and finish
            </OnbPrimaryButton>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Change any of this later from settings
          </p>
        </div>
      </OnbActionBar>
    </form>
  );
}

function CheckMark() {
  return (
    <svg aria-hidden viewBox="0 0 12 12" fill="none" className="h-3 w-3">
      <path
        d="M2.5 6.5 5 9l4.5-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckSquare({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 inline-flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[6px] border transition-colors duration-150",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background",
      )}
    >
      {checked ? <CheckMark /> : null}
    </span>
  );
}

// folk-style tap row: the whole bordered pill is the label, the native
// checkbox stays in the tree (sr-only) for keyboard + screen readers, and the
// painted square mirrors its state.
function CheckRow({
  id,
  checked,
  onChange,
  label,
  hint,
  disabled,
  errorField,
  errorKey,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  hint?: string;
  disabled?: boolean;
  errorField?: string;
  errorKey?: string;
}) {
  const isError = Boolean(errorField && errorKey && errorField === errorKey);
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex w-full items-start gap-3.5 rounded-[14px] border px-4 py-3.5 transition-colors duration-150",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
        checked
          ? "border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.06)]"
          : "border-border bg-card",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        !disabled && !checked && "hover:bg-muted/40",
        isError && "border-destructive/50",
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        aria-invalid={isError || undefined}
      />
      <CheckSquare checked={checked} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-[1.5] text-foreground">
          {label}
        </span>
        {hint ? (
          <span className="mt-1 block text-xs leading-[1.45] text-muted-foreground">
            {hint}
          </span>
        ) : null}
        {isError ? (
          <span role="alert" className="mt-1 block text-xs text-destructive">
            required.
          </span>
        ) : null}
      </span>
    </label>
  );
}

// benefit-card variant for the opt-ins: icon plate on the left, the canonical
// consent label as the title, a benefit line under it, and the check square on
// the right — so these read as upgrades, not legal chores. Same native sr-only
// checkbox contract as CheckRow, but the accessible name is pinned to the
// title alone (aria-labelledby) so the hint and badge read as a description,
// not a run-on name.
function OptInRow({
  id,
  checked,
  onChange,
  icon,
  label,
  hint,
  badge,
  disabled,
  errorField,
  errorKey,
  errorMessage,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon: React.ReactNode;
  label: React.ReactNode;
  hint: string;
  badge?: string;
  disabled?: boolean;
  errorField?: string;
  errorKey?: string;
  errorMessage?: string;
}) {
  const isError = Boolean(errorField && errorKey && errorField === errorKey);
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex w-full items-start gap-3.5 rounded-[14px] border px-4 py-4 transition-colors duration-150",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
        checked
          ? "border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.06)]"
          : "border-border bg-card",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        !disabled && !checked && "hover:bg-muted/40",
        isError && "border-destructive/50",
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        aria-invalid={isError || undefined}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
      />
      <span
        aria-hidden
        className={cn(
          "inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border transition-colors duration-150",
          checked
            ? "border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.1)] text-primary"
            : "border-border bg-muted/50 text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-[1.5] text-foreground">
          <span id={`${id}-label`}>{label}</span>
          {badge ? (
            <span className="ml-2 inline-block rounded-full border border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.06)] px-2 py-0.5 align-middle text-[11px] font-medium leading-none text-primary">
              {badge}
            </span>
          ) : null}
        </span>
        <span
          id={`${id}-hint`}
          className="mt-1 block text-xs leading-[1.45] text-muted-foreground"
        >
          {hint}
        </span>
        {isError ? (
          <span role="alert" className="mt-1 block text-xs text-destructive">
            {errorMessage ?? "Required"}
          </span>
        ) : null}
      </span>
      <CheckSquare checked={checked} />
    </label>
  );
}
