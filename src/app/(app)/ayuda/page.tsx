import { BookOpen, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requirePageActor } from "@/server/session";
import { groupGuides, HELP_GUIDES, parseGuide, readGuide } from "./_lib/guides";

export const metadata: Metadata = { title: "Ayuda" };

/**
 * Ayuda ([AJU-17]): the guides bundled with the app, for any signed-in role, by group and with where to start first.
 * Each phase adds its own guide.
 */
export default async function HelpPage() {
  await requirePageActor({ next: "/ayuda" });
  const guides = await Promise.all(
    HELP_GUIDES.map(async (guide) => ({ ...guide, title: parseGuide(await readGuide(guide)).title })),
  );

  return (
    <>
      <PageHeader title="Ayuda" description="Guías paso a paso para poner en marcha y usar la app." />
      <div className="grid gap-8">
        {groupGuides(guides).map((group) => (
          <section key={group.key} aria-labelledby={`ayuda-${group.key}`} className="grid gap-3">
            <h2 id={`ayuda-${group.key}`} className="text-base font-semibold">
              {group.title}
            </h2>
            <ul className="divide-y overflow-hidden rounded-xl border">
              {group.guides.map((guide) => (
                <li key={guide.slug}>
                  <Link
                    href={`/ayuda/${guide.slug}`}
                    className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <BookOpen aria-hidden className="size-5" />
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="text-sm font-medium">{guide.title}</span>
                      <span className="text-xs text-muted-foreground">{guide.description}</span>
                    </span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
