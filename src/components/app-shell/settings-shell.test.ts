// The frame of the settings pages as a person sees it (DESIGN.md «Ajustes»): the sub-navigation in groups, with the
// pages of the role and the one they are on marked, also in «Mi cuenta» (/perfil, outside /ajustes), and no menu while
// the two-step verification must still be set up ([USU-12]). Rendered as it is; only the address is replaced.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/enums";
import { actorFor } from "@/test/factories";

const state = vi.hoisted(() => ({ pathname: "/ajustes" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));

import { SettingsShell } from "./settings-shell";

const SESSION = { email: "ana@example.com", sessionId: "s", isDemo: false, twoFactorEnabled: false, twoFactorSetupRequired: false };
const CONTENT = "Contenido de la página";

type LinkSeen = { href: string; current: boolean };

function linksIn(html: string): LinkSeen[] {
  return [...html.matchAll(/<a\s([^>]*)>/g)].map(([, attributes]) => ({
    href: /href="([^"]*)"/.exec(attributes)?.[1] ?? "",
    current: attributes.includes('aria-current="page"'),
  }));
}

/** The frame at an address: the sub-navigation (its lists, separators and links) and what is outside it. */
function frameAt(pathname: string, role: Role, session: Partial<typeof SESSION> = {}) {
  state.pathname = pathname;
  const actor = { ...actorFor(role), ...SESSION, ...session };
  const html = renderToStaticMarkup(SettingsShell({ actor, children: createElement("p", null, CONTENT) }));
  const nav = /<nav[^>]*aria-label="Ajustes"[\s\S]*<\/nav>/.exec(html)?.[0] ?? null;
  const lists = nav ? [...nav.matchAll(/<ul[\s\S]*?<\/ul>/g)].map(([list]) => linksIn(list)) : [];
  return {
    html,
    nav,
    groups: lists.map((list) => list.map((link) => link.href)),
    separators: nav?.match(/data-slot="separator"/g)?.length ?? 0,
    current: lists.flat().filter((link) => link.current).map((link) => link.href),
    /** Links of the frame outside the sub-navigation: the way back to the settings index, for the phone. */
    outside: linksIn(nav ? html.replace(nav, "") : html).map((link) => link.href),
  };
}

describe("the settings frame", () => {
  it("groups the thirteen pages of the owner in five lists, with a separator between them and no titles", () => {
    const frame = frameAt("/ajustes/ia", "owner");
    expect(frame.groups).toEqual([
      ["/ajustes/negocio", "/ajustes/usuarios", "/ajustes/horario"],
      ["/ajustes/ia", "/ajustes/correo", "/ajustes/whatsapp"],
      ["/ajustes/privacidad", "/ajustes/notificaciones", "/ajustes/recordatorios"],
      ["/ajustes/actividad", "/ajustes/diagnostico"],
      ["/perfil", "/ajustes/acerca"],
    ]);
    expect(frame.separators).toBe(4);
    // Each separator sits between two lists: none before the first group nor after the last.
    expect(frame.nav?.match(/<\/ul><div[^>]*data-slot="separator"[^>]*><\/div><ul/g)).toHaveLength(4);
    expect(frame.nav).not.toMatch(/<h\d/);
    expect(frame.current).toEqual(["/ajustes/ia"]);
    expect(frame.html).toContain(CONTENT);
  });

  it("«Mi cuenta» keeps the settings menu, marked as the page the person is on, and the way back to Ajustes", () => {
    const frame = frameAt("/perfil", "admin");
    expect(frame.groups.flat()).toHaveLength(13);
    expect(frame.current).toEqual(["/perfil"]);
    expect(frame.outside).toEqual(["/ajustes"]);
  });

  it.each(["supervisor", "agent", "viewer"] as const)("[PER-03] [PER-04] the %s gets Mi cuenta and Acerca de in one list, without separators", (role) => {
    const frame = frameAt("/perfil", role);
    expect(frame.groups).toEqual([["/perfil", "/ajustes/acerca"]]);
    expect(frame.separators).toBe(0);
    expect(frame.current).toEqual(["/perfil"]);
  });

  it.each(["owner", "admin"] as const)(
    "[USU-12] the %s who must still set up the two-step verification sees the page without the menu or a way to Ajustes",
    (role) => {
      const frame = frameAt("/perfil", role, { twoFactorSetupRequired: true });
      expect(frame.nav).toBeNull();
      expect(linksIn(frame.html)).toEqual([]);
      expect(frame.html).toContain(CONTENT);
    },
  );

  it("the settings index has the menu but no way back to itself", () => {
    const frame = frameAt("/ajustes", "owner");
    expect(frame.groups).toHaveLength(5);
    expect(frame.current).toEqual([]);
    expect(frame.outside).toEqual([]);
  });
});
