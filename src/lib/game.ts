// Core game rules shared by every way of playing (solo today, multiplayer rooms later).
// Keep this file free of React/Next imports so a standalone server can use it too.

export type PokemonSpriteResponse = {
  id: number;
  name: string;
  sprites?: {
    front_default?: string | null;
    other?: {
      ["official-artwork"]?: {
        front_default?: string | null;
      };
      showdown?: {
        front_default?: string | null;
      };
      home?: {
        front_default?: string | null;
      };
    };
  };
};

export type PokemonSprite = {
  id: number;
  name: string;
  spriteUrl: string;
};

export type RoundData = {
  options: PokemonSprite[];
  answers: PokemonSprite[];
};

export type GameMode = "normal" | "hard" | "superHard";

export type RoundStatus = "idle" | "correct" | "partial" | "wrong" | "timeout";

export type RoundOutcome = Exclude<RoundStatus, "idle">;

export type RoundResult = { outcome: RoundOutcome; delta: number };

// defaultTime is the timer each mode starts on; players can still pick any of the timer options.
export const MODE_CONFIG: Record<
  GameMode,
  { label: string; description: string; optionCount: number; answerCount: number; defaultTime: number; revealDelay: number }
> = {
  normal: {
    label: "Normal",
    description: "1 silhouette · pick 1 of 4",
    optionCount: 4,
    answerCount: 1,
    defaultTime: 8,
    revealDelay: 900,
  },
  hard: {
    label: "Hard",
    description: "2 stacked · pick 2 of 6",
    optionCount: 6,
    answerCount: 2,
    defaultTime: 10,
    revealDelay: 1800,
  },
  superHard: {
    label: "Super Hard",
    description: "3 stacked · pick 3 of 8",
    optionCount: 8,
    answerCount: 3,
    defaultTime: 15,
    revealDelay: 2400,
  },
};

export const ROUND_OPTIONS = [5, 10, 25];

// Correct answers score by which quarter of the clock they land in:
// first quarter (fastest) = 4, then 3, 2, and 1 in the final quarter.
// Wrong answers and time-outs score nothing but never take points away.
export const SPEED_TIERS = 4;

