import assert from "node:assert/strict";
import { test } from "node:test";
import type { GameSettings } from "./engine.ts";
import { MODE_CONFIG, type PokemonSprite, type RoundData } from "./game.ts";
import {
  MAX_NAME_LENGTH,
  clampName,
  cleanName,
  isRoomCode,
  makeRoomCode,
  nameLength,
  normalizeRoomCode,
  parseClientMessage,
  type ClientMessage,
} from "./protocol.ts";
import { MAX_EVENTS, READY_TIMEOUT_MS, RENAME_MERGE_MS, REJOIN_GRACE_MS, RoomState } from "./room.ts";

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
  for (const [id, name, partner] of [["ash", "Ash", mon(25)], ["misty", "Misty", mon(120)]] as const) {
    room.connect(id);
    room.handle(id, { type: "join", name, partner, profile: { color: null } }, T0);
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
  assert.deepEqual(snapshot.players.map((p) => p.partner?.id), [25, 120], "everyone sees each player's partner");
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
    room.handle(`p${i}`, { type: "join", name: `P${i}`, partner: null, profile: { color: null } }, T0);
  }
  room.connect("late");
  assert.equal(room.handle("late", { type: "join", name: "Late", partner: null, profile: { color: null } }, T0), "This room is full (12 players).");
  room.disconnect("p5", T0);
  assert.equal(room.handle("late", { type: "join", name: "Late", partner: null, profile: { color: null } }, T0), null);
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
  room.handle("brock", { type: "join", name: "Brock", partner: null, profile: { color: null } }, T0);
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
  assert.deepEqual(parse({ type: "join", name: "  Misty \n Wa  ", partner: mon(120) }), {
    type: "join",
    name: "Misty Wa",
    partner: mon(120),
    profile: { color: null },
  });
  assert.equal(parse({ type: "join", name: "   " }), null);
  assert.equal((parse({ type: "join", name: "x".repeat(50) }) as { name: string }).name.length, 10, "names are cut to 10");
  assert.deepEqual(parse({ type: "join", name: "Ash" }), { type: "join", name: "Ash", partner: null, profile: { color: null } }, "partner is optional");
  assert.equal(
    parse({ type: "join", name: "Ash", partner: { ...mon(25), spriteUrl: "https://evil.example/25.png" } }),
    null,
    "a partner must be a valid sprite from a known host",
  );
  assert.equal(parse({ type: "join", name: "Ash", partner: "pikachu" }), null);

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

test("players can set a name color, and everyone sees it", () => {
  const room = twoPlayerRoom();
  room.handle("ash", { type: "profile", profile: { color: "#ff8800" } }, T0);
  const seenByMisty = room.snapshotFor("misty", T0).players.find((p) => p.id === "ash");
  assert.deepEqual(seenByMisty?.profile, { color: "#ff8800" });

  room.connect("gary");
  assert.equal(room.handle("gary", { type: "profile", profile: { color: "#000000" } }, T0), "Join the room first.");

  // Bad values from a browser are dropped rather than trusted.
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "profile", profile: { color: "url(x)" } })), {
    type: "profile",
    profile: { color: null },
  });
  assert.deepEqual(
    (parseClientMessage(JSON.stringify({ type: "join", name: "Ash", profile: { color: "#ABCDEF" } })) as ClientMessage & { type: "join" }).profile,
    { color: "#abcdef" },
  );
});

test("players can change their name after joining, and everyone sees it", () => {
  const room = twoPlayerRoom();
  assert.equal(room.handle("ash", { type: "rename", name: "Red" }, T0), null);
  const seenByMisty = room.snapshotFor("misty", T0).players.find((p) => p.id === "ash");
  assert.equal(seenByMisty?.name, "Red");

  room.connect("gary");
  assert.equal(room.handle("gary", { type: "rename", name: "Blue" }, T0), "Join the room first.");

  // The new name is cleaned the same way as a name typed when joining.
  const parse = (value: unknown) => parseClientMessage(JSON.stringify(value));
  assert.deepEqual(parse({ type: "rename", name: "  Brock \n of Pewter " }), { type: "rename", name: "Brock of P" });
  assert.equal(parse({ type: "rename", name: "   " }), null);
  assert.equal(parse({ type: "rename", name: 42 }), null);
});

// The chat log as "Ash joined" / "Ash→Red" lines, with the round each happened in ("lobby" between games).
const chatLog = (room: RoomState, now = T0) =>
  (room.snapshotFor("ash", now).events ?? []).map((event) =>
    `${event.round ?? "lobby"}: ${event.kind === "join" ? `${event.name} joined` : `${event.from}→${event.to}`}`,
  );
const join = (room: RoomState, id: string, name: string, now = T0) => {
  room.connect(id);
  return room.handle(id, { type: "join", name, partner: mon(74), profile: { color: null } }, now);
};

