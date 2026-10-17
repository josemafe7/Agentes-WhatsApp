# Integración con YCloud (WhatsApp con coexistencia)

Datos comprobados el 09-10-2026 de la API de YCloud y de cómo la usa esta app. YCloud es un partner oficial de
Meta (BSP): da acceso a la API oficial de WhatsApp con la cuenta de YCloud del propio negocio. Es la segunda de las
tres vías de WhatsApp (`docs/decisions/0026-whatsapp-tres-vias.md`); sus reglas son [YC-01]–[YC-10] de
`docs/spec.md`.

Lo que no esté aquí o en la documentación oficial no se inventa: se comprueba antes de programarlo.

## Qué aporta esta vía

- **Coexistencia.** El número sigue funcionando en la app WhatsApp Business del móvil y, a la vez, en la API. Con la
  conexión directa de Meta que hace esta app, el número deja de funcionar en la app del móvil.
- **Menos pasos.** No hacen falta portfolio, app de Meta ni token de usuario del sistema: el alta del número se
  hace en la consola de YCloud y aquí solo se pega una clave.
- **Es la API oficial.** Plantillas, ventana de 24 horas, estados y precios son los de Meta.

## Base de la API

- URL base: `https://api.ycloud.com/v2`. En las pruebas se cambia con `YCLOUD_API_BASE_URL` (la versión
  compilada no arranca con ella puesta, salvo en los servidores de Playwright).
- La clave va en la cabecera `X-API-Key`, sin «Bearer». Nunca en la dirección ni en los registros.
- Errores: `{ "error": { "status", "code", "message", "whatsappApiError" } }`. `code` es una palabra de YCloud
  (`UNAUTHORIZED`, `BALANCE_INSUFFICIENT`, `RECIPIENT_UNSUBSCRIBED`…). Cuando la llamada llegó a Meta,
  `whatsappApiError.code` trae el código numérico de Meta (por ejemplo `131047`, ventana cerrada). La app decide
  por esos códigos y muestra su propio texto en español (`src/lib/ycloud/errors.ts`); el `message` de YCloud, en
  inglés, nunca se enseña.
- Límites: 200 peticiones por segundo y 10.000 por hora para las llamadas de gestión, por cuenta. Un 429 trae
  `Retry-After` en segundos. La app hace tres llamadas por número cada 6 horas, más las de cada envío.
- Listas: paginadas por número de página (`page`, `limit` hasta 100); se sigue mientras una página venga llena.

## Antes de conectar: lo que se hace en YCloud

El alta del número **no tiene API**: se hace a mano en la consola (`https://www.ycloud.com/console/`).

1. WhatsApp accounts › Create Channel › **WhatsApp Business APP Coexistence** › Get started.
2. Dos caminos: «Connect with Facebook» o «Connect by QR code». Se escanea el código con la app WhatsApp Business
   del móvil principal y se elige si se comparte el historial.
3. Hace falta la app WhatsApp Business 2.24.17 o posterior.
4. Recargar saldo: Settings › Billing › Recharge. Sin saldo, los envíos fallan con `BALANCE_INSUFFICIENT`.
5. La clave: Developers › API key. Está oculta y pedir verla exige la verificación en dos pasos de YCloud.

## Conectar un número

`src/data/ycloud.ts`, `src/server/channels/ycloud/connect.ts`.

1. **Comprobar clave** ([YC-02]): `GET /balance` (la llamada más barata que prueba la clave) y
   `GET /whatsapp/phoneNumbers`. De cada número se lee `phoneNumber` (E.164), `displayPhoneNumber`, `wabaId`,
   `verifiedName`, `qualityRating`, `messagingLimit`, `status`, `codeVerificationStatus` y `nameStatus`. No se
   guarda nada.
2. **Conectar** ([YC-03]): se valida otra vez en el servidor, se comprueba que el número no esté ya en otro canal
   de la instalación por ninguna vía ([WA-11]) y se guarda el canal con `connection_mode` «ycloud».
3. **Dirección de avisos**: la app la crea sola con `POST /webhookEndpoints` (`url`, `enabledEvents`, `status:
   active`). La respuesta trae el `secret` (`whsec_…`) **solo en ese momento**: se guarda cifrado junto a la clave.
   Cada canal tiene su dirección: `/api/webhooks/ycloud/{id del canal}`.
4. Sin dirección pública con HTTPS ([YC-04]) no se crea: el canal queda «conectando», con el semáforo «Avisos» en
   ámbar, y «Revalidar» la crea cuando la app esté publicada.

Los avisos de YCloud son de toda la cuenta (hasta 20 direcciones): a la dirección de un canal llegan los de todos
los números de esa cuenta. La app solo atiende los del número del canal.

En `phone_number_id` se guarda `ycloud:<cifras del número>`. Nunca un id de los que da Meta (que son solo cifras),
para que el webhook de Meta no pueda confundir este canal con uno suyo.

## Recepción

