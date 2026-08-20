"use client";

import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { recordConsents } from "@/lib/actions/consent";
import type { ConsentType } from "@/lib/actions/consent-schemas";

// Marketing consents a member can change after onboarding. Required ones
// (privacy, ToS, age) aren't editable here — version bumps re-prompt globally.
//
// Deliberately one switch per channel rather than a single "unsubscribe from
// everything". Someone tired of texts can keep email, which is both the honest
// design and the one that loses fewer subscribers than an all-or-nothing
// control. Each row states what turning it off actually costs, so nobody has to
// guess whether opting out also kills their RSVP confirmations.

type Toggle = {
  type: ConsentType;
  label: string;
  on: string;
  off: string;
};

const TOGGLES: Toggle[] = [
  {
    type: "email_marketing",
    label: "Event emails",
    on: "New events, workshops, and opportunities land in your inbox.",
    off: "You won't hear about new events by email. RSVP confirmations, reminders, and cancellations still send.",
  },
  {
    type: "sms_marketing",
    label: "Text messages",
    on: "Occasional texts for events worth dropping everything for.",
    off: "No texts from Progsu.",
  },
  {
    type: "recruiter_resume_sharing",
    label: "Share with recruiters",
    on: "Your profile and current resume can go out in sponsor exports.",
    off: "You're left out of recruiter exports, even with a complete profile.",
  },
];

type ConsentRow = {
  consent_type: string;
  accepted: boolean;
  version: string;
  accepted_at: string;
  id: string;
};
type VersionRow = { consent_type: string; version: string };

export function NotificationSettings({
  consents,
  versions,
  phoneNumber,
}: {
  consents: ConsentRow[];
  versions: VersionRow[];
  phoneNumber: string;
}) {
  const hasPhone = phoneNumber.length >= 7;

  // Latest row per consent_type, accepted_at desc then id desc.
  const latest = useMemo(() => {
    const map = new Map<string, ConsentRow>();
    const sorted = [...consents].sort((a, b) => {
      if (a.accepted_at !== b.accepted_at)
        return b.accepted_at.localeCompare(a.accepted_at);
      return b.id.localeCompare(a.id);
    });
    for (const c of sorted) if (!map.has(c.consent_type)) map.set(c.consent_type, c);
    return map;
  }, [consents]);

  const versionMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of versions) m.set(v.consent_type, v.version);
    return m;
  }, [versions]);

  const initial = useMemo(() => {
    const init: Record<string, boolean> = {};
    for (const t of TOGGLES) {
      const row = latest.get(t.type);
      init[t.type] =
        !!row && row.accepted === true && row.version === versionMap.get(t.type);
    }
    return init;
  }, [latest, versionMap]);

  const [state, setState] = useState<Record<string, boolean>>(initial);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "saved" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  const dirty = TOGGLES.some((t) => !!state[t.type] !== !!initial[t.type]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await recordConsents({
        acceptances: {
          // Re-accept the required trio at the current version so the gating
          // check still reads correctly. Rows are appended, never updated, so
          // a no-op re-accept changes nothing semantically.
          privacy_policy: true,
          terms_of_service: true,
          age_confirmation: true,
          recruiter_resume_sharing: !!state.recruiter_resume_sharing,
          email_marketing: !!state.email_marketing,
          sms_marketing: !!state.sms_marketing,
        },
      });
      if (!result.ok) {
        setStatus({ kind: "error", message: result.error.message });
        return;
      }
      setStatus({ kind: "saved" });
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="divide-y divide-border/60 overflow-hidden rounded-2xl glass">
        {TOGGLES.map((t) => {
          const disabled = t.type === "sms_marketing" && !hasPhone;
          const on = !!state[t.type];
          return (
            <div
              key={t.type}
              className="flex items-start justify-between gap-6 px-4 py-3.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{t.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {disabled
                    ? "Add a phone number to your profile to enable texts."
                    : on
                      ? t.on
                      : t.off}
                </p>
              </div>
              <Switch
                id={`toggle-${t.type}`}
                checked={on}
                disabled={disabled || pending}
                label={t.label}
                onChange={(next) =>
                  setState((s) => ({ ...s, [t.type]: next }))
                }
              />
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        {status.kind === "error" ? (
          <p role="alert" className="mr-auto text-sm text-destructive">
            {status.message}
          </p>
        ) : null}
        {status.kind === "saved" && !dirty ? (
          <p role="status" className="mr-auto text-sm text-primary">
            Preferences saved.
          </p>
        ) : null}
        <Button type="submit" size="sm" className="rounded-full" disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </form>
  );
}

function Switch({
  id,
  checked,
  disabled,
  label,
  onChange,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-muted-foreground/30"
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-1 h-4 w-4 rounded-full bg-background shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
