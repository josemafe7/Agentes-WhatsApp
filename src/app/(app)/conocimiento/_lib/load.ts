// What every page of a knowledge base loads on the server: who is looking and the base, checked on each request
// ([SEG-04]). The layout is not the security boundary: each page calls this again (deduplicated per request).
import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getKnowledgeBase, type KnowledgeBaseSummary } from "@/data/knowledge";
import { getBusinessProfile } from "@/data/settings";
import { can, PERMISSIONS, type Actor, type Role } from "@/lib/permissions";
import { NotFoundError } from "@/server/errors";
import { requirePageActor, type SessionActor } from "@/server/session";
import { knowledgeBasePath } from "./paths";

/** The base, or the «not found» page for an unknown or malformed id. */
const loadBase = cache(async (actor: Actor, kbId: string): Promise<KnowledgeBaseSummary> => {
  try {
    return await getKnowledgeBase(actor, kbId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});

export type KnowledgePage =
  | {
      allowed: true;
      actor: SessionActor;
      base: KnowledgeBaseSummary;
      /** Owner, admin and supervisor: add, edit, re-process and delete ([PER-01]). Viewer only looks. */
      canManage: boolean;
      /** «Probar búsqueda» ([CON-21]). */
      canTest: boolean;
      timezone: string;
    }
  | { allowed: false; role: Role };

/** Session (or /login coming back to this tab), permission to see the knowledge, and the base. */
export async function loadKnowledgePage(params: Promise<{ id: string }>, segment = ""): Promise<KnowledgePage> {
  const { id } = await params;
  const actor = await requirePageActor({ next: knowledgeBasePath(encodeURIComponent(id), segment) });
  if (!can(actor, PERMISSIONS.knowledge.view)) return { allowed: false, role: actor.role };
  const [base, profile] = await Promise.all([loadBase(actor, id), getBusinessProfile(actor)]);
  return {
    allowed: true,
    actor,
    base,
    canManage: can(actor, PERMISSIONS.knowledge.manage),
    canTest: can(actor, PERMISSIONS.knowledge.testSearch),
    timezone: profile.timezone,
  };
}
