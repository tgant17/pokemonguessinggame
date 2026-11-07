"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  NameTag,
  SketchFrame,
  SketchIcon,
  SketchLine,
  SketchPanel,
  SketchStrike,
  SketchUnderline,
  useBoil,
} from "@/components/sketch";
import {
  MODE_CONFIG,
  ROUND_OPTIONS,
  buildRounds,
  formatName,
  joinNames,
  type GameMode,
  type PokemonSprite,
  type RoundOutcome,
  type RoundStatus,
} from "@/lib/game";
import { useLocalGame, type GameController, type RoundResultEvent } from "@/hooks/useLocalGame";
import { multiplayerAvailable, useRoomGame } from "@/hooks/useRoomGame";
import { MAX_NAME_LENGTH } from "@/lib/protocol";



type TeamState = {
  name: string;
  color: string;
  score: number;
  rounds: number;
};


// Who posted a message in the chat log: a team, or the solo player.
type Tag = { label: string; color?: string };

// One finished round, kept in the chat log on the top screen.
type RoundRecord = {
  round: number;
  answers: PokemonSprite[];
  options: PokemonSprite[];
  pickedIds: number[];
  outcome: RoundOutcome;
  delta: number;
  tag: Tag;
};


// Each timer has a Pokémon mascot that matches its pace (icons live in public/timer-icons).
const TIMER_OPTIONS = [
  { seconds: 5, pace: "Blitz", pokemon: "Jolteon", icon: "/timer-icons/jolteon.png" },
  { seconds: 8, pace: "Standard", pokemon: "Pikachu", icon: "/timer-icons/pikachu.png" },
  { seconds: 10, pace: "Relaxed", pokemon: "Blastoise", icon: "/timer-icons/blastoise.png" },
  { seconds: 15, pace: "Easy", pokemon: "Slowpoke", icon: "/timer-icons/slowpoke.png" },
];
// Timers shorter than Normal's 8-second default get the "blitz" treatment so the harder choice stands out.
const isBlitzTime = (seconds: number) => seconds < MODE_CONFIG.normal.defaultTime;
// The timer starts to shake in the last few seconds.
const URGENT_SECONDS = 3;

// How stacked silhouettes spread out on reveal: horizontal step (% of stage width) and shrink factor.
const REVEAL_LAYOUT: Record<number, { step: number; scale: number }> = {
  2: { step: 52, scale: 0.68 },
  3: { step: 34, scale: 0.42 },
};

const NUMBER_WORDS = ["zero", "one", "two", "three"];

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const TEAM_PRESETS: TeamState[] = [
  { name: "Red", color: "#f87171", score: 0, rounds: 0 },
  { name: "Blue", color: "#60a5fa", score: 0, rounds: 0 },
  { name: "Yellow", color: "#facc15", score: 0, rounds: 0 },
  { name: "Green", color: "#4ade80", score: 0, rounds: 0 },
];

const SOLO_TAG: Tag = { label: "You" };
const HOST_TAG: Tag = { label: "Host" };



const formatDelta = (delta: number) => (delta > 0 ? `+${delta}` : `${delta}`);

const OUTCOME_ICON: Record<RoundOutcome, "check" | "cross" | "clock" | null> = {
  correct: "check",
  partial: null,
  wrong: "cross",
  timeout: "clock",
};

