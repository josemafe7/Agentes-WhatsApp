import { CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { HOME_PATH, sanitizeNextPath, SETUP_PATH } from "@/lib/auth-paths";
import { getActor, TWO_FACTOR_SETUP_PATH } from "@/server/session";
import { AuthCard } from "../_components/auth-card";
import { LOGIN_NOTICES, type LoginNotice } from "../_lib/messages";
import { hasAnyAccount } from "../_lib/sign-in";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

const noticeKeys = Object.keys(LOGIN_NOTICES) as [LoginNotice, ...LoginNotice[]];
// Anything unexpected in the URL is ignored ([SEG-05]).
const searchParamsSchema = z.object({
  next: z.string().optional().catch(undefined),
  aviso: z.enum(noticeKeys).optional().catch(undefined),
});

type LoginPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParamsSchema.parse(await searchParams);
  const next = sanitizeNextPath(params.next);
  const actor = await getActor();
  if (actor) redirect(actor.twoFactorSetupRequired ? TWO_FACTOR_SETUP_PATH : (next ?? HOME_PATH));
  // An empty installation starts with the setup wizard ([ASI-01]).
  if (!(await hasAnyAccount())) redirect(SETUP_PATH);

  return (
    <AuthCard title="Inicia sesión" description="Entra con tu email y tu contraseña.">
      {params.aviso ? (
        <Alert role="status" className="border-success/30 bg-success-soft">
          <CircleCheck aria-hidden className="text-success" />
          <AlertTitle>{LOGIN_NOTICES[params.aviso]}</AlertTitle>
        </Alert>
      ) : null}
      <LoginForm next={next ?? undefined} />
    </AuthCard>
  );
}
