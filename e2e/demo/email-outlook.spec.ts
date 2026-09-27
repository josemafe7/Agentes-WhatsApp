// Outlook / Microsoft 365 as a business connects and uses it ([COR-07], [COR-08], [COR-14], [COR-15], [COR-18]) against
// the simulated Microsoft sign-in and Graph (e2e/mocks/routes/microsoft.mjs): the business's own Entra app, an email that
// gets an AI draft (Outlook's createReply draft) and approving it, which sends that draft: createReply → PATCH → send with
// immutable ids. Its own mailbox, app and customer; the mailbox is left disabled.
import { createNamedAgent } from "../support/agents";
import { authStatePath } from "../support/app";
import { chatRequestsFor, untilWithQueue } from "../support/engine";
import { aiDrafts, approveDraft, connectOutlookMailbox, MICROSOFT_REDIRECT_URI, openEmailConversation, readMailboxNow, threadSubject } from "../support/email";
import { buildRawEmail, customerFor, entraAppFor, mailboxAddressFor, messageIdFor, outlook } from "../support/email-mailboxes";
import { conversationPath } from "../support/inbox";
import type { MockClient, MockRecordedRequest } from "../support/mock-client";
import { uniqueMessage, uniqueName } from "../support/names";
import { expect, test } from "../support/test";
import { disableChannelQuietly } from "../support/whatsapp";

test.use({ storageState: authStatePath("owner") });

const GRAPH_SCOPES = ["https://graph.microsoft.com/User.Read", "https://graph.microsoft.com/Mail.ReadWrite", "https://graph.microsoft.com/Mail.Send"];
const IMMUTABLE_IDS = 'IdType="ImmutableId"';

type GraphCall = MockRecordedRequest & { segments: string[] };

/** What the app asked Microsoft Graph, in order, with the path decoded («/v1.0/me/messages/{id}/send» → segments). */
async function graphCalls(mock: MockClient): Promise<GraphCall[]> {
  const calls = await mock.requests({ service: "ms-graph" });
  return calls.map((call) => ({ ...call, segments: call.path.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment)) }));
}

const onMessage = (call: GraphCall, method: string, id: string, action?: string) =>
  call.method === method && call.segments[0] === "v1.0" && call.segments[2] === "messages" && call.segments[3] === id && call.segments[4] === action;

