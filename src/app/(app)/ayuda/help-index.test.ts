// The list of guides of Ayuda as a person sees it ([AJU-17]): by groups, with where to start first, and each guide with
// its link, the title of its file and its line. The page is rendered as it is; only the session is replaced.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/permissions";
import { actorFor } from "@/test/factories";

const state = vi.hoisted(() => ({ actor: null as Actor | null }));
vi.mock("@/server/session", () => ({
  requirePageActor: async () => {
    if (!state.actor) throw new Error("sin sesión");
    return state.actor;
  },
}));

import { HELP_GUIDES, parseGuide, readGuide } from "./_lib/guides";
import HelpPage from "./page";

/** The text of a piece of HTML, as it is read. */
function textOf(html: string): string {
  const entities: Record<string, string> = { "&quot;": '"', "&#x27;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&" };
  return html.replace(/<[^>]*>/g, "").replace(/&(?:quot|#x27|lt|gt|amp);/g, (entity) => entities[entity]);
}

describe("the list of guides", () => {
  it("is shown by groups to any signed-in role, with where to start first and nothing else under the heading", async () => {
    state.actor = actorFor("viewer");
    const html = renderToStaticMarkup(await HelpPage());
    const groups = [...html.matchAll(/<section[\s\S]*?<\/section>/g)].map(([section]) => ({
      title: textOf(/<h2[\s\S]*?<\/h2>/.exec(section)?.[0] ?? ""),
      guides: [...section.matchAll(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(([, href, link]) => ({ href, text: textOf(link) })),
    }));

    expect(groups.map((group) => [group.title, group.guides.map((guide) => guide.href)])).toEqual([
      ["Para empezar", ["/ayuda/puesta-en-marcha", "/ayuda/despliegue"]],
      ["Canales", ["/ayuda/whatsapp", "/ayuda/whatsapp-ycloud", "/ayuda/whatsapp-qr", "/ayuda/correo", "/ayuda/telegram"]],
      ["Agentes y conocimiento", ["/ayuda/agentes-y-conocimiento", "/ayuda/asistentes-internos"]],
      ["Agenda", ["/ayuda/agenda"]],
    ]);

    // Each guide keeps the title of its file and its line.
    const shown = new Map(groups.flatMap((group) => group.guides).map((guide) => [guide.href, guide.text]));
    expect(shown.size).toBe(HELP_GUIDES.length);
    for (const guide of HELP_GUIDES) {
      const { title } = parseGuide(await readGuide(guide));
      expect(shown.get(`/ayuda/${guide.slug}`), guide.slug).toBe(`${title}${guide.description}`);
    }

    // The groups are all there is under the heading: no notice of guides still to come.
    const underHeading = textOf(html.slice(html.indexOf("</header>")));
    expect(underHeading).toBe(groups.map((group) => group.title + group.guides.map((guide) => guide.text).join("")).join(""));
  });
});
