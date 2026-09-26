// Agenda of the sector preset (terminology, mode, resources, schedules, services) with the demo's names and prices.
import { applySectorPreset } from "@/server/demo/sector-preset";
import type { SeedStep } from "../types";

export const agendaStep: SeedStep = {
  name: "agenda",
  prepare: async (ctx) => async (tx) => {
    const { serviceIds, resourceIds } = await applySectorPreset(tx, ctx.preset, {
      resourceNames: ctx.business.resourceNames,
      servicePrices: ctx.business.servicePrices,
    });
    ctx.refs.serviceIds = serviceIds;
    ctx.refs.resourceIds = resourceIds;
  },
};
