# Integración de WhatsApp por código QR (Baileys)

Datos comprobados el 09-10-2026 de la librería Baileys y de cómo la usa esta app. Es la tercera de las tres vías
de WhatsApp (`docs/decisions/0026-whatsapp-tres-vias.md`) y la única que **no es oficial**; sus reglas son
[QR-01]–[QR-12] de `docs/spec.md`.

Lo que no esté aquí o en el código de la librería no se inventa: se comprueba antes de programarlo.

## Qué es y qué riesgo tiene

Baileys es una librería que habla el protocolo de WhatsApp Web. El número se vincula como un «dispositivo
vinculado» más, escaneando un código QR desde el móvil, y la app recibe y envía por esa conexión.

- No es de WhatsApp ni de Meta. El centro de ayuda de WhatsApp dice que vincular apps o webs no oficiales puede
  acabar en un bloqueo temporal o permanente de la cuenta, y sus condiciones prohíben el acceso automatizado.
- Por eso esta vía nunca es la opción por defecto, lleva siempre su aviso y no se crea nada hasta que la persona
  marca la casilla de que lo acepta ([QR-01]).
- Es el WhatsApp de siempre del negocio, con todos sus chats. El canal empieza en modo pruebas con la lista vacía:
  la IA no contesta a nadie hasta que el negocio lo decide ([WA-56]).
- Los dispositivos vinculados se cierran si el móvil pasa más de 14 días sin conectarse.

## La dependencia

Excepción D6 de `docs/security.md`.

- Paquete `baileys`, versión exacta **7.0.0-rc14** (29-07-2026). No existe una 7.x estable y la 6.x ya no recibe
  parches de seguridad. Solo `baileys` y `@whiskeysockets/baileys` son legítimos: hay cientos de paquetes falsos
  con nombres parecidos que roban sesiones.
- `pino` se fija a 9.11.0 solo para Baileys (`overrides`): la versión que elegiría sola se publicó con menos
  garantías que las anteriores y la política del proyecto la rechaza.
- Los scripts de instalación de `baileys` y `protobufjs` no se ejecutan: uno solo comprueba la versión de Node y
  el otro solo escribe un aviso.
- `link-preview-js` **no se instala**: todas sus versiones admitidas tienen avisos de seguridad. La app envía los
  textos sin vista previa.
- `libsignal`, que Baileys usa, tiene licencia GPL-3.0. A tener en cuenta si la app se entrega a terceros.
- En `next.config.ts` va en `serverExternalPackages`: es un paquete solo ESM con WebAssembly dentro.

## Dónde vive la sesión

Una sesión vinculada es **una conexión abierta** con WhatsApp que alguien tiene que mantener.

- La mantiene el proceso del servidor web (`pnpm dev` o `next start`). Al arrancar, `src/instrumentation.ts`
  reabre las sesiones de los números vinculados.
- Hay un supervisor por proceso (`src/server/channels/whatsapp-qr/runtime.ts`), guardado en `globalThis` porque
  la versión compilada lleva una copia del código en cada ruta y todas tienen que ver las mismas conexiones.
  Entre copias solo cruzan datos simples.
- **Nunca en Vercel**: allí cada petición arranca y se apaga. El asistente lo dice y no deja crear el canal
  ([QR-02]).
- **Una sola copia de la app.** Dos procesos con la misma sesión se echan el uno al otro (WhatsApp cierra con el
  motivo 440). Si pasa, la app no pelea: deja el canal en «error» y lo explica.
- En un servidor propio con `pnpm worker`, el trabajador no tiene conexiones. Cuando le toca enviar, se lo pide
  al servidor web por `/api/internal/whatsapp-qr`, con `CRON_SECRET` (el secreto que ya comparten). El archivo de
  un mensaje viaja por su clave en el almacén, nunca como bytes (`src/server/channels/whatsapp-qr/host.ts`).
- Cuando llega un mensaje no hay ninguna petición detrás de la que lanzar el trabajo en segundo plano: lo lanza
  un temporizador del propio supervisor, a la hora en que toca responder.

## La sesión guardada

`src/server/channels/whatsapp-qr/auth-store.ts`. La librería solo la tiene en memoria; la app la guarda, siempre
cifrada con `APP_ENCRYPTION_KEY`:

