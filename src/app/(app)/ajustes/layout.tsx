import type { ReactNode } from "react";
import { visibleSettingsPages } from "@/components/app-shell/navigation";
import { SettingsNav } from "@/components/app-shell/settings-nav";
import { requirePageActor } from "@/server/session";

/**
 * Settings: sub-navigation with the pages the role may open, and content up to 720 px (DESIGN.md «Ajustes»).
 * Each settings page checks its own permission on the server; hiding a link protects nothing ([SEG-04]).
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  // 2FA compliance is enforced by the app layout; this only needs to know who is looking.
  const actor = await requirePageActor({ allowTwoFactorSetup: true });
  const pageKeys = visibleSettingsPages(actor).map((page) => page.key);

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-8">
      <SettingsNav pageKeys={pageKeys} />
      <div className="min-w-0 flex-1 md:max-w-[720px]">{children}</div>
    </div>
  );
}
