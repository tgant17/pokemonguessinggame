import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MODE_CONFIG,
  PENALTY_TIMEOUT,
  PENALTY_WRONG,
  buildRounds,
  formatName,
  joinNames,
  scorePicks,
  speedPoints,
  timeoutResult,
  type PokemonSprite,
} from "./game.ts";

const mon = (id: number): PokemonSprite => ({ id, name: `mon-${id}`, spriteUrl: `https://example.test/${id}.png` });

test("speedPoints rewards time left with a floor of 5", () => {
  assert.equal(speedPoints(8), 96);
  assert.equal(speedPoints(0), 5);
});

test("single pick: right answer scores speed points, wrong one is penalised", () => {
  assert.deepEqual(scorePicks([mon(1)], [1], 6), { outcome: "correct", delta: 72 });
  assert.deepEqual(scorePicks([mon(1)], [2], 6), { outcome: "wrong", delta: -PENALTY_WRONG });
});

test("stacked picks earn partial credit per Pokémon named", () => {
  const answers = [mon(1), mon(2), mon(3)];
  assert.deepEqual(scorePicks(answers, [1, 2, 3], 10), { outcome: "correct", delta: 120 });
  assert.deepEqual(scorePicks(answers, [1, 2, 9], 10), { outcome: "partial", delta: 80 });
  assert.deepEqual(scorePicks(answers, [1, 8, 9], 10), { outcome: "partial", delta: 40 });
  assert.deepEqual(scorePicks(answers, [7, 8, 9], 10), { outcome: "wrong", delta: -PENALTY_WRONG });
});

test("timeout applies the timeout penalty", () => {
  assert.deepEqual(timeoutResult(), { outcome: "timeout", delta: -PENALTY_TIMEOUT });
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
