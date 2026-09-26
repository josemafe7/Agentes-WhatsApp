// Everything that changes with the database engine or the hosting (docs/conventions.md «Organización»).
// Callers use these interfaces and getters; a Postgres/Supabase implementation plugs in here.
export { getJobQueue, type Job, type JobQueue } from "./job-queue";
export { getRealtime, type PollResult, type Realtime, type RealtimeEvent } from "./realtime";
export { getRateLimiter, type RateLimiter, type RateLimitResult } from "./rate-limiter";
export { generateFileKey, getFileStorage, readAll, safeExtension, type FileStorage, type StoredFile } from "./file-storage";
export { buildFtsQuery, getTextSearch, type TextSearch } from "./text-search";
export { getVectorSearch, type VectorSearch } from "./vector-search";
export type { KbScope, SearchHit, SearchOptions } from "./search-types";
export { pingDatabase } from "./database-health";
