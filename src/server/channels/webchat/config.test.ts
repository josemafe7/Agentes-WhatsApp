import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { createBusiness, createChannel } from "@/test/factories";
import { listWidgetDemoChannels } from "./config";

beforeEach(async () => {
  await db.delete(channels);
  await createBusiness();
});

describe("chats offered on /widget-demo [WEB-12] [WEB-13]", () => {
  it("only enabled web chats, by name, and nothing else about them", async () => {
    const on = await createChannel({ type: "webchat", name: "B · Web" });
    const alsoOn = await createChannel({ type: "webchat", name: "A · Tienda" });
    const off = await createChannel({ type: "webchat", name: "C · Antigua" });
    await db.update(channels).set({ status: "disabled" }).where(eq(channels.id, off.id));
    await createChannel({ type: "whatsapp", name: "WhatsApp" });
    expect(await listWidgetDemoChannels()).toEqual([
      { id: alsoOn.id, name: "A · Tienda" },
      { id: on.id, name: "B · Web" },
    ]);
  });
});
