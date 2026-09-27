// The return from Google and Microsoft ([COR-03], [COR-07], [COR-22], [COR-23]): nothing is stored unless the round
// trip is ours, fresh, unused, of the same person and with every permission.
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLog, channels, jobs, oauthStates } from "@/db/schema";
import { readEmailConfig, readOAuthSecrets } from "@/server/channels/email/config";
import { fakeGoogle, fakeMicrosoft } from "@/server/channels/email/test-helpers";
import { hashToken } from "@/server/crypto";
import { createBusiness, createUser } from "@/test/factories";
import { completeGoogleOAuth, completeMicrosoftOAuth } from "./email-oauth";
import { createEmailChannel } from "./email";
import { saveGmailCredentials, saveOutlookCredentials, startGmailOAuth, startOutlookOAuth } from "./email-connect";

const CLIENT_ID = "123-abc.apps.googleusercontent.com";

async function gmailSetup() {
  await createBusiness();
  const owner = await createUser("owner");
  const { id } = await createEmailChannel(owner.actor, { type: "email_gmail", name: "Gmail" });
  await saveGmailCredentials(owner.actor, { channelId: id, clientId: CLIENT_ID, clientSecret: "GOCSPX-secreto" });
  const { url } = await startGmailOAuth(owner.actor, { channelId: id });
  const state = new URL(url).searchParams.get("state") ?? "";
  return { owner, channelId: id, state, url };
}

async function loadChannel(id: string) {
  const [row] = await db.select().from(channels).where(eq(channels.id, id));
  return row;
}

describe("[COR-23] vuelta de Google: solo una conexión iniciada desde la app", () => {
  it("guarda el state como huella, con PKCE cifrado y caducidad de 10 minutos", async () => {
    const { channelId, state, url } = await gmailSetup();
    const [row] = await db.select().from(oauthStates).where(eq(oauthStates.channelId, channelId));
    expect(row.stateHash).toBe(hashToken(state));
    expect(row.codeVerifierEnc).toMatch(/^v1:/);
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(new URL(url).searchParams.get("code_challenge")).toBeTruthy();
  });

  it("un state que no es nuestro, de otra persona, caducado o repetido no guarda nada", async () => {
    const { owner, channelId, state } = await gmailSetup();
    const google = fakeGoogle();
    await expect(completeGoogleOAuth(owner.actor, { code: "c", state: "inventado" }, google.deps)).resolves.toMatchObject({ ok: false, reason: "state_invalid" });
    const admin = await createUser("admin");
    await expect(completeGoogleOAuth(admin.actor, { code: "c", state }, google.deps)).resolves.toMatchObject({ ok: false, reason: "state_invalid" });
    // Consumed by the attempt above: it never works again, not even for its owner.
    await expect(completeGoogleOAuth(owner.actor, { code: "c", state }, google.deps)).resolves.toMatchObject({ ok: false, reason: "state_invalid" });
    const second = await gmailSetup();
    await db.update(oauthStates).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(oauthStates.stateHash, hashToken(second.state)));
    await expect(completeGoogleOAuth(second.owner.actor, { code: "c", state: second.state }, google.deps)).resolves.toMatchObject({ ok: false, reason: "state_expired" });
    expect(google.calls).toHaveLength(0);
    expect(readOAuthSecrets(await loadChannel(channelId))?.refreshToken).toBeNull();
    expect((await loadChannel(channelId)).status).toBe("draft");
  });

  it("sin sesión no se consume nada", async () => {
    const { owner, state } = await gmailSetup();
    await expect(completeGoogleOAuth(null, { code: "c", state })).resolves.toMatchObject({ ok: false, reason: "session" });
    const [row] = await db.select().from(oauthStates).where(and(eq(oauthStates.stateHash, hashToken(state)), eq(oauthStates.userId, owner.userId)));
    expect(row.usedAt).toBeNull();
  });

  it("si la persona cancela en Google, se dice y no se guarda nada", async () => {
    const { owner, channelId, state } = await gmailSetup();
    await expect(completeGoogleOAuth(owner.actor, { error: "access_denied", state })).resolves.toMatchObject({ ok: false, reason: "denied", channelId, returnTo: `/canales/${channelId}` });
  });
});

