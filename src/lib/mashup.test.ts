import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { headCuts, mashupsOf, randomMashupName, tailCuts } from "./mashup.ts";
import { MAX_NAME_LENGTH, cleanName } from "./protocol.ts";

const pokemonNames: string[] = JSON.parse(
  readFileSync(new URL("../../public/pokemon-list.json", import.meta.url), "utf8"),
).names;

// A repeatable stand-in for Math.random.
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32;
  return seed / 2 ** 32;
};

test("names are cut where syllables break, never inside 'ch' or 'ck'", () => {
  assert.deepEqual(headCuts("charizard"), ["cha", "chari", "chariza"]);
  assert.deepEqual(tailCuts("charmander"), ["mander", "der"]);
  assert.ok(tailCuts("pikachu").includes("chu"));
  assert.ok(!tailCuts("pikachu").includes("hu"));
  assert.ok(!headCuts("pikachu").includes("pikac"));
  assert.ok(!headCuts("psyduck").some((head) => head.endsWith("c")));
});

test("mashes put the front of one name on the back of the other, most even first", () => {
  assert.deepEqual(mashupsOf("pikachu", "charizard"), ["pikazard", "pikarizard"]);
  assert.equal(mashupsOf("bulbasaur", "charmander")[0], "bulbader");
  assert.ok(mashupsOf("squirtle", "pikachu").includes("squirchu"));
});

test("a mash is never a real Pokémon or too long for a name tag", () => {
  assert.ok(!mashupsOf("pikachu", "raichu", new Set(["pikachu", "raichu"])).includes("pikachu"));
  assert.ok(mashupsOf("crabominable", "blacephalon").every((mash) => mash.length <= MAX_NAME_LENGTH));
});

test("random mashes from the real list are tidy, short, capitalized names from two different Pokémon", () => {
  const random = seeded(7);
  const real = new Set(pokemonNames);
  for (let i = 0; i < 500; i += 1) {
    const mashup = randomMashupName(pokemonNames, random);
    assert.ok(mashup);
    const { name, from } = mashup;
    assert.match(name, /^[A-Z][a-z]{3,}$/);
    assert.ok(name.length <= MAX_NAME_LENGTH, name);
    assert.equal(cleanName(name), name);
    assert.ok(!real.has(name.toLowerCase()), name);
    assert.notEqual(from[0], from[1]);
    assert.ok(real.has(from[0]) && real.has(from[1]));
  }
});

test("the same random numbers give the same name", () => {
  assert.deepEqual(randomMashupName(pokemonNames, seeded(42)), randomMashupName(pokemonNames, seeded(42)));
});

test("no name without two Pokémon that can be mashed", () => {
  assert.equal(randomMashupName([]), null);
  assert.equal(randomMashupName(["pikachu"]), null);
  // Forms, "mr-mime" and too-short names are skipped.
  assert.equal(randomMashupName(["mew", "mr-mime", "porygon2", "pikachu"]), null);
});
