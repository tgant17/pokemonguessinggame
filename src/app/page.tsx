"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";

type PokemonSpriteResponse = {
  id: number;
  name: string;
  sprites?: {
    front_default?: string | null;
    other?: {
      ["official-artwork"]?: {
        front_default?: string | null;
      };
      showdown?: {
        front_default?: string | null;
      };
      home?: {
        front_default?: string | null;
      };
    };
  };
};

type PokemonSprite = {
  id: number;
  name: string;
  spriteUrl: string;
};

type TeamState = {
  name: string;
  color: string;
  score: number;
  rounds: number;
};

type RoomPlayer = {
  username: string;
  avatarPokemon: string;
  avatarSprite?: string;
  teamName: string;
  teamColor: string;
  isHost?: boolean;
};

type RoomState = {
  code: number;
  codePokemon: string;
  players: RoomPlayer[];
  started: boolean;
};

type RoundData = {
  options: PokemonSprite[];
  answer: PokemonSprite;
};

const TEAM_PRESETS: TeamState[] = [
  { name: "Red", color: "#ef4444", score: 0, rounds: 0 },
  { name: "Blue", color: "#3b82f6", score: 0, rounds: 0 },
  { name: "Yellow", color: "#facc15", score: 0, rounds: 0 },
  { name: "Green", color: "#22c55e", score: 0, rounds: 0 },
];

const TEAM_COLOR_CHOICES = [
  { name: "Crimson", color: "#ef4444" },
  { name: "Azure", color: "#3b82f6" },
  { name: "Verdant", color: "#22c55e" },
  { name: "Sunbeam", color: "#f59e0b" },
  { name: "Amethyst", color: "#a855f7" },
  { name: "Rose", color: "#f43f5e" },
  { name: "Cyan", color: "#06b6d4" },
  { name: "Slate", color: "#475569" },
];

const QUESTION_TIME = 8;
const SCORE_PER_SECOND = 12;
const PENALTY_WRONG = 15;
const PENALTY_TIMEOUT = 12;

const spriteFromResponse = (data: PokemonSpriteResponse): string | null => {
  const padded = data.id.toString().padStart(3, "0");
  const pokemonAssetsUrl =
    data.id >= 1 && data.id <= 1010 ? `https://assets.pokemon.com/assets/cms2/img/pokedex/full/${padded}.png` : null;
  return (
    pokemonAssetsUrl ??
    data?.sprites?.other?.["official-artwork"]?.front_default ??
    data?.sprites?.other?.showdown?.front_default ??
    data?.sprites?.front_default ??
    data?.sprites?.other?.home?.front_default ??
    null
  );
};

