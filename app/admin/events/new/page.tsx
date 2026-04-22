import Link from "next/link";

import { NewEventForm } from "./new-event-form";

export const dynamic = "force-dynamic";

export default function AdminNewEventPage() {
  return (
    <div className="space-y-6">
      <nav className="text-xs text-muted-foreground">
        <Link href="/admin/events" className="hover:underline">
          &larr; All events
        </Link>
      </nav>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Create event</h1>
        <p className="text-sm text-muted-foreground">
          Event starts in draft. Publish it from the detail page once the
          content is ready.
        </p>
      </header>
      <NewEventForm />
    </div>
  );
}
