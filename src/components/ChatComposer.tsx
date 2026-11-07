"use client";

import { useEffect, useRef, useState, type Dispatch, type FormEvent, type PointerEvent, type ReactNode, type SetStateAction } from "react";
import { choiceButtonClass } from "@/components/controls";
import { SketchFrame, SketchIcon } from "@/components/sketch";
import {
  DRAWING_HEIGHT,
  DRAWING_WIDTH,
  MAX_DRAWING_POINTS,
  countPoints,
  isDrawingFull,
  simplifyStroke,
  strokePath,
  type Drawing,
} from "@/lib/drawing";
import { CHAT_BURST, CHAT_TOO_FAST, CHAT_WINDOW_MS, MAX_CHAT_LENGTH, clampChat, cleanChat } from "@/lib/protocol";

// Pen width in grid units. It scales with the drawing, so a doodle looks the same in the pad and in the log.
const PEN_WIDTH = 3;
// Pointer moves closer than this to the last point (in grid units) only add size, not shape.
const MIN_STEP = 1.2;
// The character count shows once a line gets this close to the limit.
const COUNTER_FROM = MAX_CHAT_LENGTH - 20;

function Strokes({ drawing }: { drawing: Drawing }) {
  return (
    <g fill="none" stroke="currentColor" strokeWidth={PEN_WIDTH} strokeLinecap="round" strokeLinejoin="round">
      {drawing.map((stroke, index) => (
        <path key={index} d={strokePath(stroke)} />
      ))}
    </g>
  );
}

