import fs from "node:fs";
import path from "node:path";

const POKE_API_URL = "https://pokeapi.co/api/v2/pokemon?limit=1025";
const OUTPUT_PATH = path.join(process.cwd(), "public", "pokemon-list.json");

async function main() {
  try {
    const response = await fetch(POKE_API_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch Pokémon list: ${response.status}`);
    }
    const data = await response.json();
    const names = (data.results ?? []).map((pokemon) => pokemon.name);
    await fs.promises.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await fs.promises.writeFile(OUTPUT_PATH, JSON.stringify({ names }, null, 2));
    console.log(`Saved ${names.length} names to public/pokemon-list.json`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();