describe("[COR-03] permisos concedidos en Google", () => {
  it("si falta leer y modificar el correo, lo dice y no conecta", async () => {
    const { owner, channelId, state } = await gmailSetup();
    const google = fakeGoogle({ scope: "openid https://www.googleapis.com/auth/userinfo.email" });
    const result = await completeGoogleOAuth(owner.actor, { code: "c", state }, google.deps);
    expect(result).toMatchObject({ ok: false, reason: "missing_scopes", missingScopes: ["https://www.googleapis.com/auth/gmail.modify"] });
    const row = await loadChannel(channelId);
    expect(row.status).toBe("draft");
    expect(readOAuthSecrets(row)?.refreshToken).toBeNull();
  });

  it("con todos los permisos: tokens cifrados, buzón, punto de partida, etiqueta, lectura programada y registro", async () => {
    const { owner, channelId, state } = await gmailSetup();
    const google = fakeGoogle({ emailAddress: "Hola@Negocio.test", historyId: "555" });
    const result = await completeGoogleOAuth(owner.actor, { code: "codigo", state }, google.deps);
    expect(result).toEqual({ ok: true, channelId, returnTo: `/canales/${channelId}` });
    const token = google.calls.find((call) => call.url.pathname === "/token");
    expect(new URLSearchParams(token?.body ?? "").get("code_verifier")?.length).toBe(43);
    expect(new URLSearchParams(token?.body ?? "").get("redirect_uri")).toBe("http://localhost:3000/api/oauth/google/callback");
    const row = await loadChannel(channelId);
    expect(row.status).toBe("connected");
    expect(row.secretsEnc).not.toContain("refresh-token");
    expect(readOAuthSecrets(row)).toMatchObject({ clientSecret: "GOCSPX-secreto", refreshToken: "1//refresh-token" });
    const config = readEmailConfig(row.config);
    expect(config).toMatchObject({ emailAddress: "hola@negocio.test", gmail: { clientId: CLIENT_ID, sub: "1234567890", historyId: "555" } });
    expect(config.gmail.labelId).toBeTruthy();
    expect(google.state.labels.map((label) => label.name)).toContain("IA/Respondido");
    expect(await db.select().from(jobs).where(eq(jobs.dedupeKey, `recurring:email.poll:${channelId}`))).toHaveLength(1);
    expect(await db.select().from(auditLog).where(and(eq(auditLog.action, "channel.connected"), eq(auditLog.targetId, channelId)))).toHaveLength(1);
  });

  it("[COR-22] reconectar el mismo buzón quita «Requiere reconexión» y sigue leyendo desde donde iba", async () => {
    const { owner, channelId, state } = await gmailSetup();
    const google = fakeGoogle({ historyId: "555" });
    await completeGoogleOAuth(owner.actor, { code: "c", state }, google.deps);
    await db
      .update(channels)
      .set({ status: "error", config: { ...(await loadChannel(channelId)).config, reconnect: { at: "2026-09-27T00:00:00Z", reason: "Google ya no acepta el acceso" } } })
      .where(eq(channels.id, channelId));
    google.state.historyId = 900;
    const { url } = await startGmailOAuth(owner.actor, { channelId });
    await completeGoogleOAuth(owner.actor, { code: "c2", state: new URL(url).searchParams.get("state") }, google.deps);
    const row = await loadChannel(channelId);
    expect(row.status).toBe("connected");
    expect(readEmailConfig(row.config)).toMatchObject({ reconnect: null, gmail: { historyId: "555" } });
  });
});

describe("[COR-07] vuelta de Microsoft", () => {
  async function outlookSetup(tenant = "common") {
    await createBusiness();
    const owner = await createUser("admin");
    const { id } = await createEmailChannel(owner.actor, { type: "email_outlook", name: "Outlook" });
    await saveOutlookCredentials(owner.actor, { channelId: id, clientId: "11111111-2222-3333-4444-555555555555", clientSecret: "secreto-entra", clientSecretExpiresAt: "2027-06-01", tenant });
    const { url } = await startOutlookOAuth(owner.actor, { channelId: id });
    return { owner, channelId: id, state: new URL(url).searchParams.get("state") ?? "", url };
  }

  it("con los permisos pedidos, conecta y guarda el buzón y la caducidad del secreto", async () => {
    const { owner, channelId, state, url } = await outlookSetup();
    expect(new URL(url).pathname).toBe("/common/oauth2/v2.0/authorize");
    const microsoft = fakeMicrosoft({ mail: "Hola@Negocio.test" });
    await expect(completeMicrosoftOAuth(owner.actor, { code: "c", state }, microsoft.deps)).resolves.toMatchObject({ ok: true, channelId });
    const row = await loadChannel(channelId);
    expect(row.status).toBe("connected");
    expect(readEmailConfig(row.config)).toMatchObject({ emailAddress: "hola@negocio.test", outlook: { tenant: "common", userId: "user-1", clientSecretExpiresAt: "2027-06-01T00:00:00.000Z" } });
    expect(readOAuthSecrets(row)?.refreshToken).toBe(microsoft.state.refreshTokens[0]);
  });

  it("si el tenant exige consentimiento del administrador (AADSTS65001), lo dice y no guarda nada", async () => {
    const { owner, channelId, state } = await outlookSetup("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    const microsoft = fakeMicrosoft();
    microsoft.state.tokenError = { error: "invalid_grant", codes: [65001] };
    await expect(completeMicrosoftOAuth(owner.actor, { code: "c", state }, microsoft.deps)).resolves.toMatchObject({ ok: false, reason: "admin_consent_required" });
    expect((await loadChannel(channelId)).status).toBe("draft");
  });

  it("la vuelta del consentimiento del administrador no guarda tokens", async () => {
    const { owner, channelId, state } = await outlookSetup("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    await expect(completeMicrosoftOAuth(owner.actor, { adminConsent: "True", state })).resolves.toEqual({ ok: true, channelId, returnTo: `/canales/${channelId}`, adminConsent: true });
    expect((await loadChannel(channelId)).status).toBe("draft");
  });

  it("si falta Mail.Send, no conecta", async () => {
    const { owner, channelId, state } = await outlookSetup();
    const microsoft = fakeMicrosoft({ scope: "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/User.Read" });
    await expect(completeMicrosoftOAuth(owner.actor, { code: "c", state }, microsoft.deps)).resolves.toMatchObject({ ok: false, reason: "missing_scopes", missingScopes: ["Mail.Send"] });
    expect((await loadChannel(channelId)).status).toBe("draft");
  });
});
