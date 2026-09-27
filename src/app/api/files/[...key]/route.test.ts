import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as null | { session: { id: string }; user: { id: string } },
  storageDir: "",
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));
vi.mock("@/server/adapters/file-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/adapters/file-storage")>();
  let storage: InstanceType<typeof actual.DiskStorage> | undefined;
  return {
    ...actual,
    getFileStorage: () => (storage ??= new actual.DiskStorage(state.storageDir)),
  };
});

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { agentContextFiles, agents, businessSettings, contactIdentities, contacts, conversations, kbDocuments, knowledgeBases, messages } from "@/db/schema";
import { getFileStorage } from "@/server/adapters/file-storage";
import { createBusiness, createChannel, createContactWithIdentity, createConversation, createMessage, createUser } from "@/test/factories";
import { GET, runtime } from "./route";

const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
);
const LOGO_KEY = "logos/2026/09/4f1d2c3b-aaaa-4bbb-8ccc-123456789abc.png";
const PRIVATE_KEY = "media/2026/09/9e8d7c6b-aaaa-4bbb-8ccc-123456789abc.png";
const HTML_KEY = "media/2026/09/5a5a5a5a-aaaa-4bbb-8ccc-123456789abc.html";
const AVATAR_KEY = "avatars/2026/09/7b7b7b7b-aaaa-4bbb-8ccc-123456789abc.png";
const AUDIO_KEY = "media/2026/09/1c1c1c1c-aaaa-4bbb-8ccc-123456789abc.ogg";
const PDF_KEY = "media/2026/09/2d2d2d2d-aaaa-4bbb-8ccc-123456789abc.pdf";
const PDF = new TextEncoder().encode("%PDF-1.4 fake");
const KNOWLEDGE_KEY = "knowledge/2026/09/3e3e3e3e-aaaa-4bbb-8ccc-123456789abc.pdf";
const CONTEXT_KEY = "context-files/2026/09/4f4f4f4f-aaaa-4bbb-8ccc-123456789abc.md";

const call = (key: string) =>
  GET(new Request(`http://localhost:3000/api/files/${key}`), { params: Promise.resolve({ key: key.split("/") }) });

const signIn = (userId: string | null) => {
  state.session = userId ? { session: { id: `s-${userId}` }, user: { id: userId } } : null;
};

beforeAll(async () => {
  state.storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "dominia-files-route-"));
  const storage = getFileStorage();
  await storage.put(LOGO_KEY, PNG, "image/png");
  await storage.put(PRIVATE_KEY, PNG, "image/png");
  await storage.put(HTML_KEY, new TextEncoder().encode("<script>alert(1)</script>"), "text/html");
  await storage.put(AVATAR_KEY, PNG, "image/png");
  await storage.put(AUDIO_KEY, new TextEncoder().encode("OggS-voice"), "audio/ogg; codecs=opus");
  await storage.put(PDF_KEY, PDF, "application/pdf");
  await storage.put(KNOWLEDGE_KEY, PDF, "application/pdf");
  await storage.put(CONTEXT_KEY, new TextEncoder().encode("# Tarifas"), "text/markdown");
});

afterAll(() => fs.rmSync(state.storageDir, { recursive: true, force: true }));

beforeEach(async () => {
  signIn(null);
  await createBusiness({ logoFileKey: LOGO_KEY });
});

