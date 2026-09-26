// Where the hand-off implementation plugs in. Until the inbox phase registers one, a live hand-off fails with a
// clear «not configured» error (test mode never needs it: «Probar agente» only simulates the hand-off).
import "server-only";
import { AppError } from "@/server/errors";
import type { HandoffService } from "./types";

export type { HandoffRequest, HandoffResult, HandoffService } from "./types";

export class HandoffNotConfiguredError extends AppError {
  constructor() {
    super(503, "handoff_not_configured", "El traspaso a una persona todavía no está disponible en esta instalación.");
  }
}

// Survives dev hot reloads like the database client (one per process).
const globalRef = globalThis as unknown as { __dominiaHandoffService?: HandoffService };

/** Registers the implementation (the inbox phase does it once at import time). Registering again replaces it. */
export function registerHandoffService(service: HandoffService): void {
  globalRef.__dominiaHandoffService = service;
}

export function getHandoffService(): HandoffService {
  const service = globalRef.__dominiaHandoffService;
  if (!service) throw new HandoffNotConfiguredError();
  return service;
}

/** Tests only. */
export function unregisterHandoffService(): void {
  globalRef.__dominiaHandoffService = undefined;
}
