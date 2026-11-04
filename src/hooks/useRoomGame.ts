"use client";

import usePartySocket from "partysocket/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameSettings } from "@/lib/engine";
import type { RoundData } from "@/lib/game";
import type { ClientMessage, PlayerInfo, RoomSnapshot, ServerMessage } from "@/lib/protocol";
import type { GameController, GameView, RoundResultEvent } from "./useLocalGame";

// Where the room server (party/room.ts) runs. The pages read PUBLIC_PARTY_HOST on the server (e.g.
// pokemonguessinggame-rooms.<you>.workers.dev) and pass it in as `configuredHost`. In development it
// defaults to `wrangler dev` on port 8787 of whatever host served the page, so phones on the same Wi-Fi
// can join too.
const IS_DEV = process.env.NODE_ENV === "development";
export const isMultiplayerAvailable = (configuredHost: string | null) => !!configuredHost || IS_DEV;
const resolveHost = (configuredHost: string | null) =>
  configuredHost || (typeof window === "undefined" ? "" : `${window.location.hostname}:8787`);

const PLAYER_ID_KEY = "pgg-player-id";
const PLAYER_NAME_KEY = "pgg-player-name";

// Storage can be unavailable (private mode, blocked cookies), so every access is guarded.
const readStorage = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeStorage = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not fatal: the player just gets a new id next visit.
  }
};
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export type RoomInfo = {
  code: string;
  you: string;
  hostId: string | null;
  isHost: boolean;
  joined: boolean;
  players: PlayerInfo[];
  me: PlayerInfo | undefined;
  inGame: boolean;
  // Changes each time the host starts a new game.
  gameId: number | null;
};

export type RoomController = GameController & {
  room: RoomInfo | null;
  connected: boolean;
  error: string | null;
  savedName: string;
  join: (name: string) => void;
  startGame: (settings: GameSettings, rounds: RoundData[]) => void;
  makeHost: (playerId: string) => void;
};

type Received = { snapshot: RoomSnapshot; receivedAt: number };

// Connects to a multiplayer room. Pass a null code to stay disconnected (solo play).
export function useRoomGame(
  code: string | null,
  configuredHost: string | null,
  onRoundResult: (event: RoundResultEvent) => void,
): RoomController {
  // The player id lives in localStorage so a refresh (or a dropped connection) keeps your seat and score.
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [savedName, setSavedName] = useState("");
  useEffect(() => {
    if (!code) return;
    let id = readStorage(PLAYER_ID_KEY);
    if (!id) {
      id = newId();
      writeStorage(PLAYER_ID_KEY, id);
    }
    setPlayerId(id);
    setSavedName(readStorage(PLAYER_NAME_KEY) ?? "");
  }, [code]);

  const [received, setReceived] = useState<Received | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const socket = usePartySocket({
    host: resolveHost(configuredHost),
    party: "room",
    room: code ?? "none",
    id: playerId ?? undefined,
    enabled: !!code && !!playerId,
    onOpen: () => setConnected(true),
    onClose: () => setConnected(false),
    onMessage: (event: MessageEvent) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }
      if (message.type === "error") setError(message.message);
      else setReceived({ snapshot: message, receivedAt: Date.now() });
    },
  });

  const send = useCallback((message: ClientMessage) => socket.send(JSON.stringify(message)), [socket]);

  // Re-render on each whole second while the clock runs, so the countdown ticks.
  const [now, setNow] = useState(() => Date.now());
  const game = received?.snapshot.game ?? null;
  const endsAt = game?.phase === "playing" && game.remainingMs !== null ? received!.receivedAt + game.remainingMs : null;
  useEffect(() => {
    if (endsAt === null) return;
    const remaining = endsAt - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), remaining % 1000 || 1000);
    return () => clearTimeout(timer);
  }, [endsAt, now]);

  const snapshot = received?.snapshot ?? null;
  const me = snapshot?.players.find((player) => player.id === snapshot.you);

  // Report each round's result once, when the server reveals it.
  const onRoundResultRef = useRef(onRoundResult);
  useEffect(() => {
    onRoundResultRef.current = onRoundResult;
  });
  const reported = useRef("");
  useEffect(() => {
    if (!game?.myAnswer) return;
    const key = `${game.gameId}:${game.roundIndex}`;
    if (reported.current === key) return;
    reported.current = key;
    onRoundResultRef.current({ roundIndex: game.roundIndex, round: game.round, answer: game.myAnswer });
  }, [game]);

  const view = useMemo<GameView | null>(() => {
    if (!game) return null;
    const time = Math.max(now, received?.receivedAt ?? 0);
    const timeLeft =
      endsAt !== null
        ? Math.max(0, Math.ceil((endsAt - time) / 1000 - 1e-9))
        : game.phase === "waiting"
          ? game.settings.questionTime
          : (game.frozenSecondsLeft ?? 0);
    return {
      settings: game.settings,
      roundIndex: game.roundIndex,
      round: game.round,
      phase: game.phase,
      timeLeft,
      myAnswer: game.myAnswer ?? undefined,
      myScore: me?.score ?? 0,
      locked: !game.inGame || game.myPicks !== null,
      myPicks: game.myPicks ?? game.myAnswer?.pickedIds ?? null,
    };
  }, [game, endsAt, now, received?.receivedAt, me?.score]);

  const room = useMemo<RoomInfo | null>(() => {
    if (!snapshot) return null;
    return {
      code: snapshot.code,
      you: snapshot.you,
      hostId: snapshot.hostId,
      isHost: snapshot.hostId === snapshot.you,
      joined: !!me,
      players: snapshot.players,
      me,
      inGame: !!snapshot.game?.inGame,
      gameId: snapshot.game?.gameId ?? null,
    };
  }, [snapshot, me]);

  const gameId = game?.gameId;
  const roundIndex = game?.roundIndex;
  const startClock = useCallback(() => {
    if (gameId !== undefined && roundIndex !== undefined) send({ type: "ready", gameId, roundIndex });
  }, [send, gameId, roundIndex]);

  const submit = useCallback(
    (pickedIds: number[]) => {
      if (gameId !== undefined && roundIndex !== undefined) send({ type: "answer", gameId, roundIndex, pickedIds });
    },
    [send, gameId, roundIndex],
  );

  const join = useCallback(
    (name: string) => {
      setError(null);
      writeStorage(PLAYER_NAME_KEY, name);
      setSavedName(name);
      send({ type: "join", name });
    },
    [send],
  );

  const startGame = useCallback(
    (settings: GameSettings, rounds: RoundData[]) => {
      setError(null);
      send({ type: "start", settings, rounds });
    },
    [send],
  );

  const makeHost = useCallback((playerId: string) => send({ type: "makeHost", playerId }), [send]);

  return { view, startClock, submit, room, connected, error, savedName, join, startGame, makeHost };
}
