// Writes the agenda part of a sector preset into the database ([ASI-04], [AGD-27]): words and mode of the agenda,
// resources with their weekly schedule, services and which resources do each one. The data is then the business's
// own and editable. Used by the demo seed; the setup wizard (step 2) can use it too.
import "server-only";
import { eq } from "drizzle-orm";
import { ensureSettingsRows } from "@/data/settings";
import type { Executor } from "@/db";
import { businessSettings, resources, resourceSchedules, serviceResources, services } from "@/db/schema";
import { newId } from "@/db/schema/columns";
import type { SectorPreset } from "@/lib/sectors";

/** Changes on top of the preset (the demo business names its people and sets example prices). */
export type SectorPresetOverlay = {
  resourceNames?: Readonly<Record<string, string>>;
  servicePrices?: Readonly<Record<string, number>>;
};

/** Database ids of what was inserted, by preset key. */
export type AppliedSectorPreset = { serviceIds: Map<string, string>; resourceIds: Map<string, string> };

/** Inserts only: the caller removes earlier services and resources first if it needs to. */
export async function applySectorPreset(
  executor: Executor,
  preset: SectorPreset,
  overlay: SectorPresetOverlay = {},
): Promise<AppliedSectorPreset> {
  await ensureSettingsRows(executor);
  await executor
    .update(businessSettings)
    .set({
      sector: preset.slug,
      terminology: preset.terminology,
      agendaMode: preset.agendaMode,
      slotIntervalMin: preset.slotIntervalMin,
    })
    .where(eq(businessSettings.singleton, 1));

  const resourceIds = new Map(preset.resources.map((r) => [r.key, newId()]));
  const serviceIds = new Map(preset.services.map((s) => [s.key, newId()]));
  const idOf = (ids: Map<string, string>, key: string): string => {
    const found = ids.get(key);
    if (!found) throw new Error(`El sector ${preset.slug} usa una clave que no existe: ${key}`);
    return found;
  };

  await executor.insert(resources).values(
    preset.resources.map((r, index) => ({
      id: idOf(resourceIds, r.key),
      type: r.type,
      name: overlay.resourceNames?.[r.key] ?? r.name,
      color: r.color,
      capacity: r.capacity,
      sortOrder: index,
    })),
  );
  await executor.insert(resourceSchedules).values(
    preset.resources.flatMap((r) =>
      r.schedule.map((range) => ({ resourceId: idOf(resourceIds, r.key), ...range })),
    ),
  );
  await executor.insert(services).values(
    preset.services.map((s, index) => ({
      id: idOf(serviceIds, s.key),
      name: s.name,
      category: s.category,
      durationMin: s.durationMin,
      bufferBeforeMin: s.bufferBeforeMin,
      bufferAfterMin: s.bufferAfterMin,
      price: s.price ?? overlay.servicePrices?.[s.key] ?? null,
      descriptionForAgent: s.descriptionForAgent,
      minPeople: s.minPeople,
      maxPeople: s.maxPeople,
      minAdvanceMin: s.minAdvanceMin,
      maxAdvanceDays: s.maxAdvanceDays,
      requiresManualConfirmation: s.requiresManualConfirmation,
      sortOrder: index,
    })),
  );
  await executor.insert(serviceResources).values(
    preset.services.flatMap((s) =>
      s.resourceKeys.map((key) => ({ serviceId: idOf(serviceIds, s.key), resourceId: idOf(resourceIds, key) })),
    ),
  );
  return { serviceIds, resourceIds };
}
