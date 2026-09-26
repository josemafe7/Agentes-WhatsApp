// What the app shell needs for the signed-in actor: business brand, the person, allowed sections and notices.
// Only display data: never a secret ([SEG-02]).
import "server-only";
import { getBusinessProfile, isAiConfigured } from "@/data/settings";
import { primaryStyleSheet } from "@/lib/color";
import { ROLE_LABELS } from "@/lib/permissions";
import type { SessionActor } from "@/server/session";
import { openRouterNotice } from "@/components/banners/banner-state";
import { businessInitials, DEFAULT_BUSINESS_NAME } from "./home-destination";
import { visibleSections, type SectionKey } from "./navigation";
import type { ShellBusiness, ShellUser } from "./types";

/** Files are always served by the authenticated route (docs/security.md «Datos»). */
export const FILES_ROUTE = "/api/files";

export function fileUrl(key: string): string {
  return `${FILES_ROUTE}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export type ShellData = {
  business: ShellBusiness;
  user: ShellUser;
  sectionKeys: SectionKey[];
  /** `:root{…}.dark{…}` with the business colour ([AJU-01], DESIGN.md «Color del negocio»). */
  brandStyleSheet: string;
  openRouterNotice: "manage" | "ask" | null;
};

export async function loadShellData(actor: SessionActor): Promise<ShellData> {
  const [profile, aiConfigured] = await Promise.all([getBusinessProfile(actor), isAiConfigured()]);
  const name = profile.name.trim() || DEFAULT_BUSINESS_NAME;
  return {
    business: {
      name,
      initials: businessInitials(name),
      logoUrl: profile.logoFileKey ? fileUrl(profile.logoFileKey) : null,
    },
    user: { name: actor.name, email: actor.email, roleLabel: ROLE_LABELS[actor.role] },
    sectionKeys: visibleSections(actor).map((section) => section.key),
    brandStyleSheet: primaryStyleSheet(profile.color),
    openRouterNotice: openRouterNotice(actor, aiConfigured),
  };
}
