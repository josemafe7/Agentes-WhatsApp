"use client";

// Near-real-time for the screens ([BAN-03], docs/decisions/0009): one poll per tab to /api/realtime shared by every
// screen that listens (inbox list, conversation, notifications bell). Every 4 s (3 s right after news) while the
// person is active and every 5 s while nobody touches the screen: while the tab is visible, news never takes more
// than 5 s. Longer and longer waits only while the connection fails (up to 30 s); nothing while the tab is hidden,
// and at once when it is shown again. Events carry ids only: each screen reloads what changed through its own
// server action, which checks permissions again.
import { useEffect, useRef, useSyncExternalStore } from "react";

export const REALTIME_URL = "/api/realtime";

/** Poll timing, in ms. */
export const POLL = {
  baseMs: 4_000,
  busyMs: 3_000,
  /** Without input for this long, the wait goes up to idleMs. */
  idleAfterMs: 60_000,
  /** Longest wait while the tab is visible and the connection works: [BAN-03] asks for news within 5 s. */
  idleMs: 5_000,
  /** Longest wait after failures. */
  maxMs: 30_000,
} as const;

/** connecting: first answer pending; offline: the last poll failed (retrying); stopped: no session any more. */
export type RealtimeStatus = "connecting" | "online" | "offline" | "stopped";

type ConversationEvent = { conversationId: string; channelId: string; cursor: string };
export type RealtimeEvent =
  | (ConversationEvent & { type: "conversation.updated"; change: string })
  | (ConversationEvent & { type: "message.created"; messageId: string; direction: "inbound" | "outbound"; senderType: string })
  | (ConversationEvent & { type: "message.status"; messageId: string; status: string })
  | { type: "notification.created"; notificationId: string; userId: string; cursor: string };

export type RealtimeListener = (events: RealtimeEvent[]) => void;

/** How long to wait before the next poll. */
export function nextPollDelay(input: { idleForMs: number; failures: number; hadEvents: boolean }): number {
  if (input.failures > 0) return Math.min(POLL.maxMs, POLL.baseMs * 2 ** input.failures);
  if (input.hadEvents) return POLL.busyMs;
  return input.idleForMs < POLL.idleAfterMs ? POLL.baseMs : POLL.idleMs;
}

