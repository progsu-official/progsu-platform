type Row = {
  id: string;
  action: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  metadata: unknown;
  created_at: string;
};

export function ActivityTab({
  rows,
  error,
}: {
  rows: Row[];
  error: string | null;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground">
        Activity (latest 50)
      </h2>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No activity for this event yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Target</th>
                <th className="px-3 py-2 font-medium">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.actor_user_id?.slice(0, 8) ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.target_user_id?.slice(0, 8) ?? "—"}
                  </td>
                  <td className="max-w-lg truncate px-3 py-2 font-mono text-xs">
                    {safeJson(r.metadata)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function safeJson(m: unknown): string {
  try {
    return JSON.stringify(m);
  } catch {
    return String(m);
  }
}
