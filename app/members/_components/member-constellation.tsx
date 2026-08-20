"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import { Avatar } from "@/app/_components/avatar";
import { LinkedInMark, GitHubMark } from "@/app/_components/brand-marks";
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
const GAP = 14;

// Fisheye shape. The face under the lens renders well past natural size and
// the curve drops steeply, which is what makes the centre read as magnified
// rather than merely "not shrunk" — the old curve peaked at 1.0 and all the
// depth came from shrinking the rim, so the middle never looked magnified.
const MAX_SCALE = 1.55;
const MIN_SCALE = 0.35;
const MIN_OPACITY = 0.12;

// Pages after the first are deliberately small and their faces trickle in
// one by one (ENTRY_STAGGER_MS apart). The prefetch below fires well before
// the viewer reaches the rim, so the slow reveal reads as choreography, not
// as waiting — by the time they pan to where a face lands, it has landed.
const FOLLOW_PAGE_SIZE = 24;
const ENTRY_STAGGER_MS = 90;
const INITIAL_STAGGER_MS = 16;

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
  if (width < 720) return 82;
  return 96;
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

  // Per-face entrance delay, assigned once at append time so a face keeps its
  // slot in the trickle even as later pages land. The first page settles fast
  // (it's the whole opening view); every page after drips in slowly.
  const entryDelay = useRef<Map<string, number>>(new Map());
  if (entryDelay.current.size === 0 && initialMembers.length > 0) {
    initialMembers.forEach((m, i) =>
      entryDelay.current.set(m.userId, Math.min(i, 30) * INITIAL_STAGGER_MS),
    );
  }

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
        setMembers((prev) => {
          // The cursor is (visible_since, user_id) and both halves are stable,
          // so overlap should be impossible -- but a duplicate key here would
          // desync nodeRefs from positions and corrupt the whole paint loop.
          const seen = new Set(prev.map((m) => m.userId));
          const fresh = result.data
            .filter((c) => !seen.has(c.user_id))
            .map(toConstellationMember);
          fresh.forEach((m, j) =>
            entryDelay.current.set(m.userId, j * ENTRY_STAGGER_MS),
          );
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      }
    } finally {
      loading.current = false;
      setPending(false);
    }
  }, [search]);
  // paint() runs every animation frame and needs to ask for more lattice
  // without being re-created (and re-cancelling the frame loop) every time
  // the loader identity changes.
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  const containerRef = useRef<HTMLDivElement>(null);
  const edgeLayerRef = useRef<HTMLDivElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Array<HTMLLIElement | null>>([]);

  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [focusIndex, setFocusIndex] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
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
  const nearest = useRef(0);

  // Radial, not per-axis: the old per-axis clamp let a diagonal drag park the
  // whole lattice in a corner of the frame, leaving the lens ring hovering
  // over empty space — the "weird" half-empty state. A radial bound means the
  // origin-most face can reach the frame edge, but the lattice can never
  // leave the lens entirely.
  const clampPan = useCallback(
    (p: { x: number; y: number }) => {
      const r = Math.hypot(p.x, p.y);
      if (r <= hullRadius || r === 0) return p;
      const k = hullRadius / r;
      return { x: p.x * k, y: p.y * k };
    },
    [hullRadius],
  );

  const paint = useCallback(() => {
    // Elliptical falloff normalised per axis, so the fisheye follows the
    // frame's shape — on a wide short canvas a face one screen-width away
    // must not fade as hard as one a screen-height away.
    const rx = Math.max(1, ((viewport.w || 960) / 2) * 0.92);
    const ry = Math.max(1, ((viewport.h || 480) / 2) * 0.92);
    let bestIndex = 0;
    let bestDistance = Infinity;

    for (let i = 0; i < positions.length; i += 1) {
      const node = nodeRefs.current[i];
      if (!node) continue;
      const px = positions[i].x + pan.current.x;
      const py = positions[i].y + pan.current.y;
      const distance = Math.hypot(px, py);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
      const t = Math.min(1, Math.hypot(px / rx, py / ry));
      const shape = (1 - t) ** 2.2;
      const scale = MIN_SCALE + (MAX_SCALE - MIN_SCALE) * shape;
      const opacity = Math.max(MIN_OPACITY, 1 - 0.9 * t ** 2);
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

    // The lens ring only means something when a face is actually under it.
    // Panned into open lattice, an empty ring reads as a broken highlight.
    if (lensRef.current) {
      lensRef.current.style.opacity = bestDistance < cell * 1.1 ? "1" : "0";
    }

    if (bestIndex !== nearest.current) {
      nearest.current = bestIndex;
      setFocusIndex(bestIndex);
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
    if (nearRim) void loadMoreRef.current();
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
          velocity.current.x *= 0.93;
          velocity.current.y *= 0.93;
        } else {
          velocity.current = { x: 0, y: 0 };
        }
      }
      const ease = dragging.current ? 0.65 : 0.18;
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
    if (fits) void loadMore();
  }, [members.length, viewport.w, viewport.h, hullRadius, cell, loadMore]);

  const moved = useRef(false);
  const lastPoint = useRef({ x: 0, y: 0, t: 0 });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dragging.current = true;
    moved.current = false;
    velocity.current = { x: 0, y: 0 };
    lastPoint.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    e.currentTarget.setPointerCapture(e.pointerId);
    requestFrame();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPoint.current.x;
    const dy = e.clientY - lastPoint.current.y;
    if (Math.hypot(dx, dy) > 2) moved.current = true;
    const dt = Math.max(1, e.timeStamp - lastPoint.current.t);
    velocity.current = { x: (dx / dt) * 14, y: (dy / dt) * 14 };
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

  const selectedIndex = useMemo(() => {
    if (selectedId === null) return null;
    const i = members.findIndex((m) => m.userId === selectedId);
    return i >= 0 ? i : null;
  }, [members, selectedId]);
  const shown =
    (selectedIndex !== null ? members[selectedIndex] : null) ??
    members[hoverIndex ?? focusIndex] ??
    members[0];
  const shownPinned = selectedIndex !== null && shown?.userId === selectedId;

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

        {/* The lens: marks the slot the card below is describing. paint()
            fades it out when no face is near the centre — an empty ring over
            bare lattice reads as a broken highlight. */}
        <div
          ref={lensRef}
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/40 transition-opacity duration-300"
          style={{ width: diameter + 24, height: diameter + 24 }}
        />

        <ul className="absolute inset-0">
          {members.map((member, i) => {
            const delay = entryDelay.current.get(member.userId) ?? 0;
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
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() =>
                  setHoverIndex((cur) => (cur === i ? null : cur))
                }
              >
                {/* Every face opens the profile card. The old markup only
                    linked members who had claimed a profile slug, which left
                    most of the directory dead to clicks — the backfilled
                    members have no slug yet. Navigation moved into the card,
                    where it can explain itself. */}
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
                    setHoverIndex(i);
                    if (e.currentTarget.matches(":focus-visible")) {
                      centerOn(i);
                    }
                  }}
                  onBlur={() =>
                    setHoverIndex((cur) => (cur === i ? null : cur))
                  }
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

        {/* Profile card: describes the focused face, pins on click. Overlaid
            rather than stacked under the canvas — below it, it pushed the
            lattice up and left a dead band the full width of the page. */}
        {shown ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[300] flex justify-center px-4 pb-5">
            <div
              key={shown.userId}
              role="group"
              aria-label={`Profile: ${shown.name}`}
              onPointerDown={(e) => e.stopPropagation()}
              className="constellation-card-in pointer-events-auto w-full max-w-md rounded-2xl border border-border/70 bg-popover/95 p-4 shadow-lg shadow-black/10 backdrop-blur-sm dark:shadow-black/40"
            >
              <div className="flex items-start gap-3">
                <Avatar
                  src={shown.avatarUrl}
                  name={shown.name}
                  className="h-12 w-12 shrink-0 rounded-full"
                  textClassName="text-base"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-base font-semibold tracking-tight">
                      {shown.name}
                    </p>
                    {shownPinned ? (
                      <button
                        type="button"
                        aria-label="Close profile card"
                        onClick={() => setSelectedId(null)}
                        className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <X size={15} strokeWidth={1.75} aria-hidden />
                      </button>
                    ) : null}
                  </div>
                  {shown.school || shown.gradLabel ? (
                    <p className="truncate text-sm text-muted-foreground">
                      {[shown.school, shown.gradLabel]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}
                  {shown.note ? (
                    <p className="mt-1 truncate text-sm italic text-foreground/90">
                      &ldquo;{shown.note}&rdquo;
                    </p>
                  ) : null}
                </div>
              </div>

              {shown.bio ? (
                <p className="mt-2.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                  {shown.bio}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
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
                <span className="flex-1" />
                {shown.linkedinUrl ? (
                  <a
                    href={shown.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="LinkedIn"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
                    className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <GitHubMark className="h-[15px] w-[15px]" />
                  </a>
                ) : null}
                {shown.slug ? (
                  <Link
                    href={`/members/${shown.slug}`}
                    className="rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    View profile
                  </Link>
                ) : shown.discordUsername ? (
                  <span className="text-xs text-muted-foreground">
                    @{shown.discordUsername}
                  </span>
                ) : null}
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