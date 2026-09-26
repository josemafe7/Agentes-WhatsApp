import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type StepFooterProps = {
  /** Previous step (?paso=N-1); none on the first step the owner can see. */
  backHref?: string;
  children: ReactNode;
};

/** Wizard footer (DESIGN.md «Asistentes»): «Atrás» on the left, the step's actions on the right. */
export function StepFooter({ backHref, children }: StepFooterProps) {
  return (
    <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {backHref ? (
          <Button asChild variant="ghost">
            <Link href={backHref}>Atrás</Link>
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">{children}</div>
    </div>
  );
}
