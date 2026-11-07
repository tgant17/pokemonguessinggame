// Random player names made by mashing two Pokémon names together: the front of one and the back of
// another, cut where syllables break, so "pikachu" + "charizard" can come out as "Pikazard".
// Shared by the browser and plain node tests; keep it free of React/Next and Worker-only imports.

import { MAX_NAME_LENGTH } from "./protocol.ts";

export type NameMashup = {
  name: string;
  // The two Pokémon it was made from, front half first, as written in the Pokémon list.
  from: [string, string];
};

// A mash needs 4 letters to read as a name, and each piece 3 to still say which Pokémon it came from.
const MIN_MASHUP_LENGTH = 4;
const MIN_PIECE_LENGTH = 3;

// "y" sounds like a vowel in the middle of a name ("jigglypuff", "lycanroc").
const isVowel = (letter: string | undefined) => !!letter && "aeiouy".includes(letter);
const isConsonant = (letter: string | undefined) => !!letter && !isVowel(letter);
// Two letters that make one sound ("ch", "sh", "th", "ph", "wh", "ck") are never cut apart.
const isPair = (first: string | undefined, second: string | undefined) =>
  (second === "h" && !!first && "cstpw".includes(first)) || (first === "c" && second === "k");

// Single-word, letters-only names. Forms ("giratina-altered"), "mr-mime" and "porygon2" don't split cleanly.
const usableName = (name: string) => /^[a-z]+$/.test(name) && name.length >= MIN_MASHUP_LENGTH;

// Where the front piece can stop: right after a vowel sound ("pika|chu") or one consonant past it ("char|izard").
export const headCuts = (name: string): string[] => {
  const heads: string[] = [];
  for (let i = MIN_PIECE_LENGTH; i < name.length - 1; i += 1) {
    const before = name[i - 1];
    const after = name[i];
    const endsAfterVowel = isVowel(before) && isConsonant(after) && !(before === "u" && name[i - 2] === "q");
    const endsOneConsonantLater = isConsonant(before) && isConsonant(after) && isVowel(name[i - 2]);
    if ((endsAfterVowel || endsOneConsonantLater) && !isPair(before, after)) heads.push(name.slice(0, i));
  }
  return heads;
};

// Where the back piece can start: on a consonant that opens a syllable ("char|mander", "chari|zard").
// Two-letter sounds stay whole, so "pikachu" gives "chu" rather than "hu".
export const tailCuts = (name: string): string[] => {
  const tails = new Set<string>();
  for (let i = 1; i < name.length - 1; i += 1) {
    // "qu" works as a consonant.
    if (!isConsonant(name[i]) || !isVowel(name[i + 1]) || name[i] === "q") continue;
    const start = isPair(name[i - 1], name[i]) ? i - 1 : i;
    if (start > 0 && name.length - start >= MIN_PIECE_LENGTH) tails.add(name.slice(start));
  }
  return [...tails];
};

// How many consonant sounds run together where the two pieces meet; three ("bulbchu") is hard to say.
// A tail opening on "ch" counts it once, so "squir" + "chu" is fine.
const junctionConsonants = (head: string, tail: string) => {
  let run = 0;
  for (let i = head.length - 1; i >= 0 && isConsonant(head[i]); i -= 1) run += 1;
  for (let i = 0; i < tail.length && isConsonant(tail[i]); i += 1) run += 1;
  return isPair(tail[0], tail[1]) ? run - 1 : run;
};

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

// How far a mash is from keeping half of each name. Lopsided ones ("Pizard") lose one of the two Pokémon.
const lopsidedness = (head: string, first: string, tail: string, second: string) =>
  Math.abs(head.length / first.length - 0.5) + Math.abs(tail.length / second.length - 0.5);

/**
 * Every way to mash the front of `first` into the back of `second` that fits a name tag and isn't just a real
 * Pokémon ("pika" + raichu's "chu" is Pikachu), most even first: the ones that keep about half of each name.
 */
export const mashupsOf = (first: string, second: string, realNames: ReadonlySet<string> = new Set()): string[] => {
  const mashes = new Map<string, number>();
  for (const head of headCuts(first)) {
    for (const tail of tailCuts(second)) {
      const mash = head + tail;
      if (mash.length < MIN_MASHUP_LENGTH || mash.length > MAX_NAME_LENGTH) continue;
      if (mash === first || mash === second || realNames.has(mash)) continue;
      if (junctionConsonants(head, tail) > 2 || /(.)\1\1/.test(mash)) continue;
      const score = lopsidedness(head, first, tail, second);
      mashes.set(mash, Math.min(score, mashes.get(mash) ?? Infinity));
    }
  }
  return [...mashes].sort((a, b) => a[1] - b[1]).map(([mash]) => mash);
};

const pick = <T>(items: readonly T[], random: () => number): T => items[Math.floor(random() * items.length)];

// How many of a pair's most even mashes to choose between, for a little variety without lopsided ones.
const BEST_MASHES = 2;

/**
 * A random two-Pokémon name, or null if the list has fewer than two names that can be mashed.
 * Tries a handful of pairs, since a few (two short names, say) have no mash that fits.
 */
export const randomMashupName = (
  pokemonNames: readonly string[],
  random: () => number = Math.random,
): NameMashup | null => {
  const usable = pokemonNames.filter(usableName);
  if (usable.length < 2) return null;
  const realNames = new Set(pokemonNames);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const first = pick(usable, random);
    const second = pick(usable, random);
    if (first === second) continue;
    const mashes = mashupsOf(first, second, realNames).slice(0, BEST_MASHES);
    if (mashes.length) return { name: capitalize(pick(mashes, random)), from: [first, second] };
  }
  return null;
};
