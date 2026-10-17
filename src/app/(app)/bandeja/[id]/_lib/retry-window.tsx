"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ChannelType } from "@/lib/enums";

/** Why «Reintentar» is not offered while the 24 h window is closed: what the window notices over the composer say. */
const CLOSED_TEXTS: Partial<Record<ChannelType, string>> = {
  instagram: "No se puede reintentar: la ventana de 24 h está cerrada hasta que el cliente vuelva a escribir.",
};
const CLOSED_TEXT = "No se puede reintentar: la ventana de 24 h está cerrada y solo puedes enviar una plantilla.";

const RetryWindowContext = createContext<string | null>(null);

/** Null while «Reintentar» may send again; otherwise, why not. A WhatsApp template goes even then ([BAN-08]). */
export function useRetryClosedText(): string | null {
  return useContext(RetryWindowContext);
}

/**
 * The conversation's 24 h window for the failed messages of the timeline ([BAN-08], [BAN-18], [IG-04]): sending again
 * is sending now, so it follows the same rule as the composer. The window notices reload the page when it closes.
 */
export function RetryWindowProvider({ channelType, closed, children }: { channelType: ChannelType; closed: boolean; children: ReactNode }) {
  return <RetryWindowContext.Provider value={closed ? (CLOSED_TEXTS[channelType] ?? CLOSED_TEXT) : null}>{children}</RetryWindowContext.Provider>;
}
