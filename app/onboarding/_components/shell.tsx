import Link from "next/link";
import type { MouseEventHandler, ReactNode } from "react";

import { cn } from "@/lib/utils";

// Shared shell for the onboarding funnel, porting folk's onboarding-shell
// grammar onto progsu tokens (light theme, violet primary). Every component
// here is a pure server-compatible component — no hooks, no state — so both
// server pages and client forms can import from this module. The seam hook
// lives in ./seam.tsx (client) and is re-exported below for one import
// surface.
export { OnbSeam, useOnbSeam } from "./seam";
export type { OnbSeamDir, OnbSeamState } from "./seam";

/* ── backdrop ────────────────────────────────────────────────────── */

// Quiet radial wash behind everything. folk's cream washes swapped for the
// progsu violet at low opacity plus one faint neutral, over bg-background.
export function OnbBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      <div
        className="absolute inset-0"
        style={{
          background: [
            "radial-gradient(circle min(95vw, 900px) at 50% -12%, hsl(var(--primary) / 0.10) 0%, transparent 70%)",
            "radial-gradient(circle min(95vw, 900px) at 50% 112%, hsl(var(--primary) / 0.06) 0%, transparent 72%)",
            "radial-gradient(circle min(80vw, 760px) at 82% 46%, hsl(var(--muted-foreground) / 0.07) 0%, transparent 76%)",
          ].join(", "),
        }}
      />
    </div>
  );
}

/* ── layout primitives ───────────────────────────────────────────── */

// Section wrapper: every step anchors content at the same top offset and
// reserves the same bottom space (clearance for the fixed action bar on
// mobile). This is the step's scroll container. `fill` makes a step occupy
// exactly one viewport with no scroll on desktop: it drops the tall 22vh top
// offset and switches to overflow-hidden; mobile keeps overflow-y-auto as a
// safety net for keyboard-shrunk viewports.
//
// `sm:pb-*` lives in BOTH branches (never the base) so the two padding-bottom
// values can't coexist on one element — Tailwind emits them in file order
// regardless of class-list order.
export function OnbSection({
  children,
  fill = false,
}: {
  children: ReactNode;
  fill?: boolean;
}) {
  return (
    <section
      className={cn(
        "relative z-10 flex h-full w-full items-start overflow-y-auto px-5 pb-[calc(9rem+env(safe-area-inset-bottom,0px))] pt-28 sm:px-8 lg:px-12",
        fill ? "sm:overflow-hidden sm:pb-10 sm:pt-20" : "sm:pb-16 sm:pt-[22vh]",
      )}
      style={{ overscrollBehavior: "contain" }}
    >
      <div className="mx-auto w-full max-w-[38rem]">{children}</div>
    </section>
  );
}

// Staggered-reveal wrapper (.onboarding-reveal in ../onboarding.css): direct
// children fade/rise in sequence. Keep the fixed OnbActionBar a SIBLING of
// this wrapper, never a child — the reveal animates transform/filter, which
// would re-anchor a position:fixed descendant.
export function OnbSurface({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("onboarding-reveal", className)}>{children}</div>;
}

// Title + body block shared by every step. Reserved body min-height keeps the
// content below from jumping between steps, while copy that wraps an extra
// line on a narrow phone pushes the layout down instead of colliding.
export function OnbIntro({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="text-center">
      {/* Bold sans, not the serif: the display serif set onboarding apart
          from every other surface — the member pages' voice is bold
          tracking-tight sans, and the funnel should read as the same app. */}
      <h1
        className="text-balance font-bold tracking-tight text-foreground"
        style={{ fontSize: "clamp(24px, 3vw, 32px)", lineHeight: 1.15 }}
      >
        {title}
      </h1>
      <p className="mx-auto mt-2.5 min-h-[42px] max-w-md text-pretty text-[14px] leading-[1.55] text-muted-foreground md:min-h-[21px]">
        {children}
      </p>
    </div>
  );
}

// Bottom action row. Fixed on mobile (thumb reach) with a gradient fade above
// it and safe-area padding; in-flow on desktop directly under the content.
// Same wrapper shape on every page so the button row reads at one consistent
// position regardless of step.
export function OnbActionBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 bg-background pb-[max(env(safe-area-inset-bottom),20px)] pt-4 sm:static sm:mt-10 sm:bg-transparent sm:pb-0 sm:pt-0",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-full h-20 bg-gradient-to-t from-background to-transparent sm:hidden"
      />
      <div className="mx-auto flex w-full max-w-[38rem] items-center justify-center px-5 sm:px-0">
        {children}
      </div>
    </div>
  );
}

/* ── rows ────────────────────────────────────────────────────────── */

