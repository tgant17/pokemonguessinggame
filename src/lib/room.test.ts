import assert from "node:assert/strict";
import { test } from "node:test";
import type { GameSettings } from "./engine.ts";
import { MODE_CONFIG, type PokemonSprite, type RoundData } from "./game.ts";
import { isRoomCode, makeRoomCode, normalizeRoomCode, parseClientMessage, type ClientMessage } from "./protocol.ts";
import { READY_TIMEOUT_MS, REJOIN_GRACE_MS, RoomState } from "./room.ts";

const mon = (id: number): PokemonSprite => ({
  id,
  name: `mon-${id}`,
  spriteUrl: `https://assets.pokemon.com/assets/cms2/img/pokedex/full/${String(id).padStart(3, "0")}.png`,
});
const makeRounds = (count: number, optionCount = 4, answerCount = 1): RoundData[] =>
  Array.from({ length: count }, (_, n) => {
    const options = Array.from({ length: optionCount }, (_, i) => mon(n * 10 + i + 1));
    return { options, answers: options.slice(0, answerCount) };
  });
const settings: GameSettings = { mode: "normal", totalRounds: 5, questionTime: 8 };
const T0 = 5_000_000;

// A room with Ash (host) and Misty connected and joined.
const twoPlayerRoom = () => {
  const room = new RoomState("PKMN");
  for (const [id, name] of [["ash", "Ash"], ["misty", "Misty"]]) {
    room.connect(id);
    room.handle(id, { type: "join", name }, T0);
  }
  return room;
};
const start = (room: RoomState, by = "ash", now = T0): string | null =>
  room.handle(by, { type: "start", settings, rounds: makeRounds(5) }, now);
const ready = (room: RoomState, id: string, now: number, roundIndex = 0) =>
  room.handle(id, { type: "ready", gameId: 1, roundIndex }, now);
const answer = (room: RoomState, id: string, pickedIds: number[], now: number, roundIndex = 0) =>
  room.handle(id, { type: "answer", gameId: 1, roundIndex, pickedIds }, now);

test("the first player to join hosts, and only the host can start", () => {
  const room = twoPlayerRoom();
  const snapshot = room.snapshotFor("misty", T0);
  assert.equal(snapshot.hostId, "ash");
  assert.deepEqual(snapshot.players.map((p) => p.name), ["Ash", "Misty"]);
  assert.equal(start(room, "misty"), "Only the host can start a game.");
  assert.equal(start(room), null);
  assert.equal(room.snapshotFor("misty", T0).game?.phase, "waiting");
});

test("if the host disconnects the next connected player can start", () => {
  const room = twoPlayerRoom();
  room.disconnect("ash", T0);
  assert.equal(room.snapshotFor("misty", T0).hostId, "misty");
  // Ash keeps their seat in the list while away...
  assert.equal(room.snapshotFor("misty", T0).players.find((p) => p.id === "ash")?.connected, false);
  assert.equal(start(room, "misty"), null);
  // ...until a new game starts without them. Misty is now the host even if Ash comes back.
  assert.deepEqual(room.snapshotFor("misty", T0).players.map((p) => p.name), ["Misty"]);
  room.connect("ash");
  assert.equal(room.snapshotFor("misty", T0).hostId, "misty");
});

test("the host can hand hosting to another connected player", () => {
  const room = twoPlayerRoom();
  assert.equal(room.handle("misty", { type: "makeHost", playerId: "misty" }, T0), "Only the host can hand over hosting.");
  assert.equal(room.handle("ash", { type: "makeHost", playerId: "gary" }, T0), "That player isn't in the room.");
  assert.equal(room.handle("ash", { type: "makeHost", playerId: "misty" }, T0), null);
  assert.equal(room.snapshotFor("ash", T0).hostId, "misty");
  assert.equal(start(room, "ash"), "Only the host can start a game.");
  assert.equal(start(room, "misty"), null);
});

test("a round ends early once everyone still connected has answered", () => {
  const room = twoPlayerRoom();
  start(room);
  ready(room, "ash", T0);
  ready(room, "misty", T0);
  answer(room, "ash", [1], T0 + 500);
  assert.equal(room.snapshotFor("ash", T0 + 500).game?.phase, "playing");
  room.disconnect("misty", T0 + 1000);
  assert.equal(room.snapshotFor("ash", T0 + 1000).game?.phase, "playing", "Misty might just be reloading");
  assert.equal(room.nextWakeAt(), T0 + 1000 + REJOIN_GRACE_MS);
  room.advance(T0 + 1000 + REJOIN_GRACE_MS);
  const snap = room.snapshotFor("ash", T0 + 4000);
  assert.equal(snap.game?.phase, "reveal", "no waiting out the clock for Misty");
  assert.equal(snap.players.find((p) => p.id === "misty")?.lastResult?.outcome, "timeout");
  assert.equal(snap.game?.frozenSecondsLeft, 4);

  // The same applies if Misty had already left before answering.
  const early = twoPlayerRoom();
  start(early);
  early.disconnect("misty", T0);
  ready(early, "ash", T0 + REJOIN_GRACE_MS);
  assert.equal(early.snapshotFor("ash", T0 + REJOIN_GRACE_MS).game?.phase, "playing");
  answer(early, "ash", [1], T0 + REJOIN_GRACE_MS + 200);
  assert.equal(early.snapshotFor("ash", T0 + REJOIN_GRACE_MS + 200).game?.phase, "reveal");
});

