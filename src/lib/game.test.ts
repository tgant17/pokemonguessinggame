import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MODE_CONFIG,
  buildRounds,
  formatName,
  joinNames,
  scorePicks,
  speedPoints,
  timeoutResult,
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
