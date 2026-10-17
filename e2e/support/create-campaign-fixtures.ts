// Adds the envíos fixture of the e2e run (e2e/support/campaign-fixtures.ts) to the freshly seeded demo database. Run by
// prepare-databases.mjs after create-e2e-users.ts, with `tsx --conditions=react-server`, like the other scripts that load
// server code: a customer with «Novedades y publicidad» who got an envío by email five days ago, with its baja link.
import { closeDb, db } from "@/db";
import { campaignRecipients, campaigns, consents, contacts } from "@/db/schema";
import { UNSUBSCRIBE_FIXTURE } from "./campaign-fixtures";
import { DEMO_DATABASE_URL } from "./env";

const DAY_MS = 86_400_000;

async function main(): Promise<void> {
  // Never anywhere else: the test database of the run only.
  if (process.env.DATABASE_URL !== DEMO_DATABASE_URL) {
    throw new Error(`Solo se crean en la base de las pruebas (${DEMO_DATABASE_URL}).`);
  }
  const sentAt = new Date(Date.now() - 5 * DAY_MS);
  const [contact] = await db.insert(contacts).values({ name: UNSUBSCRIBE_FIXTURE.contactName, email: UNSUBSCRIBE_FIXTURE.email, createdAt: sentAt, updatedAt: sentAt }).returning({ id: contacts.id });
  await db.insert(consents).values({ contactId: contact.id, type: "marketing_granted", source: "person", method: "written", actorType: "user", createdAt: sentAt, updatedAt: sentAt });
  const [campaign] = await db
    .insert(campaigns)
    .values({
      name: UNSUBSCRIBE_FIXTURE.campaignName,
      status: "finished",
      scheduledAt: sentAt,
      startedAt: sentAt,
      finishedAt: sentAt,
      routes: ["email"],
      email: { subject: "Novedades", body: "Hola {nombre}" },
      recipientCount: 1,
      createdAt: sentAt,
      updatedAt: sentAt,
    })
    .returning({ id: campaigns.id });
  await db.insert(campaignRecipients).values({
    campaignId: campaign.id,
    contactId: contact.id,
    status: "sent",
    channel: "email",
    sentAt,
    unsubscribeToken: UNSUBSCRIBE_FIXTURE.token,
    attempts: [{ channel: "email", outcome: "sent", reason: null, at: sentAt.toISOString() }],
    createdAt: sentAt,
    updatedAt: sentAt,
  });
}

main()
  .catch((error: unknown) => {
    console.error("No se pudieron crear los datos de envíos de las pruebas:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
