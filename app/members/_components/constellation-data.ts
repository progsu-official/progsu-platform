import type { MemberCardRow } from "@/lib/actions/members";

// Deliberately not "use client". The server page maps its first page with
// these, and the constellation maps every page it fetches afterwards with the
// same ones. Exported from the "use client" component instead, the server call
// fails at runtime -- a plain function in a client module is a client
// reference, not something a server component may invoke -- and it fails only
// when the route renders, because the types line up either way.
//
// The MemberCardRow import is type-only, so lib/actions/members (and its
// server-only guard) never reaches a bundle from here.

export type ConstellationMember = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  slug: string | null;
  school: string | null;
  classStanding: string | null;
  gradLabel: string | null;
  roles: string[];
  visibleSince: string | null;
  // The profile-card fields. The list RPC already returns the full card row,
  // so the in-canvas card can render bio/note/socials without a second fetch.
  note: string | null;
  bio: string | null;
  bannerUrl: string | null;
  discordUsername: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
};

/** One projection, so a fetched page can't drift from the rendered one. */
export function toConstellationMember(
  card: MemberCardRow,
): ConstellationMember {
  return {
    userId: card.user_id,
    name: card.display_name ?? "Member",
    avatarUrl: card.avatar_url,
    slug: card.profile_slug,
    school: card.school,
    classStanding: card.class_standing,
    gradLabel:
      card.grad_term && card.grad_year
        ? card.grad_term
        : card.grad_year
          ? `Class of ${card.grad_year}`
          : null,
    roles: (card.interested_roles ?? []).slice(0, 3),
    visibleSince: card.visible_since,
    note: card.note,
    bio: card.bio,
    bannerUrl: card.banner_url,
    discordUsername: card.discord_username,
    linkedinUrl: card.linkedin_url,
    githubUrl: card.github_url,
    portfolioUrl: card.portfolio_url,
  };
}

export type Cursor = { ts: string | null; user: string } | null;

/**
 * Cursor for the page after `cards`, or null once the tail is reached.
 * A short page means the source is exhausted -- list_member_cards returns
 * exactly `limit` rows until it runs out.
 */
export function cursorAfter(cards: MemberCardRow[], pageSize: number): Cursor {
  if (cards.length < pageSize) return null;
  const last = cards[cards.length - 1];
  return { ts: last.visible_since, user: last.user_id };
}