describe("/api/files [SEG-04] [MED-08]", () => {
  it("runs on Node", () => {
    expect(runtime).toBe("nodejs");
  });

  it("serves the business logo without a session (legal pages, login, installed app) [PER-09]", async () => {
    const response = await call(LOGO_KEY);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-length")).toBe(String(PNG.byteLength));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it("a former logo is no longer public", async () => {
    await db.update(businessSettings).set({ logoFileKey: null });
    expect((await call(LOGO_KEY)).status).toBe(401);
  });

  it("never serves a private file without a session, even if its key is set as the logo", async () => {
    expect((await call(PRIVATE_KEY)).status).toBe(401);
    await db.update(businessSettings).set({ logoFileKey: PRIVATE_KEY });
    expect((await call(PRIVATE_KEY)).status).toBe(401);
  });

  it("with a session, a file whose record type is not known is «not found» (no hint that it exists)", async () => {
    const owner = await createUser("owner");
    signIn(owner.userId);
    const response = await call(PRIVATE_KEY);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "No se ha encontrado." });
  });

  it("an agent's avatar is served only to people who may see agents", async () => {
    const [agent] = await db.insert(agents).values({ name: "Recepción", avatarFileKey: AVATAR_KEY }).returning();
    const viewer = await createUser("viewer");
    signIn(viewer.userId);
    const response = await call(AVATAR_KEY);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const agentUser = await createUser("agent");
    signIn(agentUser.userId);
    expect((await call(AVATAR_KEY)).status).toBe(404);
    signIn(null);
    expect((await call(AVATAR_KEY)).status).toBe(401);
    await db.delete(agents).where(eq(agents.id, agent.id));
  });

  it("a deactivated user is treated as signed out", async () => {
    const disabled = await createUser("admin", { disabled: true });
    signIn(disabled.userId);
    expect((await call(PRIVATE_KEY)).status).toBe(401);
  });

  it.each(["..%2F..%2F.env", "logos/../../.env", "logos/2026/09/NO.png", "logos/"])("rejects the invalid key %s with 404", async (key) => {
    expect((await call(key)).status).toBe(404);
  });

  it("answers 404 for a public key whose file is missing", async () => {
    const missing = "logos/2026/09/00000000-aaaa-4bbb-8ccc-123456789abc.png";
    await db.update(businessSettings).set({ logoFileKey: missing });
    expect((await call(missing)).status).toBe(404);
  });
});

