# Progsu, Design Language

> This document encodes the design language already present in the Progsu
> platform. It is not a redesign brief. When code and this document disagree,
> the document describes the *intended* system and the code is the *current*
> state — with one exception: if a surface shipped and looks right, it is
> evidence, and this document should be updated to match it.
>
> Read this before building or reshaping any UI. `CLAUDE.md` owns the
> architecture rules; this file owns everything visual.

---

## 0 · What this product is

An internal CRM and events tool for a student builders community. The people
using it are students checking whether they're on the list for Thursday, and
two or three officers running the org from the admin side. It is not a SaaS
product, it has no marketing surface to live up to, and nobody is being sold
anything.

Design goals:

- **Legible before expressive.** A member should find the answer — when, where,
  am I in — in one glance. Expression lives in the details, not in the layout.
- **Two rooms, one building.** Member surfaces are dark-capable, glassy, and
  soft. Admin is flat, light, and dense. They share tokens and components; they
  do not share atmosphere. This is deliberate: officers are doing work, members
  are checking in.
- **Quiet by default, committed at the peak.** One moment per screen carries
  the weight. Everything else gets out of its way.

What it is explicitly **not**:

- An enterprise dashboard
- A landing page with a login attached
- Glassmorphism as decoration (see §3 — the glass here is a specific effect
  with performance rules, not a texture)

---

## 1 · First principles

1. **The ambient field is the floor.** Member surfaces render
   `.ambient-field` — a fixed, inert, radial violet wash — and every
   translucent surface refracts it. Without it, `.glass` reads as "a slightly
   lighter card" and the whole material collapses. If you build a member
   surface, it renders inside `ThemeShell`, which provides the field. A surface
   that opts out of the field must not use `.glass` either.

2. **Glass has two variants and choosing wrong costs frames.** `.glass` for
   content surfaces (no backdrop filter). `.glass-blur` only for fixed or
   sticky chrome. See §3. This is a performance rule, not a taste rule.

3. **Sentence case everywhere.** "Upcoming events", not "Upcoming Events" and
   not "UPCOMING EVENTS". The one licensed exception is the small uppercase
   eyebrow on card headings (`text-xs font-semibold uppercase tracking-wide
   text-muted-foreground`), which is an established pattern on the Resume and
   Education cards.

4. **Controls name their action.** "Show me in the directory", not "Enable".
   "Create event", not "Submit". Errors name the problem *and* the recovery.

5. **Icons are drawn, never typed.** lucide-react at `strokeWidth={1.75}`.
   A `✓` or `→` character standing in for an icon is a bug — it inherits the
   text font, ignores the stroke system, and renders differently per platform.

6. **Numbers are tabular.** Any figure a user might compare or watch change
   gets `tabular-nums`. Counts, capacities, dates, completion ratios.

7. **Elevation is declared once.** `.glass` already carries an inset hairline,
   a specular top edge, and a drop shadow. Do not add `border` on top of it.
   A 1px border under a soft shadow is the ghost-card look.

8. **Motion is one authored moment.** Not an entrance on every block. The
   easing is `cubic-bezier(0.16, 1, 0.3, 1)` — exponential ease-out, always
   from an already-visible resting state. Every motion respects
   `motion-reduce`.

9. **Peer-visible is a privacy decision, not a layout decision.** Before
   putting a new field on a surface another member can see, read hard rule #8
   in `CLAUDE.md`. Adding a field to `member_cards` is a consent change.

---

## 2 · Tokens

All color lives in `app/globals.css` as HSL triplets and is consumed through
Tailwind's semantic names. **Never write a raw Tailwind palette color**
(`text-red-600`, `bg-slate-100`) on an app surface — it will not follow the
theme. The exceptions already in the codebase are amber and rose used for
status chips, and those are always paired with a `dark:` variant.

### Themes

| Context | Theme |
|---|---|
| Member surfaces (`/profile`, `/events`, `/members`) | Light default, `.dark` applied by `ThemeShell` from the `progsu-theme` cookie |
| Admin (`/admin/*`) | Fixed dark, no toggle — `.dark` is hard-coded on the shell in `app/admin/layout.tsx` |
| Onboarding | Fixed light, folk-style shell (`app/onboarding/onboarding.css` + `_components/shell.tsx`) |
| Login | Fixed dark |
| Event composer (`/admin/events/new`) | Its own themed background, see §7 |

The cookie is read server-side so the first paint is already correct. Never
resolve theme in a client effect — that's a flash on every navigation.

### Text ladder

Use these and only these:

| Class | Role |
|---|---|
| `text-foreground` | Headings, primary body, emphasized values |
| `text-foreground/90` | Secondary line inside a group that is still primary content |
| `text-muted-foreground` | Labels, descriptions, metadata, hints |
| `text-primary` | Links and the one accented word in a sentence |
| `text-destructive` | Error text only |

