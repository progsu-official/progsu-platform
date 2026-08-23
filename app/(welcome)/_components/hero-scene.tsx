"use client";

import { useEffect, useRef, useState } from "react";

import { GoogleCtaButton } from "./google-cta-button";
import { COMMUNITY_STATS, DOT_COUNT, DOT_LETTERS, DOT_PALETTE } from "./welcome-data";

// Ported from the standalone prototype's scroll-coalescence scene: DOT_COUNT
// dots scatter across the stage on load, idle-floating, then travel into a
// rotating 3D sphere (Fibonacci-sphere distribution, real X/Y rotation, z
// depth driving scale/opacity/stacking) as the section scrolls through its
// pinned range, holding gathered (not unpinning) once progress passes 72% of
// the scroll range. It's the SAME dots the whole way through -- not a
// separate dot set crossfading in -- so a face you were tracking while
// scattered is still that face once it settles onto the sphere. Once fully
// gathered, the sphere keeps auto-rotating and takes mouse-drag (see
// onPointerDown -- gated to the held plateau so a drag mid-gather can't spin
// a sphere that hasn't finished forming). Positions are written straight to
// element style in one rAF loop -- not React state -- matching the
// imperative-paint pattern already used by
// app/members/_components/member-constellation.tsx for the same reason: a
// re-render per animation frame across dozens of nodes is a dropped-frame
// machine.

const BASE = 60; // px, must match .dot { width; height } in welcome.css
const COLS = 10;
const ROWS = 6; // COLS * ROWS === DOT_COUNT

// Vertical center of the gathered sphere, as a fraction of stage height.
// Tuned together with .hero-community's `top` in welcome.css so the sphere
// clears the fixed nav above it and the community heading below it.
const SPHERE_CENTER_Y = 0.32;
// Scaled up a bit from the 42-dot tuning (115) so the extra dots don't just
// pile up denser at the same radius -- but not scaled all the way up, since
// the sphere has to fit between the fixed nav and the community heading.
const SPHERE_RADIUS = 124;
const SPHERE_SCALE_MIN = 0.4;
const SPHERE_SCALE_MAX = 0.85;
const SPHERE_OPACITY_MIN = 0.45;
const SPHERE_OPACITY_MAX = 1;

const AUTO_ROTATE_SPEED = 0.12; // deg/frame
const DRAG_SENSITIVITY = 0.5;
const MOMENTUM_DECAY = 0.95;
const MAX_ROTATION_SPEED = 5;

type DotParams = {
  fx: number;
  fy: number; // scatter position, px (recomputed on resize)
  gx: number;
  gy: number; // scatter position, fraction of stage size
  theta: number;
  phi: number; // position on the Fibonacci sphere
  amp: number; // idle float amplitude
  spd: number; // idle float speed
  ph: number; // idle float phase
  scale: number; // per-dot scatter size variety
};

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function ease(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function degToRad(d: number) {
  return d * (Math.PI / 180);
}
function normalizeAngle(angle: number) {
  let a = angle;
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
}
function clampSpeed(v: number) {
  return Math.max(-MAX_ROTATION_SPEED, Math.min(MAX_ROTATION_SPEED, v));
}

function generateParams(): DotParams[] {
  const params: DotParams[] = Array.from({ length: DOT_COUNT }, () => ({
    fx: 0,
    fy: 0,
    gx: 0,
    gy: 0,
    theta: 0,
    phi: 0,
    amp: 6 + Math.random() * 10,
    spd: 0.6 + Math.random() * 0.8,
    ph: Math.random() * Math.PI * 2,
    scale: 0.5 + Math.random() * 0.55,
  }));

  // Scatter: a jittered grid so dots fill the stage evenly rather than
  // clumping from pure randomness.
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) cells.push([c, r]);
  }
  for (let i = cells.length - 1; i > 0; i -= 1) {
    const j = (Math.random() * (i + 1)) | 0;
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  params.forEach((d, i) => {
    const [c, r] = cells[i % cells.length];
    d.gx = 0.07 + ((c + 0.5) / COLS) * 0.86 + (Math.random() - 0.5) * 0.06;
    d.gy = 0.1 + ((r + 0.5) / ROWS) * 0.82 + (Math.random() - 0.5) * 0.06;
  });

  // Sphere: pure Fibonacci distribution for even coverage -- no pole bonus,
  // no jitter, so every dot sits an equal angular distance from its
  // neighbors all the way to the poles.
  const goldenAngle = (2 * Math.PI) / ((1 + Math.sqrt(5)) / 2);
  params.forEach((d, i) => {
    const t = i / DOT_COUNT;
    const inclination = Math.acos(1 - 2 * t);
    const azimuth = goldenAngle * i;

    d.phi = inclination * (180 / Math.PI);
    d.theta = (azimuth * (180 / Math.PI)) % 360;
  });

  return params;
}

