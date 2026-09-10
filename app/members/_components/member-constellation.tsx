"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Globe, X } from "lucide-react";

import { Avatar } from "@/app/_components/avatar";
import { LinkedInMark, GitHubMark } from "@/app/_components/brand-marks";
import { StaticNote } from "@/app/profile/note-bubble";
import { listMemberCards } from "@/lib/actions/members";

import {
  cursorAfter,
  toConstellationMember,
  type ConstellationMember,
  type Cursor,
} from "./constellation-data";

// Axial neighbour offsets on a triangular lattice, in ring order. Only the
// first three are used for edge-building so each pair is linked once.
const AXIAL_DIRS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
] as const;

const SQRT3_2 = Math.sqrt(3) / 2;
const GAP = 18;

// Fisheye shape. The dome is wide and low: FALLOFF_EXP near 1 spreads the
// magnification across most of the frame instead of collapsing within a cell
// of the lens, and the peak is sized so a centre face and its neighbour just
// kiss (peak+neighbour diameters ≈ two cells) rather than pile up. GAP grew
// with the peak — spacing is what buys the overlap headroom.
//
// MIN_OPACITY is a *visibility* floor, not a fade-out: the vignette already
// veils the rim, and a 0.12 floor made far faces vanish against the light
// background while their lattice lines stayed visible — which read as the
// grid rendering with nobody on it whenever a new page landed.
const MAX_SCALE = 1.26;
const MIN_SCALE = 0.42;
const MIN_OPACITY = 0.3;
const FALLOFF_EXP = 1.3;

// Fetched pages land in a buffer and members are REVEALED one at a time,
// REVEAL_EVERY_MS apart. The reveal appends to React state, so a member's
// face, its lattice cell, its edge lines, and the hull all arrive in the
// same commit. The old way mounted the whole batch at once with staggered
// CSS delays on the faces only — the lattice grew instantly and the faces
// caught up over two seconds, which read as a spiderweb of empty cells
// popping in whenever a page loaded. The prefetch fires well before the
// viewer reaches the rim, so the slow reveal reads as choreography, not as
// waiting — by the time they pan to where a face lands, it has landed.
//
// 2026-08-23: reporting as laggy at the rim on a real deployment. Two
// tunings, not a redesign — the choreography itself is fine, it was tuned
// too close to localhost-latency assumptions: a full 24-member page took up
// to ~1.9s to finish revealing (24 * 80ms), and the fetch-ahead trigger only
// fired once the buffer dropped to half (12 left), leaving one real network
// round-trip's worth of margin against a production RPC call. Halved the
// per-member interval and fetch three-quarters through the buffer instead of
// half, so there's roughly 2x the round-trip margin before the queue could
// run dry.
//
// 2026-08-26: still perceptible at the rim. Same lever, pushed further: the
// fetch-ahead trigger (FETCH_AHEAD_RATIO below) now fires with ~90% of the
// buffer still queued instead of 75%, so the next page's RPC round trip has
// most of a page's reveal time to land, not a quarter of one.
const FOLLOW_PAGE_SIZE = 24;
const REVEAL_EVERY_MS = 32;
const INITIAL_STAGGER_MS = 16;
const FETCH_AHEAD_RATIO = 0.9;

function hexSpiral(count: number) {
  const cells: Array<[number, number]> = [[0, 0]];
  let q = 0;
  let r = 0;
  let ring = 1;
  while (cells.length < count) {
    q += AXIAL_DIRS[4][0];
    r += AXIAL_DIRS[4][1];
    for (let side = 0; side < 6 && cells.length < count; side += 1) {
      for (let step = 0; step < ring && cells.length < count; step += 1) {
        cells.push([q, r]);
        q += AXIAL_DIRS[side][0];
        r += AXIAL_DIRS[side][1];
      }
    }
    ring += 1;
  }
  return cells;
}

function cellSizeFor(width: number) {
  if (width < 420) return 66;
  if (width < 720) return 84;
  return 104;
}

