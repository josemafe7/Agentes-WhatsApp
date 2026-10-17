import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/enums";
import { actorFor } from "@/test/factories";
import {
  ACCOUNT_HREF,
  groupSections,
  groupSettingsPages,
  hidesBottomNav,
  isActivePath,
  sectionForPath,
  SETTINGS_PAGES,
  settingsNavKeys,
  settingsPageForPath,
  splitMobileSections,
  trailForPath,
  visibleSections,
  visibleSettingsPages,
} from "./navigation";

const keys = (items: readonly { key: string }[]) => items.map((item) => item.key);

// docs/spec.md «Quién puede hacer qué» and docs/pantallas.md «Quién ve qué»: each role sees only its sections.
const EXPECTED_SECTIONS: Record<Role, string[]> = {
  owner: ["bandeja", "contactos", "agenda", "envios", "agentes", "conocimiento", "canales", "informes", "ajustes"],
  admin: ["bandeja", "contactos", "agenda", "envios", "agentes", "conocimiento", "canales", "informes", "ajustes"],
  supervisor: ["bandeja", "contactos", "agenda", "envios", "agentes", "conocimiento", "informes", "ajustes"],
  agent: ["bandeja", "contactos", "agenda", "ajustes"],
  viewer: ["bandeja", "contactos", "agenda", "envios", "agentes", "conocimiento", "canales", "informes", "ajustes"],
};

describe("visibleSections", () => {
  it.each(Object.entries(EXPECTED_SECTIONS) as [Role, string[]][])(
    "[PER-01] %s sees only the sections of their role, in menu order",
    (role, expected) => {
      expect(keys(visibleSections(actorFor(role)))).toEqual(expected);
    },
  );

  it("[PER-04] supervisor does not see Canales", () => {
    expect(keys(visibleSections(actorFor("supervisor")))).not.toContain("canales");
  });

  it("[PER-02] an agent limited to some channels still sees the inbox and contacts of those channels", () => {
    const sections = keys(visibleSections(actorFor("agent", { channelIds: ["canal-1"] })));
    expect(sections).toEqual(["bandeja", "contactos", "agenda", "ajustes"]);
  });

  it("[SEG-04] without an actor nothing is visible", () => {
    expect(visibleSections(null)).toEqual([]);
  });

  it("links every section to its Spanish route", () => {
    const hrefs = visibleSections(actorFor("owner")).map((section) => section.href);
    expect(hrefs).toEqual([
      "/bandeja",
      "/contactos",
      "/agenda",
      "/envios",
      "/agentes",
      "/conocimiento",
      "/canales",
      "/informes",
      "/ajustes",
    ]);
  });
});

describe("groupSections", () => {
  it("splits the menu in the three groups of DESIGN.md", () => {
    const groups = groupSections(visibleSections(actorFor("owner"))).map(keys);
    expect(groups).toEqual([
      ["bandeja", "contactos", "agenda", "envios"],
      ["agentes", "conocimiento", "canales"],
      ["informes", "ajustes"],
    ]);
  });

  it("drops groups the role has nothing in", () => {
    const groups = groupSections(visibleSections(actorFor("agent"))).map(keys);
    expect(groups).toEqual([["bandeja", "contactos", "agenda"], ["ajustes"]]);
  });
});

describe("visibleSettingsPages", () => {
  const ALL_SETTINGS = [
    "negocio",
    "usuarios",
    "horario",
    "ia",
    "correo",
    "whatsapp",
    "privacidad",
    "notificaciones",
    "recordatorios",
    "envios",
    "actividad",
    "diagnostico",
    "cuenta",
    "acerca",
  ];

  it.each(["owner", "admin"] as const)("[PER-01] %s sees every settings page", (role) => {
    expect(keys(visibleSettingsPages(actorFor(role)))).toEqual(ALL_SETTINGS);
  });

  it.each(["supervisor", "agent", "viewer"] as const)(
    "[PER-03] [PER-04] %s only sees Mi cuenta and Acerca de",
    (role) => {
      expect(keys(visibleSettingsPages(actorFor(role)))).toEqual(["cuenta", "acerca"]);
    },
  );

  it("[PER-03] the activity log and the AI keys are never listed for the viewer", () => {
    const pages = keys(visibleSettingsPages(actorFor("viewer")));
    expect(pages).not.toContain("actividad");
    expect(pages).not.toContain("ia");
  });

  it("links the settings pages to their routes; Mi cuenta goes to the profile page", () => {
    const hrefs = Object.fromEntries(visibleSettingsPages(actorFor("owner")).map((page) => [page.key, page.href]));
    expect(hrefs).toMatchObject({
      negocio: "/ajustes/negocio",
      usuarios: "/ajustes/usuarios",
      horario: "/ajustes/horario",
      ia: "/ajustes/ia",
      correo: "/ajustes/correo",
      whatsapp: "/ajustes/whatsapp",
      privacidad: "/ajustes/privacidad",
      notificaciones: "/ajustes/notificaciones",
      recordatorios: "/ajustes/recordatorios",
      envios: "/ajustes/envios",
      actividad: "/ajustes/actividad",
      diagnostico: "/ajustes/diagnostico",
      cuenta: ACCOUNT_HREF,
      acerca: "/ajustes/acerca",
    });
  });

  it("[SEG-04] without an actor no settings page is listed", () => {
    expect(visibleSettingsPages(null)).toEqual([]);
  });
});

