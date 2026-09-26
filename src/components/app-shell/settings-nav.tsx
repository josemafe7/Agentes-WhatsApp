"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActivePath, SETTINGS_HREF, SETTINGS_PAGES, type SettingsPageKey } from "./navigation";

/**
 * Settings sub-navigation: a 220 px column on the left from 768 px; on mobile the settings index is the list and
 * each page shows a way back to it (DESIGN.md «Ajustes»).
 */
export function SettingsNav({ pageKeys }: { pageKeys: readonly SettingsPageKey[] }) {
  const pathname = usePathname();
  const pages = SETTINGS_PAGES.filter((page) => pageKeys.includes(page.key));
  const onIndex = isActivePath(pathname, SETTINGS_HREF, { exact: true });

  return (
    <>
      {onIndex ? null : (
        <Link
          href={SETTINGS_HREF}
          className="-ml-1 inline-flex min-h-11 items-center gap-1 self-start rounded-md px-1 text-sm font-medium text-primary-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:hidden"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Ajustes
        </Link>
      )}
      <nav aria-label="Ajustes" className="hidden w-[220px] shrink-0 md:block">
        <ul className="sticky top-[calc(var(--app-banner-h)+5rem)] flex flex-col gap-0.5">
          {pages.map((page) => {
            const active = isActivePath(pathname, page.href);
            const Icon = page.icon;
            return (
              <li key={page.key}>
                <Link
                  href={page.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-md px-3 text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-4 [&_svg]:shrink-0",
                    active
                      ? "bg-muted font-medium text-foreground [&_svg]:text-primary-text"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon aria-hidden />
                  <span className="truncate">{page.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
