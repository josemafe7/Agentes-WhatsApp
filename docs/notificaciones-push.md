# Notificaciones push (PWA)

Cómo avisa la app al equipo en el móvil y en el ordenador (un traspaso a persona, una conversación nueva)
aunque no tenga la bandeja abierta. Se usa Web Push estándar con claves VAPID, sin servicios de terceros ni
cuentas de desarrollador. Comprobado el 26-09-2026 (ver «Fuentes»).

## Cómo encaja

1. La app es instalable: tiene manifiesto (`app/manifest.ts`) y un service worker (`public/sw.js`).
2. La persona pulsa «Activar avisos». El navegador pide permiso y crea una suscripción con la clave pública
   VAPID de la instalación.
3. La suscripción (una por usuario y dispositivo) se guarda en `push_subscriptions`.
4. Cuando pasa algo, un job de la cola envía el aviso con la librería `web-push`. Nunca se envía dentro de un
   webhook.
5. El servicio de push del navegador (Apple, Google, Mozilla…) lo entrega y el service worker lo muestra.
6. Si el servicio responde que la suscripción ya no existe, se borra.

## Dónde funciona

| Plataforma | Requisito |
|---|---|
| Android y escritorio con Chrome, Edge u otro navegador Chromium | Funciona en el navegador, sin instalar |
| Firefox | Funciona en el navegador |
| Safari en macOS | Safari 16 en macOS 13 o posterior |
| iPhone y iPad | iOS/iPadOS 16.4 o posterior y **solo con la app añadida a la pantalla de inicio**, con un manifiesto cuyo `display` sea `standalone` o `fullscreen` |

Particularidades de Apple:

- El permiso solo se puede pedir como respuesta directa a un gesto (tocar un botón), y la suscripción se
  pide en el mismo manejador del clic.
- Safari no admite avisos invisibles: cada push debe mostrar una notificación al momento o Safari retira el
  permiso a la web.
- Desde iOS 16.4, otros navegadores de iOS también pueden añadir webs a la pantalla de inicio.
- No hace falta ser del Apple Developer Program. El servidor debe poder conectar con
  `https://*.push.apple.com`.
- En iPhone sin instalar, la bandeja muestra cómo añadirla a la pantalla de inicio (Compartir › «Añadir a
  pantalla de inicio») en lugar del botón de avisos.

## Manifiesto

- `app/manifest.ts` devuelve un objeto `MetadataRoute.Manifest` y Next.js lo sirve en
  `/manifest.webmanifest`. Lleva `name`, `short_name`, `start_url` (la bandeja), `display: 'standalone'`
  (obligatorio para el push en iOS), colores e iconos de 192 y 512 px.
- Next.js cachea este archivo por defecto, salvo que use una API de la petición o una configuración dinámica.
  Como el nombre, el color y el logo del negocio salen de la base de datos, el manifiesto tiene que ser
  dinámico; si no, se quedaría con los valores del momento de compilar.
- Para que se pueda instalar hace falta un manifiesto válido y HTTPS. Next.js no recomienda un botón propio
  basado en `beforeinstallprompt`, porque no funciona en todos los navegadores (en Safari de iOS, no).

## Service worker

- Vive en `public/sw.js`, así se sirve en `/sw.js` con alcance `/`. Se registra con
  `navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })`.
- La guía actual de Next.js (16.3.6, 30-07-2026) registra en su ejemplo un worker empaquetado
  (`new URL('../lib/service-worker.js', import.meta.url)`). `public/sw.js` sigue siendo válido, es
  JavaScript simple sin compilar y tiene una URL fija, que es a la que se aplican las cabeceras de la misma
  guía. Se mantiene `public/sw.js`.
- Evento `push`: lee `event.data.json()` y llama a `self.registration.showNotification(título, opciones)`
  dentro de `event.waitUntil`. Siempre muestra algo (lo exige Safari, y Chrome pide `userVisibleOnly`).