describe("message files: only for people who can see that conversation [MED-08] [PER-02]", () => {
  beforeEach(async () => {
    for (const table of [messages, conversations, contactIdentities, contacts]) await db.delete(table);
  });

  async function conversationWithFiles(options: { isTest?: boolean } = {}) {
    const channel = await createChannel({ type: "webchat" });
    const { contact } = await createContactWithIdentity("webchat");
    const conversation = await createConversation(channel.id, contact.id, { isTest: options.isTest ?? false });
    await createMessage(conversation, { contentType: "audio", text: null, media: { fileKey: AUDIO_KEY, mimeType: "audio/ogg; codecs=opus", size: 10 } });
    await createMessage(conversation, {
      contentType: "document",
      text: null,
      media: { fileKey: PDF_KEY, mimeType: "application/pdf", size: PDF.byteLength, fileName: "Presupuesto «boda» 2026.pdf" },
    });
    return channel;
  }

  it("the team of the channel gets the file, privately and never sniffed; an audio plays in the page", async () => {
    const channel = await conversationWithFiles();
    for (const user of [await createUser("owner"), await createUser("viewer"), await createUser("agent", { channelIds: [channel.id] })]) {
      signIn(user.userId);
      const response = await call(AUDIO_KEY);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("audio/ogg; codecs=opus");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("content-disposition")).toBe("inline");
    }
  });

  it("an agent of other channels gets «not found», and without a session it is 401", async () => {
    await conversationWithFiles();
    const otherChannel = await createChannel({ type: "webchat" });
    const outsider = await createUser("agent", { channelIds: [otherChannel.id] });
    signIn(outsider.userId);
    expect((await call(AUDIO_KEY)).status).toBe(404);
    expect((await call(PDF_KEY)).status).toBe(404);
    signIn(null);
    expect((await call(AUDIO_KEY)).status).toBe(401);
  });

  it("files of «Probar agente» conversations are never served", async () => {
    await conversationWithFiles({ isTest: true });
    const owner = await createUser("owner");
    signIn(owner.userId);
    expect((await call(AUDIO_KEY)).status).toBe(404);
  });

  it("a document is downloaded with its original name, never shown in the page", async () => {
    await conversationWithFiles();
    const owner = await createUser("owner");
    signIn(owner.userId);
    const response = await call(PDF_KEY);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="Presupuesto _boda_ 2026.pdf"; filename*=UTF-8''Presupuesto%20%C2%ABboda%C2%BB%202026.pdf`,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
  });
});

describe("byte ranges of audio and video, which Safari and iOS need to play them [MED-08] [SEG-04]", () => {
  const VIDEO_KEY = "media/2026/09/3c3c3c3c-aaaa-4bbb-8ccc-123456789abc.mp4";
  const VIDEO = Uint8Array.from({ length: 100 }, (_, index) => index);

  const ranged = (key: string, headers: Record<string, string>) =>
    GET(new Request(`http://localhost:3000/api/files/${key}`, { headers }), { params: Promise.resolve({ key: key.split("/") }) });
  const bytesOf = async (response: Response) => [...new Uint8Array(await response.arrayBuffer())];

  beforeAll(async () => {
    await getFileStorage().put(VIDEO_KEY, VIDEO, "video/mp4");
  });

  beforeEach(async () => {
    for (const table of [messages, conversations, contactIdentities, contacts]) await db.delete(table);
    const channel = await createChannel({ type: "webchat" });
    const { contact } = await createContactWithIdentity("webchat");
    const conversation = await createConversation(channel.id, contact.id);
    await createMessage(conversation, { contentType: "video", text: null, media: { fileKey: VIDEO_KEY, mimeType: "video/mp4", size: VIDEO.byteLength } });
    await createMessage(conversation, { contentType: "audio", text: null, media: { fileKey: AUDIO_KEY, mimeType: "audio/ogg; codecs=opus", size: 10 } });
    await createMessage(conversation, { contentType: "document", text: null, media: { fileKey: PDF_KEY, mimeType: "application/pdf", size: PDF.byteLength } });
    signIn((await createUser("owner")).userId);
  });

  it("says it accepts ranges, and answers one with 206, Content-Range and only those bytes", async () => {
    const whole = await call(VIDEO_KEY);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(await bytesOf(whole)).toHaveLength(100);

    const cases: [string, number, number][] = [
      ["bytes=0-1", 0, 1],
      ["bytes=10-19", 10, 19],
      ["bytes=90-", 90, 99],
      ["bytes=-5", 95, 99],
      ["bytes=95-500", 95, 99],
    ];
    for (const [range, start, end] of cases) {
      const response = await ranged(VIDEO_KEY, { range });
      expect(response.status, range).toBe(206);
      expect(response.headers.get("content-range"), range).toBe(`bytes ${start}-${end}/100`);
      expect(response.headers.get("content-length"), range).toBe(String(end - start + 1));
      expect(response.headers.get("accept-ranges")).toBe("bytes");
      // Still private, never sniffed, sandboxed and shown in the page.
      expect(response.headers.get("content-type")).toBe("video/mp4");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toBe("sandbox");
      expect(response.headers.get("content-disposition")).toBe("inline");
      expect(await bytesOf(response), range).toEqual([...VIDEO.slice(start, end + 1)]);
    }
  });

  it("voice notes too", async () => {
    const response = await ranged(AUDIO_KEY, { range: "bytes=0-3" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-3/10");
    expect(new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()))).toBe("OggS");
  });

  it("a range past the end answers 416 with the size, and no bytes", async () => {
    for (const range of ["bytes=100-", "bytes=500-600", "bytes=-0"]) {
      const response = await ranged(VIDEO_KEY, { range });
      expect(response.status, range).toBe(416);
      expect(response.headers.get("content-range"), range).toBe("bytes */100");
      expect(await bytesOf(response)).toEqual([]);
    }
  });

  it("anything that is not one plain range, or comes with If-Range, gets the whole file", async () => {
    for (const range of ["bytes=5-2", "bytes=0-1,5-6", "items=0-1", "bytes=a-b", "bytes=-", "bytes=1.5-2"]) {
      const response = await ranged(VIDEO_KEY, { range });
      expect(response.status, range).toBe(200);
      expect(await bytesOf(response), range).toHaveLength(100);
    }
    const conditional = await ranged(VIDEO_KEY, { range: "bytes=0-1", "if-range": '"otra-version"' });
    expect(conditional.status).toBe(200);
  });

  it("documents and images are always served whole", async () => {
    const response = await ranged(PDF_KEY, { range: "bytes=0-1" });
    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
  });

  it("the permission checks come first: without a session 401, without permission 404, never a byte", async () => {
    signIn(null);
    const anonymous = await ranged(VIDEO_KEY, { range: "bytes=0-1" });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("content-range")).toBeNull();
    const otherChannel = await createChannel({ type: "webchat" });
    signIn((await createUser("agent", { channelIds: [otherChannel.id] })).userId);
    const outsider = await ranged(VIDEO_KEY, { range: "bytes=0-1" });
    expect(outsider.status).toBe(404);
    expect(outsider.headers.get("content-range")).toBeNull();
  });
});