const CURSOR = /^\d{1,15}$/;
const EVENT_TYPES = new Set(["conversation.updated", "message.created", "message.status", "notification.created"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The server's answer, or null when it is not what /api/realtime sends. */
function parseAnswer(body: unknown): { cursor: string; events: RealtimeEvent[] } | null {
  if (!isRecord(body) || typeof body.cursor !== "string" || !CURSOR.test(body.cursor) || !Array.isArray(body.events)) return null;
  const events = body.events.filter(
    (event): event is RealtimeEvent => isRecord(event) && typeof event.type === "string" && EVENT_TYPES.has(event.type) && typeof event.cursor === "string",
  );
  if (events.length !== body.events.length) return null;
  return { cursor: body.cursor, events };
}

export type RealtimeClientDeps = {
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  isVisible: () => boolean;
};

export type RealtimeClient = {
  subscribe: (listener: RealtimeListener) => () => void;
  getStatus: () => RealtimeStatus;
  onStatus: (listener: () => void) => () => void;
  /** Ask now (e.g. right after a change made from this tab). */
  pollNow: () => void;
  /** The person touched the screen: back to the normal pace. */
  markActive: () => void;
  setVisible: (visible: boolean) => void;
};

export function createRealtimeClient(deps: RealtimeClientDeps): RealtimeClient {
  const listeners = new Set<RealtimeListener>();
  const statusListeners = new Set<() => void>();
  let status: RealtimeStatus = "connecting";
  let cursor: string | null = null;
  let timer: unknown = null;
  let scheduledMs = 0;
  let inFlight = false;
  let again = false;
  let failures = 0;
  let lastActivityAt = deps.now();

  const running = () => listeners.size > 0 && status !== "stopped" && deps.isVisible();

  function setStatus(next: RealtimeStatus) {
    if (next === status) return;
    status = next;
    for (const listener of statusListeners) listener();
  }

  function cancelTimer() {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  }

  function schedule(hadEvents: boolean) {
    cancelTimer();
    if (!running()) return;
    scheduledMs = nextPollDelay({ idleForMs: deps.now() - lastActivityAt, failures, hadEvents });
    timer = deps.setTimer(() => {
      timer = null;
      void poll();
    }, scheduledMs);
  }

  function deliver(events: RealtimeEvent[]) {
    for (const listener of [...listeners]) {
      try {
        listener(events);
      } catch (error) {
        // One screen failing to reload must not stop the others from hearing the news.
        console.error("[realtime] Error en una pantalla al recibir novedades", error instanceof Error ? error.name : "");
      }
    }
  }

  async function poll(): Promise<void> {
    if (!running()) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    cancelTimer();
    let hadEvents = false;
    try {
      const response = await deps.fetchImpl(cursor ? `${REALTIME_URL}?cursor=${cursor}` : REALTIME_URL, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401 || response.status === 403) {
        setStatus("stopped");
        return;
      }
      const answer = response.ok ? parseAnswer(await response.json()) : null;
      if (!answer) throw new Error(`Respuesta no válida (${response.status})`);
      cursor = answer.cursor;
      failures = 0;
      setStatus("online");
      if (answer.events.length > 0) {
        hadEvents = true;
        deliver(answer.events);
      }
    } catch {
      failures += 1;
      setStatus("offline");
    } finally {
      inFlight = false;
    }
    if (again) {
      again = false;
      void poll();
      return;
    }
    schedule(hadEvents);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && timer === null && !inFlight) void poll();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) cancelTimer();
      };
    },
    getStatus: () => status,
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    pollNow() {
      void poll();
    },
    markActive() {
      lastActivityAt = deps.now();
      // Only when it was waiting longer than usual: normal polls keep their pace.
      if (running() && !inFlight && (timer === null || scheduledMs > POLL.baseMs)) void poll();
    },
    setVisible(visible) {
      if (!visible) {
        cancelTimer();
        return;
      }
      lastActivityAt = deps.now();
      if (running() && !inFlight) void poll();
    },
  };
}

// ─── The tab's single client ────────────────────────────────────────────────────────────────────────────

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
/** Activity is noted at most this often: enough to know the person is there. */
const ACTIVITY_THROTTLE_MS = 5_000;

let browserClient: RealtimeClient | null = null;

function getBrowserClient(): RealtimeClient {
  if (browserClient) return browserClient;
  const client = createRealtimeClient({
    fetchImpl: (input, init) => fetch(input, init),
    now: () => Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
    isVisible: () => document.visibilityState !== "hidden",
  });
  let lastNoted = 0;
  const noteActivity = () => {
    const now = Date.now();
    if (now - lastNoted < ACTIVITY_THROTTLE_MS) return;
    lastNoted = now;
    client.markActive();
  };
  for (const type of ACTIVITY_EVENTS) window.addEventListener(type, noteActivity, { passive: true });
  window.addEventListener("focus", noteActivity);
  document.addEventListener("visibilitychange", () => client.setVisible(document.visibilityState !== "hidden"));
  window.addEventListener("online", () => client.pollNow());
  browserClient = client;
  return client;
}

/** Listens to the news of the person's channels and notices while the component is mounted. */
export function useRealtime(onEvents: RealtimeListener, options: { enabled?: boolean } = {}): void {
  const enabled = options.enabled ?? true;
  const handler = useRef(onEvents);
  useEffect(() => {
    handler.current = onEvents;
  });
  useEffect(() => {
    if (!enabled) return;
    return getBrowserClient().subscribe((events) => handler.current(events));
  }, [enabled]);
}

const serverStatus = (): RealtimeStatus => "connecting";
const subscribeStatus = (listener: () => void) => getBrowserClient().onStatus(listener);
const statusSnapshot = () => getBrowserClient().getStatus();

/** Connection state, for «Sin conexión. Reintentando…». */
export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(subscribeStatus, statusSnapshot, serverStatus);
}

/** Ask for news now, e.g. after a change made from this tab, so the other screens catch up at once. */
export function requestRealtimePoll(): void {
  if (typeof window === "undefined") return;
  getBrowserClient().pollNow();
}
