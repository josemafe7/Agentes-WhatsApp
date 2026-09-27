"use client";

import { useState } from "react";
import { Stepper } from "@/components/stepper";
import { WIZARD_STEPS } from "../_lib/steps";
import { DataStep, type Reconnect } from "./data-step";
import { NoticeStep, type NumberKind } from "./notice-step";

const STEPPER_STEPS = WIZARD_STEPS.map(({ id, label }) => ({ id, label }));

type ConnectFlowProps = {
  hasOtherNumbers: boolean;
  publicHttps: boolean;
  reconnect: (Reconnect & { isMetaTestNumber: boolean }) | null;
};

/**
 * Pasos 0 y 1, before the channel exists: the notice (with its mandatory checkbox and the Meta test number option) and
 * the data validated with Meta. «Conectar» creates the channel and the wizard goes on at /canales/nuevo/whatsapp?canal=….
 */
export function ConnectFlow({ hasOtherNumbers, publicHttps, reconnect }: ConnectFlowProps) {
  const [step, setStep] = useState<"aviso" | "datos">("aviso");
  const [understood, setUnderstood] = useState(false);
  const [numberKind, setNumberKind] = useState<NumberKind>(reconnect?.isMetaTestNumber ? "meta_test" : "business");

  return (
    <div className="grid gap-8">
      <Stepper steps={STEPPER_STEPS} current={step} />
      {step === "aviso" ? (
        <section aria-labelledby="wa-step-title" className="grid gap-6">
          <header className="grid gap-1">
            <h2 id="wa-step-title" className="text-lg font-semibold">
              Antes de empezar
            </h2>
            <p className="text-sm text-muted-foreground">Lee esto antes de conectar un número a la API oficial de WhatsApp.</p>
          </header>
          <NoticeStep
            numberKind={numberKind}
            onNumberKind={setNumberKind}
            understood={understood}
            onUnderstood={setUnderstood}
            publicHttps={publicHttps}
            onContinue={() => setStep("datos")}
          />
        </section>
      ) : (
        <section aria-labelledby="wa-step-title" className="grid gap-6">
          <header className="grid gap-1">
            <h2 id="wa-step-title" className="text-lg font-semibold">
              Datos del número
            </h2>
            <p className="text-sm text-muted-foreground">
              Los datos de tu app de Meta. Pulsa «Validar con Meta» para comprobarlos antes de conectar el número.
            </p>
          </header>
          <DataStep
            isMetaTestNumber={numberKind === "meta_test"}
            hasOtherNumbers={hasOtherNumbers}
            reconnect={reconnect ? { channelId: reconnect.channelId, name: reconnect.name } : null}
            onBack={() => setStep("aviso")}
          />
        </section>
      )}
    </div>
  );
}
