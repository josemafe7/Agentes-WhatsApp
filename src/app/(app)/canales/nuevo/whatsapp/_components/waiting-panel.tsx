"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

const SECOND_MS = 1_000;

/** Seconds since `startedAt`, updated every second while mounted. */
export function useElapsedSeconds(startedAt: number): number {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), SECOND_MS);
    return () => window.clearInterval(timer);
  }, []);
  return Math.max(0, Math.floor((now - startedAt) / SECOND_MS));
}

function minutesAndSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/** A live wait (DESIGN.md › Asistentes): spinner, «Esperando…» and the time elapsed; it updates by itself. */
export function WaitingPanel({ label, detail, elapsedSeconds }: { label: string; detail?: string; elapsedSeconds: number }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-xl border border-dashed p-4">
      <LoaderCircle aria-hidden className="mt-0.5 size-5 shrink-0 animate-spin text-info motion-reduce:animate-none" />
      <div className="grid gap-0.5 text-sm">
        <p className="font-medium">{label}</p>
        {detail ? <p className="text-muted-foreground">{detail}</p> : null}
        <p className="text-xs text-muted-foreground tabular-nums" aria-live="off">
          Tiempo esperando: {minutesAndSeconds(elapsedSeconds)}
        </p>
      </div>
    </div>
  );
}
