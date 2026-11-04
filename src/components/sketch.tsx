"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

// Hand-drawn drawing primitives: every outline is a single wobbly stroke with round ends,
// like a line drawn with a stylus. Each instance gets its own seed, so no two boxes match.

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Point = [number, number];

const fmt = (value: number) => Math.round(value * 10) / 10;

// Catmull-Rom spline through the points, written out as cubic Béziers.
const smoothPath = (points: Point[], closed: boolean) => {
  if (points.length < 2) return "";
  let d = `M${fmt(points[0][0])} ${fmt(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
};

type SketchRectOptions = {
  radius: number;
  wobble: number;
  strokeWidth: number;
  seed: number;
};

// Traces a rounded rectangle as one pen stroke: it starts somewhere random, wobbles gently,
// drifts slightly as it goes round, and overshoots the start so the ends overlap.
export const sketchRectPaths = (width: number, height: number, { radius, wobble, strokeWidth, seed }: SketchRectOptions) => {
  const rand = mulberry32(seed);
  const pad = strokeWidth / 2 + wobble * 2.1 + 0.5;
  const x0 = pad;
  const y0 = pad;
  const x1 = width - pad;
  const y1 = height - pad;
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 2 || h <= 2) return null;

  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const straightW = w - 2 * r;
  const straightH = h - 2 * r;
  const arc = (Math.PI * r) / 2;
  const segments = [straightW, arc, straightH, arc, straightW, arc, straightH, arc];
  const bounds = [0];
  for (const length of segments) bounds.push(bounds[bounds.length - 1] + length);
  const perimeter = bounds[bounds.length - 1];

  const segmentAt = (local: number) => {
    for (let i = 0; i < segments.length; i += 1) {
      if (local < bounds[i + 1]) return i;
    }
    return segments.length - 1;
  };

  // Base outline point and outward normal at arc-length t.
  const at = (t: number): { x: number; y: number; nx: number; ny: number } => {
    const local = ((t % perimeter) + perimeter) % perimeter;
    const i = segmentAt(local);
    const u = local - bounds[i];
    const corner = (cx: number, cy: number, start: number) => {
      const angle = start + (r > 0 ? u / r : 0);
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      return { x: cx + r * nx, y: cy + r * ny, nx, ny };
    };
    switch (i) {
      case 0:
        return { x: x0 + r + u, y: y0, nx: 0, ny: -1 };
      case 1:
        return corner(x1 - r, y0 + r, -Math.PI / 2);
      case 2:
        return { x: x1, y: y0 + r + u, nx: 1, ny: 0 };
      case 3:
        return corner(x1 - r, y1 - r, 0);
      case 4:
        return { x: x1 - r - u, y: y1, nx: 0, ny: 1 };
      case 5:
        return corner(x0 + r, y1 - r, Math.PI / 2);
      case 6:
        return { x: x0, y: y1 - r - u, nx: -1, ny: 0 };
      default:
        return corner(x0 + r, y0 + r, Math.PI);
    }
  };

  const start = rand() * perimeter;
  const overshoot = Math.min(perimeter * (0.04 + rand() * 0.05), 46);
  const end = start + perimeter + overshoot;

  const waves = [
    { amp: wobble * (0.55 + rand() * 0.25), len: 90 + rand() * 110, phase: rand() * Math.PI * 2 },
    { amp: wobble * (0.25 + rand() * 0.2), len: 28 + rand() * 30, phase: rand() * Math.PI * 2 },
  ];
  const drift = (rand() < 0.5 ? -1 : 1) * wobble * (0.8 + rand() * 0.8);
  const offset = (t: number) =>
    waves.reduce((sum, wave) => sum + wave.amp * Math.sin((t / wave.len) * Math.PI * 2 + wave.phase), 0) +
    drift * ((t - start) / perimeter - 0.5);

  // Sample t values: every segment boundary, plus denser steps around the corners.
  const sampleTs = (from: number, to: number) => {
    const marks = [from];
    const firstLoop = Math.floor(from / perimeter);
    for (let loop = firstLoop; loop * perimeter < to; loop += 1) {
      for (const bound of bounds) {
        const value = loop * perimeter + bound;
        if (value > from && value < to) marks.push(value);
      }
    }
    marks.push(to);
    marks.sort((a, b) => a - b);
    const ts: number[] = [from];
    for (let i = 0; i < marks.length - 1; i += 1) {
      const a = marks[i];
      const b = marks[i + 1];
      const length = b - a;
      if (length < 0.01) continue;
      const isArc = segmentAt((((a + b) / 2) % perimeter + perimeter) % perimeter) % 2 === 1;
      const step = isArc ? Math.max(3, arc / 5) : 26;
      const count = Math.max(1, Math.ceil(length / step));
      for (let k = 1; k <= count; k += 1) ts.push(a + (length * k) / count);
    }
    return ts;
  };

  const toPoint = (t: number): Point => {
    const base = at(t);
    const o = offset(t);
    return [base.x + base.nx * o, base.y + base.ny * o];
  };

  const stroke = smoothPath(sampleTs(start, end).map(toPoint), false);
  const fill = smoothPath(sampleTs(start, start + perimeter).map(toPoint), true);
  return { stroke, fill };
};

export type SketchFill = "none" | "paper" | "ink" | "ruled" | "hatch" | "chrome" | (string & {});

type SketchFrameProps = {
  radius?: number;
  wobble?: number;
  strokeWidth?: number;
  fill?: SketchFill;
  stroke?: string;
  seed?: number;
  /** Animate the outline being drawn in when it first appears. */
  draw?: boolean;
  /** Dotted outline, for placeholders and disabled controls. */
  dotted?: boolean;
  /** Trace the outline a second time, like going over it again with the pen. */
  traced?: boolean;
  className?: string;
};

const FILL_COLORS: Record<string, string> = {
  paper: "var(--paper)",
  ink: "var(--ink)",
  chrome: "var(--chrome-soft)",
};

/**
 * A hand-drawn outline that fills its nearest positioned parent.
 * The parent needs `relative isolate` so the drawing sits behind its content.
 */
export function SketchFrame({
  radius = 14,
  wobble = 1.1,
  strokeWidth = 2.5,
  fill = "none",
  stroke = "var(--ink)",
  seed,
  draw = false,
  dotted = false,
  traced = false,
  className = "",
}: SketchFrameProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useIsoLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      setSize((prev) => (prev && Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5 ? prev : { w, h }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  const baseSeed = seed ?? hashString(id);
  const options = { radius, wobble, strokeWidth, seed: baseSeed };
  const paths = size ? sketchRectPaths(size.w, size.h, options) : null;
  const tracedPaths = size && traced ? sketchRectPaths(size.w, size.h, { ...options, seed: baseSeed + 7919 }) : null;

  const patternId = `sk-${id}`;
  const fillValue =
    fill === "ruled" || fill === "hatch" ? `url(#${patternId})` : fill === "none" ? "none" : (FILL_COLORS[fill] ?? fill);

  return (
    <svg
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 -z-10 h-full w-full overflow-visible ${className}`}
    >
      {fill === "ruled" && (
        <defs>
          <pattern id={patternId} patternUnits="userSpaceOnUse" width="8" height="20">
            <rect width="8" height="20" fill="var(--paper)" />
            <line x1="0" x2="8" y1="19.5" y2="19.5" stroke="var(--rule)" strokeWidth="1" />
          </pattern>
        </defs>
      )}
      {fill === "hatch" && (
        <defs>
          <pattern id={patternId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(-45)">
            <rect width="6" height="6" fill="var(--paper)" />
            <line x1="0" x2="0" y1="0" y2="6" stroke="var(--ink)" strokeWidth="2.2" />
          </pattern>
        </defs>
      )}
      {paths && (
        <>
          {fill !== "none" && <path d={paths.fill} fill={fillValue} className={`sketch-fill sketch-fill-${fill}`} />}
          <path
            d={paths.stroke}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={dotted ? `0.1 ${strokeWidth * 2.6}` : undefined}
            pathLength={draw && !dotted ? 1 : undefined}
            className={draw && !dotted ? "sketch-draw" : undefined}
          />
          {tracedPaths && (
            <path
              d={tracedPaths.stroke}
              fill="none"
              stroke={stroke}
              strokeWidth={strokeWidth * 0.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </>
      )}
    </svg>
  );
}

type IconName = "check" | "cross" | "clock" | "bolt" | "send" | "pokeball" | "star" | "arrowDown";

// Hand-authored strokes on a 24×24 grid, drawn with round caps like the outlines.
const ICON_STROKES: Record<IconName, string[]> = {
  check: ["M4.2 13.2c1.9 1.5 3.5 3.3 4.9 5.6 2.7-5.6 6.3-10 10.8-13.6"],
  cross: ["M5.6 5.4c4.3 4.1 8.6 8.6 12.9 13.3", "M18.7 5.2c-4.7 4.3-9.1 8.9-13.3 13.8"],
  clock: [
    "M12.3 3.4c-4.9-.2-8.8 3.5-8.9 8.3-.1 4.9 3.7 8.8 8.5 8.9 4.9.1 8.7-3.6 8.8-8.4.1-4.6-3.4-8.6-8.1-8.9",
    "M12 7.3v5.1l3.4 2.1",
  ],
  bolt: ["M13.6 2.8 6 13.3h5.6l-1.5 7.9 7.9-10.8h-5.7l1.3-7.6z"],
  send: ["M3.8 12.2c4.9-.1 10-.1 15.2.1", "M13.6 6.4c1.9 2 3.7 3.9 5.6 5.9-1.9 1.9-3.8 3.7-5.7 5.6"],
  pokeball: [
    "M12.2 3c-5-.2-9 3.7-9.1 8.7-.1 5 3.8 9.1 8.8 9.2 5 .1 9-3.8 9.1-8.8.1-4.8-3.6-8.8-8.4-9.1",
    "M3.3 12c2.6-.1 4.9 0 6.2 0M14.6 12c2 0 4 0 6.1-.1",
    "M12.1 9.4c-1.5 0-2.7 1.2-2.7 2.6 0 1.5 1.2 2.7 2.7 2.7 1.5 0 2.6-1.2 2.6-2.6 0-1.5-1.1-2.7-2.6-2.7",
  ],
  star: ["M12 3.6l2.5 5.6 6 .6-4.6 4 1.4 6-5.3-3.2-5.3 3.2 1.4-6-4.6-4 6-.6z"],
  arrowDown: ["M12.2 4c-.1 5.3-.1 10.4 0 15.6", "M6.6 14.2c1.9 1.9 3.8 3.8 5.6 5.6 1.8-1.9 3.6-3.7 5.5-5.5"],
};

type SketchIconProps = {
  name: IconName;
  className?: string;
  strokeWidth?: number;
  draw?: boolean;
  filled?: boolean;
};

export function SketchIcon({ name, className = "h-5 w-5", strokeWidth = 2.4, draw = false, filled = false }: SketchIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 overflow-visible ${className}`}>
      {ICON_STROKES[name].map((d, index) => (
        <path
          key={d}
          d={d}
          fill={filled ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={draw ? 1 : undefined}
          className={draw ? "sketch-draw" : undefined}
          style={draw ? { animationDelay: `${index * 140}ms` } : undefined}
        />
      ))}
    </svg>
  );
}

/** A wavy line scribbled across its parent, for crossing out a wrong pick. */
export function SketchStrike({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`pointer-events-none absolute -left-1 top-1/2 h-3 w-[calc(100%+0.5rem)] -translate-y-1/2 overflow-visible ${className}`}
    >
      <path
        d="M1 6.2C14 3.4 24 7.8 38 5.2S62 3.1 74 5.6 90 6.6 99 3.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        className="sketch-draw"
      />
    </svg>
  );
}

