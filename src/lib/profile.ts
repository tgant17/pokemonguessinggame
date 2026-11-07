// A player's look: the color their name shows in and the partner Pokémon whose icon sits beside it.
// Shared by the browser and the room server; keep it free of React/Next and Worker-only imports.

export type Profile = {
  // A #rrggbb color, or null before one has been picked.
  color: string | null;
  // National Pokédex number of the partner Pokémon, or null for none.
  pokemonId: number | null;
};

// pokemon-list.json holds the national Pokédex in order, so a name's index + 1 is its number.
export const MAX_POKEMON_ID = 1025;

export const EMPTY_PROFILE: Profile = { color: null, pokemonId: null };

export const cleanColor = (value: unknown): string | null =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;

export const cleanPokemonId = (value: unknown): number | null =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_POKEMON_ID ? (value as number) : null;

export const cleanProfile = (value: unknown): Profile => {
  if (typeof value !== "object" || value === null) return EMPTY_PROFILE;
  const { color, pokemonId } = value as Record<string, unknown>;
  return { color: cleanColor(color), pokemonId: cleanPokemonId(pokemonId) };
};

// The small in-game sprite, which reads well at icon size.
export const pokemonIconUrl = (id: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

// --- Color wheel math. The wheel is hue around the circle and saturation from the center out, at a fixed
// lightness so dark ink text stays readable on any color picked. ---

export const WHEEL_LIGHTNESS = 70;

export const hslToHex = (hue: number, saturation: number, lightness: number) => {
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
};

export const hexToHsl = (hex: string): { hue: number; saturation: number; lightness: number } => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0, lightness: lightness * 100 };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return { hue, saturation: saturation * 100, lightness: lightness * 100 };
};

// Where a point on the wheel lands: x/y are offsets from the center, radius is the wheel's radius.
// 0° is straight up and hue increases clockwise, matching a CSS conic-gradient.
export const wheelColorAt = (x: number, y: number, radius: number) => {
  const hue = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
  const saturation = Math.min(1, Math.hypot(x, y) / radius) * 100;
  return { hue, saturation, hex: hslToHex(hue, saturation, WHEEL_LIGHTNESS) };
};

export const randomProfileColor = (random: () => number = Math.random) =>
  hslToHex(Math.floor(random() * 360), 85, WHEEL_LIGHTNESS);
