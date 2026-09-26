// Which global notices the shell shows (DESIGN.md «Avisos»): at most «Modo demo» and the OpenRouter key.
import { can, PERMISSIONS, type Actor } from "@/lib/permissions";

/** DEMO_MODE=true (only the local .env.local created by setup) turns on the «Modo demo» strip ([ARR-05]). */
export function isDemoMode(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.DEMO_MODE === "true";
}

/**
 * Without an OpenRouter key the AI is off ([ARR-14]): owners and admins get the button to Settings › IA; the
 * other roles cannot open the keys ([PER-04]), so they are asked to tell the owner. Null when AI works.
 */
export function openRouterNotice(actor: Actor, aiConfigured: boolean): "manage" | "ask" | null {
  if (aiConfigured) return null;
  return can(actor, PERMISSIONS.settings.integrations) ? "manage" : "ask";
}
