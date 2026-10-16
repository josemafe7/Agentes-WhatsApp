// The settings index as a person sees it (docs/pantallas.md «Ajustes»; on the phone it is the settings menu): one list
// per group of the sub-navigation, with the pages of the role and what each one is for. The page is rendered as it is;
// only the session is replaced.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { visibleSettingsPages } from "@/components/app-shell/navigation";
import type { Role } from "@/lib/enums";
import type { Actor } from "@/lib/permissions";
import { actorFor } from "@/test/factories";

const state = vi.hoisted(() => ({ actor: null as Actor | null }));
vi.mock("@/server/session", () => ({
  requirePageActor: async () => {
    if (!state.actor) throw new Error("sin sesión");
    return state.actor;
  },
}));

import SettingsIndexPage from "./page";

/** The page for a role: its HTML and the addresses each of its lists links to. */
async function indexFor(role: Role) {
  state.actor = actorFor(role);
  const html = renderToStaticMarkup(await SettingsIndexPage());
  const lists = [...html.matchAll(/<ul[\s\S]*?<\/ul>/g)].map(([list]) => [...list.matchAll(/href="([^"]*)"/g)].map(([, href]) => href));
  return { html, lists };
}

describe("the settings index", () => {
  it.each(["owner", "admin"] as const)("shows the %s one list per group, in the order of the sub-navigation", async (role) => {
    const { html, lists } = await indexFor(role);
    expect(lists).toEqual([
      ["/ajustes/negocio", "/ajustes/usuarios", "/ajustes/horario"],
      ["/ajustes/ia", "/ajustes/correo", "/ajustes/whatsapp"],
      ["/ajustes/privacidad", "/ajustes/notificaciones", "/ajustes/recordatorios"],
      ["/ajustes/actividad", "/ajustes/diagnostico"],
      ["/perfil", "/ajustes/acerca"],
    ]);
    // Every page keeps its name and its line of what it is for.
    for (const page of visibleSettingsPages(state.actor)) {
      expect(html, page.key).toContain(`>${page.label}<`);
      expect(html, page.key).toContain(`>${page.description}<`);
    }
  });

  it.each(["supervisor", "agent", "viewer"] as const)("[PER-03] [PER-04] shows the %s a single list: Mi cuenta and Acerca de", async (role) => {
    const { lists } = await indexFor(role);
    expect(lists).toEqual([["/perfil", "/ajustes/acerca"]]);
  });
});
