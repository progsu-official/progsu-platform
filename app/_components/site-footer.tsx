import {
  DiscordMark,
  GitHubMark,
  InstagramMark,
  LinkedInMark,
} from "@/app/_components/brand-marks";
import { readTheme } from "@/lib/theme";

// Mirrors wiki.progsu.com's footer (SocialRow.astro + Footer.astro) for the
// icon row and "built by progsu" copy; the trailing link points at Discord
// (GitHub's already covered by its own icon above) instead of the wiki's
// "open on github". No plum/gradient background of its own — it paints
// `bg-background`/`text-foreground` itself
// instead. It lives in the root layout, outside every route's own
// <ThemeShell> (theme-shell.tsx), which is the only other place that applies
// the `.dark` class — without reading the cookie here too, this always
// rendered in the untouched light-mode tokens, a plain white box under
// whatever dark page sat above it.
const SOCIAL_LINKS = [
  { href: "https://discord.com/invite/GjyeW2Mh6q", label: "Discord", Mark: DiscordMark },
  {
    href: "https://www.instagram.com/progsuhq?igsh=cWQ5OTR3ZjBiMTdw",
    label: "Instagram",
    Mark: InstagramMark,
  },
  { href: "https://linkedin.com/company/progsu", label: "LinkedIn", Mark: LinkedInMark },
  { href: "https://github.com/progsu-official", label: "GitHub", Mark: GitHubMark },
] as const;

export async function SiteFooter() {
  const theme = await readTheme();
  return (
    <footer
      className={`${theme === "dark" ? "dark " : ""}bg-background text-foreground`}
    >
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-4 py-8 text-center">
        <div className="flex items-center">
          {SOCIAL_LINKS.map(({ href, label, Mark }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className="-mx-1 inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Mark className="h-4 w-4" />
            </a>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} Progsu Platform &middot; built by
          progsu &middot;{" "}
          <a
            href="https://discord.com/invite/GjyeW2Mh6q"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            community hub
          </a>
        </p>
      </div>
    </footer>
  );
}
