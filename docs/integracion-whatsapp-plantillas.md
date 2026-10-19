# Integración con WhatsApp: plantillas, botones y bajas de publicidad

Lo que la app usa de Meta y de YCloud para crear plantillas desde la app ([WA-57]–[WA-60]), mandarlas con botones de
respuesta rápida ([AGD-32]), comprobar el permiso del cliente ([WA-61]) y anotar las bajas de publicidad que llegan de
WhatsApp ([WA-62], [YC-11]). Completa `docs/integracion-whatsapp.md` (§5.8, sincronizar) y
`docs/integracion-whatsapp-mensajes.md` (envío, estados y webhooks). Todo se comprobó en las fuentes oficiales el
2026-10-16; lo que no se pudo confirmar va en «No comprobado», con lo que hace la app mientras tanto.

## Lo imprescindible

- Se crea con `POST /{WABA_ID}/message_templates` (Meta) o `POST /v2/whatsapp/templates` (YCloud). La clave de una
  plantilla es nombre + idioma; nombre de hasta 512 caracteres en minúsculas, números y `_`.
- Cada parámetro necesita su ejemplo al crearla. El texto no puede empezar ni terminar con un parámetro.
- Desde el 9-04-2025, una plantilla pedida como utilidad que Meta ve como marketing se **aprueba como marketing**, sin
  rechazarla. `allow_category_change` ya no hace falta y la app no lo manda.
- Caducidad (`message_send_ttl_seconds`): en utilidad, de 30 s a 12 h (`30`–`43200`); por defecto, 30 días. Si Meta
  cambia la categoría por su cuenta, borra la caducidad.
- Un botón de respuesta rápida tiene como mucho 25 caracteres; hasta 10 por plantilla. Al tocarlo llega un mensaje
  `type: "button"` con `button.{payload, text}` y `context.id` = el wamid de la plantilla tocada.
- La baja de publicidad que el cliente da desde WhatsApp llega en el webhook `user_preferences` (Meta) o
  `whatsapp.user.preferences` (YCloud). Si se le manda publicidad a quien la paró, el estado `failed` trae `131050`.
- Meta pide el permiso del cliente antes de cualquier plantilla y deja que cada negocio decida cómo conseguirlo; la
  app da por hecho el de «Avisos de sus citas» (decisión 0030) y comprueba los permisos y las bajas ella misma, también
  con YCloud, cuyo envío directo no mira su lista de bajas ([YC-11]).

## 1. Crear una plantilla con Meta

`POST https://graph.facebook.com/v26.0/{WABA_ID}/message_templates`, con el token del usuario del sistema y JSON. El
permiso es `whatsapp_business_management`, el mismo que ya pide el token.

| Campo | Notas |
|---|---|
| `name` | Obligatorio. Hasta 512 caracteres, solo minúsculas, números y `_`. Puede repetirse en otro idioma. Si se borra una aprobada, ese nombre no se puede reutilizar en 30 días. |
| `language` | Obligatorio. Español: `es`, `es_ES` (España), `es_MX`, `es_AR`… Al enviarla se usa el mismo código. |
| `category` | Obligatorio. La app solo crea `UTILITY` o `MARKETING`. |
| `parameter_format` | `NAMED` o `POSITIONAL`; si falta, `POSITIONAL`. La app usa `NAMED` con Meta. |
| `components` | Obligatorio, con un `BODY`. |
| `message_send_ttl_seconds` | La caducidad (§3). |

Componentes:

| Componente | Forma | Límite |
|---|---|---|
| `HEADER` | `{type: "HEADER", format: "TEXT", text}`; con un parámetro, `example.header_text_named_params: [{param_name, example}]` | 60 caracteres y un parámetro como mucho |
| `BODY` | `{type: "BODY", text}`; con parámetros, `example.body_text_named_params: [{param_name, example}, …]` | 1.024 caracteres |
| `FOOTER` | `{type: "FOOTER", text}`, sin parámetros | 60 caracteres |
| `BUTTONS` | `{type: "BUTTONS", buttons: [{type: "QUICK_REPLY", text}]}` | 10 botones; 25 caracteres cada uno |

- Con `NAMED`, cada parámetro es `{{nombre}}` en minúsculas y `_`; en el ejemplo, `param_name` va sin llaves. La app
  usa nombres solo con letras y `_` (`nombre`, `dia`, `hora`, `profesional`, `negocio`, `servicio`).
- El texto no puede empezar ni terminar con un parámetro (error `2388299`), ni tener demasiados parámetros para su
  longitud (`2388293`) o dos seguidos sin texto entre ellos. Los modelos de la app terminan siempre con una frase fija.
