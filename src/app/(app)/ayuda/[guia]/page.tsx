import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarkdownText } from "@/components/markdown-text";
import { PageHeader } from "@/components/page-header";
import { requirePageActor } from "@/server/session";
import { findGuide, parseGuide, readGuide } from "../_lib/guides";

type GuidePageProps = { params: Promise<{ guia: string }> };

export async function generateMetadata({ params }: GuidePageProps): Promise<Metadata> {
  const guide = findGuide((await params).guia);
  return { title: guide ? parseGuide(await readGuide(guide)).title : "Ayuda" };
}

/**
 * One guide of Ayuda ([AJU-17]) with the index of its sections; «Ver la guía» of the channel wizards links here
 * with the anchor of a section. Only the guides of the list exist: any other address is «not found».
 */
export default async function GuidePage({ params }: GuidePageProps) {
  const { guia } = await params;
  await requirePageActor({ next: `/ayuda/${encodeURIComponent(guia)}` });
  const guide = findGuide(guia);
  if (!guide) notFound();
  const { title, blocks, sections } = parseGuide(await readGuide(guide));

  return (
    <>
      <PageHeader title={title} breadcrumbs={[{ label: "Ayuda", href: "/ayuda" }, { label: title }]} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <article className="max-w-[720px] text-sm leading-relaxed [&_h2]:scroll-mt-20 [&_h3]:scroll-mt-20">
          <MarkdownText blocks={blocks} anchors />
        </article>
        <nav aria-label="En esta guía" className="order-first lg:order-last">
          <p className="text-sm font-medium">En esta guía</p>
          <ul className="mt-2 space-y-1 text-sm">
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}
