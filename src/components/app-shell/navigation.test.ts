import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/enums";
import { actorFor } from "@/test/factories";
import {
  ACCOUNT_HREF,
  groupSections,
  hidesBottomNav,
  isActivePath,
  sectionForPath,
  settingsPageForPath,
  splitMobileSections,
  visibleSections,
  visibleSettingsPages,
} from "./navigation";

const keys = (items: readonly { key: string }[]) => items.map((item) => item.key);

// docs/spec.md «Quién puede hacer qué» and docs/pantallas.md «Quién ve qué»: each role sees only its sections.
const EXPECTED_SECTIONS: Record<Role, string[]> = {
  owner: ["bandeja", "contactos", "agenda", "agentes", "conocimiento", "canales", "informes", "ajustes"],
  admin: ["bandeja", "contactos", "agenda", "agentes", "conocimiento", "canales", "informes", "ajustes"],
  supervisor: ["bandeja", "contactos", "agenda", "agentes", "conocimiento", "informes", "ajustes"],
  agent: ["bandeja", "contactos", "agenda", "ajustes"],
  viewer: ["bandeja", "contactos", "agenda", "agentes", "conocimiento", "canales", "informes", "ajustes"],
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
      ["bandeja", "contactos", "agenda"],
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
    expect(keys(more)).toEqual(["agentes", "conocimiento", "canales", "informes", "ajustes"]);
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
