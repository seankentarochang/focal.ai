"use client";

import { useEffect, useState } from "react";
import {
  createEmptyProfile,
  deserializeProfile,
  PROFILE_STORAGE_KEY,
  serializeProfile,
  type TasteProfile,
} from "@focal-ai/core";

const SSR_EMPTY_PROFILE: TasteProfile = Object.freeze({
  version: 1,
  updatedAt: "",
  seeds: [],
  rules: [],
});

export function loadProfile(): TasteProfile {
  if (typeof window === "undefined") return SSR_EMPTY_PROFILE;
  try {
    const stored = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!stored) return createEmptyProfile();
    return deserializeProfile(stored);
  } catch {
    return createEmptyProfile();
  }
}

export function saveProfile(p: TasteProfile): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, serializeProfile(p));
  } catch {
    return;
  }
}

export function clearProfile(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PROFILE_STORAGE_KEY);
  } catch {
    return;
  }
}

export function useProfile(): {
  profile: TasteProfile;
  setProfile: (p: TasteProfile) => void;
  reset: () => void;
} {
  const [profile, setProfileState] = useState<TasteProfile>(() =>
    typeof window === "undefined" ? SSR_EMPTY_PROFILE : createEmptyProfile(),
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration-safe load from localStorage
    setProfileState(loadProfile());
  }, []);

  const setProfile = (p: TasteProfile) => {
    setProfileState(p);
    saveProfile(p);
  };

  const reset = () => {
    clearProfile();
    setProfileState(createEmptyProfile());
  };

  return { profile, setProfile, reset };
}

export function exportProfileJson(p: TasteProfile): string {
  return serializeProfile(p);
}

export function importProfileJson(json: string): TasteProfile {
  return deserializeProfile(json);
}