/** A drawing from the chat log, in ink, at whatever width its container gives it. */
export function DrawingView({ drawing, label, className = "" }: { drawing: Drawing; label: string; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${DRAWING_WIDTH} ${DRAWING_HEIGHT}`}
      role="img"
      aria-label={label}
      className={`block aspect-[2/1] h-auto w-full overflow-visible ${className}`}
    >
      <Strokes drawing={drawing} />
    </svg>
  );
}

function ToolButton({ label, onClick, disabled = false, children }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`${choiceButtonClass(false)} flex h-10 w-10 shrink-0 items-center justify-center disabled:text-ink-faint`}
    >
      <SketchFrame radius={10} wobble={0.8} strokeWidth={2.2} fill="paper" stroke={disabled ? "var(--ink-faint)" : "var(--ink)"} />
      {children}
    </button>
  );
}

function SendButton({ ready, label, type = "button", onClick }: {
  ready: boolean;
  label: string;
  type?: "button" | "submit";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={!ready}
      aria-label={label}
      title={label}
      className={`${choiceButtonClass(ready)} flex h-10 w-12 shrink-0 items-center justify-center ${ready ? "" : "text-ink-faint"}`}
    >
      <SketchFrame
        radius={10}
        wobble={0.8}
        strokeWidth={2.4}
        fill={ready ? "ink" : "paper"}
        stroke={ready ? "var(--ink)" : "var(--ink-faint)"}
        dotted={!ready}
      />
      <SketchIcon name="send" className="h-6 w-6" strokeWidth={2.6} />
    </button>
  );
}

// The pad you draw on: one finger, pen or mouse at a time, in black ink on ruled paper.
function DrawingPad({ drawing, setDrawing }: { drawing: Drawing; setDrawing: Dispatch<SetStateAction<Drawing>> }) {
  const padRef = useRef<SVGSVGElement>(null);
  const pointerRef = useRef<number | null>(null);
  // The stroke being drawn, as raw pointer positions on the grid; it's simplified once the pen lifts.
  const strokeRef = useRef<number[]>([]);
  const [liveStroke, setLiveStroke] = useState<number[] | null>(null);
  const full = isDrawingFull(drawing);
  // A stroke can't take more points than the drawing has left, even before it's simplified.
  const pointsLeft = MAX_DRAWING_POINTS - countPoints(drawing);

  const toGrid = (event: { clientX: number; clientY: number }) => {
    const rect = padRef.current!.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * DRAWING_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * DRAWING_HEIGHT;
    return [Math.min(DRAWING_WIDTH, Math.max(0, x)), Math.min(DRAWING_HEIGHT, Math.max(0, y))];
  };

  const startStroke = (event: PointerEvent<SVGSVGElement>) => {
    if (pointerRef.current !== null || full) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = event.pointerId;
    strokeRef.current = toGrid(event);
    setLiveStroke(strokeRef.current);
  };

  const extendStroke = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerId !== pointerRef.current) return;
    const points = strokeRef.current;
    // Coalesced events are the positions the browser saw between frames, which keeps fast strokes smooth.
    const coalesced = event.nativeEvent.getCoalescedEvents?.();
    const moves = coalesced && coalesced.length ? coalesced : [event.nativeEvent];
    let changed = false;
    for (const move of moves) {
      if (points.length / 2 >= pointsLeft) break;
      const [x, y] = toGrid(move);
      const dx = x - points[points.length - 2];
      const dy = y - points[points.length - 1];
      if (dx * dx + dy * dy < MIN_STEP * MIN_STEP) continue;
      points.push(x, y);
      changed = true;
    }
    if (changed) setLiveStroke([...points]);
  };

  const endStroke = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerId !== pointerRef.current) return;
    pointerRef.current = null;
    const stroke = simplifyStroke(strokeRef.current);
    strokeRef.current = [];
    setLiveStroke(null);
    if (stroke.length) setDrawing((prev) => (isDrawingFull(prev) ? prev : [...prev, stroke]));
  };

  return (
    <div className="relative isolate p-1">
      <SketchFrame radius={12} wobble={0.9} strokeWidth={2.4} fill="ruled" />
      <svg
        ref={padRef}
        viewBox={`0 0 ${DRAWING_WIDTH} ${DRAWING_HEIGHT}`}
        role="img"
        aria-label="Drawing pad"
        // touch-none stops a finger drawing on the pad from scrolling the page instead.
        className={`block aspect-[2/1] h-auto w-full touch-none select-none ${full ? "cursor-not-allowed" : "cursor-crosshair"}`}
        onPointerDown={startStroke}
        onPointerMove={extendStroke}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onLostPointerCapture={endStroke}
      >
        <Strokes drawing={liveStroke ? [...drawing, liveStroke] : drawing} />
      </svg>
      {drawing.length === 0 && !liveStroke && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center font-hand text-xl text-ink-faint">
          Draw something!
        </p>
      )}
    </div>
  );
}

/** Where room players write chat lines or draw doodles for the log above. */
export function ChatComposer({ onSendText, onSendDrawing, disabled = false }: {
  onSendText: (text: string) => void;
  onSendDrawing: (drawing: Drawing) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<"type" | "draw">("type");
  const [text, setText] = useState("");
  // The drawing stays put when you flip to typing and back, until you send or clear it.
  const [drawing, setDrawing] = useState<Drawing>([]);
  const cleanText = cleanChat(text);
  const length = Array.from(text).length;

  // The room turns away posts that come too fast. Checking here first keeps such a post in the box (or on the
  // pad) to send in a moment, instead of clearing it as if it had gone.
  const postTimes = useRef<number[]>([]);
  const [tooFast, setTooFast] = useState(false);
  const tooFastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (tooFastTimer.current) clearTimeout(tooFastTimer.current);
  }, []);
  const claimPost = () => {
    const now = Date.now();
    const recent = postTimes.current.filter((at) => now - at < CHAT_WINDOW_MS);
    if (recent.length >= CHAT_BURST) {
      setTooFast(true);
      if (tooFastTimer.current) clearTimeout(tooFastTimer.current);
      tooFastTimer.current = setTimeout(() => setTooFast(false), recent[0] + CHAT_WINDOW_MS - now);
      return false;
    }
    postTimes.current = [...recent, now];
    setTooFast(false);
    return true;
  };

  const submitText = (event: FormEvent) => {
    event.preventDefault();
    if (!cleanText || disabled || !claimPost()) return;
    onSendText(cleanText);
    setText("");
  };

  const sendDrawing = () => {
    if (!drawing.length || disabled || !claimPost()) return;
    onSendDrawing(drawing);
    setDrawing([]);
  };

  if (mode === "draw") {
    return (
      <div className="flex flex-col gap-2">
        <DrawingPad drawing={drawing} setDrawing={setDrawing} />
        <div className="flex items-center gap-2">
          <ToolButton label="Type a message instead" onClick={() => setMode("type")}>
            <span className="text-sm leading-none">Aa</span>
          </ToolButton>
          <ToolButton label="Undo" onClick={() => setDrawing((prev) => prev.slice(0, -1))} disabled={!drawing.length}>
            <SketchIcon name="undo" className="h-5 w-5" strokeWidth={2.4} />
          </ToolButton>
          <ToolButton label="Clear the drawing" onClick={() => setDrawing([])} disabled={!drawing.length}>
            <SketchIcon name="cross" className="h-4 w-4" strokeWidth={2.4} />
          </ToolButton>
          <p aria-live="polite" className="min-w-0 flex-1 text-xs leading-tight text-ink-soft">
            {tooFast ? CHAT_TOO_FAST : isDrawingFull(drawing) ? "Page full! Send it or undo." : ""}
          </p>
          <SendButton ready={drawing.length > 0 && !disabled} label="Send drawing" onClick={sendDrawing} />
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submitText} className="flex flex-wrap items-center gap-2">
      <ToolButton label="Draw something instead" onClick={() => setMode("draw")}>
        <SketchIcon name="pencil" className="h-5 w-5" strokeWidth={2.2} />
        {/* A dot on the pencil says there's an unsent drawing waiting on the pad. */}
        {drawing.length > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-ink" />}
      </ToolButton>
      <label className="relative isolate flex min-w-0 flex-1 items-center gap-2 px-3">
        <SketchFrame radius={10} wobble={0.8} strokeWidth={2.2} fill="paper" />
        <input
          value={text}
          onChange={(event) => setText(clampChat(event.target.value))}
          aria-label="Message"
          placeholder="Say something…"
          autoComplete="off"
          enterKeyHint="send"
          className="h-10 min-w-0 flex-1 bg-transparent font-hand text-xl text-ink placeholder:text-ink-faint focus:outline-none"
        />
        {length >= COUNTER_FROM && (
          <span className="shrink-0 text-xs tabular-nums text-ink-soft">
            {length}/{MAX_CHAT_LENGTH}
          </span>
        )}
      </label>
      <SendButton type="submit" ready={!!cleanText && !disabled} label="Send message" />
      {tooFast && (
        <p aria-live="polite" className="w-full text-xs leading-tight text-ink-soft">
          {CHAT_TOO_FAST}
        </p>
      )}
    </form>
  );
}
