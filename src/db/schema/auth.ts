// Better Auth 1.7.5 tables (email + password, twoFactor plugin, rate limit in the database).
// Export keys and property names must match Better Auth's model and field names: it validates them at start-up.
// Differences with `auth generate`: JS defaults instead of unixepoch() SQL defaults, and foreign keys without
// ON DELETE CASCADE (the app deletes children explicitly, docs/conventions.md).
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { bool, id, timestamp, timestamps } from "./columns";

export const user = sqliteTable("user", {
  id: id(),
  name: text("name").notNull(),
  /** Always stored lower-case: Better Auth lower-cases the email on sign-in. */
  email: text("email").notNull().unique(),
  emailVerified: bool("email_verified").notNull().default(false),
  image: text("image"),
  ...timestamps(),
  twoFactorEnabled: bool("two_factor_enabled").default(false),
});

export const session = sqliteTable(
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
);

export const account = sqliteTable(
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
);

export const verification = sqliteTable(
  "verification",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    ...timestamps(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/** TOTP secret and backup codes, encrypted by Better Auth with BETTER_AUTH_SECRET. */
export const twoFactor = sqliteTable(
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
);

/** Better Auth's own limiter for /api/auth/* (rateLimit.storage = "database"). Ours is `rate_limits`. */
export const rateLimit = sqliteTable("rate_limit", {
  id: id(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  /** Plain epoch milliseconds (Better Auth compares numbers), not timestamp_ms. */
  lastRequest: integer("last_request").notNull(),
  ...timestamps(),
});
