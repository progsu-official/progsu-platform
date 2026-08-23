"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Select } from "@/app/_components/select";
import { PhoneInput } from "@/app/_components/phone-input";
import { updateMinimalProfile } from "@/lib/actions/profile";

import {
  OnbActionBar,
  OnbErrorBox,
  OnbPrimaryButton,
  OnbSurface,
  onbPanelClasses,
  OnbSeam,
  useOnbSeam,
  OnbIntro,
} from "../_components/shell";
import { Field } from "../_components/field";
import { usePreview } from "../_components/preview";

// Field-specific headlines so users know WHICH field blocked the save, not just
// a vague "something went wrong".
const FIELD_ERROR_HEADINGS: Record<string, string> = {
  firstName: "First name is required",
  lastName: "Last name is required",
  school: "Pick your school",
  phoneNumber: "A phone number is required",
  major: "Pick a major",
  majorOtherText: "Which major?",
};

// The submit button lives in a fixed action bar, so an inline field error
// can land off-screen with nothing visible happening from wherever the user
// is scrolled. Scroll the erroring field into view instead.
const FIELD_IDS: Record<string, string> = {
  firstName: "onboarding-first-name",
  lastName: "onboarding-last-name",
  phoneNumber: "onboarding-phone",
  school: "onboarding-school",
  major: "onboarding-major",
  majorOtherText: "onboarding-major-other",
};

type Initial = {
  firstName: string;
  lastName: string;
  preferredName: string;
  school: string;
  schoolOtherText: string;
  phoneNumber: string;
  major: string;
  majorOtherText: string;
  minor: string;
};

const SCHOOL_OTHER = "other";

// The Continue button lives in the fixed OnbActionBar, a DOM sibling of the
// form (the action bar can't sit inside the animated OnbSurface), so it
// submits via the form attribute.
const FORM_ID = "onboarding-profile-form";

// folk-style field chrome on progsu tokens: inputs sit slightly proud of the
// soft card behind them.
const inputClasses =
  "h-11 rounded-[14px] border-border bg-card px-3.5 focus-visible:ring-primary";

type MajorOption = { slug: string; label: string };

