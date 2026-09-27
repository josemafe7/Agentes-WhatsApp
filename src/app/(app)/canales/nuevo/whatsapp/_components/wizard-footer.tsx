"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type WizardFooterProps = {
  /** «Atrás»: a step address, an action, or nothing. */
  back?: { href: string } | { onClick: () => void } | null;
  /** The main button on the right (usually «Continuar»); several are allowed before it. */
  children?: ReactNode;
};

/** Foot of every step (DESIGN.md › Asistentes): «Atrás» (ghost) on the left, the main action on the right. */
export function WizardFooter({ back, children }: WizardFooterProps) {
  return (
    <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
      {back ? (
        "href" in back ? (
          <Button asChild variant="ghost">
            <Link href={back.href}>Atrás</Link>
          </Button>
        ) : (
          <Button type="button" variant="ghost" onClick={back.onClick}>
            Atrás
          </Button>
        )
      ) : (
        <span aria-hidden />
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row">{children}</div>
    </div>
  );
}

type BusyButtonProps = {
  pending: boolean;
  pendingLabel: string;
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "default" | "outline" | "ghost";
};

/** A button that, while its action runs, is disabled and shows the spinner and «…ando» text (DESIGN.md › Botones). */
export function BusyButton({ pending, pendingLabel, children, disabled, onClick, type = "button", variant = "default" }: BusyButtonProps) {
  return (
    <Button type={type} variant={variant} disabled={pending || disabled} aria-busy={pending || undefined} onClick={onClick}>
      {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
      {pending ? pendingLabel : children}
    </Button>
  );
}
