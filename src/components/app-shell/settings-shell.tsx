import type { ReactNode } from "react";
import type { SessionActor } from "@/server/session";
import { settingsNavKeys } from "./navigation";
import { SettingsNav } from "./settings-nav";

/**
 * Frame of the settings pages: sub-navigation with the pages the role may open, and content up to 720 px (DESIGN.md
 * «Ajustes»). The settings layout uses it and so does «Mi cuenta», which lives at /perfil, outside that layout.
 * Each settings page checks its own permission on the server; hiding a link protects nothing ([SEG-04]).
 */
export function SettingsShell({ actor, children }: { actor: SessionActor; children: ReactNode }) {
  const pageKeys = settingsNavKeys(actor);

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-8">
      {/* Without pages there is no menu, but it keeps its place as first child: when it appears after turning the
          two-step verification on, React keeps the content mounted, and with it the recovery codes, shown only once. */}
      {pageKeys.length > 0 ? <SettingsNav pageKeys={pageKeys} /> : null}
      <div className="min-w-0 flex-1 md:max-w-[720px]">{children}</div>
    </div>
  );
}
