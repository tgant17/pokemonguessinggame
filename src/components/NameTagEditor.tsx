"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { choiceButtonClass } from "@/components/controls";
import { NameTag, SketchFrame, SketchIcon, SketchPanel } from "@/components/sketch";
import { randomMashupName } from "@/lib/mashup";
import { WHEEL_LIGHTNESS, hexToHsl, hslToHex, wheelColorAt } from "@/lib/profile";
import { MAX_NAME_LENGTH, clampName, cleanName, nameLength } from "@/lib/protocol";

// The full hue circle at the wheel's lightness, starting from red at the top (matches wheelColorAt).
const HUE_STOPS = Array.from({ length: 13 }, (_, i) => `hsl(${i * 30} 100% ${WHEEL_LIGHTNESS}%)`).join(", ");
const WHEEL_BACKGROUND = `radial-gradient(circle closest-side, hsl(0 0% ${WHEEL_LIGHTNESS}%), transparent), conic-gradient(${HUE_STOPS})`;

/** A round color picker: click or drag anywhere on it; arrow keys nudge hue (left/right) and strength (up/down). */
export function ColorWheel({
  color,
  onChange,
  size = 132,
  labelledBy,
}: {
  color: string | null;
  onChange: (hex: string) => void;
  size?: number;
  // The id of a visible caption to name the wheel by; without one it's called "Your color".
  labelledBy?: string;
}) {
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
      aria-label={labelledBy ? undefined : "Your color"}
      aria-labelledby={labelledBy}
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
  // Called with the new name and color once they're confirmed with the check (or Enter), not as you edit.
  onNameChange: (name: string) => void;
  color: string | null;
  onColorChange: (hex: string) => void;
  // For the die that rolls a random name; it stays disabled until the list has loaded.
  pokemonNames: readonly string[];
  className?: string;
};

/**
 * Your own name tag, with a small color-wheel dot inside it. Tapping it pops open a box to change your name
 * and color. Neither takes until you tick the check (or press Enter), so a room hears about it once;
 * tapping anywhere else or pressing Escape closes the box and keeps the name and color you had.
 */
export function NameTagEditor({
  label,
  icon,
  name,
  onNameChange,
  color,
  onColorChange,
  pokemonNames,
  className = "",
}: NameTagEditorProps) {
  const auraLabelId = useId();
  const counterId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [colorDraft, setColorDraft] = useState<string | null>(null);
  // Counts rolls so the die can tumble again on every one.
  const [rolls, setRolls] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const usableDraft = cleanName(draft);

  const openEditor = () => {
    setDraft(clampName(name));
    setColorDraft(color);
    setOpen(true);
  };

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  const save = () => {
    if (!usableDraft) return;
    if (usableDraft !== name) onNameChange(usableDraft);
    if (colorDraft && colorDraft !== color) onColorChange(colorDraft);
    close(true);
  };

  const rollName = () => {
    const rolled = randomMashupName(pokemonNames);
    if (!rolled) return;
    setRolls((count) => count + 1);
    setDraft(rolled.name);
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
        // Kept narrower than the screen so the check at its right edge never falls off a small phone.
        <div
          role="dialog"
          aria-label="Your name tag"
          className="absolute left-0 top-full z-20 mt-2 w-[17.5rem] max-w-[calc(100vw-3rem)]"
        >
          <SketchPanel radius={16} className="flex flex-col gap-3 p-3.5">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
              className="flex items-center gap-1.5"
            >
              <div className="relative isolate flex min-w-0 flex-1 items-center gap-2 rounded-[12px] pl-3 pr-2.5 focus-within:outline-dashed focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink">
                <SketchFrame radius={10} wobble={0.8} strokeWidth={2.2} fill="paper" />
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(event) => setDraft(clampName(event.target.value))}
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
              </div>
              <button
                type="button"
                onClick={rollName}
                disabled={!pokemonNames.length}
                aria-label="Random name"
                title="Random name: two Pokémon mashed together"
                className={`${choiceButtonClass(false)} flex h-10 w-10 shrink-0 items-center justify-center disabled:text-ink-faint`}
              >
                <SketchFrame radius={10} wobble={0.8} strokeWidth={2.2} fill="paper" />
                <span key={rolls} className={`flex ${rolls ? "dice-roll" : ""}`}>
                  <SketchIcon name="dice" className="h-5 w-5" strokeWidth={2.2} />
                </span>
              </button>
              {/* An empty name box can't be saved; Escape or tapping away keeps the old name and aura instead. */}
              <button
                type="submit"
                disabled={!usableDraft}
                aria-label="Save name and aura"
                title="Save name and aura"
                className={`${choiceButtonClass(!!usableDraft)} flex h-10 w-10 shrink-0 items-center justify-center disabled:text-ink-faint`}
              >
                <SketchFrame
                  radius={10}
                  wobble={0.8}
                  strokeWidth={2.2}
                  fill={usableDraft ? "ink" : "paper"}
                  stroke={usableDraft ? "var(--ink)" : "var(--ink-faint)"}
                  dotted={!usableDraft}
                />
                <SketchIcon name="check" className="h-5 w-5" strokeWidth={2.8} />
              </button>
            </form>
            <div className="flex flex-col items-center gap-2">
              <ColorWheel color={colorDraft} onChange={setColorDraft} size={120} labelledBy={auraLabelId} />
              <p id={auraLabelId} className="font-hand text-xl font-bold leading-none">
                Your aura
              </p>
            </div>
          </SketchPanel>
        </div>
      )}
    </div>
  );
}
