"use client";

import { useCallback, useEffect, useState } from "react";
import { EMPTY_PROFILE, cleanProfile, randomProfileColor, type Profile } from "@/lib/profile";

const PROFILE_KEY = "pgg-profile";

// The player's color and partner Pokémon, kept in localStorage so they carry over between visits and rooms.
// New players get a random color so everyone in a room starts out looking different.
export function useProfile() {
  // Starts empty so the server render and the first client render match; the saved profile loads after mount.
  const [profile, setProfileState] = useState<Profile>(EMPTY_PROFILE);
  useEffect(() => {
    let saved: Profile = EMPTY_PROFILE;
    try {
      const raw = window.localStorage.getItem(PROFILE_KEY);
      if (raw) saved = cleanProfile(JSON.parse(raw));
    } catch {
      // Unreadable or blocked storage: start fresh.
    }
    const next = saved.color ? saved : { ...saved, color: randomProfileColor() };
    setProfileState(next);
    save(next);
  }, []);

  const setProfile = useCallback((update: Partial<Profile>) => {
    setProfileState((prev) => {
      const next = { ...prev, ...update };
      save(next);
      return next;
    });
  }, []);

  return { profile, setProfile };
}

function save(profile: Profile) {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Not fatal: the profile just won't be remembered next visit.
  }
}
