// Where «/» leads (docs/pantallas.md «Entrada»), and the initials shown when the business has no logo.
import { HOME_PATH, LOGIN_PATH, SETUP_PATH } from "@/lib/auth-paths";
import type { Actor } from "@/lib/permissions";
import { visibleSections } from "./navigation";

export { LOGIN_PATH, SETUP_PATH };
export const INBOX_PATH = HOME_PATH;

/** Name shown until the business sets its own (DESIGN.md «Marca»). */
export const DEFAULT_BUSINESS_NAME = "DominIA Agentes";

export type HomeState = {
  /** There are users and the wizard was finished (getSetupStatus().completed, [ASI-01], [ASI-10]). */
  setupCompleted: boolean;
  actor: Actor | null;
};

/** Setup wizard while the installation is not finished; login without session; otherwise the first section. */
export function homeDestination({ setupCompleted, actor }: HomeState): string {
  if (!setupCompleted) return SETUP_PATH;
  if (!actor) return LOGIN_PATH;
  return visibleSections(actor)[0]?.href ?? INBOX_PATH;
}

/** Up to two capital initials of the business name («Peluquería Ana» → «PA»). */
export function businessInitials(name: string): string {
  const words = (name.trim() || DEFAULT_BUSINESS_NAME).split(/\s+/).filter((word) => /\p{L}|\p{N}/u.test(word));
  return words
    .slice(0, 2)
    .map((word) => (word.match(/[\p{L}\p{N}]/u)?.[0] ?? "").toLocaleUpperCase("es"))
    .join("");
}
