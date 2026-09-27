"use client";

import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;

/**
 * The current time, moving every minute: relative times («hace 5 min»), pauses and the WhatsApp window stay right
 * while the screen is open. Starts from the time the server rendered, so the first paint matches it.
 */
export function useNow(initial: Date, intervalMs = MINUTE_MS): Date {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