- Una plantilla con respuestas rápidas y otro tipo de botón, o con 4 botones o más, no se ve en WhatsApp de escritorio.

Respuesta: `{"id": "600000000000006", "status": "PENDING", "category": "UTILITY"}`. La app la guarda «En revisión»
hasta que llega `message_template_status_update` ([WA-22]). Si la respuesta trae otra `category`, Meta la ha aprobado
o la aprobará en esa: la app lo enseña como un cambio de categoría ([WA-60]).

Errores de creación documentados: `2388040` (un campo pasa de su límite), `2388047` / `2388072` / `2388073` (formato
de cabecera, cuerpo o pie), `2388293`, `2388299`, `2388019` (límite de plantillas de la cuenta). La app lee `code` y
`error_subcode`, enseña un texto en español para los conocidos y, si no, el genérico; el texto de Meta solo como dato.

Límites: 100 plantillas creadas por hora y cuenta; 250 plantillas (6.000 con el portfolio verificado), contando cada
idioma; la revisión tarda hasta 24 h. Editar y borrar sigue haciéndose en WhatsApp Manager ([WA-57]).

## 2. Crear una plantilla con YCloud

`POST https://api.ycloud.com/v2/whatsapp/templates`, con `X-API-Key`. Cuerpo: `wabaId`, `name`, `language`,
`category`, `components` (mismos tipos que Meta) y `messageSendTtlSeconds` (en camelCase, mismos rangos).

- El esquema de YCloud no tiene parámetros con nombre (`parameter_format`, `*_named_params` ni `parameter_name` al
  enviar), así que con YCloud la app crea las plantillas con parámetros numerados: `{{1}}`, `{{2}}`… con
  `example.body_text: [["…", "…"]]` (lista dentro de lista). La app guarda qué dato va en cada número ([WA-58]).
- La respuesta es la plantilla (`status`, `category`, `officialTemplateId`…). Solo está documentada la respuesta
  correcta; un error llega con `error.whatsappApiError` (el de Meta) y la app lo trata como en §1.

## 3. Caducidad (`message_send_ttl_seconds`)

| | Utilidad | Marketing |
|---|---|---|
| Por defecto | 30 días | 30 días |
| Rango | 30 s – 12 h (`30`–`43200`) | 12 h – 30 días, solo por la Marketing Messages API |

- Vale para todos los mensajes de esa plantilla. Si Meta no entrega el mensaje antes, ya no lo entrega y llega `failed`.
- Se puede pedir al sincronizar (`fields=…,message_send_ttl_seconds`); la app lo pide y lo guarda. Si no viene, la app
  no conoce la caducidad y la configuración de los recordatorios lo avisa ([AGD-24]).
- Si Meta reclasifica la plantilla, pone la caducidad a `null`.

## 4. Categoría: aprobada en otra o cambiada después

- `message_template_status_update`: `event` (`APPROVED`, `REJECTED`, `PAUSED`, `DISABLED`…), `reason` y
  `message_template_category`. Motivos de rechazo y su texto en la app:

| `reason` | Texto en la app |
|---|---|
| `INCORRECT_CATEGORY`, `TAG_CONTENT_MISMATCH` | «El texto no encaja con la categoría pedida.» |
| `INVALID_FORMAT` | «El formato no es válido.» (más `rejection_info`, en inglés, como dato) |
| `ABUSIVE_CONTENT`, `PROMOTIONAL`, `SCAM` | «Meta considera que incumple sus políticas.» |
| otro | «Meta la ha rechazado.» |

- `template_category_update` llega de dos formas: el aviso del día antes (`new_category` = la categoría **actual**,
  `correct_category` = la que tendrá y `category_update_timestamp` = cuándo) y el cambio hecho (`previous_category` y
  `new_category`). `message_template_id` llega como número. La app guarda en la plantilla la categoría anunciada y
  cuándo, o la anterior y la nueva, y avisa ([WA-60], [AJU-08]).
- YCloud manda `whatsapp.template.reviewed` (estado) y `whatsapp.template.category_updated` (`previousCategory`,
  `category`); el aviso del día antes no consta. Por eso la sincronización de cada 6 horas también detecta el cambio.

## 5. Botones de respuesta rápida

Enviar: el componente `button` es opcional; la app lo manda para fijar un `payload` propio por botón:

```json
{ "type": "button", "sub_type": "quick_reply", "index": "0", "parameters": [{ "type": "payload", "payload": "…" }] }
```

`index` empieza en 0 y sigue el orden de los botones de la plantilla; en Meta va como texto y en YCloud como número.

Recibir (Meta y YCloud):

