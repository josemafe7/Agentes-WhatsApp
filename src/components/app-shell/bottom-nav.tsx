"use client";

import { CircleHelp, Ellipsis, LogOut, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ACCOUNT_HREF,
  HELP_HREF,
  hidesBottomNav,
  isActivePath,
  SECTIONS,
  splitMobileSections,
  type SectionKey,
} from "./navigation";
import { InboxUnreadBadge, InboxUnreadDescription } from "./inbox-unread";
import { THEME_OPTIONS } from "./theme-options";
import type { ShellUser } from "./types";
import { useSignOut } from "./use-sign-out";
import { UserAvatar } from "./user-menu";

type BottomNavProps = { user: ShellUser; sectionKeys: readonly SectionKey[] };

const UNREAD_DESCRIPTION_ID = "bottom-nav-inbox-unread";
const ITEM_CLASS =
  "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&_svg]:size-5";

/**
 * Mobile and installed app (below 768 px): Bandeja, Agenda, Contactos and «Más», which opens the other sections,
 * Mi cuenta, Ayuda, the theme and «Cerrar sesión». Hidden inside a conversation (DESIGN.md «Móvil y PWA»).
 */
export function BottomNav({ user, sectionKeys }: BottomNavProps) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { signOut, pending } = useSignOut();

  if (hidesBottomNav(pathname)) return null;

  const { primary, more } = splitMobileSections(SECTIONS.filter((section) => sectionKeys.includes(section.key)));
  const moreActive =
    more.some((section) => isActivePath(pathname, section.href)) ||
    isActivePath(pathname, ACCOUNT_HREF) ||
    isActivePath(pathname, HELP_HREF);

  return (
    <nav
      aria-label="Menú principal"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex h-14 items-stretch">
        {primary.map((section) => {
          const active = isActivePath(pathname, section.href);
          const Icon = section.icon;
          const inbox = section.key === "bandeja";
          return (
            <Link
              key={section.key}
              href={section.href}
              aria-current={active ? "page" : undefined}
              aria-describedby={inbox ? UNREAD_DESCRIPTION_ID : undefined}
              className={cn(ITEM_CLASS, active ? "text-primary-text" : "text-muted-foreground")}
            >
              <span className="relative">
                <Icon aria-hidden />
                {inbox ? <InboxUnreadBadge className="absolute -top-1.5 left-3 min-w-5 text-center" /> : null}
              </span>
              <span className="truncate">{section.label}</span>
            </Link>
          );
        })}
        <InboxUnreadDescription id={UNREAD_DESCRIPTION_ID} />
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className={cn(ITEM_CLASS, moreActive ? "text-primary-text" : "text-muted-foreground")}
            >
              <Ellipsis aria-hidden />
              <span>Más</span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" showCloseButton={false} className="max-h-[85svh] gap-0 overflow-y-auto rounded-t-xl pb-[env(safe-area-inset-bottom)]">
            <SheetHeader className="flex-row items-center justify-between border-b">
              <div className="min-w-0">
                <SheetTitle>Más</SheetTitle>
                <SheetDescription className="sr-only">Otras secciones, tu cuenta y el tema.</SheetDescription>
              </div>
              <SheetClose asChild>
                <Button variant="ghost" size="icon" aria-label="Cerrar">
                  <X aria-hidden />
                </Button>
              </SheetClose>
            </SheetHeader>
            {more.length > 0 ? (
              <ul className="flex flex-col p-2">
                {more.map((section) => {
                  const active = isActivePath(pathname, section.href);
                  const Icon = section.icon;
                  return (
                    <li key={section.key}>
                      <SheetClose asChild>
                        <Link
                          href={section.href}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex min-h-12 items-center gap-3 rounded-md px-3 text-base hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-5",
                            active && "bg-muted font-medium [&_svg]:text-primary-text",
                          )}
                        >
                          <Icon aria-hidden />
                          {section.label}
                        </Link>
                      </SheetClose>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div className="flex flex-col gap-3 border-t p-4">
              <div className="flex items-center gap-3">
                <UserAvatar name={user.name} />
                <div className="grid min-w-0 leading-tight">
                  <span className="truncate text-sm font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user.roleLabel} · {user.email}
                  </span>
                </div>
              </div>
              <SheetClose asChild>
                <Link
                  href={ACCOUNT_HREF}
                  className="flex min-h-12 items-center gap-3 rounded-md px-3 text-base hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-5"
                >
                  <UserRound aria-hidden />
                  Mi cuenta
                </Link>
              </SheetClose>
              <SheetClose asChild>
                <Link
                  href={HELP_HREF}
                  className="flex min-h-12 items-center gap-3 rounded-md px-3 text-base hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-5"
                >
                  <CircleHelp aria-hidden />
                  Ayuda
                </Link>
              </SheetClose>
              <div className="flex flex-col gap-2 px-3">
                <span id="tema-movil" className="text-sm font-medium">
                  Tema
                </span>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  aria-labelledby="tema-movil"
                  value={theme ?? "light"}
                  onValueChange={(value) => {
                    if (value) setTheme(value);
                  }}
                  className="w-full"
                >
                  {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                    <ToggleGroupItem key={value} value={value} className="flex-1">
                      <Icon aria-hidden />
                      {label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <Button variant="outline" className="justify-start" disabled={pending} onClick={signOut}>
                <LogOut aria-hidden />
                {pending ? "Cerrando sesión…" : "Cerrar sesión"}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
