import assert from "node:assert/strict";
import { test } from "node:test";
import {
  showsOptionIcons,
  MODE_CONFIG,
  PARTNER_CHOICE_COUNT,
  buildRounds,
  drawPartnerChoices,
  formatName,
  isFullyCorrect,
  joinNames,
  scorePicks,
  speedPoints,
  timeoutResult,
  winnerTakesAllPot,
  type PokemonSprite,
} from "./game.ts";

const mon = (id: number): PokemonSprite => ({ id, name: `mon-${id}`, spriteUrl: `https://example.test/${id}.png` });

test("speedPoints gives 4/3/2/1 by which quarter of the clock is left", () => {
  assert.equal(speedPoints(8, 8), 4);
  assert.equal(speedPoints(7, 8), 4);
  assert.equal(speedPoints(6, 8), 3);
  assert.equal(speedPoints(4, 8), 2);
  assert.equal(speedPoints(2, 8), 1);
  assert.equal(speedPoints(0, 8), 1);
});

test("single pick: right answer scores speed points, wrong one scores nothing", () => {
  assert.deepEqual(scorePicks([mon(1)], [1], 6, 8), { outcome: "correct", delta: 3 });
  assert.deepEqual(scorePicks([mon(1)], [2], 6, 8), { outcome: "wrong", delta: 0 });
});

test("stacked picks earn partial credit per Pokémon named", () => {
  const answers = [mon(1), mon(2), mon(3)];
  assert.deepEqual(scorePicks(answers, [1, 2, 3], 15, 15), { outcome: "correct", delta: 4 });
  assert.deepEqual(scorePicks(answers, [1, 2, 9], 15, 15), { outcome: "partial", delta: 3 });
  assert.deepEqual(scorePicks(answers, [1, 8, 9], 15, 15), { outcome: "partial", delta: 1 });
  assert.deepEqual(scorePicks(answers, [7, 8, 9], 15, 15), { outcome: "wrong", delta: 0 });
});

test("timeout scores nothing and takes nothing away", () => {
  assert.deepEqual(timeoutResult(), { outcome: "timeout", delta: 0 });
});

test("buildRounds makes distinct options with answers drawn from them", async () => {
  const names = Array.from({ length: 40 }, (_, i) => `mon-${i + 1}`);
  const fakeFetch = async (name: string) => mon(Number(name.split("-")[1]));
  const rounds = await buildRounds(names, "superHard", 5, fakeFetch);
  assert.ok(rounds);
  assert.equal(rounds.length, 5);
  for (const round of rounds) {
    assert.equal(round.options.length, MODE_CONFIG.superHard.optionCount);
    assert.equal(new Set(round.options.map((o) => o.id)).size, round.options.length);
    assert.equal(round.answers.length, MODE_CONFIG.superHard.answerCount);
    for (const answer of round.answers) assert.ok(round.options.some((o) => o.id === answer.id));
  }
});

test("buildRounds returns null when sprites can't be fetched", async () => {
  assert.equal(await buildRounds(["a", "b", "c", "d"], "normal", 1, async () => null), null);
});

test("name helpers", () => {
  assert.equal(formatName("mr-mime"), "Mr Mime");
  assert.equal(joinNames(["A", "B"]), "A and B");
  assert.equal(joinNames(["A", "B", "C"]), "A, B and C");
});

test("winner takes all pot is the speed points every team could have earned", () => {
  assert.equal(winnerTakesAllPot(8, 8, 4), 16);
  assert.equal(winnerTakesAllPot(2, 8, 4), 4);
  assert.equal(winnerTakesAllPot(6, 8, 3), 9);
});

test("winner takes all only counts a guess that names every Pokémon", () => {
  const answers = [mon(1), mon(2)];
  assert.equal(isFullyCorrect(answers, [2, 1]), true);
  assert.equal(isFullyCorrect(answers, [1, 9]), false);
  assert.equal(isFullyCorrect([mon(1)], [1]), true);
  assert.equal(isFullyCorrect([mon(1)], [3]), false);
});

test("drawPartnerChoices offers three different Pokémon", async () => {
  const names = Array.from({ length: 20 }, (_, i) => `mon-${i + 1}`);
  const choices = await drawPartnerChoices(names, async (name) => mon(Number(name.split("-")[1])));
  assert.ok(choices);
  assert.equal(choices.length, PARTNER_CHOICE_COUNT);
  assert.equal(new Set(choices.map((choice) => choice.id)).size, PARTNER_CHOICE_COUNT);
});

test("drawPartnerChoices returns null when sprites can't be fetched", async () => {
  assert.equal(await drawPartnerChoices(["a", "b", "c", "d"], async () => null), null);
});

test("option icons appear once half the clock is gone, in Hard and Super Hard only", () => {
  // Seconds left on the clock at which icons are showing.
  const withIcons = (mode: "normal" | "hard" | "superHard", questionTime: number) =>
    Array.from({ length: questionTime + 1 }, (_, i) => i).filter((t) => showsOptionIcons(mode, t, questionTime));
  assert.deepEqual(withIcons("hard", 10), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(withIcons("superHard", 15), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(withIcons("normal", 10), []);
});
