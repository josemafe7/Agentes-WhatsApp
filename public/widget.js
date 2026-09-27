/*!
 * DominIA Agentes · chat web (widget) — [WEB-01]…[WEB-13]
 * <script src="https://{dominio}/widget.js" data-channel="{id}" async></script>
 * JavaScript ES2019 sin dependencias. Se dibuja dentro de un Shadow DOM (sin iframe): no hereda ni rompe los
 * estilos de la web donde se pega. Todo el texto que llega (mensajes, nombres, textos del canal) se pinta con
 * textContent, nunca como HTML.
 */
(function () {
  "use strict";

  var ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var HEX_PATTERN = /^#[0-9a-f]{6}$/i;
  var POLL_MIN_MS = 3000;
  var POLL_MAX_OPEN_MS = 10000;
  var POLL_MAX_CLOSED_MS = 30000;
  var POLL_MAX_ERROR_MS = 60000;
  /** After this long in a hidden tab, the chat reloads its history instead of asking for the changes. */
  var RESYNC_AFTER_HIDDEN_MS = 5 * 60 * 1000;
  var MAX_RECORDING_MS = 2 * 60 * 1000;
  var NOTICE_MS = 8000;
  var CONFIG_RETRIES = 3;
  var TALK_TO_PERSON = "Quiero hablar con una persona.";

  var TEXTS = {
    open: function (name) {
      return "Abrir el chat de " + name;
    },
    openUnread: function (name) {
      return "Abrir el chat de " + name + " (tienes mensajes nuevos)";
    },
    close: "Cerrar el chat",
    aiSubtitle: "Te responde un asistente con IA · Puedes pedir hablar con una persona",
    humanSubtitle: "Te responde una persona del equipo",
    inputLabel: "Escribe tu mensaje",
    placeholder: "Escribe tu mensaje…",
    send: "Enviar mensaje",
    attach: "Adjuntar una imagen",
    record: "Grabar una nota de voz",
    recording: "Grabando",
    stopAndSend: "Enviar la nota de voz",
    cancelRecording: "Descartar la nota de voz",
    talkToPerson: "Hablar con una persona",
    leaveDetails: "Dejar mis datos",
    privacyBefore: "Al escribir aceptas la ",
    privacyLink: "política de privacidad",
    connecting: "Conectando…",
    offline: "Sin conexión · Reintentando…",
    typing: "Escribiendo…",
    handedOff: "Una persona te atenderá pronto.",
    unavailable: "El chat no está disponible en este momento.",
    sending: "Enviando…",
    sent: "Enviado",
    notSent: "No se ha enviado",
    retry: "Reintentar",
    tooMany: "Demasiados mensajes, espera un momento.",
    tooLong: function (max) {
      return "Como máximo, " + formatNumber(max) + " caracteres.";
    },
    fileTooBig: function (bytes) {
      return "El archivo es demasiado grande. Como máximo, " + Math.round(bytes / (1024 * 1024)) + " MB.";
    },
    micDenied: "No se puede usar el micrófono. Revisa los permisos del navegador.",
    image: "Imagen",
    voiceNote: "Nota de voz",
    file: "Archivo adjunto",
    download: "Descargar",
    aiAuthor: "Asistente IA",
    formTitle: "Tus datos de contacto",
    formHint: "Rellena solo lo que quieras compartir.",
    formName: "Nombre",
    formEmail: "Email",
    formPhone: "Teléfono",
    formSend: "Enviar datos",
    formCancel: "Cancelar",
    formEmpty: "Escribe al menos un dato.",
    genericError: "No se ha podido enviar. Inténtalo de nuevo.",
  };

  var ICONS = {
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    mic: '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
    stop: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  };

  var STYLES = [
    ":host{all:initial}",
    "*,*::before,*::after{box-sizing:border-box}",
    ".root{font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.45;color:#09090b;-webkit-font-smoothing:antialiased}",
    ".sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}",
    "button{font:inherit;color:inherit;cursor:pointer}",
    "button:disabled{cursor:default;opacity:.5}",
    "button:focus-visible,a:focus-visible,textarea:focus-visible,input:focus-visible,audio:focus-visible{outline:2px solid var(--dc-primary);outline-offset:2px}",
    "svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}",
    ".launcher{position:fixed;bottom:calc(20px + env(safe-area-inset-bottom,0px));width:56px;height:56px;border-radius:9999px;border:0;background:var(--dc-primary);color:var(--dc-primary-fg);display:flex;align-items:center;justify-content:center;box-shadow:0 10px 15px -3px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.1);z-index:2147483000;padding:0;overflow:visible;transition:transform .15s ease}",
    ".launcher:hover{transform:scale(1.04)}",
    ".launcher svg{width:26px;height:26px}",
    ".launcher img{width:56px;height:56px;border-radius:9999px;object-fit:cover}",
    ".right .launcher{right:calc(20px + env(safe-area-inset-right,0px))}",
    ".left .launcher{left:calc(20px + env(safe-area-inset-left,0px))}",
    ".dot{position:absolute;top:2px;right:2px;width:14px;height:14px;border-radius:9999px;background:#e7000b;border:2px solid #fff}",
    ".panel{position:fixed;bottom:calc(88px + env(safe-area-inset-bottom,0px));width:380px;max-width:calc(100vw - 40px);height:640px;max-height:calc(100vh - 108px);max-height:calc(100dvh - 108px);background:#fff;border:1px solid #e4e4e7;border-radius:16px;box-shadow:0 10px 15px -3px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.1);display:flex;flex-direction:column;overflow:hidden;z-index:2147483001;transition:opacity .2s ease,transform .2s ease}",
    ".panel[hidden]{display:none}",
    ".right .panel{right:calc(20px + env(safe-area-inset-right,0px))}",
    ".left .panel{left:calc(20px + env(safe-area-inset-left,0px))}",
    ".header{display:flex;align-items:center;gap:12px;padding:12px 8px 12px 16px;border-bottom:1px solid #e4e4e7}",
    ".brand{width:36px;height:36px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:var(--dc-primary);color:var(--dc-primary-fg);font-weight:600;font-size:14px;overflow:hidden}",
    ".brand img{width:100%;height:100%;object-fit:contain;background:#fff}",
    ".heading{flex:1;min-width:0}",
    ".title{margin:0;font-size:15px;font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".subtitle{margin:2px 0 0;font-size:12px;color:#65656f}",
    ".icon-button{width:44px;height:44px;border:0;border-radius:10px;background:transparent;color:#65656f;display:inline-flex;align-items:center;justify-content:center;padding:0;flex-shrink:0}",
    ".icon-button:hover:not(:disabled){background:#f4f4f5;color:#09090b}",
    ".body{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:16px;display:flex;flex-direction:column;gap:12px}",
    ".intro{display:flex;flex-direction:column;gap:8px}",
    ".notice{margin:0;font-size:12px;color:#65656f}",
    ".notice a{color:var(--dc-link);text-decoration:underline;text-underline-offset:2px}",
    ".list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}",
    ".msg{display:flex;flex-direction:column;max-width:85%}",
    ".from-visitor{align-self:flex-end;align-items:flex-end}",
    ".from-business{align-self:flex-start;align-items:flex-start}",
    ".author{font-size:12px;color:#65656f;margin:0 4px 2px}",
    ".bubble{padding:8px 12px;border-radius:14.4px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}",
    ".from-visitor .bubble{background:var(--dc-primary);color:var(--dc-primary-fg);border-bottom-right-radius:4px}",
    ".from-business .bubble{background:#f4f4f5;color:#09090b;border-bottom-left-radius:4px}",
    ".bubble a{color:inherit;text-decoration:underline;text-underline-offset:2px}",
    ".bubble img{display:block;max-width:100%;max-height:240px;border-radius:8px;margin:2px 0}",
    ".bubble audio{display:block;max-width:240px;height:40px}",
    ".bubble .caption{margin-top:4px}",
    ".meta{font-size:12px;color:#65656f;margin:2px 4px 0;display:flex;align-items:center;gap:4px}",
    ".meta.error{color:#c10007}",
    ".text-button{min-height:44px;border:0;background:transparent;padding:0 8px;color:var(--dc-link);text-decoration:underline;text-underline-offset:2px;font-size:13px}",
    ".meta .text-button{color:#c10007;font-size:12px;padding:0 4px}",
    ".status{padding:0 16px;font-size:12px;color:#65656f;min-height:0}",
    ".status:not(:empty){padding:6px 16px}",
    ".status.warn{color:#bb4d00}",
    ".composer{border-top:1px solid #e4e4e7;padding:8px;display:flex;align-items:flex-end;gap:4px}",
    ".composer[hidden],.recorder[hidden],.actions[hidden]{display:none}",
    "textarea{flex:1;min-width:0;min-height:44px;max-height:120px;resize:none;border:1px solid #8b8b96;border-radius:10px;padding:11px 12px;font:inherit;font-size:14px;line-height:20px;color:#09090b;background:#fff}",
    "textarea::placeholder{color:#65656f}",
    ".send{background:var(--dc-primary);color:var(--dc-primary-fg)}",
    ".send:hover:not(:disabled){background:var(--dc-primary);color:var(--dc-primary-fg);filter:brightness(.95)}",
    ".counter{font-size:12px;color:#65656f;padding:0 16px 4px;text-align:right}",
    ".counter[hidden]{display:none}",
    ".recorder{border-top:1px solid #e4e4e7;padding:8px;display:flex;align-items:center;gap:8px}",
    ".recorder .label{flex:1;display:flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}",
    ".rec-dot{width:10px;height:10px;border-radius:9999px;background:#e7000b;animation:dc-pulse 1s ease-in-out infinite alternate}",
    "@keyframes dc-pulse{from{opacity:1}to{opacity:.3}}",
    ".actions{display:flex;flex-wrap:wrap;gap:0 4px;padding:0 8px 4px}",
    ".form{border:1px solid #e4e4e7;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px;background:#fff}",
    ".form h3{margin:0;font-size:14px;font-weight:600}",
    ".form p{margin:0;font-size:12px;color:#65656f}",
    ".form label{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:500}",
    ".form input{min-height:44px;border:1px solid #8b8b96;border-radius:8px;padding:8px 12px;font:inherit;font-size:14px;color:#09090b;background:#fff}",
    ".form .error{color:#c10007;font-size:12px}",
    ".form .buttons{display:flex;gap:8px;justify-content:flex-end}",
    ".button{min-height:44px;border-radius:10px;padding:0 16px;border:1px solid #e4e4e7;background:#fff;font-weight:500}",
    ".button.primary{background:var(--dc-primary);color:var(--dc-primary-fg);border-color:transparent}",
    ".unavailable{margin:auto 0;text-align:center;color:#65656f}",
    "@media (max-width:639px){.panel{top:0;left:0;right:0;bottom:0;width:100%;max-width:none;height:100%;height:100dvh;max-height:none;border-radius:0;border:0}.left .panel,.right .panel{left:0;right:0}.root.is-open .launcher{display:none}textarea,.form input{font-size:16px}}",
    "@media (prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}.launcher:hover{transform:none}}",
  ].join("\n");

  function formatNumber(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function randomId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(bytes, function (b) {
      return (b + 0x100).toString(16).slice(1);
    }).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }

  function initials(name) {
    var words = String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
    var letters = words.map(function (word) {
      return word.charAt(0).toUpperCase();
    }).join("");
    return letters || "·";
  }

  function el(tag, attributes, children) {
    var node = document.createElement(tag);
    if (attributes) {
      Object.keys(attributes).forEach(function (name) {
        var value = attributes[name];
        if (value === null || value === undefined || value === false) return;
        if (name === "text") node.textContent = value;
        else if (name === "className") node.className = value;
        else node.setAttribute(name, value === true ? "" : String(value));
      });
    }
    (children || []).forEach(function (child) {
      if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function icon(name) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    // Constant markup from ICONS, never data from the server.
    svg.innerHTML = ICONS[name];
    return svg;
  }

  /** Text with its web addresses as links (http and https only), everything as text nodes. */
  function linkify(text) {
    var fragment = document.createDocumentFragment();
    var pattern = /https?:\/\/[^\s<>"']+/g;
    var last = 0;
    var match;
    while ((match = pattern.exec(text))) {
      var url = match[0].replace(/[.,;:!?)\]]+$/, "");
      if (match.index > last) fragment.appendChild(document.createTextNode(text.slice(last, match.index)));
      var link = el("a", { href: url, target: "_blank", rel: "noopener noreferrer nofollow", text: url });
      fragment.appendChild(link);
      last = match.index + url.length;
      pattern.lastIndex = last;
    }
    if (last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)));
    return fragment;
  }

  function createStore(key) {
    var memory = null;
    return {
      read: function () {
        try {
          var raw = window.localStorage.getItem(key);
          return raw ? JSON.parse(raw) : memory;
        } catch (error) {
          return memory;
        }
      },
      write: function (value) {
        memory = value;
        try {
          if (value) window.localStorage.setItem(key, JSON.stringify(value));
          else window.localStorage.removeItem(key);
        } catch (error) {
          // Storage blocked (private mode, third-party rules): the chat still works until the page reloads.
        }
      },
    };
  }

  function createWidget(channelId, base) {
    var apiBase = base + "/api/widget/" + channelId;
    var store = createStore("dominia-chat:" + channelId);
    var destroyed = false;
    var config = null;
    var session = null;
    var sessionPromise = null;
    var cursor = null;
    var messages = [];
    var byId = {};
    var byClientId = {};
    var mediaUrls = {};
    var isOpen = false;
    var unavailable = false;
    var connection = "idle";
    var remoteState = { typing: false, handedOff: false };
    var notice = null;
    var noticeTimer = null;
    var pollTimer = null;
    var pollDelay = POLL_MIN_MS;
    var pollErrors = 0;
    var polling = false;
    var hiddenAt = null;
    var recording = null;
    var form = null;
    var atLimit = false;
    var connectTimer = null;
    var ui = {};

    // ─── Network ──────────────────────────────────────────────────────────────────────────────────────

    function request(method, path, options) {
      options = options || {};
      var headers = {};
      var body;
      if (options.token) headers.Authorization = "Bearer " + options.token;
      if (options.json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(options.json);
      } else if (options.blob) {
        headers["Content-Type"] = options.blob.type || "application/octet-stream";
        body = options.blob;
      }
      return fetch(apiBase + path, { method: method, headers: headers, body: body, mode: "cors", credentials: "omit", cache: "no-store" })
        .then(function (response) {
          return response
            .json()
            .catch(function () {
              return null;
            })
            .then(function (data) {
              return { ok: response.ok, status: response.status, data: data || {} };
            });
        })
        .catch(function () {
          return { ok: false, status: 0, data: {} };
        });
    }

    function errorText(result) {
      if (result.status === 429) return (result.data && result.data.error) || TEXTS.tooMany;
      if (result.status === 0) return TEXTS.notSent;
      return (result.data && typeof result.data.error === "string" && result.data.error) || TEXTS.genericError;
    }

    function isDisabled(result) {
      return result.status === 403 && result.data && result.data.code === "channel_disabled";
    }

    // ─── Session and polling ──────────────────────────────────────────────────────────────────────────

    function ensureSession() {
      if (session) return Promise.resolve(true);
      if (sessionPromise) return sessionPromise;
      var stored = store.read();
      setConnection("connecting");
      sessionPromise = request("POST", "/session", { json: { token: stored && stored.token ? stored.token : null } }).then(function (result) {
        sessionPromise = null;
        if (destroyed) return false;
        if (isDisabled(result)) {
          setUnavailable();
          return false;
        }
        if (!result.ok || !result.data.token) {
          setConnection(result.status === 0 ? "offline" : "idle");
          if (result.status === 429) showNotice(errorText(result));
          return false;
        }
        var sameVisitor = stored && stored.visitorId === result.data.visitorId;
        session = { token: result.data.token, visitorId: result.data.visitorId };
        store.write({ token: session.token, visitorId: session.visitorId, lastReadAt: sameVisitor ? stored.lastReadAt || null : null });
        cursor = result.data.cursor;
        setConnection("ok");
        mergeMessages(result.data.messages || [], true);
        applyState(result.data.state);
        return true;
      });
      return sessionPromise;
    }

    /** Opens the session and starts polling; while offline, tries again every few seconds. */
    function connect() {
      clearTimeout(connectTimer);
      ensureSession().then(function (ok) {
        if (ok) return pollSoon();
        if (!destroyed && !unavailable && connection === "offline") connectTimer = setTimeout(connect, 5000);
      });
    }

    function forgetSession() {
      session = null;
      store.write(null);
    }

    function schedulePoll(delay) {
      clearTimeout(pollTimer);
      if (destroyed || unavailable || !session || document.hidden) return;
      pollTimer = setTimeout(poll, delay);
    }

    function pollSoon() {
      pollDelay = POLL_MIN_MS;
      schedulePoll(1500);
    }

    function poll() {
      if (polling || !session) return;
      polling = true;
      request("GET", "/messages?cursor=" + encodeURIComponent(cursor), { token: session.token }).then(function (result) {
        polling = false;
        if (destroyed) return;
        if (isDisabled(result)) return setUnavailable();
        if (result.status === 401) {
          forgetSession();
          if (isOpen) connect();
          return;
        }
        if (!result.ok) {
          pollErrors += 1;
          if (result.status === 0) setConnection("offline");
          return schedulePoll(Math.min(POLL_MIN_MS * Math.pow(2, pollErrors), POLL_MAX_ERROR_MS));
        }
        pollErrors = 0;
        setConnection("ok");
        cursor = result.data.cursor || cursor;
        var changed = mergeMessages(result.data.messages || [], false);
        applyState(result.data.state);
        // Fast while something is happening, slower and slower while nothing does.
        if (changed || remoteState.typing) pollDelay = POLL_MIN_MS;
        else pollDelay = Math.min(Math.round(pollDelay * 1.5), isOpen ? POLL_MAX_OPEN_MS : POLL_MAX_CLOSED_MS);
        schedulePoll(pollDelay);
      });
    }

    function resync() {
      session = null;
      connect();
    }

    function onVisibilityChange() {
      if (document.hidden) {
        hiddenAt = Date.now();
        clearTimeout(pollTimer);
        return;
      }
      var hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = null;
      if (!session) return;
      if (hiddenFor > RESYNC_AFTER_HIDDEN_MS) resync();
      else {
        pollDelay = POLL_MIN_MS;
        schedulePoll(0);
      }
    }

    // ─── Messages ─────────────────────────────────────────────────────────────────────────────────────

    function lastReadAt() {
      var stored = store.read();
      return stored && stored.lastReadAt ? stored.lastReadAt : null;
    }

    function markRead() {
      var latest = null;
      messages.forEach(function (message) {
        if (message.id && (!latest || message.createdAt > latest)) latest = message.createdAt;
      });
      var stored = store.read();
      if (stored && latest) {
        stored.lastReadAt = latest;
        store.write(stored);
      }
      setUnread(false);
    }

    /** Adds or updates messages from the server; returns whether anything new arrived. */
    function mergeMessages(list, fromSession) {
      var added = false;
      var newReplies = [];
      var readUpTo = lastReadAt();
      list.forEach(function (incoming) {
        if (!incoming || !incoming.id) return;
        var existing = byId[incoming.id] || (incoming.clientId && byClientId[incoming.clientId]);
        if (existing) {
          existing.id = incoming.id;
          existing.text = incoming.text;
          existing.media = incoming.media || existing.media;
          existing.createdAt = incoming.createdAt;
          existing.pending = false;
          existing.failed = false;
          byId[incoming.id] = existing;
          renderMessage(existing);
          return;
        }
        var message = {
          id: incoming.id,
          clientId: incoming.clientId || null,
          from: incoming.from,
          author: incoming.author,
          kind: incoming.kind,
          text: incoming.text,
          media: incoming.media,
          createdAt: incoming.createdAt,
        };
        byId[message.id] = message;
        if (message.clientId) byClientId[message.clientId] = message;
        messages.push(message);
        renderMessage(message);
        added = true;
        if (message.from === "business" && (!readUpTo || message.createdAt > readUpTo)) newReplies.push(message);
      });
      if (added) scrollToEnd();
      if (newReplies.length > 0) {
        if (isOpen) {
          if (!fromSession) announce(newReplies);
          markRead();
        } else {
          setUnread(true);
        }
      }
      return added;
    }

    function addLocal(message) {
      message.clientId = message.clientId || randomId();
      message.from = "visitor";
      message.createdAt = new Date().toISOString();
      byClientId[message.clientId] = message;
      messages.push(message);
      renderMessage(message);
      scrollToEnd(true);
      return message;
    }

    function deliver(message) {
      message.pending = true;
      message.failed = false;
      message.error = null;
      renderMessage(message);
      ensureSession()
        .then(function (ok) {
          if (!ok) return { ok: false, status: unavailable ? 403 : 0, data: {} };
          if (message.blob && !message.upload) {
            return request("POST", "/upload", { token: session.token, blob: message.blob }).then(function (uploaded) {
              if (!uploaded.ok) return uploaded;
              message.upload = uploaded.data.upload;
              return send(message);
            });
          }
          return send(message);
        })
        .then(function (result) {
          if (destroyed) return;
          if (result.ok) {
            if (result.data.message) mergeMessages([result.data.message], false);
            message.pending = false;
            renderMessage(message);
            applyState(result.data.state);
            pollSoon();
            return;
          }
          if (isDisabled(result)) return setUnavailable();
          if (result.status === 401) forgetSession();
          message.pending = false;
          message.failed = true;
          message.error = errorText(result);
          // A retry does not help with a message the chat refuses (too long, type not allowed…).
          message.retryable = result.status === 0 || result.status === 401 || result.status === 429 || result.status >= 500;
          if (result.status === 429) showNotice(message.error);
          renderMessage(message);
        });
    }

    function send(message) {
      var body = { clientMessageId: message.clientId };
      if (message.upload) body.upload = message.upload;
      else if (message.contact) body.contact = message.contact;
      else body.text = message.text;
      return request("POST", "/messages", { token: session.token, json: body });
    }

    function sendText(text) {
      deliver(addLocal({ kind: "text", text: text }));
    }

    function sendFile(blob, kind) {
      if (config.maxUploadBytes && blob.size > config.maxUploadBytes) {
        showNotice(TEXTS.fileTooBig(config.maxUploadBytes));
        return;
      }
      var message = addLocal({ kind: kind, text: null, blob: blob, localUrl: URL.createObjectURL(blob) });
      deliver(message);
    }

    // ─── Rendering ────────────────────────────────────────────────────────────────────────────────────

    function mediaUrl(message) {
      if (message.localUrl) return Promise.resolve(message.localUrl);
      var key = message.media && message.media.key;
      if (!key || !session) return Promise.resolve(null);
      if (mediaUrls[key]) return mediaUrls[key];
      var path = "/media/" + key.split("/").map(encodeURIComponent).join("/");
      mediaUrls[key] = fetch(apiBase + path, { headers: { Authorization: "Bearer " + session.token }, mode: "cors", credentials: "omit", cache: "no-store" })
        .then(function (response) {
          if (!response.ok) throw new Error("media");
          return response.blob();
        })
        .then(function (blob) {
          return URL.createObjectURL(blob);
        })
        .catch(function () {
          delete mediaUrls[key];
          return null;
        });
      return mediaUrls[key];
    }

    function mediaNode(message) {
      if (message.kind === "image") {
        var image = el("img", { alt: message.from === "visitor" ? "Imagen enviada" : TEXTS.image });
        mediaUrl(message).then(function (url) {
          if (url) image.src = url;
        });
        return image;
      }
      if (message.kind === "audio") {
        var audio = el("audio", { controls: true, preload: "metadata", "aria-label": TEXTS.voiceNote });
        mediaUrl(message).then(function (url) {
          if (url) audio.src = url;
        });
        return audio;
      }
      var download = el("button", { type: "button", className: "text-button", text: TEXTS.download });
      download.addEventListener("click", function () {
        mediaUrl(message).then(function (url) {
          if (!url) return;
          var link = el("a", { href: url, download: "" });
          link.click();
        });
      });
      return el("span", null, [TEXTS.file + " · ", download]);
    }

    function renderMessage(message) {
      var node = message.node || el("li", {});
      message.node = node;
      node.className = "msg " + (message.from === "visitor" ? "from-visitor" : "from-business");
      node.textContent = "";
      if (message.from === "business") node.appendChild(el("p", { className: "author", text: message.author || TEXTS.aiAuthor }));
      var bubble = el("div", { className: "bubble" });
      if (message.kind !== "text") bubble.appendChild(mediaNode(message));
      if (message.text) {
        var text = el("div", { className: message.kind !== "text" ? "caption" : null });
        text.appendChild(linkify(message.text));
        bubble.appendChild(text);
      }
      node.appendChild(bubble);
      if (message.from === "visitor") {
        var meta = null;
        if (message.pending) meta = el("p", { className: "meta", text: TEXTS.sending });
        else if (message.failed) {
          meta = el("p", { className: "meta error" }, [message.error || TEXTS.notSent]);
          if (message.retryable) {
            var retry = el("button", { type: "button", className: "text-button", text: TEXTS.retry });
            retry.addEventListener("click", function () {
              deliver(message);
            });
            meta.appendChild(retry);
          }
        } else if (isLastVisitorMessage(message)) meta = el("p", { className: "meta", text: TEXTS.sent });
        if (meta) node.appendChild(meta);
      }
      if (!node.parentNode && ui.list) ui.list.appendChild(node);
      refreshSentMarks(message);
    }

    function isLastVisitorMessage(message) {
      for (var i = messages.length - 1; i >= 0; i--) {
        if (messages[i].from === "visitor") return messages[i] === message;
      }
      return false;
    }

    /** «Enviado» only under the latest delivered message of the visitor. */
    function refreshSentMarks(current) {
      messages.forEach(function (message) {
        if (message === current || message.from !== "visitor" || message.pending || message.failed || !message.node) return;
        var mark = message.node.querySelector(".meta");
        var shouldShow = isLastVisitorMessage(message);
        if (mark && !shouldShow) mark.remove();
      });
    }

    function announce(replies) {
      if (!ui.live) return;
      ui.live.textContent = replies
        .map(function (reply) {
          var body = reply.text || (reply.kind === "image" ? TEXTS.image : reply.kind === "audio" ? TEXTS.voiceNote : TEXTS.file);
          return (reply.author || TEXTS.aiAuthor) + ": " + body;
        })
        .join(". ");
    }

    function scrollToEnd(force) {
      if (!ui.body) return;
      var nearEnd = ui.body.scrollHeight - ui.body.scrollTop - ui.body.clientHeight < 120;
      if (force || nearEnd) ui.body.scrollTop = ui.body.scrollHeight;
    }

    function applyState(state) {
      if (!state) return;
      remoteState = { typing: Boolean(state.typing), handedOff: Boolean(state.handedOff) };
      renderStatus();
    }

    function setConnection(value) {
      connection = value;
      renderStatus();
    }

    function showNotice(text) {
      notice = text;
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(function () {
        notice = null;
        renderStatus();
      }, NOTICE_MS);
      renderStatus();
    }

    function renderStatus() {
      if (!ui.status) return;
      var text = "";
      var className = "status";
      if (unavailable) text = "";
      else if (recording) text = "";
      else if (connection === "offline") {
        text = TEXTS.offline;
        className += " warn";
      } else if (notice) {
        text = notice;
        className += " warn";
      } else if (connection === "connecting") text = TEXTS.connecting;
      else if (remoteState.handedOff) text = TEXTS.handedOff;
      else if (remoteState.typing) text = TEXTS.typing;
      if (ui.status.textContent !== text) ui.status.textContent = text;
      ui.status.className = className;
    }

    function setUnread(value) {
      if (!ui.launcher) return;
      ui.dot.hidden = !value;
      ui.launcher.setAttribute("aria-label", value ? TEXTS.openUnread(config.businessName) : TEXTS.open(config.businessName));
    }

    function setUnavailable() {
      unavailable = true;
      clearTimeout(pollTimer);
      stopRecording(true);
      if (!ui.body) return;
      ui.composer.hidden = true;
      ui.actions.hidden = true;
      ui.counter.hidden = true;
      ui.body.textContent = "";
      ui.body.appendChild(el("p", { className: "unavailable", text: TEXTS.unavailable }));
      renderStatus();
    }

    // ─── Contact form ([WEB-05]) ──────────────────────────────────────────────────────────────────────

    function openForm() {
      if (form) {
        form.querySelector("input").focus();
        return;
      }
      var error = el("p", { className: "error", role: "alert" });
      var name = el("input", { type: "text", name: "name", autocomplete: "name", maxlength: "100" });
      var email = el("input", { type: "email", name: "email", autocomplete: "email", maxlength: "254" });
      var phone = el("input", { type: "tel", name: "phone", autocomplete: "tel", maxlength: "30" });
      var cancel = el("button", { type: "button", className: "button", text: TEXTS.formCancel });
      var submit = el("button", { type: "submit", className: "button primary", text: TEXTS.formSend });
      form = el("form", { className: "form", "aria-labelledby": "dc-form-title", novalidate: true }, [
        el("h3", { id: "dc-form-title", text: TEXTS.formTitle }),
        el("p", { text: TEXTS.formHint }),
        el("label", null, [TEXTS.formName, name]),
        el("label", null, [TEXTS.formEmail, email]),
        el("label", null, [TEXTS.formPhone, phone]),
        error,
        el("div", { className: "buttons" }, [cancel, submit]),
      ]);
      cancel.addEventListener("click", closeForm);
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var contact = {};
        if (name.value.trim()) contact.name = name.value.trim();
        if (email.value.trim()) contact.email = email.value.trim();
        if (phone.value.trim()) contact.phone = phone.value.trim();
        if (!contact.name && !contact.email && !contact.phone) {
          error.textContent = TEXTS.formEmpty;
          name.focus();
          return;
        }
        closeForm();
        deliver(addLocal({ kind: "text", text: contactSummary(contact), contact: contact }));
      });
      ui.list.parentNode.appendChild(form);
      scrollToEnd(true);
      name.focus();
    }

    function contactSummary(contact) {
      var lines = ["Mis datos de contacto:"];
      if (contact.name) lines.push(TEXTS.formName + ": " + contact.name);
      if (contact.email) lines.push(TEXTS.formEmail + ": " + contact.email);
      if (contact.phone) lines.push(TEXTS.formPhone + ": " + contact.phone);
      return lines.join("\n");
    }

    function closeForm() {
      if (!form) return;
      form.remove();
      form = null;
      ui.input.focus();
    }

    // ─── Voice notes ([WEB-07]) ───────────────────────────────────────────────────────────────────────

    function canRecord() {
      return Boolean(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    function recorderMimeType() {
      var candidates = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];
      for (var i = 0; i < candidates.length; i++) {
        if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
      }
      return "";
    }

    function startRecording() {
      if (recording || !canRecord()) return;
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then(function (stream) {
          if (destroyed || unavailable) {
            stream.getTracks().forEach(function (track) {
              track.stop();
            });
            return;
          }
          var mimeType = recorderMimeType();
          var recorder = mimeType ? new window.MediaRecorder(stream, { mimeType: mimeType }) : new window.MediaRecorder(stream);
          var chunks = [];
          var current = { recorder: recorder, stream: stream, startedAt: Date.now(), cancelled: false, timer: null, limit: null };
          recorder.ondataavailable = function (event) {
            if (event.data && event.data.size > 0) chunks.push(event.data);
          };
          recorder.onstop = function () {
            stream.getTracks().forEach(function (track) {
              track.stop();
            });
            if (!current.cancelled && chunks.length > 0) sendFile(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }), "audio");
          };
          recorder.start();
          current.timer = setInterval(renderRecordingTime, 500);
          current.limit = setTimeout(function () {
            stopRecording(false);
          }, MAX_RECORDING_MS);
          recording = current;
          ui.composer.hidden = true;
          ui.recorder.hidden = false;
          renderRecordingTime();
          renderStatus();
          ui.stopButton.focus();
        })
        .catch(function () {
          showNotice(TEXTS.micDenied);
        });
    }

    function renderRecordingTime() {
      if (!recording) return;
      var seconds = Math.floor((Date.now() - recording.startedAt) / 1000);
      ui.recordingTime.textContent = TEXTS.recording + " " + Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
    }

    function stopRecording(cancel) {
      if (!recording) return;
      var current = recording;
      recording = null;
      current.cancelled = cancel;
      clearInterval(current.timer);
      clearTimeout(current.limit);
      if (current.recorder.state !== "inactive") current.recorder.stop();
      else
        current.stream.getTracks().forEach(function (track) {
          track.stop();
        });
      if (!ui.recorder) return;
      ui.recorder.hidden = true;
      if (!unavailable) ui.composer.hidden = false;
      renderStatus();
      if (!unavailable && isOpen) ui.input.focus();
    }

    // ─── Panel ────────────────────────────────────────────────────────────────────────────────────────

    function focusables() {
      var nodes = ui.panel.querySelectorAll("button, [href], input, textarea, audio[controls]");
      return Array.prototype.filter.call(nodes, function (node) {
        return !node.disabled && node.getClientRects().length > 0;
      });
    }

    function onPanelKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      // Focus stays inside the open panel.
      var items = focusables();
      if (items.length === 0) return;
      var active = ui.shadow.activeElement;
      var first = items[0];
      var last = items[items.length - 1];
      if (event.shiftKey && (active === first || items.indexOf(active) === -1)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || items.indexOf(active) === -1)) {
        event.preventDefault();
        first.focus();
      }
    }

    function open() {
      if (destroyed || !ui.panel) return;
      isOpen = true;
      ui.root.classList.add("is-open");
      ui.panel.hidden = false;
      ui.launcher.setAttribute("aria-expanded", "true");
      markRead();
      if (unavailable) {
        ui.closeButton.focus();
        return;
      }
      ui.input.focus();
      scrollToEnd(true);
      connect();
    }

    function close() {
      if (!ui.panel || !isOpen) return;
      isOpen = false;
      stopRecording(true);
      ui.root.classList.remove("is-open");
      ui.panel.hidden = true;
      ui.launcher.setAttribute("aria-expanded", "false");
      ui.launcher.focus();
    }

    function autoGrow() {
      ui.input.style.height = "auto";
      ui.input.style.height = Math.min(ui.input.scrollHeight + 2, 120) + "px";
      var max = config.maxTextLength;
      var length = ui.input.value.length;
      ui.counter.hidden = length < max * 0.9;
      ui.counter.textContent = formatNumber(length) + " / " + formatNumber(max);
      // Longer texts are refused ([WEB-09]): the field stops at the limit and says so once.
      if (length >= max && !atLimit) showNotice(TEXTS.tooLong(max));
      atLimit = length >= max;
      ui.sendButton.disabled = ui.input.value.trim().length === 0;
    }

    function submitText() {
      var text = ui.input.value.trim();
      if (!text || unavailable) return;
      if (text.length > config.maxTextLength) {
        showNotice(TEXTS.tooLong(config.maxTextLength));
        return;
      }
      ui.input.value = "";
      autoGrow();
      sendText(text);
    }

    /** An address of the app itself: only paths like «/legal/privacidad», never another site. */
    function appUrl(path, fallback) {
      var valid = typeof path === "string" && /^\/(?![\/\\])/.test(path);
      return base + (valid ? path : fallback);
    }

    function safeColor(value, fallback) {
      return typeof value === "string" && HEX_PATTERN.test(value) ? value : fallback;
    }

    function build() {
      var host = el("div", { id: "dominia-chat-" + channelId, "data-dominia-chat": "" });
      var shadow = host.attachShadow({ mode: "open" });
      var style = document.createElement("style");
      style.textContent = STYLES;
      shadow.appendChild(style);

      var root = el("div", { className: "root " + (config.position === "left" ? "left" : "right") });
      var color = config.color || {};
      root.style.setProperty("--dc-primary", safeColor(color.background, "#3c6cf1"));
      root.style.setProperty("--dc-primary-fg", safeColor(color.foreground, "#ffffff"));
      root.style.setProperty("--dc-link", safeColor(color.text, "#3462e6"));
      var logoSrc = typeof config.logoUrl === "string" && config.logoUrl.indexOf("/api/widget/" + channelId + "/logo") === 0 ? base + config.logoUrl : null;

      // Launcher.
      var launcherContent = logoSrc ? el("img", { src: logoSrc, alt: "" }) : icon("chat");
      var dot = el("span", { className: "dot", hidden: true, "aria-hidden": "true" });
      var launcher = el("button", { type: "button", className: "launcher", "aria-label": TEXTS.open(config.businessName), "aria-expanded": "false", "aria-controls": "dc-panel" }, [launcherContent, dot]);
      if (logoSrc)
        launcherContent.addEventListener("error", function () {
          launcher.replaceChild(icon("chat"), launcherContent);
        });

      // Header.
      var brand = el("div", { className: "brand", "aria-hidden": "true" }, [initials(config.businessName)]);
      if (logoSrc) {
        var brandImage = el("img", { src: logoSrc, alt: "" });
        brandImage.addEventListener("load", function () {
          brand.textContent = "";
          brand.appendChild(brandImage);
        });
      }
      var closeButton = el("button", { type: "button", className: "icon-button", "aria-label": TEXTS.close }, [icon("close")]);
      var header = el("div", { className: "header" }, [
        brand,
        el("div", { className: "heading" }, [
          el("h2", { className: "title", id: "dc-title", text: config.businessName }),
          el("p", { className: "subtitle", text: config.aiActive ? TEXTS.aiSubtitle : TEXTS.humanSubtitle }),
        ]),
        closeButton,
      ]);

      // Conversation: welcome, AI notice and legal texts ([CUM-01], [CUM-13]), then the messages.
      var privacy = el("a", { href: appUrl(config.privacyUrl, "/legal/privacidad"), target: "_blank", rel: "noopener noreferrer", text: TEXTS.privacyLink });
      var intro = el("div", { className: "intro" }, [
        el("div", { className: "msg from-business" }, [el("p", { className: "author", text: config.businessName }), el("div", { className: "bubble", text: config.welcomeMessage })]),
        config.aiActive && config.aiNotice ? el("p", { className: "notice", text: config.aiNotice }) : null,
        config.legalText ? el("p", { className: "notice", text: config.legalText }) : null,
        el("p", { className: "notice" }, [TEXTS.privacyBefore, privacy, "."]),
      ]);
      var list = el("ol", { className: "list", "aria-label": "Mensajes" });
      var body = el("div", { className: "body" }, [intro, list]);

      // Composer.
      var input = el("textarea", { id: "dc-input", rows: "1", placeholder: TEXTS.placeholder, maxlength: String(config.maxTextLength), "aria-label": TEXTS.inputLabel });
      var sendButton = el("button", { type: "button", className: "icon-button send", "aria-label": TEXTS.send, disabled: true }, [icon("send")]);
      var composerChildren = [];
      if (config.imagesEnabled) {
        var fileInput = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp", hidden: true, tabindex: "-1", "aria-hidden": "true" });
        var attachButton = el("button", { type: "button", className: "icon-button", "aria-label": TEXTS.attach }, [icon("image")]);
        attachButton.addEventListener("click", function () {
          fileInput.click();
        });
        fileInput.addEventListener("change", function () {
          var file = fileInput.files && fileInput.files[0];
          fileInput.value = "";
          if (file) sendFile(file, "image");
        });
        composerChildren.push(fileInput, attachButton);
      }
      if (config.voiceEnabled && canRecord()) {
        var micButton = el("button", { type: "button", className: "icon-button", "aria-label": TEXTS.record }, [icon("mic")]);
        micButton.addEventListener("click", startRecording);
        composerChildren.push(micButton);
      }
      composerChildren.push(input, sendButton);
      var composer = el("div", { className: "composer" }, composerChildren);

      var recordingTime = el("span", {});
      var cancelButton = el("button", { type: "button", className: "icon-button", "aria-label": TEXTS.cancelRecording }, [icon("trash")]);
      var stopButton = el("button", { type: "button", className: "icon-button send", "aria-label": TEXTS.stopAndSend }, [icon("stop")]);
      var recorder = el("div", { className: "recorder", hidden: true }, [
        cancelButton,
        el("span", { className: "label", role: "status" }, [el("span", { className: "rec-dot", "aria-hidden": "true" }), recordingTime]),
        stopButton,
      ]);
      cancelButton.addEventListener("click", function () {
        stopRecording(true);
      });
      stopButton.addEventListener("click", function () {
        stopRecording(false);
      });

      var talkButton = config.aiActive ? el("button", { type: "button", className: "text-button", text: TEXTS.talkToPerson }) : null;
      var detailsButton = el("button", { type: "button", className: "text-button", text: TEXTS.leaveDetails });
      var actions = el("div", { className: "actions" }, [talkButton, detailsButton]);
      if (talkButton)
        talkButton.addEventListener("click", function () {
          sendText(TALK_TO_PERSON);
        });
      detailsButton.addEventListener("click", openForm);

      var counter = el("p", { className: "counter", hidden: true });
      var status = el("p", { className: "status", role: "status", "aria-live": "polite" });
      var live = el("p", { className: "sr-only", "aria-live": "polite", "aria-atomic": "true" });

      var panel = el("div", { className: "panel", id: "dc-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "dc-title", hidden: true }, [
        header,
        body,
        status,
        counter,
        composer,
        recorder,
        actions,
        live,
      ]);

      root.appendChild(panel);
      root.appendChild(launcher);
      shadow.appendChild(root);

      launcher.addEventListener("click", function () {
        if (isOpen) close();
        else open();
      });
      closeButton.addEventListener("click", close);
      panel.addEventListener("keydown", onPanelKeyDown);
      input.addEventListener("input", autoGrow);
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          submitText();
        }
      });
      sendButton.addEventListener("click", submitText);

      ui = {
        host: host,
        shadow: shadow,
        root: root,
        launcher: launcher,
        dot: dot,
        panel: panel,
        closeButton: closeButton,
        body: body,
        list: list,
        input: input,
        sendButton: sendButton,
        composer: composer,
        recorder: recorder,
        recordingTime: recordingTime,
        stopButton: stopButton,
        actions: actions,
        counter: counter,
        status: status,
        live: live,
      };
      document.body.appendChild(host);
      messages.forEach(renderMessage);
      if (!config.available) setUnavailable();
    }

    function loadConfig(attempt) {
      request("GET", "/config").then(function (result) {
        if (destroyed) return;
        if (result.ok) {
          config = result.data;
          if (typeof config.businessName !== "string") config.businessName = "";
          config.maxTextLength = Number(config.maxTextLength) || 2000;
          config.maxUploadBytes = Number(config.maxUploadBytes) || 0;
          build();
          document.addEventListener("visibilitychange", onVisibilityChange);
          // A returning visitor: reload their conversation quietly, to show the dot if there is a reply.
          var stored = store.read();
          if (config.available && stored && stored.token) connect();
          return;
        }
        // Outside the allowed domains the browser blocks the answer (it looks like a network error): after a few
        // tries nothing is shown ([WEB-10]).
        if (result.status !== 404 && attempt < CONFIG_RETRIES) {
          setTimeout(function () {
            loadConfig(attempt + 1);
          }, 3000 * Math.pow(2, attempt));
          return;
        }
        if (window.console) window.console.warn("[DominIA] El chat web no se ha podido cargar en esta página: revisa el código del canal, sus dominios permitidos y la conexión.");
      });
    }

    function destroy() {
      destroyed = true;
      clearTimeout(pollTimer);
      clearTimeout(noticeTimer);
      clearTimeout(connectTimer);
      stopRecording(true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      Object.keys(mediaUrls).forEach(function (key) {
        mediaUrls[key].then(function (url) {
          if (url) URL.revokeObjectURL(url);
        });
      });
      messages.forEach(function (message) {
        if (message.localUrl) URL.revokeObjectURL(message.localUrl);
      });
      if (ui.host && ui.host.parentNode) ui.host.parentNode.removeChild(ui.host);
    }

    loadConfig(0);
    return { open: open, close: close, destroy: destroy };
  }

  // ─── Start ────────────────────────────────────────────────────────────────────────────────────────

  function findScript() {
    var scripts = document.querySelectorAll("script[data-channel]");
    for (var i = scripts.length - 1; i >= 0; i--) {
      if (/\/widget\.js(\?|#|$)/.test(scripts[i].src)) return scripts[i];
    }
    return null;
  }

  var script = document.currentScript || findScript();
  if (!script) return;
  var channelId = String(script.getAttribute("data-channel") || "").trim();
  if (!ID_PATTERN.test(channelId)) {
    if (window.console) window.console.warn("[DominIA] Falta el atributo data-channel del chat web.");
    return;
  }
  var base;
  try {
    base = new URL(script.src, window.location.href).origin;
  } catch (error) {
    return;
  }
  if (!window.fetch || !window.URL || !window.HTMLElement || !HTMLElement.prototype.attachShadow) return;

  var api = window.DominiaChat;
  if (!api) {
    var instances = {};
    api = {
      open: function (id) {
        Object.keys(instances).forEach(function (key) {
          if (!id || id === key) instances[key].open();
        });
      },
      close: function (id) {
        Object.keys(instances).forEach(function (key) {
          if (!id || id === key) instances[key].close();
        });
      },
      destroy: function (id) {
        Object.keys(instances).forEach(function (key) {
          if (!id || id === key) {
            instances[key].destroy();
            delete instances[key];
          }
        });
      },
      _instances: instances,
    };
    window.DominiaChat = api;
  }
  if (api._instances[channelId]) return;

  function start() {
    if (!api._instances[channelId]) api._instances[channelId] = createWidget(channelId, base);
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
