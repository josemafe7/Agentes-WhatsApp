import { BookOpen, ExternalLink, Scale } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import packageJson from "../../../../../package.json";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requirePageActor } from "@/server/session";

export const metadata: Metadata = { title: "Acerca de" };

const APP_NAME = "DominIA Agentes";
const LEGAL_LINKS = [
  { href: "/legal/privacidad", label: "Política de privacidad" },
  { href: "/legal/terminos", label: "Términos del servicio" },
  { href: "/legal/eliminacion-datos", label: "Eliminación de datos" },
];

/** Ajustes › Acerca de ([AJU-14]): app version and links to Ayuda. Every role; nothing secret. */
export default async function AboutPage() {
  // Any signed-in role may open it ([PER-03]); the session is still checked on the server.
  await requirePageActor({ next: "/ajustes/acerca" });

  return (
    <div className="space-y-8">
      <PageHeader title="Acerca de" description="Qué versión de la app usas y dónde encontrar ayuda." />

      <section aria-labelledby="version-heading" className="space-y-2">
        <h2 id="version-heading" className="text-lg font-semibold">
          {APP_NAME}
        </h2>
        <dl className="grid max-w-[640px] grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Versión</dt>
          <dd className="font-mono tabular-nums">{packageJson.version}</dd>
        </dl>
        <p className="max-w-[640px] text-sm text-muted-foreground">
          Plataforma de atención al cliente con agentes de IA para WhatsApp, correo y el chat de tu web. Esta instalación es
          solo de tu negocio.
        </p>
      </section>

      <section aria-labelledby="help-heading" className="space-y-3">
        <h2 id="help-heading" className="text-lg font-semibold">
          Ayuda
        </h2>
        <p className="max-w-[640px] text-sm text-muted-foreground">
          Guías paso a paso para conectar WhatsApp y el correo, crear agentes, cargar el conocimiento, configurar la agenda y
          poner en marcha el negocio.
        </p>
        <Button asChild variant="outline">
          <Link href="/ayuda">
            <BookOpen aria-hidden />
            Abrir la Ayuda
          </Link>
        </Button>
      </section>

      <section aria-labelledby="legal-heading" className="space-y-3">
        <h2 id="legal-heading" className="text-lg font-semibold">
          Páginas legales de tu negocio
        </h2>
        <ul className="space-y-1 text-sm">
          {LEGAL_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary-text underline-offset-4 hover:underline"
              >
                {link.label} <ExternalLink aria-hidden className="size-3.5" />
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="licences-heading" className="space-y-3">
        <h2 id="licences-heading" className="flex items-center gap-2 text-lg font-semibold">
          <Scale aria-hidden className="size-5" />
          Licencias
        </h2>
        <p className="max-w-[640px] text-sm text-muted-foreground">
          La app está hecha con software de código abierto, cada pieza con su propia licencia. Las notas de voz se convierten
          con FFmpeg, que se distribuye con la licencia GPL-3.0 o posterior.
        </p>
        <a
          href="https://ffmpeg.org/legal.html"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary-text underline-offset-4 hover:underline"
        >
          Licencia de FFmpeg <ExternalLink aria-hidden className="size-3.5" />
        </a>
      </section>
    </div>
  );
}
