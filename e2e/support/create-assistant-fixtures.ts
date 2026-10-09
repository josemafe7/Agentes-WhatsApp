// Adds the «Asistentes» fixtures of the e2e run (e2e/support/assistant-fixtures.ts) to the freshly seeded demo
// database: conversations of the demo admin with the demo's internal agent, written straight to their tables (asking
// them one by one would take minutes: 20 questions a minute at most, [INT-12]). Run by prepare-databases.mjs with
// `tsx --conditions=react-server`, like the other scripts that load server code.
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { agents, assistantChats, assistantMessages, user } from "@/db/schema";
import { DEMO_INTERNAL_AGENT_NAME } from "../../seed/steps/agents";
import { ASSISTANT_HISTORY } from "./assistant-fixtures";
import { DEMO_DATABASE_URL } from "./env";
import { DEMO_USERS } from "./users";

const MINUTE_MS = 60_000;

async function main(): Promise<void> {
  // Never anywhere else: the test database of the run only.
  if (process.env.DATABASE_URL !== DEMO_DATABASE_URL) {
    throw new Error(`Solo se crean en la base de las pruebas (${DEMO_DATABASE_URL}).`);
  }
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.name, DEMO_INTERNAL_AGENT_NAME), eq(agents.audience, "team")));
  if (!agent) throw new Error(`La demo no tiene el agente interno «${DEMO_INTERNAL_AGENT_NAME}».`);
  const [person] = await db.select({ id: user.id }).from(user).where(eq(user.email, DEMO_USERS[ASSISTANT_HISTORY.person].email));
  if (!person) throw new Error("La demo no tiene el usuario de las conversaciones de prueba.");

  const now = Date.now();
  const short = ASSISTANT_HISTORY.conversations - 1;
  // The short ones, a minute apart, the oldest first; the long one is the newest.
  await db.insert(assistantChats).values(
    Array.from({ length: short }, (_, index) => {
      const at = new Date(now - (short - index + 1) * MINUTE_MS);
      return { agentId: agent.id, userId: person.id, title: ASSISTANT_HISTORY.title(index + 1), createdAt: at, updatedAt: at };
    }),
  );
  const startedAt = new Date(now - MINUTE_MS);
  const [long] = await db
    .insert(assistantChats)
    .values({ agentId: agent.id, userId: person.id, title: ASSISTANT_HISTORY.longConversation, createdAt: startedAt, updatedAt: startedAt })
    .returning({ id: assistantChats.id });
  await db.insert(assistantMessages).values(
    Array.from({ length: ASSISTANT_HISTORY.messages }, (_, index) => {
      const at = new Date(startedAt.getTime() + index);
      return { chatId: long.id, role: index % 2 === 0 ? ("user" as const) : ("assistant" as const), content: ASSISTANT_HISTORY.message(index + 1), sources: [], createdAt: at, updatedAt: at };
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.error("No se pudieron crear las conversaciones de las pruebas:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