`src/app/api/webhooks/ycloud/[channelId]/route.ts`, `src/server/channels/ycloud/webhook.ts`.

### Firma

Cabecera `YCloud-Signature: t=<segundos unix>,s=<64 hex>`. Es el HMAC-SHA256, con el secreto de la dirección, del
texto `<t>.` seguido de los bytes exactos recibidos. Se comprueba **antes** de leer el JSON, en tiempo constante, y
solo se acepta si `t` está a menos de 5 minutos de ahora. Sin firma, con firma incorrecta, antigua o para un canal
que no es un número de YCloud conectado: 401 y no se guarda nada ([YC-05]).

### Avisos que se piden

| Aviso | Qué trae | Qué hace la app |
|---|---|---|
| `whatsapp.inbound_message.received` | `whatsappInboundMessage`: mensaje de un cliente | Lo guarda y programa la respuesta |
| `whatsapp.message.updated` | `whatsappMessage`: estado de un mensaje enviado por la API | Actualiza el mensaje |
| `whatsapp.smb.message.echoes` | `whatsappMessage`: lo que el negocio escribió desde el móvil | Lo añade a la conversación y pausa la IA |
| `whatsapp.template.reviewed` | `whatsappTemplate` | Pide una sincronización de plantillas |
| `whatsapp.template.category_updated` | `whatsappTemplate` (`previousCategory`, `category`) | Pide una sincronización, que anota el cambio y avisa ([WA-60], [YC-11]) |
| `whatsapp.template.quality_updated` | `whatsappTemplate` (`qualityRating`) | Pide una sincronización |
| `whatsapp.user.preferences` | `whatsappUserPreference` (`userId`, `contactPhoneNumber`, `value`) | `stop`: baja de publicidad por WhatsApp; `resume`: solo se anota ([WA-62], [YC-11]) |

Cualquier otro tipo, si llega firmado, se contesta con 200 y se ignora: YCloud añade tipos y campos sin avisar.
Las direcciones creadas antes de la fase 12 solo tenían los cuatro primeros: la app manda la lista entera con
`PATCH /webhookEndpoints/{id}` (`enabledEvents`) al revalidar y en la revisión de cada 6 horas si le falta alguno (no
consta si `PATCH` sustituye o amplía la lista, por eso va entera).
El historial (`whatsapp.smb.history`) y los grupos no se piden.

### Mensajes de clientes

El sobre es de YCloud (`id`, `wamid`, `from`, `fromUserId`, `customerProfile`, `to`, `sendTime`, `type`) y el
contenido es el de Meta (`text`, `image`, `audio`…, con `mime_type` y `caption`). La app lo reescribe con los
nombres de la Cloud API y lo pasa al mismo normalizador que la conexión directa
(`src/server/channels/whatsapp/normalize.ts`): los mismos tipos, las mismas identidades (BSUID primero, `wa_id`
después; el teléfono, solo como dato) y el mismo «Tipo de mensaje no admitido» ([YC-06]).

- El mensaje se identifica por su `wamid` (o por el `id` de YCloud si falta): repetido, no cambia nada.
- `from` llega con «+». En la identidad se guardan solo las cifras, como con Meta: un mismo cliente es el mismo
  contacto por cualquiera de las dos vías oficiales.
- Las ediciones y los borrados llegan como `type: unsupported`.

### Archivos

`link` es una dirección firmada del propio YCloud. Se descarga en un trabajo (`yc.media_download`) justo después,
con la cabecera `X-API-Key`, **solo si la dirección es del propio servidor de YCloud**: la clave nunca viaja a otro
sitio, diga lo que diga el aviso. Mismos límites de tamaño que la conexión directa.

### Estados

`accepted` no dice nada nuevo. `sent`, `delivered`, `read` y `failed` actualizan el mensaje, que se busca por el
`id` de YCloud (el que devolvió el envío). `errorCode` es un código de Meta en texto o una palabra de YCloud. El
precio (`pricingType`, `pricingCategory`) se guarda con el primer estado que lo trae.

### Coexistencia: lo que se escribe desde el móvil

Llega como `whatsapp.smb.message.echoes`, con `from` el negocio y `to` / `toUserId` el cliente. La app lo guarda
en la conversación de ese cliente como mensaje de una persona, firmado «Desde el móvil», y pausa la IA allí las
horas configuradas, como cuando alguien responde desde la bandeja ([YC-08], `src/server/channels/phone-echo.ts`).
Si el mensaje ya está guardado (lo envió la propia app), no hace nada.

## Envío

`src/server/channels/ycloud/send.ts`.

- `POST /whatsapp/messages/sendDirectly`: se envía a Meta durante la llamada, así un rechazo de Meta vuelve al
  momento con su código. Cuerpo: `from` (el número del negocio), `to` (E.164 con «+») **o** `recipient` (BSUID),
  `type` y el objeto de contenido de Meta.
