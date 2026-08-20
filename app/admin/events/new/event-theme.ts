// Composer themes.
//
// A theme dresses the page the event lives on, not the event's cover image —
// picking "Confetti" should change what's behind the form, the way it changes
// the event page on Luma. Everything here is expressed as CSS background
// layers so the same spec paints a 40px swatch and a full-bleed page without a
// second renderer, and tile sizes are percentages so both read identically.

export const THEME_STYLES = [
  "aurora",
  "mesh",
  "confetti",
  "rings",
  "bands",
] as const;
export type ThemeStyle = (typeof THEME_STYLES)[number];

export const THEME_STYLE_LABELS: Record<ThemeStyle, string> = {
  aurora: "Aurora",
  mesh: "Mesh",
  confetti: "Confetti",
  rings: "Rings",
  bands: "Bands",
};

export const THEME_PALETTES = [
  "violet",
  "ember",
  "mint",
  "dusk",
  "sand",
] as const;
export type ThemePalette = (typeof THEME_PALETTES)[number];

export const THEME_PALETTE_LABELS: Record<ThemePalette, string> = {
  violet: "Violet",
  ember: "Ember",
  mint: "Mint",
  dusk: "Dusk",
  sand: "Sand",
};

type PaletteDef = {
  /** Page base. Dark enough that white body copy clears 4.5:1 everywhere. */
  base: string;
  /** Surface fill for the cards that sit on top of the theme. */
  surface: string;
  inks: [string, string, string, string];
};

const PALETTES: Record<ThemePalette, PaletteDef> = {
  violet: {
    base: "#2E1240",
    surface: "255, 255, 255",
    inks: ["#A76DFF", "#7848D6", "#C77DFF", "#5B3FD1"],
  },
  ember: {
    base: "#3A1220",
    surface: "255, 255, 255",
    inks: ["#F97316", "#F43F5E", "#FBBF24", "#C2410C"],
  },
  mint: {
    base: "#0B2E2A",
    surface: "255, 255, 255",
    inks: ["#2DD4BF", "#84CC16", "#22D3EE", "#0F766E"],
  },
  dusk: {
    base: "#141B33",
    surface: "255, 255, 255",
    inks: ["#60A5FA", "#818CF8", "#38BDF8", "#4338CA"],
  },
  sand: {
    base: "#2E2416",
    surface: "255, 255, 255",
    inks: ["#F59E0B", "#FCD34D", "#D97706", "#92400E"],
  },
};

export type ThemeSpec = {
  style: ThemeStyle;
  palette: ThemePalette;
  seed: number;
};

export const DEFAULT_THEME: ThemeSpec = {
  style: "aurora",
  palette: "violet",
  seed: 0,
};

function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// mulberry32 — the shuffle nudges gradient positions and angles without
// changing the theme's character.
function rng(seed: number): () => number {
  let a = (seed + 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Layers = { images: string[]; sizes: string[] };

function buildLayers(spec: ThemeSpec): Layers {
  const { inks } = PALETTES[spec.palette];
  const rand = rng(spec.seed);
  const jitter = (center: number, spread: number) =>
    Math.round(center + (rand() - 0.5) * spread);

  if (spec.style === "aurora") {
    return {
      images: [
        `radial-gradient(60% 55% at ${jitter(15, 20)}% ${jitter(0, 16)}%, ${withAlpha(inks[0], 0.42)}, transparent 62%)`,
        `radial-gradient(55% 50% at ${jitter(92, 16)}% ${jitter(12, 16)}%, ${withAlpha(inks[2], 0.34)}, transparent 58%)`,
        `radial-gradient(65% 60% at ${jitter(50, 30)}% ${jitter(105, 14)}%, ${withAlpha(inks[1], 0.4)}, transparent 60%)`,
      ],
      sizes: ["auto", "auto", "auto"],
    };
  }

  if (spec.style === "mesh") {
    return {
      images: [
        `radial-gradient(70% 65% at 0% 0%, ${withAlpha(inks[0], 0.5)}, transparent 62%)`,
        `radial-gradient(70% 65% at 100% 0%, ${withAlpha(inks[2], 0.42)}, transparent 62%)`,
        `radial-gradient(70% 65% at 0% 100%, ${withAlpha(inks[3], 0.45)}, transparent 62%)`,
        `radial-gradient(70% 65% at 100% 100%, ${withAlpha(inks[1], 0.45)}, transparent 62%)`,
      ],
      sizes: ["auto", "auto", "auto", "auto"],
    };
  }

  if (spec.style === "confetti") {
    // Three tiled dot fields at different scales read as scatter rather than
    // as a visible grid.
    return {
      images: [
        `radial-gradient(55% 45% at 50% 0%, ${withAlpha(inks[0], 0.3)}, transparent 60%)`,
        `radial-gradient(circle at ${jitter(30, 20)}% ${jitter(35, 20)}%, ${withAlpha(inks[2], 0.85)} 0 5%, transparent 5.5%)`,
        `radial-gradient(circle at ${jitter(70, 20)}% ${jitter(65, 20)}%, ${withAlpha(inks[0], 0.7)} 0 3.5%, transparent 4%)`,
        `radial-gradient(circle at ${jitter(50, 24)}% ${jitter(20, 20)}%, ${withAlpha(inks[1], 0.6)} 0 2.5%, transparent 3%)`,
      ],
      sizes: ["auto", "9% 9%", "6.5% 6.5%", "4.5% 4.5%"],
    };
  }

  if (spec.style === "rings") {
    return {
      images: [
        `radial-gradient(60% 55% at ${jitter(30, 20)}% ${jitter(28, 16)}%, ${withAlpha(inks[0], 0.34)}, transparent 62%)`,
        `repeating-radial-gradient(circle at ${jitter(28, 16)}% ${jitter(32, 16)}%, transparent 0 3.2%, ${withAlpha(inks[2], 0.4)} 3.2% 3.9%)`,
      ],
      sizes: ["auto", "auto"],
    };
  }

  return {
    images: [
      `radial-gradient(60% 50% at ${jitter(20, 20)}% ${jitter(10, 16)}%, ${withAlpha(inks[0], 0.32)}, transparent 62%)`,
      `repeating-linear-gradient(${jitter(115, 24)}deg, transparent 0 5%, ${withAlpha(inks[2], 0.26)} 5% 10%)`,
    ],
    sizes: ["auto", "auto"],
  };
}

/** Inline style for any element that should wear the theme. */
export function themeStyle(spec: ThemeSpec): React.CSSProperties {
  const { base } = PALETTES[spec.palette];
  const { images, sizes } = buildLayers(spec);
  return {
    backgroundColor: base,
    backgroundImage: images.join(", "),
    backgroundSize: sizes.join(", "),
  };
}

/** The page base on its own, for elements that sit under the theme. */
export function themeBase(spec: ThemeSpec): string {
  return PALETTES[spec.palette].base;
}