describe("groupSettingsPages", () => {
  it.each(["owner", "admin"] as const)("splits the settings of the %s in five groups, in the order of the sub-navigation", (role) => {
    const groups = groupSettingsPages(visibleSettingsPages(actorFor(role))).map(keys);
    expect(groups).toEqual([
      ["negocio", "usuarios", "horario"],
      ["ia", "correo", "whatsapp"],
      ["privacidad", "notificaciones", "recordatorios", "envios"],
      ["actividad", "diagnostico"],
      ["cuenta", "acerca"],
    ]);
    // Grouping never reorders: read in a row, the groups are the sub-navigation.
    expect(groups.flat()).toEqual(keys(visibleSettingsPages(actorFor(role))));
  });

  it.each(["supervisor", "agent", "viewer"] as const)(
    "[PER-03] [PER-04] %s gets one group, so no separator: Mi cuenta and Acerca de",
    (role) => {
      expect(groupSettingsPages(visibleSettingsPages(actorFor(role))).map(keys)).toEqual([["cuenta", "acerca"]]);
    },
  );

  it("drops the groups nothing is in, wherever they are", () => {
    const some = SETTINGS_PAGES.filter((page) => ["usuarios", "diagnostico", "acerca"].includes(page.key));
    expect(groupSettingsPages(some).map(keys)).toEqual([["usuarios"], ["diagnostico"], ["acerca"]]);
    expect(groupSettingsPages([])).toEqual([]);
  });
});

describe("settingsNavKeys", () => {
  it.each(["owner", "admin", "supervisor", "agent", "viewer"] as const)("the sub-navigation of the %s has the settings pages of the role", (role) => {
    const actor = actorFor(role);
    expect(settingsNavKeys({ ...actor, twoFactorSetupRequired: false })).toEqual(keys(visibleSettingsPages(actor)));
  });

  it.each(["owner", "admin"] as const)(
    "[USU-12] the %s who must still set up the two-step verification gets no sub-navigation: only Mi cuenta opens",
    (role) => {
      expect(settingsNavKeys({ ...actorFor(role), twoFactorSetupRequired: true })).toEqual([]);
    },
  );
});

describe("isActivePath", () => {
  it("marks a section active on its page and its sub-pages", () => {
    expect(isActivePath("/bandeja", "/bandeja")).toBe(true);
    expect(isActivePath("/bandeja/1234", "/bandeja")).toBe(true);
    expect(isActivePath("/ajustes/usuarios", "/ajustes")).toBe(true);
  });

  it("does not match a different route that starts with the same letters", () => {
    expect(isActivePath("/agentes", "/agenda")).toBe(false);
    expect(isActivePath("/bandejas", "/bandeja")).toBe(false);
  });

  it("ignores a trailing slash, the query and the hash", () => {
    expect(isActivePath("/contactos/", "/contactos")).toBe(true);
    expect(isActivePath("/agenda?vista=semana", "/agenda")).toBe(true);
  });

  it("with exact, only the page itself is active", () => {
    expect(isActivePath("/ajustes", "/ajustes", { exact: true })).toBe(true);
    expect(isActivePath("/ajustes/ia", "/ajustes", { exact: true })).toBe(false);
  });
});

describe("mobile navigation", () => {
  it("[PWA-02] the bottom bar shows Bandeja, Agenda and Contactos; the rest goes to «Más»", () => {
    const { primary, more } = splitMobileSections(visibleSections(actorFor("owner")));
    expect(keys(primary)).toEqual(["bandeja", "agenda", "contactos"]);
    expect(keys(more)).toEqual(["envios", "agentes", "conocimiento", "canales", "informes", "ajustes"]);
  });

  it("[PWA-02] an agent gets the inbox first and only Ajustes under «Más»", () => {
    const { primary, more } = splitMobileSections(visibleSections(actorFor("agent")));
    expect(keys(primary)).toEqual(["bandeja", "agenda", "contactos"]);
    expect(keys(more)).toEqual(["ajustes"]);
  });

  it("hides the bottom bar inside a conversation only", () => {
    expect(hidesBottomNav("/bandeja/0b6f2c3e-1111-4c1c-9a55-6a4f0f0b3a2d")).toBe(true);
    expect(hidesBottomNav("/bandeja")).toBe(false);
    expect(hidesBottomNav("/bandeja/")).toBe(false);
    expect(hidesBottomNav("/contactos/123")).toBe(false);
  });
});

