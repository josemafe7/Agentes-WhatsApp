// Better Auth 1.7.5 tables (email + password, twoFactor plugin, rate limit in the database).
// Export keys and property names must match Better Auth's model and field names: it validates them at start-up.
// Differences with `auth generate`: ids and timestamps set in JS (with provider "pg" and generateId "uuid" Better
// Auth leaves the id to the database layer: our $defaultFn), and foreign keys without ON DELETE CASCADE (the app
// deletes children explicitly, docs/conventions.md). Row Level Security on, without policies, like every table.
import { bigint, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { bool, id, timestamp, timestamps } from "./columns";

export const user = pgTable("user", {
  id: id(),
  name: text("name").notNull(),
  /** Always stored lower-case: Better Auth lower-cases the email on sign-in. */
  email: text("email").notNull().unique(),
  emailVerified: bool("email_verified").notNull().default(false),
  image: text("image"),
  ...timestamps(),
  twoFactorEnabled: bool("two_factor_enabled").default(false),
}).enableRLS();

export const session = pgTable(
  "session",
  {
    id: id(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    ...timestamps(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
).enableRLS();

export const account = pgTable(
  "account",
  {
    id: id(),
    /** For email + password accounts: equal to userId, with providerId "credential". */
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    /** scrypt hash "salt:key" (better-auth/crypto hashPassword). Never the password. */
    password: text("password"),
    ...timestamps(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
).enableRLS();

export const verification = pgTable(
  "verification",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    ...timestamps(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
).enableRLS();

/** TOTP secret and backup codes, encrypted by Better Auth with BETTER_AUTH_SECRET. */
export const twoFactor = pgTable(
  "two_factor",
  {
    id: id(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    verified: bool("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: timestamp("locked_until"),
    ...timestamps(),
  },
  (t) => [index("two_factor_secret_idx").on(t.secret), index("two_factor_user_id_idx").on(t.userId)],
).enableRLS();

/** Better Auth's own limiter for /api/auth/* (rateLimit.storage = "database"). Ours is `rate_limits`. */
export const rateLimit = pgTable("rate_limit", {
  id: id(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  /** Plain epoch milliseconds (Better Auth compares numbers), not a timestamp: bigint read back as a number. */
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  ...timestamps(),
}).enableRLS();
