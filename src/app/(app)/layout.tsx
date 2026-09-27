import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { CSSProperties, ReactNode } from "react";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { AppTopbar } from "@/components/app-shell/app-topbar";
import { BottomNav } from "@/components/app-shell/bottom-nav";
import { DEFAULT_BUSINESS_NAME, SETUP_PATH } from "@/components/app-shell/home-destination";
import { InboxUnreadProvider } from "@/components/app-shell/inbox-unread";
import { loadShellData } from "@/components/app-shell/shell-data";
import { isDemoMode } from "@/components/banners/banner-state";
import { DemoBanner } from "@/components/banners/demo-banner";
import { OpenRouterBanner } from "@/components/banners/openrouter-banner";
import { SidebarProvider } from "@/components/ui/sidebar";
import { loadBusinessSettings } from "@/data/settings";
import { getSetupStatus } from "@/data/setup";
import { getActor } from "@/server/session";
import { requireTwoFactorCompliance } from "@/server/session-2fa";

/** Cookie where the shadcn/ui sidebar remembers whether it is folded. */
const SIDEBAR_COOKIE = "sidebar_state";

/** «Bandeja · Peluquería Ana» (DESIGN.md «Accesibilidad»). */
export async function generateMetadata(): Promise<Metadata> {
  // Reads the database: only at request time, never while `next build` tries to prerender.
  await connection();
  const { name } = await loadBusinessSettings();
  const business = name.trim() || DEFAULT_BUSINESS_NAME;
  return { title: { template: `%s · ${business}`, default: business } };
}

/**
 * Authenticated shell: «Modo demo» strip, side menu (desktop) or bottom bar (mobile), top bar, the OpenRouter
 * notice and the page. Checks the session on the server; each page checks its own permission again, because a
 * layout is not re-rendered on every navigation ([SEG-04]).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // Without a session, an empty or unfinished installation goes to the setup wizard ([ASI-01]).
  if (!(await getActor())) {
    const setup = await getSetupStatus();
    if (!setup.completed) redirect(SETUP_PATH);
  }
  // The actor, or /login coming back here ([USU-02]); owners and admins without 2FA while it is required only
  // reach Mi cuenta ([USU-12]).
  const actor = await requireTwoFactorCompliance();

  const [shell, cookieStore] = await Promise.all([loadShellData(actor), cookies()]);
  const demo = isDemoMode();
  const sidebarOpen = cookieStore.get(SIDEBAR_COOKIE)?.value !== "false";

  return (
    <div
      className="flex min-h-svh flex-col"
      style={{ "--app-banner-h": demo ? "2rem" : "0px" } as CSSProperties}
    >
      {/* Business colour for this installation: values are always computed #rrggbb, never raw input. */}
      <style>{shell.brandStyleSheet}</style>
      <a
        href="#contenido"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-2 focus:ring-ring"
      >
        Saltar al contenido
      </a>
      {demo ? <DemoBanner /> : null}
      <InboxUnreadProvider initial={shell.inboxUnread}>
        <SidebarProvider defaultOpen={sidebarOpen} className="min-h-[calc(100svh-var(--app-banner-h))]">
          <AppSidebar business={shell.business} user={shell.user} sectionKeys={shell.sectionKeys} />
          <div className="flex min-w-0 flex-1 flex-col bg-background">
            <AppTopbar business={shell.business} />
            <main
              id="contenido"
              tabIndex={-1}
              className="flex-1 px-4 pt-6 pb-[calc(3.5rem+env(safe-area-inset-bottom)+1.5rem)] outline-none md:px-6 md:pb-8"
            >
              {shell.openRouterNotice ? <OpenRouterBanner variant={shell.openRouterNotice} /> : null}
              {children}
            </main>
          </div>
          <BottomNav user={shell.user} sectionKeys={shell.sectionKeys} />
        </SidebarProvider>
      </InboxUnreadProvider>
    </div>
  );
}