describe("breadcrumb trail", () => {
  it("finds the section and the settings page of a path", () => {
    expect(sectionForPath("/conocimiento/abc")?.label).toBe("Conocimiento");
    expect(sectionForPath("/ajustes/ia")?.label).toBe("Ajustes");
    expect(settingsPageForPath("/ajustes/ia")?.label).toBe("IA");
    expect(settingsPageForPath("/ajustes/diagnostico/simulador")?.label).toBe("Diagnóstico");
    expect(settingsPageForPath("/ajustes")).toBeNull();
  });

  it("returns null for paths outside the menu", () => {
    expect(sectionForPath("/perfil")).toBeNull();
    expect(sectionForPath("/")).toBeNull();
  });
});

describe("trailForPath", () => {
  /** What the top bar reads: «Ajustes › IA» is ["Ajustes", "IA"]; a section alone, ["Bandeja"]. */
  const trail = (pathname: string) => {
    const found = trailForPath(pathname);
    return found ? [found.section.label, ...(found.page ? [found.page.label] : [])] : null;
  };

  it("is the section of the path and, in Ajustes, the page too", () => {
    expect(trail("/bandeja")).toEqual(["Bandeja"]);
    expect(trail("/conocimiento/abc")).toEqual(["Conocimiento"]);
    expect(trail("/ajustes")).toEqual(["Ajustes"]);
    expect(trail("/ajustes/ia")).toEqual(["Ajustes", "IA"]);
    expect(trail("/ajustes/diagnostico/simulador")).toEqual(["Ajustes", "Diagnóstico"]);
    expect(trail("/ajustes/acerca")).toEqual(["Ajustes", "Acerca de"]);
  });

  it("«Mi cuenta» reads «Ajustes › Mi cuenta» like the other settings pages, although it lives at /perfil", () => {
    expect(settingsPageForPath(ACCOUNT_HREF)?.key).toBe("cuenta");
    expect(trail(ACCOUNT_HREF)).toEqual(["Ajustes", "Mi cuenta"]);
    expect(trail("/perfil?dos-pasos=obligatorio")).toEqual(["Ajustes", "Mi cuenta"]);
    // «Ajustes» in the trail goes back to the settings index, as in the other pages.
    expect(trailForPath(ACCOUNT_HREF)?.section.href).toBe("/ajustes");
  });

  it("every settings page has its trail and is the active one of the sub-navigation at its own address only", () => {
    for (const page of SETTINGS_PAGES) {
      expect(trail(page.href), page.key).toEqual(["Ajustes", page.label]);
      const active = SETTINGS_PAGES.filter((candidate) => isActivePath(page.href, candidate.href));
      expect(keys(active), page.key).toEqual([page.key]);
    }
  });

  it("is null outside the menu", () => {
    expect(trailForPath("/ayuda")).toBeNull();
    expect(trailForPath("/perfilx")).toBeNull();
    expect(trailForPath("/")).toBeNull();
  });
});

describe("«Asistentes» [INT-05] [INT-06]", () => {
  const withAssistants = (role: Role) => keys(visibleSections(actorFor(role), { hasAssistants: true }));

  it("is in the menu only of who has an internal agent to use, after Agenda and Envíos", () => {
    expect(withAssistants("owner")).toEqual(["bandeja", "contactos", "agenda", "envios", "asistentes", "agentes", "conocimiento", "canales", "informes", "ajustes"]);
    expect(withAssistants("admin")).toContain("asistentes");
    expect(withAssistants("supervisor")).toEqual(["bandeja", "contactos", "agenda", "envios", "asistentes", "agentes", "conocimiento", "informes", "ajustes"]);
    expect(withAssistants("agent")).toEqual(["bandeja", "contactos", "agenda", "asistentes", "ajustes"]);
    // Without any assistant for them, nobody has the section.
    for (const role of ["owner", "admin", "supervisor", "agent", "viewer"] as const) expect(keys(visibleSections(actorFor(role)))).not.toContain("asistentes");
  });

  it("«Solo lectura» never has it: that role cannot use internal agents", () => {
    expect(withAssistants("viewer")).not.toContain("asistentes");
  });

  it("goes with the daily work, to /asistentes, and under «Más» on the phone", () => {
    const sections = visibleSections(actorFor("agent"), { hasAssistants: true });
    expect(sections.find((section) => section.key === "asistentes")).toMatchObject({ label: "Asistentes", href: "/asistentes", group: 0 });
    expect(keys(splitMobileSections(sections).more)).toEqual(["asistentes", "ajustes"]);
    expect(sectionForPath("/asistentes/0b6f2c3e-1111-4c1c-9a55-6a4f0f0b3a2d")?.key).toBe("asistentes");
  });
});
