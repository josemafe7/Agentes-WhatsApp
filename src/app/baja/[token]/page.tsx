// Public page of «Darme de baja» ([ENV-11], [PER-09]): the business's name and one button. A link that is not one of
// ours says only that it is not valid. No session; nothing is changed by opening it (only by the button), so a mail
// client that opens links to check them does not unsubscribe anyone.
import type { Metadata } from "next";
import { getPublicBusinessInfo } from "@/data/business";
import { contactOfUnsubscribeToken } from "@/server/campaigns/unsubscribe";
import { UnsubscribeButton } from "./unsubscribe-button";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { name } = await getPublicBusinessInfo();
  return { title: `Darme de baja · ${name}`, robots: { index: false, follow: false } };
}

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [{ name }, contactId] = await Promise.all([getPublicBusinessInfo(), contactOfUnsubscribeToken(token)]);
  return (
    <main id="contenido" className="mx-auto grid min-h-svh max-w-md content-center gap-4 bg-background p-6">
      <h1 className="text-xl font-semibold">{name}</h1>
      {contactId ? (
        <>
          <p className="text-base">¿No quieres recibir más novedades ni publicidad de {name} por correo?</p>
          <UnsubscribeButton token={token} businessName={name} />
        </>
      ) : (
        <p className="text-base">Este enlace no es válido. Si quieres dejar de recibir sus correos, contesta a cualquiera de ellos y pídelo.</p>
      )}
    </main>
  );
}
