// Better Auth's HTTP router (/api/auth/*). Only the session check, signing out and the link of the password reset
// email answer here; everything else goes through Server Actions and gets 404 (httpAllowlist in src/server/auth.ts).
// Better Auth's origin checks and database rate limit apply to what stays open.
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";

export const runtime = "nodejs";

export const { GET, POST } = toNextJsHandler(auth);
