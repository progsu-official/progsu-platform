"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { recordConsents } from "@/lib/actions/consent";
import { CONSENT_LABELS, type ConsentType } from "@/lib/actions/consent-schemas";

type Acceptances = Record<ConsentType, boolean>;

export function ConsentForm({ hasPhone }: { hasPhone: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<Acceptances>({
    privacy_policy: false,
    terms_of_service: false,
    age_confirmation: false,
    recruiter_resume_sharing: false,
    email_marketing: false,
    sms_marketing: false,
  });
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);

  function toggle(type: ConsentType, value: boolean) {
    setState((s) => ({ ...s, [type]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await recordConsents({ acceptances: state });
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
    <form onSubmit={onSubmit} className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Required
        </legend>
        <div className="space-y-4 rounded-2xl glass p-5">

        <CheckboxRow
          id="c-privacy"
          checked={!!state.privacy_policy}
          onChange={(v) => toggle("privacy_policy", v)}
          errorField={error?.field}
          errorKey="privacy_policy"
          label={
            <>
              I&apos;ve read and agree to the{" "}
              <Link href="/privacy" className="text-primary underline underline-offset-4">
                Privacy Policy
              </Link>
              .
            </>
          }
        />
        <CheckboxRow
          id="c-terms"
          checked={!!state.terms_of_service}
          onChange={(v) => toggle("terms_of_service", v)}
          errorField={error?.field}
          errorKey="terms_of_service"
          label={
            <>
              I&apos;ve read and agree to the{" "}
              <Link href="/terms" className="text-primary underline underline-offset-4">
                Terms of Service
              </Link>
              .
            </>
          }
        />
        <CheckboxRow
          id="c-age"
          checked={!!state.age_confirmation}
          onChange={(v) => toggle("age_confirmation", v)}
          errorField={error?.field}
          errorKey="age_confirmation"
          label={CONSENT_LABELS.age_confirmation}
        />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Optional
        </legend>
        <div className="space-y-4 rounded-2xl glass p-5">

        <CheckboxRow
          id="c-recruiter"
          checked={!!state.recruiter_resume_sharing}
          onChange={(v) => toggle("recruiter_resume_sharing", v)}
          label={CONSENT_LABELS.recruiter_resume_sharing}
          hint="Progsu will not sell your data. You can withdraw this any time."
        />
        <CheckboxRow
          id="c-email"
          checked={!!state.email_marketing}
          onChange={(v) => toggle("email_marketing", v)}
          label={CONSENT_LABELS.email_marketing}
        />
        <CheckboxRow
          id="c-sms"
          checked={!!state.sms_marketing}
          onChange={(v) => toggle("sms_marketing", v)}
          disabled={!hasPhone}
          label={CONSENT_LABELS.sms_marketing}
          hint={
            hasPhone
              ? "Message & data rates may apply. Reply STOP to unsubscribe."
              : "Add a phone number on your profile first to enable SMS."
          }
          errorField={error?.field}
          errorKey="sms_marketing"
        />
        </div>
      </fieldset>

      {error && !error.field ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error.message}
        </div>
      ) : null}

      <div className="space-y-2 pt-1">
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending ? "Saving…" : "Save and finish"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          You can change any of this later from your settings.
        </p>
      </div>
    </form>
  );
}

function CheckboxRow({
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
  const isError = errorField && errorKey && errorField === errorKey;
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer rounded border-input accent-[hsl(var(--primary))]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <div className="flex-1 space-y-0.5">
        <Label htmlFor={id} className="cursor-pointer text-sm">
          {label}
        </Label>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        {isError ? (
          <p role="alert" className="text-xs text-destructive">
            Required.
          </p>
        ) : null}
      </div>
    </div>
  );
}
