"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { SketchPanel } from "@/components/sketch";
import { WHEEL_LIGHTNESS, hexToHsl, hslToHex, wheelColorAt } from "@/lib/profile";

// The full hue circle at the wheel's lightness, starting from red at the top (matches wheelColorAt).
const HUE_STOPS = Array.from({ length: 13 }, (_, i) => `hsl(${i * 30} 100% ${WHEEL_LIGHTNESS}%)`).join(", ");
const WHEEL_BACKGROUND = `radial-gradient(circle closest-side, hsl(0 0% ${WHEEL_LIGHTNESS}%), transparent), conic-gradient(${HUE_STOPS})`;

/** A round color picker: click or drag anywhere on it; arrow keys nudge hue (left/right) and strength (up/down). */
export function ColorWheel({
  color,
  onChange,
  size = 132,
  autoFocus = false,
}: {
  color: string | null;
  onChange: (hex: string) => void;
  size?: number;
  autoFocus?: boolean;
}) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const { hue, saturation } = color ? hexToHsl(color) : { hue: 0, saturation: 0 };
  // The marker sits where this color is on the wheel.
  const angle = (hue * Math.PI) / 180;
  const distance = (saturation / 100) * (size / 2);
  const markerX = size / 2 + Math.sin(angle) * distance;
  const markerY = size / 2 - Math.cos(angle) * distance;

  useEffect(() => {
    if (autoFocus) wheelRef.current?.focus();
  }, [autoFocus]);

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

/**
 * A small color-wheel button that sits next to your name tag. Tapping it pops the full wheel open below it;
 * tapping anywhere else or pressing Escape closes it. The color is saved on this device and shown to others in a room.
 */
export function ColorPickerButton({ color, onChange }: { color: string | null; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Pointer-down rather than click, so a drag that starts on the wheel and ends outside it doesn't close it.
    const closeIfOutside = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Change your color"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`h-6 w-6 rounded-full border-2 border-ink transition-transform duration-200 hover:rotate-45 focus:outline-none focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
          open ? "rotate-45" : ""
        }`}
        style={{ background: WHEEL_BACKGROUND }}
      />
      {open && (
        // Centered under the button: it sits on the left half of the screen, so this stays on-screen even on narrow phones.
        <div role="dialog" aria-label="Pick your color" className="absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2">
          <SketchPanel radius={16} className="flex flex-col items-center gap-2 p-3">
            <ColorWheel color={color} onChange={onChange} size={120} autoFocus />
            <p className="whitespace-nowrap text-xs text-ink-soft">Your name color</p>
          </SketchPanel>
        </div>
      )}
    </div>
  );
}
