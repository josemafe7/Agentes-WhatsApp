import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { AUTH_COOKIE_PREFIX, HOME_PATH, loginPathFor, sanitizeNextPath } from "@/lib/auth-paths";
import { getActor } from "@/server/session";
import { AuthCard } from "../_components/auth-card";
import { TWO_FACTOR_EXPIRED_MESSAGE } from "../_lib/messages";
import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = { title: "Verificación en dos pasos" };

/** Cookie Better Auth leaves after a correct password when the account has 2FA (10 minutes). */
const CHALLENGE_COOKIE = `${AUTH_COOKIE_PREFIX}.two_factor`;
const searchParamsSchema = z.object({ next: z.string().optional().catch(undefined) });

type TwoFactorPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function TwoFactorPage({ searchParams }: TwoFactorPageProps) {
  const next = sanitizeNextPath(searchParamsSchema.parse(await searchParams).next);
  if (await getActor()) redirect(next ?? HOME_PATH);

  const cookieStore = await cookies();
  const hasChallenge = cookieStore.has(CHALLENGE_COOKIE) || cookieStore.has(`__Secure-${CHALLENGE_COOKIE}`);
  if (!hasChallenge) {
    return (
      <AuthCard title="Verificación en dos pasos" description={TWO_FACTOR_EXPIRED_MESSAGE}>
        <Button asChild className="w-full">
          <Link href={loginPathFor(next)}>Iniciar sesión</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Verificación en dos pasos" description="Escribe el código de 6 dígitos que te muestra tu app de verificación.">
      <TwoFactorForm next={next ?? undefined} />
    </AuthCard>
  );
}
