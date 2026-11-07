"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SketchFrame, SketchIcon, SketchPanel, SketchUnderline } from "@/components/sketch";
import { multiplayerAvailable } from "@/hooks/useRoomGame";
import { isRoomCode, makeRoomCode, normalizeRoomCode } from "@/lib/protocol";

const focusRing =
  "focus:outline-none focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

// The first screen: choose to play on this device, or online with friends.
export default function Landing() {
  const router = useRouter();
  const [codeDraft, setCodeDraft] = useState("");
  const joinCode = normalizeRoomCode(codeDraft);

  return (
    <main className="min-h-screen px-4 pb-12 pt-8 text-ink sm:pt-10">
      <div className="mx-auto flex w-full max-w-[600px] flex-col gap-6">
        <header className="flex flex-col items-center text-center">
          <SketchIcon name="pokeball" className="mb-3 h-14 w-14" strokeWidth={2} draw />
          <h1 className="font-hand text-5xl font-bold leading-none sm:text-6xl">Who&apos;s that Pokémon?</h1>
          <SketchUnderline className="mt-1 h-3 w-56 text-ink sm:w-72" />
          <p className="mt-3 font-hand text-2xl font-bold leading-tight">How do you want to play?</p>
        </header>

        {/* Drawn as a paper panel like the multiplayer box, so the two choices look like equals.
            The whole card stays one link for a big tap target; the inner "button" is just a span. */}
        <Link
          href="/play"
          className={`group relative isolate block rounded-[18px] p-5 sm:p-6 ${focusRing}`}
        >
          <SketchFrame radius={18} wobble={1.5} strokeWidth={3} fill="paper" draw />
          <p className="text-xs uppercase tracking-[0.25em] text-ink-soft">Single player</p>
          <p className="font-hand text-3xl font-bold leading-tight">Play on this device</p>
          <p className="mt-1 text-sm text-ink-soft">Race the clock on your own and chase a high score.</p>
          <span className="relative isolate mt-4 flex w-full items-center justify-center gap-2 rounded-[16px] py-3.5 text-xl text-paper transition-transform group-active:translate-y-px">
            <SketchFrame radius={16} wobble={1.1} strokeWidth={2.8} fill="ink" />
            Start playing
            <SketchIcon name="send" className="h-5 w-5" strokeWidth={2.4} />
          </span>
        </Link>

        <SketchPanel className="p-5 sm:p-6" draw>
          <p className="text-xs uppercase tracking-[0.25em] text-ink-soft">Multiplayer</p>
          <p className="font-hand text-3xl font-bold leading-tight">Play with friends</p>
          <p className="mt-1 text-sm text-ink-soft">Everyone plays on their own phone at the same time.</p>

          {multiplayerAvailable ? (
            <div className="mt-4 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => router.push(`/room/${makeRoomCode()}`)}
                className={`relative isolate flex w-full items-center justify-center gap-2 rounded-[16px] py-3.5 text-xl text-paper transition-transform active:translate-y-px ${focusRing}`}
              >
                <SketchFrame radius={16} wobble={1.1} strokeWidth={2.8} fill="ink" />
                Create a room
              </button>
              <div className="flex items-center gap-3 text-xs text-ink-soft">
                <span className="h-px flex-1 bg-ink-faint" />
                or join one
                <span className="h-px flex-1 bg-ink-faint" />
              </div>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (isRoomCode(joinCode)) router.push(`/room/${joinCode}`);
                }}
              >
                <span className="relative isolate block min-w-0 flex-1">
                  <SketchFrame radius={12} wobble={0.9} strokeWidth={2.2} fill="paper" />
                  <input
                    value={codeDraft}
                    onChange={(event) => setCodeDraft(event.target.value)}
                    placeholder="Room code"
                    aria-label="Room code"
                    autoCapitalize="characters"
                    className="relative w-full min-w-0 rounded-[12px] bg-transparent px-3.5 py-3 text-lg uppercase tracking-[0.2em] text-ink placeholder:text-ink-faint focus:outline-none"
                  />
                </span>
                <button
                  type="submit"
                  disabled={!isRoomCode(joinCode)}
                  className={`relative isolate shrink-0 rounded-[12px] px-4 text-lg text-ink transition-transform enabled:active:translate-y-px disabled:cursor-not-allowed disabled:text-ink-faint ${focusRing}`}
                >
                  <SketchFrame radius={12} wobble={0.9} strokeWidth={2.2} fill="paper" />
                  Join
                </button>
              </form>
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink">Multiplayer isn&apos;t set up on this site yet.</p>
          )}
        </SketchPanel>

        <p className="text-center text-xs text-ink-soft">Sprite data fetched live from the PokéAPI sprites collection.</p>
      </div>
    </main>
  );
}
