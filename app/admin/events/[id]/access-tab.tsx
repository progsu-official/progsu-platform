"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inviteMember, revokeInvite } from "@/lib/actions/events";

import type { EventRecord } from "./types";

type InviteRow = {
  user_id: string;
  invited_by: string | null;
  invited_at: string;
  revoked_at: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

export function AccessTab({
  event,
  invites,
}: {
  event: EventRecord;
  invites: InviteRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const id = userId.trim();
    if (!id) {
      setError("Paste a user id.");
      return;
    }
    startTransition(async () => {
      const r = await inviteMember(event.id, id);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setUserId("");
      router.refresh();
    });
  }

  function onRevoke(targetUserId: string) {
    setError(null);
    startTransition(async () => {
      const r = await revokeInvite(event.id, targetUserId);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      router.refresh();
    });
  }

  const active = invites.filter((i) => !i.revoked_at);
  const revoked = invites.filter((i) => i.revoked_at);

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-3 text-sm">
        <p className="font-medium">
          Visibility: {event.visibility === "members" ? "All members" : "Private invite"}
        </p>
        {event.visibility === "members" ? (
          <p className="text-xs text-muted-foreground">
            Any fully-onboarded member can see and RSVP to this event. Invites
            below are not required — they just pre-list members.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Only users with an active invite can view or RSVP. Revoke to remove
            access immediately.
          </p>
        )}
      </div>

      <form
        onSubmit={onInvite}
        className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/10 p-3 text-sm"
      >
        <div className="flex-1 min-w-64 space-y-1">
          <label className="text-xs text-muted-foreground">
            Invite by user id
          </label>
          <Input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            disabled={pending}
          />
          {/* TODO: add invite-by-email lookup. For R1 MVP we accept a raw user id. */}
          <p className="text-xs text-muted-foreground">
            TODO: email lookup. Paste the user id from /admin/members for now.
          </p>
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "…" : "Invite"}
        </Button>
      </form>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
          Active invites ({active.length})
        </h3>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active invites.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Invited</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {active.map((i) => (
                  <tr key={i.user_id}>
                    <td className="px-3 py-2">
                      {i.first_name || i.last_name
                        ? `${i.first_name ?? ""} ${i.last_name ?? ""}`.trim()
                        : i.user_id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {i.email ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(i.invited_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onRevoke(i.user_id)}
                        disabled={pending}
                      >
                        Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {revoked.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
            Revoked ({revoked.length})
          </h3>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {revoked.map((i) => (
              <li key={`rev-${i.user_id}`}>
                {i.first_name ?? i.user_id.slice(0, 8)} — revoked{" "}
                {i.revoked_at
                  ? new Date(i.revoked_at).toLocaleString()
                  : "—"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