export function ProfileForm({
  intro,
  notice,
  initial,
  majorOptions,
  schoolOptions,
}: {
  intro: ReactNode;
  notice: ReactNode;
  initial: Initial;
  majorOptions: MajorOption[];
  schoolOptions: string[];
}) {
  const router = useRouter();
  const preview = usePreview();
  const { seam, run: runSeam } = useOnbSeam();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ message: string; field: string | null } | null>(null);
  const [state, setState] = useState<Initial>(initial);

  // Two questions, not one form. Name first on its own, because it is the one
  // thing we can ask before we have earned anything, and because a screen
  // that opens with five inputs reads as paperwork. Both halves still submit
  // together — the split is presentational.
  const [phase, setPhase] = useState<"name" | "details">("name");
  const nameDone =
    state.firstName.trim().length > 0 && state.lastName.trim().length > 0;
  const nameStarted =
    state.firstName.trim().length > 0 || state.lastName.trim().length > 0;

  const isOther = state.major === "other";
  const isSchoolOther = state.school === SCHOOL_OTHER;

  function setField<K extends keyof Initial>(key: K, value: Initial[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (phase === "name") {
      if (!nameDone) {
        setError({
          message: state.firstName.trim()
            ? "We need your last name too"
            : "We need your first name",
          field: state.firstName.trim() ? "lastName" : "firstName",
        });
        return;
      }
      runSeam(() => setPhase("details"), "fwd");
      return;
    }

    // /dev/screens: native `required` has already run, so the form behaves
    // normally right up to the point where it would need a database.
    if (preview) return preview.advance("/onboarding/links");
    startTransition(async () => {
      const result = await updateMinimalProfile({
        firstName: state.firstName,
        lastName: state.lastName,
        preferredName: state.preferredName || null,
        school: isSchoolOther ? state.schoolOtherText.trim() : state.school,
        phoneNumber: state.phoneNumber,
        major: state.major,
        majorOtherText: isOther ? state.majorOtherText : null,
        minor: state.minor || null,
      });
      if (!result.ok) {
        setError({
          message: result.error.message,
          field: result.error.field ?? null,
        });
        const id = result.error.field ? FIELD_IDS[result.error.field] : null;
        document
          .getElementById(id ?? "")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      // Roles & links comes next in the visible stepper (Profile -> Roles &
      // Links -> Resume -> Consent).
      router.push("/onboarding/links");
      router.refresh();
    });
  }

  return (
    <>
      <OnbSurface className="space-y-6">
        {phase === "name" ? (
          intro
        ) : (
          <OnbIntro title={`Good to meet you, ${state.firstName.trim()}.`}>
            Three more and you&apos;re through.
          </OnbIntro>
        )}
        {phase === "name" ? notice : null}
        <form id={FORM_ID} onSubmit={onSubmit} className="space-y-4">
          {/* Exactly the fields is_fully_onboarded() actually gates on.
              Preferred name and minor used to sit here at identical weight,
              which made an optional field look required and turned a
              five-field step into a wall of nine. Both are still editable in
              /profile/settings, where someone goes on purpose. */}
          <OnbSeam seam={seam}>
          {phase === "name" ? (
          /* No panel, no labels, no boxes — the fields ARE the display type,
             folk's ghost-input treatment. The placeholders ask the question at
             headline size, so this reads as somewhere to answer rather than a
             form to fill in. Two fields rather than folk's single "Full Name"
             because profiles has separate columns and splitting on whitespace
             mangles "van der Berg"; the ghost styling is what carries the
             feel, not the field count. */
          <div className="flex flex-col items-center gap-3 pt-8">
            <label htmlFor="onboarding-first-name" className="sr-only">
              First name
            </label>
            <input
              id="onboarding-first-name"
              value={state.firstName}
              onChange={(e) => setField("firstName", e.target.value)}
              autoComplete="given-name"
              autoCapitalize="words"
              enterKeyHint="next"
              placeholder="First name"
              required
              disabled={pending}
              aria-invalid={error?.field === "firstName"}
              className="onb-ghost-input"
              style={{ fontSize: "clamp(28px, 6.5vw, 44px)", lineHeight: 1.2 }}
            />
            <label htmlFor="onboarding-last-name" className="sr-only">
              Last name
            </label>
            <input
              id="onboarding-last-name"
              value={state.lastName}
              onChange={(e) => setField("lastName", e.target.value)}
              autoComplete="family-name"
              autoCapitalize="words"
              enterKeyHint="go"
              placeholder="Last name"
              required
              disabled={pending}
              aria-invalid={error?.field === "lastName"}
              className="onb-ghost-input"
              style={{ fontSize: "clamp(28px, 6.5vw, 44px)", lineHeight: 1.2 }}
            />
            {/* Only nags once they have actually typed something. An inline
                error on an untouched field reads as broken. */}
            <p
              className={`mt-4 text-[13px] leading-[1.5] ${
                nameStarted && !nameDone
                  ? "text-destructive"
                  : "text-muted-foreground"
              }`}
            >
              {nameStarted && !nameDone
                ? "We need both — it's what your name looks like to everyone else."
                : "Both, please. It's how you show up to everyone else."}
            </p>
          </div>
          ) : (
          <div className={`${onbPanelClasses} grid grid-cols-1 gap-4 sm:grid-cols-2`}>
            <Field
              label="Phone"
              required
              htmlFor="onboarding-phone"
              error={error?.field === "phoneNumber" ? error.message : null}
            >
              <PhoneInput
                id="onboarding-phone"
                value={state.phoneNumber}
                onChange={(v) => setField("phoneNumber", v)}
                required
                disabled={pending}
                invalid={error?.field === "phoneNumber"}
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
                placeholder="Pick your school"
                invalid={error?.field === "school"}
                disabled={pending}
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
                placeholder="Pick your major"
                invalid={error?.field === "major"}
                disabled={pending}
              />
            </Field>

            {isSchoolOther ? (
              <div className="sm:col-span-2">
                <Field
                  label="Which school?"
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
                    className={inputClasses}
                  />
                </Field>
              </div>
            ) : null}

            {isOther ? (
              <div className="sm:col-span-2">
                <Field
                  label="Which major?"
                  required
                  htmlFor="onboarding-major-other"
                  error={error?.field === "majorOtherText" ? error.message : null}
                >
                  <Input
                    id="onboarding-major-other"
                    value={state.majorOtherText}
                    onChange={(e) => setField("majorOtherText", e.target.value)}
                    maxLength={100}
                    required
                    disabled={pending}
                    placeholder="e.g. Cognitive Science"
                    className={inputClasses}
                  />
                </Field>
              </div>
            ) : null}
          </div>
          )}
          </OnbSeam>

          {error ? (
            <OnbErrorBox>
              <p className="font-medium">
                {FIELD_ERROR_HEADINGS[error.field ?? ""] ??
                  "We couldn't save that"}
              </p>
              <p className="mt-1">{error.message}</p>
            </OnbErrorBox>
          ) : null}
        </form>
      </OnbSurface>

      <OnbActionBar>
        {/* Disabled until the name is real, folk's required-cohort rule: the
            name is the one thing this step exists for, so a live button that
            bounces off validation is worse than one that waits. */}
        <OnbPrimaryButton
          type="submit"
          form={FORM_ID}
          loading={pending}
          disabled={phase === "name" && !nameDone}
        >
          {pending ? "Saving…" : "Continue"}
        </OnbPrimaryButton>
      </OnbActionBar>
    </>
  );
}