function OutcomeMark({ outcome, hits, total, draw = false, className = "h-6 w-6" }: {
  outcome: RoundOutcome;
  hits: number;
  total: number;
  draw?: boolean;
  className?: string;
}) {
  const icon = OUTCOME_ICON[outcome];
  if (icon) return <SketchIcon name={icon} className={className} strokeWidth={2.8} draw={draw} />;
  return (
    <span className="font-hand text-2xl font-bold leading-none">
      {hits}/{total}
    </span>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-xs uppercase tracking-[0.25em] text-ink-soft">{children}</p>;
}

// A one-line system message in the chat log, e.g. "Normal · 10 rounds".
function Notice({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="message-in flex items-center justify-center gap-2 text-xs text-ink-soft">
      <span className="h-px w-5 bg-ink-faint" />
      {icon}
      <span>{children}</span>
      <span className="h-px w-5 bg-ink-faint" />
    </div>
  );
}

// A full chat message with a name tag hanging off its top-left corner.
function Message({ tag, children, className = "" }: { tag: Tag; children: ReactNode; className?: string }) {
  return (
    <div className={`message-in relative isolate mt-3 px-3 pb-3 pt-5 ${className}`}>
      <SketchFrame radius={16} wobble={1.1} strokeWidth={2.6} fill="ruled" draw />
      <span className="absolute -top-3 left-3">
        <NameTag label={tag.label} color={tag.color} />
      </span>
      {children}
    </div>
  );
}

// Solo and pass-the-device play by default; pass a room code to play in a multiplayer room.
export default function SpriteRushGame({ roomCode = null }: { roomCode?: string | null }) {
  const inRoom = roomCode !== null;
  const [pokemonNames, setPokemonNames] = useState<string[]>([]);
  const [namesReady, setNamesReady] = useState(false);
  // What the setup panel has selected; a game in progress uses the settings it started with.
  const [setupRounds, setTotalRounds] = useState(5);
  const [setupMode, setMode] = useState<GameMode>("normal");
  const [setupTime, setQuestionTime] = useState(MODE_CONFIG.normal.defaultTime);
  const [selection, setSelection] = useState<{ round: number; ids: number[] }>({ round: -1, ids: [] });
  const [isPreparing, setIsPreparing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamState[]>(TEAM_PRESETS);
  const [activeTeam, setActiveTeam] = useState<string>(TEAM_PRESETS[0].name);
  const [showTeams, setShowTeams] = useState(false);
  const [history, setHistory] = useState<RoundRecord[]>([]);
  const feedRef = useRef<HTMLDivElement>(null);

  const activeTeamData = teams.find((team) => team.name === activeTeam) ?? TEAM_PRESETS[0];
  const teamTag = useMemo<Tag>(
    () => (showTeams ? { label: activeTeamData.name, color: activeTeamData.color } : SOLO_TAG),
    [showTeams, activeTeamData.name, activeTeamData.color],
  );
  // The round-result handler reads the tag through a ref, since in a room the tag (your name) comes from
  // the room hook, which itself needs the handler.
  const tagRef = useRef<Tag>(teamTag);

  // Each finished round goes to the chat log, and in solo play to the active team's totals.
  const handleRoundResult = useCallback(
    ({ roundIndex, round, answer }: RoundResultEvent) => {
      if (!inRoom) setTeams((prevTeams) =>
        prevTeams.map((team) =>
          team.name === activeTeam ? { ...team, score: team.score + answer.delta, rounds: team.rounds + 1 } : team,
        ),
      );
      setHistory((prev) => [
        ...prev,
        {
          round: roundIndex,
          answers: round.answers,
          options: round.options,
          pickedIds: answer.pickedIds,
          outcome: answer.outcome,
          delta: answer.delta,
          tag: tagRef.current,
        },
      ]);
    },
    [activeTeam, inRoom],
  );

  const localGame = useLocalGame(handleRoundResult);
  const roomGame = useRoomGame(multiplayerAvailable ? roomCode : null, handleRoundResult);
  const room = inRoom ? roomGame.room : null;
  const game: GameController = inRoom ? roomGame : localGame;
  const { view } = game;
  const currentTag = useMemo<Tag>(
    () => (inRoom ? { label: room?.me?.name ?? "You" } : teamTag),
    [inRoom, room?.me?.name, teamTag],
  );
  useEffect(() => {
    tagRef.current = currentTag;
  }, [currentTag]);

  const gameState: "loading" | "ready" | "playing" | "finished" = !namesReady || (inRoom && !room)
    ? "loading"
    : !view
      ? "ready"
      : view.phase === "finished"
        ? "finished"
        : "playing";
  const playing = gameState === "playing" && view ? view : null;
  const mode = playing?.settings.mode ?? setupMode;
  const totalRounds = playing?.settings.totalRounds ?? setupRounds;
  const questionTime = playing?.settings.questionTime ?? setupTime;
  const modeConfig = MODE_CONFIG[mode];
  const isMulti = modeConfig.answerCount > 1;
  const timeLeft = playing?.timeLeft ?? questionTime;
  const score = view?.myScore ?? 0;
  const status: RoundStatus = view?.myAnswer?.outcome ?? "idle";
  const currentRound = view?.round;
  const currentRoundIndex = view?.roundIndex ?? 0;
  const selectedIds = selection.round === currentRoundIndex ? selection.ids : [];

  // Stacked silhouettes stay hidden until every sprite in the round has loaded, so none pops in before the others.
  const [loadedSprites, setLoadedSprites] = useState<{ round: number; ids: number[] }>({ round: -1, ids: [] });
  const spritesReady =
    !!currentRound &&
    loadedSprites.round === currentRoundIndex &&
    currentRound.answers.every((answer) => loadedSprites.ids.includes(answer.id));
  const markSpriteLoaded = useCallback(
    (round: number, id: number) => {
      setLoadedSprites((prev) => {
        const ids = prev.round === round ? prev.ids : [];
        return ids.includes(id) ? prev : { round, ids: [...ids, id] };
      });
    },
    [],
  );

  // The round's clock only starts once its sprites are on screen.
  const { startClock } = game;
  useEffect(() => {
    if (view?.phase === "waiting" && spritesReady) startClock();
  }, [view?.phase, spritesReady, startClock]);

  useEffect(() => {
    const loadNames = async () => {
      try {
        const res = await fetch("/pokemon-list.json");
        if (!res.ok) throw new Error("Unable to load cached Pokémon data");
        const data: { names?: string[] } = await res.json();
        setPokemonNames(data.names ?? []);
        setNamesReady(true);
      } catch (error) {
        console.error(error);
        setErrorMessage("Failed to load Pokémon data. Please refresh the page.");
      }
    };
    loadNames();
  }, []);

  const { start: startLocalGame } = localGame;
  const { startGame: roomStartGame } = roomGame;
  const prepareRounds = useCallback(async () => {
    if (!pokemonNames.length) return;
    setIsPreparing(true);
    setErrorMessage(null);
    const builtRounds = await buildRounds(pokemonNames, setupMode, setupRounds);
    if (!builtRounds) {
      setErrorMessage("Unable to prefetch enough sprites. Please try again.");
      setIsPreparing(false);
      return;
    }
    setLoadedSprites({ round: -1, ids: [] });
    setSelection({ round: -1, ids: [] });
    setHistory([]);
    const settings = { mode: setupMode, totalRounds: setupRounds, questionTime: setupTime };
    if (inRoom) roomStartGame(settings, builtRounds);
    else startLocalGame(settings, builtRounds);
    setIsPreparing(false);
  }, [pokemonNames, setupMode, setupRounds, setupTime, startLocalGame, roomStartGame, inRoom]);

  // In a room the host starts games, so everyone clears the last game's log when a new one begins.
  const roomGameId = room?.gameId ?? null;
  useEffect(() => {
    if (roomGameId === null) return;
    setLoadedSprites({ round: -1, ids: [] });
    setSelection({ round: -1, ids: [] });
    setHistory([]);
  }, [roomGameId]);

  // Keep the newest chat message in view, like a chat log.
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    feed.scrollTo({ top: feed.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [history.length, currentRoundIndex, gameState, status, errorMessage, isPreparing]);

  const canAnswer = view?.phase === "playing" && status === "idle" && !view.locked && spritesReady;

  const handleChoice = (choice: PokemonSprite) => {
    if (!currentRound || !canAnswer) return;
    if (isMulti) {
      // Multi-pick modes: tapping toggles a pick; one tap past the limit replaces the oldest pick.
      setSelection((prev) => {
        const ids = prev.round === currentRoundIndex ? prev.ids : [];
        if (ids.includes(choice.id)) return { round: currentRoundIndex, ids: ids.filter((id) => id !== choice.id) };
        const next = [...ids, choice.id];
        return {
          round: currentRoundIndex,
          ids: next.length > modeConfig.answerCount ? next.slice(next.length - modeConfig.answerCount) : next,
        };
      });
      return;
    }
    setSelection({ round: currentRoundIndex, ids: [choice.id] });
    game.submit([choice.id]);
  };

  const handleSubmitPicks = () => {
    if (!currentRound || !canAnswer || selectedIds.length !== modeConfig.answerCount) return;
    game.submit(selectedIds);
  };

  const selectQuestionTime = (value: number) => {
    setQuestionTime(value);
  };

  const selectMode = (value: GameMode) => {
    setMode(value);
    selectQuestionTime(MODE_CONFIG[value].defaultTime);
  };

  const timeProgress = (timeLeft / questionTime) * 100;
  const isBlitz = isBlitzTime(questionTime);
  const isUrgent = gameState === "playing" && status === "idle" && timeLeft <= URGENT_SECONDS;
  const boilTick = useBoil(isUrgent);
  const selectedTimer = TIMER_OPTIONS.find((option) => option.seconds === questionTime) ?? TIMER_OPTIONS[1];
  const answerCountWord = NUMBER_WORDS[modeConfig.answerCount] ?? String(modeConfig.answerCount);
  const roundHits = currentRound ? currentRound.answers.filter((answer) => selectedIds.includes(answer.id)).length : 0;
  const isSetup = gameState === "ready" || gameState === "finished";
  const roundLabel =
    gameState === "playing"
      ? `${currentRoundIndex + 1}/${totalRounds}`
      : gameState === "finished"
        ? `${totalRounds}/${totalRounds}`
        : `–/${totalRounds}`;
  const instructions = isMulti
    ? `${capitalize(answerCountWord)} silhouettes are stacked on top of each other. Pick all ${answerCountWord} Pokémon before the ${questionTime}-second clock runs out!`
    : `Study the silhouette and choose the matching Pokémon before the ${questionTime}-second clock runs out. Quicker answers earn more points!`;

  const describeRound = (record: Pick<RoundRecord, "answers" | "outcome" | "pickedIds">) => {
    const names = joinNames(record.answers.map((answer) => formatName(answer.name)));
    const multi = record.answers.length > 1;
    const total = record.answers.length;
    switch (record.outcome) {
      case "correct":
        return multi ? `${total === 2 ? "Both" : `All ${NUMBER_WORDS[total] ?? total}`}! ${names}` : `It's ${names}!`;
      case "partial":
        // The hand-written "1/3" mark next to this already says how many were right.
        return `Partly! It was ${names}.`;
      case "wrong":
        return multi ? `Not quite! Those were ${names}.` : `Not quite! It's ${names}.`;
      default:
        return `Time's up! ${multi ? `It was ${names}.` : `It's ${names}.`}`;
    }
  };

  const recordDetail = (record: RoundRecord, options?: PokemonSprite[]) => {
    const hits = record.answers.filter((answer) => record.pickedIds.includes(answer.id)).length;
    switch (record.outcome) {
      case "correct":
        return "got it";
      case "partial":
        return `${hits} of ${record.answers.length}`;
      case "wrong": {
        if (record.answers.length > 1) return "missed them all";
        const picked = options?.find((option) => record.pickedIds.includes(option.id));
        return picked ? `you said ${formatName(picked.name)}` : "missed";
      }
      default:
        return "time's up";
    }
  };

  const renderTimerGauge = () => (
    <div className="flex items-center gap-1.5">
      <SketchIcon name={isBlitz ? "bolt" : "clock"} className="h-5 w-5" strokeWidth={2.2} filled={isBlitz} />
      <div className="relative isolate h-[18px] w-20 sm:w-32">
        <SketchFrame
          radius={9}
          wobble={0.6}
          strokeWidth={2.2}
          fill="paper"
          seed={isUrgent ? 4000 + boilTick : undefined}
        />
        <div className="absolute inset-[5px] overflow-hidden rounded-full">
          <div
            className="hatch-fill h-full rounded-full"
            style={{
              width: `${timeProgress}%`,
              transition: timeLeft === questionTime ? "none" : "width 1s linear",
            }}
          />
        </div>
      </div>
      {/* In the last seconds the count flips to white-on-black while the gauge outline shakes. */}
      <span
        className={`relative isolate flex h-6 w-8 items-center justify-center text-base tabular-nums ${
          isUrgent ? "text-paper" : ""
        }`}
        aria-label={`${timeLeft} seconds left`}
      >
        {isUrgent && <SketchFrame radius={8} wobble={0.5} strokeWidth={2} fill="ink" seed={9000 + boilTick} />}
        {timeLeft}s
      </span>
    </div>
  );

  const renderStatusStrip = () => (
    <div className="px-2 pb-1 pt-1.5">
      <div className="flex items-center gap-x-3 gap-y-1 text-sm">
        <span className="whitespace-nowrap">
          <span className="text-ink-soft">RND </span>
          {roundLabel}
        </span>
        <span className="flex items-center gap-1 whitespace-nowrap">
          <SketchIcon name="star" className="h-4 w-4" strokeWidth={2.2} />
          <span className="tabular-nums">{score}</span>
          <span className="hidden text-ink-soft sm:inline">· total {activeTeamData.score}</span>
        </span>
        <div className="ml-auto">{renderTimerGauge()}</div>
      </div>
      <SketchLine className="mt-1.5 h-1.5 text-ink" />
    </div>
  );

  const renderSpriteStage = () => {
    if (!currentRound) return null;
    const revealed = status !== "idle";
    const stackSize = currentRound.answers.length;
    const layout = revealed ? REVEAL_LAYOUT[stackSize] : undefined;
    return (
      <div className="relative h-36 w-full sm:h-44">
        {!spritesReady && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-soft">
            Loading sprite{stackSize > 1 ? "s" : ""}...
          </div>
        )}
        {currentRound.answers.map((answer, index) => {
          // Stacked silhouettes sit on top of each other, then slide apart side by side on reveal.
          const offset = layout ? `${(index - (stackSize - 1) / 2) * layout.step}%` : "0%";
          const scale = layout ? layout.scale : 1;
          return (
            <div
              // Keyed by round too, so a Pokémon repeated in back-to-back rounds remounts and reports its load.
              key={`${currentRoundIndex}-${answer.id}`}
              className="absolute inset-0 transition-transform duration-500 ease-out"
              style={{
                transform: `translateX(${offset}) scale(${scale})`,
                // Stacked silhouettes stay hidden until every sprite has loaded, so none pops in before the others.
                visibility: spritesReady ? "visible" : "hidden",
              }}
            >
              <Image
                src={answer.spriteUrl}
                alt={revealed ? `Sprite of ${formatName(answer.name)}` : "Hidden Pokémon silhouette"}
                fill
                sizes="(max-width: 640px) 80vw, 420px"
                // Hidden silhouettes are flat black with no shadow: a shadow would paint over stacked sprites
                // and give away their outlines.
                className={`object-contain transition-[filter] duration-300 ${revealed ? "" : "brightness-0"}`}
                priority
                // A failed image still counts as settled so a broken sprite can't stall the round forever.
                onLoad={() => markSpriteLoaded(currentRoundIndex, answer.id)}
                onError={() => markSpriteLoaded(currentRoundIndex, answer.id)}
              />
            </div>
          );
        })}
      </div>
    );
  };

  const renderCurrentRound = () => {
    if (gameState !== "playing" || !currentRound) return null;
    const outcome = status === "idle" ? null : status;
    const delta = history.find((record) => record.round === currentRoundIndex)?.delta;
    return (
      <Message key={`round-${currentRoundIndex}`} tag={currentTag}>
        <span className="absolute -top-2.5 right-4 bg-chrome-soft px-1 text-xs text-ink-soft">
          #{currentRoundIndex + 1}
        </span>
        {renderSpriteStage()}
        <p
          aria-live="polite"
          className={`mt-1 min-h-[2.25rem] text-balance text-center font-hand font-bold leading-tight ${
            isMulti ? "text-xl sm:text-2xl" : "text-2xl sm:text-[1.7rem]"
          }`}
        >
          {outcome ? (
            <>
              <span className="mr-1.5 inline-flex h-7 items-center align-[-0.35em]">
                <OutcomeMark
                  outcome={outcome}
                  hits={roundHits}
                  total={currentRound.answers.length}
                  draw
                  className="h-7 w-7"
                />
              </span>
              {describeRound({ answers: currentRound.answers, outcome, pickedIds: selectedIds })}
              {delta !== undefined && (
                <span className="ml-2 whitespace-nowrap font-pixel text-base font-normal">{formatDelta(delta)}</span>
              )}
            </>
          ) : (
            <>{isMulti ? `Who are these ${answerCountWord}?` : "Who's that Pokémon?"}</>
          )}
        </p>
      </Message>
    );
  };

  const renderHistoryRow = (record: RoundRecord) => {
    const total = record.answers.length;
    const hits = record.answers.filter((answer) => record.pickedIds.includes(answer.id)).length;
    const options = record.options;
    return (
      <div key={`record-${record.round}`} className="message-in relative isolate flex items-center gap-2.5 py-2 pl-2.5 pr-3">
        <SketchFrame radius={12} wobble={0.9} strokeWidth={2.2} fill="ruled" />
        <NameTag label={record.tag.label} color={record.tag.color} />
        <div className="flex shrink-0">
          {record.answers.map((answer, index) => (
            <span key={answer.id} className={`relative h-9 w-9 ${index > 0 ? "-ml-4" : ""}`}>
              <Image src={answer.spriteUrl} alt="" fill sizes="40px" className="object-contain" />
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-hand text-xl font-bold leading-none">
            {joinNames(record.answers.map((answer) => formatName(answer.name)))}
          </p>
          <p className="mt-0.5 truncate text-[11px] leading-none text-ink-soft">
            #{record.round + 1} · {recordDetail(record, options)}
          </p>
        </div>
        <OutcomeMark outcome={record.outcome} hits={hits} total={total} className="h-6 w-6" />
        <span className="w-9 text-right text-sm tabular-nums">{formatDelta(record.delta)}</span>
      </div>
    );
  };

  const renderFeed = () => {
    const pastRounds = history.filter((record) => !(gameState === "playing" && record.round === currentRoundIndex));
    return (
      <>
        {gameState === "loading" && !errorMessage && (
          <Notice icon={<SketchIcon name="pokeball" className="h-4 w-4" strokeWidth={2} />}>
            Connecting<span className="blink">…</span>
          </Notice>
        )}
        {isSetup && history.length === 0 && (
          <>
            <Notice>{room && !room.isHost ? "You're in! The host will start soon" : "Welcome! Set up a game below"}</Notice>
            <Message tag={HOST_TAG} className="flex items-start gap-3">
              <SketchIcon name="pokeball" className="mt-1 h-14 w-14 sm:h-16 sm:w-16" strokeWidth={2} draw />
              <div className="min-w-0">
                <p className="font-hand text-2xl font-bold leading-tight sm:text-[1.7rem]">
                  {room ? `Welcome to room ${room.code}!` : "Ready to test your Pokédex knowledge?"}
                </p>
                <p className="mt-1 font-hand text-lg leading-snug text-ink-soft sm:text-xl">
                  {room
                    ? `Share the invite link below. ${room.isHost ? "You're" : `${hostName} is`} hosting and starts the game once everyone's in.`
                    : instructions}
                </p>
              </div>
            </Message>
          </>
        )}
        {history.length > 0 && (
          <Notice>
            {MODE_CONFIG[mode].label} · {totalRounds} rounds · {questionTime}s
          </Notice>
        )}
        {pastRounds.map(renderHistoryRow)}
        {renderCurrentRound()}
        {gameState === "finished" && (
          <Message tag={currentTag} className="text-center">
            <p className="font-hand text-3xl font-bold leading-none">Game complete!</p>
            <p className="mt-2 flex items-center justify-center gap-2 text-lg">
              <SketchIcon name="star" className="h-5 w-5" strokeWidth={2.2} draw />
              Final score: {score}
            </p>
            <p className="mt-1 font-hand text-lg leading-snug text-ink-soft">
              {room && standings.length > 1 ? winnerLine() : `You finished ${totalRounds} rounds. Switch teams or play again!`}
            </p>
          </Message>
        )}
        {isPreparing && (
          <Notice icon={<SketchIcon name="pokeball" className="h-4 w-4" strokeWidth={2} />}>
            Catching Pokémon<span className="blink">…</span>
          </Notice>
        )}
        {errorMessage && (
          <Notice icon={<SketchIcon name="cross" className="h-4 w-4" strokeWidth={2.4} />}>
            <span className="text-ink">{errorMessage}</span>
          </Notice>
        )}
        {inRoom && !multiplayerAvailable && (
          <Notice icon={<SketchIcon name="cross" className="h-4 w-4" strokeWidth={2.4} />}>
            <span className="text-ink">Multiplayer isn&apos;t set up on this site yet.</span>
          </Notice>
        )}
        {inRoom && room && !roomGame.connected && (
          <Notice icon={<SketchIcon name="pokeball" className="h-4 w-4" strokeWidth={2} />}>
            Reconnecting<span className="blink">…</span>
          </Notice>
        )}
        {inRoom && roomGame.error && (
          <Notice icon={<SketchIcon name="cross" className="h-4 w-4" strokeWidth={2.4} />}>
            <span className="text-ink">{roomGame.error}</span>
          </Notice>
        )}
      </>
    );
  };

  const renderAnswers = () => {
    if (gameState !== "playing" || !currentRound) {
      return (
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          {Array.from({ length: modeConfig.optionCount }).map((_, index) => (
            <div key={`placeholder-${index}`} className="relative isolate flex min-h-[3.25rem] items-center px-3.5 text-ink-faint">
              <SketchFrame radius={12} wobble={0.9} strokeWidth={2.2} stroke="var(--ink-faint)" dotted />
              · · ·
            </div>
          ))}
        </div>
      );
    }
    const revealed = status !== "idle";
    return (
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
        {currentRound.options.map((option) => {
          const isAnswer = currentRound.answers.some((answer) => answer.id === option.id);
          const isSelected = selectedIds.includes(option.id);
          const isCorrect = revealed && isAnswer;
          const isWrongPick = revealed && isSelected && !isAnswer;
          const isFaded = revealed && !isAnswer && !isSelected;
          const inverted = isCorrect || (!revealed && isSelected);
          return (
            <button
              key={`${option.id}-${option.name}`}
              type="button"
              onClick={() => handleChoice(option)}
              disabled={revealed}
              aria-pressed={isMulti ? isSelected : undefined}
              className={`relative isolate flex min-h-[3.25rem] items-center gap-2 rounded-[14px] px-3.5 py-2 text-left text-base leading-tight transition-transform focus:outline-none focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink enabled:active:translate-y-px sm:text-lg ${
                inverted ? "text-paper" : isFaded ? "text-ink-faint" : "text-ink"
              } ${revealed ? "cursor-default" : ""}`}
            >
              <SketchFrame
                radius={12}
                wobble={0.9}
                strokeWidth={2.4}
                fill={inverted ? "ink" : "paper"}
                stroke={isFaded ? "var(--ink-faint)" : "var(--ink)"}
              />
              <span className="min-w-0 flex-1 break-words">
                <span className="relative">
                  {formatName(option.name)}
                  {isWrongPick && <SketchStrike className="text-ink" />}
                </span>
              </span>
              {isCorrect && <SketchIcon name="check" className="h-5 w-5" strokeWidth={2.8} draw />}
              {isWrongPick && <SketchIcon name="cross" className="h-5 w-5" strokeWidth={2.8} draw />}
            </button>
          );
        })}
      </div>
    );
  };

  const renderSendButton = () => {
    const ready = selectedIds.length === modeConfig.answerCount;
    return (
      <button
        type="button"
        onClick={handleSubmitPicks}
        disabled={!ready}
        className={`relative isolate mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] py-3 text-lg transition-transform focus:outline-none focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink enabled:active:translate-y-px disabled:cursor-not-allowed ${
          ready ? "text-paper" : "text-ink-soft"
        }`}
      >
        <SketchFrame
          radius={14}
          wobble={1}
          strokeWidth={2.6}
          fill={ready ? "ink" : "paper"}
          stroke={ready ? "var(--ink)" : "var(--ink-faint)"}
          dotted={!ready}
        />
        {ready ? (
          <>
            Send <SketchIcon name="send" className="h-6 w-6" strokeWidth={2.6} />
          </>
        ) : (
          `Pick ${modeConfig.answerCount - selectedIds.length} more`
        )}
      </button>
    );
  };

  const choiceButtonClass = (selected: boolean) =>
    `relative isolate rounded-[14px] transition-transform focus:outline-none focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink enabled:active:translate-y-px disabled:cursor-not-allowed ${
      selected ? "text-paper" : "text-ink"
    }`;

  const renderGameSetup = () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SectionLabel>Mode</SectionLabel>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(MODE_CONFIG) as GameMode[]).map((value) => {
            const selected = mode === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => selectMode(value)}
                disabled={isPreparing}
                aria-pressed={selected}
                className={`${choiceButtonClass(selected)} px-2 py-2.5 text-left min-[380px]:px-2.5 sm:px-3`}
              >
                <SketchFrame radius={12} wobble={0.9} strokeWidth={2.4} fill={selected ? "ink" : "paper"} />
                <span className="block text-sm leading-tight sm:text-base">{MODE_CONFIG[value].label}</span>
                {MODE_CONFIG[value].description.split(" · ").map((line, index) => (
                  <span
                    key={line}
                    className={`block whitespace-nowrap text-[10px] leading-snug min-[380px]:text-[11px] ${index === 0 ? "mt-1" : ""} ${selected ? "text-paper/75" : "text-ink-soft"}`}
                  >
                    {line}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[auto,1fr] sm:gap-6">
        <div className="flex flex-col gap-2">
          <SectionLabel>Rounds</SectionLabel>
          <div className="flex gap-2">
            {ROUND_OPTIONS.map((value) => {
              const selected = totalRounds === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTotalRounds(value)}
                  disabled={isPreparing}
                  aria-pressed={selected}
                  aria-label={`${value} rounds`}
                  className={`${choiceButtonClass(selected)} flex h-[3.75rem] min-w-[3.5rem] items-center justify-center px-3 text-lg sm:min-w-[3.75rem]`}
                >
                  <SketchFrame radius={12} wobble={0.8} strokeWidth={2.4} fill={selected ? "ink" : "paper"} />
                  {value}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <SectionLabel>Timer</SectionLabel>
          <div className="grid grid-cols-4 gap-2">
            {TIMER_OPTIONS.map(({ seconds, pokemon, icon }) => {
              const selected = questionTime === seconds;
              return (
                <button
                  key={seconds}
                  type="button"
                  onClick={() => selectQuestionTime(seconds)}
                  disabled={isPreparing}
                  aria-pressed={selected}
                  title={pokemon}
                  className={`${choiceButtonClass(selected)} flex h-[3.75rem] flex-col items-center justify-center px-1`}
                >
                  <SketchFrame radius={12} wobble={0.8} strokeWidth={2.4} fill={selected ? "ink" : "paper"} />
                  {/* Unpicked mascots stay as silhouettes; the picked one is revealed. */}
                  <Image
                    src={icon}
                    alt=""
                    width={30}
                    height={24}
                    unoptimized
                    className={`h-6 w-[30px] transition-[filter] ${selected ? "" : "brightness-0"}`}
                    style={{ imageRendering: "pixelated" }}
                  />
                  <span className="flex items-center text-sm leading-none">
                    {seconds}s
                    {isBlitzTime(seconds) && (
                      <SketchIcon name="bolt" className="ml-0.5 h-3 w-3" strokeWidth={2} filled />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <p aria-live="polite" className="flex items-center gap-1.5 text-xs text-ink-soft">
            {isBlitz && <SketchIcon name="bolt" className="h-3.5 w-3.5 text-ink" strokeWidth={2} filled />}
            {selectedTimer.pace} pace
            {isBlitz && <span className="font-hand text-base font-bold leading-none text-ink">think fast!</span>}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={prepareRounds}
        disabled={isPreparing}
        className={`relative isolate mt-1 flex w-full items-center justify-center gap-2 rounded-[16px] py-3.5 text-xl transition-transform focus:outline-none focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink enabled:active:translate-y-px disabled:cursor-wait ${
          isPreparing ? "text-ink-soft" : "text-paper"
        }`}
      >
        <SketchFrame
          radius={16}
          wobble={1.1}
          strokeWidth={2.8}
          fill={isPreparing ? "paper" : "ink"}
          stroke={isPreparing ? "var(--ink-faint)" : "var(--ink)"}
          dotted={isPreparing}
        />
        {isPreparing ? (
          <>
            Preparing questions<span className="blink">…</span>
          </>
        ) : (
          <>
            {gameState === "finished" ? "Play again" : "Start game"}
            <SketchIcon name="send" className="h-6 w-6" strokeWidth={2.6} />
          </>
        )}
      </button>
    </div>
  );

  // --- Multiplayer rooms ---

  const [nameDraft, setNameDraft] = useState("");
  const [copied, setCopied] = useState(false);
  // Built after mount: the server doesn't know the site's address, and both renders must match.
  const [roomUrl, setRoomUrl] = useState("");
  useEffect(() => {
    if (roomCode) setRoomUrl(`${window.location.origin}/room/${roomCode}`);
  }, [roomCode]);
  const hostName = room?.players.find((player) => player.id === room.hostId)?.name ?? "the host";
  const standings = useMemo(
    () => [...(room?.players ?? [])].sort((a, b) => b.score - a.score),
    [room?.players],
  );
  const waitingOn = room ? room.players.filter((player) => player.connected && !player.answered).length : 0;

  const winnerLine = () => {
    const top = standings[0];
    if (!room || !top) return "";
    const winners = standings.filter((player) => player.score === top.score);
    if (winners.length > 1) {
      const names = winners.map((player) => (player.id === room.you ? "you" : player.name));
      return `It's a tie between ${joinNames(names)} on ${top.score}!`;
    }
    return top.id === room.you ? "You won! 🏆" : `${top.name} won with ${top.score}!`;
  };

  const copyRoomLink = async () => {
    try {
      await navigator.clipboard.writeText(roomUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the link is on screen to copy by hand.
    }
  };

  const textInputClass =
    "relative w-full min-w-0 rounded-[12px] bg-transparent px-3.5 py-3 text-lg text-ink placeholder:text-ink-faint focus:outline-none";

  const renderPrimaryButton = (label: ReactNode, onClick: () => void, disabled = false) => (
    <button
      type="submit"
      onClick={onClick}
      disabled={disabled}
      className={`relative isolate flex w-full items-center justify-center gap-2 rounded-[16px] py-3.5 text-xl transition-transform focus:outline-none focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink enabled:active:translate-y-px disabled:cursor-not-allowed ${
        disabled ? "text-ink-soft" : "text-paper"
      }`}
    >
      <SketchFrame
        radius={16}
        wobble={1.1}
        strokeWidth={2.8}
        fill={disabled ? "paper" : "ink"}
        stroke={disabled ? "var(--ink-faint)" : "var(--ink)"}
        dotted={disabled}
      />
      {label}
    </button>
  );

  const renderJoinForm = () => {
    const name = nameDraft || roomGame.savedName;
    const cleaned = name.trim();
    return (
      <form className="flex flex-col gap-3" onSubmit={(event) => event.preventDefault()}>
        <label className="flex flex-col gap-2">
          <SectionLabel>Your name</SectionLabel>
          <span className="relative isolate block">
            <SketchFrame radius={12} wobble={0.9} strokeWidth={2.4} fill="paper" />
            <input
              value={name}
              onChange={(event) => setNameDraft(event.target.value)}
              maxLength={MAX_NAME_LENGTH}
              autoComplete="nickname"
              placeholder="Ash"
              className={textInputClass}
            />
          </span>
        </label>
        {renderPrimaryButton(
          <>
            Join room {roomCode} <SketchIcon name="send" className="h-6 w-6" strokeWidth={2.6} />
          </>,
          () => cleaned && roomGame.join(cleaned),
          !cleaned || !roomGame.connected,
        )}
      </form>
    );
  };

  const renderWaitingForHost = () => (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <SketchIcon name="pokeball" className="h-12 w-12" strokeWidth={2} draw />
      <p className="font-hand text-2xl font-bold leading-tight">
        {gameState === "finished" ? "Waiting for a rematch" : "Waiting for the game to start"}
        <span className="blink">…</span>
      </p>
      <p className="text-sm text-ink-soft">{hostName} is hosting and picks the mode, rounds and timer.</p>
    </div>
  );

  const renderLockedIn = () => (
    <p aria-live="polite" className="mt-3 text-center font-hand text-xl font-bold leading-tight">
      {room?.inGame
        ? `Locked in! Waiting for ${waitingOn} more…`
        : "You joined mid-game, so you're watching. You'll play in the next game!"}
    </p>
  );

  const renderPlayersPanel = () => (
    <SketchPanel className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel>Room {roomCode}</SectionLabel>
          <p className="font-hand text-xl font-bold leading-tight">
            {room && room.players.length > 0
              ? `${room.players.length} player${room.players.length === 1 ? "" : "s"}`
              : "No one has joined yet"}
          </p>
          <p className="mt-1 break-all text-xs text-ink-soft">{roomUrl}</p>
        </div>
        <button
          type="button"
          onClick={copyRoomLink}
          className={`${choiceButtonClass(false)} shrink-0 px-3 py-2 text-sm`}
        >
          <SketchFrame radius={10} wobble={0.8} strokeWidth={2.2} fill="paper" />
          {copied ? "Copied!" : "Copy invite link"}
        </button>
      </div>
      {standings.length > 0 && (
        <ol className="mt-4 flex flex-col gap-2">
          {standings.map((player, index) => {
            const isYou = player.id === room?.you;
            const result = player.lastResult;
            return (
              <li
                key={player.id}
                className={`relative isolate flex items-center gap-3 px-3 py-2 ${player.connected ? "" : "text-ink-faint"}`}
              >
                <SketchFrame radius={12} wobble={0.8} strokeWidth={isYou ? 2.6 : 2} fill="paper" traced={isYou} />
                <span className="w-5 text-center text-sm tabular-nums text-ink-soft">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-base">
                  {player.name}
                  {isYou && <span className="text-ink-soft"> (you)</span>}
                  {player.id === room?.hostId && <span className="ml-1 text-xs text-ink-soft">host</span>}
                  {!player.connected && <span className="ml-1 text-xs">away</span>}
                </span>
                {view?.phase === "playing" && player.answered && (
                  <span className="text-xs text-ink-soft">answered</span>
                )}
                {result && (
                  <OutcomeMark
                    outcome={result.outcome}
                    hits={view ? view.round.answers.filter((answer) => result.pickedIds.includes(answer.id)).length : 0}
                    total={view?.round.answers.length ?? 1}
                    className="h-5 w-5"
                  />
                )}
                <span className="flex items-center gap-1 tabular-nums">
                  <SketchIcon name="star" className="h-4 w-4" strokeWidth={2.2} />
                  {player.score}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </SketchPanel>
  );

  const bottomPrompt = () => {
    if (gameState === "loading") return "Loading…";
    if (room && !room.joined) return "Pick a name";
    if (room && isSetup && !room.isHost) return `Room ${room.code}`;
    if (isSetup) return "Set up a game";
    if (view?.locked && status === "idle") return room?.inGame ? "Locked in" : "Watching";
    if (status !== "idle") return "Next round…";
    if (isMulti) return `Pick ${answerCountWord} · ${selectedIds.length}/${modeConfig.answerCount}`;
    return "Tap the right name";
  };

  const renderHinge = () => (
    <div aria-hidden="true" className="flex h-7 items-center justify-between px-8 sm:px-12">
      {[0, 1].map((index) => (
        <span key={index} className="relative isolate h-3.5 w-14 sm:w-20">
          <SketchFrame radius={7} wobble={0.5} strokeWidth={2.2} fill="chrome" />
        </span>
      ))}
    </div>
  );

  return (
    <main className="min-h-screen px-4 pb-12 pt-8 text-ink sm:pt-10">
      <div className="mx-auto flex w-full max-w-[600px] flex-col gap-6">
        <header className="relative flex flex-col items-center text-center">
          <Link
            href="/"
            aria-label="Back to start"
            className="relative isolate -mb-2 self-start rounded-[10px] px-3 py-1.5 text-sm text-ink transition-transform focus:outline-none focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink active:translate-y-px"
          >
            <SketchFrame radius={10} wobble={0.8} strokeWidth={2.2} fill="paper" />
            ← {inRoom ? "Leave room" : "Back"}
          </Link>
          <h1 className="font-hand text-5xl font-bold leading-none sm:text-6xl">Who&apos;s that Pokémon?</h1>
          <SketchUnderline className="mt-1 h-3 w-56 text-ink sm:w-72" />
        </header>

        <div>
          {/* Top screen: the chat log. */}
          <SketchPanel fill="chrome" className="flex h-[23rem] flex-col p-2.5 sm:h-[26rem]">
            {renderStatusStrip()}
            <div ref={feedRef} className="feed-scroll min-h-0 flex-1 overflow-y-auto rounded-[12px] px-2 pb-3 pt-1 sm:px-3">
              <div className="flex min-h-full flex-col justify-end gap-2.5">{renderFeed()}</div>
            </div>
          </SketchPanel>

          {renderHinge()}

          {/* Bottom screen: where you answer. */}
          <SketchPanel fill="ruled" className="p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <NameTag label={currentTag.label} color={currentTag.color} size="md" />
              <p className="text-right text-sm text-ink-soft">{bottomPrompt()}</p>
            </div>
            {gameState === "loading" ? (
              renderAnswers()
            ) : room && !room.joined ? (
              renderJoinForm()
            ) : isSetup ? (
              room && !room.isHost ? renderWaitingForHost() : renderGameSetup()
            ) : (
              <>
                {renderAnswers()}
                {gameState === "playing" && status === "idle" && view?.locked
                  ? renderLockedIn()
                  : isMulti && gameState === "playing" && status === "idle" && renderSendButton()}
              </>
            )}
          </SketchPanel>
        </div>

        {inRoom ? (
          renderPlayersPanel()
        ) : (
          <>
            <SketchPanel className="p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <SectionLabel>Team play</SectionLabel>
                  <p className="font-hand text-xl font-bold leading-tight">Pass the device between teams and track points</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTeams((prev) => !prev)}
                  aria-expanded={showTeams}
                  className={`${choiceButtonClass(false)} shrink-0 px-3 py-2 text-sm`}
                >
                  <SketchFrame radius={10} wobble={0.8} strokeWidth={2.2} fill="paper" />
                  {showTeams ? "Hide teams" : "Show teams"}
                </button>
              </div>

              {showTeams && (
                <div className="mt-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {teams.map((team) => {
                      const active = activeTeam === team.name;
                      return (
                        <button
                          key={team.name}
                          type="button"
                          onClick={() => setActiveTeam(team.name)}
                          aria-pressed={active}
                          className={`${choiceButtonClass(false)} flex flex-col items-start gap-1.5 px-3 pb-2.5 pt-3 text-left`}
                        >
                          <SketchFrame radius={14} wobble={1} strokeWidth={active ? 2.8 : 2.2} fill="paper" traced={active} />
                          <NameTag label={team.name} color={team.color} />
                          <span className="text-sm leading-tight">Score {team.score}</span>
                          <span className="text-xs leading-tight text-ink-soft">Rounds {team.rounds}</span>
                          {active && <span className="font-hand text-base font-bold leading-none">playing now!</span>}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-xs text-ink-soft">
                    Current team: <span className="text-ink">{activeTeam}</span>. Scores update automatically after each round.
                  </p>
                </div>
              )}
            </SketchPanel>
          </>
        )}

        <p className="text-center text-xs text-ink-soft">Sprite data fetched live from the PokéAPI sprites collection.</p>
      </div>
    </main>
  );
}
