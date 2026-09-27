// Service worker of the installed app (docs/notificaciones-push.md «Service worker»): it shows the team's push notices
// and opens them inside the app. It never answers requests and stores nothing: pages with a session must never be
// kept on a device someone else may use. Plain JavaScript served as-is from /sw.js, with scope "/".
"use strict";

/** Shown when a push arrives without a readable title: something is always shown (Safari demands it). */
const DEFAULT_TITLE = "Tienes un aviso nuevo";
const DEFAULT_PATH = "/bandeja";
const ICON = "/api/push/icon?size=192";
const MAX_TITLE_LENGTH = 200;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** A path of this same app, or the inbox: never another site, "//host", "javascript:" or a backslash trick. */
function inAppPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return DEFAULT_PATH;
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search + url.hash : DEFAULT_PATH;
  } catch {
    return DEFAULT_PATH;
  }
}

/** Title and path of a push; only these two travel ([PWA-04]: what happened and with whom, never the customer's words). */
function readNotice(data) {
  let notice = null;
  try {
    notice = data ? data.json() : null;
  } catch {
    notice = null;
  }
  const title = notice && typeof notice.title === "string" && notice.title.trim() ? notice.title.trim().slice(0, MAX_TITLE_LENGTH) : DEFAULT_TITLE;
  return { title, path: inAppPath(notice && notice.link) };
}

self.addEventListener("push", (event) => {
  const { title, path } = readNotice(event.data);
  event.waitUntil(self.registration.showNotification(title, { icon: ICON, lang: "es", data: { path } }));
});

/** Focuses a window of the app already on the page, or takes an open one there, or opens a new one. */
async function openInApp(path) {
  const target = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const appWindows = windows.filter((client) => new URL(client.url).origin === self.location.origin);
  const onPage = appWindows.find((client) => client.url === target);
  if (onPage) return onPage.focus();
  if (appWindows.length > 0) {
    try {
      const focused = await appWindows[0].focus();
      return await focused.navigate(target);
    } catch {
      // A window this worker does not control cannot be moved: a new one opens instead.
    }
  }
  return self.clients.openWindow(target);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openInApp(inAppPath(event.notification.data && event.notification.data.path)));
});
