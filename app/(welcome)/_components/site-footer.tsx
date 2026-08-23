import Link from "next/link";

export function SiteFooter({
  showEvents,
  showMembers,
}: {
  showEvents: boolean;
  showMembers: boolean;
}) {
  return (
    <footer>
      <div className="wrap foot-inner">
        <div className="brand">
          progsu <span className="beta">beta</span>
        </div>
        <div className="foot-links">
          {showEvents ? <Link href="/events">events</Link> : null}
          {showMembers ? <Link href="/members">members</Link> : null}
          <Link href="/privacy">privacy</Link>
          {/* Local-only Google OAuth bypass, carried over from the previous
              landing page. /api/dev-login self-gates on NODE_ENV; plain anchors
              because the target is a route handler, not a page. */}
          {process.env.NODE_ENV !== "production" ? (
            <>
              <a href="/api/dev-login?role=member">dev bypass: member</a>
              <a href="/api/dev-login?role=admin">dev bypass: admin</a>
            </>
          ) : null}
        </div>
        <div className="foot-note">we&apos;re in beta, expect fresh paint</div>
      </div>
    </footer>
  );
}
