"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { BusinessBrand } from "./business-brand";
import { INBOX_PATH } from "./home-destination";
import { groupSections, isActivePath, SECTIONS, type SectionKey } from "./navigation";
import type { ShellBusiness, ShellUser } from "./types";
import { UserMenu } from "./user-menu";

type AppSidebarProps = {
  business: ShellBusiness;
  user: ShellUser;
  /** Sections the server allowed for this actor. */
  sectionKeys: readonly SectionKey[];
};

const TOGGLE_LABEL = "Plegar o desplegar el menú (Ctrl+B)";

/** Desktop side menu (256 px, folds to icons with Ctrl/Cmd+B): business, sections and the user menu. */
export function AppSidebar({ business, user, sectionKeys }: AppSidebarProps) {
  const pathname = usePathname();
  const groups = groupSections(SECTIONS.filter((section) => sectionKeys.includes(section.key)));

  return (
    <Sidebar
      collapsible="icon"
      // Below the «Modo demo» strip when it is shown (--app-banner-h is set by the app layout).
      className="md:top-(--app-banner-h) md:h-[calc(100svh-var(--app-banner-h))]"
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip={business.name}>
              <Link href={INBOX_PATH}>
                <BusinessBrand business={business} />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Menú principal">
          {groups.map((group, index) => (
            <Fragment key={group[0].key}>
              {index > 0 ? <SidebarSeparator className="mx-2" /> : null}
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.map((section) => {
                      const active = isActivePath(pathname, section.href);
                      const Icon = section.icon;
                      return (
                        <SidebarMenuItem key={section.key}>
                          <SidebarMenuButton
                            asChild
                            isActive={active}
                            tooltip={section.label}
                            className="h-9 [&_svg]:size-5 data-[active=true]:[&_svg]:text-primary-text"
                          >
                            <Link href={section.href} aria-current={active ? "page" : undefined}>
                              <Icon aria-hidden />
                              <span>{section.label}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </Fragment>
          ))}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <UserMenu user={user} />
      </SidebarFooter>
      <SidebarRail aria-label={TOGGLE_LABEL} title={TOGGLE_LABEL} />
    </Sidebar>
  );
}
