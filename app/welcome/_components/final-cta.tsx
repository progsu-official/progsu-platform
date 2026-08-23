import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function FinalCta({ showEvents }: { showEvents: boolean }) {
  if (!showEvents) return null;

  return (
    <section className="final wrap">
      <div className="final-box">
        <span className="eyebrow">only takes a few seconds</span>
        <h2>our next event is worth showing up for.</h2>
        <p>join the gsu builders already on progsu.</p>
        <Link href="/events" className="btn-google">
          go to events
          <ArrowRight size={16} strokeWidth={1.75} aria-hidden />
        </Link>
      </div>
    </section>
  );
}
