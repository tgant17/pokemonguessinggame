"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { SketchFrame, SketchIcon, SketchPanel, SketchUnderline } from "@/components/sketch";

/**
 * The page between the start screen and a room's game screen, where you make your name tag (the form comes in
 * as children). Without a form it just says it's connecting, for the moment before the page knows whether
 * you're already in the room.
 */
export function JoinRoomScreen({ error, children }: { error: string | null; children?: ReactNode }) {
  return (
    <main className="min-h-screen px-4 pb-12 pt-8 text-ink sm:pt-10">
      <div className="mx-auto flex w-full max-w-[600px] flex-col gap-6">
        <header className="relative flex flex-col items-center text-center">
          <Link
            href="/"
            aria-label="Back to start"
            className="relative isolate -mb-2 self-start rounded-[10px] px-3 py-1.5 text-sm text-ink transition-transform focus:outline-none focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink active:translate-y-px"
          >
            <SketchFrame radius={10} wobble={0.8} strokeWidth={2.2} fill="paper" />
            ← Back
          </Link>
          <h1 className="font-hand text-5xl font-bold leading-none sm:text-6xl">Who&apos;s that Pokémon?</h1>
          <SketchUnderline className="mt-1 h-3 w-56 text-ink sm:w-72" />
          <p className="mt-3 font-hand text-2xl font-bold leading-tight">Make your name tag</p>
        </header>

        <SketchPanel fill="ruled" className="p-4 sm:p-5">
          {children || (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <SketchIcon name="pokeball" className="h-12 w-12" strokeWidth={2} draw />
              <p className="font-hand text-2xl font-bold leading-tight">
                Connecting<span className="blink">…</span>
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 flex items-center justify-center gap-1.5 text-center text-sm text-ink">
              <SketchIcon name="cross" className="h-4 w-4 shrink-0" strokeWidth={2.4} />
              {error}
            </p>
          )}
        </SketchPanel>

        <p className="text-center text-xs text-ink-soft">Sprite data fetched live from the PokéAPI sprites collection.</p>
      </div>
    </main>
  );
}
