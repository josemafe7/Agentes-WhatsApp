"use client";

import type { ReactNode } from "react";
import { useHydrated } from "@/hooks/use-hydrated";

/**
 * Until React takes over the page, a click on a button does nothing and what is typed in a field can be overwritten
 * (their code is not running yet): every control of the panel waits disabled for that moment, usually well under a
 * second on the first load; later navigations inside the app keep it enabled. A `<fieldset disabled>` does it for every
 * control at once; `display: contents` and no role leave the layout and the accessibility tree as they were, and the
 * controls keep their look meanwhile (src/app/globals.css).
 */
export function HydrationGate({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  return (
    <fieldset role="presentation" disabled={!hydrated} data-hydrating={hydrated ? undefined : ""} className="contents">
      {children}
    </fieldset>
  );
}