```json
{ "type": "button", "button": { "payload": "…", "text": "Confirmo" }, "context": { "from": "15550001111", "id": "wamid.…" } }
```

La app reconoce el toque por `context.id` (el wamid de la plantilla que envió) y por el texto del botón; el `payload`
solo como respaldo. Por eso guarda el wamid de cada plantilla enviada, también con YCloud (que guarda su propio `id`):
lo toma de la respuesta del envío o del primer `whatsapp.message.updated`, que trae `wamid`.

## 6. Bajas de publicidad desde WhatsApp

Meta, webhook `user_preferences` (se suscribe como los demás campos de la app): solo cuando el cliente para o reanuda
la publicidad del negocio desde WhatsApp.

```json
{ "user_preferences": [{ "wa_id": "15550002222", "user_id": "US.100…", "category": "marketing_messages",
  "value": "stop", "detail": "User requested to stop marketing messages", "timestamp": 1790500000 }] }
```

Trae `metadata.phone_number_id`. `wa_id` falta si el cliente usa nombre de usuario; `user_id` (BSUID) falta si el
negocio no lo tiene activado. La app busca al contacto por su identidad de WhatsApp (BSUID o wa_id), nunca por el
teléfono de la ficha; si no lo encuentra, no crea nada. `stop` = baja de novedades y publicidad por WhatsApp; `resume`
solo se anota y no quita la baja ([CTO-08]).

YCloud, evento `whatsapp.user.preferences` con `whatsappUserPreference.{userId, contactPhoneNumber, category, value,
timestamp}` (`timestamp` en texto; parece en milisegundos).

Error `131050` en un estado `failed`: el cliente paró la publicidad del negocio. No se reintenta y la app anota la
baja de publicidad por WhatsApp.

Para que lleguen, la suscripción de la app tiene que incluir `user_preferences` (Meta) y la dirección de YCloud los
eventos nuevos. Volver a hacer `POST /{APP_ID}/subscriptions` **añade** campos sin quitar los que había; en YCloud,
`PATCH /webhookEndpoints/{id}` con la lista completa de `enabledEvents`.

## 7. Estados que importan a los recordatorios

- `failed` con `131026`: no se pudo entregar (el número no tiene WhatsApp o usa una versión antigua). El recordatorio
  sale por el siguiente canal ([AGD-24]).
- `failed` porque pasó la caducidad: cuenta como fallo y también pasa al siguiente canal.
- Que no llegue `delivered` no es un fallo. El orden de los estados no está garantizado.

## No comprobado

| Qué | Qué hace la app |
|---|---|
| Código de error al crear un nombre + idioma que ya existe (Meta y YCloud) | Antes de crear, mira si ya está en la lista sincronizada; si Meta lo rechaza, enseña el error genérico |
| Si la respuesta de creación ya trae la categoría cambiada | Compara la categoría de la respuesta con la pedida y además escucha los avisos |
| En qué campo llegan los `2388xxx` (`code` o `error_subcode`) | Lee los dos |
| Si los nombres de parámetro pueden llevar cifras; si las etiquetas de botón admiten tildes | Nombres solo con letras y `_`; las etiquetas de los modelos, sin tildes |
| Si un signo de puntuación tras el último parámetro evita el error `2388299` | Los modelos terminan con una frase fija |
| Qué devuelve el `GET` como caducidad si la plantilla no tiene una propia | Ausente o `null` = «no la conoce» |
| Longitud máxima del `payload`; que el `payload` propio vuelva en el webhook de Meta | Payload corto y, sobre todo, `context.id` + texto del botón |
| Si puede llegar `sent` antes de `failed` `131026` | Lo que vale es el `failed`, llegue cuando llegue |
| YCloud: parámetros con nombre; `officialTemplateId` en la respuesta de creación; si `PATCH` de la dirección sustituye o amplía la lista; si la respuesta de `sendDirectly` trae `wamid` | Numerados; se toma de la sincronización; se manda siempre la lista entera; se guarda el `wamid` del primer estado |

## Fuentes (consultadas el 2026-10-16)

- Meta: Template fundamentals, Template components, Configure message time-to-live, Supported languages, Template
  categorization, Template review, Template management, Utility templates, Marketing templates, Message Template API
  y Messages API (referencias), Button messages webhook, Status messages webhook, `template_category_update`,
  `message_template_status_update`, `user_preferences`, WhatsApp webhooks, Error codes y Graph API App Subscriptions:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/
- YCloud: especificación OpenAPI v2 (https://docs.ycloud.com/openapi/endpoints/ycloud-api-v2.yaml), Manage WhatsApp
  templates, ejemplos de creación, de mensajes y de webhooks, y Update a webhook endpoint: https://docs.ycloud.com/
