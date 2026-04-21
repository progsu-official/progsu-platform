"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { updateProfile } from "@/lib/actions/profile";
import {
  CLASS_STANDINGS,
  CLASS_STANDING_LABELS,
  GRAD_TERMS,
  INTERESTED_ROLES,
  INTERESTED_ROLE_LABELS,
  type ClassStanding,
  type GradTerm,
  type InterestedRole,
} from "@/lib/enums/roles";

type Initial = {
  firstName: string;
  lastName: string;
  preferredName: string;
  school: string;
  major: string;
  minor: string;
  classStanding: string;
  gradYear: number | null;
  gradTerm: string;
  interestedRoles: string[];
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  phoneNumber: string;
};

export function ProfileForm({
  initial,
  schoolOptions,
}: {
  initial: Initial;
  schoolOptions: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ message: string; field: string | null } | null>(null);
  const [state, setState] = useState<Initial>(initial);

  const currentYear = new Date().getFullYear();
  const gradYears = Array.from({ length: 8 }, (_, i) => currentYear - 1 + i);

  function setField<K extends keyof Initial>(key: K, value: Initial[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function toggleRole(role: InterestedRole) {
    setState((s) => {
      const has = s.interestedRoles.includes(role);
      if (has) return { ...s, interestedRoles: s.interestedRoles.filter((r) => r !== role) };
      if (s.interestedRoles.length >= 6) return s;
      return { ...s, interestedRoles: [...s.interestedRoles, role] };
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateProfile({
        firstName: state.firstName,
        lastName: state.lastName,
        preferredName: state.preferredName || null,
        school: state.school,
        major: state.major,
        minor: state.minor || null,
        classStanding: state.classStanding as ClassStanding,
        gradYear: state.gradYear ?? currentYear,
        gradTerm: state.gradTerm as GradTerm,
        interestedRoles: state.interestedRoles as InterestedRole[],
        linkedinUrl: state.linkedinUrl || null,
        githubUrl: state.githubUrl || null,
        portfolioUrl: state.portfolioUrl || null,
        phoneNumber: state.phoneNumber || null,
      });
      if (!result.ok) {
        setError({
          message: result.error.message,
          field: result.error.field ?? null,
        });
        return;
      }
      router.push("/onboarding/resume");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="First name" required error={error?.field === "firstName" ? error.message : null}>
          <Input
            value={state.firstName}
            onChange={(e) => setField("firstName", e.target.value)}
            autoComplete="given-name"
            required
            disabled={pending}
          />
        </Field>
        <Field label="Last name" required error={error?.field === "lastName" ? error.message : null}>
          <Input
            value={state.lastName}
            onChange={(e) => setField("lastName", e.target.value)}
            autoComplete="family-name"
            required
            disabled={pending}
          />
        </Field>
        <Field label="Preferred name (optional)">
          <Input
            value={state.preferredName}
            onChange={(e) => setField("preferredName", e.target.value)}
            disabled={pending}
          />
        </Field>
        <Field label="Phone (optional)" error={error?.field === "phoneNumber" ? error.message : null}>
          <Input
            type="tel"
            value={state.phoneNumber}
            onChange={(e) => setField("phoneNumber", e.target.value)}
            autoComplete="tel"
            disabled={pending}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="School" required error={error?.field === "school" ? error.message : null}>
          <select
            className={selectClass}
            value={state.school}
            onChange={(e) => setField("school", e.target.value)}
            required
            disabled={pending}
          >
            <option value="" disabled>Select your school</option>
            {schoolOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Class standing" required error={error?.field === "classStanding" ? error.message : null}>
          <select
            className={selectClass}
            value={state.classStanding}
            onChange={(e) => setField("classStanding", e.target.value)}
            required
            disabled={pending}
          >
            <option value="" disabled>Select…</option>
            {CLASS_STANDINGS.map((cs) => (
              <option key={cs} value={cs}>{CLASS_STANDING_LABELS[cs]}</option>
            ))}
          </select>
        </Field>
        <Field label="Major" required error={error?.field === "major" ? error.message : null}>
          <Input
            value={state.major}
            onChange={(e) => setField("major", e.target.value)}
            required
            disabled={pending}
          />
        </Field>
        <Field label="Minor (optional)">
          <Input
            value={state.minor}
            onChange={(e) => setField("minor", e.target.value)}
            disabled={pending}
          />
        </Field>
        <Field label="Graduation term" required>
          <select
            className={selectClass}
            value={state.gradTerm}
            onChange={(e) => setField("gradTerm", e.target.value)}
            required
            disabled={pending}
          >
            <option value="" disabled>Term…</option>
            {GRAD_TERMS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Graduation year" required error={error?.field === "gradYear" ? error.message : null}>
          <select
            className={selectClass}
            value={state.gradYear ?? ""}
            onChange={(e) => setField("gradYear", e.target.value ? Number(e.target.value) : null)}
            required
            disabled={pending}
          >
            <option value="" disabled>Year…</option>
            {gradYears.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        label={`Interested roles (pick up to 6, chose ${state.interestedRoles.length})`}
        required
        error={error?.field === "interestedRoles" ? error.message : null}
      >
        <div className="flex flex-wrap gap-2">
          {INTERESTED_ROLES.map((role) => {
            const active = state.interestedRoles.includes(role);
            const disabled = !active && state.interestedRoles.length >= 6;
            return (
              <button
                key={role}
                type="button"
                disabled={pending || disabled}
                onClick={() => toggleRole(role)}
                aria-pressed={active}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background text-foreground hover:bg-accent/10",
                  disabled && "cursor-not-allowed opacity-40"
                )}
              >
                {INTERESTED_ROLE_LABELS[role]}
              </button>
            );
          })}
        </div>
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="LinkedIn (optional)" error={error?.field === "linkedinUrl" ? error.message : null}>
          <Input
            type="url"
            placeholder="https://linkedin.com/in/you"
            value={state.linkedinUrl}
            onChange={(e) => setField("linkedinUrl", e.target.value)}
            disabled={pending}
          />
        </Field>
        <Field label="GitHub (optional)" error={error?.field === "githubUrl" ? error.message : null}>
          <Input
            type="url"
            placeholder="https://github.com/you"
            value={state.githubUrl}
            onChange={(e) => setField("githubUrl", e.target.value)}
            disabled={pending}
          />
        </Field>
        <Field label="Portfolio / website (optional)" error={error?.field === "portfolioUrl" ? error.message : null}>
          <Input
            type="url"
            placeholder="https://"
            value={state.portfolioUrl}
            onChange={(e) => setField("portfolioUrl", e.target.value)}
            disabled={pending}
          />
        </Field>
      </div>

      {error && !error.field ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error.message}
        </div>
      ) : null}

      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-muted-foreground">
          We&apos;ll use this info to help recruiters find you later. You control what&apos;s shared.
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
