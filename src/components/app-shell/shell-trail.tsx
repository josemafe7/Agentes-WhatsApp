"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { isActivePath, trailForPath } from "./navigation";

/** Where you are, in the top bar: «Ajustes › IA», «Ajustes › Mi cuenta», «Bandeja»… */
export function ShellTrail({ className }: { className?: string }) {
  const pathname = usePathname();
  const trail = trailForPath(pathname);
  if (!trail) return null;
  const { section, page } = trail;
  const sectionIsCurrent = !page && isActivePath(pathname, section.href, { exact: true });

  return (
    <Breadcrumb aria-label="Estás en" className={className}>
      <BreadcrumbList>
        <BreadcrumbItem>
          {sectionIsCurrent ? (
            <BreadcrumbPage>{section.label}</BreadcrumbPage>
          ) : (
            <BreadcrumbLink asChild>
              <Link href={section.href}>{section.label}</Link>
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>
        {page ? (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{page.label}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : null}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
