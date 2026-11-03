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

type RoundData = {
  options: PokemonSprite[];
  answers: PokemonSprite[];
};

type GameMode = "normal" | "hard";

type RoundStatus = "idle" | "correct" | "partial" | "wrong" | "timeout";

const MODE_CONFIG: Record<
  GameMode,
  { label: string; description: string; optionCount: number; answerCount: number; questionTime: number; revealDelay: number }
> = {
  normal: {
    label: "Normal",
    description: "One silhouette, pick 1 of 4",
    optionCount: 4,
    answerCount: 1,
    questionTime: 8,
    revealDelay: 900,
  },
  hard: {
    label: "Hard",
    description: "Two overlapping silhouettes, pick 2 of 6",
    optionCount: 6,
    answerCount: 2,
    questionTime: 12,
    revealDelay: 1800,
  },
};

const TEAM_PRESETS: TeamState[] = [
  { name: "Red", color: "#ef4444", score: 0, rounds: 0 },
  { name: "Blue", color: "#3b82f6", score: 0, rounds: 0 },
  { name: "Yellow", color: "#facc15", score: 0, rounds: 0 },
  { name: "Green", color: "#22c55e", score: 0, rounds: 0 },
];

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

const formatName = (name: string) =>
  name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export default function SpriteRushGame() {
  const [pokemonNames, setPokemonNames] = useState<string[]>([]);
  const [rounds, setRounds] = useState<RoundData[]>([]);
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0);
  const [totalRounds, setTotalRounds] = useState(5);
  const [mode, setMode] = useState<GameMode>("normal");
  const modeConfig = MODE_CONFIG[mode];
  const [timeLeft, setTimeLeft] = useState(MODE_CONFIG.normal.questionTime);
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

  const buildRound = useCallback(
    async (optionCount: number, answerCount: number): Promise<RoundData | null> => {
      if (!pokemonNames.length) return null;
      const candidates: PokemonSprite[] = [];
      const triedNames = new Set<string>();
      let attempts = 0;
      while (candidates.length < optionCount && attempts < 150) {
        // Fetch the missing options in parallel so 6-option rounds stay quick to prepare.
        const batch: string[] = [];
        const needed = optionCount - candidates.length;
        while (batch.length < needed && triedNames.size < pokemonNames.length) {
          const candidate = pokemonNames[Math.floor(Math.random() * pokemonNames.length)];
          if (!candidate || triedNames.has(candidate)) continue;
          triedNames.add(candidate);
          batch.push(candidate);
        }
        if (!batch.length) break;
        attempts += batch.length;
        const sprites = await Promise.all(batch.map((name) => fetchPokemonSprite(name)));
        for (const sprite of sprites) {
          if (sprite && candidates.length < optionCount && !candidates.some((c) => c.id === sprite.id)) {
            candidates.push(sprite);
          }
        }
      }
      if (candidates.length < optionCount) return null;
      const options = shuffle(candidates);
      const answers = shuffle(options).slice(0, answerCount);
      return { options, answers };
    },
    [pokemonNames, fetchPokemonSprite],
  );

  const prepareRounds = useCallback(async () => {
    if (!pokemonNames.length) return;
    setIsPreparing(true);
    setErrorMessage(null);
    const builtRounds: RoundData[] = [];
    while (builtRounds.length < totalRounds) {
      const round = await buildRound(modeConfig.optionCount, modeConfig.answerCount);
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
    setTimeLeft(modeConfig.questionTime);
    setStatus("idle");
    setSelectedIds([]);
    setGameState("playing");
    setIsPreparing(false);
  }, [buildRound, pokemonNames.length, totalRounds, modeConfig]);

  const advanceRound = useCallback(() => {
    setCurrentRoundIndex((prev) => {
      if (prev + 1 >= totalRounds) {
        setGameState("finished");
        return prev;
      }
      setTimeLeft(modeConfig.questionTime);
      setStatus("idle");
      setSelectedIds([]);
      return prev + 1;
    });
  }, [totalRounds, modeConfig]);

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
    setStatus("timeout");
    applyScore(-PENALTY_TIMEOUT);
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

  const finishRound = (outcome: Exclude<RoundStatus, "idle" | "timeout">, delta: number) => {
    applyScore(delta);
    setStatus(outcome);
    recordRoundPlayed();
    setTimeout(() => advanceRound(), modeConfig.revealDelay);
  };

  const speedPoints = () => Math.max(5, Math.round(timeLeft * SCORE_PER_SECOND));

  const handleChoice = (choice: PokemonSprite) => {
    if (!currentRound || status !== "idle") return;
    if (mode === "hard") {
      // Hard mode: tapping toggles a pick; a third tap replaces the oldest pick.
      setSelectedIds((prev) => {
        if (prev.includes(choice.id)) return prev.filter((id) => id !== choice.id);
        const next = [...prev, choice.id];
        return next.length > modeConfig.answerCount ? next.slice(next.length - modeConfig.answerCount) : next;
      });
      return;
    }
    if (choice.id === currentRound.answers[0].id) {
      finishRound("correct", speedPoints());
    } else {
      finishRound("wrong", -PENALTY_WRONG);
    }
  };

  const handleSubmitPicks = () => {
    if (!currentRound || status !== "idle" || selectedIds.length !== modeConfig.answerCount) return;
    const hits = currentRound.answers.filter((answer) => selectedIds.includes(answer.id)).length;
    if (hits === currentRound.answers.length) {
      finishRound("correct", speedPoints());
    } else if (hits > 0) {
      finishRound("partial", Math.round(speedPoints() / 2));
    } else {
      finishRound("wrong", -PENALTY_WRONG);
    }
  };

  const roundOptions = [5, 10, 25];
  const activeTeamData = teams.find((team) => team.name === activeTeam) ?? TEAM_PRESETS[0];
  const activeTeamColor = activeTeamData.color;
  const uiColor = showTeams ? activeTeamColor : "#38bdf8";
  const timeProgress = useMemo(() => (timeLeft / modeConfig.questionTime) * 100, [timeLeft, modeConfig]);
  const teamRoundDisplay = activeTeamData.rounds + (gameState === "playing" ? 1 : 0);
  const pendingRounds = activeTeamData.rounds + totalRounds;
  const answerNames = currentRound?.answers.map((answer) => formatName(answer.name)).join(" and ") ?? "";

  const renderGameSetup = () => (
    <>
      <div className="grid w-full max-w-xs grid-cols-2 gap-2">
        {(Object.keys(MODE_CONFIG) as GameMode[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setMode(value);
              setTimeLeft(MODE_CONFIG[value].questionTime);
            }}
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
      const isStacked = currentRound.answers.length > 1;
      return (
        <div className="relative h-64 w-full">
          {currentRound.answers.map((answer, index) => {
            // Stacked silhouettes sit on top of each other, then slide apart on reveal.
            const offset = isStacked && revealed ? (index === 0 ? "-26%" : "26%") : "0%";
            const scale = isStacked && revealed ? 0.68 : 1;
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
            {mode === "hard"
              ? `Two silhouettes are stacked on top of each other. Pick both Pokémon before the ${modeConfig.questionTime}-second clock runs out!`
              : `Study the sprite and choose the matching Pokémon before the ${modeConfig.questionTime}-second clock runs out. Quicker answers earn more points!`}
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
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
              {mode === "hard" ? `Pick two · ${selectedIds.length}/${modeConfig.answerCount} chosen` : "Choose wisely"}
            </p>
            <div className={`mt-4 grid gap-4 ${mode === "hard" ? "grid-cols-2 gap-3" : ""}`}>
              {gameState === "playing" && currentRound
                ? currentRound.options.map((option) => {
                    const revealed = status !== "idle";
                    const isAnswer = currentRound.answers.some((answer) => answer.id === option.id);
                    const isSelected = selectedIds.includes(option.id);
                    const isCorrect = revealed && isAnswer;
                    const isWrong =
                      mode === "hard" ? revealed && isSelected && !isAnswer : status === "wrong" && !isAnswer;
                    const isPicked = !revealed && isSelected;
                    return (
                      <button
                        key={`${option.id}-${option.name}`}
                        onClick={() => handleChoice(option)}
                        disabled={revealed}
                        aria-pressed={mode === "hard" ? isSelected : undefined}
                        className={`w-full break-words rounded-2xl border px-4 py-3 text-left font-semibold capitalize transition ${
                          mode === "hard" ? "text-base" : "text-lg"
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
                        mode === "hard" ? "text-base" : "text-lg"
                      }`}
                    >
                      Option {index + 1}
                    </div>
                  ))}
            </div>
            {mode === "hard" && gameState === "playing" && status === "idle" && (
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
                    {mode === "hard" ? "You got both! Speed bonus earned." : "Great job! You earned bonus points for speed."}
                  </p>
                )}
                {status === "partial" && (
                  <p className="text-amber-300">One out of two, half points! It was {answerNames}.</p>
                )}
                {status === "wrong" && (
                  <p className="text-rose-300">
                    {mode === "hard"
                      ? `Not quite! Those were ${answerNames}.`
                      : `Not quite! That sprite belonged to ${answerNames}.`}
                  </p>
                )}
                {status === "timeout" && (
                  <p className="text-amber-300">
                    Time&apos;s up! You lost a few points.{mode === "hard" ? ` It was ${answerNames}.` : ""}
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
