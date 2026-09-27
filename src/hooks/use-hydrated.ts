"use client";

import { useSyncExternalStore } from "react";

const noChanges = () => () => undefined;

/**
 * False in the server's HTML and until React takes over the page, true after. A button whose click only works once the
 * page is interactive (an onClick that calls a Server Action) stays disabled until then, so an early click is never lost.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noChanges,
    () => true,
    () => false,
  );
}
