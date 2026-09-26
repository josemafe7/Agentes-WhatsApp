import type { SetupStatus } from "@/data/setup";
import { AuthError } from "@/server/errors";
import type { SessionActor } from "@/server/session";

/** What every step component receives from /setup. */
export type SetupStepProps = {
  /** Null only on step 1 (no users yet); the page has already checked that it is the owner otherwise. */
  actor: SessionActor | null;
  status: SetupStatus;
};

/** The signed-in actor of steps 2–7 (the data layer checks the owner role again). */
export function stepActor(actor: SessionActor | null): SessionActor {
  if (!actor) throw new AuthError("unauthenticated");
  return actor;
}