- **Credenciales del dispositivo**: en `channels.secrets_enc`. Cambian al vincular y de vez en cuando; se guardan
  cada vez.
- **Claves de sesión** (una por contacto y dispositivo, cambian con cada mensaje): una fila cifrada por clave en
  `whatsapp_qr_keys`. La librería entrega los cambios en lotes que mezclan tipos y borrados: cada lote se escribe
  en **una sola transacción**. Medio lote rompería la sesión.

Al reiniciar la app, el número se conecta solo con lo guardado, sin escanear otra vez ([QR-04]).

## Conexión

`src/server/channels/whatsapp-qr/socket.ts` es el único sitio que abre la conexión. Opciones elegidas a propósito:

| Opción | Valor | Por qué |
|---|---|---|
| `syncFullHistory` | `false` | Los chats antiguos nunca se leen |
| `markOnlineOnConnect` | `false` | Si la cuenta aparece «en línea», el móvil deja de recibir notificaciones |
| `emitOwnEvents` | `false` | Lo que envía la app ya está guardado; solo vuelve como aviso lo que envía el móvil |
| `generateHighQualityLinkPreview` | `false` | Sin vistas previas |
| `logger` | Silencioso | Los registros de la librería pueden llevar teléfonos, ids o claves |

No se usa `shouldIgnoreJid`: la librería rechazaría ante el servidor los mensajes de grupos. Es más prudente
recibirlos y descartarlos.

### Vincular

1. Sin sesión guardada, la conexión entrega textos de código QR (`connection.update` con `qr`): el primero vale
   unos 60 segundos y los siguientes unos 20. El texto es un secreto (quien lo escanea queda dentro): solo vive en
   memoria, el asistente lo recibe ya dibujado como imagen y solo lo ve quien gestiona canales ([QR-03]).
2. Al escanearlo, WhatsApp cierra la conexión a propósito (motivo 515) y hay que abrir otra con las mismas
   credenciales: esa ya es la sesión vinculada.
3. Si nadie escanea, WhatsApp deja de ofrecer códigos y cierra. La app no reintenta sola: el asistente ofrece
   «Generar otro código».
4. Al abrirse, la app lee el número y el nombre de la cuenta. Si ese número ya está en otro canal, o el canal era
   de otro número, deshace la vinculación y lo dice ([QR-05]).

### Motivos de cierre

| Motivo | Código | Qué hace la app |
|---|---|---|
| Reinicio tras vincular | 515 | Abre otra conexión al momento |
| Corte de red, conexión perdida | 408, 428, 500, 503 | Reconecta sola: 2 s, 4 s, 8 s… hasta 60 s |
| Sesión cerrada desde el móvil o retirada | 401, 403, 411 | Borra la sesión, canal a «error» y aviso ([QR-10]) |
| Otra copia tomó la sesión | 440 | No reconecta; canal a «error»; «Reconectar» en el panel |

## Recepción

`src/server/channels/whatsapp-qr/normalize.ts` (sin librería: solo la forma de lo que entrega) y
`session.ts`.

- Los mensajes llegan en `messages.upsert`, con `type` «notify» (en vivo) o «append» (lo que llegó con la app
  apagada, y lo enviado desde el móvil). **Se leen los dos**: atender solo «notify» perdería mensajes tras cada
  reinicio.
- Solo chats de una persona. Se descartan los grupos (`@g.us`, o cualquier mensaje con `participant`), los
  estados y las listas (`@broadcast`), los canales (`@newsletter`), el chat «mensaje a ti mismo» y el tráfico del
  propio protocolo (claves, historial, ediciones, borrados).
- Nada anterior al momento de vincular se toma como mensaje nuevo (`qrLinkedAt` en la configuración del canal).
- Tipos: texto, nota de voz, imagen y documento. Una reacción se anota en el mensaje al que reacciona. Lo demás
  (vídeo, pegatinas, ubicación, contactos, encuestas…) aparece como «Tipo de mensaje no admitido» y la IA no lo
  contesta ([QR-06]).
- No se guarda ningún aviso en bruto: esta vía no tiene webhooks.

### Quién escribe

Cada chat trae una dirección (`remoteJid`) y a veces la otra (`remoteJidAlt`):

