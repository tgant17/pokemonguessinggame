"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { NameTag, SketchFrame, SketchPanel } from "@/components/sketch";
import { WHEEL_LIGHTNESS, hexToHsl, hslToHex, wheelColorAt } from "@/lib/profile";
import { MAX_NAME_LENGTH, clampName, cleanName, nameLength } from "@/lib/protocol";

// The full hue circle at the wheel's lightness, starting from red at the top (matches wheelColorAt).
const HUE_STOPS = Array.from({ length: 13 }, (_, i) => `hsl(${i * 30} 100% ${WHEEL_LIGHTNESS}%)`).join(", ");
const WHEEL_BACKGROUND = `radial-gradient(circle closest-side, hsl(0 0% ${WHEEL_LIGHTNESS}%), transparent), conic-gradient(${HUE_STOPS})`;

/** A round color picker: click or drag anywhere on it; arrow keys nudge hue (left/right) and strength (up/down). */
export function ColorWheel({ color, onChange, size = 132 }: { color: string | null; onChange: (hex: string) => void; size?: number }) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const { hue, saturation } = color ? hexToHsl(color) : { hue: 0, saturation: 0 };
  // The marker sits where this color is on the wheel.
  const angle = (hue * Math.PI) / 180;
  const distance = (saturation / 100) * (size / 2);
  const markerX = size / 2 + Math.sin(angle) * distance;
  const markerY = size / 2 - Math.cos(angle) * distance;

  const pickAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = wheelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const radius = rect.width / 2;
    onChange(wheelColorAt(event.clientX - rect.left - radius, event.clientY - rect.top - radius, radius).hex);
  };

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, [number, number]> = {
      ArrowRight: [10, 0],
      ArrowLeft: [-10, 0],
      ArrowUp: [0, 10],
      ArrowDown: [0, -10],
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const nextHue = (hue + step[0] + 360) % 360;
    const nextSaturation = Math.max(0, Math.min(100, saturation + step[1]));
    onChange(hslToHex(nextHue, nextSaturation, WHEEL_LIGHTNESS));
  };

  return (
    <div
      ref={wheelRef}
      role="slider"
      tabIndex={0}
      aria-label="Your color"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={Math.round(hue)}
      aria-valuetext={color ?? "none"}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        pickAt(event);
      }}
      onPointerMove={(event) => dragging.current && pickAt(event)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      onKeyDown={handleKey}
      className="relative shrink-0 cursor-crosshair touch-none rounded-full border-2 border-ink focus:outline-none focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
      style={{ width: size, height: size, background: WHEEL_BACKGROUND }}
    >
      {color && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-ink shadow-[0_0_0_2px_var(--paper)]"
          style={{ left: markerX, top: markerY, background: color }}
        />
      )}
    </div>
  );
}

type NameTagEditorProps = {
  // What the tag shows (falls back to "You" when no name is set).
  label: string;
  icon?: string | null;
  // The name being edited, which may be empty.
  name: string;
  // Called as you type, with each usable name. Changes show right away; a room is updated once typing settles.
  onNameChange: (name: string) => void;
  color: string | null;
  onColorChange: (hex: string) => void;
  className?: string;
};

/**
 * Your own name tag, with a small color-wheel dot inside it. Tapping it pops open a box to change your name
 * and color; tapping anywhere else, pressing Escape, or pressing Enter in the name box closes it.
 */
export function NameTagEditor({ label, icon, name, onNameChange, color, onColorChange, className = "" }: NameTagEditorProps) {
  const headingId = useId();
  const counterId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const nameAtOpen = useRef("");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const openEditor = () => {
    nameAtOpen.current = name;
    setDraft(clampName(name));
    setOpen(true);
  };

  const close = useCallback(
    (refocus: boolean) => {
      // A name box left empty puts back the name you had, rather than keeping the last letter you deleted down to.
      if (!cleanName(draft) && name !== nameAtOpen.current) onNameChange(nameAtOpen.current);
      setOpen(false);
      if (refocus) buttonRef.current?.focus();
    },
    [draft, name, onNameChange],
  );

  const changeName = (value: string) => {
    const next = clampName(value);
    setDraft(next);
    const usable = cleanName(next);
    if (usable) onNameChange(usable);
  };

  useEffect(() => {
    if (!open) return;
    // Pointer-down rather than click, so a drag that starts on the wheel and ends outside it doesn't close it.
    const closeIfOutside = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, close]);

  // With a mouse, jump straight into the name box. On touch screens that would throw up the keyboard
  // when you may only want a new color, so there it waits for a tap.
  useEffect(() => {
    if (open && window.matchMedia("(pointer: fine)").matches) inputRef.current?.select();
  }, [open]);

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        title="Change your name and color"
        aria-label={`${label}: change your name and color`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close(false) : openEditor())}
        className="group flex max-w-full rounded-[8px] transition-transform hover:-translate-y-px focus:outline-none focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink active:translate-y-px"
      >
        <NameTag label={label} color={color} icon={icon} size="md" className="max-w-full pr-1.5">
          <span
            aria-hidden="true"
            className={`ml-2 h-4 w-4 shrink-0 rounded-full border-[1.5px] border-ink transition-transform duration-200 group-hover:rotate-45 ${
              open ? "rotate-45" : ""
            }`}
            style={{ background: WHEEL_BACKGROUND }}
          />
        </NameTag>
      </button>

      {open && (
        // Anchored to the tag's left edge: the tag sits at the left of the screen, so this stays on-screen on phones.
        <div role="dialog" aria-labelledby={headingId} className="absolute left-0 top-full z-20 mt-2 w-56">
          <SketchPanel radius={16} className="flex flex-col gap-3 p-3.5">
            <p id={headingId} className="font-hand text-xl font-bold leading-none">
              Your name color
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                close(true);
              }}
              className="relative isolate flex items-center gap-2 rounded-[12px] pl-3 pr-2.5 focus-within:outline-dashed focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink"
            >
              <SketchFrame radius={10} wobble={0.8} strokeWidth={2.2} fill="paper" />
              <input
                ref={inputRef}
                value={draft}
                onChange={(event) => changeName(event.target.value)}
                aria-label="Your name"
                aria-describedby={counterId}
                placeholder="Your name"
                autoComplete="nickname"
                autoCapitalize="words"
                spellCheck={false}
                enterKeyHint="done"
                className="h-10 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-faint focus:outline-none"
              />
              <span id={counterId} className="shrink-0 text-xs tabular-nums text-ink-soft">
                {nameLength(draft)}/{MAX_NAME_LENGTH}
                <span className="sr-only"> characters</span>
              </span>
            </form>
            <div className="flex justify-center">
              <ColorWheel color={color} onChange={onColorChange} size={120} />
            </div>
          </SketchPanel>
        </div>
      )}
    </div>
  );
}
