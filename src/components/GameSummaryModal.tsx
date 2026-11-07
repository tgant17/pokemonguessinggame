"use client";

import { useEffect, useRef } from "react";
import { OutcomeMark } from "@/components/marks";
import { NameTag, SketchFrame, SketchIcon, SketchPanel } from "@/components/sketch";
import { roundWinners, type PlayerAnswer, type RoundSummary } from "@/lib/engine";
import { formatName, joinNames, pokemonIconUrl, type PokemonSprite } from "@/lib/game";

// Someone who played in the game, as the summary draws them.
export type SummaryPlayer = { id: string; name: string; color?: string | null; partner?: PokemonSprite | null };

const formatPoints = (delta: number) => (delta > 0 ? `+${delta}` : "0");

// A player who left the room since can drop off the player list, but their answers still count.
const findPlayer = (players: SummaryPlayer[], id: string): SummaryPlayer =>
  players.find((player) => player.id === id) ?? { id, name: "Left" };

const tagFor = (player: SummaryPlayer) => (
  <NameTag
    label={player.name}
    color={player.color}
    icon={player.partner ? pokemonIconUrl(player.partner.id) : null}
  />
);

function PlayerResult({ player, answer, round, isWinner }: {
  player: SummaryPlayer;
  answer: PlayerAnswer;
  round: RoundSummary;
  isWinner: boolean;
}) {
  const hits = round.answers.filter((pokemon) => answer.pickedIds.includes(pokemon.id)).length;
  return (
    <li className="flex items-center gap-2.5 py-1">
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {tagFor(player)}
        {isWinner && <SketchIcon name="star" className="h-4 w-4" strokeWidth={2.2} filled />}
        {answer.won && <span className="shrink-0 text-xs text-ink-soft">took the pot</span>}
      </span>
      <span className="flex w-7 justify-center">
        <OutcomeMark outcome={answer.outcome} hits={hits} total={round.answers.length} className="h-5 w-5" />
      </span>
      <span className={`w-9 text-right font-hand text-xl font-bold tabular-nums ${answer.delta > 0 ? "" : "text-ink-faint"}`}>
        {formatPoints(answer.delta)}
      </span>
    </li>
  );
}

// One round as a dropdown: closed, it says what the Pokémon was and who won; open, it lists everyone's points.
function RoundDropdown({ round, index, players }: { round: RoundSummary; index: number; players: SummaryPlayer[] }) {
  const winners = roundWinners(round.results).map((id) => findPlayer(players, id));
  const best = winners.length ? round.results[winners[0].id].delta : 0;
  const order = new Map(players.map((player, position) => [player.id, position]));
  // Highest points first; equal points keep the order players are listed in.
  const results = Object.entries(round.results).sort(
    ([a, left], [b, right]) => right.delta - left.delta || (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity),
  );
  const names = joinNames(round.answers.map((pokemon) => formatName(pokemon.name)));
  return (
    <details className="group relative isolate rounded-[14px]">
      <SketchFrame radius={14} wobble={0.9} strokeWidth={2.2} fill="paper" />
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[14px] px-3 py-2.5 focus:outline-none focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="w-3 shrink-0 text-ink-soft transition-transform group-open:rotate-90">
          ▸
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-hand text-xl font-bold leading-tight">Round {index + 1}</span>
          <span className="block truncate text-xs text-ink-soft">{names}</span>
        </span>
        {winners.length ? (
          <span className="flex min-w-0 shrink items-center gap-1.5">
            <SketchIcon name="star" className="h-4 w-4" strokeWidth={2.2} filled />
            {winners.length === 1 ? (
              tagFor(winners[0])
            ) : (
              <span className="truncate text-sm">{winners.length}-way tie</span>
            )}
            <span className="font-hand text-xl font-bold tabular-nums">{formatPoints(best)}</span>
          </span>
        ) : (
          <span className="shrink-0 text-sm text-ink-soft">Nobody scored</span>
        )}
      </summary>
      <ul className="mx-3 mb-2.5 border-t border-dashed border-ink-faint pt-1.5">
        {results.map(([id, answer]) => (
          <PlayerResult
            key={id}
            player={findPlayer(players, id)}
            answer={answer}
            round={round}
            isWinner={winners.some((winner) => winner.id === id)}
          />
        ))}
      </ul>
    </details>
  );
}

// The end-of-game breakdown: final totals, then every round as a dropdown of who scored what.
export function GameSummaryModal({ open, onClose, rounds, players, subtitle }: {
  open: boolean;
  onClose: () => void;
  rounds: RoundSummary[];
  players: SummaryPlayer[];
  subtitle: string;
}) {
  // A native modal dialog keeps focus inside it and closes on Escape.
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const totals = new Map<string, number>();
  for (const round of rounds) {
    for (const [id, answer] of Object.entries(round.results)) totals.set(id, (totals.get(id) ?? 0) + answer.delta);
  }
  const standings = [...totals].sort(([, a], [, b]) => b - a);
  const top = standings[0]?.[1] ?? 0;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      // A click on the dimmed backdrop lands on the dialog element itself, outside the panel.
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
      aria-labelledby="game-summary-title"
      className="m-auto w-[min(560px,calc(100vw-2rem))] overflow-visible bg-transparent p-0 text-ink backdrop:bg-black/40"
    >
      <SketchPanel fill="paper" className="flex max-h-[85vh] flex-col p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="game-summary-title" className="font-hand text-3xl font-bold leading-none">
              Game summary
            </h2>
            <p className="mt-1 text-xs text-ink-soft">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close summary"
            className="relative isolate shrink-0 rounded-[10px] p-1.5 focus:outline-none focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink active:translate-y-px"
          >
            <SketchFrame radius={10} wobble={0.8} strokeWidth={2.2} fill="paper" />
            <SketchIcon name="cross" className="h-5 w-5" strokeWidth={2.6} />
          </button>
        </div>

        {standings.length > 1 && (
          <ol className="mt-3 flex flex-wrap gap-x-3 gap-y-2">
            {standings.map(([id, total]) => (
              <li key={id} className="flex items-center gap-1.5">
                {total === top && top > 0 && <SketchIcon name="star" className="h-4 w-4" strokeWidth={2.2} filled />}
                {tagFor(findPlayer(players, id))}
                <span className="font-hand text-xl font-bold tabular-nums">{total}</span>
              </li>
            ))}
          </ol>
        )}

        <div className="feed-scroll -mx-1 mt-3 min-h-0 flex-1 overflow-y-auto px-1 pb-1 pt-1">
          <div className="flex flex-col gap-2.5">
            {rounds.map((round, index) => (
              <RoundDropdown key={index} round={round} index={index} players={players} />
            ))}
          </div>
        </div>

        <p className="mt-3 text-center text-xs text-ink-soft">Tap a round to see everyone&apos;s points.</p>
      </SketchPanel>
    </dialog>
  );
}