test("refreshing the page doesn't end the round for you", () => {
  const room = twoPlayerRoom();
  start(room);
  ready(room, "ash", T0);
  ready(room, "misty", T0);
  answer(room, "ash", [1], T0 + 500);
  // Misty reloads: her connection drops and comes back a moment later.
  room.disconnect("misty", T0 + 1000);
  assert.equal(room.snapshotFor("ash", T0 + 1000).game?.phase, "playing");
  room.connect("misty");
  room.advance(T0 + 5000);
  assert.equal(room.snapshotFor("misty", T0 + 5000).game?.phase, "playing", "still Misty's turn to answer");
  answer(room, "misty", [1], T0 + 5200);
  assert.equal(room.snapshotFor("misty", T0 + 5200).game?.myAnswer?.outcome, "correct");
});

test("a refresh while a round is loading doesn't start the clock without you", () => {
  const room = twoPlayerRoom();
  start(room);
  ready(room, "ash", T0 + 100);
  room.disconnect("misty", T0 + 200);
  assert.equal(room.snapshotFor("ash", T0 + 200).game?.phase, "waiting");
  room.connect("misty");
  ready(room, "misty", T0 + 900);
  assert.equal(room.snapshotFor("ash", T0 + 900).game?.phase, "playing");
});

test("a full room makes space by dropping someone who has left", () => {
  const room = new RoomState("PKMN");
  for (let i = 0; i < 12; i += 1) {
    room.connect(`p${i}`);
    room.handle(`p${i}`, { type: "join", name: `P${i}` }, T0);
  }
  room.connect("late");
  assert.equal(room.handle("late", { type: "join", name: "Late" }, T0), "This room is full (12 players).");
  room.disconnect("p5", T0);
  assert.equal(room.handle("late", { type: "join", name: "Late" }, T0), null);
  const names = room.snapshotFor("late", T0).players.map((p) => p.name);
  assert.equal(names.length, 12);
  assert.ok(!names.includes("P5") && names.includes("Late"));
});

test("a round's clock starts when everyone's sprites are ready, or after a timeout", () => {
  const room = twoPlayerRoom();
  start(room);
  ready(room, "ash", T0 + 100);
  assert.equal(room.snapshotFor("ash", T0 + 100).game?.phase, "waiting");
  ready(room, "misty", T0 + 300);
  const snap = room.snapshotFor("ash", T0 + 300);
  assert.equal(snap.game?.phase, "playing");
  assert.equal(snap.game?.remainingMs, 8000);

  const slow = twoPlayerRoom();
  start(slow);
  ready(slow, "ash", T0 + 100);
  assert.equal(slow.nextWakeAt(), T0 + READY_TIMEOUT_MS);
  slow.advance(T0 + READY_TIMEOUT_MS);
  assert.equal(slow.snapshotFor("ash", T0 + READY_TIMEOUT_MS).game?.phase, "playing");
});

test("answers stay private until everyone has answered, then all results are revealed", () => {
  const room = twoPlayerRoom();
  start(room);
  ready(room, "ash", T0);
  ready(room, "misty", T0);
  answer(room, "ash", [1], T0 + 500);

  const mid = room.snapshotFor("misty", T0 + 600);
  assert.equal(mid.game?.phase, "playing");
  assert.equal(mid.players.find((p) => p.id === "ash")?.answered, true);
  assert.equal(mid.players.find((p) => p.id === "ash")?.lastResult, null, "no peeking at Ash's result");
  assert.equal(mid.players.find((p) => p.id === "ash")?.score, 0);
  assert.equal(room.snapshotFor("ash", T0 + 600).game?.myAnswer, null, "Ash waits for the reveal too");
  assert.deepEqual(room.snapshotFor("ash", T0 + 600).game?.myPicks, [1]);

  answer(room, "misty", [2], T0 + 3000);
  const revealed = room.snapshotFor("ash", T0 + 3000);
  assert.equal(revealed.game?.phase, "reveal");
  assert.deepEqual(revealed.game?.myAnswer, { pickedIds: [1], outcome: "correct", delta: 4 });
  assert.deepEqual(
    revealed.players.map((p) => [p.name, p.score, p.lastResult?.outcome]),
    [
      ["Ash", 4, "correct"],
      ["Misty", 0, "wrong"],
    ],
  );
  assert.equal(room.nextWakeAt(), T0 + 3000 + MODE_CONFIG.normal.revealDelay);
});

