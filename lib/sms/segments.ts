// SMS segment counting for the composer. Carriers bill per segment, and one
// character outside GSM-7 (an emoji, most accented capitals) switches the
// whole message to UCS-2 and cuts each segment from 160 characters to 70.
// No server-only import: the composer runs this on every keystroke.

const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
);
const GSM_EXTENDED = new Set("^{}\\[~]|€\f");

// The Messaging Service has Smart Encoding on, which rewrites these to their
// GSM lookalikes before sending. Counting them as UCS-2 would overstate cost
// for every message pasted from a notes app.
const SMART_ENCODED: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "…": "...",
  " ": " ",
};

export type SmsSegmentInfo = {
  encoding: "GSM-7" | "UCS-2";
  segments: number;
  // Characters that forced UCS-2, deduplicated, for the composer to point at.
  unicodeChars: string[];
};

export function smsSegments(body: string): SmsSegmentInfo {
  const normalized = Array.from(body)
    .map((ch) => SMART_ENCODED[ch] ?? ch)
    .join("");

  let septets = 0;
  const unicode = new Set<string>();
  for (const ch of normalized) {
    if (GSM_BASIC.has(ch)) septets += 1;
    else if (GSM_EXTENDED.has(ch)) septets += 2;
    else unicode.add(ch);
  }

  if (unicode.size === 0) {
    return {
      encoding: "GSM-7",
      segments: septets === 0 ? 0 : septets <= 160 ? 1 : Math.ceil(septets / 153),
      unicodeChars: [],
    };
  }

  const units = normalized.length;
  return {
    encoding: "UCS-2",
    segments: units === 0 ? 0 : units <= 70 ? 1 : Math.ceil(units / 67),
    unicodeChars: [...unicode],
  };
}
