// /widget-demo ([WEB-12], [PER-09]): a sample page of the business with its web chat working, to try it without a
// website of one's own. Public, like the chat itself; the app's own address is always an allowed domain ([WEB-10]).
import { Info, MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DEFAULT_BUSINESS_NAME, businessInitials } from "@/components/app-shell/home-destination";
import { isDemoMode } from "@/components/banners/banner-state";
import { DemoBanner } from "@/components/banners/demo-banner";
import { CopyButton } from "@/components/copy-button";
import { EmptyState } from "@/components/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fileUrl, getPublicBusinessInfo } from "@/data/business";
import { primaryStyleSheet } from "@/lib/color";
import { idSchema } from "@/lib/validation";
import { getAppUrl } from "@/server/app-url";
import { listWidgetDemoChannels, type WidgetDemoChannel } from "@/server/channels/webchat/config";
import { WidgetEmbed } from "@/components/webchat/widget-embed";

// Read from the database on every request; no session needed.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Prueba del chat web",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TRY_STEPS = [
  "Pulsa el botón redondo del chat, en una esquina de abajo, y escribe una pregunta sobre el negocio: horarios, precios o servicios.",
  "Responde el agente activo del canal. La conversación aparece en la Bandeja como cualquier otra.",
  "Pide «hablar con una persona»: la conversación pasa al equipo, que recibe el aviso.",
  "Si alguien del equipo contesta desde la Bandeja, la IA se pausa en esa conversación.",
  "Cambia el agente activo del canal en Canales y vuelve a escribir: responde el nuevo.",
];

/** The chat asked for in ?canal=, else the first one that is on, else the first one. */
function pickChat(chats: WidgetDemoChannel[], requested: unknown): WidgetDemoChannel | null {
  const id = idSchema.safeParse(requested);
  return (id.success ? chats.find((chat) => chat.id === id.data) : undefined) ?? chats.find((chat) => chat.available) ?? chats[0] ?? null;
}

export default async function WidgetDemoPage({ searchParams }: Props) {
  const params = await searchParams;
  const [info, chats] = await Promise.all([getPublicBusinessInfo(), listWidgetDemoChannels()]);
  const selected = pickChat(chats, params.canal);
  const name = info.name.trim() || DEFAULT_BUSINESS_NAME;
  const snippet = selected ? `<script src="${getAppUrl()}/widget.js" data-channel="${selected.id}" async></script>` : "";
  const contact = [info.address, info.contactPhone, info.contactEmail, info.website].filter((value): value is string => Boolean(value));

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* Business colour: CSS computed from the validated #rrggbb (src/lib/color.ts), never from free text. */}
      <style>{primaryStyleSheet(info.color)}</style>
      {isDemoMode() ? <DemoBanner /> : null}

      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 md:px-6">
          {info.logoFileKey ? (
            // Served by /api/files (public only for the current logo); next/image would proxy it for nothing.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(info.logoFileKey)} alt="" className="size-10 rounded-lg object-contain" />
          ) : (
            <span aria-hidden className="flex size-10 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
              {businessInitials(name)}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-base font-semibold">{name}</span>
          <Badge variant="secondary">Página de prueba</Badge>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-8 md:px-6 md:py-12">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Bienvenido a {name}</h1>
          <p className="max-w-prose text-muted-foreground">
            Esta página hace de web de ejemplo del negocio: el chat web funciona aquí igual que en tu propia web cuando pegas su código.
          </p>
        </section>

        {selected ? (
          <>
            <Alert role="note" className="border-info/30 bg-info-soft">
              <Info aria-hidden />
              <AlertTitle>Página de prueba del chat web</AlertTitle>
              <AlertDescription>
                Lo que escribas llega de verdad a la Bandeja, en el canal «{selected.name}», y lo contesta su agente activo.
              </AlertDescription>
            </Alert>

            {chats.length > 1 ? (
              <nav aria-label="Chats web" className="space-y-2">
                <h2 className="text-sm font-medium">Chat web que estás probando</h2>
                <ul className="flex flex-wrap gap-2">
                  {chats.map((chat) => (
                    <li key={chat.id}>
                      <Button asChild variant={chat.id === selected.id ? "default" : "outline"} size="sm">
                        {/* A full page load, so each chat starts clean. */}
                        <a href={`/widget-demo?canal=${chat.id}`} aria-current={chat.id === selected.id ? "page" : undefined}>
                          {chat.name}
                          {chat.available ? null : " · desactivado"}
                        </a>
                      </Button>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}

            {selected.available ? null : (
              <p className="rounded-lg bg-warning-soft px-4 py-3 text-sm">
                Este chat web está desactivado: el chat dirá que no está disponible. Actívalo en Canales para probarlo.
              </p>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Qué puedes probar</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="list-decimal space-y-2 pl-5 text-sm leading-6">
                  {TRY_STEPS.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Código para tu web</CardTitle>
                <CardDescription>
                  Pégalo antes de &lt;/body&gt; en tu web y añade su dominio a los dominios permitidos de este chat en Canales.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-start gap-2 rounded-lg bg-muted p-3">
                  <code className="min-w-0 flex-1 font-mono text-xs leading-5 break-all">{snippet}</code>
                  <CopyButton value={snippet} />
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <div className="rounded-xl border">
            <EmptyState
              icon={MessagesSquare}
              title="No hay ningún chat web"
              description="Crea uno en Canales."
              action={
                <Button asChild variant="outline">
                  <Link href="/canales">Ir a Canales</Link>
                </Button>
              }
            />
          </div>
        )}
      </main>

      <footer className="border-t">
        <div className="mx-auto max-w-3xl space-y-1 px-4 py-6 text-xs text-muted-foreground md:px-6">
          <p className="font-medium text-foreground">{name}</p>
          {contact.length > 0 ? <p>{contact.join(" · ")}</p> : null}
          <p>
            <a href="/legal/privacidad" className="text-primary-text underline-offset-4 hover:underline">
              Política de privacidad
            </a>
          </p>
        </div>
      </footer>

      {selected ? <WidgetEmbed channelId={selected.id} /> : null}
    </div>
  );
}
