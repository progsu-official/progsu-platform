"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { VerifyEmailForm } from "@/app/onboarding/verify-email/verify-email-form";

// Account email section on /dashboard/settings (docs/15-settings-account-email).
// Read-only Google sign-in row + editable student email with inline OTP flow.
// "Change student email" is always visible — even when verified — so a user
// can switch schools mid-semester without leaving settings.

export function AccountEmailSettings({
  googleEmail,
  studentEmail,
  studentEmailVerified,
  studentEmailVerifiedAt,
  pendingDomainName,
}: {
  googleEmail: string;
  studentEmail: string | null;
  studentEmailVerified: boolean;
  studentEmailVerifiedAt: string | null;
  pendingDomainName: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  function handleSuccess() {
    setEditing(false);
    // The form already calls router.refresh in settings mode; this re-render
    // is a defensive belt-and-braces for the badge to repaint immediately.
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="account-email-google">Google sign-in</Label>
        <Input
          id="account-email-google"
          value={googleEmail}
          disabled
          readOnly
          className="cursor-not-allowed"
        />
        <p className="text-xs text-muted-foreground">
          This is your sign-in email and can&apos;t be changed here.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label className="text-sm font-medium">Student email</Label>
          <StudentEmailBadge
            studentEmail={studentEmail}
            verified={studentEmailVerified}
            verifiedAt={studentEmailVerifiedAt}
            pendingDomainName={pendingDomainName}
          />
        </div>

        {editing ? (
          <div className="rounded-md border bg-muted/10 p-4">
            <VerifyEmailForm
              initialEmail={studentEmail ?? ""}
              fullyOnboarded={true}
              mode="settings"
              allowSkip={false}
              onSuccess={handleSuccess}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <>
            <p className="text-sm text-foreground">
              {studentEmail ? (
                <span className="font-mono">{studentEmail}</span>
              ) : (
                <span className="text-muted-foreground">Not set</span>
              )}
            </p>
            <StudentEmailHint
              studentEmail={studentEmail}
              verified={studentEmailVerified}
              pendingDomainName={pendingDomainName}
            />
            <div className="pt-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
              >
                {studentEmail ? "Change student email" : "Add student email"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StudentEmailBadge({
  studentEmail,
  verified,
  verifiedAt,
  pendingDomainName,
}: {
  studentEmail: string | null;
  verified: boolean;
  verifiedAt: string | null;
  pendingDomainName: string | null;
}) {
  if (verified && verifiedAt) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
        ✓ Verified · {new Date(verifiedAt).toLocaleDateString()}
      </span>
    );
  }
  if (pendingDomainName) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
        Pending: {pendingDomainName}
      </span>
    );
  }
  if (studentEmail) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
        Awaiting verification
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      Not verified
    </span>
  );
}

function StudentEmailHint({
  studentEmail,
  verified,
  pendingDomainName,
}: {
  studentEmail: string | null;
  verified: boolean;
  pendingDomainName: string | null;
}) {
  if (verified) return null;
  if (pendingDomainName) {
    return (
      <p className="text-xs text-muted-foreground">
        Your school isn&apos;t on the verification allowlist yet. We&apos;ll
        email you when it is.
      </p>
    );
  }
  if (!studentEmail) {
    return (
      <p className="text-xs text-muted-foreground">
        Add your school email so recruiters can find you.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      We have your email but haven&apos;t confirmed it yet.
    </p>
  );
}
