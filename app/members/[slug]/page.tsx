import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Globe } from "lucide-react";

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
          {card.bio ? (
            <p className="mt-1 truncate text-sm">{card.bio}</p>
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
          {card.linkedin_url || card.github_url || card.portfolio_url ? (
            <div className="mt-2 flex items-center gap-3 text-muted-foreground">
              {card.linkedin_url ? (
                <a
                  href={card.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="LinkedIn"
                  title={linkPreview(card.linkedin_url)}
                  className="transition-colors hover:text-primary"
                >
                  <LinkedInIcon className="h-[18px] w-[18px]" />
                </a>
              ) : null}
              {card.github_url ? (
                <a
                  href={card.github_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="GitHub"
                  title={linkPreview(card.github_url)}
                  className="transition-colors hover:text-primary"
                >
                  <GitHubIcon className="h-[18px] w-[18px]" />
                </a>
              ) : null}
              {card.portfolio_url ? (
                <a
                  href={card.portfolio_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Portfolio"
                  title={linkPreview(card.portfolio_url)}
                  className="transition-colors hover:text-primary"
                >
                  <Globe size={18} />
                </a>
              ) : null}
            </div>
          ) : null}
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

// Strips scheme + trailing slash for a compact hover-tooltip preview, e.g.
// "linkedin.com/in/devmember" instead of the full https:// URL.
function linkPreview(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

// lucide-react dropped brand/logo icons; these are the standard Simple Icons
// brand paths, inlined rather than pulling in a whole icon package for two marks.
function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}
