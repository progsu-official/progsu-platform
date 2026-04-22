"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  setProfileSlug,
  setProfileVisibility,
} from "@/lib/actions/members";

type Props = {
  initial: {
    discoverable: boolean;
    share_attended_events: boolean;
    share_shared_event_counts: boolean;
    profile_slug: string | null;
  };
  siteUrl: string;
};

export function VisibilitySettings({ initial, siteUrl }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState(initial);
  const [slugDraft, setSlugDraft] = useState(initial.profile_slug ?? "");
  const [editingSlug, setEditingSlug] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reacceptHref, setReacceptHref] = useState<string | null>(null);

  function updateToggle(
    key: "discoverable" | "share_attended_events" | "share_shared_event_counts",
    value: boolean
  ) {
    setError(null);
    setNotice(null);
    setReacceptHref(null);
    startTransition(async () => {
      const r = await setProfileVisibility({ [key]: value });
      if (!r.ok) {
        if (r.error.field === "privacy_policy") {
          setReacceptHref(
            "/privacy?reaccept=member_directory&return=/dashboard/settings%23visibility"
          );
          setError(r.error.message);
          return;
        }
        setError(r.error.message);
        return;
      }
      setState((s) => ({ ...s, [key]: value }));
      router.refresh();
    });
  }

  function saveSlug() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await setProfileSlug({ slug: slugDraft });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setState((s) => ({ ...s, profile_slug: r.data.slug }));
      setSlugDraft(r.data.slug);
      setEditingSlug(false);
      setNotice("URL updated.");
      router.refresh();
    });
  }

  const profileUrl = state.profile_slug
    ? `${siteUrl}/members/${state.profile_slug}`
    : null;

  return (
    <div className="space-y-5">
      <Toggle
        label="Let other Progsu members find my profile"
        description="When on, members can visit your profile and see your name, school, class standing, graduation term, and interested roles."
        checked={state.discoverable}
        onChange={(v) => updateToggle("discoverable", v)}
        disabled={pending}
      />

      <Toggle
        label="Show events I've attended on my profile"
        description="Only public, non-sensitive events with enough attendees appear. Private-invite events are never shown."
        checked={state.share_attended_events}
        onChange={(v) => updateToggle("share_attended_events", v)}
        disabled={pending || !state.discoverable}
      />

      <Toggle
        label="Let other members see events we've both attended"
        description="Coming soon: when you and another member have both turned this on, we can highlight events you attended together."
        checked={state.share_shared_event_counts}
        onChange={(v) => updateToggle("share_shared_event_counts", v)}
        disabled={pending || !state.discoverable}
      />

      {state.profile_slug ? (
        <div className="space-y-2 rounded-md border p-3">
          <Label className="text-xs">Your profile URL</Label>
          {editingSlug ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {siteUrl}/members/
              </span>
              <Input
                value={slugDraft}
                onChange={(e) => setSlugDraft(e.target.value)}
                className="max-w-xs"
                maxLength={40}
                disabled={pending}
              />
              <Button
                type="button"
                size="sm"
                onClick={saveSlug}
                disabled={pending || slugDraft.trim().length < 3}
              >
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSlugDraft(state.profile_slug ?? "");
                  setEditingSlug(false);
                  setError(null);
                }}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm">{profileUrl}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setSlugDraft(state.profile_slug ?? "");
                  setEditingSlug(true);
                }}
                disabled={pending}
              >
                Rename
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {notice ? (
        <p role="status" className="text-xs text-primary">
          {notice}
        </p>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm"
        >
          <p>{error}</p>
          {reacceptHref ? (
            <Link
              href={reacceptHref}
              className="inline-block rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1 text-xs hover:bg-destructive/10"
            >
              Review &amp; accept →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 rounded border-input accent-[hsl(var(--primary))]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