- Evento `notificationclick`: cierra el aviso y enfoca una ventana abierta de la app o abre la URL del aviso.
  Solo se aceptan rutas de la propia app.
- El service worker no guarda páginas en caché: no hace falta modo sin conexión, y cachear páginas con
  sesión iniciada puede mostrar datos viejos o de otra persona en un dispositivo compartido.
- `proxy.ts` no puede redirigir al login `/sw.js`, `/manifest.webmanifest` ni los iconos: si lo hace, ni se
  instala la app ni se registra el worker.

## Cabeceras de seguridad

La guía de PWA de Next.js propone, además de las cabeceras generales (`X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`), estas para `/sw.js`:

| Cabecera | Valor | Por qué |
|---|---|---|
| `Content-Type` | `application/javascript; charset=utf-8` | Que el navegador lo interprete como JavaScript |
| `Cache-Control` | `no-cache, no-store, must-revalidate` | Que los dispositivos reciban siempre la última versión |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'` | El worker solo carga código del propio dominio |

Si el chat web se incrusta en la web del negocio mediante un iframe servido por la app, esas rutas
necesitan una excepción a `X-Frame-Options: DENY` (con `frame-ancestors` limitado a los dominios permitidos
del canal). Es un punto a decidir en el widget, no en el push.

## Suscripción en el navegador

- Antes de mostrar el botón se comprueba `'serviceWorker' in navigator` y `'PushManager' in window`. En iOS,
  además, que la app esté instalada (`matchMedia('(display-mode: standalone)')`).
- Al pulsar «Activar avisos»: `registration.pushManager.subscribe({ userVisibleOnly: true,
  applicationServerKey })`, con el registro obtenido de `navigator.serviceWorker.ready`.
- `applicationServerKey` es la clave pública VAPID. MDN admite una cadena en Base64 o un `ArrayBuffer`; la
  guía de Next.js la convierte de Base64 URL a `Uint8Array`, que es lo más seguro entre navegadores.
- Se envía al servidor `subscription.toJSON()`: `endpoint` y `keys.p256dh` y `keys.auth`. El servidor lo
  valida con Zod y lo guarda con el usuario, el agente de usuario, la fecha y la del último envío correcto.
  El `endpoint` es único.
- Al cerrar sesión o desactivar los avisos: `subscription.unsubscribe()` en el navegador y borrado en el
  servidor.
- El push necesita un contexto seguro (HTTPS). Para probar en local, Next.js propone
  `next dev --experimental-https`; para probar en un móvil hace falta una URL HTTPS real.

## Claves VAPID

- Se generan una sola vez por instalación con `webpush.generateVAPIDKeys()`, que devuelve `publicKey` y
  `privateKey` en Base64 URL. Se guardan en `integration_settings`: la privada, cifrada con
  `APP_ENCRYPTION_KEY`; la pública, en claro.
- No van en una variable `NEXT_PUBLIC_`: son propias de cada instalación y Next.js mete esas variables en el
  código al compilar. La pública se entrega al navegador desde el servidor.
- Cambiar las claves invalida todas las suscripciones (Apple responde `VapidPkHashMismatch` si la clave no
  coincide con la de la suscripción) y todo el equipo tendría que volver a activar los avisos. No se
  regeneran al desplegar, y entran en las copias de seguridad.
- El «subject» es un `mailto:` o una URL `https:` de contacto real: el correo del sistema o la URL de la
  instalación. Nunca `localhost`: Apple lo rechaza con `403 BadJwtToken`.

## Envío desde el servidor

- Librería `web-push` (3.6.7, JavaScript puro). Las claves se pasan en cada envío con `vapidDetails`, porque
  salen de la base de datos; `setVapidDetails()` las fija de forma global y no hace falta.
