// Shared settings primitives.
//
// The old page stacked six sections, each with an h2 and an explanatory
// paragraph, on a single scroll. That's where the vertical space went: prose
// nobody rereads after the first visit. These primitives put the label and its
// control on one row (macOS System Settings style) and reserve hint text for
// the rows that genuinely need it.

export function SettingsHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="mb-5">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {description ? (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      ) : null}
    </header>
  );
}

// Grouped rows sharing one border, hairlines between. Cheaper vertically than
// a card per setting, and it reads as one subject.
export function SettingsGroup({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 last:mb-0">
      {title ? (
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
      ) : null}
      <div className="divide-y divide-border/60 overflow-hidden rounded-2xl glass">
        {children}
      </div>
    </section>
  );
}

export function SettingRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <label
          htmlFor={htmlFor}
          className="block text-sm font-medium text-foreground"
        >
          {label}
        </label>
        {hint ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
      <div className="shrink-0 sm:max-w-[55%]">{children}</div>
    </div>
  );
}

// For rows whose control is a whole form or block rather than a single input.
export function SettingBlock({
  title,
  hint,
  children,
}: {
  title?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-4">
      {title ? (
        <p className="text-sm font-medium text-foreground">{title}</p>
      ) : null}
      {hint ? (
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <div className={title || hint ? "mt-3" : ""}>{children}</div>
    </div>
  );
}
