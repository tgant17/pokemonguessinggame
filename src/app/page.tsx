"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MODE_CONFIG,
  ROUND_OPTIONS,
  buildRounds,
  formatName,
  joinNames,
  scorePicks,
  timeoutResult,
  type GameMode,
  type PokemonSprite,
  type RoundData,
  type RoundResult,
  type RoundStatus,
} from "@/lib/game";

type TeamState = {
  name: string;
  color: string;
  score: number;
  rounds: number;
};

// Each timer has a Pokémon mascot that matches its pace (icons live in public/timer-icons).
const TIMER_OPTIONS = [
  { seconds: 5, pace: "Blitz", pokemon: "Jolteon", icon: "/timer-icons/jolteon.png" },
  { seconds: 8, pace: "Standard", pokemon: "Pikachu", icon: "/timer-icons/pikachu.png" },
  { seconds: 10, pace: "Relaxed", pokemon: "Blastoise", icon: "/timer-icons/blastoise.png" },
  { seconds: 15, pace: "Easy", pokemon: "Slowpoke", icon: "/timer-icons/slowpoke.png" },
];
// Timers shorter than Normal's 8-second default get the "blitz" treatment so the harder choice stands out.
const BLITZ_COLOR = "#f97316";
const BLITZ_GRADIENT = "linear-gradient(135deg, #fbbf24, #f97316)";
const isBlitzTime = (seconds: number) => seconds < MODE_CONFIG.normal.defaultTime;

// How stacked silhouettes spread out on reveal: horizontal step (% of stage width) and shrink factor.
const REVEAL_LAYOUT: Record<number, { step: number; scale: number }> = {
  2: { step: 52, scale: 0.68 },
  3: { step: 34, scale: 0.42 },
};

const NUMBER_WORDS = ["zero", "one", "two", "three"];

const TEAM_PRESETS: TeamState[] = [
  { name: "Red", color: "#ef4444", score: 0, rounds: 0 },
  { name: "Blue", color: "#3b82f6", score: 0, rounds: 0 },
  { name: "Yellow", color: "#facc15", score: 0, rounds: 0 },
  { name: "Green", color: "#22c55e", score: 0, rounds: 0 },
];

const BoltIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3 w-3 shrink-0" fill="currentColor">
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
  </svg>
);

