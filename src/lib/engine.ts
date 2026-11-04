// A pure, timestamp-driven game state machine. Every function takes the current time (ms) and returns
// a new state instead of mutating, so the same engine can run in the browser (solo play) or on a room
// server (multiplayer) and be unit-tested without timers. Keep it free of React/Next imports.

import { MODE_CONFIG, scorePicks, timeoutResult, type GameMode, type RoundData, type RoundOutcome } from "./game.ts";

export type GameSettings = { mode: GameMode; totalRounds: number; questionTime: number };

export type PlayerAnswer = { pickedIds: number[]; outcome: RoundOutcome; delta: number };

// waiting:  the round is set up but its clock hasn't started (e.g. sprites still loading)
// playing:  the clock is running and players can answer
// reveal:   everyone answered or time ran out; answers are shown until revealEndsAt
// finished: the last round's reveal is over
export type GamePhase = "waiting" | "playing" | "reveal" | "finished";

export type GameState = {
  settings: GameSettings;
  rounds: RoundData[];
  playerIds: string[];
  roundIndex: number;
  phase: GamePhase;
  roundEndsAt: number | null;
  revealEndsAt: number | null;
  // The clock value shown once the round stops, so the gauge freezes where it was.
  frozenSecondsLeft: number | null;
  // Answers for the current round, keyed by player id.
  answers: Record<string, PlayerAnswer>;
  scores: Record<string, number>;
};

export const createGame = (settings: GameSettings, rounds: RoundData[], playerIds: string[]): GameState => ({
  settings,
  rounds,
  playerIds,
  roundIndex: 0,
  phase: "waiting",
  roundEndsAt: null,
  revealEndsAt: null,
  frozenSecondsLeft: null,
  answers: {},
  scores: Object.fromEntries(playerIds.map((id) => [id, 0])),
});

export const currentRound = (state: GameState): RoundData | undefined => state.rounds[state.roundIndex];

// Whole seconds left on the clock, counting down the same way the old 1-second interval did:
// the full time is shown for the first second, and 0 means time is up.
export const secondsLeft = (state: GameState, now: number): number => {
  if (state.phase === "waiting") return state.settings.questionTime;
  if (state.phase === "playing" && state.roundEndsAt !== null) {
    const remaining = state.roundEndsAt - now;
    return remaining <= 0 ? 0 : Math.ceil(remaining / 1000 - 1e-9);
  }
  return state.frozenSecondsLeft ?? 0;
};

export const startClock = (state: GameState, now: number): GameState =>
  state.phase === "waiting"
    ? { ...state, phase: "playing", roundEndsAt: now + state.settings.questionTime * 1000 }
    : state;

const reveal = (state: GameState, now: number, answers: Record<string, PlayerAnswer>): GameState => {
  const scores = { ...state.scores };
  for (const [playerId, answer] of Object.entries(answers)) scores[playerId] = (scores[playerId] ?? 0) + answer.delta;
  return {
    ...state,
    phase: "reveal",
    answers,
    scores,
    frozenSecondsLeft: secondsLeft(state, now),
    revealEndsAt: now + MODE_CONFIG[state.settings.mode].revealDelay,
  };
};

// Records a player's picks. Ignored unless the clock is running, the player hasn't answered yet,
// and the picks are the right number of distinct options from this round.
export const submitAnswer = (state: GameState, playerId: string, pickedIds: number[], now: number): GameState => {
  // An answer that lands after the deadline is a timeout, not a slow answer.
  if (state.phase === "playing" && state.roundEndsAt !== null && now >= state.roundEndsAt) return tick(state, now);
  const round = currentRound(state);
  if (state.phase !== "playing" || !round || !state.playerIds.includes(playerId) || state.answers[playerId]) return state;
  const picks = [...new Set(pickedIds)];
  const { answerCount } = MODE_CONFIG[state.settings.mode];
  if (picks.length !== answerCount || !picks.every((id) => round.options.some((option) => option.id === id))) {
    return state;
  }
  // Points come from whole seconds left, matching the countdown players see.
  const result = scorePicks(round.answers, picks, secondsLeft(state, now), state.settings.questionTime);
  const answers = { ...state.answers, [playerId]: { pickedIds: picks, ...result } };
  if (state.playerIds.every((id) => answers[id])) return reveal(state, now, answers);
  return { ...state, answers };
};

// Moves the game along when a deadline has passed: times out anyone who hasn't answered,
// and moves from the reveal to the next round (or the end of the game).
export const tick = (state: GameState, now: number): GameState => {
  if (state.phase === "playing" && state.roundEndsAt !== null && now >= state.roundEndsAt) {
    const answers = { ...state.answers };
    for (const id of state.playerIds) {
      if (!answers[id]) answers[id] = { pickedIds: [], ...timeoutResult() };
    }
    return reveal({ ...state, roundEndsAt: now }, now, answers);
  }
  if (state.phase === "reveal" && state.revealEndsAt !== null && now >= state.revealEndsAt) {
    if (state.roundIndex + 1 >= state.rounds.length) return { ...state, phase: "finished", revealEndsAt: null };
    return {
      ...state,
      roundIndex: state.roundIndex + 1,
      phase: "waiting",
      roundEndsAt: null,
      revealEndsAt: null,
      frozenSecondsLeft: null,
      answers: {},
    };
  }
  return state;
};

// When the state could next change on its own (a deadline, or the next whole second on the clock),
// so a host can sleep until then instead of polling. Null means nothing happens until someone acts.
export const nextWakeAt = (state: GameState, now: number): number | null => {
  if (state.phase === "playing" && state.roundEndsAt !== null) {
    const remaining = state.roundEndsAt - now;
    if (remaining <= 0) return now;
    return now + (remaining % 1000 || 1000);
  }
  if (state.phase === "reveal") return state.revealEndsAt;
  return null;
};