- `sendNotification(suscripción, payload, opciones)`. Opciones útiles:
  - `TTL`: segundos que el servicio guarda el aviso si el dispositivo está apagado. La librería pone cuatro
    semanas por defecto y Apple guarda como mucho 30 días. Un traspaso de hace días ya no sirve: se usa un TTL
    de horas.
  - `urgency`: `very-low`, `low`, `normal` o `high`. Los traspasos van con `high`.
  - `topic`: hasta 32 caracteres de Base64 URL. Con el identificador de la conversación, un aviso nuevo
    sustituye al anterior de la misma conversación en lugar de acumularse.
  - `timeout`: tiempo máximo de la conexión, en milisegundos.
- El payload va cifrado (`aes128gcm` por defecto) y debe ser pequeño: los servicios deben aceptar al menos
  4.096 bytes y Apple rechaza lo que pasa de 4 KB. Solo lleva título, un texto corto y la ruta de la bandeja.
  Sin nombres, teléfonos ni texto de los mensajes: se ve en la pantalla bloqueada.
- Tanto si se resuelve como si falla, el resultado trae `statusCode`, `headers` y `body`:

  | Respuesta | Qué significa | Qué hace la app |
  |---|---|---|
  | 201 | Aceptado | Actualiza la fecha del último envío correcto |
  | 404 | Suscripción caducada (RFC 8030) | Borra la suscripción |
  | 410 | La suscripción ya no es válida | Borra la suscripción |
  | 413 | Payload demasiado grande | Error de programación: se registra |
  | 429 | Demasiadas peticiones | Reintenta después de lo que diga `Retry-After` |
  | 400 o 403 | Petición o firma VAPID incorrectas | Se registra sin datos secretos y se avisa en Diagnóstico |

- El `endpoint` lo manda el navegador de un usuario con sesión, y el servidor hace un `POST` a esa URL. Para
  que nadie lo use para hacer peticiones a redes internas, se exige HTTPS y se rechazan IP privadas y
  `localhost`. Se puede limitar además a los dominios de los servicios de push conocidos; de ellos, solo
  `*.push.apple.com` está comprobado en la documentación oficial.
- Apple pide no renovar el token VAPID más de una vez por hora. `web-push` lo firma en cada envío; con el
  volumen de un negocio pequeño no debería notarse (no verificado). Si Apple empieza a responder 403 o 429,
  es lo primero que se revisa.
- Cada aviso es un job de la cola, con reintentos para 429 y errores 5xx.

## Pruebas

- El envío se hace a través de una función inyectable para poder simularla en Vitest: se comprueba que un
  404 o un 410 borra la suscripción y que el payload no lleva datos personales.
- Playwright no puede recibir un push real; las pruebas de extremo a extremo comprueban el botón, el guardado
  de la suscripción (con `PushManager` simulado) y que `/sw.js` y el manifiesto se sirven sin sesión.

## Fuentes

Consultadas el 26-09-2026. Entre paréntesis, la fecha que indica la propia fuente.

- Next.js 16.3.6, guía de PWA (30-07-2026): https://nextjs.org/docs/app/guides/progressive-web-apps
- Next.js 16.3.6, `manifest` (03-03-2026): https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest
- Next.js 16.3.6, variables de entorno al alojar por tu cuenta (25-08-2026): https://nextjs.org/docs/app/guides/self-hosting
- `web-push`, README: https://github.com/web-push-libs/web-push
- `web-push` 3.6.7 en npm: https://registry.npmjs.org/web-push/latest
- Apple, «Sending web push notifications in web apps and browsers»: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
- WebKit, «Web Push for Web Apps on iOS and iPadOS» (16-02-2023): https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- MDN, `PushManager.subscribe()` (23-06-2025): https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe
- IETF, RFC 8030 (Web Push): https://www.rfc-editor.org/rfc/rfc8030.html
- web.dev, errores habituales del push (30-03-2017): https://web.dev/articles/push-notifications-common-issues-and-reporting-bugs
