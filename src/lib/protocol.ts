// Messages between a multiplayer room server (party/room.ts) and the browser (useRoomGame).
// Shared by both sides; keep it free of React/Next and Worker-only imports.

import type { GamePhase, GameSettings, PlayerAnswer } from "./engine.ts";
import { MODE_CONFIG, ROUND_OPTIONS, type GameMode, type PokemonSprite, type RoundData } from "./game.ts";
import { cleanProfile, type Profile } from "./profile.ts";

export const MAX_NAME_LENGTH = 10;
export const MAX_PLAYERS = 12;
export const ROOM_CODE_LENGTH = 4;
// Letters only, minus ones that are easy to misread aloud or on screen (I, L, O).
const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";

export const makeRoomCode = (random: () => number = Math.random) =>
  Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)]).join("");

export const normalizeRoomCode = (code: string) => code.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, ROOM_CODE_LENGTH);

export const isRoomCode = (code: string) =>
  code.length === ROOM_CODE_LENGTH && [...code].every((letter) => ROOM_CODE_ALPHABET.includes(letter));

export type PlayerInfo = {
  id: string;
  name: string;
  // The Pokémon this player picked to play alongside them (null for clients that predate partners).
  partner: PokemonSprite | null;
  // The name color this player picked, shown wherever their name appears.
  profile: Profile;
  connected: boolean;
  score: number;
  // True once this player has locked in an answer for the current round.
  answered: boolean;
  // This player's result for the current round, sent only once the round is revealed.
  lastResult: PlayerAnswer | null;
};

export type RoomGame = {
  gameId: number;
  settings: GameSettings;
  roundIndex: number;
  phase: GamePhase;
  round: RoundData;
  // Milliseconds left on the clock when the server sent this, while the round is being played.
  remainingMs: number | null;
  frozenSecondsLeft: number | null;
  // Whether the receiving player is in this game, or watching because they joined after it started.
  inGame: boolean;
  // The receiving player's picks once locked in, and their result once the round is revealed.
  myPicks: number[] | null;
  myAnswer: PlayerAnswer | null;
};

export type RoomSnapshot = {
  type: "room";
  code: string;
  you: string;
  hostId: string | null;
  players: PlayerInfo[];
  game: RoomGame | null;
};

export type ServerMessage = RoomSnapshot | { type: "error"; message: string };

export type ClientMessage =
  | { type: "join"; name: string; partner: PokemonSprite | null; profile: Profile }
  | { type: "profile"; profile: Profile }
  | { type: "rename"; name: string }
  | { type: "start"; settings: GameSettings; rounds: RoundData[] }
  | { type: "ready"; gameId: number; roundIndex: number }
  | { type: "answer"; gameId: number; roundIndex: number; pickedIds: number[] }
  | { type: "makeHost"; playerId: string };

// --- Validation of messages from browsers. The server trusts nothing it receives. ---

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIndex = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

// Names are counted by code point, so an emoji counts as one character and is never cut in half.
export const nameLength = (value: string) => Array.from(value).length;

const stripControls = (value: string) => value.replace(/\p{Cc}/gu, "");
const clampLength = (value: string) => Array.from(value).slice(0, MAX_NAME_LENGTH).join("");

// Applied while typing: drops control characters (tabs, newlines) and stops at the limit.
export const clampName = (value: string) => clampLength(stripControls(value));

// The name as everyone sees it: single spaces, none at either end, at most MAX_NAME_LENGTH characters.
export const cleanName = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const name = clampLength(stripControls(value).replace(/\s+/g, " ").trim()).trim();
  return name.length ? name : null;
};

const SPRITE_HOSTS = ["assets.pokemon.com", "raw.githubusercontent.com"];

