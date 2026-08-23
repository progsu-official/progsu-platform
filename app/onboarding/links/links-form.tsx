"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronDown, Globe } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Select } from "@/app/_components/select";
import { LinkedInMark, GitHubMark } from "@/app/_components/brand-marks";
import {
  PrefixedInput,
  linkedinHandleFrom,
  linkedinUrlFrom,
  githubHandleFrom,
  githubUrlFrom,
  siteHostFrom,
  siteUrlFrom,
} from "@/app/profile/settings/prefixed-input";
import { updateOnboardingLinks } from "@/lib/actions/profile";
import { cn } from "@/lib/utils";
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

import {
  OnbActionBar,
  OnbErrorBox,
  OnbPrimaryButton,
  OnbSurface,
  OnbIntro,
  onbPanelClasses,
} from "../_components/shell";
import { Field } from "../_components/field";

const FIELD_ERROR_HEADINGS: Record<string, string> = {
  classStanding: "Pick your class standing",
  gradYear: "Pick your graduation year",
  gradTerm: "Pick your graduation term",
  interestedRoles: "Pick at least one",
  linkedinUrl: "That LinkedIn link doesn't look right",
  githubUrl: "That GitHub link doesn't look right",
  portfolioUrl: "That link doesn't look right",
  bio: "Keep it to one line, 220 characters or fewer",
};

// The submit button lives in a fixed action bar, so a field error rendered
// inline (e.g. class standing, up top) can land off-screen with nothing
// visible happening from the user's scroll position. Scroll the erroring
// field into view instead of leaving it silently unreachable.
const FIELD_IDS: Record<string, string> = {
  classStanding: "onboarding-class-standing",
  gradTerm: "onboarding-grad-term",
  gradYear: "onboarding-grad-year",
  interestedRoles: "onboarding-interested-roles",
  linkedinUrl: "onboarding-linkedin",
  githubUrl: "onboarding-github",
  portfolioUrl: "onboarding-portfolio",
  bio: "onboarding-bio",
};

type Initial = {
  classStanding: string;
  gradYear: number | null;
  gradTerm: string;
  interestedRoles: string[];
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  bio: string;
};

const FORM_ID = "onboarding-links-form";

const inputClasses =
  "h-11 rounded-[14px] border-border bg-card px-3.5 focus-visible:ring-primary";

