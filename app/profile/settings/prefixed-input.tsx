"use client";

// Link fields that ask for a handle, not a URL.
//
// The database still stores full URLs (and the zod schema still requires them),
// so these helpers convert at the edges: parse a handle out of whatever is on
// the profile for display, rebuild a canonical URL on save. That keeps the
// stored shape unchanged while the member only ever types "joeyzhang".
//
// Parsing is forgiving on purpose — people paste the whole address out of the
// browser bar, and silently accepting that is cheaper than an error message.

const LINKEDIN_HOST = /^([a-z0-9-]+\.)*linkedin\.com\//i;
const GITHUB_HOST = /^([a-z0-9-]+\.)*github\.com\//i;

function stripScheme(value: string) {
  return value.trim().replace(/^https?:\/\//i, "");
}

// Only unwrap when the text actually looks like a URL, so typing a handle that
// happens to contain "in/" isn't mangled mid-keystroke.
function looksLikeUrl(value: string, host: string) {
  return /:\/\//.test(value) || value.toLowerCase().includes(host);
}

export function linkedinHandleFrom(value: string): string {
  if (!value) return "";
  if (!looksLikeUrl(value, "linkedin.com")) return value.replace(/^\/+/, "");
  const rest = stripScheme(value).replace(LINKEDIN_HOST, "");
  return rest.replace(/^in\//i, "").replace(/[/?#].*$/, "");
}

export function linkedinUrlFrom(handle: string): string {
  const h = handle.trim().replace(/^\/+|\/+$/g, "");
  return h ? `https://www.linkedin.com/in/${h}` : "";
}

export function githubHandleFrom(value: string): string {
  if (!value) return "";
  if (!looksLikeUrl(value, "github.com")) return value.replace(/^\/+/, "");
  const rest = stripScheme(value).replace(GITHUB_HOST, "");
  return rest.replace(/[/?#].*$/, "");
}

export function githubUrlFrom(handle: string): string {
  const h = handle.trim().replace(/^\/+|\/+$/g, "");
  return h ? `https://github.com/${h}` : "";
}

export function siteHostFrom(value: string): string {
  return value ? stripScheme(value).replace(/\/+$/, "") : "";
}

export function siteUrlFrom(host: string): string {
  const h = host.trim().replace(/^\/+|\/+$/g, "");
  return h ? `https://${h}` : "";
}

export function PrefixedInput({
  id,
  prefix,
  icon,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  id: string;
  prefix: string;
  icon?: React.ReactNode;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex h-10 w-full overflow-hidden rounded-md border border-input bg-background transition-colors focus-within:ring-2 focus-within:ring-ring">
      <span
        aria-hidden
        className="flex shrink-0 items-center gap-1.5 border-r border-input bg-muted/60 px-2.5 text-xs text-muted-foreground"
      >
        {icon}
        {/* The host is the least important thing on the row once the logo is
            there, so it's the first thing to go when space is tight. */}
        <span className="hidden sm:inline">{prefix}</span>
      </span>
      <input
        id={id}
        type="text"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent px-3 text-sm focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}
