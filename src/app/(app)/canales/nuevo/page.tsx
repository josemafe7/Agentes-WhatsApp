import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CHANNEL_IDENTITY } from "@/components/channels/channel-identity";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import type { ChannelType } from "@/lib/enums";
import { can, PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { requirePageActor } from "@/server/session";

export const metadata: Metadata = { title: "Añadir canal" };

type ChannelOption = {
  type: ChannelType;
  title: string;
  description: string;
  /** Its wizard; none while it is not available. */
  href: string | null;
};

// Each type opens its own wizard (docs/pantallas.md «Añadir canal»). Telegram comes after the first version.
const OPTIONS: ChannelOption[] = [
  {
    type: "webchat",
    title: "Chat web",
    description: "Un chat para tu web: eliges su aspecto y pegas una línea de código en tu página.",
    href: "/canales/nuevo/web",
  },
  {
    type: "whatsapp",
    title: "WhatsApp",
    description: "El número de tu negocio con la API oficial de Meta, paso a paso.",
    href: "/canales/nuevo/whatsapp",
  },
  {
    type: "email_gmail",
    title: "Correo",
    description: "Gmail, Outlook o cualquier servidor de correo (IMAP y SMTP).",
    href: "/canales/nuevo/correo",
  },
  {
    type: "telegram",
    title: "Telegram",
    description: "Un bot de Telegram que responde con tus agentes.",
    href: null,
  },
];

/** Añadir canal: one card per type, each leading to its wizard ([CAN-02]). Owner and admin ([PER-04]). */
export default async function NewChannelPage() {
  const actor = await requirePageActor({ next: "/canales/nuevo" });
  if (!can(actor, PERMISSIONS.channels.manage)) return <NoPermission description={noPermissionDescription(actor.role)} />;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Canales", href: "/canales" }, { label: "Añadir canal" }]}
        title="Añadir canal"
        description="Elige por dónde te escriben tus clientes. Puedes tener varios canales de cada tipo."
      />
      <ul className="grid max-w-3xl gap-4 sm:grid-cols-2">
        {OPTIONS.map((option) => {
          const identity = CHANNEL_IDENTITY[option.type];
          return (
            <li
              key={option.type}
              className={cn(
                "relative flex flex-col gap-3 rounded-xl border bg-card p-4",
                option.href && "transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-accent",
              )}
            >
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <identity.icon aria-hidden className={cn("size-5", identity.iconClassName)} />
                </span>
                <h2 className="text-base font-semibold">
                  {option.href ? (
                    // The whole card is the link.
                    <Link href={option.href} className="outline-none after:absolute after:inset-0 after:rounded-xl">
                      {option.title}
                    </Link>
                  ) : (
                    option.title
                  )}
                </h2>
                {option.href ? (
                  <ChevronRight aria-hidden className="ml-auto size-4 text-muted-foreground" />
                ) : (
                  <Badge variant="secondary" className="ml-auto">
                    Próximamente
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{option.description}</p>
            </li>
          );
        })}
      </ul>
    </>
  );
}
