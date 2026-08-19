"use client";

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

// Mirror of the onboarding form's field → headline map so users know exactly
// which field is blocking a save.
const FIELD_ERROR_HEADINGS: Record<string, string> = {
  firstName: "First name is required",
  lastName: "Last name is required",
  school: "Select your school",
  major: "Major is required",
  classStanding: "Select your class standing",
  gradYear: "Select your graduation year",
  gradTerm: "Select your graduation term",
  interestedRoles: "Pick at least one role",
  phoneNumber: "Your profile didn't save — a phone number is required",
  linkedinUrl: "That LinkedIn URL doesn't look right",
  githubUrl: "That GitHub URL doesn't look right",
  portfolioUrl: "That portfolio URL doesn't look right",
  bio: "Bio must be one line, 220 characters or fewer",
};

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
  bio: string;
  phoneNumber: string;
};

export function ProfileSettings({
  initial,
  schoolOptions,
}: {
  initial: Initial;
  schoolOptions: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<Initial>(initial);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "saved" }
    | { kind: "error"; message: string; field?: string }
  >({ kind: "idle" });

  const currentYear = new Date().getFullYear();
  const gradYears = Array.from({ length: 8 }, (_, i) => currentYear - 1 + i);

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
    setStatus({ kind: "idle" });
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
        bio: state.bio || null,
        phoneNumber: state.phoneNumber,
      });
      if (!result.ok) {
        setStatus({
          kind: "error",
          message: result.error.message,
          field: result.error.field,
        });
        return;
      }
      setStatus({ kind: "saved" });
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Row label="First name" required>
          <Input
            value={state.firstName}
            onChange={(e) => setState({ ...state, firstName: e.target.value })}
            disabled={pending}
            required
          />
        </Row>
        <Row label="Last name" required>
          <Input
            value={state.lastName}
            onChange={(e) => setState({ ...state, lastName: e.target.value })}
            disabled={pending}
            required
          />
        </Row>
        <Row label="Preferred name">
          <Input
            value={state.preferredName}
            onChange={(e) => setState({ ...state, preferredName: e.target.value })}
            disabled={pending}
          />
        </Row>
        <Row label="Phone" required>
          <Input
            type="tel"
            value={state.phoneNumber}
            onChange={(e) => setState({ ...state, phoneNumber: e.target.value })}
            disabled={pending}
            required
            placeholder="(404) 555-1234"
          />
        </Row>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Row label="School" required>
          <select
            className={selectClass}
            value={state.school}
            onChange={(e) => setState({ ...state, school: e.target.value })}
            required
            disabled={pending}
          >
            <option value="" disabled>Select…</option>
            {schoolOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Row>
        <Row label="Class standing" required>
          <select
            className={selectClass}
            value={state.classStanding}
            onChange={(e) => setState({ ...state, classStanding: e.target.value })}
            required
            disabled={pending}
          >
            <option value="" disabled>Select…</option>
            {CLASS_STANDINGS.map((c) => (
              <option key={c} value={c}>{CLASS_STANDING_LABELS[c]}</option>
            ))}
          </select>
        </Row>
        <Row label="Major" required>
          <Input
            value={state.major}
            onChange={(e) => setState({ ...state, major: e.target.value })}
            disabled={pending}
            required
          />
        </Row>
        <Row label="Minor">
          <Input
            value={state.minor}
            onChange={(e) => setState({ ...state, minor: e.target.value })}
            disabled={pending}
          />
        </Row>
        <Row label="Graduation term" required>
          <select
            className={selectClass}
            value={state.gradTerm}
            onChange={(e) => setState({ ...state, gradTerm: e.target.value })}
            required
            disabled={pending}
          >
            <option value="" disabled>Term…</option>
            {GRAD_TERMS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Row>
        <Row label="Graduation year" required>
          <select
            className={selectClass}
            value={state.gradYear ?? ""}
            onChange={(e) =>
              setState({
                ...state,
                gradYear: e.target.value ? Number(e.target.value) : null,
              })
            }
            required
            disabled={pending}
          >
            <option value="" disabled>Year…</option>
            {gradYears.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </Row>
      </div>

      <Row label={`Interested roles (${state.interestedRoles.length}/6)`} required>
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
                    : "border-input bg-background hover:bg-accent/10",
                  disabled && "cursor-not-allowed opacity-40"
                )}
              >
                {INTERESTED_ROLE_LABELS[role]}
              </button>
            );
          })}
        </div>
      </Row>

      <p className="text-xs text-muted-foreground">
        Optional. Shown as icons on your profile when directory visibility is
        on (Settings → Visibility).
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Row label="LinkedIn">
          <Input
            type="url"
            value={state.linkedinUrl}
            onChange={(e) => setState({ ...state, linkedinUrl: e.target.value })}
            placeholder="https://linkedin.com/in/you"
            disabled={pending}
          />
        </Row>
        <Row label="GitHub">
          <Input
            type="url"
            value={state.githubUrl}
            onChange={(e) => setState({ ...state, githubUrl: e.target.value })}
            placeholder="https://github.com/you"
            disabled={pending}
          />
        </Row>
        <Row label="Portfolio / site">
          <Input
            type="url"
            value={state.portfolioUrl}
            onChange={(e) => setState({ ...state, portfolioUrl: e.target.value })}
            placeholder="https://"
            disabled={pending}
          />
        </Row>
      </div>

      <Row label="Bio">
        <Input
          value={state.bio}
          onChange={(e) => setState({ ...state, bio: e.target.value.slice(0, 220) })}
          placeholder="full-stack dev, into ML and climbing"
          maxLength={220}
          disabled={pending}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          One line, shown on your profile when directory visibility is on.{" "}
          {state.bio.length}/220
        </p>
      </Row>

      {status.kind === "error" ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <p className="font-medium">
            {FIELD_ERROR_HEADINGS[status.field ?? ""] ?? "We couldn't save your profile"}
          </p>
          <p className="mt-1">{status.message}</p>
        </div>
      ) : null}
      {status.kind === "saved" ? (
        <div
          role="status"
          className="rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary"
        >
          Saved.
        </div>
      ) : null}

      <div className="flex items-center justify-end">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Row({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}
