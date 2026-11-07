import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanColor, cleanPokemonId, cleanProfile, hexToHsl, hslToHex, wheelColorAt } from "./profile.ts";

test("colors must be #rrggbb and are lowercased", () => {
  assert.equal(cleanColor("#FFAA00"), "#ffaa00");
  assert.equal(cleanColor("#fa0"), null);
  assert.equal(cleanColor("red"), null);
  assert.equal(cleanColor("#ffaa00; background: url(x)"), null);
  assert.equal(cleanColor(42), null);
});

test("partner Pokémon must be a national Pokédex number", () => {
  assert.equal(cleanPokemonId(25), 25);
  assert.equal(cleanPokemonId(0), null);
  assert.equal(cleanPokemonId(1026), null);
  assert.equal(cleanPokemonId(2.5), null);
  assert.equal(cleanPokemonId("25"), null);
  assert.deepEqual(cleanProfile({ color: "#123456", pokemonId: 7 }), { color: "#123456", pokemonId: 7 });
  assert.deepEqual(cleanProfile("nope"), { color: null, pokemonId: null });
});

test("hsl and hex convert both ways", () => {
  assert.equal(hslToHex(0, 100, 50), "#ff0000");
  assert.equal(hslToHex(120, 100, 50), "#00ff00");
  assert.equal(hslToHex(240, 100, 50), "#0000ff");
  const { hue, saturation, lightness } = hexToHsl(hslToHex(200, 60, 70));
  assert.ok(Math.abs(hue - 200) < 1.5);
  assert.ok(Math.abs(saturation - 60) < 1.5);
  assert.ok(Math.abs(lightness - 70) < 1);
});

test("the wheel puts red at the top, hue clockwise, and grey in the middle", () => {
  assert.equal(Math.round(wheelColorAt(0, -50, 50).hue), 0);
  assert.equal(Math.round(wheelColorAt(50, 0, 50).hue), 90);
  assert.equal(Math.round(wheelColorAt(0, 50, 50).hue), 180);
  assert.equal(Math.round(wheelColorAt(-50, 0, 50).hue), 270);
  assert.equal(wheelColorAt(0, 0, 50).saturation, 0);
  assert.equal(wheelColorAt(0, -80, 50).saturation, 100, "clicks past the rim clamp to full color");
});