/** A loose hand-drawn underline that stretches to the width of its parent. */
export function SketchUnderline({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true" className={`overflow-visible ${className}`}>
      <path
        d="M3 8.5C30 5.2 58 4.6 92 5.6s70 1.2 104-1.8M24 10.4c34-2.6 78-3.3 128-2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        className="sketch-draw"
      />
    </svg>
  );
}

/** A single slightly uneven rule across the full width, for separating sections. */
export function SketchLine({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 6" preserveAspectRatio="none" aria-hidden="true" className={`block w-full overflow-visible ${className}`}>
      <path
        d="M2 3.6C58 2.3 112 4.2 162 3.1S248 2.4 298 3.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Re-rolls a seed a few times a second while active, so a drawing "boils" like hand animation. */
export function useBoil(active: boolean, interval = 180) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setTick((prev) => prev + 1), interval);
    return () => clearInterval(timer);
  }, [active, interval]);
  return active ? tick : 0;
}

type NameTagProps = {
  label: string;
  color?: string;
  className?: string;
  size?: "sm" | "md";
};

/** A colored name tag, the only place team colors appear. */
export function NameTag({ label, color, className = "", size = "sm" }: NameTagProps) {
  return (
    <span
      className={`relative isolate inline-flex shrink-0 items-center font-pixel leading-none text-ink ${
        size === "md" ? "h-7 px-3 text-base" : "h-6 px-2.5 text-sm"
      } ${className}`}
    >
      <SketchFrame radius={7} wobble={0.6} strokeWidth={2} fill={color ?? "paper"} />
      {label}
    </span>
  );
}

export function SketchPanel({
  children,
  className = "",
  fill = "paper",
  radius = 18,
  draw = false,
}: {
  children: ReactNode;
  className?: string;
  fill?: SketchFill;
  radius?: number;
  draw?: boolean;
}) {
  return (
    <div className={`relative isolate ${className}`}>
      <SketchFrame radius={radius} wobble={1.5} strokeWidth={3} fill={fill} draw={draw} />
      {children}
    </div>
  );
}
