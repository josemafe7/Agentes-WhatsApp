"use client";

import { useId } from "react";
import { CopyButton } from "@/components/copy-button";
import { FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FieldHelp } from "../_lib/help";
import { WhereToFind } from "../../whatsapp/_components/where-to-find";

type CopyWithHelpProps = { label: string; value: string; help: FieldHelp; description: string };

/**
 * Data to paste into Google Cloud or Entra (DESIGN.md › Formularios › Datos para copiar): read-only, mono, with its copy
 * button and «¿Dónde lo encuentro?» right of the label.
 */
export function CopyWithHelp({ label, value, help, description }: CopyWithHelpProps) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Label htmlFor={id}>{label}</Label>
        <WhereToFind help={help} />
      </div>
      <div className="flex items-center gap-2">
        <Input id={id} readOnly value={value} className="font-mono text-xs" aria-describedby={`${id}-help`} onFocus={(event) => event.currentTarget.select()} />
        <CopyButton value={value} />
      </div>
      <FieldDescription id={`${id}-help`}>{description}</FieldDescription>
    </div>
  );
}
