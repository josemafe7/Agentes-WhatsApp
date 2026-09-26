// Adds the e2e-only users (e2e/support/users.ts) to the freshly seeded e2e database. Run by
// prepare-databases.mjs with `tsx --conditions=react-server`, like the other scripts that load server code.
import { closeDb } from "@/db";
import { createUserWithPassword } from "@/server/accounts";
import { DEMO_DATABASE_URL } from "./env";
import { E2E_USERS } from "./users";

async function main(): Promise<void> {
  // Never anywhere else: these users have known passwords.
  if (process.env.DATABASE_URL !== DEMO_DATABASE_URL) {
    throw new Error(`Solo se crean en la base de las pruebas (${DEMO_DATABASE_URL}).`);
  }
  for (const account of Object.values(E2E_USERS)) {
    await createUserWithPassword({ ...account, isDemo: true });
  }
}

main()
  .catch((error: unknown) => {
    console.error("No se pudieron crear los usuarios de las pruebas:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
