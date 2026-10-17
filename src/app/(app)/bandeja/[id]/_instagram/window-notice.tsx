"use client";

import { Clock, TimerOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useNow } from "../../_components/use-now";
import { describeInstagramWindow } from "./presentation";

/** A moment after closing, so the server also sees it closed. */
const REFRESH_AFTER_CLOSE_MS = 1_000;

type InstagramWindowNoticeProps = { window: { open: boolean; closesAt: Date | null }; timezone: string; initialNow: Date };

/**
 * Instagram's 24 h window over the composer ([BAN-18], [IG-04]): «Puedes responder hasta … · quedan …» or, closed, why
 * nothing can be sent until the customer writes again. When it closes with the conversation on screen, the page
 * reloads and the reply gives way to internal notes.
 */
export function InstagramWindowNotice({ window: serviceWindow, timezone, initialNow }: InstagramWindowNoticeProps) {
  const router = useRouter();
  const now = useNow(initialNow);
  const view = describeInstagramWindow(serviceWindow, now, timezone);
  const closesAt = view.state === "open" ? view.closesAt.getTime() : null;

  useEffect(() => {
    if (closesAt === null) return;
    const timer = window.setTimeout(() => router.refresh(), Math.max(0, closesAt - Date.now()) + REFRESH_AFTER_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [closesAt, router]);

  if (view.state === "open") {
    return (
      <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-info-soft px-2 py-0.5 text-xs font-medium text-info">
        <Clock aria-hidden className="size-3.5" />
        {view.text}
      </p>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
      <TimerOff aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <p className="flex flex-col gap-0.5">
        <span>{view.text}</span>
        {view.detail ? <span className="text-xs text-muted-foreground">{view.detail}</span> : null}
      </p>
    </div>
  );
}
