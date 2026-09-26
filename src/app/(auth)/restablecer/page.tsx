import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { RECOVER_PASSWORD_PATH } from "@/lib/auth-paths";
import { AuthCard } from "../_components/auth-card";
import { RESET_LINK_INVALID_MESSAGE } from "../_lib/messages";
import { oneTimeTokenField } from "../_lib/schemas";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Nueva contraseña" };

// Better Auth sends here with ?token=… when the link is valid, or with ?error=INVALID_TOKEN ([USU-10]).
const searchParamsSchema = z.object({
  token: oneTimeTokenField.optional().catch(undefined),
  error: z.string().optional().catch(undefined),
});

type ResetPasswordPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const { token, error } = searchParamsSchema.parse(await searchParams);

  if (!token || error) {
    return (
      <AuthCard title="Este enlace ya no es válido" description={RESET_LINK_INVALID_MESSAGE}>
        <Button asChild className="w-full">
          <Link href={RECOVER_PASSWORD_PATH}>Pedir otro enlace</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Crea una contraseña nueva" description="Al guardarla se cerrará tu sesión en todos los dispositivos.">
      <ResetForm token={token} />
    </AuthCard>
  );
}
