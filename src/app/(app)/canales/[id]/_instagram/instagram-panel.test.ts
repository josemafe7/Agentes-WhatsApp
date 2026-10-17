// The Instagram part of a channel's panel ([IG-09], [IG-10], [IG-13], [PER-03], [PER-07]), rendered as the page does it.
// The data layer and the database are real; the panel never calls Instagram.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getChannel } from "@/data/channels";
import { db } from "@/db";
import { channels } from "@/db/schema";
import type { Role } from "@/lib/enums";
import { encryptInstagramSecrets } from "@/server/channels/instagram/config";
import { actorFor, createBusiness, createChannel } from "@/test/factories";
import { InstagramPanel } from "./instagram-panel";

const TZ = "Europe/Madrid";
const TOKEN = `IGAA${"FALSOPRUEBA".repeat(8)}`;
const VERIFY_TOKEN = "token-de-verificacion_0123456789";
const BUTTONS = ["Revalidar</button>", "Cambiar token</button>", "Desconectar</button>"];

const connectedChannel = () =>
  createChannel({
    type: "instagram",
    name: "Instagram Peluquería",
    status: "connected",
    config: { accountId: "17840000000000001", username: "peluqueria_aurora", accountName: "Peluquería Aurora", tokenSetAt: new Date().toISOString() },
    secretsEnc: encryptInstagramSecrets({ accessToken: TOKEN, appSecret: `igsecret${"a1b2".repeat(4)}`, metaAppSecret: null, verifyToken: VERIFY_TOKEN }),
  });

async function render(role: Role, channelId: string): Promise<string> {
  const actor = actorFor(role);
  const panel = await InstagramPanel({ actor, channel: await getChannel(actor, channelId), canManage: role === "owner" || role === "admin", timezone: TZ });
  // Inside the app's TooltipProvider, as the page renders it.
  return renderToStaticMarkup(createElement(TooltipProvider, null, panel));
}

beforeEach(async () => {
  await db.delete(channels);
  await createBusiness();
});

describe("the Instagram panel [IG-10]", () => {
  it("owner and admin see the account, the token masked, until when it lasts, the webhook with its verify token and the buttons", async () => {
    const channel = await connectedChannel();
    for (const role of ["owner", "admin"] as const) {
      const html = await render(role, channel.id);
      expect(html).toContain("@peluqueria_aurora");
      expect(html).toContain("https://www.instagram.com/peluqueria_aurora/");
      expect(html).toContain(`Token ••••${TOKEN.slice(-4)}`);
      expect(html).not.toContain(TOKEN);
      // [IG-09] until when the token lasts, and that the app renews it.
      expect(html).toMatch(/Vale hasta el [^<]+· quedan (59|60) días\. La app lo renueva sola cada semana\./);
      expect(html).toContain(`/api/webhooks/instagram/${channel.id}`);
      expect(html).toContain(VERIFY_TOKEN);
      for (const button of BUTTONS) expect(html).toContain(button);
      for (const light of ["Token", "Caducidad del token", "Recepción", "Último mensaje"]) expect(html).toContain(light);
    }
  });

  it("[PER-03] [PER-07] Solo lectura sees the account and its lights, never the token, the verify token nor the buttons", async () => {
    const channel = await connectedChannel();
    const html = await render("viewer", channel.id);
    expect(html).toContain("@peluqueria_aurora");
    expect(html).not.toContain("••••");
    expect(html).not.toContain(VERIFY_TOKEN);
    for (const button of BUTTONS) expect(html).not.toContain(button);
  });

  it("[IG-10] a disconnected account offers to connect it again with its wizard", async () => {
    const channel = await createChannel({ type: "instagram", name: "Instagram", status: "disabled", config: { username: "peluqueria_aurora" } });
    const html = await render("owner", channel.id);
    expect(html).toContain("Esta cuenta está desconectada");
    expect(html).toContain(`/canales/nuevo/instagram?canal=${channel.id}`);
    for (const button of BUTTONS) expect(html).not.toContain(button);
  });

  it("[IG-13] a demo account only explains itself: no link to a profile, no webhook and no buttons", async () => {
    const channel = await createChannel({ type: "instagram", name: "Instagram", isDemo: true, config: { username: "peluqueria_aurora.demo" } });
    const html = await render("owner", channel.id);
    expect(html).toContain("Canal de demostración");
    expect(html).toContain("@peluqueria_aurora.demo");
    expect(html).not.toContain("instagram.com/peluqueria_aurora.demo");
    expect(html).not.toContain("/api/webhooks/instagram/");
    for (const button of BUTTONS) expect(html).not.toContain(button);
  });
});
