"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createGame,
  currentRound,
  nextWakeAt,
  secondsLeft,
  startClock,
  submitAnswer,
  tick,
  type GamePhase,
  type GameSettings,
  type GameState,
  type PlayerAnswer,
} from "@/lib/engine";
import type { RoundData } from "@/lib/game";

// Everything the game screen needs to draw a game in progress. Solo play builds it from a local
// engine; a multiplayer room will build the same shape from what its server sends.
export type GameView = {
  settings: GameSettings;
  roundIndex: number;
  round: RoundData;
  phase: GamePhase;
  timeLeft: number;
  myAnswer: PlayerAnswer | undefined;
  myScore: number;
  // True when this player can't answer right now: already locked in (waiting for others) or only watching.
  locked: boolean;
  // The picks this player locked in for the current round, if any.
  myPicks: number[] | null;
};

export type RoundResultEvent = { roundIndex: number; round: RoundData; answer: PlayerAnswer };

export type GameController = {
  view: GameView | null;
  // Starts the current round's clock; the screen calls this once the round's sprites have loaded.
  startClock: () => void;
  submit: (pickedIds: number[]) => void;
};

const ME = "me";

// Runs a one-player game in the browser. onRoundResult fires once per round, when this player's
// result is known, so the page can update the chat log.
export function useLocalGame(onRoundResult: (event: RoundResultEvent) => void) {
  const [game, setGame] = useState<GameState | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Sleep until the next deadline or clock change, then let the engine move the game along.
  useEffect(() => {
    if (!game) return;
    const wake = nextWakeAt(game, Date.now());
    if (wake === null) return;
    const timer = setTimeout(() => {
      const time = Date.now();
      setNow(time);
      setGame((prev) => prev && tick(prev, time));
    }, Math.max(0, wake - Date.now()));
    return () => clearTimeout(timer);
  }, [game, now]);

  const onRoundResultRef = useRef(onRoundResult);
  useEffect(() => {
    onRoundResultRef.current = onRoundResult;
  });
  // Rounds are reported once each; the rounds array identifies the game they belong to.
  const reported = useRef<{ rounds: RoundData[] | null; roundIndex: number }>({ rounds: null, roundIndex: -1 });
  useEffect(() => {
    if (!game || (game.phase !== "reveal" && game.phase !== "finished")) return;
    const answer = game.answers[ME];
    const round = currentRound(game);
    if (!answer || !round) return;
    if (reported.current.rounds === game.rounds && reported.current.roundIndex === game.roundIndex) return;
    reported.current = { rounds: game.rounds, roundIndex: game.roundIndex };
    onRoundResultRef.current({ roundIndex: game.roundIndex, round, answer });
  }, [game]);

  const start = useCallback((settings: GameSettings, rounds: RoundData[]) => {
    setNow(Date.now());
    setGame(createGame(settings, rounds, [ME]));
  }, []);

  const startRoundClock = useCallback(() => {
    const time = Date.now();
    setNow(time);
    setGame((prev) => prev && startClock(prev, time));
  }, []);

  const submit = useCallback((pickedIds: number[]) => {
    const time = Date.now();
    setNow(time);
    setGame((prev) => prev && submitAnswer(prev, ME, pickedIds, time));
  }, []);

  const view = useMemo<GameView | null>(() => {
    const round = game && currentRound(game);
    if (!game || !round) return null;
    return {
      settings: game.settings,
      roundIndex: game.roundIndex,
      round,
      phase: game.phase,
      timeLeft: secondsLeft(game, now),
      myAnswer: game.answers[ME],
      myScore: game.scores[ME] ?? 0,
      locked: false,
      myPicks: game.answers[ME]?.pickedIds ?? null,
    };
  }, [game, now]);

  const controller = useMemo<GameController>(
    () => ({ view, startClock: startRoundClock, submit }),
    [view, startRoundClock, submit],
  );

  return { ...controller, start };
}