export default function SpriteRushGame() {
  const [pokemonNames, setPokemonNames] = useState<string[]>([]);
  const [rounds, setRounds] = useState<RoundData[]>([]);
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0);
  const [totalRounds, setTotalRounds] = useState(5);
  const [mode, setMode] = useState<GameMode>("normal");
  const modeConfig = MODE_CONFIG[mode];
  const isMulti = modeConfig.answerCount > 1;
  const [questionTime, setQuestionTime] = useState(MODE_CONFIG.normal.defaultTime);
  const [timeLeft, setTimeLeft] = useState(MODE_CONFIG.normal.defaultTime);
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState<RoundStatus>("idle");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [gameState, setGameState] = useState<"loading" | "ready" | "playing" | "finished">("loading");
  const [isPreparing, setIsPreparing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamState[]>(TEAM_PRESETS);
  const [activeTeam, setActiveTeam] = useState<string>(TEAM_PRESETS[0].name);
  const [showTeams, setShowTeams] = useState(false);

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

  const prepareRounds = useCallback(async () => {
    if (!pokemonNames.length) return;
    setIsPreparing(true);
    setErrorMessage(null);
    const builtRounds = await buildRounds(pokemonNames, mode, totalRounds);
    if (!builtRounds) {
      setErrorMessage("Unable to prefetch enough sprites. Please try again.");
      setIsPreparing(false);
      return;
    }
    setRounds(builtRounds);
    setCurrentRoundIndex(0);
    setScore(0);
    setTimeLeft(questionTime);
    setStatus("idle");
    setSelectedIds([]);
    setGameState("playing");
    setIsPreparing(false);
  }, [pokemonNames, mode, totalRounds, questionTime]);

  const advanceRound = useCallback(() => {
    setCurrentRoundIndex((prev) => {
      if (prev + 1 >= totalRounds) {
        setGameState("finished");
        return prev;
      }
      setTimeLeft(questionTime);
      setStatus("idle");
      setSelectedIds([]);
      return prev + 1;
    });
  }, [totalRounds, questionTime]);

  const applyScore = useCallback(
    (delta: number) => {
      setScore((prev) => prev + delta);
      setTeams((prevTeams) =>
        prevTeams.map((team) => (team.name === activeTeam ? { ...team, score: team.score + delta } : team)),
      );
    },
    [activeTeam],
  );

  const recordRoundPlayed = useCallback(() => {
    setTeams((prevTeams) =>
      prevTeams.map((team) =>
        team.name === activeTeam ? { ...team, rounds: team.rounds + 1 } : team,
      ),
    );
  }, [activeTeam]);

  const handleTimeout = useCallback(() => {
    if (status !== "idle") return;
    const { outcome, delta } = timeoutResult();
    setStatus(outcome);
    applyScore(delta);
    recordRoundPlayed();
    setTimeout(() => advanceRound(), modeConfig.revealDelay);
  }, [status, advanceRound, applyScore, recordRoundPlayed, modeConfig]);

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

  const finishRound = ({ outcome, delta }: RoundResult) => {
    applyScore(delta);
    setStatus(outcome);
    recordRoundPlayed();
    setTimeout(() => advanceRound(), modeConfig.revealDelay);
  };

  const handleChoice = (choice: PokemonSprite) => {
    if (!currentRound || status !== "idle") return;
    if (isMulti) {
      // Multi-pick modes: tapping toggles a pick; one tap past the limit replaces the oldest pick.
      setSelectedIds((prev) => {
        if (prev.includes(choice.id)) return prev.filter((id) => id !== choice.id);
        const next = [...prev, choice.id];
        return next.length > modeConfig.answerCount ? next.slice(next.length - modeConfig.answerCount) : next;
      });
      return;
    }
    finishRound(scorePicks(currentRound.answers, [choice.id], timeLeft));
  };

  const handleSubmitPicks = () => {
    if (!currentRound || status !== "idle" || selectedIds.length !== modeConfig.answerCount) return;
    finishRound(scorePicks(currentRound.answers, selectedIds, timeLeft));
  };

  const selectQuestionTime = (value: number) => {
    setQuestionTime(value);
    setTimeLeft(value);
  };

  const selectMode = (value: GameMode) => {
    setMode(value);
    selectQuestionTime(MODE_CONFIG[value].defaultTime);
  };

  const activeTeamData = teams.find((team) => team.name === activeTeam) ?? TEAM_PRESETS[0];
  const activeTeamColor = activeTeamData.color;
  const uiColor = showTeams ? activeTeamColor : "#38bdf8";
  const timeProgress = useMemo(() => (timeLeft / questionTime) * 100, [timeLeft, questionTime]);
  const isBlitz = isBlitzTime(questionTime);
  const timeAccent = isBlitz ? BLITZ_COLOR : uiColor;
  const selectedTimer = TIMER_OPTIONS.find((option) => option.seconds === questionTime) ?? TIMER_OPTIONS[1];
  const teamRoundDisplay = activeTeamData.rounds + (gameState === "playing" ? 1 : 0);
  const pendingRounds = activeTeamData.rounds + totalRounds;
  const answerNames = joinNames(currentRound?.answers.map((answer) => formatName(answer.name)) ?? []);
  const answerCountWord = NUMBER_WORDS[modeConfig.answerCount] ?? String(modeConfig.answerCount);
  const roundHits = currentRound ? currentRound.answers.filter((answer) => selectedIds.includes(answer.id)).length : 0;

  const renderRoundChips = () => (
    <div className="flex flex-wrap justify-center gap-2 text-xs text-slate-400">
      {ROUND_OPTIONS.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => setTotalRounds(value)}
          disabled={isPreparing}
          aria-pressed={totalRounds === value}
          className={`rounded-full border px-3 py-1 font-semibold disabled:cursor-not-allowed ${totalRounds === value ? "text-white" : "border-white/20 text-slate-400"}`}
          style={{ borderColor: totalRounds === value ? uiColor : undefined }}
        >
          {value} rounds
        </button>
      ))}
    </div>
  );

  const renderTimerTiles = () => (
    <div className="grid w-full max-w-[15rem] grid-cols-4 gap-1.5 text-xs">
      {TIMER_OPTIONS.map(({ seconds, pokemon, icon }) => {
        const isSelected = questionTime === seconds;
        const urgent = isBlitzTime(seconds);
        const stateClass = isSelected
          ? urgent
            ? "scale-105 border-transparent text-slate-950"
            : "text-white"
          : urgent
            ? "border-orange-400/40 text-orange-300"
            : "border-white/20 text-slate-400";
        const stateStyle = isSelected
          ? urgent
            ? { background: `${BLITZ_GRADIENT} border-box`, boxShadow: `0 0 18px ${BLITZ_COLOR}66` }
            : { borderColor: uiColor, backgroundColor: `${uiColor}1a` }
          : undefined;
        return (
          <button
            key={seconds}
            type="button"
            onClick={() => selectQuestionTime(seconds)}
            disabled={isPreparing}
            aria-pressed={isSelected}
            title={pokemon}
            className={`flex min-w-0 flex-col items-center gap-0.5 rounded-2xl border px-1 pb-1 pt-1.5 font-semibold transition disabled:cursor-not-allowed ${stateClass}`}
            style={stateStyle}
          >
            <Image
              src={icon}
              alt=""
              width={30}
              height={24}
              unoptimized
              className={`transition-opacity ${isSelected ? "" : "opacity-70"}`}
              style={{ imageRendering: "pixelated" }}
            />
            <span>{seconds}s</span>
          </button>
        );
      })}
    </div>
  );

  const renderGameSetup = () => (
    <>
      <div className="grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-3">
        {(Object.keys(MODE_CONFIG) as GameMode[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => selectMode(value)}
            aria-pressed={mode === value}
            className={`rounded-2xl border px-3 py-2 text-left transition ${
              mode === value ? "text-white" : "border-white/20 text-slate-400"
            }`}
            style={{
              borderColor: mode === value ? uiColor : undefined,
              backgroundColor: mode === value ? `${uiColor}22` : undefined,
            }}
          >
            <span className="block text-sm font-semibold">{MODE_CONFIG[value].label}</span>
            <span className="block text-[11px] leading-snug text-slate-400">{MODE_CONFIG[value].description}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-col items-center gap-2">
        <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Rounds</p>
        {renderRoundChips()}
      </div>
      <div className="flex w-full flex-col items-center gap-2">
        <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Timer</p>
        {renderTimerTiles()}
        <p
          aria-live="polite"
          className={`text-[11px] font-semibold ${isBlitz ? "" : "text-slate-500"}`}
          style={isBlitz ? { color: BLITZ_COLOR } : undefined}
        >
          {selectedTimer.pace} pace{isBlitz && ": think fast!"}
        </p>
      </div>
    </>
  );

  const renderSpriteStage = () => {
    if (gameState === "loading") {
      return <div className="text-slate-400">Loading Pokémon data...</div>;
    }
    if (gameState === "ready") {
      return (
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-center">
          <p className="text-sm text-slate-300">Ready to test your Pokédex knowledge?</p>
          {renderGameSetup()}
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
      const revealed = status !== "idle";
      const stackSize = currentRound.answers.length;
      const layout = revealed ? REVEAL_LAYOUT[stackSize] : undefined;
      return (
        <div className="relative h-64 w-full">
          {currentRound.answers.map((answer, index) => {
            // Stacked silhouettes sit on top of each other, then slide apart side by side on reveal.
            const offset = layout ? `${(index - (stackSize - 1) / 2) * layout.step}%` : "0%";
            const scale = layout ? layout.scale : 1;
            return (
              <div
                key={answer.id}
                className="absolute inset-0 transition-transform duration-500 ease-out"
                style={{ transform: `translateX(${offset}) scale(${scale})` }}
              >
                <Image
                  src={answer.spriteUrl}
                  alt={`Sprite of ${answer.name}`}
                  fill
                  sizes="(max-width: 768px) 80vw, 40vw"
                  className={`object-contain drop-shadow-[0_8px_20px_rgba(16,185,129,0.35)] ${
                    revealed ? "" : "brightness-0 contrast-200"
                  }`}
                  priority
                />
              </div>
            );
          })}
        </div>
      );
    }
    if (gameState === "finished") {
      return (
        <div className="rounded-3xl border border-emerald-400/40 bg-slate-900/80 p-6 text-center shadow-emerald-500/10">
          <p className="text-sm uppercase tracking-[0.5em] text-emerald-300">Game complete</p>
          <h2 className="mt-2 text-3xl font-semibold text-white">Final score: {score}</h2>
          <p className="mt-3 text-slate-300">You conquered {totalRounds} rounds. Switch teams or play again!</p>
          <div className="mt-4 flex flex-col items-center gap-3">{renderGameSetup()}</div>
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
            {isMulti
              ? `${answerCountWord.charAt(0).toUpperCase() + answerCountWord.slice(1)} silhouettes are stacked on top of each other. Pick all ${answerCountWord} Pokémon before the ${questionTime}-second clock runs out!`
              : `Study the sprite and choose the matching Pokémon before the ${questionTime}-second clock runs out. Quicker answers earn more points!`}
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
            className="rounded-3xl border bg-slate-900/60 p-4 text-center shadow-lg transition-shadow"
            style={{
              borderColor: isBlitz ? `${BLITZ_COLOR}aa` : `${uiColor}55`,
              boxShadow: isBlitz ? `0 0 32px ${BLITZ_COLOR}40` : `0 10px 25px ${uiColor}22`,
            }}
          >
            <div className="flex items-center justify-center gap-2">
              <p className="text-xs text-slate-400">Time left</p>
              {isBlitz && (
                <span
                  className="inline-flex h-4 items-center gap-0.5 rounded-full px-1.5 text-[10px] font-bold leading-none text-slate-950"
                  style={{ background: BLITZ_GRADIENT }}
                >
                  <BoltIcon />
                  {selectedTimer.pace}
                </span>
              )}
            </div>
            <p className="mt-2 text-3xl font-bold" style={{ color: timeAccent }}>
              {timeLeft}s
            </p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${timeProgress}%`, background: isBlitz ? BLITZ_GRADIENT : uiColor }}
              />
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
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
              {isMulti ? `Pick ${answerCountWord} · ${selectedIds.length}/${modeConfig.answerCount} chosen` : "Choose wisely"}
            </p>
            <div className={`mt-4 grid gap-4 ${isMulti ? "grid-cols-2 gap-3" : ""}`}>
              {gameState === "playing" && currentRound
                ? currentRound.options.map((option) => {
                    const revealed = status !== "idle";
                    const isAnswer = currentRound.answers.some((answer) => answer.id === option.id);
                    const isSelected = selectedIds.includes(option.id);
                    const isCorrect = revealed && isAnswer;
                    const isWrong =
                      isMulti ? revealed && isSelected && !isAnswer : status === "wrong" && !isAnswer;
                    const isPicked = !revealed && isSelected;
                    return (
                      <button
                        key={`${option.id}-${option.name}`}
                        onClick={() => handleChoice(option)}
                        disabled={revealed}
                        aria-pressed={isMulti ? isSelected : undefined}
                        className={`w-full break-words rounded-2xl border px-4 py-3 text-left font-semibold capitalize transition ${
                          isMulti ? "text-base" : "text-lg"
                        } ${
                          isCorrect || isPicked
                            ? "text-white"
                            : isWrong
                              ? "border-rose-400 bg-rose-500/10 text-white"
                              : "bg-slate-900/60 text-slate-200"
                        } ${revealed ? "cursor-default" : ""}`}
                        style={{
                          borderColor: isCorrect || isPicked ? uiColor : isWrong ? "#f87171" : `${uiColor}33`,
                          backgroundColor: isCorrect || isPicked ? `${uiColor}22` : undefined,
                        }}
                      >
                        {formatName(option.name)}
                      </button>
                    );
                  })
                : Array.from({ length: modeConfig.optionCount }).map((_, index) => (
                    <div
                      key={`placeholder-${index}`}
                      className={`rounded-2xl border border-white/5 bg-slate-900/40 px-4 py-3 text-left text-slate-500 ${
                        isMulti ? "text-base" : "text-lg"
                      }`}
                    >
                      Option {index + 1}
                    </div>
                  ))}
            </div>
            {isMulti && gameState === "playing" && status === "idle" && (
              <button
                type="button"
                onClick={handleSubmitPicks}
                disabled={selectedIds.length !== modeConfig.answerCount}
                className="mt-4 w-full rounded-2xl px-6 py-3 text-sm font-semibold text-slate-950 transition disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                style={
                  selectedIds.length === modeConfig.answerCount
                    ? { backgroundColor: uiColor, boxShadow: `0 10px 25px ${uiColor}33` }
                    : undefined
                }
              >
                {selectedIds.length === modeConfig.answerCount
                  ? "Submit answer"
                  : `Pick ${modeConfig.answerCount - selectedIds.length} more`}
              </button>
            )}
            {status !== "idle" && (
              <div className="mt-6 rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-center text-sm">
                {status === "correct" && (
                  <p className="text-emerald-300">
                    {isMulti
                      ? `You got ${modeConfig.answerCount === 2 ? "both" : `all ${answerCountWord}`}! Speed bonus earned.`
                      : "Great job! You earned bonus points for speed."}
                  </p>
                )}
                {status === "partial" && (
                  <p className="text-amber-300">
                    {roundHits} out of {modeConfig.answerCount}, partial points! It was {answerNames}.
                  </p>
                )}
                {status === "wrong" && (
                  <p className="text-rose-300">
                    {isMulti
                      ? `Not quite! Those were ${answerNames}.`
                      : `Not quite! That sprite belonged to ${answerNames}.`}
                  </p>
                )}
                {status === "timeout" && (
                  <p className="text-amber-300">
                    Time&apos;s up! You lost a few points.{isMulti ? ` It was ${answerNames}.` : ""}
                  </p>
                )}
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
      </div>
    </main>
  );
}
