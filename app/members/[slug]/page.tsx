import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import {
  getMemberCardBySlug,
  getSharedEventsForViewer,
} from "@/lib/actions/members";
import { Avatar } from "@/app/_components/avatar";

export const dynamic = "force-dynamic";

// Explicitly no OG/Twitter meta generation: cards are authenticated-only, so
// link previews in chat apps shouldn't try to fetch the page anonymously.
export const metadata = {
  title: "Member · Progsu",
  robots: { index: false, follow: false },
};

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const result = await getMemberCardBySlug(slug);
  if (!result.ok) {
    // Either unauthenticated (shouldn't reach here — middleware bounces) or
    // an internal error. Surface a neutral 404 so we don't leak slug existence.
    notFound();
  }
  if (!result.data) notFound();

  const { card, attendedEvents } = result.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isSelf = user?.id === card.user_id;

  // Shared-events section: only when flag is on AND viewing a peer (not self).
  // Action wrapper handles the flag; this is a belt-and-suspenders check so we
  // also skip the RPC round-trip on self-views.
  const sharedEvents =
    env.FEATURE_SHARED_EVENT_HISTORY && user?.id && !isSelf
      ? await getSharedEventsForViewer(card.user_id).then((r) =>
          r.ok ? r.data : null
        )
      : null;

  const gradLabel =
    card.grad_term && card.grad_year
      ? `${card.grad_term}`
      : card.grad_year
        ? `Class of ${card.grad_year}`
        : null;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <nav>
        <Link
          href="/members"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={15} aria-hidden />
          All members
        </Link>
      </nav>

      {isSelf ? (
        <div className="rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm">
          <p className="font-medium">This is your public card.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Other members see what&apos;s shown here when your directory
            visibility is on.{" "}
            <Link
              href="/dashboard/settings#visibility"
              className="underline underline-offset-4"
            >
              Manage visibility
            </Link>
            .
          </p>
        </div>
      ) : null}

      <header className="flex items-center gap-5">
        <Avatar
          src={card.avatar_url}
          name={card.display_name ?? "?"}
          className="h-20 w-20 shrink-0 rounded-full shadow-lg shadow-black/30"
          textClassName="text-xl"
        />
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-bold tracking-tight">
            {card.display_name ?? "Member"}
          </h1>
          {card.school ? (
            <p className="truncate text-sm text-muted-foreground">
              {card.school}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
            {card.class_standing ? (
              <span className="rounded-full border border-border/70 px-2 py-0.5 capitalize">
                {card.class_standing}
              </span>
            ) : null}
            {gradLabel ? (
              <span className="rounded-full border border-border/70 px-2 py-0.5">
                {gradLabel}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-border/70 bg-card p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Interested in
        </h2>
        {card.interested_roles && card.interested_roles.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {card.interested_roles.map((role) => (
              <li
                key={role}
                className="rounded-full border border-border/70 bg-muted/40 px-3 py-1 text-xs capitalize"
              >
                {role.replaceAll("_", " ")}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing listed yet.
          </p>
        )}
      </section>

      {card.discord_user_id || card.discord_username ? (
        <section className="rounded-2xl border border-border/70 bg-card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Discord
          </h2>
          <p className="mt-3 text-sm">
            {card.discord_user_id ? (
              <a
                href={`https://discord.com/users/${card.discord_user_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-primary"
              >
                {card.discord_username ?? "Open Discord profile"}
              </a>
            ) : (
              card.discord_username
            )}
            <span className="ml-2 text-xs text-muted-foreground">
              {card.discord_user_id
                ? "(opens if you share a server with them)"
                : "(find them in the Progsu Discord server)"}
            </span>
          </p>
        </section>
      ) : null}

      {card.share_attended_events ? (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Events attended
          </h2>
          {attendedEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No attended events to show.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-2xl border border-border/70 bg-card">
              {attendedEvents.map((ev) => (
                <li
                  key={ev.event_id}
                  className="flex items-center justify-between gap-4 px-5 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {ev.event_title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(ev.starts_at).toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {sharedEvents && sharedEvents.aggregate_count > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Shared events with you
          </h2>
          {sharedEvents.named_events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You and {card.display_name ?? "this member"} have attended{" "}
              {sharedEvents.aggregate_count} shared{" "}
              {sharedEvents.aggregate_count === 1 ? "event" : "events"}.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-border/60 rounded-2xl border border-border/70 bg-card">
                {sharedEvents.named_events.map((ev) => (
                  <li
                    key={ev.event_id}
                    className="flex items-center justify-between gap-4 px-5 py-3.5"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/events/${ev.event_slug}`}
                        className="truncate text-sm font-medium hover:text-primary"
                      >
                        {ev.event_title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {new Date(ev.starts_at).toLocaleDateString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              {sharedEvents.named_events.length < sharedEvents.aggregate_count ? (
                <p className="text-xs text-muted-foreground">
                  Plus{" "}
                  {sharedEvents.aggregate_count -
                    sharedEvents.named_events.length}{" "}
                  more shared{" "}
                  {sharedEvents.aggregate_count -
                    sharedEvents.named_events.length ===
                  1
                    ? "event"
                    : "events"}{" "}
                  that aren&apos;t shown here.
                </p>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