test("the round times out on the server clock, then the next round waits for sprites again", () => {
  const room = twoPlayerRoom();
  start(room);
  ready(room, "ash", T0);
  ready(room, "misty", T0);
  answer(room, "ash", [1], T0 + 500);
  assert.equal(room.nextWakeAt(), T0 + 8000);
  room.advance(T0 + 8000);
  const timedOut = room.snapshotFor("misty", T0 + 8000);
  assert.equal(timedOut.game?.myAnswer?.outcome, "timeout");

  room.advance(room.nextWakeAt()!);
  const next = room.snapshotFor("misty", T0 + 9000);
  assert.equal(next.game?.phase, "waiting");
  assert.equal(next.game?.roundIndex, 1);
  assert.equal(next.game?.myPicks, null);
  // A ready message for the old round doesn't count for the new one.
  ready(room, "ash", T0 + 9000, 0);
  ready(room, "misty", T0 + 9000, 0);
  assert.equal(room.snapshotFor("ash", T0 + 9000).game?.phase, "waiting");
});

test("someone joining mid-game watches until the next game", () => {
  const room = twoPlayerRoom();
  start(room);
  room.connect("brock");
  room.handle("brock", { type: "join", name: "Brock" }, T0);
  const watching = room.snapshotFor("brock", T0);
  assert.equal(watching.game?.inGame, false);
  ready(room, "ash", T0);
  ready(room, "misty", T0);
  assert.equal(room.snapshotFor("brock", T0).game?.phase, "playing", "the watcher doesn't hold up the clock");
});

test("a game can't be started twice, and a finished game can be replayed", () => {
  const room = twoPlayerRoom();
  start(room);
  assert.equal(start(room), "A game is already running.");
});

test("room codes", () => {
  const code = makeRoomCode();
  assert.ok(isRoomCode(code), code);
  assert.equal(normalizeRoomCode(" pk-a "), "PKA");
  assert.equal(isRoomCode("PKMN"), true);
  assert.equal(isRoomCode("PIKA"), false, "no I, L or O");
  assert.equal(isRoomCode("PIK1"), false);
  assert.equal(isRoomCode("OIL0"), false);
});

test("client messages are validated", () => {
  const parse = (value: unknown) => parseClientMessage(JSON.stringify(value));
  assert.deepEqual(parse({ type: "join", name: "  Ash \n Ketchum  " }), { type: "join", name: "Ash Ketchum" });
  assert.equal(parse({ type: "join", name: "   " }), null);
  assert.equal(parse({ type: "join", name: "x".repeat(50) })?.type, "join");
  assert.equal((parse({ type: "join", name: "x".repeat(50) }) as { name: string }).name.length, 20);

  const good: ClientMessage = { type: "start", settings, rounds: makeRounds(5) };
  assert.deepEqual(parse(good), good);
  assert.equal(parse({ ...good, rounds: makeRounds(4) }), null, "wrong round count");
  assert.equal(parse({ ...good, settings: { ...settings, totalRounds: 7 } }), null, "not a round option");
  assert.equal(parse({ ...good, settings: { ...settings, mode: "impossible" } }), null);
  assert.equal(parse({ ...good, settings: { ...settings, winnerTakesAll: "yes" } }), null, "winnerTakesAll must be a boolean");
  const wta = parse({ ...good, settings: { ...settings, winnerTakesAll: true } });
  assert.equal(wta?.type === "start" && wta.settings.winnerTakesAll, true);
  const evil = makeRounds(5);
  evil[2].options[1] = { ...evil[2].options[1], spriteUrl: "javascript:alert(1)" };
  assert.equal(parse({ ...good, rounds: evil }), null, "sprite URLs must be from known hosts");
  const stray = makeRounds(5);
  stray[0].answers = [mon(99)];
  assert.equal(parse({ ...good, rounds: stray }), null, "answers must be options");

  assert.deepEqual(parse({ type: "answer", gameId: 1, roundIndex: 0, pickedIds: [3] }), {
    type: "answer",
    gameId: 1,
    roundIndex: 0,
    pickedIds: [3],
  });
  assert.equal(parse({ type: "answer", gameId: 1, roundIndex: 0, pickedIds: ["3"] }), null);
  assert.deepEqual(parse({ type: "makeHost", playerId: "misty" }), { type: "makeHost", playerId: "misty" });
  assert.equal(parse({ type: "makeHost", playerId: 7 }), null);
  assert.equal(parse({ type: "nope" }), null);
  assert.equal(parseClientMessage("{not json"), null);
});
