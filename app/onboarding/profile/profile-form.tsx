"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Select } from "@/app/_components/select";
import { updateMinimalProfile } from "@/lib/actions/profile";

import {
  OnbActionBar,
  OnbErrorBox,
  OnbPrimaryButton,
  OnbSurface,
  onbPanelClasses,
} from "../_components/shell";
import { Field } from "../_components/field";

// Field-specific headlines so users know WHICH field blocked the save, not just
// a vague "something went wrong".
const FIELD_ERROR_HEADINGS: Record<string, string> = {
  firstName: "first name is required",
  lastName: "last name is required",
  school: "pick your school",
  phoneNumber: "a phone number is required",
  major: "pick a major",
  majorOtherText: "tell us your major",
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
        {intro}
        {notice}
        <form id={FORM_ID} onSubmit={onSubmit} className="space-y-4">
          <div className={`${onbPanelClasses} grid grid-cols-1 gap-4 sm:grid-cols-2`}>
            <Field
              label="first name"
              required
              htmlFor="onboarding-first-name"
              error={error?.field === "firstName" ? error.message : null}
            >
              <Input
                id="onboarding-first-name"
                value={state.firstName}
                onChange={(e) => setField("firstName", e.target.value)}
                autoComplete="given-name"
                required
                disabled={pending}
                className={inputClasses}
              />
            </Field>
            <Field
              label="last name"
              required
              htmlFor="onboarding-last-name"
              error={error?.field === "lastName" ? error.message : null}
            >
              <Input
                id="onboarding-last-name"
                value={state.lastName}
                onChange={(e) => setField("lastName", e.target.value)}
                autoComplete="family-name"
                required
                disabled={pending}
                className={inputClasses}
              />
            </Field>
            <Field label="preferred name">
              <Input
                value={state.preferredName}
                onChange={(e) => setField("preferredName", e.target.value)}
                disabled={pending}
                className={inputClasses}
              />
            </Field>
            <Field
              label="phone"
              required
              htmlFor="onboarding-phone"
              error={error?.field === "phoneNumber" ? error.message : null}
            >
              <Input
                id="onboarding-phone"
                type="tel"
                value={state.phoneNumber}
                onChange={(e) => setField("phoneNumber", e.target.value)}
                autoComplete="tel"
                required
                disabled={pending}
                placeholder="(404) 555-1234"
                className={inputClasses}
              />
            </Field>
            <Field
              label="school"
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
                  { value: SCHOOL_OTHER, label: "other (not listed)" },
                ]}
                placeholder="select your school"
                invalid={error?.field === "school"}
                disabled={pending}
              />
            </Field>
            <Field
              label="major"
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
                placeholder="select your major"
                invalid={error?.field === "major"}
                disabled={pending}
              />
            </Field>
            <Field label="minor">
              <Input
                value={state.minor}
                onChange={(e) => setField("minor", e.target.value)}
                disabled={pending}
                className={inputClasses}
              />
            </Field>

            {isSchoolOther ? (
              <div className="sm:col-span-2">
                <Field
                  label="tell us your school"
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
                  label="tell us your major"
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

          {error ? (
            <OnbErrorBox>
              <p className="font-medium">
                {FIELD_ERROR_HEADINGS[error.field ?? ""] ??
                  "couldn't save your profile"}
              </p>
              <p className="mt-1">{error.message}</p>
            </OnbErrorBox>
          ) : null}
        </form>
      </OnbSurface>

      <OnbActionBar>
        <OnbPrimaryButton type="submit" form={FORM_ID} loading={pending}>
          {pending ? "saving…" : "continue"}
        </OnbPrimaryButton>
      </OnbActionBar>
    </>
  );
}
