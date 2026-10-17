import { Check, ChevronRight, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CHANNEL_IDENTITY } from "@/components/channels/channel-identity";
import { WhatsAppLogo } from "@/components/channels/whatsapp-logo";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ChannelType } from "@/lib/enums";
import { can, PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { WHATSAPP_VIA_LABELS, type WhatsAppVia } from "@/lib/whatsapp-via";
import { requirePageActor } from "@/server/session";

export const metadata: Metadata = { title: "Añadir canal" };

type WhatsAppOption = {
  via: WhatsAppVia;
  href: string;
  summary: string;
  badge: { label: string; tone: "recommended" | "warning" } | null;
  /** What tells this way apart, in a few words: `good` false = a limit to know before choosing. */
  points: { good: boolean; text: string }[];
};

// The three ways of connecting a WhatsApp number ([WA-53], docs/decisions/0026). Each opens its own wizard.
const WHATSAPP_OPTIONS: WhatsAppOption[] = [
  {
    via: "meta",
    href: "/canales/nuevo/whatsapp",
    summary: "La conexión directa con Meta, con la app de Meta de tu negocio.",
    badge: { label: "Recomendada", tone: "recommended" },
    points: [
      { good: true, text: "Oficial y sin intermediarios." },
      { good: true, text: "Plantillas y avisos pasadas las 24 horas." },
      { good: false, text: "El número deja de funcionar en la app del móvil." },
      { good: false, text: "La que más pasos tiene: portfolio, app y token de Meta." },
    ],
  },
  {
    via: "ycloud",
    href: "/canales/nuevo/whatsapp-ycloud",
    summary: "La API oficial a través de YCloud, un partner de Meta.",
    badge: null,
    points: [
      { good: true, text: "Oficial, con plantillas y avisos pasadas las 24 horas." },
      { good: true, text: "El número sigue funcionando en la app WhatsApp Business del móvil." },
      { good: true, text: "Fácil: das de alta el número en YCloud y pegas su clave." },
      { good: false, text: "Necesitas una cuenta de YCloud con saldo." },
    ],
  },
  {
    via: "qr",
    href: "/canales/nuevo/whatsapp-qr",
    summary: "Escaneas un código con el móvil, como WhatsApp Web.",
    badge: { label: "No oficial", tone: "warning" },
    points: [
      { good: true, text: "Lista en un minuto, sin cuentas ni pagos." },
      { good: true, text: "El número sigue funcionando en tu móvil." },
      { good: false, text: "Va contra las condiciones de WhatsApp: pueden bloquear el número." },
      { good: false, text: "Sin plantillas, y la app tiene que estar siempre encendida (no vale Vercel)." },
    ],
  },
];

const COMPARISON: { label: string; values: Record<WhatsAppVia, string> }[] = [
  { label: "¿Es la API oficial?", values: { meta: "Sí", ycloud: "Sí (partner de Meta)", qr: "No" } },
  { label: "El número en el móvil", values: { meta: "Deja de funcionar en la app", ycloud: "Sigue en WhatsApp Business", qr: "Sigue igual" } },
  { label: "Qué necesitas", values: { meta: "Portfolio, app y token de Meta", ycloud: "Cuenta de YCloud y su clave", qr: "Solo el móvil" } },
  { label: "Lo que cuesta", values: { meta: "Meta cobra por mensaje", ycloud: "Por mensaje, del saldo de YCloud", qr: "Nada" } },
  { label: "Plantillas y ventana de 24 h", values: { meta: "Sí", ycloud: "Sí", qr: "No hay" } },
  { label: "Riesgo de bloqueo", values: { meta: "El normal de WhatsApp", ycloud: "El normal de WhatsApp", qr: "Alto: no es oficial" } },
  { label: "Dónde funciona", values: { meta: "En cualquier sitio", ycloud: "En cualquier sitio", qr: "Tu ordenador o un servidor propio" } },
];

type ChannelOption = { type: ChannelType; title: string; description: string; href: string };

// Each type opens its own wizard (docs/pantallas.md «Añadir canal»).
const OTHER_OPTIONS: ChannelOption[] = [
  {
    type: "webchat",
    title: "Chat web",
    description: "Un chat para tu web: eliges su aspecto y pegas una línea de código en tu página.",
    href: "/canales/nuevo/web",
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
    description: "Un bot de Telegram del negocio: lo creas en un minuto, pegas su token y la app lo configura sola.",
    href: "/canales/nuevo/telegram",
  },
  {
    type: "instagram",
    title: "Instagram",
    description: "Los mensajes directos de la cuenta profesional del negocio, con tu propia app de Meta: pegas su token y su clave, y respondes con la IA y desde la bandeja.",
    href: "/canales/nuevo/instagram",
  },
];

const CARD = "relative flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-accent";

/**
 * Añadir canal ([CAN-02], [WA-53]): WhatsApp first, with its three ways side by side and what tells them apart; then
 * the other channels. Each card leads to its wizard. Owner and admin ([PER-04]).
 */
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
      <div className="grid max-w-5xl gap-10">
        <section aria-labelledby="add-whatsapp" className="grid gap-4">
          <div className="grid gap-1">
            <h2 id="add-whatsapp" className="text-lg font-semibold">
              WhatsApp
            </h2>
            <p className="text-sm text-muted-foreground">Hay tres formas de conectar un número. Elige la que mejor te encaje: un mismo número solo puede estar conectado por una.</p>
          </div>
          <ul className="grid gap-4 lg:grid-cols-3">
            {WHATSAPP_OPTIONS.map((option) => (
              <li key={option.via} className={CARD}>
                <div className="flex items-start gap-3">
                  <WhatsAppLogo />
                  <div className="grid min-w-0 flex-1 gap-1">
                    <h3 className="text-base font-semibold">
                      {/* The whole card is the link. */}
                      <Link href={option.href} className="outline-none after:absolute after:inset-0 after:rounded-xl">
                        <span className="sr-only">WhatsApp: </span>
                        {WHATSAPP_VIA_LABELS[option.via]}
                      </Link>
                    </h3>
                    {option.badge ? (
                      <Badge variant="outline" className={cn("h-[22px] w-fit border-transparent", option.badge.tone === "recommended" ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
                        {option.badge.label}
                      </Badge>
                    ) : null}
                  </div>
                  <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">{option.summary}</p>
                <ul className="grid gap-1.5 text-sm">
                  {option.points.map((point) => (
                    <li key={point.text} className="flex items-start gap-2">
                      {point.good ? <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" /> : <X aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />}
                      <span>
                        <span className="sr-only">{point.good ? "A favor: " : "A tener en cuenta: "}</span>
                        {point.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <details className="rounded-xl border">
            <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">Comparar las tres formas</summary>
            <div className="overflow-x-auto border-t">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col" className="min-w-40">
                      <span className="sr-only">Qué se compara</span>
                    </TableHead>
                    {WHATSAPP_OPTIONS.map((option) => (
                      <TableHead key={option.via} scope="col" className="min-w-44">
                        {WHATSAPP_VIA_LABELS[option.via]}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {COMPARISON.map((row) => (
                    <TableRow key={row.label}>
                      <TableHead scope="row" className="font-medium text-foreground">
                        {row.label}
                      </TableHead>
                      {WHATSAPP_OPTIONS.map((option) => (
                        <TableCell key={option.via} className="whitespace-normal">
                          {row.values[option.via]}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        </section>

        <section aria-labelledby="add-others" className="grid gap-4">
          <h2 id="add-others" className="text-lg font-semibold">
            Otros canales
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {OTHER_OPTIONS.map((option) => {
              const identity = CHANNEL_IDENTITY[option.type];
              return (
                <li key={option.type} className={CARD}>
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <identity.icon aria-hidden className={cn("size-5", identity.iconClassName)} />
                    </span>
                    <h3 className="text-base font-semibold">
                      {/* The whole card is the link. */}
                      <Link href={option.href} className="outline-none after:absolute after:inset-0 after:rounded-xl">
                        {option.title}
                      </Link>
                    </h3>
                    <ChevronRight aria-hidden className="ml-auto size-4 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">{option.description}</p>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}