test("[COR-07][COR-08][COR-14][COR-15][COR-18] Outlook connects with the business's own Entra app; an email gets a draft in Outlook and approving it sends it: createReply → PATCH → send in the conversation", async ({
  page,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(360_000);
  expect(openRouterKey).toBeTruthy();
  const app = entraAppFor(testInfo);
  const agentName = uniqueName(testInfo, "Agente Outlook");
  await createNamedAgent(page, agentName);
  const setup = await connectOutlookMailbox(page, { name: uniqueName(testInfo, "Outlook"), address: mailboxAddressFor(testInfo, "outlook"), app, agentName });
  const customer = customerFor(testInfo, "Luis Cliente");
  try {
    await test.step("[COR-07][COR-24] Microsoft is asked with the business's app, the four permissions, PKCE and the app's redirect URI", async () => {
      const [authorize] = await mock.requests({ service: "ms-login", method: "GET", path: `/${app.tenant}/oauth2/v2.0/authorize` });
      expect(authorize.query).toMatchObject({ client_id: app.clientId, response_type: "code", response_mode: "query", redirect_uri: MICROSOFT_REDIRECT_URI, code_challenge_method: "S256" });
      expect(authorize.query.scope.split(" ")).toEqual(expect.arrayContaining(["offline_access", ...GRAPH_SCOPES]));
      const exchanges = (await mock.requests({ service: "ms-login", method: "POST", path: `/${app.tenant}/oauth2/v2.0/token` }))
        .map((call) => Object.fromEntries(new URLSearchParams(typeof call.body === "string" ? call.body : "")))
        .filter((form) => form.grant_type === "authorization_code");
      expect(exchanges).toHaveLength(1);
      expect(exchanges[0]).toMatchObject({ client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: MICROSOFT_REDIRECT_URI });
      expect(exchanges[0].code_verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    });

    // Words the demo template hands off to a person («novia», «boda», «queja»…) stay out: the AI must answer.
    const subject = uniqueMessage(testInfo, "Consulta sobre mechas");
    const body = uniqueMessage(testInfo, "Hola, ¿cuánto cuestan unas mechas con el corte incluido?");
    const messageId = messageIdFor(testInfo, "consulta mechas");
    const incoming = await outlook.deliver(setup.address, buildRawEmail({ from: customer, to: { address: setup.address }, subject, text: `${body}\n\n-- \n${customer.name}`, messageId }));
    await readMailboxNow(page, request, setup.channelId, () => outlook.downloaded(setup.address, incoming.id), "[COR-08] the app reads the inbox's new email");
    const conversationId = await openEmailConversation(page, setup, body);
    await expect(threadSubject(page, subject)).toBeVisible();

    await test.step("[COR-14] the AI's reply waits as a draft in the inbox", async () => {
      await untilWithQueue(request, async () => (await chatRequestsFor(mock, conversationId)).length > 0, "the AI prepares its reply");
      await expect(aiDrafts(page)).toHaveCount(1, { timeout: 20_000 });
      expect((await outlook.mailbox(setup.address)).sends).toEqual([]);
    });

    const twinId = await test.step("[COR-14][COR-08] the draft is also in Outlook: a reply in the same conversation, with our header", async () => {
      const replyDraft = async () => (await outlook.mailbox(setup.address)).messages.find((message) => message.replyOf === incoming.id && message.isDraft);
      await readMailboxNow(page, request, setup.channelId, async () => (await replyDraft()) !== undefined, "the next read leaves the draft in Outlook");
      const twin = await replyDraft();
      expect(twin).toMatchObject({ folder: "drafts", conversationId: incoming.conversationId, to: [{ address: customer.address }] });
      expect(twin?.headers).toContainEqual({ name: "X-DominIA-Agente", value: "1" });
      expect(twin?.text).toContain("Me has escrito");
      return twin?.id as string;
    });

    await test.step("[COR-15][COR-08][COR-18] «Aprobar y enviar» sends that draft: createReply → PATCH → send, immutable ids, no Auto-Submitted", async () => {
      await page.goto(conversationPath(conversationId));
      await approveDraft(page);
      await untilWithQueue(request, async () => (await outlook.mailbox(setup.address)).sends.length > 0, "the approved draft leaves Outlook");
      const box = await outlook.mailbox(setup.address);
      expect(box.sends).toHaveLength(1);
      const [sent] = box.sends;
      expect(sent).toMatchObject({ id: twinId, replyOf: incoming.id, conversationId: incoming.conversationId, to: [{ address: customer.address }] });
      expect(sent.text).toContain("Me has escrito");
      expect(sent.headers.some((header) => header.name.toLowerCase() === "auto-submitted"), "[COR-18] Outlook never gets Auto-Submitted through Graph").toBe(false);
      expect(box.messages.find((message) => message.id === twinId)?.folder, "sent from Outlook, it is in Sent Items with the same id").toBe("sentitems");

      const calls = await graphCalls(mock);
      const createReplies = calls.filter((call) => onMessage(call, "POST", incoming.id, "createReply"));
      const patches = calls.filter((call) => onMessage(call, "PATCH", twinId));
      const sends = calls.filter((call) => onMessage(call, "POST", twinId, "send"));
      expect(createReplies, "one reply draft, the one in Outlook").toHaveLength(1);
      expect(patches.length).toBeGreaterThan(0);
      expect(sends).toHaveLength(1);
      expect(createReplies[0].id).toBeLessThan(patches[0].id);
      expect(patches[patches.length - 1].id).toBeLessThan(sends[0].id);
      expect(createReplies[0].body).toMatchObject({ message: { internetMessageHeaders: [{ name: "X-DominIA-Agente", value: "1" }] } });
      for (const call of [...createReplies, ...patches, ...sends]) expect(call.headers.prefer, `${call.method} ${call.path}`).toContain(IMMUTABLE_IDS);
    });
  } finally {
    await disableChannelQuietly(page, setup.channelId);
  }
});
