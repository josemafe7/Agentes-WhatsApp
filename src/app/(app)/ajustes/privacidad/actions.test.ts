// Server Action of Ajustes › Privacidad y legal called directly ([SEG-04], [AJU-07], [CUM-05]).
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as null | { session: { id: string }; user: { id: string } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));

import { db } from "@/db";
import { businessSettings } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { createBusiness, createUser } from "@/test/factories";
import { saveLegalSettingsAction } from "./actions";

const signInAs = async (role: Role) => {
  const person = await createUser(role);
  state.session = { session: { id: `s-${person.userId}` }, user: { id: person.userId } };
};

function legalForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const values = {
    privacyText: "Mi política.",
    termsText: "",
    dataDeletionText: "",
    aiDisclosureText: "Te atiende una IA.",
    retentionConversationsMonths: "6",
    retentionAudioDays: "30",
    retentionAttachmentsDays: "90",
    retentionWebhookDays: "14",
    retentionMode: "delete",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

const settings = async () => (await db.select().from(businessSettings))[0];

beforeEach(async () => {
  state.session = null;
  await createBusiness({ privacyText: null, aiDisclosureText: null });
});

describe("saveLegalSettingsAction", () => {
  it("saves texts and periods sent as form text", async () => {
    await signInAs("owner");
    expect(await saveLegalSettingsAction(undefined, legalForm())).toEqual({ ok: true, message: "Cambios guardados." });
    const row = await settings();
    expect(row.privacyText).toBe("Mi política.");
    expect(row.termsText).toBeNull();
    expect(row.retention.conversationsMonths).toBe(6);
  });

  it("explains a wrong period next to its field", async () => {
    await signInAs("admin");
    const result = await saveLegalSettingsAction(undefined, legalForm({ retentionWebhookDays: "60", retentionAudioDays: "muchos" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors?.retentionWebhookDays).toEqual(["Entre 7 y 30 días."]);
      expect(result.fieldErrors?.retentionAudioDays?.[0]).toBe("Escribe un número entero de días.");
    }
    expect((await settings()).privacyText).toBeNull();
  });

  it.each<Role>(["supervisor", "agent", "viewer"])("%s cannot change it [PER-03] [PER-04]", async (role) => {
    await signInAs(role);
    expect(await saveLegalSettingsAction(undefined, legalForm())).toEqual({ ok: false, error: "No tienes permiso para hacer esto." });
    expect((await settings()).privacyText).toBeNull();
  });
});
