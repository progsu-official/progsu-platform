import { cn } from "@/lib/utils";

// One heading treatment for every step. Each screen used to size its own
// title, which is how the funnel ended up with a 24px page title on a screen
// that has exactly one job.
//
// The serif is the display moment: onboarding is the first thing a member
// sees, and it should not read as a settings form.
export function StepHeader({
  title,
  description,
  className,
}: {
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <header className={cn("space-y-2", className)}>
      <h1 className="font-serif text-4xl leading-[1.1] tracking-[-0.02em] text-foreground sm:text-5xl">
        {title}
      </h1>
      {/* text-pretty, not text-balance: balancing a two-line paragraph
          produces a stunted second line. Capped measure so the copy doesn't
          run the full width of the display type above it. */}
      {description ? (
        <p className="max-w-[34rem] text-pretty text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
    </header>
  );
}
