// Business settings of the demo: name, contact, colour, time zone, legal texts, AI notice and retention (the
// sector and its agenda words are written by the agenda step).
// The setup is marked finished, so the demo opens straight on the panel instead of the setup wizard.
import { eq } from "drizzle-orm";
import { ensureSettingsRows } from "@/data/settings";
import { businessSettings, DEFAULT_HANDOFF, DEFAULT_RETENTION } from "@/db/schema";
import { demoLegalTexts } from "../legal";
import type { SeedStep } from "../types";

export const businessStep: SeedStep = {
  name: "negocio",
  prepare: async (ctx) => async (tx) => {
    await ensureSettingsRows(tx);
    const { business } = ctx;
    await tx
      .update(businessSettings)
      .set({
        name: business.name,
        contactEmail: business.contactEmail,
        contactPhone: business.contactPhone,
        address: business.address,
        website: business.website,
        timezone: ctx.timeZone,
        color: business.color,
        ...demoLegalTexts(business),
        retention: DEFAULT_RETENTION,
        handoff: DEFAULT_HANDOFF,
        setupCompletedAt: ctx.now,
      })
      .where(eq(businessSettings.singleton, 1));
  },
};
