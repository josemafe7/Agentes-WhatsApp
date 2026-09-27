// The OAuth callback routes ([COR-23], [SEG-04], [SEG-05]): validated query, signed-in person, and a redirect to the
// channel with a code the screen explains. Nothing of the provider's answer or a token travels in the URL.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as null | { session: { id: string }; user: { id: string } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));

import { createEmailChannel } from "@/data/email";
import { saveGmailCredentials, saveOutlookCredentials, startGmailOAuth, startOutlookOAuth } from "@/data/email-connect";
import { createBusiness, createUser } from "@/test/factories";
import { GET as googleCallback, runtime } from "./google/callback/route";
import { GET as microsoftCallback } from "./microsoft/callback/route";

const signIn = (userId: string | null) => {
  state.session = userId ? { session: { id: `s-${userId}` }, user: { id: userId } } : null;
};

const call = (handler: (request: Request) => Promise<Response>, query: string) => handler(new Request(`http://localhost:3000/api/oauth/x/callback?${query}`));

function location(response: Response): URL {
  return new URL(response.headers.get("location") ?? "");
}

describe("[COR-23] vuelta de Google y Microsoft", () => {
  beforeEach(() => signIn(null));

  it("corre en Node", () => {
    expect(runtime).toBe("nodejs");
  });

  it("sin sesión, a iniciar sesión y sin consumir nada", async () => {
    const response = await call(googleCallback, "code=c&state=s");
    expect(response.status).toBe(303);
    expect(location(response).pathname).toBe("/login");
  });

  it("un state que no es de la app vuelve a Canales con el motivo", async () => {
    await createBusiness();
    const owner = await createUser("owner");
    signIn(owner.userId);
    const response = await call(googleCallback, "code=c&state=inventado");
    const url = location(response);
    expect(url.pathname).toBe("/canales");
    expect(Object.fromEntries(url.searchParams)).toEqual({ conexion: "error", motivo: "state_invalid" });
  });

  it("una consulta con valores desmedidos se rechaza sin procesarla", async () => {
    const response = await call(googleCallback, `state=${"x".repeat(500)}`);
    expect(Object.fromEntries(location(response).searchParams)).toEqual({ conexion: "error", motivo: "state_invalid" });
  });

  it("si la persona cancela en Google, vuelve al canal con «denied» y sin tokens en la URL", async () => {
    await createBusiness();
    const owner = await createUser("owner");
    const { id } = await createEmailChannel(owner.actor, { type: "email_gmail", name: "Gmail" });
    await saveGmailCredentials(owner.actor, { channelId: id, clientId: "1.apps.googleusercontent.com", clientSecret: "GOCSPX-secreto" });
    const { url } = await startGmailOAuth(owner.actor, { channelId: id });
    signIn(owner.userId);
    const response = await call(googleCallback, `error=access_denied&state=${new URL(url).searchParams.get("state")}`);
    const target = location(response);
    expect(target.pathname).toBe(`/canales/${id}`);
    expect(Object.fromEntries(target.searchParams)).toEqual({ conexion: "error", motivo: "denied" });
  });

  it("la vuelta del consentimiento del administrador de Microsoft avisa en el canal", async () => {
    await createBusiness();
    const admin = await createUser("admin");
    const { id } = await createEmailChannel(admin.actor, { type: "email_outlook", name: "Outlook" });
    await saveOutlookCredentials(admin.actor, {
      channelId: id,
      clientId: "11111111-2222-3333-4444-555555555555",
      clientSecret: "secreto-entra",
      clientSecretExpiresAt: "2027-06-01",
      tenant: "negocio.onmicrosoft.com",
    });
    const { url } = await startOutlookOAuth(admin.actor, { channelId: id });
    signIn(admin.userId);
    const response = await call(microsoftCallback, `admin_consent=True&tenant=t&state=${new URL(url).searchParams.get("state")}`);
    const target = location(response);
    expect(target.pathname).toBe(`/canales/${id}`);
    expect(Object.fromEntries(target.searchParams)).toEqual({ consentimiento: "ok" });
  });
});
