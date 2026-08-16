"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateMinimalProfile } from "@/lib/actions/profile";

// Field-specific headlines so users know WHICH field blocked the save, not just
// a vague "something went wrong".
const FIELD_ERROR_HEADINGS: Record<string, string> = {
  firstName: "First name is required",
  lastName: "Last name is required",
  school: "Pick your school",
  phoneNumber: "A phone number is required",
  major: "Pick a major",
  majorOtherText: "Tell us your major",
};

type Initial = {
  firstName: string;
  lastName: string;
  school: string;
  schoolOtherText: string;
  phoneNumber: string;
  major: string;
  majorOtherText: string;
};

const SCHOOL_OTHER = "other";

type MajorOption = { slug: string; label: string };

export function ProfileForm({
  initial,
  majorOptions,
  schoolOptions,
  schoolAutoFilled,
}: {
  initial: Initial;
  majorOptions: MajorOption[];
  schoolOptions: string[];
  schoolAutoFilled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ message: string; field: string | null } | null>(null);
  const [state, setState] = useState<Initial>(initial);

  const isOther = state.major === "other";
  const isSchoolOther = state.school === SCHOOL_OTHER;

  function setField<K extends keyof Initial>(key: K, value: Initial[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateMinimalProfile({
        firstName: state.firstName,
        lastName: state.lastName,
        school: isSchoolOther ? state.schoolOtherText.trim() : state.school,
        phoneNumber: state.phoneNumber,
        major: state.major,
        majorOtherText: isOther ? state.majorOtherText : null,
      });
      if (!result.ok) {
        setError({
          message: result.error.message,
          field: result.error.field ?? null,
        });
        return;
      }
      // Consent is the next required step. Verify-email is a soft step reached
      // via the step indicator or a dashboard nudge — it auto-populates
      // profiles.school on success but isn't required to finish the funnel.
      router.push("/onboarding/consent");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="First name"
          required
          error={error?.field === "firstName" ? error.message : null}
        >
          <Input
            value={state.firstName}
            onChange={(e) => setField("firstName", e.target.value)}
            autoComplete="given-name"
            required
            disabled={pending}
          />
        </Field>
        <Field
          label="Last name"
          required
          error={error?.field === "lastName" ? error.message : null}
        >
          <Input
            value={state.lastName}
            onChange={(e) => setField("lastName", e.target.value)}
            autoComplete="family-name"
            required
            disabled={pending}
          />
        </Field>
        <Field
          label={
            schoolAutoFilled
              ? "School (set from your verified student email)"
              : "School"
          }
          required
          error={error?.field === "school" ? error.message : null}
        >
          <select
            className={selectClass}
            value={state.school}
            onChange={(e) => setField("school", e.target.value)}
            required
            disabled={pending}
          >
            <option value="" disabled>
              Select your school
            </option>
            {schoolOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value={SCHOOL_OTHER}>Other (not listed)</option>
          </select>
        </Field>
        <Field
          label="Phone"
          required
          error={error?.field === "phoneNumber" ? error.message : null}
        >
          <Input
            type="tel"
            value={state.phoneNumber}
            onChange={(e) => setField("phoneNumber", e.target.value)}
            autoComplete="tel"
            required
            disabled={pending}
            placeholder="(404) 555-1234"
          />
        </Field>
        <Field
          label="Major"
          required
          error={error?.field === "major" ? error.message : null}
        >
          <select
            className={selectClass}
            value={state.major}
            onChange={(e) => setField("major", e.target.value)}
            required
            disabled={pending}
          >
            <option value="" disabled>
              Select your major
            </option>
            {majorOptions.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {isSchoolOther ? (
        <Field
          label="Tell us your school"
          required
          error={error?.field === "school" ? error.message : null}
        >
          <Input
            value={state.schoolOtherText}
            onChange={(e) => setField("schoolOtherText", e.target.value)}
            maxLength={150}
            required
            disabled={pending}
            placeholder="e.g. Kennesaw State University"
          />
        </Field>
      ) : null}

      {isOther ? (
        <Field
          label="Tell us your major"
          required
          error={error?.field === "majorOtherText" ? error.message : null}
        >
          <Input
            value={state.majorOtherText}
            onChange={(e) => setField("majorOtherText", e.target.value)}
            maxLength={100}
            required
            disabled={pending}
            placeholder="e.g. Cognitive Science"
          />
        </Field>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <p className="font-medium">
            {FIELD_ERROR_HEADINGS[error.field ?? ""] ?? "We couldn't save your profile"}
          </p>
          <p className="mt-1">{error.message}</p>
        </div>
      ) : null}

      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-muted-foreground">
          You&apos;ll add graduation info, roles, and a resume on your dashboard
          after signing in.
        </p>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save and continue"}
        </Button>
      </div>
    </form>
  );
}

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
