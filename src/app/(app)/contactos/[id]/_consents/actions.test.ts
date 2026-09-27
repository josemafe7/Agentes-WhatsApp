// «Levantar baja» through its Server Action ([CTO-08]): Propietario, Administrador and Supervisor («Contactos:
// fusionar duplicados y quitar una baja»); an Agent or Solo lectura is refused before the opt-out engine is reached
// ([PER-01], [SEG-04]). The engine itself (src/data/consents.ts) has its own tests.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { actorFor } from "@/test/factories";

const state = vi.hoisted(() => ({ actor: null as Actor | null, lifted: [] as unknown[] }));

vi.mock("@/server/session", async () => {
  const { AuthError } = await import("@/server/errors");
  const { can } = await import("@/lib/permissions");
  const requireActor = async () => {
    if (!state.actor) throw new AuthError("unauthenticated");
    return state.actor;
  };
  return {
    requireActor,
    requirePermission: async (action: Parameters<typeof can>[1]) => {
      const actor = await requireActor();
      if (!can(actor, action)) throw new AuthError("forbidden");
      return actor;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/data/consents", () => ({
  liftOptOut: async (_actor: Actor, input: unknown) => {
    state.lifted.push(input);
    return { consentId: "consent-id" };
  },
}));

import { liftOptOutAction } from "./actions";

const INPUT = { contactId: "5d0c1e7a-3333-4c9d-8e21-9a8b7c6d5e4f", channelId: "0b6f2c3e-1111-4c1c-9a55-6a4f0f0b3a2d", note: "Lo ha pedido por teléfono" };

beforeEach(() => {
  state.lifted = [];
});

describe("Levantar baja [CTO-08]", () => {
  it.each<Role>(["owner", "admin", "supervisor"])("%s lifts it: what the customer asked goes to the opt-out engine", async (role) => {
    state.actor = actorFor(role);
    expect(await liftOptOutAction(INPUT)).toEqual({ ok: true, message: "Baja levantada." });
    expect(state.lifted).toEqual([INPUT]);
  });

  it.each<Role>(["agent", "viewer"])("%s may not, and the engine is never reached [PER-01] [SEG-04]", async (role) => {
    state.actor = actorFor(role);
    expect(await liftOptOutAction(INPUT)).toEqual({ ok: false, error: "No tienes permiso para hacer esto." });
    expect(state.lifted).toEqual([]);
  });

  it("without a session it asks to sign in again", async () => {
    state.actor = null;
    expect(await liftOptOutAction(INPUT)).toEqual({ ok: false, error: "Tu sesión ha caducado. Vuelve a entrar." });
    expect(state.lifted).toEqual([]);
  });
});
