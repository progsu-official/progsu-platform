"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/app/_components/select";
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
      // Resume comes next in the visible stepper (Profile -> Resume -> Consent).
      // It's a soft/skippable step (resume-uploader.tsx pushes on to consent
      // itself after upload or skip), but it needs to actually be shown once,
      // not silently bypassed. Verify-email is separately soft, reached via
      // the step indicator or a dashboard nudge — it auto-populates
      // profiles.school on success but isn't required to finish the funnel.
      router.push("/onboarding/resume");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid grid-cols-1 gap-4 rounded-2xl glass p-5 sm:grid-cols-2">
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
          label="School"
          required
          htmlFor="onboarding-school"
          error={error?.field === "school" ? error.message : null}
        >
          <Select
            id="onboarding-school"
            value={state.school}
            onChange={(v) => setField("school", v)}
            options={[
              ...schoolOptions.map((s) => ({ value: s, label: s })),
              { value: SCHOOL_OTHER, label: "Other (not listed)" },
            ]}
            placeholder="Select your school"
            invalid={error?.field === "school"}
            disabled={pending}
          />
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
          htmlFor="onboarding-major"
          error={error?.field === "major" ? error.message : null}
        >
          <Select
            id="onboarding-major"
            value={state.major}
            onChange={(v) => setField("major", v)}
            options={majorOptions.map((m) => ({
              value: m.slug,
              label: m.label,
            }))}
            placeholder="Select your major"
            invalid={error?.field === "major"}
            disabled={pending}
          />
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
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <p className="font-medium">
            {FIELD_ERROR_HEADINGS[error.field ?? ""] ?? "We couldn't save your profile"}
          </p>
          <p className="mt-1">{error.message}</p>
        </div>
      ) : null}

      <div className="space-y-3 pt-2">
        <Button
          type="submit"
          size="lg"
          disabled={pending}
          className="w-full rounded-full"
        >
          {pending ? "Saving…" : "Save and continue"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Graduation info, roles, and links come later, from your profile.
        </p>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  error,
  children,
  htmlFor,
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
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
