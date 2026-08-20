import Link from "next/link";

type ConsentRow = {
  consent_type: string;
  accepted: boolean;
  version: string;
  accepted_at: string;
  id: string;
};
type VersionRow = { consent_type: string; version: string };

export function StaleConsentBanner({
  consents,
  versions,
}: {
  consents: ConsentRow[];
  versions: VersionRow[];
}) {
  const versionMap = new Map(versions.map((v) => [v.consent_type, v.version]));

  const sorted = [...consents].sort((a, b) => {
    if (a.accepted_at !== b.accepted_at)
      return b.accepted_at.localeCompare(a.accepted_at);
    return b.id.localeCompare(a.id);
  });
  const latest = new Map<string, ConsentRow>();
  for (const c of sorted) {
    if (!latest.has(c.consent_type)) latest.set(c.consent_type, c);
  }

  // Consider only optional marketing consents — required ones gate the whole
  // onboarding cascade, so they bounce back to /onboarding/consent instead of
  // showing here.
  const OPTIONAL = ["recruiter_resume_sharing", "email_marketing", "sms_marketing"];
  const stale = OPTIONAL.filter((t) => {
    const row = latest.get(t);
    const current = versionMap.get(t);
    if (!row || !current) return false;
    if (!row.accepted) return false; // they've opted out, nothing to re-prompt
    return row.version !== current;
  });

  if (stale.length === 0) return null;

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-4 text-sm">
      <p className="font-medium text-foreground">
        We&apos;ve updated our consent language
      </p>
      <p className="mt-1 text-muted-foreground">
        Review and re-accept your preferences to keep receiving updates and
        remain eligible for recruiter sharing.
      </p>
      <Link
        href="/profile/settings/notifications"
        className="mt-2 inline-block text-primary underline underline-offset-4"
      >
        Review preferences →
      </Link>
    </div>
  );
}
