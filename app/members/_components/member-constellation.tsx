"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "@/app/_components/avatar";

export type ConstellationMember = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  slug: string | null;
  school: string | null;
  classStanding: string | null;
  gradLabel: string | null;
  roles: string[];
};

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

// Falloff shape. Nodes at the centre render full size; everything past
// FOCUS_RADIUS bottoms out, which is what gives the watch-face fisheye.
const MIN_SCALE = 0.38;
const MIN_OPACITY = 0.08;

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function MemberConstellation({
  members,
}: {
  members: ConstellationMember[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const edgeLayerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Array<HTMLLIElement | null>>([]);

  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [focusIndex, setFocusIndex] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const count = members.length;
  const cell = cellSizeFor(viewport.w || 960);
  const diameter = cell - GAP;

  const { positions, edges, extent, halfSpan } = useMemo(() => {
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
    const pad = cell;
    return {
      positions: pos,
      edges: links,
      halfSpan: { x: halfW, y: halfH },
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

  const clampPan = useCallback(
    (p: { x: number; y: number }) => ({
      x: clamp(p.x, -halfSpan.x, halfSpan.x),
      y: clamp(p.y, -halfSpan.y, halfSpan.y),
    }),
    [halfSpan.x, halfSpan.y],
  );

  const paint = useCallback(() => {
    const radius = Math.max(
      1,
      Math.min(viewport.w || 960, viewport.h || 480) * 0.72,
    );
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
      const t = Math.min(1, distance / radius);
      const scale = 1 - (1 - MIN_SCALE) * t ** 1.3;
      const opacity = Math.max(MIN_OPACITY, 1 - 0.95 * t ** 2.1);
      node.style.transform = `translate3d(${px}px, ${py}px, 0) scale(${scale})`;
      node.style.opacity = String(opacity);
      node.style.zIndex = String(Math.round((1 - t) * 100));
      // Far-edge nodes are ghosts; don't let them eat clicks meant for the
      // vignette or swallow a drag that starts near the rim.
      node.style.pointerEvents = opacity < 0.25 ? "none" : "auto";
    }

    if (edgeLayerRef.current) {
      edgeLayerRef.current.style.transform = `translate3d(${pan.current.x}px, ${pan.current.y}px, 0)`;
    }

    if (bestIndex !== nearest.current) {
      nearest.current = bestIndex;
      setFocusIndex(bestIndex);
    }
  }, [positions, viewport.w, viewport.h]);

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

  const shown = members[hoverIndex ?? focusIndex] ?? members[0];

  return (
    <div className="space-y-5">
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDragStart={(e) => e.preventDefault()}
        onClickCapture={(e) => {
          // A drag that ends on a face shouldn't navigate.
          if (moved.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        className="relative h-[clamp(360px,58vh,620px)] cursor-grab touch-none select-none overflow-hidden rounded-3xl border border-border/60 bg-card/40 active:cursor-grabbing"
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

        {/* The lens: marks the slot the readout below is describing. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/40"
          style={{ width: diameter + 16, height: diameter + 16 }}
        />

        <ul className="absolute inset-0">
          {members.map((member, i) => {
            const face = (
              <>
                <Avatar
                  src={member.avatarUrl}
                  name={member.name}
                  className="h-full w-full rounded-full"
                  textClassName="text-lg"
                />
                <span className="sr-only">{member.name}</span>
              </>
            );
            const delay = { animationDelay: `${Math.min(i, 30) * 16}ms` };
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
                {member.slug ? (
                  <Link
                    href={`/members/${member.slug}`}
                    draggable={false}
                    onFocus={(e) => {
                      setHoverIndex(i);
                      if (e.currentTarget.matches(":focus-visible")) {
                        centerOn(i);
                      }
                    }}
                    onBlur={() =>
                      setHoverIndex((cur) => (cur === i ? null : cur))
                    }
                    className="bubble-in block h-full w-full rounded-full ring-primary/70 ring-offset-2 ring-offset-background transition-transform duration-200 hover:scale-[1.09] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none motion-reduce:hover:scale-100"
                    style={delay}
                  >
                    {face}
                  </Link>
                ) : (
                  <span
                    className="bubble-in block h-full w-full rounded-full opacity-55"
                    style={delay}
                  >
                    {face}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        <div aria-hidden className="constellation-vignette" />
      </div>

      {shown ? (
        <div className="min-h-[76px] text-center">
          <p className="text-lg font-semibold tracking-tight">{shown.name}</p>
          {shown.school ? (
            <p className="text-sm text-muted-foreground">{shown.school}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            {shown.classStanding ? (
              <span className="rounded-full border border-border/70 px-2 py-0.5 capitalize">
                {shown.classStanding}
              </span>
            ) : null}
            {shown.gradLabel ? (
              <span className="rounded-full border border-border/70 px-2 py-0.5">
                {shown.gradLabel}
              </span>
            ) : null}
            {shown.roles.length > 0 ? (
              <span className="px-1">
                {shown.roles.map((r) => r.replace(/_/g, " ")).join(" · ")}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