- **LID** (`123…@lid`): el identificador estable de la cuenta en WhatsApp. No es un teléfono. Es la identidad
  principal del contacto.
- **Número** (`34600111222@s.whatsapp.net`): sus cifras se guardan como segunda identidad, con el mismo formato
  que usa la API oficial, y como dato del contacto. Nunca como clave ([QR-07], [CAN-13]).

La dirección del chat se guarda en el mensaje (`metadata.whatsappJid`) para responder en el mismo sitio.

### Archivos

`src/server/channels/whatsapp-qr/media.ts`. Un mensaje trae la ruta de su archivo cifrado y la clave que lo abre.

- El archivo se pide **solo** al servidor de archivos de WhatsApp (`mmg.whatsapp.net`) y por la ruta del mensaje.
  La dirección completa que trae el mensaje no se usa nunca: esta versión de la librería la seguiría, y un mensaje
  es un dato de fuera que podría apuntar a cualquier sitio. La ruta se valida: no puede cambiar de servidor.
- Se descarga en cuanto llega el mensaje, dentro del propio proceso, con los mismos límites de tamaño que las
  otras vías. Lo que dice el mensaje de su tamaño no se da por bueno: la descarga se corta al llegar al límite.
- La clave del archivo solo está en memoria: nunca en la base de datos ni en un trabajo.
- Una nota de voz se transcribe después, como en los demás canales.

### Lo que se escribe desde el móvil

Llega con `fromMe`. Se añade a la conversación del cliente como mensaje de una persona, «Desde el móvil», y pausa
la IA allí ([QR-09], `src/server/channels/phone-echo.ts`). Lo que envió la propia app se reconoce por su id y no se
duplica.

## Envío

- Texto, imagen, documento y nota de voz, por la conexión abierta. Sin sesión abierta no se envía y se dice por
  qué.
- **Un mensaje, una vez.** Un envío que falla no se reintenta solo: un segundo intento podría llegar dos veces al
  cliente.
- El id del mensaje lo da la librería al enviarlo; con él llegan después los estados.
- «escribiendo…» necesita que la cuenta esté «en línea» un momento; al terminar de enviar vuelve a «no
  disponible» para que el móvil siga sonando.
- Estados (`messages.update`): 3 es entregado; 4 y 5, leído; 0, fallido. Los demás no dicen nada nuevo.
- Si WhatsApp pide que se reenvíe un mensaje, la app solo puede reconstruir los de texto.

## Semáforos

`src/server/channels/whatsapp-qr/health.ts`. No hay ninguna llamada fuera: la sesión es del propio proceso.

| Semáforo | Verde | Rojo |
|---|---|---|
| Sesión de WhatsApp | Conexión abierta | Sesión cerrada, tomada por otra copia o no abierta en este proceso |
| App encendida | La app puede mantener la conexión | Está en Vercel |
| Último mensaje | Informativo | Nunca |

## Desconectar

Con la conexión abierta, la app pide a WhatsApp cerrar la sesión (el dispositivo desaparece de la lista del móvil)
y borra credenciales y claves. Sin conexión no puede avisar a WhatsApp: borra lo guardado y pide a la persona que
quite el dispositivo en el móvil ([QR-12]).

## Lo que no está comprobado

Hay que probarlo con un número real:

- La versión de WhatsApp Web que anuncia la librería es la que traía al publicarse. Si WhatsApp deja de aceptarla,
  hay que actualizar Baileys.
- Cuántos códigos QR ofrece WhatsApp antes de cerrar (lo decide su servidor).
- Qué muestra exactamente el móvil tras cerrar la sesión desde la app.
- Cuánta memoria gasta cada sesión abierta.

## Fuentes

Consultadas el 09-10-2026.

- https://github.com/WhiskeySockets/Baileys (etiqueta `v7.0.0-rc14`: `README.md`, `SECURITY.md`, `src/`)
- https://github.com/WhiskeySockets/Baileys/security/advisories/GHSA-qvv5-jq5g-4cgg
- https://baileys.wiki (guía de conexión y de migración a la versión 7)
- https://registry.npmjs.org/baileys
- https://faq.whatsapp.com/378279804439436 (dispositivos vinculados)
- https://faq.whatsapp.com/1217634902127718 (apps no oficiales)
- https://www.whatsapp.com/legal/terms-of-service
