"use client";

import Image from "next/image";
import { useEffect, useId, useState, type FormEvent } from "react";
import { SectionLabel, choiceButtonClass } from "@/components/controls";
import { SketchFrame, SketchIcon } from "@/components/sketch";
import { PARTNER_CHOICE_COUNT, drawPartnerChoices, formatName, type PokemonSprite } from "@/lib/game";
import { randomMashupName } from "@/lib/mashup";
import { MAX_NAME_LENGTH, clampName, cleanName, nameLength } from "@/lib/protocol";

type JoinRoomFormProps = {
  roomCode: string;
  pokemonNames: string[];
  // The name being typed. The room page owns it so the name tag above the form can preview it.
  name: string;
  onNameChange: (name: string) => void;
  connected: boolean;
  onJoin: (name: string, partner: PokemonSprite) => void;
};

/**
 * Joining a room: write a name (up to 10 characters), or roll the die for two Pokémon mashed together,
 * and pick a partner from three random Pokémon.
 * The choices stay put if joining fails (say the room is full), so the player can just try again.
 */
export function JoinRoomForm({ roomCode, pokemonNames, name, onNameChange, connected, onJoin }: JoinRoomFormProps) {
  const inputId = useId();
  const counterId = useId();
  const partnerLabelId = useId();
  const [choices, setChoices] = useState<PokemonSprite[] | null>(null);
  const [drawFailed, setDrawFailed] = useState(false);
  const [drawAttempt, setDrawAttempt] = useState(0);
  const [partnerId, setPartnerId] = useState<number | null>(null);
  // Counts rolls so the die can tumble again on every one.
  const [rolls, setRolls] = useState(0);

  // Three fresh partners every time the form opens, and again on retry.
  useEffect(() => {
    if (!pokemonNames.length) return;
    let cancelled = false;
    drawPartnerChoices(pokemonNames).then((drawn) => {
      if (cancelled) return;
      if (drawn) setChoices(drawn);
      else setDrawFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [pokemonNames, drawAttempt]);

  const retryDraw = () => {
    setDrawFailed(false);
    setDrawAttempt((attempt) => attempt + 1);
  };

  const rollName = () => {
    const rolled = randomMashupName(pokemonNames);
    if (!rolled) return;
    setRolls((count) => count + 1);
    onNameChange(rolled.name);
  };

  const finalName = cleanName(name);
  const partner = choices?.find((choice) => choice.id === partnerId) ?? null;
  const length = nameLength(name);
  const missing = !finalName ? "Write your name" : !partner ? "Pick a partner" : null;
  const canJoin = !missing && connected;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canJoin && finalName && partner) onJoin(finalName, partner);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SectionLabel htmlFor={inputId}>Your name</SectionLabel>
        <div className="flex gap-2">
          <div className="relative isolate flex min-w-0 flex-1 items-center gap-2 rounded-[14px] pl-3.5 pr-3 focus-within:outline-dashed focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink">
            <SketchFrame radius={12} wobble={0.9} strokeWidth={2.4} fill="paper" />
            <input
              id={inputId}
              value={name}
              onChange={(event) => onNameChange(clampName(event.target.value))}
              placeholder="Ash"
              autoComplete="nickname"
              autoCapitalize="words"
              spellCheck={false}
              enterKeyHint="done"
              aria-describedby={counterId}
              className="h-12 min-w-0 flex-1 bg-transparent text-lg text-ink placeholder:text-ink-faint focus:outline-none"
            />
            <span
              id={counterId}
              className={`shrink-0 text-sm tabular-nums ${length >= MAX_NAME_LENGTH ? "text-ink" : "text-ink-soft"}`}
            >
              {length}/{MAX_NAME_LENGTH}
              <span className="sr-only"> characters</span>
            </span>
          </div>
          <button
            type="button"
            onClick={rollName}
            disabled={!pokemonNames.length}
            aria-label="Random name"
            title="Random name: two Pokémon mashed together"
            className={`${choiceButtonClass(false)} flex h-12 w-12 shrink-0 items-center justify-center disabled:text-ink-faint`}
          >
            <SketchFrame radius={12} wobble={0.9} strokeWidth={2.4} fill="paper" />
            <span key={rolls} className={`flex ${rolls ? "dice-roll" : ""}`}>
              <SketchIcon name="dice" className="h-6 w-6" strokeWidth={2.2} />
            </span>
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel id={partnerLabelId}>Partner</SectionLabel>
        <div role="group" aria-labelledby={partnerLabelId} className="grid grid-cols-3 gap-2">
          {choices
            ? choices.map((choice) => {
                const selected = choice.id === partnerId;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => setPartnerId(choice.id)}
                    aria-pressed={selected}
                    className={`${choiceButtonClass(false)} flex flex-col items-center gap-1 px-1.5 pb-2.5 pt-2`}
                  >
                    {/* A paper fill keeps dark Pokémon visible; the pick is traced twice and ticked instead. */}
                    <SketchFrame radius={12} wobble={0.9} strokeWidth={selected ? 2.8 : 2.2} fill="paper" traced={selected} />
                    {selected && (
                      <SketchIcon name="check" className="absolute right-2 top-2 h-5 w-5" strokeWidth={2.8} draw />
                    )}
                    <span className="relative h-16 w-full sm:h-20">
                      <Image src={choice.spriteUrl} alt="" fill sizes="96px" className="object-contain" />
                    </span>
                    <span className="w-full text-balance break-words text-center text-[11px] leading-tight min-[380px]:text-xs sm:text-sm">
                      {formatName(choice.name)}
                    </span>
                  </button>
                );
              })
            : Array.from({ length: PARTNER_CHOICE_COUNT }, (_, index) => (
                <div
                  key={`partner-placeholder-${index}`}
                  className="relative isolate flex h-[6.5rem] items-center justify-center text-ink-faint sm:h-[7.75rem]"
                >
                  <SketchFrame radius={12} wobble={0.9} strokeWidth={2.2} stroke="var(--ink-faint)" dotted />
                  {drawFailed ? "?" : "· · ·"}
                </div>
              ))}
        </div>
        <p aria-live="polite" className="flex min-h-[1.25rem] items-center gap-1.5 text-xs text-ink-soft">
          {drawFailed ? (
            <>
              Couldn&apos;t catch any Pokémon.
              <button
                type="button"
                onClick={retryDraw}
                className="text-ink underline decoration-dashed underline-offset-2 focus:outline-none focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-ink"
              >
                Try again
              </button>
            </>
          ) : choices ? (
            partner ? `${formatName(partner.name)} will play by your side` : "Three random Pokémon. Pick one!"
          ) : (
            <>
              Catching Pokémon<span className="blink">…</span>
            </>
          )}
        </p>
      </div>

      <button
        type="submit"
        disabled={!canJoin}
        className={`relative isolate flex w-full items-center justify-center gap-2 rounded-[16px] py-3.5 text-xl transition-transform focus:outline-none focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink enabled:active:translate-y-px disabled:cursor-not-allowed ${
          canJoin ? "text-paper" : "text-ink-soft"
        }`}
      >
        <SketchFrame
          radius={16}
          wobble={1.1}
          strokeWidth={2.8}
          fill={canJoin ? "ink" : "paper"}
          stroke={canJoin ? "var(--ink)" : "var(--ink-faint)"}
          dotted={!canJoin}
        />
        {missing ??
          (connected ? (
            <>
              Join room {roomCode} <SketchIcon name="send" className="h-6 w-6" strokeWidth={2.6} />
            </>
          ) : (
            <>
              Connecting<span className="blink">…</span>
            </>
          ))}
      </button>
    </form>
  );
}
