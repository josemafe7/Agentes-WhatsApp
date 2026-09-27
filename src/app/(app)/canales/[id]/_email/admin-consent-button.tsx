"use client";

import { LoaderCircle, ShieldCheck } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adminConsentAction } from "./actions";

/**
 * «Dar el consentimiento del administrador» ([COR-07]): Microsoft's admin consent page for the business's tenant, with a
 * state stored for the return. Only an administrator of the tenant can accept it; the result comes back to this panel.
 */
export function AdminConsentButton({ channelId }: { channelId: string }) {
  const [pending, startTransition] = useTransition();

  function open() {
    startTransition(async () => {
      const result = await adminConsentAction(channelId);
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "No se ha podido preparar el enlace. Inténtalo de nuevo." : result.error);
        return;
      }
      window.location.assign(result.data.url);
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} aria-busy={pending} onClick={open}>
      {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <ShieldCheck aria-hidden />}
      Dar el consentimiento del administrador
    </Button>
  );
}