const parseSprite = (value: unknown): PokemonSprite | null => {
  if (!isObject(value) || !isIndex(value.id) || typeof value.name !== "string" || typeof value.spriteUrl !== "string") {
    return null;
  }
  if (!/^[a-z0-9-]{1,40}$/.test(value.name) || value.spriteUrl.length > 300) return null;
  try {
    const url = new URL(value.spriteUrl);
    if (url.protocol !== "https:" || !SPRITE_HOSTS.includes(url.hostname)) return null;
  } catch {
    return null;
  }
  return { id: value.id, name: value.name, spriteUrl: value.spriteUrl };
};

const parseSettings = (value: unknown): GameSettings | null => {
  if (!isObject(value)) return null;
  const { mode, totalRounds, questionTime, winnerTakesAll } = value;
  if (typeof mode !== "string" || !(mode in MODE_CONFIG)) return null;
  if (typeof totalRounds !== "number" || !ROUND_OPTIONS.includes(totalRounds)) return null;
  if (!Number.isInteger(questionTime) || (questionTime as number) < 3 || (questionTime as number) > 60) return null;
  if (winnerTakesAll !== undefined && typeof winnerTakesAll !== "boolean") return null;
  const settings: GameSettings = { mode: mode as GameMode, totalRounds, questionTime: questionTime as number };
  if (winnerTakesAll) settings.winnerTakesAll = true;
  return settings;
};

const parseRound = (value: unknown, mode: GameMode): RoundData | null => {
  if (!isObject(value) || !Array.isArray(value.options) || !Array.isArray(value.answers)) return null;
  const { optionCount, answerCount } = MODE_CONFIG[mode];
  if (value.options.length !== optionCount || value.answers.length !== answerCount) return null;
  const options = value.options.map(parseSprite);
  const answers = value.answers.map(parseSprite);
  if (options.some((option) => !option) || answers.some((answer) => !answer)) return null;
  const optionIds = new Set(options.map((option) => option!.id));
  const answerIds = new Set(answers.map((answer) => answer!.id));
  if (optionIds.size !== optionCount || answerIds.size !== answerCount) return null;
  if (![...answerIds].every((id) => optionIds.has(id))) return null;
  return { options: options as PokemonSprite[], answers: answers as PokemonSprite[] };
};

export const parseClientMessage = (raw: unknown): ClientMessage | null => {
  if (typeof raw !== "string" || raw.length > 200_000) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(data)) return null;
  switch (data.type) {
    case "join": {
      const name = cleanName(data.name);
      // A partner is optional so pages loaded before partners existed can still join, but must be valid if sent.
      const partner = data.partner == null ? null : parseSprite(data.partner);
      if (!name || (data.partner != null && !partner)) return null;
      return { type: "join", name, partner, profile: cleanProfile(data.profile) };
    }
    case "profile":
      return { type: "profile", profile: cleanProfile(data.profile) };
    case "rename": {
      const name = cleanName(data.name);
      return name ? { type: "rename", name } : null;
    }
    case "start": {
      const settings = parseSettings(data.settings);
      if (!settings || !Array.isArray(data.rounds) || data.rounds.length !== settings.totalRounds) return null;
      const rounds = data.rounds.map((round) => parseRound(round, settings.mode));
      if (rounds.some((round) => !round)) return null;
      return { type: "start", settings, rounds: rounds as RoundData[] };
    }
    case "ready":
      return isIndex(data.gameId) && isIndex(data.roundIndex)
        ? { type: "ready", gameId: data.gameId, roundIndex: data.roundIndex }
        : null;
    case "answer":
      if (!isIndex(data.gameId) || !isIndex(data.roundIndex) || !Array.isArray(data.pickedIds)) return null;
      if (data.pickedIds.length > 8 || !data.pickedIds.every(isIndex)) return null;
      return { type: "answer", gameId: data.gameId, roundIndex: data.roundIndex, pickedIds: data.pickedIds };
    case "makeHost":
      return typeof data.playerId === "string" && data.playerId.length > 0 && data.playerId.length <= 100
        ? { type: "makeHost", playerId: data.playerId }
        : null;
    default:
      return null;
  }
};
