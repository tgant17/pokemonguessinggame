import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createGame,
  nextWakeAt,
  secondsLeft,
  startClock,
  submitAnswer,
  tick,
  type GameSettings,
  type GameState,
} from "./engine.ts";
import { MODE_CONFIG, type PokemonSprite, type RoundData } from "./game.ts";

const mon = (id: number): PokemonSprite => ({ id, name: `mon-${id}`, spriteUrl: `https://example.test/${id}.png` });
// Round n uses options n*10+1..n*10+optionCount; the first answerCount options are the answers.
const makeRounds = (count: number, optionCount: number, answerCount: number): RoundData[] =>
  Array.from({ length: count }, (_, n) => {
    const options = Array.from({ length: optionCount }, (_, i) => mon(n * 10 + i + 1));
    return { options, answers: options.slice(0, answerCount) };
  });

const normal: GameSettings = { mode: "normal", totalRounds: 2, questionTime: 8 };
const T0 = 1_000_000;

const startedSolo = (): GameState => startClock(createGame(normal, makeRounds(2, 4, 1), ["me"]), T0);

test("a new game waits for its clock to start", () => {
  const game = createGame(normal, makeRounds(2, 4, 1), ["me"]);
  assert.equal(game.phase, "waiting");
  assert.equal(secondsLeft(game, T0), 8);
  assert.equal(nextWakeAt(game, T0), null);
  assert.deepEqual(game.scores, { me: 0 });
});

test("the clock counts down in whole seconds like the old interval", () => {
  const game = startedSolo();
  assert.equal(secondsLeft(game, T0), 8);
  assert.equal(secondsLeft(game, T0 + 999), 8);
  assert.equal(secondsLeft(game, T0 + 1000), 7);
  assert.equal(secondsLeft(game, T0 + 7999), 1);
  assert.equal(secondsLeft(game, T0 + 8000), 0);
  assert.equal(nextWakeAt(game, T0), T0 + 1000);
  assert.equal(nextWakeAt(game, T0 + 1500), T0 + 2000);
});

test("a correct answer scores speed points and reveals straight away in solo", () => {
  const game = submitAnswer(startedSolo(), "me", [1], T0 + 2500); // 6 of 8 seconds left: second quarter
  assert.equal(game.phase, "reveal");
  assert.deepEqual(game.answers.me, { pickedIds: [1], outcome: "correct", delta: 3 });
  assert.equal(game.scores.me, 3);
  assert.equal(secondsLeft(game, T0 + 5000), 6, "the clock freezes at reveal");
  assert.equal(game.revealEndsAt, T0 + 2500 + MODE_CONFIG.normal.revealDelay);
});

test("a wrong answer scores nothing", () => {
  const game = submitAnswer(startedSolo(), "me", [2], T0);
  assert.deepEqual(game.answers.me, { pickedIds: [2], outcome: "wrong", delta: 0 });
});

test("running out of time is a timeout, even if an answer arrives late", () => {
  const timedOut = tick(startedSolo(), T0 + 8000);
  assert.equal(timedOut.phase, "reveal");
  assert.deepEqual(timedOut.answers.me, { pickedIds: [], outcome: "timeout", delta: 0 });
  assert.equal(secondsLeft(timedOut, T0 + 8000), 0);

  const late = submitAnswer(startedSolo(), "me", [1], T0 + 8200);
  assert.equal(late.answers.me.outcome, "timeout");
});

test("invalid or repeat answers are ignored", () => {
  const game = startedSolo();
  assert.equal(submitAnswer(game, "me", [99], T0), game, "not an option");
  assert.equal(submitAnswer(game, "me", [1, 2], T0), game, "too many picks");
  assert.equal(submitAnswer(game, "someone-else", [1], T0), game, "not in the game");
  const waiting = createGame(normal, makeRounds(2, 4, 1), ["me"]);
  assert.equal(submitAnswer(waiting, "me", [1], T0), waiting, "clock not started");
  const answered = submitAnswer(game, "me", [1], T0);
  assert.equal(submitAnswer(answered, "me", [2], T0 + 10), answered, "already answered");
});

test("after the reveal the next round waits, and the last round finishes the game", () => {
  let game = submitAnswer(startedSolo(), "me", [1], T0);
  assert.equal(tick(game, game.revealEndsAt! - 1), game, "still revealing");
  game = tick(game, game.revealEndsAt!);
  assert.equal(game.phase, "waiting");
  assert.equal(game.roundIndex, 1);
  assert.deepEqual(game.answers, {});
  assert.equal(game.scores.me, 4, "score carries over");

  game = submitAnswer(startClock(game, T0 + 5000), "me", [11], T0 + 5000);
  game = tick(game, game.revealEndsAt!);
  assert.equal(game.phase, "finished");
  assert.equal(game.scores.me, 8);
  assert.equal(nextWakeAt(game, T0 + 99999), null);
});

test("stacked modes score partial credit", () => {
  const settings: GameSettings = { mode: "superHard", totalRounds: 1, questionTime: 15 };
  const game = startClock(createGame(settings, makeRounds(1, 8, 3), ["me"]), T0);
  const answered = submitAnswer(game, "me", [1, 2, 8], T0); // 2 of 3 in the first quarter
  assert.deepEqual(answered.answers.me, { pickedIds: [1, 2, 8], outcome: "partial", delta: 3 });
});

test("with several players the round reveals once everyone has answered or time runs out", () => {
  const start = startClock(createGame(normal, makeRounds(2, 4, 1), ["ash", "misty", "brock"]), T0);
  let game = submitAnswer(start, "ash", [1], T0 + 500);
  game = submitAnswer(game, "misty", [3], T0 + 1500);
  assert.equal(game.phase, "playing", "brock hasn't answered");
  assert.equal(secondsLeft(game, T0 + 1500), 7, "the clock keeps running for others");

  const allIn = submitAnswer(game, "brock", [1], T0 + 3000);
  assert.equal(allIn.phase, "reveal");
  assert.deepEqual(allIn.scores, { ash: 4, misty: 0, brock: 3 });

  const timedOut = tick(game, T0 + 8000);
  assert.equal(timedOut.phase, "reveal");
  assert.equal(timedOut.answers.brock.outcome, "timeout");
  assert.deepEqual(timedOut.scores, { ash: 4, misty: 0, brock: 0 });
});
