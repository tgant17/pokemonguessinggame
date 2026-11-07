"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { SketchFrame, useBoil } from "@/components/sketch";
import { INTRO_COUNTDOWN_MS } from "@/lib/game";

// The numbers, as hand-authored pen strokes on a 100×100 grid. Each is drawn in as if by a stylus.
const DIGIT_STROKES: Record<3 | 2 | 1, string[]> = {
  3: ["M31 26C37 15 60 11 68 23C74 33 66 45 48 48C66 48 76 57 75 69C74 84 51 91 30 80"],
  2: ["M29 33C31 18 57 10 68 22C78 34 66 50 52 62C42 71 34 77 28 84C44 82 60 82 74 84"],
  // The pen goes up the flag, then straight down the stem.
  1: ["M38 30C45 26 51 21 55 13C54 39 54 63 55 87"],
};

// "Go!" on a 130×100 grid. The dot of the "!" is a near-zero-length stroke, so its round cap makes a dot.
const GO_STROKES = [
  "M52 27C45 15 22 14 14 35C7 56 20 77 38 75C49 74 55 65 54 54C47 54 41 54 35 55",
  "M86 50C73 46 64 57 68 69C72 80 88 80 92 67C95 57 90 49 81 50",
  "M118 19C117 33 116 45 115 58",
  "M114.6 75L114.7 75.4",
];
// Little action lines bursting out around "Go!".
const GO_BURST = ["M-6 8L-12 1", "M-8 44L-14 45", "M-4 80L-10 86", "M134 6L140 -1", "M137 46L144 47", "M134 82L140 88"];

const STEPS = [3, 2, 1] as const;
const STEP_MS = INTRO_COUNTDOWN_MS / STEPS.length;
// How long "Go!" stays up while it fades away. The round has already started by then, so it's short.
const GO_MS = 650;
// How long each number takes to shrink away before the next one replaces it.
const EXIT_MS = 160;

// While a number is up it "boils": it shifts a little a few times a second, like a hand-drawn animation
// where every frame is traced again. Each entry is [rotation in degrees, x, y].
const WIGGLE: [number, number, number][] = [
  [-1.6, 0.6, -0.4],
  [1.3, -0.5, 0.5],
  [-0.4, 0.3, 0.7],
  [1.7, -0.2, -0.6],
];

type CountdownIntroProps = {
  // Small print under the count, e.g. the mode, rounds and timer.
  caption: string;
  // Called as "Go!" appears: the first round can start.
  onGo: () => void;
  // Called once "Go!" has faded away.
  onDone: () => void;
};

// The 3-2-1 that opens every game, drawn over the top screen. Its parent needs to be positioned.
export function CountdownIntro({ caption, onGo, onDone }: CountdownIntroProps) {
  // 0, 1, 2 show 3, 2, 1; 3 is "Go!".
  const [step, setStep] = useState(0);
  const go = step === STEPS.length;

  // Starting a game from the bottom of a long setup screen can leave the top screen scrolled out of view.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    rootRef.current?.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }, []);

  // The timers run once from when the countdown appears, so re-renders mustn't restart them.
  const callbacks = useRef({ onGo, onDone });
  useEffect(() => {
    callbacks.current = { onGo, onDone };
  });
  useEffect(() => {
    const timers = [
      ...STEPS.slice(1).map((_, index) => setTimeout(() => setStep(index + 1), STEP_MS * (index + 1))),
      setTimeout(() => {
        setStep(STEPS.length);
        callbacks.current.onGo();
      }, INTRO_COUNTDOWN_MS),
      setTimeout(() => callbacks.current.onDone(), INTRO_COUNTDOWN_MS + GO_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const boil = useBoil(!go, 130);
  const [angle, dx, dy] = WIGGLE[boil % WIGGLE.length];
  const label = go ? "Go!" : String(STEPS[step]);

  return (
    <div
      ref={rootRef}
      className={`absolute inset-0 z-10 isolate flex flex-col items-center justify-center gap-4 px-4 ${go ? "pointer-events-none" : ""}`}
    >
      {/* Inset and rounded so it stays inside the box's hand-drawn outline. */}
      <div
        aria-hidden="true"
        className={`countdown-backdrop absolute inset-[7px] -z-10 rounded-[14px] ${go ? "countdown-backdrop-out" : ""}`}
      />
      <span role="status" aria-live="assertive" className="sr-only">
        {label}
      </span>

      {go ? (
        <div aria-hidden="true" className="countdown-go flex h-40 items-center justify-center sm:h-48">
          <svg viewBox="-20 -14 170 116" className="h-32 w-auto overflow-visible text-ink sm:h-40">
            {GO_STROKES.map((d) => (
              <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {GO_BURST.map((d, index) => (
              <path
                key={d}
                d={d}
                fill="none"
                stroke="currentColor"
                strokeWidth={5}
                strokeLinecap="round"
                pathLength={1}
                className="sketch-draw"
                style={{ animationDuration: "0.22s", animationDelay: `${60 + index * 25}ms` }}
              />
            ))}
          </svg>
        </div>
      ) : (
        <div
          key={step}
          aria-hidden="true"
          className="countdown-step relative isolate flex h-40 w-40 items-center justify-center sm:h-48 sm:w-48"
          style={{ "--countdown-exit-at": `${STEP_MS - EXIT_MS}ms` } as CSSProperties}
        >
          {/* A fresh circle for every number, re-traced a few times a second while it's up. */}
          <SketchFrame radius={999} wobble={2.4} strokeWidth={4.5} fill="paper" seed={step * 31 + (boil % 3)} draw />
          <svg
            viewBox="0 0 100 100"
            className="h-24 w-24 overflow-visible text-ink sm:h-28 sm:w-28"
            style={{ transform: `translate(${dx}px, ${dy}px) rotate(${angle}deg)` }}
          >
            {DIGIT_STROKES[STEPS[step]].map((d) => (
              <path
                key={d}
                d={d}
                fill="none"
                stroke="currentColor"
                strokeWidth={10}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                className="sketch-draw"
                style={{ animationDuration: "0.42s", animationDelay: "60ms" }}
              />
            ))}
          </svg>
        </div>
      )}

      <div aria-hidden="true" className={`text-center transition-opacity duration-200 ${go ? "opacity-0" : ""}`}>
        <p className="font-hand text-3xl font-bold leading-none">Get ready!</p>
        <p className="mt-1.5 text-sm text-ink-soft">{caption}</p>
      </div>
    </div>
  );
}
