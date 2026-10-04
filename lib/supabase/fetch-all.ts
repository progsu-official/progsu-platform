// PostgREST caps every response at max_rows (1000, supabase/config.toml), and
// a truncated read looks exactly like a complete one. Pages until a short page.
// The caller's query must order on a unique key or rows can repeat or vanish
// between pages.
export async function fetchAll<T>(
  page: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 1000
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) return { data: rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < size) return { data: rows, error: null };
  }
}
