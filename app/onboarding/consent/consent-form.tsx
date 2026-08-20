"use client";

import { Briefcase, Check, Mail, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
  OnbSurface,
} from "../_components/shell";

type Acceptances = Record<ConsentType, boolean>;

const linkClasses = "text-primary underline underline-offset-4";

// prefillRequired pre-checks the three required boxes — only ever true in
// ONBOARDING_TEST_MODE so a walkthrough finishes on a single click.
//
// The opt-ins below are NEVER pre-checked, deliberately: consents is an
// append-only audit ledger (version + ip + user agent per row), and a
// pre-checked box is not valid consent for sms under the TCPA. Conversion
// comes from the benefit framing and the one-tap "turn all on" chip instead.
export function ConsentForm({
  hasPhone,
  prefillRequired = false,
}: {
  hasPhone: boolean;
  prefillRequired?: boolean;
}) {
  const router = useRouter();
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
    setError(null);
    startTransition(async () => {
      // a thrown action (network drop, stale deployment) must land in the
      // inline error box, not the root error boundary — state survives.
      let result: Awaited<ReturnType<typeof recordConsents>>;
      try {
        result = await recordConsents({ acceptances: state });
      } catch {
        setError({
          message: "something went wrong saving your choices — try again.",
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
        <OnbIntro title="last thing">
          the required bits take ten seconds — the rest decides what you get
          out of progsu.
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
                i&apos;ve read and agree to the{" "}
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
                i&apos;ve read and agree to the{" "}
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
            label={CONSENT_LABELS.age_confirmation.toLowerCase()}
          />
        </fieldset>

        <div className="flex items-end justify-between gap-3 pb-3 pt-6">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              make progsu work for you
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              recommended — change any of these whenever you want.
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
              "turn all on"
            )}
          </button>
          <span aria-live="polite" className="sr-only">
            {allOptInsOn ? "all optional updates are on." : ""}
          </span>
        </div>

        <fieldset className="space-y-2.5">
          <legend className="sr-only">recommended</legend>
          <OptInRow
            id="c-recruiter"
            checked={!!state.recruiter_resume_sharing}
            onChange={(v) => toggle("recruiter_resume_sharing", v)}
            icon={<Briefcase aria-hidden className="h-5 w-5" strokeWidth={1.75} />}
            label={CONSENT_LABELS.recruiter_resume_sharing.toLowerCase()}
            badge="recommended"
            hint="sponsors and recruiters scout progsu for people to interview — this is how they find you. progsu never sells your data."
          />
          <OptInRow
            id="c-email"
            checked={!!state.email_marketing}
            onChange={(v) => toggle("email_marketing", v)}
            icon={<Mail aria-hidden className="h-5 w-5" strokeWidth={1.75} />}
            label={CONSENT_LABELS.email_marketing.toLowerCase()}
            hint="event drops, deadlines, and opportunities — the useful stuff only."
          />
          <OptInRow
            id="c-sms"
            checked={!!state.sms_marketing}
            onChange={(v) => toggle("sms_marketing", v)}
            disabled={!hasPhone}
            icon={
              <MessageCircle aria-hidden className="h-5 w-5" strokeWidth={1.75} />
            }
            label={CONSENT_LABELS.sms_marketing.toLowerCase()}
            hint={
              hasPhone
                ? "the fastest ping when spots open up. message & data rates may apply — reply STOP to unsubscribe."
                : "add a phone number on your profile first to turn this on."
            }
            errorField={error?.field}
            errorKey="sms_marketing"
            // sms is optional — "required." would be wrong; surface the
            // server's actual instruction (add a phone number) instead
            errorMessage={error?.message}
          />
        </fieldset>

        {error && !error.field ? (
          <OnbErrorBox className="mt-5 text-center">
            {error.message}
          </OnbErrorBox>
        ) : null}
      </OnbSurface>

      <OnbActionBar>
        <div className="flex w-full flex-col items-center gap-2.5">
          <OnbPrimaryButton type="submit" loading={pending}>
            save and finish
          </OnbPrimaryButton>
          <p className="text-center text-xs text-muted-foreground">
            change any of this later from settings
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
            {errorMessage ?? "required."}
          </span>
        ) : null}
      </span>
      <CheckSquare checked={checked} />
    </label>
  );
}
