"use client";
// Over the composer while the contact's identity is «sin confirmar» ([WA-63], [AGD-24]): the app wrote to a phone or
// an address nobody has confirmed yet, so the AI only deals with the booking of the reminder answered; «Confirmar»
// says it is the customer's.
import { LoaderCircle, ShieldQuestion } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmIdentityAction } from "./actions";

export const UNCONFIRMED_IDENTITY_TEXT =
  "Sin confirmar: la app escribió a un teléfono o a un correo que nadie ha confirmado que sea de este cliente. Hasta que lo confirmes, la IA solo atiende la cita del recordatorio y ofrece una persona para lo demás.";

export function UnconfirmedIdentityNotice({ conversationId, canConfirm }: { conversationId: string; canConfirm: boolean }) {
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await confirmIdentityAction(conversationId);
      if (!result.ok) toast.error(result.error);
      else toast.success(result.message ?? "Contacto confirmado.");
    });
  }

  return (
    <div role="status" className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
      <p className="flex min-w-0 flex-1 items-start gap-1.5">
        <ShieldQuestion aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{UNCONFIRMED_IDENTITY_TEXT}</span>
      </p>
      {canConfirm ? (
        <Button type="button" size="sm" variant="outline" onClick={confirm} disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Confirmando…" : "Confirmar"}
        </Button>
      ) : null}
    </div>
  );
}
