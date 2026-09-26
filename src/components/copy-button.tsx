"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type CopyButtonProps = { value: string; label?: string };

const COPIED_ICON_MS = 2000;

/** Copies `value` to the clipboard and shows «Copiado»; icon-only (with tooltip) unless a label is given. */
export function CopyButton({ value, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_ICON_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copiado");
    } catch {
      // The browser can deny clipboard access; the person can still select the text by hand.
      toast.error("No se ha podido copiar. Selecciona el texto y cópialo a mano.");
    }
  }

  const Icon = copied ? Check : Copy;

  if (label) {
    return (
      <Button type="button" variant="outline" onClick={copy}>
        <Icon aria-hidden />
        {label}
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" onClick={copy} aria-label="Copiar">
          <Icon aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Copiar</TooltipContent>
    </Tooltip>
  );
}
