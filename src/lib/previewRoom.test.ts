import assert from "node:assert/strict";
import { test } from "node:test";
import type { GameSettings } from "./engine.ts";
import type { PokemonSprite, RoundData } from "./game.ts";
import { PreviewRoom } from "./previewRoom.ts";
import type { ClientMessage, RoomSnapshot, ServerMessage } from "./protocol.ts";

const mon = (id: number): PokemonSprite => ({
  id,
  name: `mon-${id}`,
  spriteUrl: `https://assets.pokemon.com/assets/cms2/img/pokedex/full/${String(id).padStart(3, "0")}.png`,
});
const rounds: RoundData[] = Array.from({ length: 5 }, (_, n) => {
  const options = Array.from({ length: 4 }, (_, i) => mon(n * 10 + i + 1));
  return { options, answers: options.slice(0, 1) };
});
const settings: GameSettings = { mode: "normal", totalRounds: 5, questionTime: 8 };

// Opens a preview room and collects everything it sends back. Replies arrive on a later tick, so
// `settle` waits for them before checking.
const openRoom = () => {
  const received: ServerMessage[] = [];
  const room = new PreviewRoom("PKMN", "ash", (data) => received.push(JSON.parse(data) as ServerMessage));
  const send = (message: ClientMessage) => room.send(JSON.stringify(message));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
  const latest = () => received.filter((message): message is RoomSnapshot => message.type === "room").at(-1);
  return { room, received, send, settle, latest };
};

test("a preview room sends its state as soon as it opens, before anyone joins", async () => {
  const { room, settle, latest } = openRoom();
  await settle();
  assert.equal(latest()?.code, "PKMN");
  assert.equal(latest()?.you, "ash");
  assert.deepEqual(latest()?.players, []);
  room.close();
});

test("joining makes you the host, and invalid messages are ignored like on the real server", async () => {
  const { room, received, send, settle, latest } = openRoom();
  room.send("not json");
  send({ type: "join", name: "Ash", partner: mon(25), profile: { color: null } });
  await settle();
  assert.deepEqual(latest()?.players.map((player) => player.name), ["Ash"]);
  assert.equal(latest()?.hostId, "ash");
  assert.equal(received.filter((message) => message.type === "error").length, 0);
  room.close();
});

test("errors from the room come back as error messages", async () => {
  const { room, received, send, settle } = openRoom();
  send({ type: "start", settings, rounds });
  await settle();
  assert.deepEqual(received.find((message) => message.type === "error"), { type: "error", message: "Join the room first." });
  room.close();
});

test("a solo player can play a round through to the reveal", async () => {
  const { room, send, settle, latest } = openRoom();
  send({ type: "join", name: "Ash", partner: mon(25), profile: { color: null } });
  send({ type: "start", settings, rounds });
  await settle();
  assert.equal(latest()?.game?.phase, "waiting");
  send({ type: "ready", gameId: 1, roundIndex: 0 });
  await settle();
  assert.equal(latest()?.game?.phase, "playing");
  send({ type: "answer", gameId: 1, roundIndex: 0, pickedIds: [rounds[0].answers[0].id] });
  await settle();
  // Everyone in the room (just you) has answered, so the reveal doesn't wait for the clock.
  assert.equal(latest()?.game?.phase, "reveal");
  assert.equal(latest()?.game?.myAnswer?.outcome, "correct");
  room.close();
});

test("nothing is delivered after the room is closed", async () => {
  const { room, received, send, settle } = openRoom();
  room.close();
  send({ type: "join", name: "Ash", partner: mon(25), profile: { color: null } });
  await settle();
  assert.equal(received.length, 0);
});
