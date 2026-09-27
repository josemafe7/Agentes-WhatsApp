"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { saveWhatsAppSettingsAction } from "./actions";

type SettingKey = "handoffOnSendFailure" | "appLiveConfirmed" | "paymentMethodConfirmed";

type SettingsSwitchesProps = {
  channelId: string;
  initial: Record<SettingKey, boolean>;
  /** Meta's test number needs no payment method ([WA-21]). */
  showPayment: boolean;
};

const SWITCHES: { key: SettingKey; label: string; on: string; off: string }[] = [
  {
    key: "handoffOnSendFailure",
    label: "Traspasar a una persona si un envío falla",
    on: "Si una respuesta de la IA no se puede enviar, la conversación pasa a una persona, con su aviso de traspaso.",
    off: "Si una respuesta de la IA no se puede enviar, queda como fallida y se avisa del error, pero la conversación no pasa a una persona.",
  },
  {
    key: "appLiveConfirmed",
    label: "App de Meta publicada (Live)",
    on: "Has comprobado que la app está publicada: sin eso no llegan mensajes reales.",
    off: "Márcalo cuando la app de Meta esté publicada (Live). La API no deja comprobarlo.",
  },
  {
    key: "paymentMethodConfirmed",
    label: "Método de pago añadido en WhatsApp Manager",
    on: "Has confirmado que la cuenta tiene método de pago.",
    off: "Sin método de pago, Meta deja de entregar los mensajes de servicio cuando se acaban los 1.000 gratis del mes.",
  },
];

/** The number's own switches ([WA-46], [WA-21]): each one is saved as soon as it changes. */
export function SettingsSwitches({ channelId, initial, showPayment }: SettingsSwitchesProps) {
  const [values, setValues] = useState(initial);
  const [pending, startTransition] = useTransition();

  function change(key: SettingKey, checked: boolean) {
    const previous = values[key];
    setValues((current) => ({ ...current, [key]: checked }));
    startTransition(async () => {
      const result = await saveWhatsAppSettingsAction(channelId, { [key]: checked });
      if (result.ok) return;
      setValues((current) => ({ ...current, [key]: previous }));
      toast.error(result.error);
    });
  }

  return (
    <div className="grid gap-4">
      {SWITCHES.filter((item) => showPayment || item.key !== "paymentMethodConfirmed").map((item) => (
        <Field key={item.key} orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={`wa-${item.key}`}>{item.label}</FieldLabel>
            <FieldDescription>{values[item.key] ? item.on : item.off}</FieldDescription>
          </FieldContent>
          <Switch id={`wa-${item.key}`} checked={values[item.key]} disabled={pending} onCheckedChange={(checked) => change(item.key, checked)} />
        </Field>
      ))}
    </div>
  );
}