**Anti-pattern:** `text-foreground/70`, `text-foreground/60`, `text-gray-500`,
`opacity-60` on a text node. If a value off this ladder feels needed, the role
is wrong, not the value.

### Text ladder, dark-composer surfaces

The event composer paints its own dark themed background, so it uses an
explicit white ladder instead of tokens:

| Class | Role |
|---|---|
| `text-white` | Field values, headings, the active choice |
| `text-white/60` | Secondary line under a field value, inactive labels |
| `text-white/45` | Hints, helper copy, disabled affordances |
| `text-white/25` | Placeholder only |

**Anti-pattern:** `text-white/55`, `text-white/70`, `text-white/80`,
`text-white/90`. Four steps is the whole ladder.

### Surface fill ladder, dark-composer

| Class | Role |
|---|---|
| `bg-white/[0.08]` | Resting field or card |
| `bg-white/[0.12]` | Hover |
| `bg-white/[0.16]` | Open / active popover trigger |
| `bg-white/[0.2]` | Pressed pill |

### Radius scale

`--radius` is `0.75rem` (12px) and Tailwind's `rounded-lg` maps to it.

| Radius | Role |
|---|---|
| `rounded-2xl` (16px) | Cards, panels, banners, the standard content surface |
| `rounded-xl` (12px) | Fields, rows inside a card, popover panels |
| `rounded-lg` (10–12px) | Compact controls, small buttons |
| `rounded-full` | Pills, avatars, icon buttons, chips, dots |

**Anti-pattern:** `rounded-3xl` on a content card, `rounded-[14px]`,
`rounded-md` on a large surface. Cards are 16px; pills are for small controls.

### Spacing

Tailwind's 4px scale: `1, 1.5, 2, 3, 4, 5, 6, 8, 10`. Card padding is `p-5`
(content) or `p-4` (dense row). Section gaps are `space-y-6` inside a card and
`space-y-8` between page sections.

**Anti-pattern:** `p-3.5`, `gap-[7px]`, `mt-7`, `mt-9`.

### Hit targets

Anything tappable is at least 44×44 — `h-11 w-11` for icon buttons. Small
visual affordances (a 17px social glyph, a 14px chip) still need a padded
parent that reaches 44. This is already the pattern on the Education card's
edit pencil and the composer's cover buttons.

---

## 3 · The glass system

Three classes in `app/globals.css`, and the difference matters:

| Class | Backdrop filter | Use for |
|---|---|---|
| `.glass` | **No** | Content surfaces: cards in a scrolling grid, panels, banners |
| `.glass-blur` | Yes, `blur(20px) saturate(180%)` | Fixed or sticky chrome only: the member header, modal scrims |
| `.glass-interactive` | — | Add to `.glass` when the surface is clickable; brightens the hairline on hover |

**Why the split:** a backdrop filter forces the GPU to re-sample what's behind
the element on every scroll frame, for every element. On a grid of member
cards that is a dropped-frame machine. `.glass` gets its read from a
translucent fill over the ambient field, a specular top edge, and a hairline —
no resampling.

Both variants are theme-aware by design. Light glass is white-on-light with a
dark hairline; dark glass is a white veil on dark with a light hairline.
Applying one recipe to both themes is what makes most glassmorphism look
grimy in light mode.

**Anti-pattern:** `.glass-blur` on list items. `backdrop-blur-*` utilities
applied ad hoc instead of these classes. `.glass` on a surface that has no
ambient field behind it.

---

## 4 · Typography

### Families

- **Inter** (`--font-inter`, `font-sans`) — everything.
- **Instrument Serif** (`--font-display`, `font-serif`) — the display voice.
  Loaded per-route via `next/font`, currently only on the event composer, so
  the `Georgia` fallback in `tailwind.config.ts` is load-bearing. If you use
  `font-serif` on a new route, load the font on that route.

There is no third family **in the app's own voice**. No monospace as a
"technical" costume — mono is for code and identifiers only.

The one licensed exception is a **branded event poster** (§6). A pinned event
with a campaign of its own paints that campaign's typeface inside its card —
Hacklanta '26 carries Teko, loaded in `app/events/_components/pinned-hero.tsx`
with `preload: false` so the file only ships on a page that renders one. The
face is scoped to a CSS variable used inside that component and nowhere else.
This is not a licence to add a fourth family to the app; it is the app hosting
someone else's artwork.

### Scale

