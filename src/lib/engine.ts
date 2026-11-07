// A pure, timestamp-driven game state machine. Every function takes the current time (ms) and returns
// a new state instead of mutating, so the same engine can run in the browser (solo play) or on a room
// server (multiplayer) and be unit-tested without timers. Keep it free of React/Next imports.

import {
  MODE_CONFIG,
  isFullyCorrect,
  scorePicks,
  timeoutResult,
  winnerTakesAllPot,
  type GameMode,
  type PokemonSprite,
  type RoundData,
  type RoundOutcome,
} from "./game.ts";

// winnerTakesAll: the first player to answer fully right takes the whole pot and the round ends there.
export type GameSettings = { mode: GameMode; totalRounds: number; questionTime: number; winnerTakesAll?: boolean };

// won is set on the answer that took the pot in a winner-takes-all round.
export type PlayerAnswer = { pickedIds: number[]; outcome: RoundOutcome; delta: number; won?: true };

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
  // Every revealed round's answers, oldest first, so the end-of-game summary can break the game down by round.
  results: Record<string, PlayerAnswer>[];
};

// One revealed round as the end-of-game summary shows it: the Pokémon it was and everyone's answer.
export type RoundSummary = { answers: PokemonSprite[]; results: Record<string, PlayerAnswer> };

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
  results: [],
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
    results: [...state.results, answers],
    frozenSecondsLeft: secondsLeft(state, now),
    revealEndsAt: now + MODE_CONFIG[state.settings.mode].revealDelay,
  };
};

// Stacked modes (Hard, Legendary) have no lock-in: whatever a player has picked is their answer, and they can
// change it until the clock runs out. Normal mode answers with a single tap, which is final.
export const answersStayOpen = (mode: GameMode) => MODE_CONFIG[mode].answerCount > 1;

// Records a player's picks. Ignored unless the clock is running and the picks are distinct options from
// this round. Normal mode takes one answer per player. Stacked modes take the full set of picks and replace
// any earlier set (scored at the time of the latest change); fewer picks than that withdraws the answer,
// so a player who deselects one times out unless they pick again.
export const submitAnswer = (state: GameState, playerId: string, pickedIds: number[], now: number): GameState => {
  // An answer that lands after the deadline is a timeout, not a slow answer.
  if (state.phase === "playing" && state.roundEndsAt !== null && now >= state.roundEndsAt) return tick(state, now);
  const round = currentRound(state);
  if (state.phase !== "playing" || !round || !state.playerIds.includes(playerId)) return state;
  const stayOpen = answersStayOpen(state.settings.mode);
  if (state.answers[playerId] && !stayOpen) return state;
  const picks = [...new Set(pickedIds)];
  const { answerCount } = MODE_CONFIG[state.settings.mode];
  if (!picks.every((id) => round.options.some((option) => option.id === id))) return state;
  if (stayOpen && picks.length < answerCount) {
    if (!state.answers[playerId]) return state;
    const answers = { ...state.answers };
    delete answers[playerId];
    return { ...state, answers };
  }
  if (picks.length !== answerCount) return state;
  // Points come from whole seconds left, matching the countdown players see.
  const timeLeft = secondsLeft(state, now);
  const { questionTime, winnerTakesAll } = state.settings;
  const result = scorePicks(round.answers, picks, timeLeft, questionTime);
  // Answers that can still change only end the round when the clock does.
  const finish = (answers: Record<string, PlayerAnswer>) =>
    !stayOpen && state.playerIds.every((id) => answers[id]) ? reveal(state, now, answers) : { ...state, answers };
  if (winnerTakesAll) {
    // Answers are applied in the order they arrive, so the first fully right one wins. Anything else,
    // including partly right, scores nothing; in normal mode a player who answered wrong is out for the round.
    if (isFullyCorrect(round.answers, picks)) {
      const pot = winnerTakesAllPot(timeLeft, questionTime, state.playerIds.length);
      const answers = { ...state.answers, [playerId]: { pickedIds: picks, outcome: result.outcome, delta: pot, won: true as const } };
      // Nobody else can score now, so the round ends straight away.
      return closeRound({ ...state, answers }, now);
    }
    return finish({ ...state.answers, [playerId]: { pickedIds: picks, outcome: result.outcome, delta: 0 } });
  }
  return finish({ ...state.answers, [playerId]: { pickedIds: picks, ...result } });
};

// Ends the round now: anyone who hasn't answered times out, and the answers are revealed.
// Used when time runs out, and by rooms when everyone still connected has answered.
export const closeRound = (state: GameState, now: number): GameState => {
  if (state.phase !== "playing") return state;
  const answers = { ...state.answers };
  for (const id of state.playerIds) {
    if (!answers[id]) answers[id] = { pickedIds: [], ...timeoutResult() };
  }
  return reveal(state, now, answers);
};

// Moves the game along when a deadline has passed: times out anyone who hasn't answered,
// and moves from the reveal to the next round (or the end of the game).
export const tick = (state: GameState, now: number): GameState => {
  if (state.phase === "playing" && state.roundEndsAt !== null && now >= state.roundEndsAt) return closeRound(state, now);
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

// The round-by-round breakdown of the rounds revealed so far.
export const gameSummary = (state: GameState): RoundSummary[] =>
  state.results.map((results, index) => ({ answers: state.rounds[index]?.answers ?? [], results }));

// Who won a round: whoever scored the most points in it (several on a tie). Nobody wins a round nobody scored in.
export const roundWinners = (results: Record<string, PlayerAnswer>): string[] => {
  const best = Math.max(0, ...Object.values(results).map((answer) => answer.delta));
  if (best <= 0) return [];
  return Object.entries(results)
    .filter(([, answer]) => answer.delta === best)
    .map(([id]) => id);
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
