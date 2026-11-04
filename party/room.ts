// Cloudflare Worker hosting multiplayer rooms. Each room code gets its own Durable Object (via PartyServer),
// so a room's players all talk to one instance that runs the game. The rules live in src/lib/room.ts.
// Run locally with `npm run dev:party`; deploy with `npm run deploy:party`.

import { routePartykitRequest, Server, type Connection, type WSMessage } from "partyserver";
import { isRoomCode, parseClientMessage, type ServerMessage } from "../src/lib/protocol.ts";
import { RoomState } from "../src/lib/room.ts";

type Env = { Room: DurableObjectNamespace<Room> };

// Once everyone has left, a room is wiped after this long, so a refresh doesn't lose the game
// but an abandoned room doesn't linger. Anyone opening the code later gets a fresh room.
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;

export class Room extends Server<Env> {
  private room: RoomState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cleanup: ReturnType<typeof setTimeout> | null = null;

  private get state() {
    this.room ??= new RoomState(this.name);
    return this.room;
  }

  onConnect(connection: Connection) {
    if (this.cleanup) clearTimeout(this.cleanup);
    this.cleanup = null;
    this.state.connect(connection.id);
    this.sync();
  }

  onMessage(connection: Connection, raw: WSMessage) {
    const message = parseClientMessage(raw);
    if (!message) return;
    const error = this.state.handle(connection.id, message, Date.now());
    if (error) this.send(connection, { type: "error", message: error });
    this.sync();
  }

  onClose(connection: Connection) {
    this.state.disconnect(connection.id, Date.now());
    this.sync();
    if (this.state.isEmpty()) {
      if (this.cleanup) clearTimeout(this.cleanup);
      this.cleanup = setTimeout(() => {
        if (!this.state.isEmpty()) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.room = null;
      }, EMPTY_ROOM_TTL_MS);
    }
  }

  // Sends every connection its own view of the room and sets a timer for the next deadline.
  private sync() {
    const now = Date.now();
    for (const connection of this.getConnections()) this.send(connection, this.state.snapshotFor(connection.id, now));
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const wake = this.state.nextWakeAt();
    if (wake !== null) {
      this.timer = setTimeout(() => {
        this.state.advance(Date.now());
        this.sync();
      }, Math.max(0, wake - now));
    }
  }

  private send(connection: Connection, message: ServerMessage) {
    connection.send(JSON.stringify(message));
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Only /parties/room/<CODE> is served; anything else (including malformed codes) is a 404.
    const match = url.pathname.match(/^\/parties\/room\/([^/]+)$/);
    if (!match || !isRoomCode(match[1])) return new Response("Not found", { status: 404 });
    return (await routePartykitRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