export function LinksForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showLinks, setShowLinks] = useState(false);
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
      if (has) {
        return { ...s, interestedRoles: s.interestedRoles.filter((r) => r !== role) };
      }
      if (s.interestedRoles.length >= 6) return s;
      return { ...s, interestedRoles: [...s.interestedRoles, role] };
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateOnboardingLinks({
        classStanding: state.classStanding as ClassStanding,
        gradYear: state.gradYear ?? currentYear,
        gradTerm: state.gradTerm as GradTerm,
        interestedRoles: state.interestedRoles as InterestedRole[],
        linkedinUrl: state.linkedinUrl || null,
        githubUrl: state.githubUrl || null,
        portfolioUrl: state.portfolioUrl || null,
        bio: state.bio || null,
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
      // Resume is next in the visible stepper (Profile -> Roles & Links ->
      // Resume -> Consent). It's a soft/skippable step (resume-uploader.tsx
      // pushes on to consent itself after upload or skip).
      router.push("/onboarding/resume");
      router.refresh();
    });
  }

  return (
    <>
      <OnbSurface className="space-y-6">
        <OnbIntro title="What are you into?">
          Two questions. This is what decides which opportunities we send you.
        </OnbIntro>
        <form id={FORM_ID} onSubmit={onSubmit} className="space-y-6">
          <div className={`${onbPanelClasses} grid grid-cols-1 gap-4 sm:grid-cols-3`}>
            <Field
              label="Class standing"
              required
              htmlFor="onboarding-class-standing"
              error={error?.field === "classStanding" ? error.message : null}
            >
              <Select
                id="onboarding-class-standing"
                value={state.classStanding}
                onChange={(v) => setField("classStanding", v)}
                options={CLASS_STANDINGS.map((c) => ({
                  value: c,
                  label: CLASS_STANDING_LABELS[c],
                }))}
                placeholder="Pick one"
                invalid={error?.field === "classStanding"}
                disabled={pending}
              />
            </Field>
            <Field
              label="Graduating term"
              required
              htmlFor="onboarding-grad-term"
              error={error?.field === "gradTerm" ? error.message : null}
            >
              <Select
                id="onboarding-grad-term"
                value={state.gradTerm}
                onChange={(v) => setField("gradTerm", v)}
                options={GRAD_TERMS.map((t) => ({ value: t, label: t }))}
                placeholder="Term"
                invalid={error?.field === "gradTerm"}
                disabled={pending}
              />
            </Field>
            <Field
              label="Graduating year"
              required
              htmlFor="onboarding-grad-year"
              error={error?.field === "gradYear" ? error.message : null}
            >
              <Select
                id="onboarding-grad-year"
                value={state.gradYear != null ? String(state.gradYear) : ""}
                onChange={(v) => setField("gradYear", v ? Number(v) : null)}
                options={gradYears.map((y) => ({ value: String(y), label: String(y) }))}
                placeholder="Year"
                invalid={error?.field === "gradYear"}
                disabled={pending}
              />
            </Field>
          </div>

          <div className={`${onbPanelClasses} space-y-5`}>
            <Field
              label={`What you\u2019re looking for (${state.interestedRoles.length}/6)`}
              required
              error={error?.field === "interestedRoles" ? error.message : null}
            >
              <div id="onboarding-interested-roles" className="flex flex-wrap gap-2">
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
                        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
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
              <p className="pt-1 text-xs text-muted-foreground">
                Shown on your profile once directory visibility is on.
              </p>
            </Field>

            {/* Four optional fields behind one disclosure. Left inline they
                made a skippable step look like eight required questions, which
                is the single reason people bounced off it. Anyone who wants
                them opens it; anyone who does not never sees them. */}
            <div className="border-t border-border/60 pt-5">
              <button
                type="button"
                onClick={() => setShowLinks((v) => !v)}
                aria-expanded={showLinks}
                aria-controls="onboarding-optional-links"
                className="flex w-full items-center justify-between gap-3 rounded-lg text-left text-[13.5px] font-medium text-foreground transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span>
                  Add your links
                  <span className="ml-2 font-normal text-muted-foreground">
                    optional
                  </span>
                </span>
                <ChevronDown
                  size={16}
                  strokeWidth={1.75}
                  aria-hidden
                  className={cn(
                    "shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                    showLinks && "rotate-180"
                  )}
                />
              </button>
            </div>

            <div
              id="onboarding-optional-links"
              hidden={!showLinks}
              className="grid grid-cols-1 gap-4 sm:grid-cols-3"
            >
              <Field label="LinkedIn" htmlFor="onboarding-linkedin">
                <PrefixedInput
                  id="onboarding-linkedin"
                  prefix="linkedin.com/in/"
                  icon={<LinkedInMark className="h-3.5 w-3.5" />}
                  value={linkedinHandleFrom(state.linkedinUrl)}
                  placeholder="janedoe"
                  disabled={pending}
                  onChange={(next) =>
                    setField("linkedinUrl", linkedinUrlFrom(linkedinHandleFrom(next)))
                  }
                />
                {error?.field === "linkedinUrl" ? (
                  <p role="alert" className="mt-1 text-[13px] text-destructive">
                    {error.message}
                  </p>
                ) : null}
              </Field>
              <Field label="GitHub" htmlFor="onboarding-github">
                <PrefixedInput
                  id="onboarding-github"
                  prefix="github.com/"
                  icon={<GitHubMark className="h-3.5 w-3.5" />}
                  value={githubHandleFrom(state.githubUrl)}
                  placeholder="janedoe"
                  disabled={pending}
                  onChange={(next) =>
                    setField("githubUrl", githubUrlFrom(githubHandleFrom(next)))
                  }
                />
                {error?.field === "githubUrl" ? (
                  <p role="alert" className="mt-1 text-[13px] text-destructive">
                    {error.message}
                  </p>
                ) : null}
              </Field>
              <Field label="Portfolio or site" htmlFor="onboarding-portfolio">
                <PrefixedInput
                  id="onboarding-portfolio"
                  prefix="https://"
                  icon={<Globe size={14} strokeWidth={1.75} aria-hidden />}
                  value={siteHostFrom(state.portfolioUrl)}
                  placeholder="janedoe.dev"
                  disabled={pending}
                  onChange={(next) =>
                    setField("portfolioUrl", siteUrlFrom(siteHostFrom(next)))
                  }
                />
                {error?.field === "portfolioUrl" ? (
                  <p role="alert" className="mt-1 text-[13px] text-destructive">
                    {error.message}
                  </p>
                ) : null}
              </Field>
            </div>

            <div hidden={!showLinks}>
              <Field
                label="Short bio"
                htmlFor="onboarding-bio"
                error={error?.field === "bio" ? error.message : null}
              >
                <Input
                  id="onboarding-bio"
                  value={state.bio}
                  onChange={(e) => setField("bio", e.target.value.slice(0, 220))}
                  placeholder="Full-stack dev, into ML and climbing"
                  maxLength={220}
                  disabled={pending}
                  className={inputClasses}
                />
                <p className="pt-1 text-xs text-muted-foreground">
                  One line, shown on your profile when directory visibility is on.{" "}
                  {state.bio.length}/220
                </p>
              </Field>
            </div>
          </div>

          {error && !FIELD_ERROR_HEADINGS[error.field ?? ""] ? (
            <OnbErrorBox>
              <p className="font-medium">We couldn&apos;t save that</p>
              <p className="mt-1">{error.message}</p>
            </OnbErrorBox>
          ) : null}
        </form>
      </OnbSurface>

      <OnbActionBar>
        <OnbPrimaryButton type="submit" form={FORM_ID} loading={pending}>
          {pending ? "Saving…" : "Continue"}
        </OnbPrimaryButton>
      </OnbActionBar>
    </>
  );
}
