import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getMemberCardBySlug } from "@/lib/actions/members";

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

  const gradLabel =
    card.grad_term && card.grad_year
      ? `${card.grad_term}`
      : card.grad_year
        ? `Class of ${card.grad_year}`
        : null;

  return (
    <div className="space-y-6">
      <nav className="text-xs text-muted-foreground">
        <Link href="/members" className="hover:underline">
          ← All members
        </Link>
      </nav>

      {isSelf ? (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          <p className="font-medium">This is your public card.</p>
          <p className="text-xs text-muted-foreground">
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

      <header className="flex items-center gap-4">
        {card.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.avatar_url}
            alt=""
            className="h-16 w-16 rounded-full border object-cover"
          />
        ) : (
          <div className="h-16 w-16 rounded-full border bg-muted" />
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {card.display_name ?? "Member"}
          </h1>
          {card.school ? (
            <p className="truncate text-sm text-muted-foreground">
              {card.school}
            </p>
          ) : null}
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <InfoCard
          title="Class standing"
          value={card.class_standing ? capitalize(card.class_standing) : "—"}
        />
        <InfoCard title="Graduation" value={gradLabel ?? "—"} />
        <div className="sm:col-span-2">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
            Interested in
          </h3>
          {card.interested_roles && card.interested_roles.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {card.interested_roles.map((role) => (
                <li
                  key={role}
                  className="rounded-full border px-3 py-1 text-xs capitalize"
                >
                  {role.replaceAll("_", " ")}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">—</p>
          )}
        </div>
      </section>

      {card.share_attended_events ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Events attended</h2>
          {attendedEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No attended events to show.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {attendedEvents.map((ev) => (
                <li key={ev.event_id} className="flex items-center justify-between gap-4 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{ev.event_title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(ev.starts_at).toLocaleDateString()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function InfoCard({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
