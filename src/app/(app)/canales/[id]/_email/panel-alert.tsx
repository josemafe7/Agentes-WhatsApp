import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export type PanelAlertTone = "info" | "success" | "warning" | "error";

// DESIGN.md «Avisos»: reconnection and errors go in the channel's own panel, with the semantic soft colours.
const TONES: Record<PanelAlertTone, { box: string; text: string }> = {
  info: { box: "border-info/30 bg-info-soft text-info", text: "text-info" },
  success: { box: "border-success/30 bg-success-soft text-success", text: "text-success" },
  warning: { box: "border-warning/30 bg-warning-soft text-warning", text: "text-warning" },
  error: { box: "border-destructive/30 bg-destructive-soft text-destructive-text", text: "text-destructive-text" },
};

/** One notice at the top of the mailbox panel: icon, title, what happened and, if any, what to do. */
export function PanelAlert({ tone, icon: Icon, title, children }: { tone: PanelAlertTone; icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <Alert className={TONES[tone].box}>
      <Icon aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className={`grid gap-2 ${TONES[tone].text}`}>{children}</AlertDescription>
    </Alert>
  );
}
