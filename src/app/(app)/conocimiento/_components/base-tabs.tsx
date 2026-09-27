"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type BaseTabLink = { key: string; label: string; href: string };

/**
 * Underlined tabs of a knowledge base, each with its own route (DESIGN.md «Cabecera de página»). A document's page
 * belongs to «Documentos».
 */
export function BaseTabs({ tabs, baseHref }: { tabs: BaseTabLink[]; baseHref: string }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === baseHref ? pathname === href || pathname.startsWith(`${baseHref}/documentos/`) : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav aria-label="Secciones de la base" className="-mx-4 overflow-x-auto border-b px-4 md:-mx-6 md:px-6">
      <ul className="flex gap-1">
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:h-11",
                  active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