export function HeroScene() {
  const sceneRef = useRef<HTMLElement>(null);
  const dotfieldRef = useRef<HTMLDivElement>(null);
  const dotRefs = useRef<Array<HTMLDivElement | null>>([]);
  const heroMainRef = useRef<HTMLDivElement>(null);
  const communityRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);

  const paramsRef = useRef<DotParams[]>([]);
  const progressRef = useRef(0);
  const reducedRef = useRef(false);
  const centerRef = useRef({ x: 0, y: 0 });
  const frameRef = useRef<number | null>(null);

  // Sphere rotation, once gathered: auto-rotate plus mouse-drag with
  // momentum (touch excluded -- see onPointerDown).
  const rotationRef = useRef({ x: 15, y: 15 });
  const velocityRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const lastPointRef = useRef({ x: 0, y: 0 });

  const [ready, setReady] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reducedRef.current = reduced;
    paramsRef.current = generateParams();

    function layout() {
      const field = dotfieldRef.current;
      if (!field) return;
      const w = field.clientWidth;
      const h = field.clientHeight;
      centerRef.current = { x: w * 0.5, y: h * SPHERE_CENTER_Y };
      paramsRef.current.forEach((d) => {
        d.fx = d.gx * w;
        d.fy = d.gy * h;
      });
    }

    function readScroll() {
      const scene = sceneRef.current;
      if (!scene) return;
      const total = Math.max(1, scene.offsetHeight - window.innerHeight);
      progressRef.current = clamp(-scene.getBoundingClientRect().top / (total * 0.72), 0, 1);
    }

    function render(t: number) {
      const p = ease(progressRef.current);

      if (!draggingRef.current && !reducedRef.current) {
        rotationRef.current = {
          x: normalizeAngle(rotationRef.current.x + velocityRef.current.x),
          y: normalizeAngle(rotationRef.current.y + AUTO_ROTATE_SPEED + velocityRef.current.y),
        };
        velocityRef.current.x *= MOMENTUM_DECAY;
        velocityRef.current.y *= MOMENTUM_DECAY;
      }
      const rxRad = degToRad(rotationRef.current.x);
      const ryRad = degToRad(rotationRef.current.y);

      const gxo = Math.sin(t * 0.0006) * 9;
      const gyo = Math.cos(t * 0.0005) * 9;

      paramsRef.current.forEach((d, i) => {
        const el = dotRefs.current[i];
        if (!el) return;

        // Sphere position for this dot, rotated by the current auto-rotate
        // / drag angle.
        const thetaRad = degToRad(d.theta);
        const phiRad = degToRad(d.phi);
        let sx = SPHERE_RADIUS * Math.sin(phiRad) * Math.cos(thetaRad);
        let sy = SPHERE_RADIUS * Math.cos(phiRad);
        let sz = SPHERE_RADIUS * Math.sin(phiRad) * Math.sin(thetaRad);

        const x1 = sx * Math.cos(ryRad) + sz * Math.sin(ryRad);
        const z1 = -sx * Math.sin(ryRad) + sz * Math.cos(ryRad);
        sx = x1;
        sz = z1;

        const y2 = sy * Math.cos(rxRad) - sz * Math.sin(rxRad);
        const z2 = sy * Math.sin(rxRad) + sz * Math.cos(rxRad);
        sy = y2;
        sz = z2;

        // Depth (0 = far side, 1 = near side) drives scale, opacity, and
        // stacking once gathered -- this is what reads as a sphere rather
        // than a flat rotating disc.
        const depth = (sz + SPHERE_RADIUS) / (2 * SPHERE_RADIUS);
        const sphereScale = SPHERE_SCALE_MIN + depth * (SPHERE_SCALE_MAX - SPHERE_SCALE_MIN);
        const sphereOpacity =
          SPHERE_OPACITY_MIN + depth * (SPHERE_OPACITY_MAX - SPHERE_OPACITY_MIN);

        const x = lerp(d.fx, centerRef.current.x + sx, p);
        const y = lerp(d.fy, centerRef.current.y + sy, p);

        const idle = 1 - p;
        const ix = Math.sin(t * 0.001 * d.spd + d.ph) * d.amp * idle;
        const iy = Math.cos(t * 0.001 * d.spd * 0.9 + d.ph) * d.amp * idle;
        const fx = ix + gxo * p;
        const fy = iy + gyo * p;

        const s = lerp(d.scale, sphereScale, p);
        const o = lerp(1, sphereOpacity, p);

        el.style.transform = `translate(${(x + fx - BASE / 2).toFixed(2)}px, ${(y + fy - BASE / 2).toFixed(2)}px) scale(${s.toFixed(3)})`;
        el.style.opacity = o.toFixed(3);
        el.style.zIndex = String(Math.round(1000 + sz * p));
      });

      const fade = clamp(1 - progressRef.current / 0.35, 0, 1);
      const heroMain = heroMainRef.current;
      if (heroMain) {
        heroMain.style.opacity = String(fade);
        heroMain.style.transform = `translate(-50%,-50%) translateY(${(-(1 - fade) * 24).toFixed(1)}px)`;
        heroMain.style.pointerEvents = fade < 0.15 ? "none" : "";
        if (fade < 0.15) heroMain.setAttribute("aria-hidden", "true");
        else heroMain.removeAttribute("aria-hidden");
      }

      const co = clamp((progressRef.current - 0.5) / 0.4, 0, 1);
      const community = communityRef.current;
      if (community) {
        community.style.opacity = String(co);
        community.style.transform = `translate(-50%,-50%) translateY(${((1 - co) * 18).toFixed(1)}px)`;
        community.style.pointerEvents = co < 0.85 ? "none" : "";
        if (co < 0.85) community.setAttribute("aria-hidden", "true");
        else community.removeAttribute("aria-hidden");
      }

      const hint = hintRef.current;
      if (hint) hint.style.opacity = String(clamp(1 - progressRef.current / 0.12, 0, 1));
    }

    function loop(t: number) {
      render(t);
      frameRef.current = requestAnimationFrame(loop);
    }

    layout();
    setReady(true);

    if (reduced) {
      if (sceneRef.current) sceneRef.current.style.height = "100vh";
      progressRef.current = 1;
      render(performance.now());
    } else {
      readScroll();
      frameRef.current = requestAnimationFrame(loop);
    }

    const onScroll = () => {
      if (!reducedRef.current) readScroll();
    };
    const onResize = () => {
      layout();
      if (reducedRef.current) render(performance.now());
      else readScroll();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    // Mouse-only drag-to-rotate, gated to the held plateau (progress ~1) so
    // a drag mid-gather can't spin a sphere that hasn't finished forming.
    // Touch is deliberately excluded, same reason as elsewhere on this page:
    // a touch drag here is the visitor's scroll gesture, not a rotate gesture.
    const onPointerDown = (e: PointerEvent) => {
      if (reducedRef.current || e.pointerType === "touch" || progressRef.current < 0.95) return;
      draggingRef.current = true;
      velocityRef.current = { x: 0, y: 0 };
      lastPointRef.current = { x: e.clientX, y: e.clientY };
      if (dotfieldRef.current) dotfieldRef.current.style.cursor = "grabbing";
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - lastPointRef.current.x;
      const dy = e.clientY - lastPointRef.current.y;
      const dRot = { x: clampSpeed(-dy * DRAG_SENSITIVITY), y: clampSpeed(dx * DRAG_SENSITIVITY) };
      rotationRef.current = {
        x: normalizeAngle(rotationRef.current.x + dRot.x),
        y: normalizeAngle(rotationRef.current.y + dRot.y),
      };
      velocityRef.current = dRot;
      lastPointRef.current = { x: e.clientX, y: e.clientY };
    };
    const endDrag = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (dotfieldRef.current) dotfieldRef.current.style.cursor = "";
    };
    const dotfield = dotfieldRef.current;
    dotfield?.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      dotfield?.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return (
    <section className="scene" ref={sceneRef}>
      <div className="sticky">
        <div className={`dotfield${ready ? " ready" : ""}`} ref={dotfieldRef} aria-hidden>
          {Array.from({ length: DOT_COUNT }).map((_, i) => {
            const solid = i % 7 === 3;
            return (
              <div
                key={i}
                className="dot"
                ref={(el) => {
                  dotRefs.current[i] = el;
                }}
                style={{ background: DOT_PALETTE[i % DOT_PALETTE.length] }}
              >
                {solid ? "" : DOT_LETTERS[i % DOT_LETTERS.length]}
              </div>
            );
          })}
        </div>

        <div className="hero-text hero-main" ref={heroMainRef}>
          <div className="scrim" aria-hidden />
          <div className="hero-brand">
            progsu <span className="beta">beta</span>
          </div>
          <h1>
            show up.
            <br />
            build profile.
            <br />
            <span className="accent">get noticed.</span>
          </h1>
          <div className="cta-wrap">
            <GoogleCtaButton />
            <div className="hero-desc">
              only takes a few seconds.
              <br />
              we&apos;re in beta, expect fresh paint and moving parts.
            </div>
          </div>
        </div>

        <div className="hero-text hero-community" ref={communityRef}>
          <div className="scrim" aria-hidden />
          <h2>
            join a community of <span className="accent">{COMMUNITY_STATS.memberCount}</span>{" "}
            students.
          </h2>
          <p>
            progsu is one of the largest cs communities at gsu, spread across four campuses.
            bigger community, better odds: more events to show up to, more builders to learn
            from, and more recruiters and sponsors watching who does.
          </p>
          <div className="bene-row">
            <div className="bene">
              <b>{COMMUNITY_STATS.hacklantaBuilders}</b>
              <span>builders at hacklanta</span>
            </div>
            <div className="bene">
              <b>{COMMUNITY_STATS.internshipsLanded}</b>
              <span>first internships landed</span>
            </div>
            <div className="bene">
              <b>{COMMUNITY_STATS.campuses}</b>
              <span>campuses</span>
            </div>
          </div>
          <GoogleCtaButton />
        </div>

        <div className="scroll-hint" ref={hintRef} aria-hidden>
          <span>scroll</span>
          <span className="bar" />
        </div>
      </div>
    </section>
  );
}
