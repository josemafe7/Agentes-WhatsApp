// Upload of a file to a knowledge base ([CON-04]): the raw file as the body, its name in the x-file-name header.
// Under /api/ because the proxy would cut bodies over 10 MB and Server Actions take 4 MB; every check is in
// src/app/(app)/conocimiento/_lib/upload.ts (tested there).
import { handleKnowledgeUpload } from "@/app/(app)/conocimiento/_lib/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Same as KNOWLEDGE_MAX_DURATION_SEC: the processing that starts after answering runs within this time.
export const maxDuration = 60;

export function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleKnowledgeUpload(request, context.params);
}
