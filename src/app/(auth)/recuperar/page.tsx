import type { Metadata } from "next";
import { PASSWORD_RESET_TTL_SECONDS } from "@/server/email-templates";
import { AuthCard } from "../_components/auth-card";
import { RecoverForm } from "./recover-form";

export const metadata: Metadata = { title: "Recuperar la contraseña" };

const MINUTES_PER_HOUR = 60;

/** «1 hora», «2 horas» or «30 minutos». */
function durationLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes % MINUTES_PER_HOUR !== 0) return `${minutes} minutos`;
  const hours = minutes / MINUTES_PER_HOUR;
  return hours === 1 ? "1 hora" : `${hours} horas`;
}

export default function RecoverPasswordPage() {
  return (
    <AuthCard
      title="Recupera tu contraseña"
      description={`Escribe tu email y te enviaremos un enlace para crear una nueva. El enlace caduca en ${durationLabel(PASSWORD_RESET_TTL_SECONDS)}.`}
    >
      <RecoverForm />
    </AuthCard>
  );
}
