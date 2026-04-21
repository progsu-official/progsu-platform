// RFC 4180 CSV escaping. Quotes around any field containing comma, quote, CR, LF,
// or a leading/trailing space. Double embedded quotes.
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvEscape).join(",");
}
