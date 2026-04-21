import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const supabase = await createClient();
  const { data: domains } = await supabase
    .from("school_domains")
    .select("domain, school_name, school_slug, is_active")
    .order("domain");

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Currently read-only. School domain CRUD ships in a later task.
        </p>
      </header>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">School domains</h2>
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Domain</th>
                <th className="px-3 py-2 font-medium">School</th>
                <th className="px-3 py-2 font-medium">Slug</th>
                <th className="px-3 py-2 font-medium">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(domains ?? []).map((d) => (
                <tr key={d.domain}>
                  <td className="px-3 py-2 font-mono text-xs">{d.domain}</td>
                  <td className="px-3 py-2">{d.school_name}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {d.school_slug}
                  </td>
                  <td className="px-3 py-2">
                    {d.is_active ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        Active
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
