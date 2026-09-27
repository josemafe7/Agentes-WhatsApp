import { CircleCheck, CircleX, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PermissionInfo } from "../_lib/permissions";

type PermissionListProps = {
  /** Without `granted`: what will be asked for; with it, what the mailbox was given ([COR-03], [COR-07]). */
  items: readonly (PermissionInfo & { granted?: boolean })[];
  className?: string;
};

/** The permissions of Google or Microsoft, each with its state in icon and word (DESIGN.md › Insignias y semáforos). */
export function PermissionList({ items, className }: PermissionListProps) {
  return (
    <ul className={cn("grid gap-1.5 text-sm", className)}>
      {items.map((item) => {
        const Icon = item.granted === undefined ? KeyRound : item.granted ? CircleCheck : CircleX;
        return (
          <li key={item.key} className="flex items-start gap-2">
            <Icon
              aria-hidden
              className={cn(
                "mt-0.5 size-4 shrink-0",
                item.granted === undefined ? "text-muted-foreground" : item.granted ? "text-success" : "text-destructive-text",
              )}
            />
            <span>
              {item.label}
              {item.granted === undefined ? null : (
                <span className={cn("ml-2 text-xs", item.granted ? "text-success" : "text-destructive-text")}>{item.granted ? "Concedido" : "Falta"}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
