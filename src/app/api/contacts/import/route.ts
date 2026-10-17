// «Importar contactos» ([CTO-11]): every check is in src/app/(app)/contactos/_lib/import-upload.ts (tested there).
import { handleContactImport } from "@/app/(app)/contactos/_lib/import-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function POST(request: Request): Promise<Response> {
  return handleContactImport(request);
}
