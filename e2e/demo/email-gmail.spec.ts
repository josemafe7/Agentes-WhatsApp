// Gmail as a business connects and uses it ([COR-*], [CAN-07], [BAN-09], [BAN-11]) against the simulated Google
// (e2e/mocks/routes/google.mjs): the OAuth round trip with the business's own client, an email that gets an AI draft in
// the inbox and in Gmail, approving it in the same thread, automatic mode, what is ignored, a person replying from Gmail
// and revoked access. Each test connects a mailbox of its own, with its own client and customers, through the wizard,
// and leaves it disabled. Mail is read with the panel's «Leer ahora» and the background work run through the cron route.
import type { Page, TestInfo } from "@playwright/test";
import { createNamedAgent } from "../support/agents";
import { authStatePath } from "../support/app";
import { textAndFieldsOf } from "../support/channels";
import { chatRequestsFor, holdsFor, untilWithQueue } from "../support/engine";
import {
  aiDrafts,
  approveDraft,
  connectedSummary,
  connectGmailMailbox,
  consentAtGoogle,
  conversationsFound,
  expectMailboxConnected,
  GOOGLE_REDIRECT_URI,
  gmailRedirectUriShown,
  IGNORE_LABELS,
  ignoredCount,
  openEmailConversation,
  panelAlert,
  readMailboxNow,
  reconnectGmail,
  replyModeRadio,
  startEmailWizard,
  submitGmailClient,
  threadSubject,
  type MailboxSetup,
  type RepliesStepOptions,
} from "../support/email";
import {
  buildRawEmail,
  customerFor,
  gmail,
  googleClientFor,
  headerOf,
  issuedTokens,
  mailboxAddressFor,
  messageIdFor,
  type GmailSend,
  type MailAddress,
  type TestEmail,
} from "../support/email-mailboxes";
import { aiAuthor, aiPausedNotice, conversationLog, conversationPath, openNotifications } from "../support/inbox";
import type { MockClient } from "../support/mock-client";
import { uniqueMessage, uniqueName, uniqueRef } from "../support/names";
import { expect, test } from "../support/test";
import { channelPanelPath, disableChannelQuietly } from "../support/whatsapp";

test.use({ storageState: authStatePath("owner") });

const GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify";
/** Spanish reasons the app shows (src/server/channels/email/oauth-results.ts, src/server/channels/email/tokens.ts). */
const STATE_INVALID_TEXT = "Esta vuelta no corresponde a ninguna conexión iniciada desde la app";
const MISSING_SCOPES_TEXT = "No se concedieron todos los permisos";
const GOOGLE_REVOKED_TEXT = "Google ya no acepta el acceso";
const MAILBOX_PAUSE_REASON = "Ha respondido una persona desde el buzón";

type GmailSetup = MailboxSetup & { agentName: string | null; customer: Required<MailAddress> };

/** A mailbox of this test connected through the wizard, with its own agent (unless `agent: false`). */
async function setUpGmail(page: Page, testInfo: TestInfo, label: string, options: RepliesStepOptions & { agent?: boolean } = {}): Promise<GmailSetup> {
  const agentName = options.agent === false ? null : uniqueName(testInfo, `Agente ${label}`);
  if (agentName) await createNamedAgent(page, agentName);
  const setup = await connectGmailMailbox(page, {
    name: uniqueName(testInfo, `Gmail ${label}`),
    address: mailboxAddressFor(testInfo, label),
    client: googleClientFor(testInfo),
    ...(agentName ? { agentName } : {}),
    ...(options.replyMode ? { replyMode: options.replyMode } : {}),
  });
  return { ...setup, agentName, customer: customerFor(testInfo, "Ana Cliente") };
}

type Sent = { id: string; threadId: string; messageId: string; subject: string; body: string };

/** A customer's email arrives in the mailbox: unique subject and body, its own Message-ID. */
async function customerWrites(testInfo: TestInfo, setup: GmailSetup, label: string, email: Partial<Omit<TestEmail, "text">> & { body: string }): Promise<Sent> {
  const { body, ...headers } = email;
  const subject = email.subject ?? uniqueMessage(testInfo, `Consulta ${label}`);
  const messageId = email.messageId ?? messageIdFor(testInfo, label);
  const raw = buildRawEmail({ from: setup.customer, to: { address: setup.address }, ...headers, subject, messageId, text: `${body}\n\n-- \n${setup.customer.name}` });
  const delivered = await gmail.deliver(setup.address, raw);
  return { id: delivered.id, threadId: delivered.threadId, messageId, subject, body };
}

