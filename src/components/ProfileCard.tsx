"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { NameTag, SketchFrame, SketchIcon, SketchPanel } from "@/components/sketch";
import { formatName } from "@/lib/game";
import { WHEEL_LIGHTNESS, hexToHsl, hslToHex, pokemonIconUrl, wheelColorAt, type Profile } from "@/lib/profile";

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

/** Where players pick their color and partner Pokémon. Both are saved on this device and shown to others in a room. */
export function ProfileCard({
  name,
  profile,
  onChange,
  pokemonNames,
}: {
  name: string;
  profile: Profile;
  onChange: (update: Partial<Profile>) => void;
  pokemonNames: string[];
}) {
  const listId = useId();
  const partnerName = profile.pokemonId ? pokemonNames[profile.pokemonId - 1] : undefined;
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (partnerName ? formatName(partnerName) : "");

  // Matches typed text to a Pokémon, ignoring case, spaces and dashes ("mr mime" finds mr-mime).
  const findPokemon = (text: string) => {
    const wanted = text.trim().toLowerCase().replace(/[\s-]+/g, "-");
    if (!wanted) return null;
    const index = pokemonNames.indexOf(wanted);
    return index >= 0 ? index + 1 : null;
  };

  const choosePartner = (text: string) => {
    setDraft(text);
    const id = findPokemon(text);
    if (id) {
      onChange({ pokemonId: id });
      setDraft(null);
    }
  };

  const randomPartner = () => {
    if (!pokemonNames.length) return;
    setDraft(null);
    onChange({ pokemonId: Math.floor(Math.random() * pokemonNames.length) + 1 });
  };

  return (
    <SketchPanel className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.25em] text-ink-soft">Your trainer</p>
          <p className="font-hand text-xl font-bold leading-tight">Pick your color and partner Pokémon</p>
        </div>
        <NameTag
          label={name}
          color={profile.color}
          icon={profile.pokemonId ? pokemonIconUrl(profile.pokemonId) : null}
          size="md"
          className="mt-1 max-w-[45%]"
        />
      </div>

      <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
        <div className="flex flex-col items-center gap-2">
          <ColorWheel color={profile.color} onChange={(color) => onChange({ color })} />
          <p className="text-xs text-ink-soft">Tap the wheel to pick a color</p>
        </div>

        <div className="flex w-full min-w-0 flex-1 flex-col gap-2">
          <label htmlFor={`${listId}-input`} className="text-xs uppercase tracking-[0.25em] text-ink-soft">
            Partner Pokémon
          </label>
          <div className="flex items-center gap-3">
            <span className="relative isolate flex h-[72px] w-[72px] shrink-0 items-center justify-center">
              <SketchFrame radius={14} wobble={0.9} strokeWidth={2.2} fill={profile.color ?? "paper"} />
              {profile.pokemonId ? (
                // eslint-disable-next-line @next/next/no-img-element -- tiny pixel sprite; no need for image optimization
                <img
                  src={pokemonIconUrl(profile.pokemonId)}
                  alt={partnerName ? formatName(partnerName) : ""}
                  width={72}
                  height={72}
                  style={{ imageRendering: "pixelated" }}
                />
              ) : (
                <SketchIcon name="pokeball" className="h-9 w-9 text-ink-faint" strokeWidth={2} />
              )}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="relative isolate block">
                <SketchFrame radius={12} wobble={0.9} strokeWidth={2.2} fill="paper" />
                <input
                  id={`${listId}-input`}
                  list={listId}
                  value={shown}
                  onChange={(event) => choosePartner(event.target.value)}
                  onBlur={() => setDraft(null)}
                  placeholder="Search, e.g. Pikachu"
                  autoComplete="off"
                  className="relative w-full min-w-0 rounded-[12px] bg-transparent px-3.5 py-2.5 text-base text-ink placeholder:text-ink-faint focus:outline-none"
                />
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={randomPartner}
                  disabled={!pokemonNames.length}
                  className="relative isolate rounded-[12px] px-3 py-1.5 text-sm text-ink transition-transform focus:outline-none focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink enabled:active:translate-y-px"
                >
                  <SketchFrame radius={10} wobble={0.8} strokeWidth={2} fill="paper" />
                  Surprise me
                </button>
                {profile.pokemonId && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(null);
                      onChange({ pokemonId: null });
                    }}
                    className="relative isolate rounded-[12px] px-3 py-1.5 text-sm text-ink-soft transition-transform focus:outline-none focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink active:translate-y-px"
                  >
                    <SketchFrame radius={10} wobble={0.8} strokeWidth={2} fill="paper" stroke="var(--ink-faint)" />
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>
          <datalist id={listId}>
            {pokemonNames.map((pokemon) => (
              <option key={pokemon} value={formatName(pokemon)} />
            ))}
          </datalist>
        </div>
      </div>
    </SketchPanel>
  );
}