test("joins and name changes go in everyone's chat log, in order", () => {
  const room = twoPlayerRoom();
  room.handle("misty", { type: "rename", name: "Kasumi" }, T0 + 1000);
  join(room, "brock", "Brock", T0 + 2000);
  assert.deepEqual(chatLog(room), ["lobby: Ash joined", "lobby: Misty joined", "lobby: Misty→Kasumi", "lobby: Brock joined"]);
  const brock = room.snapshotFor("misty", T0).events?.at(-1);
  assert.equal(brock?.kind === "join" && brock.playerId, "brock");

  // Joining again isn't news, and neither is "renaming" to the same name.
  join(room, "brock", "Brock", T0 + 3000);
  room.handle("brock", { type: "rename", name: "Brock" }, T0 + 3000);
  assert.equal(chatLog(room).length, 4);
  // A rejected rename leaves no trace.
  room.connect("gary");
  room.handle("gary", { type: "rename", name: "Blue" }, T0 + 3000);
  assert.equal(chatLog(room).length, 4);
});

test("editing a name letter by letter shows up as one change", () => {
  const room = twoPlayerRoom();
  for (const [name, at] of [["As", 0], ["A", 400], ["R", 900], ["Re", 1200], ["Red", 1500]] as const) {
    room.handle("ash", { type: "rename", name }, T0 + at);
  }
  assert.deepEqual(chatLog(room).slice(2), ["lobby: Ash→Red"]);

  // Typing back to the name you started with takes the line away again.
  room.handle("ash", { type: "rename", name: "Ash" }, T0 + 2000);
  assert.deepEqual(chatLog(room).slice(2), []);

  // A change long after the last one is news of its own...
  room.handle("ash", { type: "rename", name: "Red" }, T0 + 3000);
  room.handle("ash", { type: "rename", name: "Blue" }, T0 + 3000 + RENAME_MERGE_MS);
  assert.deepEqual(chatLog(room).slice(2), ["lobby: Ash→Red", "lobby: Red→Blue"]);
  // ...and so is one after something else happened in between.
  room.handle("misty", { type: "rename", name: "Kasumi" }, T0 + 3000 + RENAME_MERGE_MS);
  room.handle("ash", { type: "rename", name: "Green" }, T0 + 3000 + RENAME_MERGE_MS);
  assert.deepEqual(chatLog(room).slice(4), ["lobby: Misty→Kasumi", "lobby: Blue→Green"]);
});

test("the chat log notes the round things happened in, and starts over each game", () => {
  const room = twoPlayerRoom();
  start(room);
  assert.deepEqual(chatLog(room), [], "a new game clears the lobby's log, as everyone's screen does");
  join(room, "brock", "Brock", T0);
  ready(room, "ash", T0);
  ready(room, "misty", T0);
  answer(room, "ash", [1], T0 + 500);
  answer(room, "misty", [1], T0 + 500);
  room.advance(room.nextWakeAt()!);
  room.handle("ash", { type: "rename", name: "Red" }, T0 + 5000);
  assert.deepEqual(chatLog(room), ["0: Brock joined", "1: Ash→Red"]);

  // Play out the rest of the game; anything after the last round is back in the lobby.
  let now = T0 + 5000;
  for (let round = 1; round < 5; round += 1) {
    ready(room, "ash", now, round);
    ready(room, "misty", now, round);
    answer(room, "ash", [round * 10 + 1], now, round);
    answer(room, "misty", [round * 10 + 1], now, round);
    now = room.nextWakeAt()!;
    room.advance(now);
  }
  assert.equal(room.snapshotFor("ash", now).game?.phase, "finished");
  room.handle("misty", { type: "rename", name: "Kasumi" }, now);
  assert.deepEqual(chatLog(room, now).at(-1), "lobby: Misty→Kasumi");
});

test("the chat log keeps only the latest lines", () => {
  const room = twoPlayerRoom();
  for (let n = 0; n < MAX_EVENTS + 5; n += 1) {
    room.handle(n % 2 ? "ash" : "misty", { type: "rename", name: `Name ${n}` }, T0 + n);
  }
  const events = room.snapshotFor("ash", T0).events ?? [];
  assert.equal(events.length, MAX_EVENTS);
  const last = events.at(-1);
  assert.equal(last?.kind === "rename" && last.to, `Name ${MAX_EVENTS + 4}`);
  assert.equal(new Set(events.map((event) => event.id)).size, MAX_EVENTS, "every line has its own id");
});

test("names are at most 10 characters, counted the way people count them", () => {
  assert.equal(MAX_NAME_LENGTH, 10);
  assert.equal(clampName("Ash Ketchum of Pallet"), "Ash Ketchu");
  assert.equal(clampName("Mi\tsty\n"), "Misty", "tabs and newlines are dropped while typing");
  // Emoji are one character each and are never split into half a surrogate pair.
  assert.equal(nameLength("⚡⚡⚡"), 3);
  const clamped = clampName("Pika⚡⚡⚡⚡⚡⚡⚡");
  assert.equal(clamped, "Pika⚡⚡⚡⚡⚡⚡");
  assert.equal(nameLength(clamped), 10);
  assert.ok(!/[\uD800-\uDBFF]$/.test(clampName("abcdefghi🔥🔥")));

  assert.equal(cleanName("  Brock  "), "Brock");
  assert.equal(cleanName("Team   Rocket"), "Team Rocke");
  assert.equal(cleanName("Ash Ketch m"), "Ash Ketch", "a space left at the cut is trimmed");
  assert.equal(cleanName("   "), null);
  assert.equal(cleanName(42), null);
});
