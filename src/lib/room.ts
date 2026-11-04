// One multiplayer room: who's in it, who's hosting, and the game being played. The Worker in
// party/room.ts wires this to WebSockets; everything here is plain logic so it can be unit-tested.

import { closeRound, createGame, startClock, submitAnswer, tick, type GameState } from "./engine.ts";
import { MAX_PLAYERS, type ClientMessage, type PlayerInfo, type RoomSnapshot } from "./protocol.ts";

// How long a new round waits for everyone's sprites to load before starting the clock anyway.
export const READY_TIMEOUT_MS = 4000;
// How long a player who disconnects still counts as in the round, so a page refresh or a brief
// network drop doesn't end the round (or start the clock) without them.
export const REJOIN_GRACE_MS = 3000;

type Player = { id: string; name: string };

export class RoomState {
  readonly code: string;
  // Joined players in the order they joined. Players stay listed when they disconnect, so they
  // keep their seat and score if they come back.
  private players = new Map<string, Player>();
  // Open connections per player id (a player can have the page open in two tabs).
  private connections = new Map<string, number>();
  // The first player to join hosts; if they're away, the next connected player stands in.
  private hostId: string | null = null;
  private game: GameState | null = null;
  private gameId = 0;
  private ready = new Set<string>();
  private waitingSince: number | null = null;
  // When each disconnected player's last connection closed.
  private awaySince = new Map<string, number>();

  constructor(code: string) {
    this.code = code;
  }

  isEmpty() {
    return this.connections.size === 0;
  }

  isConnected(id: string) {
    return (this.connections.get(id) ?? 0) > 0;
  }

  currentHost(): string | null {
    if (this.hostId && this.isConnected(this.hostId)) return this.hostId;
    for (const id of this.players.keys()) if (this.isConnected(id)) return id;
    return this.hostId;
  }

  connect(id: string) {
    this.connections.set(id, (this.connections.get(id) ?? 0) + 1);
    this.awaySince.delete(id);
  }

  disconnect(id: string, now: number) {
    const count = (this.connections.get(id) ?? 1) - 1;
    if (count > 0) this.connections.set(id, count);
    else {
      this.connections.delete(id);
      this.awaySince.set(id, now);
    }
    // Someone leaving can mean everyone still here is ready.
    this.advance(now);
  }

  // Applies a message from a player. Returns an error to show them, or null.
  handle(id: string, message: ClientMessage, now: number): string | null {
    switch (message.type) {
      case "join": {
        const existing = this.players.get(id);
        // A full room makes space by letting go of someone who has left and isn't in the current game.
        if (!existing && this.players.size >= MAX_PLAYERS) {
          const gone = [...this.players.keys()].find((playerId) => !this.isConnected(playerId) && !this.isPlaying(playerId));
          if (!gone) return `This room is full (${MAX_PLAYERS} players).`;
          this.players.delete(gone);
        }
        this.players.set(id, { id, name: message.name });
        if (!this.hostId) this.hostId = id;
        break;
      }
      case "start": {
        if (!this.players.has(id)) return "Join the room first.";
        if (this.currentHost() !== id) return "Only the host can start a game.";
        if (this.game && this.game.phase !== "finished") return "A game is already running.";
        // Players who have left drop off the list when a new game starts.
        this.hostId = id;
        for (const playerId of [...this.players.keys()]) {
          if (!this.isConnected(playerId)) this.players.delete(playerId);
        }
        const playerIds = [...this.players.keys()].filter((playerId) => this.isConnected(playerId));
        this.game = createGame(message.settings, message.rounds, playerIds);
        this.gameId += 1;
        this.enterWaiting(now);
        break;
      }
      case "ready": {
        if (!this.game || message.gameId !== this.gameId || message.roundIndex !== this.game.roundIndex) break;
        this.ready.add(id);
        break;
      }
      case "makeHost": {
        if (this.currentHost() !== id) return "Only the host can hand over hosting.";
        if (!this.players.has(message.playerId)) return "That player isn't in the room.";
        if (!this.isConnected(message.playerId)) return "That player is away right now.";
        this.hostId = message.playerId;
        break;
      }
      case "answer": {
        if (!this.game || message.gameId !== this.gameId || message.roundIndex !== this.game.roundIndex) break;
        this.game = submitAnswer(this.game, id, message.pickedIds, now);
        break;
      }
    }
    this.advance(now);
    return null;
  }

