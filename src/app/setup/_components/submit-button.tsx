"use client";

import { LoaderCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";

type SubmitButtonProps = Omit<ComponentProps<typeof Button>, "children"> & {
  pending: boolean;
  children: ReactNode;
  pendingLabel?: string;
};

/** Button that shows the spinner and «Guardando…» while its action runs (DESIGN.md «Botones»). */
export function SubmitButton({
  pending,
  children,
  pendingLabel = "Guardando…",
  type = "submit",
  disabled,
  ...props
}: SubmitButtonProps) {
  return (
    <Button type={type} disabled={pending || disabled} aria-busy={pending || undefined} {...props}>
      {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
      {pending ? pendingLabel : children}
    </Button>
  );
}
