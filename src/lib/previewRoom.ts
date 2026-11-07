// A pretend room server that runs inside the page, used by builds with PREVIEW_ENVIRONMENT=true so the
// multiplayer screens can be stepped through in a preview deployment without connecting to anything.
// It drives the same RoomState as the real server (party/room.ts) and speaks the same JSON messages, so
// the page can't tell the difference. Only the player on this page is in the room: nobody else can join.

import { parseClientMessage, type ServerMessage } from "./protocol.ts";
import { RoomState } from "./room.ts";

export class PreviewRoom {
  private readonly state: RoomState;
  private readonly playerId: string;
  private readonly deliver: (data: string) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  // Opens the room and connects the player, who is sent the room's state straight away.
  constructor(code: string, playerId: string, deliver: (data: string) => void) {
    this.state = new RoomState(code);
    this.playerId = playerId;
    this.deliver = deliver;
    this.state.connect(playerId);
    this.sync();
  }

  // Takes a message exactly as the page would send it over the socket.
  send(raw: string) {
    if (this.closed) return;
    const message = parseClientMessage(raw);
    if (!message) return;
    const error = this.state.handle(this.playerId, message, Date.now());
    if (error) this.post({ type: "error", message: error });
    this.sync();
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // As on the real server: send the latest state, then wake up for the next deadline (clock, reveal).
  private sync() {
    const now = Date.now();
    this.post(this.state.snapshotFor(this.playerId, now));
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

  // Messages arrive on a later tick, like they would over the network, so the page never gets a reply
  // in the middle of sending.
  private post(message: ServerMessage) {
    const data = JSON.stringify(message);
    setTimeout(() => {
      if (!this.closed) this.deliver(data);
    }, 0);
  }
}
