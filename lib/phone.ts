// US phone handling, shared by every surface that asks for a number.
//
// The old validation was a shape check — `^\+?[0-9\-\(\) ]{7,20}$` — which
// accepted twenty digits, seven digits, and strings of nothing but brackets
// and dashes. Everything downstream is NANP anyway: normalize_phone_e164() in
// the database returns NULL for anything that is not ten digits (or eleven
// starting with 1), so a number that passed the form and failed there simply
// never matched the guest-RSVP collision check, silently.
//
// This module is the single definition of what we accept, so the form, the
// zod schema, and the database agree.

// Everything the user typed, digits only.
export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

// Ten digits, or eleven led by the US country code.
export function isValidUsPhone(value: string): boolean {
  const d = phoneDigits(value);
  if (d.length === 11) return d.startsWith("1") && /^[2-9]/.test(d.slice(1));
  return d.length === 10 && /^[2-9]/.test(d);
}

// Progressive mask: formats as far as the digits go and no further, so the
// field reads correctly while it is still being typed rather than only once
// it is complete.
export function formatUsPhone(value: string): string {
  let d = phoneDigits(value);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  d = d.slice(0, 10);

  if (d.length === 0) return "";
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export const US_PHONE_ERROR = "Enter a 10-digit US phone number";