const shuffle = <T,>(array: T[]) => {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

export default function SpriteRushGame() {
  const [pokemonNames, setPokemonNames] = useState<string[]>([]);
  const [rounds, setRounds] = useState<RoundData[]>([]);
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0);
  const [totalRounds, setTotalRounds] = useState(5);
  const [timeLeft, setTimeLeft] = useState(QUESTION_TIME);
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState<"idle" | "correct" | "wrong" | "timeout">("idle");
  const [gameState, setGameState] = useState<"loading" | "ready" | "playing" | "finished">("loading");
  const [isPreparing, setIsPreparing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamState[]>(TEAM_PRESETS);
  const [activeTeam, setActiveTeam] = useState<string>(TEAM_PRESETS[0].name);
  const [showTeams, setShowTeams] = useState(false);
  const [mode, setMode] = useState<"single" | "multiplayer">("single");
  const [multiplayerStep, setMultiplayerStep] = useState<
    "menu" | "create" | "join" | "lobby"
  >("menu");
  const [activeRoom, setActiveRoom] = useState<RoomState | null>(null);
  const [creatorName, setCreatorName] = useState("");
  const [creatorPokemon, setCreatorPokemon] = useState("");
  const [creatorTeamColor, setCreatorTeamColor] = useState<string>(TEAM_COLOR_CHOICES[0].color);
  const [creatorAvatarSprite, setCreatorAvatarSprite] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinPokemon, setJoinPokemon] = useState("");
  const [joinTeamColor, setJoinTeamColor] = useState<string>(TEAM_COLOR_CHOICES[1].color);
  const [joinAvatarSprite, setJoinAvatarSprite] = useState<string | null>(null);
  const [lobbyMessage, setLobbyMessage] = useState<string | null>(null);

  const currentRound = rounds[currentRoundIndex];

  useEffect(() => {
    const loadNames = async () => {
      try {
        const res = await fetch("/pokemon-list.json");
        if (!res.ok) throw new Error("Unable to load cached Pokémon data");
        const data: { names?: string[] } = await res.json();
        setPokemonNames(data.names ?? []);
        setGameState("ready");
      } catch (error) {
        console.error(error);
        setErrorMessage("Failed to load Pokémon data. Please refresh the page.");
      }
    };
    loadNames();
  }, []);

  const fetchPokemonSprite = useCallback(async (name: string): Promise<PokemonSprite | null> => {
    try {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${name}`);
      if (!res.ok) return null;
      const data = (await res.json()) as PokemonSpriteResponse;
      const spriteUrl = spriteFromResponse(data);
      if (!spriteUrl) return null;
      return { id: data.id, name: data.name, spriteUrl };
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (!creatorPokemon) {
      setCreatorAvatarSprite(null);
      return;
    }
    fetchPokemonSprite(creatorPokemon.toLowerCase()).then((sprite) => {
      if (active) setCreatorAvatarSprite(sprite?.spriteUrl ?? null);
    });
    return () => {
      active = false;
    };
  }, [creatorPokemon, fetchPokemonSprite]);

  useEffect(() => {
    let active = true;
    if (!joinPokemon) {
      setJoinAvatarSprite(null);
      return;
    }
    fetchPokemonSprite(joinPokemon.toLowerCase()).then((sprite) => {
      if (active) setJoinAvatarSprite(sprite?.spriteUrl ?? null);
    });
    return () => {
      active = false;
    };
  }, [joinPokemon, fetchPokemonSprite]);

  const buildRound = useCallback(async (): Promise<RoundData | null> => {
    if (!pokemonNames.length) return null;
    const candidates: PokemonSprite[] = [];
    const usedNames = new Set<string>();
    let attempts = 0;
    while (candidates.length < 4 && attempts < 150) {
      attempts += 1;
      const candidate = pokemonNames[Math.floor(Math.random() * pokemonNames.length)];
      if (!candidate || usedNames.has(candidate)) continue;
      const sprite = await fetchPokemonSprite(candidate);
      if (!sprite) continue;
      usedNames.add(candidate);
      candidates.push(sprite);
    }
    if (candidates.length < 4) return null;
    const options = shuffle(candidates);
    const answer = options[Math.floor(Math.random() * options.length)];
    return { options, answer };
  }, [pokemonNames, fetchPokemonSprite]);

  const prepareRounds = useCallback(async () => {
    if (!pokemonNames.length) return;
    setIsPreparing(true);
    setErrorMessage(null);
    const builtRounds: RoundData[] = [];
    while (builtRounds.length < totalRounds) {
      const round = await buildRound();
      if (!round) break;
      builtRounds.push(round);
    }
    if (builtRounds.length < totalRounds) {
      setErrorMessage("Unable to prefetch enough sprites. Please try again.");
      setIsPreparing(false);
      return;
    }
    setRounds(builtRounds);
    setCurrentRoundIndex(0);
    setScore(0);
    setTimeLeft(QUESTION_TIME);
    setStatus("idle");
    setGameState("playing");
    setIsPreparing(false);
  }, [buildRound, pokemonNames.length, totalRounds]);

  const ensureTeamRegistered = useCallback((teamName: string, teamColor: string) => {
    setTeams((prev) => {
      const exists = prev.some((team) => team.name === teamName);
      if (exists) return prev;
      return [...prev, { name: teamName, color: teamColor, score: 0, rounds: 0 }];
    });
  }, []);

  const resetMultiplayer = useCallback(() => {
    setMode("single");
    setMultiplayerStep("menu");
    setActiveRoom(null);
    setCreatorName("");
    setCreatorPokemon("");
    setJoinName("");
    setJoinPokemon("");
    setJoinCode("");
    setLobbyMessage(null);
    setShowTeams(false);
    setTeams(TEAM_PRESETS);
    setActiveTeam(TEAM_PRESETS[0].name);
  }, []);

  const buildRoomCode = useCallback(() => {
    if (!pokemonNames.length) return { code: Math.floor(Math.random() * 1010) + 1, codePokemon: "missingno" };
    const index = Math.floor(Math.random() * pokemonNames.length);
    return { code: index + 1, codePokemon: pokemonNames[index] };
  }, [pokemonNames]);

  const handleCreateRoom = useCallback(() => {
    if (!creatorName || !creatorPokemon) {
      setLobbyMessage("Please choose a username and Pokémon to host a room.");
      return;
    }
    const { code, codePokemon } = buildRoomCode();
    const teamChoice = TEAM_COLOR_CHOICES.find((choice) => choice.color === creatorTeamColor) ?? TEAM_COLOR_CHOICES[0];
    const hostTeamName = `${teamChoice.name} Team`;
    const hostPlayer: RoomPlayer = {
      username: creatorName,
      avatarPokemon: creatorPokemon,
      avatarSprite: creatorAvatarSprite ?? undefined,
      teamColor: creatorTeamColor,
      teamName: hostTeamName,
      isHost: true,
    };
    setActiveRoom({ code, codePokemon, players: [hostPlayer], started: false });
    setLobbyMessage(null);
    setMultiplayerStep("lobby");
    setMode("multiplayer");
    ensureTeamRegistered(hostTeamName, creatorTeamColor);
    setActiveTeam(hostTeamName);
    setShowTeams(true);
    setJoinCode(code.toString());
  }, [buildRoomCode, creatorAvatarSprite, creatorName, creatorPokemon, creatorTeamColor, ensureTeamRegistered]);

  const handleJoinRoom = useCallback(() => {
    if (!activeRoom) {
      setLobbyMessage("No active room found. Ask the host to create one first.");
      return;
    }
    if (parseInt(joinCode, 10) !== activeRoom.code) {
      setLobbyMessage("Incorrect room code. Check with the host and try again.");
      return;
    }
    if (!joinName || !joinPokemon) {
      setLobbyMessage("Please enter your username and Pokémon to join.");
      return;
    }
    if (activeRoom.players.length >= 8) {
      setLobbyMessage("This room is full (8 player limit).");
      return;
    }
    const teamChoice = TEAM_COLOR_CHOICES.find((choice) => choice.color === joinTeamColor) ?? TEAM_COLOR_CHOICES[0];
    const teamName = `${teamChoice.name} Team`;
    const teamCount = activeRoom.players.filter((player) => player.teamName === teamName).length;
    if (teamCount >= 4) {
      setLobbyMessage("That team already has 4 players. Pick another color.");
      return;
    }
    const newPlayer: RoomPlayer = {
      username: joinName,
      avatarPokemon: joinPokemon,
      avatarSprite: joinAvatarSprite ?? undefined,
      teamColor: joinTeamColor,
      teamName,
    };
    const updatedRoom: RoomState = {
      ...activeRoom,
      players: [...activeRoom.players, newPlayer],
    };
    setActiveRoom(updatedRoom);
    ensureTeamRegistered(teamName, joinTeamColor);
    setLobbyMessage(`${joinName} joined ${teamName}!`);
    setJoinName("");
    setJoinPokemon("");
    setJoinCode(activeRoom.code.toString());
    setMode("multiplayer");
  }, [activeRoom, ensureTeamRegistered, joinAvatarSprite, joinCode, joinName, joinPokemon, joinTeamColor]);

  const roomReadyToStart = useMemo(() => {
    if (!activeRoom) return false;
    const teamSet = new Set(activeRoom.players.map((player) => player.teamName));
    return activeRoom.players.length >= 2 && teamSet.size >= 2;
  }, [activeRoom]);

  const handleStartMultiplayer = useCallback(() => {
    if (!roomReadyToStart) {
      setLobbyMessage("You need at least two players on different teams before starting.");
      return;
    }
    setActiveRoom((prev) => (prev ? { ...prev, started: true } : prev));
    setLobbyMessage("The host launched the match! Pass turns between teams as rounds progress.");
    prepareRounds();
  }, [prepareRounds, roomReadyToStart]);

  const advanceRound = useCallback(() => {
    setCurrentRoundIndex((prev) => {
      if (prev + 1 >= totalRounds) {
        setGameState("finished");
        return prev;
      }
      setTimeLeft(QUESTION_TIME);
      setStatus("idle");
      return prev + 1;
    });
  }, [totalRounds]);

  const recordRoundPlayed = useCallback(() => {
    setTeams((prevTeams) =>
      prevTeams.map((team) =>
        team.name === activeTeam ? { ...team, rounds: team.rounds + 1 } : team,
      ),
    );
  }, [activeTeam]);

  const handleTimeout = useCallback(() => {
    if (status !== "idle") return;
    setStatus("timeout");
    setScore((prev) => prev - PENALTY_TIMEOUT);
    setTeams((prevTeams) =>
      prevTeams.map((team) =>
        team.name === activeTeam ? { ...team, score: team.score - PENALTY_TIMEOUT } : team,
      ),
    );
    recordRoundPlayed();
    setTimeout(() => advanceRound(), 900);
  }, [status, advanceRound, activeTeam, recordRoundPlayed]);

  useEffect(() => {
    if (gameState !== "playing" || status !== "idle") return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [gameState, status, handleTimeout, currentRoundIndex]);

  const handleChoice = (choice: PokemonSprite) => {
    if (!currentRound || status !== "idle") return;
    const isCorrect = choice.id === currentRound.answer.id;
    if (isCorrect) {
      const gained = Math.max(5, Math.round(timeLeft * SCORE_PER_SECOND));
      setScore((prev) => prev + gained);
      setTeams((prev) =>
        prev.map((team) =>
          team.name === activeTeam ? { ...team, score: team.score + gained } : team,
        ),
      );
      setStatus("correct");
    } else {
      setScore((prev) => prev - PENALTY_WRONG);
      setTeams((prev) =>
        prev.map((team) =>
          team.name === activeTeam ? { ...team, score: team.score - PENALTY_WRONG } : team,
        ),
      );
      setStatus("wrong");
    }
    recordRoundPlayed();
    setTimeout(() => advanceRound(), 900);
  };

  const roundOptions = [5, 10, 25];
  const activeTeamData = teams.find((team) => team.name === activeTeam) ?? TEAM_PRESETS[0];
  const activeTeamColor = activeTeamData.color;
  const uiColor = showTeams ? activeTeamColor : "#38bdf8";
  const timeProgress = useMemo(() => (timeLeft / QUESTION_TIME) * 100, [timeLeft]);
  const teamRoundDisplay = activeTeamData.rounds + (gameState === "playing" ? 1 : 0);
  const pendingRounds = activeTeamData.rounds + totalRounds;
  const roomReadyToStart = useMemo(() => {
    if (!activeRoom) return false;
    const teamSet = new Set(activeRoom.players.map((player) => player.teamName));
    return activeRoom.players.length >= 2 && teamSet.size >= 2;
  }, [activeRoom]);

  const renderSpriteStage = () => {
    if (gameState === "loading") {
      return <div className="text-slate-400">Loading Pokémon data...</div>;
    }
    if (gameState === "ready") {
      return (
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-center">
          <p className="text-sm text-slate-300">Ready to test your Pokédex knowledge?</p>
          <div className="flex flex-wrap justify-center gap-2 text-xs text-slate-400">
            {roundOptions.map((value) => (
              <button
                key={value}
                onClick={() => setTotalRounds(value)}
                className={`rounded-full border px-3 py-1 font-semibold ${totalRounds === value ? "text-white" : "border-white/20 text-slate-400"}`}
                style={{ borderColor: totalRounds === value ? uiColor : undefined }}
              >
                {value} rounds
              </button>
            ))}
          </div>
          <button
            onClick={prepareRounds}
            disabled={isPreparing}
            className="rounded-2xl px-6 py-3 text-sm font-semibold text-slate-950 transition disabled:cursor-not-allowed disabled:bg-slate-700"
            style={{ backgroundColor: uiColor, boxShadow: `0 10px 25px ${uiColor}33` }}
          >
            {isPreparing ? "Preparing questions..." : "Start game"}
          </button>
        </div>
      );
    }
    if (gameState === "playing" && currentRound) {
      return (
        <div className="relative h-64 w-full">
          <Image
            src={currentRound.answer.spriteUrl}
            alt={`Sprite of ${currentRound.answer.name}`}
            fill
            sizes="(max-width: 768px) 80vw, 40vw"
            className={`object-contain drop-shadow-[0_8px_20px_rgba(16,185,129,0.35)] ${
              status === "idle" ? "brightness-0 contrast-200" : ""
            }`}
            priority
          />
        </div>
      );
    }
    if (gameState === "finished") {
      return (
        <div className="rounded-3xl border border-emerald-400/40 bg-slate-900/80 p-6 text-center shadow-emerald-500/10">
          <p className="text-sm uppercase tracking-[0.5em] text-emerald-300">Game complete</p>
          <h2 className="mt-2 text-3xl font-semibold text-white">Final score: {score}</h2>
          <p className="mt-3 text-slate-300">You conquered {totalRounds} rounds. Switch teams or play again!</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs text-slate-400">
            {roundOptions.map((value) => (
              <button
                key={value}
                onClick={() => setTotalRounds(value)}
                className={`rounded-full border px-3 py-1 font-semibold ${totalRounds === value ? "text-white" : "border-white/20 text-slate-400"}`}
                style={{ borderColor: totalRounds === value ? uiColor : undefined }}
              >
                {value} rounds
              </button>
            ))}
          </div>
          <button
            onClick={prepareRounds}
            disabled={isPreparing}
            className="mt-6 rounded-2xl px-6 py-3 text-sm font-semibold text-slate-950 transition disabled:cursor-not-allowed disabled:bg-slate-700"
            style={{ backgroundColor: uiColor, boxShadow: `0 10px 25px ${uiColor}33` }}
          >
            {isPreparing ? "Preparing questions..." : "Play again"}
          </button>
        </div>
      );
    }
    return null;
  };

  const renderAvatarPreview = (sprite?: string | null, label?: string) => (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/50 p-3 text-left">
      {sprite ? (
        <div className="relative h-12 w-12 overflow-hidden rounded-xl border border-white/10 bg-slate-950/80">
          <Image src={sprite} alt="Selected Pokémon" fill sizes="48px" className="object-contain" />
        </div>
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-white/10 bg-slate-950/80 text-xs text-slate-400">
          PFP
        </div>
      )}
      <div className="text-xs text-slate-300">
        <p className="font-semibold text-white">{label ?? "Avatar preview"}</p>
        <p className="text-slate-400">Pick any Pokémon name to use as your picture.</p>
      </div>
    </div>
  );

  const renderColorChoices = (selected: string, onSelect: (value: string) => void) => (
    <div className="flex flex-wrap gap-2">
      {TEAM_COLOR_CHOICES.map((choice) => (
        <button
          key={choice.color}
          type="button"
          onClick={() => onSelect(choice.color)}
          className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold transition ${
            selected === choice.color ? "ring-2 ring-white" : "border-white/10"
          }`}
          style={{ backgroundColor: `${choice.color}22`, borderColor: `${choice.color}66` }}
        >
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: choice.color, boxShadow: `0 0 0 3px ${choice.color}33` }}
          />
          {choice.name}
        </button>
      ))}
    </div>
  );

  const renderMultiplayerPanel = () => (
    <section className="rounded-3xl border border-white/10 bg-slate-950/50 p-6 shadow-emerald-500/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Multiplayer lobby</p>
          <p className="text-lg font-semibold text-white">Create or join a shared session</p>
        </div>
        {mode === "multiplayer" && (
          <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
            Multiplayer active
          </span>
        )}
      </div>

      {multiplayerStep === "menu" && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => setMultiplayerStep("create")}
            className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-left text-sm font-semibold text-white transition hover:border-emerald-400/60"
          >
            Host a room
            <p className="text-xs font-normal text-slate-400">Generate a Pokédex code and pick your team color.</p>
          </button>
          <button
            type="button"
            onClick={() => setMultiplayerStep("join")}
            className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-left text-sm font-semibold text-white transition hover:border-sky-400/60"
          >
            Join a room
            <p className="text-xs font-normal text-slate-400">Enter a 1-4 digit Pokédex code and choose your team.</p>
          </button>
          <button
            type="button"
            onClick={resetMultiplayer}
            className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-left text-sm font-semibold text-white transition hover:border-white/60"
          >
            Back to solo play
            <p className="text-xs font-normal text-slate-400">Return to classic single-player rounds.</p>
          </button>
        </div>
      )}

      {multiplayerStep === "create" && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr,1fr]">
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
            <p className="text-sm font-semibold text-white">Host details</p>
            <div className="mt-3 grid gap-3 text-sm text-slate-200">
              <label className="space-y-1">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Username</span>
                <input
                  value={creatorName}
                  onChange={(e) => setCreatorName(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
                  placeholder="Ash, Misty, or your own nickname"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Pokémon avatar</span>
                <input
                  value={creatorPokemon}
                  onChange={(e) => setCreatorPokemon(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
                  placeholder="pikachu"
                />
              </label>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Team color</p>
                {renderColorChoices(creatorTeamColor, setCreatorTeamColor)}
              </div>
              {renderAvatarPreview(creatorAvatarSprite, creatorPokemon || "Avatar preview")}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCreateRoom}
                  className="flex-1 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 shadow-lg shadow-emerald-500/30"
                >
                  Generate room
                </button>
                <button
                  type="button"
                  onClick={() => setMultiplayerStep("menu")}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/5 p-4">
            <p className="text-sm font-semibold text-emerald-100">How it works</p>
            <ul className="mt-2 space-y-2 text-xs text-emerald-50/80">
              <li>• We&apos;ll generate a room using a random Pokédex number as the code.</li>
              <li>• Up to 8 players can join; teams cap at 4 players each.</li>
              <li>• The host picks their team color and starts the match once two teams have at least one player.</li>
            </ul>
          </div>
        </div>
      )}

      {multiplayerStep === "join" && (
        <div className="mt-4 grid gap-4 md:grid-cols-[1.1fr,1fr]">
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
            <p className="text-sm font-semibold text-white">Join a lobby</p>
            <div className="mt-3 grid gap-3 text-sm text-slate-200">
              <label className="space-y-1">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Room code</span>
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.replace(/[^0-9]/g, ""))}
                  maxLength={4}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                  placeholder="Dex number (e.g. 25)"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Username</span>
                <input
                  value={joinName}
                  onChange={(e) => setJoinName(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                  placeholder="Your in-game name"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Pokémon avatar</span>
                <input
                  value={joinPokemon}
                  onChange={(e) => setJoinPokemon(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                  placeholder="snorlax"
                />
              </label>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Pick your team</p>
                {renderColorChoices(joinTeamColor, setJoinTeamColor)}
              </div>
              {renderAvatarPreview(joinAvatarSprite, joinPokemon || "Avatar preview")}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleJoinRoom}
                  className="flex-1 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-sky-950 shadow-lg shadow-sky-500/30"
                >
                  Join room
                </button>
                <button
                  type="button"
                  onClick={() => setMultiplayerStep("menu")}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-white"
                >
                  Back
                </button>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-sky-400/30 bg-sky-500/5 p-4">
            <p className="text-sm font-semibold text-sky-100">Need a code?</p>
            <p className="mt-2 text-xs text-sky-50/80">
              Ask the host for their Pokédex number code. Each room uses a random Pokémon entry as the code and can welcome up to
              8 players across two or more teams.
            </p>
          </div>
        </div>
      )}

      {multiplayerStep === "lobby" && activeRoom && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr,1fr]">
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Room code</p>
                <p className="text-3xl font-bold text-white">
                  #{activeRoom.code}
                  <span className="ml-2 text-sm font-normal uppercase text-slate-400">({activeRoom.codePokemon})</span>
                </p>
                <p className="text-xs text-slate-400">Share this Pokédex number with friends to invite them.</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Capacity</p>
                <p className="text-lg font-semibold text-white">{activeRoom.players.length} / 8 players</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              {activeRoom.players.map((player) => (
                <div
                  key={`${player.username}-${player.teamName}`}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3"
                  style={{ boxShadow: `0 8px 20px ${player.teamColor}22` }}
                >
                  <div className="flex items-center gap-3">
                    {player.avatarSprite ? (
                      <div className="relative h-12 w-12 overflow-hidden rounded-xl border border-white/10 bg-slate-900/60">
                        <Image src={player.avatarSprite} alt={player.avatarPokemon} fill sizes="48px" className="object-contain" />
                      </div>
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-white/10 bg-slate-900/60 text-xs text-slate-400">
                        {player.avatarPokemon}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-semibold text-white">{player.username}</p>
                      <p className="text-xs capitalize text-slate-400">As {player.avatarPokemon}</p>
                    </div>
                  </div>
                  <div className="text-right text-xs font-semibold text-white">
                    <span className="mr-2 rounded-full px-2 py-1" style={{ backgroundColor: `${player.teamColor}33`, color: player.teamColor }}>
                      {player.teamName}
                    </span>
                    {player.isHost && <span className="text-amber-300">Host</span>}
                  </div>
                </div>
              ))}
              {activeRoom.players.length < 8 && (
                <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/30 px-4 py-3 text-xs text-slate-400">
                  Waiting for more trainers... share the code to add up to {8 - activeRoom.players.length} more.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/5 p-4">
            <p className="text-sm font-semibold text-emerald-100">Ready check</p>
            <p className="mt-2 text-xs text-emerald-50/80">
              The host starts the match once at least two teams have a player. Each team is capped at 4 people.
            </p>
            <div className="mt-3 grid gap-2 text-xs text-emerald-50/80">
              <p>• Teams active: {activeRoom ? new Set(activeRoom.players.map((p) => p.teamName)).size : 0}</p>
              <p>• Players joined: {activeRoom?.players.length ?? 0}</p>
              <p>• Status: {activeRoom?.started ? "Game live" : "Waiting for host"}</p>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                disabled={!roomReadyToStart}
                onClick={handleStartMultiplayer}
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 shadow-lg shadow-emerald-500/30 disabled:cursor-not-allowed disabled:bg-emerald-700"
              >
                {activeRoom.started ? "Restart match" : "Start match"}
              </button>
              <button
                type="button"
                onClick={() => setMultiplayerStep("join")}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-white"
              >
                Join from this device
              </button>
              <button
                type="button"
                onClick={resetMultiplayer}
                className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100"
              >
                Leave room
              </button>
            </div>
          </div>
        </div>
      )}

      {lobbyMessage && (
        <div className="mt-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">{lobbyMessage}</div>
      )}
    </section>
  );

  return (
    <main
      className="min-h-screen pb-12 text-white transition-colors"
      style={{
        background: `radial-gradient(circle at top, ${uiColor}22 0%, #020617 60%)`,
      }}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10">
        <header className="space-y-3 text-center">
          <h1 className="text-4xl font-semibold" style={{ color: uiColor }}>
            Who&apos;s that Pokémon?
          </h1>
          <p className="text-base text-slate-300">
            Study the sprite and choose the matching Pokémon before the 8-second clock runs out. Quicker answers earn more points!
          </p>
        </header>

        <section className="grid gap-4 text-sm uppercase tracking-wide text-slate-300 sm:grid-cols-3">
          <div
            className="rounded-3xl border bg-slate-900/60 p-4 text-center shadow-lg"
            style={{ borderColor: `${uiColor}55`, boxShadow: `0 10px 25px ${uiColor}22` }}
          >
            <p className="text-xs text-slate-400">Team score</p>
            <p className="mt-2 text-3xl font-bold text-white">{activeTeamData.score}</p>
            <p className="text-xs text-slate-500">Current run: {score}</p>
          </div>
          <div
            className="rounded-3xl border bg-slate-900/60 p-4 text-center shadow-lg"
            style={{ borderColor: `${uiColor}55`, boxShadow: `0 10px 25px ${uiColor}22` }}
          >
            <p className="text-xs text-slate-400">This run</p>
            <p className="mt-2 text-3xl font-bold text-white">
              {Math.min(currentRoundIndex + 1, totalRounds)} / {totalRounds}
            </p>
            <p className="text-xs text-slate-500">
              Team total: {teamRoundDisplay} / {pendingRounds}
            </p>
          </div>
          <div
            className="rounded-3xl border bg-slate-900/60 p-4 text-center shadow-lg"
            style={{ borderColor: `${uiColor}55`, boxShadow: `0 10px 25px ${uiColor}22` }}
          >
            <p className="text-xs text-slate-400">Time left</p>
            <p className="mt-2 text-3xl font-bold" style={{ color: uiColor }}>
              {timeLeft}s
            </p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full transition-all" style={{ width: `${timeProgress}%`, backgroundColor: uiColor }} />
            </div>
          </div>
        </section>

        {errorMessage && (
          <div className="rounded-3xl border border-rose-400/40 bg-rose-500/10 p-4 text-center text-sm text-rose-100">{errorMessage}</div>
        )}

        <section className="grid gap-8 lg:grid-cols-[2fr,3fr]">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/40 p-6 text-center shadow-2xl shadow-emerald-500/10">
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Sprite</p>
            <div className="mt-6 flex min-h-[320px] items-center justify-center rounded-[30px] border border-dashed border-white/10 bg-slate-900/60 p-8">
              {renderSpriteStage()}
            </div>
            <p className="mt-4 text-xs text-slate-400">Sprite data fetched live from the PokéAPI sprites collection.</p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Choose wisely</p>
            <div className="mt-4 grid gap-4">
              {gameState === "playing" && currentRound
                ? currentRound.options.map((option) => {
                    const isCorrect = status !== "idle" && currentRound.answer.id === option.id;
                    const isWrong = status === "wrong" && currentRound.answer.id !== option.id;
                    return (
                      <button
                        key={`${option.id}-${option.name}`}
                        onClick={() => handleChoice(option)}
                        disabled={status !== "idle"}
                        className={`w-full rounded-2xl border px-4 py-3 text-left text-lg font-semibold capitalize transition ${
                          isCorrect
                            ? "text-white"
                            : isWrong
                              ? "border-rose-400 bg-rose-500/10 text-white"
                              : "bg-slate-900/60 text-slate-200"
                        } ${status !== "idle" ? "cursor-default" : ""}`}
                        style={{
                          borderColor: isCorrect ? uiColor : isWrong ? "#f87171" : `${uiColor}33`,
                          backgroundColor: isCorrect ? `${uiColor}22` : undefined,
                        }}
                      >
                        {option.name.replace(/-/g, " ")}
                      </button>
                    );
                  })
                : Array.from({ length: 4 }).map((_, index) => (
                    <div key={`placeholder-${index}`} className="rounded-2xl border border-white/5 bg-slate-900/40 px-4 py-3 text-left text-lg text-slate-500">
                      Option {index + 1}
                    </div>
                  ))}
            </div>
            {status !== "idle" && (
              <div className="mt-6 rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-center text-sm">
                {status === "correct" && <p className="text-emerald-300">Great job! You earned bonus points for speed.</p>}
                {status === "wrong" && <p className="text-rose-300">Not quite! That sprite belonged to {currentRound?.answer.name}.</p>}
                {status === "timeout" && <p className="text-amber-300">Time&apos;s up! You lost a few points.</p>}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Team play</p>
              <p className="text-lg font-semibold text-white">Pass the device between teams and track points</p>
            </div>
            <button
              type="button"
              onClick={() => setShowTeams((prev) => !prev)}
              className="rounded-2xl border px-4 py-2 text-sm font-semibold text-white"
              style={{ borderColor: `${activeTeamColor}66` }}
            >
              {showTeams ? "Hide teams" : "Show teams"}
            </button>
          </div>

          {showTeams && (
            <div className="mt-4">
              <div className="flex flex-wrap gap-3">
                {teams.map((team) => (
                  <button
                    key={team.name}
                    type="button"
                    onClick={() => setActiveTeam(team.name)}
                    className={`flex-1 min-w-[120px] rounded-2xl border px-4 py-2 text-left text-sm font-semibold transition ${
                      activeTeam === team.name ? "text-white" : "text-slate-900"
                    }`}
                    style={{
                      borderColor: team.color,
                      backgroundColor: activeTeam === team.name ? team.color : `${team.color}33`,
                    }}
                  >
                    <p className="text-lg text-white drop-shadow">{team.name} Team</p>
                    <p className="mt-1 text-xs text-white/80">Score: {team.score}</p>
                    <p className="text-xs text-white/80">Rounds: {team.rounds}</p>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Current team: <span className="font-semibold text-white">{activeTeam}</span>. Scores update automatically after each round.
              </p>
            </div>
          )}
        </section>

        {renderMultiplayerPanel()}
      </div>
    </main>
  );
}
