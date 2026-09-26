// Public health check ([ARR-21], [PER-09]): is the app up and does the database answer. No private data.
import packageJson from "../../../../package.json";
import { pingDatabase } from "@/server/adapters/database-health";
import { safeErrorMessage } from "@/server/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { version } = packageJson;

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    const latencyMs = await pingDatabase();
    return Response.json({ status: "ok", database: "ok", databaseLatencyMs: latencyMs, version }, { headers });
  } catch (error) {
    console.error(`[health] La base de datos no responde: ${safeErrorMessage(error)}`);
    return Response.json({ status: "error", database: "error", version }, { status: 503, headers });
  }
}