// List row: 64px icon column + title/body + right-aligned action. On mobile
// the action drops to a full-width row under the text.
export function OnbRow({
  icon,
  title,
  body,
  action,
  disabled = false,
}: {
  icon?: ReactNode;
  title: string;
  body: ReactNode;
  action?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid min-h-[122px] w-full items-center gap-x-4 gap-y-3 py-3 text-left md:flex md:h-[84px] md:min-h-0 md:gap-5 md:py-0",
        icon ? "grid-cols-[64px_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)]",
        disabled && "opacity-50",
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className="text-[16px] font-medium tracking-tight text-foreground">
          {title}
        </div>
        <div className="mt-1 text-[13.5px] leading-[1.45] text-muted-foreground">
          {body}
        </div>
      </div>
      {action ? (
        <div className="col-span-full flex flex-shrink-0 items-center gap-2 md:col-auto">
          {action}
        </div>
      ) : null}
    </div>
  );
}

// Square plate for OnbRow icons — sized to sit inside the 64px grid column.
export function OnbIconPlate({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center overflow-hidden rounded-[13px] border border-border bg-muted/50 text-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

// Gradient hairline between rows.
export function OnbRowDivider() {
  return (
    <div
      aria-hidden
      className="h-px bg-gradient-to-r from-transparent via-foreground/[0.12] to-transparent"
    />
  );
}

/* ── field chrome ────────────────────────────────────────────────── */

// Soft card behind a step's controls — one tint and padding everywhere so the
// profile grid and the OTP panel read as the same surface.
export const onbPanelClasses = "rounded-[18px] bg-foreground/[0.03] p-5";

// One focus treatment for onboarding text controls: the violet ring the
// profile step's inputs use.
export const onbInputFocusClasses =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// Inline error surface shared by every step's forms.
export function OnbErrorBox({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-[14px] border border-destructive/25 bg-destructive/[0.06] px-4 py-3 text-sm text-destructive",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ── buttons ─────────────────────────────────────────────────────── */

type OnbButtonSize = "row" | "cta";

type OnbButtonCommonProps = {
  children: ReactNode;
  className?: string;
  // "cta" (default) = the main Continue: h-12, full width capped at 24rem.
  // "row" = compact h-11 for row actions and secondary placements.
  size?: OnbButtonSize;
};

type OnbButtonAsButtonProps = OnbButtonCommonProps & {
  href?: undefined;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  // Shows a spinner and disables the control. Primary only.
  loading?: boolean;
  form?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  "aria-label"?: string;
};

type OnbButtonAsLinkProps = OnbButtonCommonProps & {
  // Renders a next/link styled as the button.
  href: string;
  prefetch?: boolean;
  "aria-label"?: string;
};

export type OnbButtonProps = OnbButtonAsButtonProps | OnbButtonAsLinkProps;

const buttonFocus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const buttonSize: Record<OnbButtonSize, string> = {
  row: "h-11 px-5 text-[14px]",
  cta: "h-12 w-full max-w-[24rem] px-6 text-[15px]",
};

// folk's premium-cta recipe on progsu tokens: violet pill that lifts 2px on
// hover with a deeper shadow, settles back on press.
const primaryClasses =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[hsl(var(--primary))] font-medium leading-none text-primary-foreground shadow-[0_8px_20px_-10px_hsl(var(--primary)/0.55)] transition-[transform,box-shadow,opacity] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_28px_-10px_hsl(var(--primary)/0.6)] active:translate-y-0 active:shadow-[0_8px_20px_-10px_hsl(var(--primary)/0.55)] disabled:pointer-events-none disabled:opacity-60 motion-reduce:transition-none motion-reduce:hover:translate-y-0";

const secondaryClasses =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full border border-border bg-card font-medium leading-none text-foreground transition-colors duration-200 hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-60 motion-reduce:transition-none";

function Spinner() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      className="h-4 w-4 animate-spin motion-reduce:animate-none"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="3"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function OnbPrimaryButton(props: OnbButtonProps) {
  const { children, className, size = "cta" } = props;
  const classes = cn(primaryClasses, buttonSize[size], buttonFocus, className);
  if (props.href !== undefined) {
    return (
      <Link
        href={props.href}
        prefetch={props.prefetch}
        aria-label={props["aria-label"]}
        className={classes}
      >
        {children}
      </Link>
    );
  }
  const { type = "button", disabled, loading, form, onClick } = props;
  return (
    <button
      type={type}
      form={form}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={props["aria-label"]}
      className={classes}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function OnbSecondaryButton(props: OnbButtonProps) {
  const { children, className, size = "row" } = props;
  const classes = cn(
    secondaryClasses,
    buttonSize[size],
    buttonFocus,
    className,
  );
  if (props.href !== undefined) {
    return (
      <Link
        href={props.href}
        prefetch={props.prefetch}
        aria-label={props["aria-label"]}
        className={classes}
      >
        {children}
      </Link>
    );
  }
  const { type = "button", disabled, loading, form, onClick } = props;
  return (
    <button
      type={type}
      form={form}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={props["aria-label"]}
      className={classes}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