- Archivos: primero `POST /whatsapp/media/{número}/upload` (formulario con `file`), que devuelve `{ id }`, y se
  envía por id. Los archivos de la app son privados y no tienen dirección pública.
- La respuesta trae el `id` de YCloud y `status: accepted`. No confirma la entrega: eso llega por avisos.
- Leído y «escribiendo…»: `POST /whatsapp/inboundMessages/{id}/markAsRead` y `…/typing`.
- No hay clave de idempotencia. Un error transitorio (429, 5xx) se reintenta con esperas acotadas; un fallo
  definitivo no se repite.

## Plantillas

`GET /whatsapp/templates?filter.wabaId=…`. Se guardan en la misma tabla que las de Meta
(`whatsapp_templates`), así la bandeja y los recordatorios funcionan igual. Solo se envían las `APPROVED`.
«Nueva plantilla» las crea con `POST /whatsapp/templates`, con parámetros numerados, y sus botones de respuesta rápida
llevan `index` como número: ver `docs/integracion-whatsapp-plantillas.md` §2 y §5. El envío directo no mira la lista de
bajas de YCloud: la app comprueba permisos y bajas antes de cada plantilla ([YC-11]).

## Semáforos

`src/server/channels/ycloud/health.ts`, cada 6 horas (`yc.health_check`) y al pulsar «Revalidar».

| Semáforo | Qué mira | Rojo cuando |
|---|---|---|
| Clave de YCloud | `GET /balance` | YCloud la rechaza |
| Número | `GET /whatsapp/phoneNumbers/{waba}/{número}` | Ya no está en la cuenta, o está `BANNED`, `BLOCKED`, `DISCONNECTED`, `RESTRICTED` o `MIGRATED` |
| Avisos | `GET /webhookEndpoints/{id}` | La dirección no existe, no es la de esta instalación o YCloud la ha desactivado |
| Saldo | El mismo `GET /balance` | No queda saldo (ámbar por debajo de 1) |
| Último mensaje | El propio canal | Nunca: es informativo |

Si el semáforo de la clave, el del número o el de avisos está en rojo, el canal pasa a «error» y se avisa al
propietario y a los administradores.

## Desconectar

`DELETE /webhookEndpoints/{id}` y se borra la clave. El número sigue en YCloud y en el móvil ([YC-10]). Para dejar
la coexistencia del todo hay que hacerlo desde el móvil, en la app WhatsApp Business (YCloud lo documenta en
inglés: Settings › Account › Business Platform › Disconnect Account).

## Lo que no está comprobado

Se anota para no darlo por hecho. Hay que probarlo con una cuenta real:

- Países donde la coexistencia no está disponible: las páginas de YCloud y de Meta dan listas distintas.
- Cada cuánto hay que abrir la app del móvil para que WhatsApp no desconecte el número: YCloud dice 13 días en
  un sitio y unos 30 en otro; Meta, unos 14. La guía recomienda 13.
- Si los mensajes enviados desde el móvil traen después estados de entregado y leído.
- Si la respuesta de `sendDirectly` ya trae el `wamid`.
- Si una clave de «Custom app» (de pago, con permisos por API) puede llamar a `/balance`.

## Fuentes

Consultadas el 09-10-2026.

- https://docs.ycloud.com/en/api-reference/guides/api-fundamentals/authentication
- https://docs.ycloud.com/en/api-reference/guides/api-fundamentals/handle-errors
- https://docs.ycloud.com/en/api-reference/guides/api-fundamentals/rate-limits
- https://docs.ycloud.com/en/api-reference/guides/api-fundamentals/pagination
- https://docs.ycloud.com/en/api-reference/guides/api-fundamentals/configure-webhooks
- https://docs.ycloud.com/en/api-reference/guides/api-fundamentals/implement-a-webhook-receiver
- https://docs.ycloud.com/en/api-reference/guides/whatsapp-platform/send-whatsapp-message
- https://docs.ycloud.com/en/api-reference/guides/whatsapp-platform/handle-whatsapp-inbound-messages
- https://docs.ycloud.com/en/api-reference/guides/whatsapp-platform/upload-whatsapp-media
- https://docs.ycloud.com/en/api-reference/guides/whatsapp-platform/manage-whatsapp-templates
- https://docs.ycloud.com/en/api-reference/guides/whatsapp-platform/manage-whatsapp-phone-numbers
- https://docs.ycloud.com/en/api-reference/guides/customer-data-and-operations/check-account-balance
- https://docs.ycloud.com/en/api-reference/guides/examples/webhook-examples/whatsapp-business-app-sent-message-sync-webhook-examples
- https://docs.ycloud.com/en/documentation/channels/whatsapp-accounts-management/coexistence/onboard-whatsapp-business-app
- https://docs.ycloud.com/en/documentation/developer/manage-api-keys
- https://docs.ycloud.com/en/documentation/pricing-and-billing/billing-and-recharge
- https://docs.ycloud.com/openapi/endpoints/ycloud-api-v2.yaml
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
