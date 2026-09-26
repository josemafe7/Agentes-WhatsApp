import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { visibleSettingsPages } from "@/components/app-shell/navigation";
import { PageHeader } from "@/components/page-header";
import { requirePageActor } from "@/server/session";

export const metadata: Metadata = { title: "Ajustes" };

/** Settings index: the pages this role may open, each with what it is for (on mobile, the settings menu). */
export default async function SettingsIndexPage() {
  const actor = await requirePageActor({ next: "/ajustes" });
  const pages = visibleSettingsPages(actor);

  return (
    <>
      <PageHeader title="Ajustes" description="Elige qué quieres revisar o cambiar." />
      <ul className="divide-y overflow-hidden rounded-xl border">
        {pages.map((page) => {
          const Icon = page.icon;
          return (
            <li key={page.key}>
              <Link
                href={page.href}
                className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="text-sm font-medium">{page.label}</span>
                  <span className="text-xs text-muted-foreground">{page.description}</span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
