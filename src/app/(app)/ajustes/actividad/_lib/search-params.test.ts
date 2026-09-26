import { describe, expect, it } from "vitest";
import { activityHref, activityQueryFromSearchParams } from "./search-params";

describe("Registro de actividad: filters in the URL [AJU-10]", () => {
  it("maps the Spanish URL parameters to the data filter", () => {
    expect(
      activityQueryFromSearchParams({ quien: "ia", accion: "tool.used", desde: "2026-09-01", hasta: "2026-09-26", pagina: "3" }),
    ).toEqual({
      query: { quien: "ia", accion: "tool.used", desde: "2026-09-01", hasta: "2026-09-26" },
      filter: { actorType: "ai", action: "tool.used", from: "2026-09-01", to: "2026-09-26", page: 3 },
    });
    expect(activityQueryFromSearchParams({ quien: "persona" }).filter).toEqual({ actorType: "user", page: 1 });
    expect(activityQueryFromSearchParams({ quien: "sistema" }).filter).toEqual({ actorType: "system", page: 1 });
  });

  it("without parameters there is no filter", () => {
    expect(activityQueryFromSearchParams({})).toEqual({ query: {}, filter: { page: 1 } });
  });

  it("passes unknown or repeated values through so the data layer rejects them", () => {
    expect(activityQueryFromSearchParams({ quien: "robot" }).filter.actorType).toBe("robot");
    expect(activityQueryFromSearchParams({ quien: ["ia", "persona"] }).filter.actorType).toBe("ia,persona");
    expect(activityQueryFromSearchParams({ pagina: "dos" }).filter.page).toBeNaN();
  });

  it("builds page links that keep the filters", () => {
    expect(activityHref({ quien: "ia", desde: "2026-09-01" }, 2)).toBe("/ajustes/actividad?quien=ia&desde=2026-09-01&pagina=2");
    expect(activityHref({}, 1)).toBe("/ajustes/actividad");
  });
});