/** What the grant exchanged with Google's token endpoint (the form bodies the app posted). */
async function tokenCalls(mock: MockClient, grantType: "authorization_code" | "refresh_token"): Promise<Record<string, string>[]> {
  const calls = await mock.requests({ service: "google-oauth", method: "POST", path: "/token" });
  return calls.map((call) => Object.fromEntries(new URLSearchParams(typeof call.body === "string" ? call.body : ""))).filter((form) => form.grant_type === grantType);
}

/** Page text, field values and the HTML itself (RSC payload included): where a secret must never show ([SEG-01]). */
async function everythingOn(page: Page): Promise<string> {
  return `${await textAndFieldsOf(page)}\n${await page.content()}`;
}

function expectRepliedInThread(sent: GmailSend, original: Sent): void {
  expect(sent.threaded, `[COR-06] Gmail threads it: ${sent.threadingProblems.join("; ")}`).toBe(true);
  expect(sent.requestedThreadId).toBe(original.threadId);
  expect(sent.threadId).toBe(original.threadId);
  expect(sent.subject, "[COR-06][COR-18] the same subject with «Re:», never «Auto:»").toBe(`Re: ${original.subject}`);
  expect(sent.inReplyTo).toBe(original.messageId);
  expect(sent.references).toContain(original.messageId);
  expect(headerOf(sent, "x-dominia-agente"), "[COR-18] our own header on everything we send").not.toBeNull();
}

test("[COR-01][COR-02][COR-23][COR-24][CAN-17] Gmail connects with the business's own Google client (offline access, forced consent, PKCE, the app's redirect URI); the return works once and no secret reaches the page", async ({
  page,
  mock,
}, testInfo) => {
  test.setTimeout(150_000);
  const client = googleClientFor(testInfo);
  const address = mailboxAddressFor(testInfo, "conexión");
  let channelId: string | null = null;
  try {
    await startEmailWizard(page, "Gmail", uniqueName(testInfo, "Gmail conexión"));
    await test.step("[COR-02] the redirect URI to copy is the installation's own", async () => {
      expect(await gmailRedirectUriShown(page)).toBe(GOOGLE_REDIRECT_URI);
    });
    await submitGmailClient(page, client);
    const callback = await consentAtGoogle(page, address);
    channelId = await expectMailboxConnected(page, address);

    await test.step("[COR-02][COR-24] Google is asked with the business's client, offline access, forced consent and PKCE", async () => {
      const [authorize] = await mock.requests({ service: "google-oauth", method: "GET", path: "/o/oauth2/v2/auth" });
      expect(authorize.query).toMatchObject({
        response_type: "code",
        client_id: client.clientId,
        redirect_uri: GOOGLE_REDIRECT_URI,
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        code_challenge_method: "S256",
      });
      expect(authorize.query.scope.split(" ").sort()).toEqual(["email", GMAIL_MODIFY, "openid"]);
      expect(authorize.query.state.length).toBeGreaterThanOrEqual(16);
      const exchanges = await tokenCalls(mock, "authorization_code");
      expect(exchanges).toHaveLength(1);
      expect(exchanges[0]).toMatchObject({ client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: GOOGLE_REDIRECT_URI });
      expect(exchanges[0].code_verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    });

    await test.step("[COR-03] every permission was granted", async () => {
      await expect(connectedSummary(page).getByText("Concedido")).toHaveCount(3);
      await expect(connectedSummary(page).getByText("Falta")).toHaveCount(0);
    });

    await test.step("[CAN-07] an email mailbox answers with drafts by default", async () => {
      await expect(replyModeRadio(page, "draft")).toBeChecked();
    });

    await test.step("[CAN-17][SEG-01][PER-07] neither the Client Secret nor a token reaches a page; the panel masks the secret", async () => {
      const tokens = issuedTokens(await gmail.mailbox(address));
      expect(tokens.length, "the simulated Google issued tokens").toBeGreaterThan(1);
      const secrets = [client.clientSecret, ...tokens];
      const wizard = await everythingOn(page);
      for (const secret of secrets) expect(wizard.includes(secret), "no secret in the wizard").toBe(false);
      await page.goto(channelPanelPath(channelId as string));
      await expect(page.getByRole("main")).toContainText(`••••${client.clientSecret.slice(-4)}`);
      const panel = await everythingOn(page);
      for (const secret of secrets) expect(panel.includes(secret), "no secret in the panel").toBe(false);
    });

    await test.step("[COR-23] the same return again stores nothing and says why", async () => {
      await page.goto(callback.url());
      await page.waitForURL((url) => url.searchParams.get("conexion") !== null);
      const landed = new URL(page.url());
      expect(landed.searchParams.get("conexion")).toBe("error");
      expect(landed.searchParams.get("motivo")).toBe("state_invalid");
      await expect(page.getByRole("main")).toContainText(STATE_INVALID_TEXT);
      expect(await tokenCalls(mock, "authorization_code"), "the code is never exchanged again").toHaveLength(1);
    });
  } finally {
    await disableChannelQuietly(page, channelId);
  }
});

test("[COR-03][COR-23] without Gmail's permission the mailbox does not connect and the wizard says which permission is missing", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const address = mailboxAddressFor(testInfo, "sin permiso");
  let channelId: string | null = null;
  try {
    await startEmailWizard(page, "Gmail", uniqueName(testInfo, "Gmail sin permiso"));
    await submitGmailClient(page, googleClientFor(testInfo));
    await consentAtGoogle(page, address, { untick: [/Leer, redactar y enviar/] });
    await page.waitForURL((url) => url.searchParams.get("conexion") !== null, { timeout: 30_000 });
    const landed = new URL(page.url());
    channelId = landed.searchParams.get("canal");
    expect(landed.searchParams.get("conexion")).toBe("error");
    expect(landed.searchParams.get("motivo")).toBe("missing_scopes");
    const notice = page.getByRole("main").getByRole("alert").filter({ hasText: "No se ha conectado el buzón" });
    await expect(notice).toContainText(MISSING_SCOPES_TEXT);
    await expect(notice).toContainText("Leer, enviar y organizar el correo de Gmail");
    // Nothing connected: the mailbox is still waiting for its connection.
    expect(channelId).not.toBeNull();
    await page.goto(channelPanelPath(channelId as string));
    await expect(panelAlert(page, "Este buzón no está conectado")).toBeVisible();
  } finally {
    await disableChannelQuietly(page, channelId);
  }
});

