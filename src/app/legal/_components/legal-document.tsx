import type { PublicBusinessInfo } from "@/data/business";
import { fileUrl } from "@/data/business";
import { defaultLegalTexts, type LegalTextKind } from "@/data/legal-texts";
import { primaryStyleSheet } from "@/lib/color";
import { formatDateTime } from "@/lib/format";
import { MarkdownText } from "@/components/markdown-text";

/** The three public legal pages ([CUM-08]); Meta asks for their addresses to publish the app ([WA-21]). */
export const LEGAL_PAGES: Record<LegalTextKind, { href: string; title: string }> = {
  privacy: { href: "/legal/privacidad", title: "Política de privacidad" },
  terms: { href: "/legal/terminos", title: "Términos del servicio" },
  dataDeletion: { href: "/legal/eliminacion-datos", title: "Eliminación de datos" },
};

const FALLBACK_NAME = "Información legal";

/** Page title with the business name, without the product suffix: these pages belong to the business. */
export function legalPageTitle(kind: LegalTextKind, businessName: string) {
  const name = businessName.trim();
  return { absolute: name ? `${LEGAL_PAGES[kind].title} · ${name}` : LEGAL_PAGES[kind].title };
}

function configuredText(kind: LegalTextKind, info: PublicBusinessInfo): string | null {
  if (kind === "privacy") return info.privacyText;
  if (kind === "terms") return info.termsText;
  return info.dataDeletionText;
}

function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "");
  return letters.join("") || "·";
}

/** Public legal page: business header, links between the three pages, the responsible party and the text. */
export function LegalDocument({ kind, info }: { kind: LegalTextKind; info: PublicBusinessInfo }) {
  const name = info.name.trim();
  const text = configuredText(kind, info) ?? defaultLegalTexts(info)[kind];
  const updated = formatDateTime(info.updatedAt, info.timezone, { pattern: "d 'de' MMMM 'de' yyyy" });
  const contact = [info.address, info.contactEmail, info.contactPhone, info.website].filter((value): value is string => Boolean(value));

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Business colour for links and focus; the value is validated and the CSS is computed, never user text. */}
      <style>{primaryStyleSheet(info.color)}</style>
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 md:px-6">
          {info.logoFileKey ? (
            // Served by /api/files (public only for the current logo); next/image would proxy it for nothing.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(info.logoFileKey)} alt="" className="size-10 rounded-lg object-contain" />
          ) : (
            <span aria-hidden className="flex size-10 items-center justify-center rounded-lg bg-muted text-sm font-semibold">
              {initials(name)}
            </span>
          )}
          <span className="text-base font-semibold">{name || FALLBACK_NAME}</span>
        </div>
        <nav aria-label="Páginas legales" className="mx-auto max-w-3xl px-4 pb-3 md:px-6">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {(Object.keys(LEGAL_PAGES) as LegalTextKind[]).map((page) => (
              <li key={page}>
                <a
                  href={LEGAL_PAGES[page].href}
                  aria-current={page === kind ? "page" : undefined}
                  className={page === kind ? "font-medium text-foreground" : "text-primary-text underline-offset-4 hover:underline"}
                >
                  {LEGAL_PAGES[page].title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 md:px-6">
        <article className="max-w-prose text-sm leading-6 md:text-base md:leading-7">
          <h1 className="text-2xl font-semibold tracking-tight">{LEGAL_PAGES[kind].title}</h1>
          {updated ? <p className="mt-2 text-xs text-muted-foreground">Última actualización: {updated}</p> : null}
          {name ? (
            <p className="mt-6 rounded-lg bg-muted px-4 py-3 text-sm">
              <span className="font-medium">Responsable:</span> {name}
              {contact.length > 0 ? ` · ${contact.join(" · ")}` : null}
            </p>
          ) : null}
          <MarkdownText text={text} />
        </article>
      </main>

      <footer className="border-t">
        <p className="mx-auto max-w-3xl px-4 py-6 text-xs text-muted-foreground md:px-6">
          {name || FALLBACK_NAME}
        </p>
      </footer>
    </div>
  );
}
