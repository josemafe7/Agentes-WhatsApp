import type { ReactNode } from "react";
import { SettingsShell } from "@/components/app-shell/settings-shell";
import { requirePageActor } from "@/server/session";

/**
 * Settings: every page under /ajustes goes in the frame of the settings pages, with the sub-navigation of the role
 * (DESIGN.md «Ajustes»). Each page checks its own permission on the server ([SEG-04]).
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  // 2FA compliance is enforced by the app layout; this only needs to know who is looking.
  const actor = await requirePageActor({ allowTwoFactorSetup: true });

  return <SettingsShell actor={actor}>{children}</SettingsShell>;
}
