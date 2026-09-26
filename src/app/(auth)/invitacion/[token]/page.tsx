import type { Metadata } from "next";
import Link from "next/link";
import { DEFAULT_BUSINESS_NAME } from "@/components/app-shell/home-destination";
import { getInvitationForToken } from "@/data/invitations";
import { loadBusinessSettings } from "@/data/settings";
import { LOGIN_PATH } from "@/lib/auth-paths";
import { ROLE_LABELS } from "@/lib/permissions";
import { AuthCard } from "../../_components/auth-card";
import { oneTimeTokenField } from "../../_lib/schemas";
import { InvitationForm } from "./invitation-form";

export const metadata: Metadata = { title: "Invitación", referrer: "no-referrer" };

type InvalidReason = "not_found" | "expired" | "used" | "revoked";

// [USU-08]: the link says why it no longer works; none of these creates an account.
const INVALID_REASONS: Record<InvalidReason, string> = {
  not_found: "El enlace no es correcto o se ha sustituido por otro más reciente.",
  expired: "Las invitaciones caducan a los 7 días y esta ya ha caducado.",
  used: "Esta invitación ya se ha usado. Si la aceptaste tú, entra con tu email y tu contraseña.",
  revoked: "La persona que te invitó la ha anulado.",
};

type InvitationPageProps = { params: Promise<{ token: string }> };

export default async function InvitationPage({ params }: InvitationPageProps) {
  const token = oneTimeTokenField.safeParse((await params).token);
  const invitation = token.success
    ? await getInvitationForToken(token.data)
    : ({ status: "not_found", businessName: (await loadBusinessSettings()).name } as const);
  const businessName = invitation.businessName.trim() || DEFAULT_BUSINESS_NAME;

  if (invitation.status !== "valid" || !token.success) {
    return (
      <AuthCard
        title="Esta invitación ya no es válida"
        description={`${INVALID_REASONS[invitation.status === "valid" ? "not_found" : invitation.status]} Pide una nueva al propietario.`}
      >
        <Link href={LOGIN_PATH} className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
          ¿Ya tienes cuenta? Inicia sesión
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={`Únete a ${businessName}`}
      description={`Te han invitado con el rol ${ROLE_LABELS[invitation.role]}. Elige tu nombre y una contraseña para entrar.`}
    >
      <InvitationForm token={token.data} email={invitation.email} />
    </AuthCard>
  );
}
