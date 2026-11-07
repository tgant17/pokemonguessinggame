import Image from "next/image";
import { SketchIcon } from "@/components/sketch";
import { pokemonIconUrl, type PokemonSprite, type RoundOutcome } from "@/lib/game";

// Small marks shared by the game screen and the end-of-game summary.

// A player's partner as a pixel sprite, like the option icons in Hard and Legendary. Front sprites have wide
// transparent margins, so callers pull them in with negative margins to keep the Pokémon a readable size.
export function PartnerIcon({ partner, className = "" }: { partner: PokemonSprite; className?: string }) {
  return (
    <Image
      src={pokemonIconUrl(partner.id)}
      alt=""
      width={44}
      height={44}
      unoptimized
      className={`h-11 w-11 shrink-0 ${className}`}
      style={{ imageRendering: "pixelated" }}
    />
  );
}

const OUTCOME_ICON: Record<RoundOutcome, "check" | "cross" | "clock" | null> = {
  correct: "check",
  partial: null,
  wrong: "cross",
  timeout: "clock",
};

// A check, cross or clock for a round's result; a partly right answer in the stacked modes shows "1/3" instead.
export function OutcomeMark({ outcome, hits, total, draw = false, className = "h-6 w-6" }: {
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
