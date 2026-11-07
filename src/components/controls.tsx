import type { ReactNode } from "react";

// Small pieces shared by the solo setup panel and the multiplayer screens.

const SECTION_LABEL_CLASS = "text-xs uppercase tracking-[0.25em] text-ink-soft";

// A small caps heading over a group of controls. Pass htmlFor to label a form field, or id to name a group.
export function SectionLabel({ children, htmlFor, id }: { children: ReactNode; htmlFor?: string; id?: string }) {
  if (htmlFor) {
    return (
      <label htmlFor={htmlFor} id={id} className={SECTION_LABEL_CLASS}>
        {children}
      </label>
    );
  }
  return (
    <p id={id} className={SECTION_LABEL_CLASS}>
      {children}
    </p>
  );
}

// A button drawn over a SketchFrame; selected buttons are filled with ink, so their text turns paper-white.
export const choiceButtonClass = (selected: boolean) =>
  `relative isolate rounded-[14px] transition-transform focus:outline-none focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink enabled:active:translate-y-px disabled:cursor-not-allowed ${
    selected ? "text-paper" : "text-ink"
  }`;
