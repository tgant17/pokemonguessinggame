"use client";

import { useCallback, useEffect, useState } from "react";

// Whether answer options show a small Pokémon icon beside their name. Off by default; it's a personal
// display preference, so it's remembered in this browser and never sent to a room.
const OPTION_ICONS_KEY = "pgg-option-icons";

export function useOptionIcons() {
  const [showIcons, setShowIcons] = useState(false);

  // Read after mount so the server render (always off) matches the first client render.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(OPTION_ICONS_KEY) === "on") setShowIcons(true);
    } catch {
      // Storage unavailable: stay on the default.
    }
  }, []);

  const setOptionIcons = useCallback((value: boolean) => {
    setShowIcons(value);
    try {
      window.localStorage.setItem(OPTION_ICONS_KEY, value ? "on" : "off");
    } catch {
      // Not fatal: the choice just isn't remembered next visit.
    }
  }, []);

  return [showIcons, setOptionIcons] as const;
}