test("[COR-14][COR-15][COR-06][COR-18][CAN-07][BAN-09] an email gets an AI draft in the inbox and in Gmail; approving it sends that draft in the same thread, without Auto-Submitted", async ({
  page,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(360_000);
  expect(openRouterKey).toBeTruthy();
  const setup = await setUpGmail(page, testInfo, "borradores");
  try {
    const original = await customerWrites(testInfo, setup, "cita viernes", {
      subject: uniqueMessage(testInfo, "¿Tenéis cita el viernes por la mañana?"),
      body: uniqueMessage(testInfo, "Hola, quería pedir cita para cortarme el pelo el viernes."),
    });
    await readMailboxNow(page, request, setup.channelId, () => gmail.downloaded(setup.address, original.id), "the app reads the new email");
    const conversationId = await openEmailConversation(page, setup, original.body);

    await test.step("[BAN-09][CAN-12] one conversation for the thread, headed by its subject", async () => {
      await expect(threadSubject(page, original.subject)).toBeVisible();
    });

    await test.step("[COR-14][CAN-07] the AI answers with a draft that waits in the inbox; nothing leaves", async () => {
      await untilWithQueue(request, async () => (await chatRequestsFor(mock, conversationId)).length > 0, "the AI prepares its reply");
      await expect(aiDrafts(page)).toHaveCount(1, { timeout: 20_000 });
      expect((await gmail.mailbox(setup.address)).sends).toEqual([]);
    });

    const twin = await test.step("[COR-14][COR-18] the draft is also in Gmail's drafts, in the thread, without Auto-Submitted", async () => {
      await readMailboxNow(page, request, setup.channelId, async () => (await gmail.mailbox(setup.address)).drafts.length > 0, "the next read leaves the draft in Gmail");
      const { drafts } = await gmail.mailbox(setup.address);
      expect(drafts).toHaveLength(1);
      const [draft] = drafts;
      expect(draft.threaded, draft.threadingProblems.join("; ")).toBe(true);
      expect(draft).toMatchObject({ threadId: original.threadId, inReplyTo: original.messageId, subject: `Re: ${original.subject}` });
      expect(headerOf(draft, "auto-submitted")).toBeNull();
      return draft;
    });

    await test.step("[COR-15][COR-06][COR-18] «Aprobar y enviar» sends that same draft in the thread, as a person's message", async () => {
      await page.goto(conversationPath(conversationId));
      await approveDraft(page);
      await untilWithQueue(request, async () => (await gmail.mailbox(setup.address)).sends.length > 0, "the approved draft leaves Gmail");
      const box = await gmail.mailbox(setup.address);
      expect(box.sends).toHaveLength(1);
      const [sent] = box.sends;
      expect(sent).toMatchObject({ via: "drafts.send", draftId: twin.id });
      expectRepliedInThread(sent, original);
      expect(sent.from?.address).toBe(setup.address);
      expect(sent.to.map((recipient) => recipient.address)).toEqual([setup.customer.address]);
      expect(headerOf(sent, "auto-submitted"), "[COR-18] a person approved it: never Auto-Submitted (RFC 3834)").toBeNull();
      expect(sent.text).toContain("Me has escrito");
      expect(box.drafts, "[COR-15] the mailbox draft is gone").toEqual([]);
      const answered = box.messages.find((message) => message.id === original.id);
      expect(answered?.labelNames, "[COR-06] the email answered gets «IA/Respondido»").toContain("IA/Respondido");
    });
  } finally {
    await disableChannelQuietly(page, setup.channelId);
  }
});

test("[COR-18][COR-06][CAN-07] in «Automático» the AI's reply leaves at once, in the thread, marked Auto-Submitted: auto-replied", async ({
  page,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(300_000);
  expect(openRouterKey).toBeTruthy();
  const setup = await setUpGmail(page, testInfo, "automático", { replyMode: "auto" });
  try {
    const original = await customerWrites(testInfo, setup, "horario", { body: uniqueMessage(testInfo, "¿Abrís los sábados por la tarde?") });
    await readMailboxNow(page, request, setup.channelId, () => gmail.downloaded(setup.address, original.id), "the app reads the new email");
    const conversationId = await openEmailConversation(page, setup, original.body);
    await untilWithQueue(request, async () => (await gmail.mailbox(setup.address)).sends.length > 0, "the AI's reply leaves Gmail");

    const box = await gmail.mailbox(setup.address);
    expect(box.sends).toHaveLength(1);
    const [sent] = box.sends;
    expect(sent.via).toBe("messages.send");
    expectRepliedInThread(sent, original);
    expect(headerOf(sent, "auto-submitted"), "[COR-18] automatic mode marks it as an automatic reply").toBe("auto-replied");
    expect(sent.text).toContain("Me has escrito");
    expect(box.drafts).toEqual([]);
    expect(await chatRequestsFor(mock, conversationId)).not.toHaveLength(0);

    await page.goto(conversationPath(conversationId));
    await expect(aiAuthor(page, setup.agentName as string).first()).toBeVisible({ timeout: 15_000 });
    await expect(aiDrafts(page)).toHaveCount(0);
  } finally {
    await disableChannelQuietly(page, setup.channelId);
  }
});

test("[COR-16] newsletters (List-Unsubscribe), automatic replies (Auto-Submitted) and noreply senders are ignored: no conversation, no reply, counted with their reason", async ({
  page,
  request,
  mock,
  openRouterKey,
}, testInfo) => {
  test.setTimeout(300_000);
  expect(openRouterKey).toBeTruthy();
  const setup = await setUpGmail(page, testInfo, "filtros");
  const to = { address: setup.address };
  try {
    const newsletter = {
      subject: uniqueMessage(testInfo, "Novedades de otoño en la tienda"),
      raw: (subject: string) =>
        buildRawEmail({
          from: { name: "Tienda Ejemplo", address: `boletin-${uniqueRef(testInfo, "boletín")}@tienda-e2e.test` },
          to,
          subject,
          text: "Descuentos de temporada. Si no quieres recibir más correos, date de baja.",
          messageId: messageIdFor(testInfo, "boletín", "tienda-e2e.test"),
          headers: { "List-Unsubscribe": "<https://tienda-e2e.test/baja?u=e2e>, <mailto:baja@tienda-e2e.test>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        }),
    };
    const autoReply = {
      subject: uniqueMessage(testInfo, "Respuesta automática: fuera de la oficina"),
      raw: (subject: string) =>
        buildRawEmail({
          from: customerFor(testInfo, "Laura Gómez"),
          to,
          subject,
          text: "Estoy fuera hasta el lunes. Responderé a tu correo a la vuelta.",
          messageId: messageIdFor(testInfo, "fuera de la oficina"),
          headers: { "Auto-Submitted": "auto-replied" },
        }),
    };
    const noReply = {
      subject: uniqueMessage(testInfo, "Tu recibo de septiembre"),
      raw: (subject: string) =>
        buildRawEmail({
          from: { name: "Banco Ejemplo", address: `noreply-${uniqueRef(testInfo, "noreply")}@banco-e2e.test` },
          to,
          subject,
          text: "Ya tienes disponible tu recibo. No respondas a este correo.",
          messageId: messageIdFor(testInfo, "recibo", "banco-e2e.test"),
        }),
    };
    const ignored = [newsletter, autoReply, noReply];
    const ignoredIds: string[] = [];
    for (const email of ignored) ignoredIds.push((await gmail.deliver(setup.address, email.raw(email.subject))).id);
    // A customer's email after them: the one conversation there must be.
    const customer = await customerWrites(testInfo, setup, "precio", { body: uniqueMessage(testInfo, "¿Cuánto cuesta un corte y peinado?") });
    await readMailboxNow(page, request, setup.channelId, () => gmail.downloaded(setup.address, ...ignoredIds, customer.id), "the app reads the four emails");

    const conversationId = await openEmailConversation(page, setup, customer.body);
    await untilWithQueue(request, async () => (await chatRequestsFor(mock, conversationId)).length > 0, "the customer's email gets its reply");

    for (const email of ignored) expect(await conversationsFound(page, email.subject), `[COR-16] no conversation for «${email.subject}»`).toBe(0);
    // Nothing is ever prepared for them: no draft in Gmail and no email to their senders, not even a while later.
    const repliesToIgnored = async (): Promise<number> => {
      const box = await gmail.mailbox(setup.address);
      const threads = new Set(box.messages.filter((message) => ignoredIds.includes(message.id)).map((message) => message.threadId));
      return [...box.drafts, ...box.sends].filter((mail) => mail.threadId !== undefined && threads.has(mail.threadId)).length;
    };
    await holdsFor(request, repliesToIgnored, 0, "[COR-16] no draft or reply for what is ignored");

    await page.goto(channelPanelPath(setup.channelId));
    await expect(ignoredCount(page, IGNORE_LABELS.mailingList)).toHaveText("1");
    await expect(ignoredCount(page, IGNORE_LABELS.autoReply)).toHaveText("1");
    await expect(ignoredCount(page, IGNORE_LABELS.noReplySender)).toHaveText("1");
  } finally {
    await disableChannelQuietly(page, setup.channelId);
  }
});

test("[COR-20][BAN-11] a person replying to the thread from Gmail pauses the AI in that conversation", async ({ page, request, mock, openRouterKey }, testInfo) => {
  test.setTimeout(360_000);
  expect(openRouterKey).toBeTruthy();
  const setup = await setUpGmail(page, testInfo, "persona en Gmail");
  try {
    const original = await customerWrites(testInfo, setup, "cambio de cita", { body: uniqueMessage(testInfo, "¿Puedo cambiar mi cita del jueves?") });
    await readMailboxNow(page, request, setup.channelId, () => gmail.downloaded(setup.address, original.id), "the app reads the customer's email");
    const conversationId = await openEmailConversation(page, setup, original.body);
    await untilWithQueue(request, async () => (await chatRequestsFor(mock, conversationId)).length > 0, "the AI answers while nobody has");
    // The turn is over once its draft is stored (an agent that searches its knowledge calls the model twice).
    await expect(aiDrafts(page)).toHaveCount(1, { timeout: 20_000 });
    const aiCalls = (await chatRequestsFor(mock, conversationId)).length;

    const humanText = uniqueMessage(testInfo, "Te llamo ahora mismo y lo cambiamos.");
    const humanMessageId = messageIdFor(testInfo, "respuesta de Marta", "peluqueria-e2e.test");
    const humanReply = await gmail.deliver(
      setup.address,
      buildRawEmail({
        from: { name: "Marta (recepción)", address: setup.address },
        to: setup.customer,
        subject: `Re: ${original.subject}`,
        text: `${humanText}\n\nEl jueves, ${setup.customer.name} escribió:\n> ¿Puedo cambiar mi cita del jueves?`,
        messageId: humanMessageId,
        inReplyTo: original.messageId,
        references: [original.messageId],
      }),
      { labelIds: ["SENT"], threadId: original.threadId },
    );
    await readMailboxNow(page, request, setup.channelId, () => gmail.downloaded(setup.address, humanReply.id), "the app reads the reply sent from Gmail");

    await page.goto(conversationPath(conversationId));
    await expect(conversationLog(page)).toContainText(humanText);
    await expect(aiPausedNotice(page)).toBeVisible();
    await expect(page.getByRole("main")).toContainText(MAILBOX_PAUSE_REASON);

    const again = await customerWrites(testInfo, setup, "respuesta del cliente", {
      subject: `Re: ${original.subject}`,
      body: uniqueMessage(testInfo, "Vale, espero tu llamada."),
      inReplyTo: humanMessageId,
      references: [original.messageId, humanMessageId],
    });
    await readMailboxNow(page, request, setup.channelId, () => gmail.downloaded(setup.address, again.id), "the app reads the customer's answer");
    await page.goto(conversationPath(conversationId));
    await expect(conversationLog(page)).toContainText(again.body);
    await holdsFor(request, async () => (await chatRequestsFor(mock, conversationId)).length, aiCalls, "[COR-20] the AI stays paused in that conversation");
  } finally {
    await disableChannelQuietly(page, setup.channelId);
  }
});

test("[COR-22][CAN-15] revoked access puts the mailbox in «Requiere reconexión» with a notice; reconnecting reads what arrived meanwhile", async ({ page, request, mock }, testInfo) => {
  test.setTimeout(300_000);
  const setup = await setUpGmail(page, testInfo, "acceso revocado", { agent: false });
  try {
    // The person removes the app's access in their Google Account; meanwhile a customer writes.
    await gmail.revokeAccess(setup.address);
    const meanwhile = await customerWrites(testInfo, setup, "durante el corte", { body: uniqueMessage(testInfo, "¿Seguís abiertos en agosto?") });
    await readMailboxNow(
      page,
      request,
      setup.channelId,
      async () => (await mock.requests({ service: "google-oauth", method: "POST", path: "/token" })).some((call) => String(call.body).includes("grant_type=refresh_token") && call.status === 400),
      "the app finds the access revoked",
    );

    await test.step("[COR-22] the panel says «Requiere reconexión» and why, and offers to reconnect", async () => {
      await expect(async () => {
        await page.goto(channelPanelPath(setup.channelId));
        await expect(panelAlert(page, "Requiere reconexión")).toContainText(GOOGLE_REVOKED_TEXT, { timeout: 2_000 });
      }).toPass({ timeout: 30_000 });
      await expect(panelAlert(page, "Requiere reconexión").getByRole("button", { name: "Reconectar" })).toBeVisible();
    });

    await test.step("[COR-22][CAN-15] the owner gets the notice", async () => {
      await expect(async () => {
        await page.reload();
        const popover = await openNotifications(page);
        await expect(popover).toContainText(`Correo «${setup.name}»: requiere reconexión`, { timeout: 2_000 });
      }).toPass({ timeout: 30_000, intervals: [1_000, 2_000] });
      await page.keyboard.press("Escape");
    });

    await test.step("[COR-22] reconnecting loses nothing: the email that arrived meanwhile is read", async () => {
      await reconnectGmail(page, setup.channelId, setup.address);
      await expect(panelAlert(page, "Buzón conectado")).toBeVisible();
      await expect(panelAlert(page, "Requiere reconexión")).toHaveCount(0);
      await readMailboxNow(page, request, setup.channelId, () => gmail.downloaded(setup.address, meanwhile.id), "the reconnected mailbox reads from where it stopped");
      await openEmailConversation(page, setup, meanwhile.body);
    });
  } finally {
    await disableChannelQuietly(page, setup.channelId);
  }
});