  // Moves the game along: starts the clock once everyone is ready, and applies any deadlines that have passed.
  advance(now: number) {
    for (let guard = 0; guard < 10 && this.game; guard += 1) {
      const before = this.game;
      if (before.phase === "waiting" && this.everyoneReady(now)) {
        this.game = startClock(before, now);
      } else if (before.phase === "playing" && this.everyonePresentAnswered(now)) {
        // No need to wait out the clock for players who have left.
        this.game = closeRound(before, now);
      } else {
        this.game = tick(before, now);
        if (this.game.phase === "waiting" && this.game.roundIndex !== before.roundIndex) this.enterWaiting(now);
      }
      if (this.game === before) break;
    }
  }

  // When the room next needs to act on its own, or null if it's waiting on players.
  nextWakeAt(): number | null {
    if (!this.game) return null;
    if (this.game.phase === "reveal") return this.game.revealEndsAt;
    if (this.game.phase === "finished") return null;
    const deadline =
      this.game.phase === "waiting"
        ? this.waitingSince !== null
          ? this.waitingSince + READY_TIMEOUT_MS
          : null
        : this.game.roundEndsAt;
    // Also wake when someone's rejoin grace runs out, since that can mean everyone left is done.
    const graceEnds = this.game.playerIds
      .map((id) => this.awaySince.get(id))
      .filter((since): since is number => since !== undefined)
      .map((since) => since + REJOIN_GRACE_MS);
    const times = [deadline, ...graceEnds].filter((time): time is number => time !== null);
    return times.length ? Math.min(...times) : null;
  }

  snapshotFor(you: string, now: number): RoomSnapshot {
    const game = this.game;
    const revealed = game?.phase === "reveal" || game?.phase === "finished";
    const players: PlayerInfo[] = [...this.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      connected: this.isConnected(player.id),
      score: game?.scores[player.id] ?? 0,
      answered: !!game?.answers[player.id],
      lastResult: revealed ? (game.answers[player.id] ?? null) : null,
    }));
    const round = game?.rounds[game.roundIndex];
    return {
      type: "room",
      code: this.code,
      you,
      hostId: this.currentHost(),
      players,
      game:
        game && round
          ? {
              gameId: this.gameId,
              settings: game.settings,
              roundIndex: game.roundIndex,
              phase: game.phase,
              round,
              remainingMs: game.phase === "playing" && game.roundEndsAt !== null ? Math.max(0, game.roundEndsAt - now) : null,
              frozenSecondsLeft: game.frozenSecondsLeft,
              inGame: game.playerIds.includes(you),
              myPicks: game.answers[you]?.pickedIds ?? null,
              myAnswer: revealed ? (game.answers[you] ?? null) : null,
            }
          : null,
    };
  }

  private enterWaiting(now: number) {
    this.ready = new Set();
    this.waitingSince = now;
  }

  private isPlaying(id: string) {
    return !!this.game && this.game.phase !== "finished" && this.game.playerIds.includes(id);
  }

  // Connected, or disconnected so recently they're probably just reloading the page.
  private isPresent(id: string, now: number) {
    if (this.isConnected(id)) return true;
    const since = this.awaySince.get(id);
    return since !== undefined && now < since + REJOIN_GRACE_MS;
  }

  private everyonePresentAnswered(now: number) {
    if (!this.game) return false;
    const present = this.game.playerIds.filter((id) => this.isPresent(id, now));
    return present.length > 0 && present.every((id) => this.game!.answers[id]);
  }

  private everyoneReady(now: number) {
    if (!this.game) return false;
    if (this.waitingSince !== null && now >= this.waitingSince + READY_TIMEOUT_MS) return true;
    const present = this.game.playerIds.filter((id) => this.isPresent(id, now));
    return present.length > 0 && present.every((id) => this.ready.has(id));
  }
}
