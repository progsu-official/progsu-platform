import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type AggregatedRow = {
  domain: string;
  requester_count: number;
  first_requested_at: string;
  last_requested_at: string;
  sample_emails: string[];
  in_allowlist: boolean;
};

async function loadRequests(): Promise<AggregatedRow[]> {
  const admin = createAdminClient();

  const [{ data: rows }, { data: allowlist }] = await Promise.all([
    admin
      .from("domain_requests")
      .select("domain, user_id, example_email, requested_at")
      .order("requested_at", { ascending: false })
      .limit(2000),
    admin
      .from("school_domains")
      .select("domain, is_active")
      .eq("is_active", true),
  ]);

  const allowed = new Set((allowlist ?? []).map((r) => (r.domain as string).toLowerCase()));

  const byDomain = new Map<string, AggregatedRow>();
  for (const r of rows ?? []) {
    const domain = (r.domain as string).toLowerCase();
    const email = r.example_email as string | null;
    const requestedAt = r.requested_at as string;
    const existing = byDomain.get(domain);
    if (existing) {
      existing.requester_count += 1;
      if (requestedAt > existing.last_requested_at)
        existing.last_requested_at = requestedAt;
      if (requestedAt < existing.first_requested_at)
        existing.first_requested_at = requestedAt;
      if (email && existing.sample_emails.length < 3)
        existing.sample_emails.push(email);
    } else {
      byDomain.set(domain, {
        domain,
        requester_count: 1,
        first_requested_at: requestedAt,
        last_requested_at: requestedAt,
        sample_emails: email ? [email] : [],
        in_allowlist: allowed.has(domain),
      });
    }
  }
  return [...byDomain.values()].sort(
    (a, b) => b.requester_count - a.requester_count
  );
}

export default async function AdminDomainRequestsPage() {
  const rows = await loadRequests();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Domain requests
        </h1>
        <p className="text-sm text-muted-foreground">
          Schools members tried to verify that aren&apos;t on our allowlist yet.
          Sorted by requester count so you can see which to add next.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No requests yet.</p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Domain</th>
                <th className="px-3 py-2 font-medium">Requesters</th>
                <th className="px-3 py-2 font-medium">Sample emails</th>
                <th className="px-3 py-2 font-medium">First requested</th>
                <th className="px-3 py-2 font-medium">Last requested</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.domain} className="hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono text-xs">{r.domain}</td>
                  <td className="px-3 py-2">{r.requester_count}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.sample_emails.slice(0, 3).join(", ")}
                    {r.requester_count > 3 ? " …" : ""}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {new Date(r.first_requested_at).toLocaleDateString()}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {new Date(r.last_requested_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.in_allowlist ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        Allowlisted
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                        Pending
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Want to enable one of these? Add it in{" "}
        <a href="/admin/settings" className="underline">
          Admin → Settings
        </a>
        . Once the domain is active you can run{" "}
        <code>select public.clear_pending_domain(&apos;example.edu&apos;);</code>{" "}
        to clear the &quot;coming soon&quot; state on waiting members.
      </p>
    </div>
  );
}
