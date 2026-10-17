"use client";
// The one button of «Darme de baja» ([ENV-11]), and what happened after pressing it.
import { LoaderCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { unsubscribeAction, type UnsubscribeState } from "./actions";

export function UnsubscribeButton({ token, businessName }: { token: string; businessName: string }) {
  const [state, setState] = useState<UnsubscribeState | null>(null);
  const [pending, startTransition] = useTransition();

  if (state?.done) {
    return (
      <p role="status" className="text-base">
        Listo: ya no recibirás novedades ni publicidad de {businessName} por correo. Los avisos de tus citas seguirán llegando.
      </p>
    );
  }
  return (
    <div className="grid gap-3">
      <div>
        <Button type="button" onClick={() => startTransition(async () => setState(await unsubscribeAction(token)))} disabled={pending} aria-busy={pending}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {pending ? "Dándote de baja…" : "Darme de baja"}
        </Button>
      </div>
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive-text">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