export const shuffle = <T,>(array: T[]) => {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

export const formatName = (name: string) =>
  name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const joinNames = (names: string[]) =>
  names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

// A small pixel sprite for showing beside an option's name. Built from the id alone, so rounds sent
// through a room don't need to carry it. (PokeAPI's menu icons stop at #809; front sprites cover every id.)
export const optionIconUrl = (id: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

// Stacked modes (Hard, Super Hard) put icons beside the options once half the round's clock has run down,
// as a hint for players who are still stuck. A 10-second round shows them from 5 seconds left.
export const showsOptionIcons = (mode: GameMode, timeLeft: number, questionTime: number) =>
  MODE_CONFIG[mode].answerCount > 1 && timeLeft <= questionTime / 2;

export const spriteFromResponse =(data: PokemonSpriteResponse): string | null => {
  const padded = data.id.toString().padStart(3, "0");
  const pokemonAssetsUrl =
    data.id >= 1 && data.id <= 1010 ? `https://assets.pokemon.com/assets/cms2/img/pokedex/full/${padded}.png` : null;
  return (
    pokemonAssetsUrl ??
    data?.sprites?.other?.["official-artwork"]?.front_default ??
    data?.sprites?.other?.showdown?.front_default ??
    data?.sprites?.front_default ??
    data?.sprites?.other?.home?.front_default ??
    null
  );
};

export const fetchPokemonSprite = async (name: string): Promise<PokemonSprite | null> => {
  try {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${name}`);
    if (!res.ok) return null;
    const data = (await res.json()) as PokemonSpriteResponse;
    const spriteUrl = spriteFromResponse(data);
    if (!spriteUrl) return null;
    return { id: data.id, name: data.name, spriteUrl };
  } catch {
    return null;
  }
};

export const buildRound = async (
  pokemonNames: string[],
  optionCount: number,
  answerCount: number,
  fetchSprite: (name: string) => Promise<PokemonSprite | null> = fetchPokemonSprite,
): Promise<RoundData | null> => {
  if (!pokemonNames.length) return null;
  const candidates: PokemonSprite[] = [];
  const triedNames = new Set<string>();
  let attempts = 0;
  while (candidates.length < optionCount && attempts < 150) {
    // Fetch the missing options in parallel so 6-option rounds stay quick to prepare.
    const batch: string[] = [];
    const needed = optionCount - candidates.length;
    while (batch.length < needed && triedNames.size < pokemonNames.length) {
      const candidate = pokemonNames[Math.floor(Math.random() * pokemonNames.length)];
      if (!candidate || triedNames.has(candidate)) continue;
      triedNames.add(candidate);
      batch.push(candidate);
    }
    if (!batch.length) break;
    attempts += batch.length;
    const sprites = await Promise.all(batch.map((name) => fetchSprite(name)));
    for (const sprite of sprites) {
      if (sprite && candidates.length < optionCount && !candidates.some((c) => c.id === sprite.id)) {
        candidates.push(sprite);
      }
    }
  }
  if (candidates.length < optionCount) return null;
  const options = shuffle(candidates);
  const answers = shuffle(options).slice(0, answerCount);
  return { options, answers };
};

// Builds every round for a game up front; returns null if sprites couldn't be fetched for all of them.
export const buildRounds = async (
  pokemonNames: string[],
  mode: GameMode,
  totalRounds: number,
  fetchSprite?: (name: string) => Promise<PokemonSprite | null>,
): Promise<RoundData[] | null> => {
  const { optionCount, answerCount } = MODE_CONFIG[mode];
  const rounds: RoundData[] = [];
  while (rounds.length < totalRounds) {
    const round = await buildRound(pokemonNames, optionCount, answerCount, fetchSprite);
    if (!round) return null;
    rounds.push(round);
  }
  return rounds;
};

// How many random Pokémon a player chooses their multiplayer partner from.
export const PARTNER_CHOICE_COUNT = 3;

// Draws distinct random Pokémon to offer as partners; null if their sprites couldn't be fetched.
export const drawPartnerChoices = async (
  pokemonNames: string[],
  fetchSprite?: (name: string) => Promise<PokemonSprite | null>,
): Promise<PokemonSprite[] | null> => {
  const round = await buildRound(pokemonNames, PARTNER_CHOICE_COUNT, 0, fetchSprite);
  return round?.options ?? null;
};

export const speedPoints = (timeLeft: number, questionTime: number) =>
  Math.max(1, Math.ceil((timeLeft / questionTime) * SPEED_TIERS));

// Scores a completed set of picks. Normal mode passes one pick; stacked modes pass answerCount picks.
export const scorePicks = (
  answers: PokemonSprite[],
  pickedIds: number[],
  timeLeft: number,
  questionTime: number,
): RoundResult => {
  const hits = answers.filter((answer) => pickedIds.includes(answer.id)).length;
  if (hits === answers.length) return { outcome: "correct", delta: speedPoints(timeLeft, questionTime) };
  // Partial credit scales with how many of the stacked Pokémon were named.
  if (hits > 0) return { outcome: "partial", delta: Math.round((speedPoints(timeLeft, questionTime) * hits) / answers.length) };
  return { outcome: "wrong", delta: 0 };
};

export const timeoutResult = (): RoundResult => ({ outcome: "timeout", delta: 0 });

// Winner takes all: the first right answer takes the whole pot, which is what every player could have
// earned at that moment (speed points × number of players). Everyone else scores nothing that round.
export const winnerTakesAllPot = (timeLeft: number, questionTime: number, teamCount: number) =>
  speedPoints(timeLeft, questionTime) * teamCount;

// Winner takes all has no partial credit: a guess only wins if it names every Pokémon in the round.
export const isFullyCorrect = (answers: PokemonSprite[], pickedIds: number[]) =>
  answers.length > 0 && answers.every((answer) => pickedIds.includes(answer.id));
