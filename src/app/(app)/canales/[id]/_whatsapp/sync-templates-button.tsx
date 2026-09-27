"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncWhatsAppTemplatesAction } from "./actions";

/** «Sincronizar» the number's templates from Meta ([WA-22]). */
export function SyncTemplatesButton({ channelId }: { channelId: string }) {
  const [pending, startTransition] = useTransition();

  function sync() {
    startTransition(async () => {
      const result = await syncWhatsAppTemplatesAction(channelId);
      if (result.ok) toast.success(result.message ?? "Plantillas sincronizadas.");
      else toast.error(result.error);
    });
  }

  return (
    <Button type="button" variant="outline" disabled={pending} aria-busy={pending} onClick={sync}>
      {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden />}
      {pending ? "Sincronizando…" : "Sincronizar"}
    </Button>
  );
}
