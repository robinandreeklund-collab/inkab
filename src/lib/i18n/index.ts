"use client";

import { useCallback } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { translate } from "./translate";
import type { Locale } from "./locale";

export * from "./locale";
export { MESSAGES } from "./messages";
export { translate } from "./translate";

/** Texterna på kundens språk. */
export function useT() {
  const locale = useConfigStore((s) => s.locale);
  return useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );
}

export function useLocale(): Locale {
  return useConfigStore((s) => s.locale);
}