| Size | Role |
|---|---|
| `text-5xl`–`text-6xl` + `font-serif` | The single display moment on a screen (composer event name) |
| `text-4xl font-bold tracking-tight` | Page title (`Members`, `Events`) |
| `text-2xl font-semibold tracking-tight` | Section or dialog title |
| `text-base font-semibold` | Card heading |
| `text-[15px]` | Field value, list row primary |
| `text-sm` | Body, descriptions, most UI copy |
| `text-xs` | Hints, metadata, chip labels |
| `text-[10px]`–`text-[11px]` | Status chip text, date-plate month |

**Anti-pattern:** `text-[13.5px]`, `text-lg` for a page title, more than one
display-scale element on a screen.

### Tracking

`tracking-tight` on `text-2xl` and up. Floor is `-0.03em`; never go past
`-0.04em`. Default tracking everywhere else.

---

## 5 · Motion

| Duration | Role |
|---|---|
| 200ms | Color, opacity, small state flips |
| 300ms | Position and size changes (the nav pill slide) |
| 500ms | Ambient or large-surface transitions (cover hover scale, theme change) |

Easing is `cubic-bezier(0.16, 1, 0.3, 1)` for anything positional. Write it as
an inline `transitionTimingFunction` rather than the arbitrary Tailwind class
`ease-[cubic-bezier(0.16,1,0.3,1)]` — that class trips a Tailwind
ambiguity warning on every build.

Named animations in `tailwind.config.ts`: `fade-up` (0.6s, entrance),
`float` (7s, ambient loop). Both already carry the house easing.

Every transition pairs with `motion-reduce:transition-none`.

**Anti-pattern:** an entrance animation on every section of a page. Transitions
on `all`. Motion that starts from `opacity: 0` on server-rendered content —
if JS is slow the user sees nothing.

---

## 6 · Surface families

Almost all UI should be Card, Grouped rows, or Popover. Invent a fifth and
it is a smell. Branded poster is listed here because it shipped, not because
the shape generalises — it exists to host one pinned campaign per feed.

### Card

`rounded-2xl glass p-5`. Optional `text-xs font-semibold uppercase
tracking-wide text-muted-foreground` eyebrow heading. Used by Education,
Resume, the completion band, event cards.

### Branded poster

The pinned event at the top of `/events`. Full-bleed campaign artwork, edge to
edge, no thumbnail-beside-text row — a pinned event is not "next in line", it
is the thing being pushed, so it skips the day rail entirely.

Two variants, both in `app/events/_components/pinned-hero.tsx`:

- **Branded** — the event's slug has an entry in `BRAND_KITS`, and the card
  paints that campaign's own background, wordmark, stickers, typeface and
  palette. This is the only place raw hex colors are correct on an app
  surface: the poster is fixed dark in **both** app themes by design, so
  theme tokens would actively break it. Keep the values traceable to the
  campaign's design kit and keep them in the constants at the top of the file.
- **Cover** — everything else. The event's own cover image full-bleed under an
  ink scrim, with the app's normal type voice. No kit needed, so a newly
  pinned event looks deliberate on day one.

Adding a campaign is one `BRAND_KITS` entry plus its assets under
`public/<campaign>/`. It is not a new component and it is not a migration.

### Grouped rows

One `rounded-xl` wrapper, rows inside separated by `border-b border-white/10`
(or `border-border` on light), last row `last:border-b-0`. Each row is
`icon · label (+ hint) · control`. The composer's Event options card is the
reference implementation (`OptionRow`). Reach for this instead of a stack of
separate cards whenever the items are settings or toggles.

### Popover

Trigger button plus an absolutely positioned `rounded-xl` panel, closed on
outside pointerdown and Escape, focus returned to the trigger. See
`app/admin/events/new/_components/popover.tsx`. **If the trigger lives inside a
`position: sticky` or `transform`ed ancestor, a `fixed` overlay must be
portalled to `document.body`** — sticky opens a stacking context and will trap
it.

---

## 7 · Composer themes

`/admin/events/new` is the one surface that paints its own background. Themes
live in `app/admin/events/new/event-theme.ts` as pure CSS background layers —
5 styles × 5 palettes × a shuffle seed — so one spec paints a 24px swatch and a
full-bleed page with no second renderer. Tile sizes are percentages so the
swatch and the page read identically.

A theme dresses the page. It is **not** the event's cover image; the cover is
uploaded separately.

---

## 8 · Forms

- Server-rendered, submitted through server actions. See `CLAUDE.md`.
- Label above input, error below, hint below that.
- **Never a native `<select>` on a styled surface.** They render as raw OS
  widgets and match nothing. Use the popover pattern from §6.
- Inputs are `rounded-xl`, not pill-shaped. Pills are for buttons and chips.
- Disabled state is `disabled:cursor-not-allowed disabled:opacity-40`.
- Focus is always visible: `focus-visible:ring-2 focus-visible:ring-ring
  focus-visible:ring-offset-2 focus-visible:ring-offset-background`. On the
  dark composer, `focus-visible:ring-white/60`.

