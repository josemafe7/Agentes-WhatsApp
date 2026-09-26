// Public page ([CUM-08], [PER-09]): «Eliminación de datos» with the text of Ajustes › Privacidad y legal, or the default.
import type { Metadata } from "next";
import { getPublicBusinessInfo } from "@/data/business";
import { LegalDocument, legalPageTitle } from "../_components/legal-document";

// Read from the database on every request (never frozen at build time); no session needed.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { name } = await getPublicBusinessInfo();
  return { title: legalPageTitle("dataDeletion", name) };
}

export default async function DataDeletionPage() {
  const info = await getPublicBusinessInfo();
  return <LegalDocument kind="dataDeletion" info={info} />;
}