describe("response headers of served files", () => {
  it("images are shown inline; anything that could run code is downloaded and sandboxed", async () => {
    const { fileResponseHeaders } = await import("./serve");
    expect(fileResponseHeaders({ contentType: "image/png", size: 10 }, "public")).toMatchObject({
      "Content-Type": "image/png",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    });
    expect(fileResponseHeaders({ contentType: "text/html", size: 10 }, "private")).toMatchObject({
      "Content-Disposition": "attachment",
      "Cache-Control": "private, no-store",
    });
    expect(fileResponseHeaders({ contentType: "image/svg+xml", size: 10 }, "private")["Content-Disposition"]).toBe("attachment");
  });

  it("a download name cannot break the header", async () => {
    const { fileResponseHeaders } = await import("./serve");
    const disposition = fileResponseHeaders({ contentType: "application/pdf", size: 10 }, "private", 'a"b\\c\r\nX-Evil: 1.pdf')["Content-Disposition"];
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition).toBe(`attachment; filename="a_b_cX-Evil: 1.pdf"; filename*=UTF-8''a%22b%5CcX-Evil%3A%201.pdf`);
    // Images keep showing in the page, whatever their name.
    expect(fileResponseHeaders({ contentType: "image/png", size: 10 }, "private", "foto.png")["Content-Disposition"]).toBe("inline");
  });
});

describe("knowledge originals: documents of a base and an agent's context files [CON-15] [SEG-04]", () => {
  beforeEach(async () => {
    for (const table of [kbDocuments, knowledgeBases, agentContextFiles]) await db.delete(table);
  });

  it("a document's file is downloaded by people who may see Conocimiento, never shown in the page; the Agent role gets «not found»", async () => {
    const [base] = await db.insert(knowledgeBases).values({ name: "Información del negocio" }).returning();
    await db.insert(kbDocuments).values({ kbId: base.id, sourceType: "file", title: "Normas", fileKey: KNOWLEDGE_KEY, fileName: "Normas.pdf", status: "ready" });
    for (const role of ["owner", "supervisor", "viewer"] as const) {
      signIn((await createUser(role)).userId);
      const response = await call(KNOWLEDGE_KEY);
      expect(response.status, role).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("content-disposition")).toMatch(/^attachment/);
    }
    signIn((await createUser("agent")).userId);
    expect((await call(KNOWLEDGE_KEY)).status).toBe(404);
    signIn(null);
    expect((await call(KNOWLEDGE_KEY)).status).toBe(401);
  });

  it("a key under knowledge/ that no document owns (deleted) is «not found»", async () => {
    signIn((await createUser("owner")).userId);
    expect((await call(KNOWLEDGE_KEY)).status).toBe(404);
  });

  it("an agent's context file goes to people who may see agents", async () => {
    const [agent] = await db.insert(agents).values({ name: "Recepción" }).returning();
    await db.insert(agentContextFiles).values({ agentId: agent.id, title: "Tarifas", contentMd: "# Tarifas", sourceFileKey: CONTEXT_KEY });
    signIn((await createUser("viewer")).userId);
    expect((await call(CONTEXT_KEY)).status).toBe(200);
    signIn((await createUser("agent")).userId);
    expect((await call(CONTEXT_KEY)).status).toBe(404);
    await db.delete(agentContextFiles);
    await db.delete(agents).where(eq(agents.id, agent.id));
  });
});