---

## 9 · Accessibility floor

Non-negotiable, checked on the built result rather than intended:

- Body and placeholder text ≥ 4.5:1, large text ≥ 3:1.
- Every icon-only control has an `aria-label`.
- Decorative glyphs and background layers carry `aria-hidden`.
- Every interactive element has a visible focus ring — including ones whose
  hover state is the primary affordance.
- Dialogs: `role="dialog"`, `aria-modal="true"`, Escape closes, focus returns
  to the trigger.
- Loading regions announce once via `role="status"` and `aria-busy`, not per
  skeleton element.
- Errors are `role="alert"`.

---

## 10 · Charts

Admin is the only place with charts, and there is **no chart library** —
`docs/13-roadmap/03-admin-analytics.md` §5 settled that: every shape this
product needs is a bar, and recharts/nivo/d3 is 40–150 kB of JS to draw a
rectangle. `app/admin/_components/charts.tsx` holds the static primitives
(`BarList`, `Funnel`) plus the `Panel` shell. They are server components made
of divs, so they cost nothing on the client and appear in the first paint.

`time-series-chart.tsx` is the one exception, and the line where it sits is
worth stating: **a shape people interrogate earns client JS; a shape they read
does not.** Nobody points at a ranked list — you read "Sophomores, 62" off it
and move on. But on 26 weekly buckets the question is always *which* week that
spike was, and the answer has to be reachable. So `TimeSeriesChart` is a client
component with a real tooltip and a bar/line toggle; `BarList` and `Funnel`
stay free. Shared visual constants live in `chart-tokens.ts` so the two sides
of that boundary can't drift.

Still no chart library on either side. The line view is a hand-rolled polyline
over the same scale the bars use — toggling changes the form and never the
story. It stretches a `0 0 100 100` viewBox with `preserveAspectRatio="none"`,
which means the stroke needs `vector-effect="non-scaling-stroke"` and the
hover dot has to be an HTML element, since an SVG circle would render as an
ellipse under that distortion.

The rules that keep them honest:

- **One hue.** Bars are `bg-primary`, varied by opacity when a list needs a
  top-to-bottom read. A categorical rainbow implies a meaning the categories
  do not have.
- **Every bar sits in a track.** `bg-muted/40` behind the fill, always. Without
  it an empty bucket disappears and the series reads as a shape that never
  happened — a signup chart with the quiet weeks dropped shows steady growth
  where there were two spikes and a flat summer.
- **Dense series come from the database.** `generate_series` in the RPC, not
  a gap-filling loop in the page. The query owns the shape of time.
- **Numbers first, share second.** `209` then `99%`, in both `BarList` and
  `Funnel`, and always `tabular-nums`.
- **One `role="img"` per chart** with a label that summarises the whole series
  ("Signups per week over 26 weeks: 231 total, peaking at 127 the week of Apr
  27"). Individual bars are `aria-hidden` — announcing 26 bars one by one is
  worse than not announcing them.
- **Interactive charts owe a keyboard path to the same numbers.** A tooltip
  that only a mouse can reach hides data. `TimeSeriesChart` is focusable and
  arrow keys step through buckets into an `aria-live` region — but that region
  stays empty until a key is actually pressed, so pointer hover never narrates
  itself and a reader passing through still gets one sentence, not twenty-six.
- **Axis density is a function of bucket count.** Twelve or fewer buckets label
  every column; more than that collapses to first / middle / last, because a
  clipped `Aug …` under a bar is worse than no label.

---

## 11 · Anti-patterns

Fast reference. Each of these has actually shipped here and been corrected.

| Don't | Because |
|---|---|
| Native `<select>` on a themed surface | Renders as an OS widget, matches nothing |
| `✓` / `→` / emoji as an icon | Ignores the stroke system, varies by platform |
| `.glass` without an ambient field behind it | Reads as a flat lighter card |
| `.glass-blur` on scrolling list items | Re-samples the backdrop every frame |
| `border` added on top of `.glass` | Double-declared elevation, the ghost card |
| `position: absolute` with no `left`/`top` | Resolves to static position; a button's centered `text-align` will place it wrong |
| `fixed` overlay inside a `sticky` column | Trapped in the stacking context, siblings paint over it |
| Reading a ref during render for layout math | Null on first pass; the wrong value sticks until something else re-renders |
| Selecting a not-yet-migrated column in the main profile query | One missing column blanks the entire surface |
| Raw Tailwind palette colors | Don't follow the theme (a branded poster, §6, is the one surface that must not) |
| A page title at `text-lg` | The screen has no anchor |
