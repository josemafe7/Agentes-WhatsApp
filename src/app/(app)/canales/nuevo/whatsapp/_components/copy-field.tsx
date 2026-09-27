"use client";

import { useId } from "react";
import { CopyButton } from "@/components/copy-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Data to paste into Meta (DESIGN.md › Formularios › Datos para copiar): read-only, mono, with its copy button. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} readOnly value={value} className="font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
        <CopyButton value={value} />
      </div>
    </div>
  );
}
