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
        </div>
        <div className="foot-note">we&apos;re in beta, expect fresh paint</div>
      </div>
    </footer>
  );
}
