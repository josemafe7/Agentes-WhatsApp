import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ShellBusiness } from "./types";

type BusinessLogoProps = { business: ShellBusiness; className?: string };

/** Business logo, or its initials on the business colour while there is no logo (or it cannot load). */
export function BusinessLogo({ business, className }: BusinessLogoProps) {
  return (
    <Avatar className={cn("size-8 rounded-md after:rounded-md", className)}>
      {business.logoUrl ? (
        <AvatarImage src={business.logoUrl} alt="" className="rounded-md bg-background object-contain" />
      ) : null}
      <AvatarFallback className="rounded-md bg-primary text-xs font-semibold text-primary-foreground">
        {business.initials}
      </AvatarFallback>
    </Avatar>
  );
}

/** Logo and name of the business, as shown at the top of the menu and in the mobile top bar. */
export function BusinessBrand({ business, className }: BusinessLogoProps) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <BusinessLogo business={business} />
      <span className="truncate text-sm font-semibold">{business.name}</span>
    </span>
  );
}
