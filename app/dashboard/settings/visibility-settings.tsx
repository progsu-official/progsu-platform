"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/browser";
import { setProfileSlug, setProfileVisibility } from "@/lib/actions/members";

const DISCORD_LINK_ERRORS: Record<string, string> = {
  missing_code: "Discord didn't return a code. Please try again.",
  exchange_failed: "Couldn't verify that Discord connection. Please try again.",
  identity_missing: "Discord connected, but we couldn't read your account. Try again.",
  access_denied: "You cancelled connecting Discord.",
};

type Props = {
  initial: {
    discoverable: boolean;
    share_attended_events: boolean;
    share_shared_event_counts: boolean;
    profile_slug: string | null;
    discord_username: string | null;
    discord_user_id: string | null;
  };
  siteUrl: string;
  sharedEventsEnabled: boolean;
};

export function VisibilitySettings({
  initial,
  siteUrl,
  sharedEventsEnabled,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState(initial);
  const [slugDraft, setSlugDraft] = useState(initial.profile_slug ?? "");
  const [editingSlug, setEditingSlug] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const code = searchParams.get("discord_error");
    return code ? DISCORD_LINK_ERRORS[code] ?? "Couldn't connect Discord. Please try again." : null;
  });
  const [discordConnected, setDiscordConnected] = useState(
    () => searchParams.get("discord_connected") === "1"
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [reacceptHref, setReacceptHref] = useState<string | null>(null);

  function connectDiscord() {
    const supabase = createClient();
    const redirectTo = new URL(
      "/auth/discord/callback",
      window.location.origin
    ).toString();
    startTransition(async () => {
      const { error: linkErr } = await supabase.auth.linkIdentity({
        provider: "discord",
        options: { redirectTo },
      });
      if (linkErr) setError(linkErr.message);
      // On success Supabase redirects the browser to Discord; no further work here.
    });
  }

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
        description="When on, members can visit your profile and see your name, school, class standing, graduation term, and interested roles. If you add a Discord username below, it also becomes visible to them so they can reach you there."
        checked={state.discoverable}
        onChange={(v) => updateToggle("discoverable", v)}
        disabled={pending}
      />

      <div className="space-y-2 rounded-md border p-3">
        <Label className="text-xs">Discord (optional)</Label>
        <p className="text-xs text-muted-foreground">
          Connect your real Discord account so other members can find and
          message you there when visibility is on. Progsu doesn&apos;t
          message anyone for you.
        </p>
        {state.discord_user_id ? (
          <p className="text-sm">
            Connected as <span className="font-medium">{state.discord_username ?? state.discord_user_id}</span>
          </p>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={connectDiscord}
            disabled={pending || !state.discoverable}
          >
            Connect Discord
          </Button>
        )}
      </div>

      <Toggle
        label="Show events I've attended on my profile"
        description="Only public, non-sensitive events with enough attendees appear. Private-invite events are never shown."
        checked={state.share_attended_events}
        onChange={(v) => updateToggle("share_attended_events", v)}
        disabled={pending || !state.discoverable}
      />

      {sharedEventsEnabled ? (
        <Toggle
          label="Show shared event history to other members who opt in"
          description="When another member and I both turn this on, we can each see the names of events we both attended — only for public, non-sensitive events. Private-invite events are never shown."
          checked={state.share_shared_event_counts}
          onChange={(v) => updateToggle("share_shared_event_counts", v)}
          disabled={pending || !state.discoverable}
        />
      ) : null}

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

      {discordConnected ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-md border border-green-600/30 bg-green-600/10 p-3 text-sm text-green-700 dark:text-green-400"
        >
          <p>Discord connected.</p>
          <button
            type="button"
            onClick={() => setDiscordConnected(false)}
            className="text-xs underline"
          >
            Dismiss
          </button>
        </div>
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
        aria-label={label}
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