export function MemberConstellation({
  initialMembers,
  initialCursor,
  search,
}: {
  initialMembers: ConstellationMember[];
  initialCursor: Cursor;
  search: string | null;
}) {
  // The lattice grows instead of paging. hexSpiral() is a pure function of
  // index, so appending a page extends the spiral outward and never disturbs a
  // position already on screen -- the viewer keeps looking at whoever they were
  // looking at while new rings fill in around them.
  const [members, setMembers] = useState(initialMembers);
  const cursor = useRef<Cursor>(initialCursor);
  const loading = useRef(false);
  const [pending, setPending] = useState(false);

  // Buffer between the network and the lattice. loadMore() fills it a page
  // at a time; the ticker drains it one member per beat into React state.
  const revealQueue = useRef<ConstellationMember[]>([]);
  const revealTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startReveal = useCallback(() => {
    if (revealTimer.current !== null) return;
    revealTimer.current = setInterval(() => {
      const next = revealQueue.current.shift();
      if (!next) {
        clearInterval(revealTimer.current!);
        revealTimer.current = null;
        return;
      }
      setMembers((prev) =>
        prev.some((m) => m.userId === next.userId) ? prev : [...prev, next],
      );
    }, REVEAL_EVERY_MS);
  }, []);
  useEffect(
    () => () => {
      if (revealTimer.current !== null) clearInterval(revealTimer.current);
    },
    [],
  );

  const loadMore = useCallback(async () => {
    if (loading.current || cursor.current === null) return;
    loading.current = true;
    setPending(true);
    const at = cursor.current;
    try {
      const result = await listMemberCards({
        search,
        cursor_ts: at.ts,
        cursor_user: at.user,
        limit: FOLLOW_PAGE_SIZE,
      });
      if (!result.ok) {
        // Stop rather than spin: the triggers below would otherwise re-fire on
        // the next frame and hammer a failing endpoint for as long as the
        // viewer sits on the page.
        cursor.current = null;
        return;
      }
      cursor.current = cursorAfter(result.data, FOLLOW_PAGE_SIZE);
      if (result.data.length > 0) {
        // The cursor is (visible_since, user_id) and both halves are stable,
        // so overlap should be impossible -- but a duplicate key would desync
        // nodeRefs from positions and corrupt the whole paint loop, so dedupe
        // against both the revealed lattice and the not-yet-revealed queue.
        // (The reveal tick re-checks against members at append time.)
        const queued = new Set(revealQueue.current.map((m) => m.userId));
        const fresh = result.data
          .map(toConstellationMember)
          .filter((m) => !queued.has(m.userId));
        revealQueue.current.push(...fresh);
        startReveal();
      }
    } finally {
      loading.current = false;
      setPending(false);
    }
  }, [search, startReveal]);
  // paint() runs every animation frame and needs to ask for more lattice
  // without being re-created (and re-cancelling the frame loop) every time
  // the loader identity changes.
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  const containerRef = useRef<HTMLDivElement>(null);
  const edgeLayerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Array<HTMLLIElement | null>>([]);

  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const count = members.length;
  const cell = cellSizeFor(viewport.w || 960);
  const diameter = cell - GAP;

  const { positions, edges, extent, hullRadius } = useMemo(() => {
    const cells = hexSpiral(Math.max(1, count));
    const pos = cells.map(([q, r]) => ({
      x: cell * (q + r / 2),
      y: cell * r * SQRT3_2,
    }));
    const byCell = new Map(cells.map(([q, r], i) => [`${q},${r}`, i]));
    const links: Array<[number, number]> = [];
    cells.forEach(([q, r], i) => {
      for (let d = 0; d < 3; d += 1) {
        const neighbour = byCell.get(
          `${q + AXIAL_DIRS[d][0]},${r + AXIAL_DIRS[d][1]}`,
        );
        if (neighbour !== undefined) links.push([i, neighbour]);
      }
    });
    const halfW = pos.reduce((m, p) => Math.max(m, Math.abs(p.x)), 0);
    const halfH = pos.reduce((m, p) => Math.max(m, Math.abs(p.y)), 0);
    const hull = pos.reduce((m, p) => Math.max(m, Math.hypot(p.x, p.y)), 0);
    const pad = cell;
    return {
      positions: pos,
      edges: links,
      hullRadius: hull,
      extent: {
        left: -halfW - pad,
        top: -halfH - pad,
        width: (halfW + pad) * 2,
        height: (halfH + pad) * 2,
      },
    };
  }, [count, cell]);

  const pan = useRef({ x: 0, y: 0 });
  const panTarget = useRef({ x: 0, y: 0 });
  const velocity = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  const frame = useRef<number | null>(null);

  // Radial, not per-axis: the old per-axis clamp let a diagonal drag park the
  // whole lattice in a corner of the frame, leaving empty space on the
  // opposite side — the "weird" half-empty state. A radial bound means the
  // origin-most face can reach the frame edge, but the lattice can never
  // leave the frame entirely.
  // Stops 1.5 cells short of the hull: parked exactly at the frontier, the
  // centre sits on the last loaded ring with half the frame empty — which is
  // what a mid-load page looked like when the viewer outran the fetch.
  const panLimit = Math.max(0, hullRadius - cell * 1.5);

  const clampPan = useCallback(
    (p: { x: number; y: number }) => {
      const r = Math.hypot(p.x, p.y);
      if (r <= panLimit || r === 0) return p;
      const k = panLimit / r;
      return { x: p.x * k, y: p.y * k };
    },
    [panLimit],
  );

  const paint = useCallback(() => {
    // Elliptical falloff normalised per axis, so the fisheye follows the
    // frame's shape — on a wide short canvas a face one screen-width away
    // must not fade as hard as one a screen-height away.
    const rx = Math.max(1, ((viewport.w || 960) / 2) * 0.92);
    const ry = Math.max(1, ((viewport.h || 480) / 2) * 0.92);

    for (let i = 0; i < positions.length; i += 1) {
      const node = nodeRefs.current[i];
      if (!node) continue;
      const px = positions[i].x + pan.current.x;
      const py = positions[i].y + pan.current.y;
      const t = Math.min(1, Math.hypot(px / rx, py / ry));
      const shape = (1 - t) ** FALLOFF_EXP;
      const scale = MIN_SCALE + (MAX_SCALE - MIN_SCALE) * shape;
      const opacity = Math.max(MIN_OPACITY, 1 - 0.7 * t ** 1.6);
      node.style.transform = `translate3d(${px}px, ${py}px, 0) scale(${scale})`;
      node.style.opacity = String(opacity);
      node.style.zIndex = String(Math.round((1 - t) * 100));
      // Far-edge nodes are ghosts; don't let them eat clicks meant for the
      // vignette or swallow a drag that starts near the rim.
      node.style.pointerEvents = opacity < 0.18 ? "none" : "auto";
    }

    if (edgeLayerRef.current) {
      edgeLayerRef.current.style.transform = `translate3d(${pan.current.x}px, ${pan.current.y}px, 0)`;
    }

    // Directional prefetch: probe one look-ahead length past the viewport in
    // the direction the viewer is travelling; if that point leaves the hull
    // and there are more members to fetch, start fetching now, while the rim
    // is still screens away. Standing near the rim (no velocity) also counts —
    // a slow drag must never outrun the data. loadMore() self-dedupes, so
    // calling it every frame while near the rim is one request, not a flood.
    const speed = Math.hypot(velocity.current.x, velocity.current.y);
    const cx = -pan.current.x;
    const cy = -pan.current.y;
    const lookahead = Math.hypot(rx, ry);
    let probeX = cx;
    let probeY = cy;
    if (speed > 0.3) {
      probeX = cx - (velocity.current.x / speed) * lookahead;
      probeY = cy - (velocity.current.y / speed) * lookahead;
    }
    const nearRim =
      Math.hypot(probeX, probeY) > hullRadius - cell * 2 ||
      Math.hypot(cx, cy) > hullRadius - cell * 3;
    // Fetch ahead of the reveal: once the buffer runs low near the rim, the
    // next page should already be in flight — the ticker never waits on the
    // network, and the network never dumps into a fat queue.
    if (nearRim && revealQueue.current.length < FOLLOW_PAGE_SIZE * FETCH_AHEAD_RATIO) {
      void loadMoreRef.current();
    }
  }, [positions, viewport.w, viewport.h, cell, hullRadius]);

  const requestFrame = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(function tick() {
      frame.current = null;
      if (!dragging.current) {
        if (Math.hypot(velocity.current.x, velocity.current.y) > 0.08) {
          panTarget.current = clampPan({
            x: panTarget.current.x + velocity.current.x,
            y: panTarget.current.y + velocity.current.y,
          });
          velocity.current.x *= 0.95;
          velocity.current.y *= 0.95;
        } else {
          velocity.current = { x: 0, y: 0 };
        }
      }
      const ease = dragging.current ? 0.35 : 0.12;
      pan.current.x += (panTarget.current.x - pan.current.x) * ease;
      pan.current.y += (panTarget.current.y - pan.current.y) * ease;
      paint();
      const settled =
        !dragging.current &&
        velocity.current.x === 0 &&
        velocity.current.y === 0 &&
        Math.hypot(
          panTarget.current.x - pan.current.x,
          panTarget.current.y - pan.current.y,
        ) < 0.3;
      if (settled) {
        pan.current = { ...panTarget.current };
        paint();
        return;
      }
      requestFrame();
    });
  }, [clampPan, paint]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewport({
        w: entry.contentRect.width,
        h: entry.contentRect.height,
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Repaints after a resize re-lays the lattice. Pan is deliberately left
  // alone here — the page remounts this component when the result set
  // changes, so resizing never yanks the viewer back to the origin.
  useEffect(() => {
    paint();
  }, [paint]);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  // Fill trigger: the whole lattice fits inside the frame, so there is
  // nothing to pan toward. On a wide screen the first page lands well short
  // of the edges, and without this the canvas would sit there half-empty
  // until someone thought to drag it. (The travelling-direction prefetch
  // lives in paint(), where the velocity actually is.)
  useEffect(() => {
    if (viewport.w === 0 || cursor.current === null || loading.current) return;
    const fits =
      hullRadius * 2 + cell * 2 <=
      Math.max(viewport.w || 0, viewport.h || 0);
    if (fits && revealQueue.current.length < FOLLOW_PAGE_SIZE * FETCH_AHEAD_RATIO) {
      void loadMore();
    }
  }, [members.length, viewport.w, viewport.h, hullRadius, cell, loadMore]);

  const moved = useRef(false);
  const lastPoint = useRef({ x: 0, y: 0, t: 0 });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dragging.current = true;
    moved.current = false;
    velocity.current = { x: 0, y: 0 };
    lastPoint.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    requestFrame();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPoint.current.x;
    const dy = e.clientY - lastPoint.current.y;
    if (!moved.current && Math.hypot(dx, dy) > 2) {
      moved.current = true;
      // Capturing on pointerdown (rather than only once a drag actually
      // starts) retargets the browser's synthetic click event to this
      // container too -- per the Pointer Events spec, an active capture
      // redirects click, not just pointermove/up -- which silently ate
      // every plain click on a face button before it ever reached the
      // button's onClick. Deferring capture to here means a click with no
      // real movement never captures at all, so its click event still
      // targets (and bubbles through) the button normally.
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const dt = Math.max(1, e.timeStamp - lastPoint.current.t);
    velocity.current = { x: (dx / dt) * 8, y: (dy / dt) * 8 };
    lastPoint.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    panTarget.current = clampPan({
      x: panTarget.current.x + dx,
      y: panTarget.current.y + dy,
    });
    requestFrame();
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    requestFrame();
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const next = clampPan({
        x: panTarget.current.x - e.deltaX,
        y: panTarget.current.y - e.deltaY,
      });
      // Chain to the page once the lattice can't move any further, so a
      // reader scrolling past the canvas never gets trapped inside it.
      const absorbed =
        Math.abs(next.x - panTarget.current.x) > 0.5 ||
        Math.abs(next.y - panTarget.current.y) > 0.5;
      if (!absorbed) return;
      e.preventDefault();
      velocity.current = { x: 0, y: 0 };
      panTarget.current = next;
      requestFrame();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [clampPan, requestFrame]);

  const centerOn = useCallback(
    (index: number) => {
      velocity.current = { x: 0, y: 0 };
      panTarget.current = clampPan({
        x: -positions[index].x,
        y: -positions[index].y,
      });
      requestFrame();
    },
    [clampPan, positions, requestFrame],
  );

  // Escape releases a pinned card from anywhere on the page.
  useEffect(() => {
    if (selectedId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  // Card only ever shows the clicked-and-pinned member — nothing renders
  // until a click happens, and nothing else swaps it out from under you.
  const shown = useMemo(() => {
    if (selectedId === null) return null;
    return members.find((m) => m.userId === selectedId) ?? null;
  }, [members, selectedId]);

  return (
    // Full-bleed: the canvas breaks out of the layout's max-w-5xl column
    // instead of sitting in it. A pannable lattice reads as a window onto
    // something larger, and a 1024px window on a 2000px screen mostly showed
    // how much room it wasn't using. left-1/2 + -translate-x-1/2 centres a
    // 100vw child under any parent width without knowing that width.
    <div className="relative left-1/2 w-screen -translate-x-1/2 px-4">
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDragStart={(e) => e.preventDefault()}
        onClickCapture={(e) => {
          // A drag that ends on a face shouldn't open their card.
          if (moved.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        className="relative h-[clamp(460px,calc(100dvh-15rem),1040px)] cursor-grab touch-none select-none overflow-hidden rounded-3xl border border-border/60 bg-card/40 active:cursor-grabbing"
      >
        <div
          ref={edgeLayerRef}
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 z-0 will-change-transform"
        >
          <svg
            className="absolute overflow-visible text-border"
            style={{
              left: extent.left,
              top: extent.top,
              width: extent.width,
              height: extent.height,
            }}
            width={extent.width}
            height={extent.height}
          >
            {edges.map(([a, b]) => (
              <line
                key={`${a}-${b}`}
                x1={positions[a].x - extent.left}
                y1={positions[a].y - extent.top}
                x2={positions[b].x - extent.left}
                y2={positions[b].y - extent.top}
                stroke="currentColor"
                strokeWidth={1}
                opacity={0.45}
              />
            ))}
          </svg>
        </div>

        <ul className="absolute inset-0">
          {members.map((member, i) => {
            // Members past the initial page mount one per reveal tick, so
            // their bubble-in needs no extra delay; the opening batch still
            // settles as a quick cascade.
            const delay =
              i < initialMembers.length
                ? Math.min(i, 30) * INITIAL_STAGGER_MS
                : 0;
            return (
              <li
                key={member.userId}
                ref={(el) => {
                  nodeRefs.current[i] = el;
                }}
                className="absolute left-1/2 top-1/2 will-change-transform"
                style={{
                  width: diameter,
                  height: diameter,
                  marginLeft: -diameter / 2,
                  marginTop: -diameter / 2,
                }}
              >
                {/* Click opens the card and pins it there — no preview on
                    hover, so panning across the lattice never pops or swaps
                    a card you didn't ask for. */}
                <button
                  type="button"
                  aria-label={`View ${member.name}`}
                  draggable={false}
                  onClick={() => {
                    if (moved.current) return;
                    centerOn(i);
                    setSelectedId(member.userId);
                  }}
                  onFocus={(e) => {
                    if (e.currentTarget.matches(":focus-visible")) {
                      centerOn(i);
                    }
                  }}
                  className="bubble-in block h-full w-full cursor-pointer rounded-full ring-primary/70 ring-offset-2 ring-offset-background transition-transform duration-200 hover:scale-[1.08] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none motion-reduce:hover:scale-100"
                  style={{ animationDelay: `${delay}ms` }}
                >
                  <Avatar
                    src={member.avatarUrl}
                    name={member.name}
                    className="h-full w-full rounded-full"
                    textClassName="text-lg"
                  />
                  <span className="sr-only">{member.name}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div aria-hidden className="constellation-vignette" />

        {/* Profile card: only appears once you click a face, and stays put
            until you close it or click another. Overlaid rather than stacked
            under the canvas — below it, it pushed the lattice up and left a
            dead band the full width of the page. */}
        {shown ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[300] flex justify-center px-4 pb-5">
            {/* No key: re-keying per member replayed the entrance fade on
                every hover crossing, so the card spent most of a pan half
                transparent with the lattice ghosting through it. It mounts
                once, animates once, and the content swaps in place. Solid
                popover fill for the same reason. */}
            <div
              role="group"
              aria-label={`Profile: ${shown.name}`}
              onPointerDown={(e) => e.stopPropagation()}
              className="constellation-card-in pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl border border-border/70 bg-popover shadow-lg shadow-black/10 dark:shadow-black/40"
            >
              {/* Miniature of the profile header: banner across the top,
                  avatar breaking its bottom edge. Same gradient fallback as
                  StaticBanner so bannerless members still get a header. */}
              <div className="relative h-16 bg-muted">
                {shown.bannerUrl ? (
                  // Keyed so switching members drops the old banner instantly
                  // instead of showing the previous member's photo while the
                  // next one loads.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={shown.userId}
                    src={shown.bannerUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div
                    aria-hidden
                    className="h-full w-full"
                    style={{
                      backgroundImage:
                        "radial-gradient(60% 80% at 12% 0%, hsl(var(--primary) / 0.35), transparent 62%), radial-gradient(55% 75% at 88% 10%, hsl(var(--primary) / 0.22), transparent 58%)",
                    }}
                  />
                )}
                {/* Card only ever shows the pinned member, so this is never
                    conditional the way a hover-preview version would need. */}
                <button
                  type="button"
                  aria-label="Close profile card"
                  onClick={() => setSelectedId(null)}
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <X size={14} strokeWidth={2} aria-hidden />
                </button>
              </div>

              <div className="relative px-4 pb-4">
                <div className="relative -mt-7 w-fit">
                  {shown.note ? (
                    <div className="absolute bottom-full left-1 z-10 mb-2">
                      <StaticNote note={shown.note} />
                    </div>
                  ) : null}
                  <div className="w-fit rounded-full ring-4 ring-popover">
                    <Avatar
                      src={shown.avatarUrl}
                      name={shown.name}
                      className="h-14 w-14 rounded-full"
                      textClassName="text-lg"
                    />
                  </div>
                </div>

                <div className="mt-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold tracking-tight">
                      {shown.name}
                    </p>
                    {shown.school || shown.gradLabel ? (
                      <p className="truncate text-sm text-muted-foreground">
                        {[shown.school, shown.gradLabel]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {shown.linkedinUrl ? (
                      <a
                        href={shown.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="LinkedIn"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-black dark:hover:text-white"
                      >
                        <LinkedInMark className="h-[15px] w-[15px]" />
                      </a>
                    ) : null}
                    {shown.githubUrl ? (
                      <a
                        href={shown.githubUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="GitHub"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-black dark:hover:text-white"
                      >
                        <GitHubMark className="h-[15px] w-[15px]" />
                      </a>
                    ) : null}
                    {shown.portfolioUrl ? (
                      <a
                        href={shown.portfolioUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Portfolio"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-black dark:hover:text-white"
                      >
                        <Globe size={15} strokeWidth={1.75} aria-hidden />
                      </a>
                    ) : null}
                    {shown.slug ? (
                      <Link
                        href={`/members/${shown.slug}`}
                        className="ml-1 rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        View profile
                      </Link>
                    ) : shown.discordUsername ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        @{shown.discordUsername}
                      </span>
                    ) : null}
                  </div>
                </div>

                {shown.bio ? (
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                    {shown.bio}
                  </p>
                ) : null}

                <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 empty:hidden">
                  {shown.classStanding ? (
                    <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
                      {shown.classStanding}
                    </span>
                  ) : null}
                  {shown.roles.map((r) => (
                    <span
                      key={r}
                      className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] capitalize text-muted-foreground"
                    >
                      {r.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Status, not a control: there is nothing to click and nothing to
            wait for -- the lattice stays interactive while a page lands. */}
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute right-4 top-4 z-[300] text-xs text-muted-foreground"
        >
          {pending ? "Mapping more members…" : null}
        </div>
      </div>
    </div>
  );
}