"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { NameTag, SketchPanel } from "@/components/sketch";
import { WHEEL_LIGHTNESS, hexToHsl, hslToHex, wheelColorAt, type Profile } from "@/lib/profile";

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

/** Where players pick their name color. It's saved on this device and shown to others in a room. */
export function ProfileCard({
  name,
  icon,
  profile,
  onChange,
}: {
  name: string;
  // The partner Pokémon's sprite, shown on the preview tag once you've joined a room.
  icon?: string | null;
  profile: Profile;
  onChange: (update: Partial<Profile>) => void;
}) {
  return (
    <SketchPanel className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.25em] text-ink-soft">Your trainer</p>
          <p className="font-hand text-xl font-bold leading-tight">Pick your color</p>
        </div>
        <NameTag label={name} color={profile.color} icon={icon} size="md" className="mt-1 max-w-[45%]" />
      </div>

      <div className="mt-4 flex flex-col items-center gap-2">
        <ColorWheel color={profile.color} onChange={(color) => onChange({ color })} />
        <p className="text-xs text-ink-soft">Tap the wheel to pick a color</p>
      </div>
    </SketchPanel>
  );
}
