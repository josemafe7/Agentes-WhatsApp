import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BusinessBrand } from "./business-brand";
import { INBOX_PATH } from "./home-destination";
import { ShellTrail } from "./shell-trail";
import type { ShellBusiness } from "./types";

const TOGGLE_LABEL = "Plegar o desplegar el menú";

/** Fixed 56 px bar: fold the menu and where you are (desktop); the business on mobile. */
export function AppTopbar({ business }: { business: ShellBusiness }) {
  return (
    <header className="sticky top-(--app-banner-h) z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4 md:px-6">
      <Tooltip>
        <TooltipTrigger asChild>
          <SidebarTrigger aria-label={TOGGLE_LABEL} className="-ml-1 hidden size-9 md:inline-flex" />
        </TooltipTrigger>
        <TooltipContent>{TOGGLE_LABEL} (Ctrl+B)</TooltipContent>
      </Tooltip>
      <Separator orientation="vertical" className="mr-1 hidden data-[orientation=vertical]:h-4 md:block" />
      <Link href={INBOX_PATH} className="min-w-0 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:hidden">
        <BusinessBrand business={business} />
      </Link>
      <ShellTrail className="hidden min-w-0 md:block" />
    </header>
  );
}
