"use client";

import { useMemo, useState, useTransition } from "react";

import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { recordConsents } from "@/lib/actions/consent";
import type { ConsentType } from "@/lib/actions/consent-schemas";

// Marketing consents users can toggle after onboarding. Required ones
// (privacy, ToS, age) are immutable here — if we bump versions later
// we'll re-prompt globally through a separate flow.
const TOGGLES: Array<{ type: ConsentType; label: string; hint?: string }> = [
  {
    type: "recruiter_resume_sharing",
    label:
      "Share my profile and current resume with recruiters Progsu works with",
    hint: "We won't sell your data. You can turn this off any time.",
  },
  {
    type: "email_marketing",
    label: "Email me about Progsu events and opportunities",
  },
  {
    type: "sms_marketing",
    label: "Text me about Progsu events and opportunities",
    hint: "Requires a phone number on your profile. Reply STOP to unsubscribe.",
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

export function ConsentSettings({
  consents,
  versions,
  phoneNumber,
}: {
  consents: ConsentRow[];
  versions: VersionRow[];
  phoneNumber: string;
}) {
  const hasPhone = phoneNumber.length >= 7;

  // Compute latest row per (consent_type) with accepted_at desc, id desc.
  const latest = useMemo(() => {
    const map = new Map<string, ConsentRow>();
    const sorted = [...consents].sort((a, b) => {
      if (a.accepted_at !== b.accepted_at)
        return b.accepted_at.localeCompare(a.accepted_at);
      return b.id.localeCompare(a.id);
    });
    for (const c of sorted) {
      if (!map.has(c.consent_type)) map.set(c.consent_type, c);
    }
    return map;
  }, [consents]);

  const versionMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of versions) m.set(v.consent_type, v.version);
    return m;
  }, [versions]);

  const [state, setState] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const t of TOGGLES) {
      const row = latest.get(t.type);
      init[t.type] =
        !!row &&
        row.accepted === true &&
        row.version === versionMap.get(t.type);
    }
    return init;
  });
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "saved" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await recordConsents({
        acceptances: {
          // Always also re-accept the required trio at the current version so
          // the gating check reads correctly. Required rows don't actually change
          // semantics on a no-op re-accept because we append, not update.
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
    <form onSubmit={onSubmit} className="space-y-4">
      {TOGGLES.map((t) => {
        const disabled = t.type === "sms_marketing" && !hasPhone;
        return (
          <div key={t.type} className="flex items-start gap-3">
            <input
              type="checkbox"
              id={`toggle-${t.type}`}
              className="mt-0.5 h-4 w-4 rounded border-input accent-[hsl(var(--primary))]"
              checked={!!state[t.type]}
              onChange={(e) =>
                setState((s) => ({ ...s, [t.type]: e.target.checked }))
              }
              disabled={disabled || pending}
            />
            <div>
              <Label htmlFor={`toggle-${t.type}`} className="cursor-pointer">
                {t.label}
              </Label>
              {t.hint ? (
                <p className="text-xs text-muted-foreground">
                  {disabled
                    ? "Add a phone number on your profile to enable SMS."
                    : t.hint}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
      {status.kind === "error" ? (
        <p role="alert" className="text-sm text-destructive">{status.message}</p>
      ) : null}
      {status.kind === "saved" ? (
        <p role="status" className="text-sm text-primary">Preferences saved.</p>
      ) : null}
      <div className="flex items-center justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </form>
  );
}
