// public/sw.js runs in the browser: here it runs in a sandbox with a fake `self` (registration, clients) to check what
// it does with each event (docs/notificaciones-push.md «Service worker»).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { appIconUrl } from "./app-icon";

const SOURCE = fs.readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
const ORIGIN = "https://atencion.peluqueria.test";

type WorkerEvent = Record<string, unknown> & { waitUntil: (promise: Promise<unknown>) => void };
type FakeWindow = { url: string; focus: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn> };

function fakeWindow(url: string, options: { controlled?: boolean } = {}): FakeWindow {
  const client: FakeWindow = {
    url,
    focus: vi.fn(async () => client),
    navigate: vi.fn(async (target: string) => {
      if (options.controlled === false) throw new TypeError("This client is not controlled by this service worker.");
      client.url = target;
      return client;
    }),
  };
  return client;
}

function startWorker(windows: FakeWindow[] = []) {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: (event: WorkerEvent) => void) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => undefined),
    registration: { showNotification: vi.fn(async () => undefined) },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async () => null),
    },
  };
  vm.runInNewContext(SOURCE, { self, URL, console });

  async function dispatch(type: string, init: Record<string, unknown> = {}): Promise<void> {
    const pending: Promise<unknown>[] = [];
    const listener = listeners.get(type);
    if (!listener) throw new Error(`public/sw.js does not handle «${type}»`);
    listener({ ...init, waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
  }

  const pushData = (value: unknown) => ({ json: () => (typeof value === "string" ? JSON.parse(value) : value) });
  const push = (value: unknown) => dispatch("push", { data: value === undefined ? null : pushData(value) });
  const click = (data: unknown) => dispatch("notificationclick", { notification: { data, close: vi.fn() } });
  return { self, listeners, dispatch, push, click };
}

describe("public/sw.js: the push notice [PWA-04]", () => {
  it("shows the notice with its title and keeps the in-app link to open", async () => {
    const worker = startWorker();
    await worker.push({ title: "Traspaso: Ana", link: "/bandeja/c-1" });
    expect(worker.self.registration.showNotification).toHaveBeenCalledWith(
      "Traspaso: Ana",
      // The app's own icon (the business logo or its initials), the same route the manifest uses.
      expect.objectContaining({ data: { path: "/bandeja/c-1" }, icon: appIconUrl(192, "any") }),
    );
  });

  it("always shows something, even for an empty or unreadable push (Safari withdraws the permission otherwise)", async () => {
    for (const data of [undefined, "{no es json", { title: 42 }, { title: "   " }]) {
      const worker = startWorker();
      await worker.push(data);
      expect(worker.self.registration.showNotification).toHaveBeenCalledWith("Tienes un aviso nuevo", expect.objectContaining({ data: { path: "/bandeja" } }));
    }
  });

  it("never carries text other than the title", async () => {
    const worker = startWorker();
    await worker.push({ title: "Traspaso: Ana", body: "Texto del cliente", link: "/bandeja/c-1" });
    const [, options] = worker.self.registration.showNotification.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(JSON.stringify(options)).not.toContain("Texto del cliente");
  });

  it("a link to anywhere but this app opens the inbox instead", async () => {
    for (const link of ["https://malo.example/robar", "//malo.example", "javascript:alert(1)", "/\\malo.example", 7]) {
      const worker = startWorker();
      await worker.push({ title: "Aviso", link });
      expect(worker.self.registration.showNotification).toHaveBeenCalledWith("Aviso", expect.objectContaining({ data: { path: "/bandeja" } }));
    }
  });
});

describe("public/sw.js: opening a notice", () => {
  it("focuses a window of the app that is already on that page", async () => {
    const onPage = fakeWindow(`${ORIGIN}/bandeja/c-1`);
    const elsewhere = fakeWindow(`${ORIGIN}/agenda`);
    const worker = startWorker([elsewhere, onPage]);
    await worker.click({ path: "/bandeja/c-1" });
    expect(onPage.focus).toHaveBeenCalled();
    expect(elsewhere.navigate).not.toHaveBeenCalled();
    expect(worker.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it("takes an open window of the app to the page, instead of opening another", async () => {
    const open = fakeWindow(`${ORIGIN}/agenda`);
    const worker = startWorker([open]);
    await worker.click({ path: "/bandeja/c-1" });
    expect(open.focus).toHaveBeenCalled();
    expect(open.navigate).toHaveBeenCalledWith(`${ORIGIN}/bandeja/c-1`);
    expect(worker.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it("opens the page when no window of the app is open (or it cannot be moved)", async () => {
    const worker = startWorker([fakeWindow("https://otra-web.example/", {}), fakeWindow(`${ORIGIN}/agenda`, { controlled: false })]);
    await worker.click({ path: "/bandeja/c-1" });
    expect(worker.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/bandeja/c-1`);
  });

  it("only ever opens a page of this app", async () => {
    const worker = startWorker();
    await worker.click({ path: "https://malo.example/robar" });
    expect(worker.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/bandeja`);
  });
});

describe("public/sw.js: updates and caching", () => {
  it("a new version takes over at once", async () => {
    const worker = startWorker();
    await worker.dispatch("install");
    await worker.dispatch("activate");
    expect(worker.self.skipWaiting).toHaveBeenCalled();
    expect(worker.self.clients.claim).toHaveBeenCalled();
  });

  it("never answers requests or caches pages: nothing private stays on a shared device", () => {
    const worker = startWorker();
    expect([...worker.listeners.keys()].sort()).toEqual(["activate", "install", "notificationclick", "push"]);
    // No Cache Storage at all (caches.open…).
    expect(SOURCE).not.toMatch(/\bcaches\s*\./);
  });
});
