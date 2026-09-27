# Integración con WhatsApp: mensajes y webhooks

Referencia técnica de la parte de mensajería de la Cloud API oficial de Meta: cómo llegan los mensajes y
los estados por webhook, cómo se descargan los medios, cómo se envía y qué límites hay. Verificada el
**2026-09-26** contra la documentación oficial de Meta (cada fuente, con su fecha de actualización, al
final). Versión de Graph API de referencia: **v26.0**, publicada el 29-07-2026.

El alta del número (token, App Secret, registro, suscripciones `subscribed_apps` y panel del número) va en
su propio documento. Aquí solo se trata lo que pasa cuando el canal ya está conectado.

Lo que no se ha podido comprobar en una fuente oficial está marcado como **«no verificado»**.

## Lo imprescindible

1. **Una sola URL** (`/api/webhooks/whatsapp`): `GET` verifica el endpoint y `POST` trae los eventos, en
   lotes de hasta 1.000 actualizaciones y cuerpos de hasta 3 MB.
2. **Firma**: `X-Hub-Signature-256: sha256=<hex>`, HMAC-SHA256 de los bytes exactos del cuerpo con el App
   Secret. Se compara en tiempo constante.
3. **Reintentos durante 7 días** ante cualquier respuesta distinta de 200, así que llegan duplicados. Se
   deduplica por `wamid` y se responde 200 enseguida. El objetivo de Meta: mediana ≤ 250 ms y menos del 1 %
   por encima de 1 s.
4. **Identidad**: desde abril de 2026 el identificador fiable es el **BSUID** (`user_id`, `from_user_id`,
   `recipient_user_id`). El teléfono (`wa_id`, `from`, `recipient_id`) puede faltar si el usuario activa el
   nombre de usuario. El teléfono nunca es la clave.
5. **El BSUID cambia** cuando el usuario cambia de número. Llega un mensaje `system` con
   `previous_user_id` para enlazar la identidad antigua con la nueva.
6. **Estados**: `sent`, `delivered`, `read`, `failed` y `played`. `delivered` puede no llegar y el orden no
   está garantizado, así que los estados solo avanzan.
7. **Desde v24.0 no llega `conversation`**. `pricing` trae `pricing_model: "PMP"`, `type` y `category`.
   `billable` se deprecará.
8. **Medios**: el ID de un medio recibido dura 7 días y su URL de descarga, 5 minutos. Se descargan con
   `Authorization: Bearer`.
9. **Envío**: `POST /{PHONE_NUMBER_ID}/messages`, al teléfono (`to`, siempre con `+`) o al BSUID
   (`recipient`, desde julio de 2026).
10. **Ventana de 24 h**: se abre o renueva con cada mensaje o llamada del usuario. Fuera de ella solo se
    pueden enviar plantillas (error `131047`).
11. **Límites**: 80 mensajes por segundo por número (`130429`) y 1 mensaje cada 6 s al mismo usuario
    (`131056`).

## 1. Cuentas e identificadores de Meta

Desde el 23-09-2026 Meta separa la antigua «WhatsApp Business Account» (WABA) en dos cuentas. El despliegue
es gradual y llega a todos los negocios a mediados de octubre de 2026:

- **WhatsApp account (WAAC)**: contiene un único número, su perfil y, en el futuro, su nombre de usuario.
- **Messaging account**: contiene las plantillas, la facturación y las suscripciones a webhooks. **Conserva
  el mismo ID que la WABA.**

Para esta integración no cambia nada ahora:

- `entry[].id` sigue siendo el ID de la WABA, que ahora es el de la Messaging account.
- Los endpoints, los `phone_number_id` y los tokens siguen funcionando.

Lo que viene, y por qué conviene tener configurables la versión de la API y los identificadores:

| Fase | Cuándo | Qué cambia |
|---|---|---|
| 1 | Desde el 23-09-2026 | Nada obligatorio. Existe el parámetro opcional `messaging_account_id` en el envío. |
| 2 | Primer semestre de 2027 | La versión nueva de la API exige `messaging_account_id` si el token llega a más de una Messaging account del mismo número. |
| 3 | Primer semestre de 2028 | Las rutas que llevan el `phone_number_id` pasan a llevar el WAAC ID. |

Con la configuración de «desarrollador directo» (una app y una Messaging account por negocio) no hace falta
`messaging_account_id`.

## 2. Verificación del webhook (GET)

Meta envía un `GET` cada vez que se guarda o cambia la URL o el verify token en el panel de la app, o al
suscribir con `POST /{APP_ID}/subscriptions`:

`GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=<cadena>&hub.verify_token=<token>`

- `hub.mode` siempre vale `subscribe`.
- `hub.challenge` es una cadena aleatoria de Meta; en el ejemplo oficial es numérica (`1158201444`).
- `hub.verify_token` es la cadena elegida por nosotros: el verify token de la instalación.

**Respuesta**: si `hub.mode` es `subscribe` y el token coincide (comparado en tiempo constante), se devuelve
**200 con el valor de `hub.challenge` tal cual** en el cuerpo, en texto plano. Si no, cualquier respuesta
distinta de 200 (por ejemplo, 403). Con otra respuesta, Meta da el endpoint por no verificado y no envía
webhooks.

Para el asistente de conexión: la llegada de este `GET` válido es la señal para marcar en pantalla que la
verificación ha llegado (`webhook_status`).

## 3. Firma de los POST

Cabeceras de cada `POST`: `Content-Type: application/json`, `Content-Length` y
`X-Hub-Signature-256: sha256=<64 caracteres hexadecimales>`.

**Validación**:

1. Se calcula el HMAC-SHA256 con el **App Secret** de la app como clave y el **cuerpo en bruto** como
   mensaje.
2. Se compara con lo que va después de `sha256=` en la cabecera, en tiempo constante.
3. Si coincide, el cuerpo es válido. Si no, se descarta sin procesarlo.

**Detalles que evitan fallos**:

- La firma se calcula sobre **los bytes exactos** recibidos. Si se parsea el JSON y se vuelve a
  serializar, cambian los espacios y los escapes Unicode, y la firma deja de coincidir. Lo más seguro es
  leer el cuerpo como bytes (`arrayBuffer`), calcular el HMAC sobre esos bytes y después decodificarlos a
  texto para el JSON. `req.text()` funciona si el cuerpo es UTF-8 válido, que es lo normal.
- Antes de comparar hay que comprobar que la cabecera existe, empieza por `sha256=` y el resto son 64
  caracteres hexadecimales. Con otra longitud, las funciones de comparación en tiempo constante fallan en
  lugar de devolver «no coincide».
- Una instalación tiene pocos App Secret (uno por app de Meta), así que la firma se comprueba **antes de parsear**
  el cuerpo (decisión 0022): **no se lee, no se guarda ni se procesa nada** hasta verificar. En la práctica:
  1. Se prueba cada App Secret distinto guardado en la instalación. Suele ser uno, porque todos los números de
     una app comparten secreto.
  2. Solo si alguno la confirma se parsea el JSON y se buscan sus canales: `metadata.phone_number_id` o
     `entry[].id` (WABA). Cada canal tiene que ser uno cuyo propio App Secret firmó el cuerpo.
  3. Cada `POST` pertenece a una sola app, porque Meta lo firma con el secreto de la app suscrita.
- **Si la firma no coincide** se responde 401, como pide la especificación. Meta lo reintentará durante 7
  días. Es lo correcto si el App Secret guardado está mal: al corregirlo, los reintentos entran solos.
- **Si el cuerpo es válido pero no corresponde a ningún canal activo** (por ejemplo, un número
  desconectado que sigue suscrito), conviene responder 200 sin procesar y dejar una línea de log. Si no,
  Meta insistirá durante 7 días.
- **mTLS** (opcional): Meta puede presentar un certificado de cliente con CN
  `client.webhooks.fbclientcerts.com`. No hace falta en v1. Meta desaconseja filtrar por IP porque sus IP
  cambian.

**Vector de prueba** (calculado localmente con HMAC-SHA256 estándar; útil para tests unitarios):

| App Secret | Cuerpo (bytes exactos) | `X-Hub-Signature-256` |
|---|---|---|
| `test_app_secret` | `{"object":"whatsapp_business_account","entry":[]}` | `sha256=dec6a680679a968e7e0319355b23599cbfc54502c0784668e9618baa0c633756` |
| `test_app_secret` | `{"object": "whatsapp_business_account", "entry": []}` (mismo JSON con espacios) | `sha256=56cbbaf4961c6cfdae48b7f116c047e5eb513d2c931baae63a2bc1afd26f803a` |
| `otro_secreto` | `{"object":"whatsapp_business_account","entry":[]}` | `sha256=769b03d8c2ae6498f2d1e1f7299c0ba55448c69d741e7b0bb243d852d8a8d8c7` |

Con la primera cabecera, el segundo cuerpo debe fallar aunque sea el mismo JSON: demuestra que se firma
sobre bytes y no sobre el JSON interpretado. Para la prueba de «firma inválida» basta con enviar un cuerpo
real con la firma calculada con `otro_secreto`.

## 4. Cómo entrega Meta los webhooks

| Aspecto | Qué dice Meta | Consecuencia para nosotros |
|---|---|---|
| Tamaño | Hasta 3 MB por cuerpo. | El límite de tamaño del endpoint debe admitir al menos 3 MB. Por encima se puede rechazar. |
| Lotes | Hasta 1.000 actualizaciones por `POST`. No está garantizado que se agrupen. | Se recorren todos los `entry[]`, `changes[]`, `messages[]` y `statuses[]`. No se supone uno por petición. |
| Reintentos | Si la respuesta no es 200 o no se entrega, reintenta al momento y después con frecuencia decreciente durante **7 días**. Lo no confirmado se descarta a los 7 días. | Se responde 200 en cuanto el evento en bruto está guardado. Nunca se llama al LLM en el webhook. |
| Duplicados | Los reintentos pueden duplicar notificaciones, y Meta pide deduplicar. | Mensajes únicos por `channel_id` + `wamid`. Los estados se aplican de forma idempotente (§8). |
| Latencia | Mediana ≤ 250 ms y menos del 1 % por encima de 1 s. Entrega peticiones concurrentes. | Solo se guarda y se encola. El endpoint admite peticiones en paralelo. |
| Orden | Meta no lo promete en ninguna parte. Hay reintentos y lotes, y los problemas de orden se observan en integraciones reales. | Estados monótonos. La ventana de 24 h se calcula con el `timestamp` del mensaje, no con la hora de llegada. |
| Historial | No hay API para recuperar webhooks pasados. | La tabla `webhook_events` es la única copia. |
| Modo de la app | Algunos webhooks no se envían si la app está en modo desarrollo. | El diagnóstico debe incluir «App publicada (Live)». |

La documentación genérica de Graph API habla de 36 horas de reintentos, pero la de WhatsApp dice 7 días. Para
WhatsApp manda la de WhatsApp.

Un mensaje que llega por reintento horas después tiene su `timestamp` original. Por eso la ventana de 24 h y
la decisión de responder se basan en ese `timestamp`. **Decisión de producto pendiente**: no contestar
automáticamente mensajes con mucha antigüedad (por ejemplo, más de 1 hora) y dejarlos para una persona.

## 5. Estructura común del POST

Todos los webhooks de WhatsApp tienen este sobre:

| Ruta | Contenido |
|---|---|
| `object` | Siempre `"whatsapp_business_account"`. |
| `entry[].id` | ID de la WABA (Messaging account). |
| `entry[].time` | Entero Unix. Solo aparece en los webhooks de cuenta (§9), no en `messages`. |
| `entry[].changes[].field` | Campo suscrito: `messages`, `account_update`, `message_template_status_update`… |
| `entry[].changes[].value` | Contenido. Su forma depende de `field`. |

Para `field = "messages"`, `value` contiene:

| Ruta | Contenido |
|---|---|
| `messaging_product` | `"whatsapp"`. |
| `metadata.display_phone_number` | Número del negocio, en dígitos sin `+`. |
| `metadata.phone_number_id` | ID del número del negocio. **Es la clave para encontrar el canal.** |
| `contacts[]` | Perfil del usuario: en los mensajes entrantes y, desde el cambio del BSUID, también en los estados `sent`, `delivered` y `read` (§6). |
| `messages[]` | Mensajes entrantes (§7). |
| `statuses[]` | Estados de mensajes salientes (§8). |
| `errors[]` | Errores de sistema, de app o de cuenta sin mensaje asociado (§7.4). |

Cómo se encuentra el canal:

- En `messages`, por `value.metadata.phone_number_id`.
- En los webhooks de cuenta, por `entry[].id` (WABA). Si el evento es de un número concreto, además por
  `display_phone_number` o por `entity_id` (§9).
- Los campos desconocidos se ignoran sin fallar. Meta añade campos a menudo: `identity_key_hash`,
  `group_id`, `biz_opaque_callback_data` y, desde el 23-09-2026, datos de *Conversation Routing* para
  números compartidos entre varios partners.

## 6. Identidad del usuario: BSUID, teléfono y nombre de usuario

**Qué es el BSUID** (*business-scoped user ID*):

- Un identificador del usuario **distinto para cada portfolio de negocio**.
- Formato: código de país ISO 3166 alfa-2, un punto y hasta 128 caracteres alfanuméricos. Por ejemplo,
  `US.13491208655302741918`.
- Se guarda y se envía **entero**, sin separar el prefijo del país. Si se modifica, las peticiones fallan.
- Se regenera cuando el usuario cambia de número.
- Existe una variante «parent BSUID» (`US.ENT.…`, campo `parent_user_id`) para grupos de portfolios. Solo
  aparece si Meta la activa para el negocio; en v1 no se usa.

**Fechas**:

| Hito | Fecha |
|---|---|
| El BSUID aparece en los webhooks | Principios de abril de 2026 |
| Los negocios pueden reservar su nombre de usuario | 29-06-2026 |
| Se puede enviar a un BSUID | Julio de 2026 |
| Los usuarios activan su nombre de usuario | Despliegue gradual durante 2026 |

**Qué campos llegan y cuándo** (tablas oficiales de referencia rápida):

| Campo | Mensajes entrantes | Estados `sent`, `delivered` y `read` | Estado `failed` |
|---|---|---|---|
| `contacts[].profile.name` | Siempre | Siempre (el bloque `contacts` es nuevo en los estados) | Sin bloque `contacts` |
| `contacts[].profile.username` | Solo si el usuario tiene nombre de usuario | Solo en `delivered` y `read`, si lo tiene | — |
| `contacts[].wa_id` | Si el teléfono se puede compartir (ver abajo) | Siempre si se envió al teléfono; si se envió al BSUID, solo si se puede compartir | — |
| `contacts[].user_id` (BSUID) | Siempre | Siempre | — |
| `messages[].from` | Igual que `wa_id` | — | — |
| `messages[].from_user_id` (BSUID) | Siempre | — | — |
| `statuses[].recipient_id` | — | El teléfono si se envió al teléfono; puede faltar si se envió al BSUID | Presente si se envió al teléfono |
| `statuses[].recipient_user_id` (BSUID) | — | Siempre | **Falta si se envió al teléfono** |

**Cuándo se comparte el teléfono**: si el usuario activa el nombre de usuario, su teléfono solo aparece si se
cumple alguna de estas condiciones:

- **ese mismo número del negocio** le escribió o le llamó en los últimos 30 días;
- **ese mismo número del negocio** recibió un mensaje o una llamada suyos en los últimos 30 días;
- el usuario está en la «contact book» del portfolio. Es un servicio de Meta, sin integración por nuestra
  parte y desactivable en Meta Business Suite, que guarda el teléfono y el BSUID de las interacciones
  posteriores a su lanzamiento. Meta lo describe como «una vez disponible»: **no verificado** si ya está
  activo para todos.

Si falta, falta el campo entero: no llega una cadena vacía.

**Cambios de identidad**: llegan como mensaje entrante `type: "system"` por el campo `messages`. No existe
un campo de webhook `user_id_update`: Meta lo retiró de su documentación el 11-08-2026.

- `system.type = "user_changed_number"`: el usuario cambió de número y el nuevo se puede compartir. Trae el
  `wa_id` nuevo, el `user_id` nuevo y `previous_user_id`.
- `system.type = "user_changed_user_id"`: solo cambió el BSUID y no se puede compartir el teléfono. Trae
  `user_id` y `previous_user_id`, y normalmente no trae `from` ni `wa_id`.

**Cómo lo usa DominIA Agentes** (el porqué de `contact_identities`):

1. Clave de identidad de WhatsApp: `channel_type = "whatsapp"` + `external_id` = BSUID. El teléfono va en
   `phone` y solo como dato, porque puede faltar y porque `wa_id` y el teléfono real no siempre coinciden,
   como advierte Meta.
2. Al recibir un mensaje se busca primero por BSUID. Si no aparece y llega `wa_id`, se busca por teléfono
   para enlazar contactos anteriores a abril de 2026 y se completa el BSUID.
3. Con un `system` de cambio se busca la identidad por `previous_user_id`, se actualiza al `user_id` nuevo
   (y al teléfono nuevo, si llega) y se registra el cambio. Sin esto, el cliente parecería un contacto nuevo.
4. El BSUID es único **por portfolio**. Todos los números del mismo portfolio lo comparten. Un número de
   otro portfolio no puede enviarle.
5. Si llega un mensaje sin `user_id` (payloads anteriores a abril de 2026 o fixtures antiguos), se usa
   `wa_id` como identificador provisional sin fallar.
6. El teléfono se normaliza a dígitos: los ejemplos oficiales llegan sin `+` (`16505551234`), pero las
   tablas de parámetros muestran `+16505551234`.
7. Del prefijo del BSUID sale el país del usuario aunque no haya teléfono, y sirve para elegir la tarifa
   (§8.3).

**Pedir el teléfono**: existe un botón `REQUEST_CONTACT_INFO` para plantillas y un mensaje interactivo
`request_contact_info` (desde principios de julio de 2026). La respuesta llega como mensaje `contacts` con
`contacts[].origin = "contact_request"`. En v1 no es imprescindible.

**Pruebas en el panel de Meta**: en *App Dashboard > Use cases > Connect with customers through WhatsApp >
Customize > Configuration* (o *WhatsApp > Configuration* en apps anteriores a diciembre de 2025), el enlace
*Test* del campo `messages` envía payloads de prueba con tres escenarios:

- usuario sin nombre de usuario;
- usuario con nombre de usuario y sin teléfono;
- usuario con nombre de usuario y con teléfono.

## 7. Mensajes entrantes

### 7.1 Campos comunes de cada `messages[]`

| Campo | Contenido |
|---|---|
| `id` | **wamid**, el ID del mensaje. Es el `external_id` que se deduplica. |
| `from` / `from_user_id` | Teléfono (puede faltar) y BSUID (§6). |
| `timestamp` | Cadena con segundos Unix. Meta lo define como «cuándo se disparó el webhook». Se usa como hora del mensaje. |
| `type` | `text`, `audio`, `image`, `video`, `document`, `sticker`, `location`, `contacts`, `interactive`, `button`, `reaction`, `order`, `system` o `unsupported`. |
| `<type>` | Objeto con el contenido, con el mismo nombre que `type`. |
| `context` | Opcional. `{from, id}` cuando responde a un mensaje nuestro (botones, listas). `{forwarded: true}` o `{frequently_forwarded: true}` si es reenviado. `referred_product` si viene del botón «Message business» de un catálogo. |
| `referral` | Opcional. El mensaje viene de un anuncio *Click to WhatsApp*: `source_url`, `source_id`, `source_type: "ad"`, `headline`, `body`, `media_type`, `ctwa_clid` (falta en anuncios de Estados), `welcome_message.text`… |
| `errors[]` | Solo en `unsupported` (§7.3). |
| `group_id` | Solo en mensajes de grupos (Groups API). v1 no usa grupos: se ignoran. |

Las respuestas citando un mensaje de texto normal traen `context` con `from` e `id` según la documentación
anterior de Meta. **No verificado** en las páginas actuales, que solo lo muestran para interactivos,
botones y catálogo. Se trata como opcional.

### 7.2 Contenido por tipo

| `type` | Contenido | Uso en DominIA Agentes |
|---|---|---|
| `text` | `text.body` | Texto. |
| `audio` | `audio.{id, mime_type, sha256, url, voice}`. `voice: true` si es nota de voz grabada. Las notas de voz llegan como `audio/ogg; codecs=opus`. | Descargar y transcribir (§10). |
| `image` | `image.{id, mime_type, sha256, url, caption?}` | Descargar. El `caption` es el texto del mensaje. |
| `video` | `video.{id, mime_type, sha256, url, caption?}` | Descargar si no pasa del límite. |
| `document` | `document.{id, mime_type, sha256, url, filename, caption?}` | Descargar. PDF al modelo o extraído. |
| `sticker` | `sticker.{id, mime_type, sha256, url, animated}` (WebP) | Mostrar como imagen. El agente recibe «[sticker]». |
| `location` | `location.{latitude, longitude, name?, address?, url?}` (latitud y longitud son números) | Texto con coordenadas y dirección. |
| `contacts` | `contacts[]` con `name.formatted_name`, `phones[].{phone, wa_id, type}`, `emails[]`, `org`, `urls`, `addresses`, `birthday`. Desde 2026 también `origin` (`contact_request` u `other`) y `vcard`. | Texto con los datos. Si `origin` es `contact_request`, guardar el teléfono en la identidad. |
| `interactive` | `interactive.type` = `button_reply` (`{id, title}`), `list_reply` (`{id, title, description}`), `nfm_reply` (formulario de WhatsApp Flows: `{name: "flow", body, response_json}`, donde `response_json` es una cadena JSON) o `product`. | El `title` como texto y el `id` en metadatos. |
| `button` | `button.{payload, text}`: botón de respuesta rápida de una **plantilla**. Trae `context`. | Texto. Sirve para «Cancelar cita» en recordatorios. |
| `reaction` | `reaction.{message_id, emoji}`. Si el usuario **quita** la reacción, llega otro webhook **sin la propiedad `emoji`**; no llega una cadena vacía. Solo reacciones a mensajes del negocio de los últimos 30 días. | Se marca en el mensaje citado. No dispara respuesta de la IA. |
| `order` | `order.{catalog_id, text?, product_items[].{product_retailer_id, quantity, item_price, currency}}` | Mensaje de sistema (v1 no tiene catálogo). |
| `system` | `system.{body, type, wa_id?, user_id, previous_user_id?, parent_user_id?, …}` (§6) | Evento de identidad. No es un mensaje del cliente. |
| `unsupported` | `unsupported.type` + `errors[]` (§7.3) | Mensaje de sistema: «El cliente envió un tipo de mensaje no admitido». |

Tipos que Meta marca como no admitidos (`unsupported.type`): `button`, `edit`, `errors`, `gif`,
`group_invite`, `hsm`, `image`, `interactive`, `keep_in_chat`, `link_preview`, `list`, `location`,
`media_placeholder`, `order`, `pin`, `poll_creation`, `poll_update`, `product` y `reaction`. Aparecen
`image` y `location` porque hay variantes que no se admiten.

Meta retiró el webhook `request_welcome` (mensaje de bienvenida), según su changelog. No hay que
contar con él.

Solo un subconjunto de tipos cuenta como «mensaje del cliente» para la IA. Las reacciones, los `system`,
los `unsupported` y los errores no abren un turno de respuesta de la IA.

### 7.3 `unsupported`

`errors[]` trae:

- `code`: `131051` (tipo no admitido) o `131060` (mensaje no disponible, típico de números que usan a la
  vez la app WhatsApp Business y la API, fuera de alcance);
- `title` y `message` (el mismo texto; para `131051` es `Message type unknown`);
- `error_data.details`.

### 7.4 Errores a nivel de `value`

`value.errors[]`, sin `messages` ni `statuses`, avisa de problemas de sistema, de app o de cuenta. Por
ejemplo, `130429` «Rate limit hit». Se normaliza como `account_event` y se muestra en el diagnóstico del
canal.

### 7.5 Mensajes demasiado grandes

Si el cliente envía un archivo de más de 100 MB llega un webhook con el error `131052`: «Media file size
too big…». Hay que avisar al cliente y ofrecer otra vía.

## 8. Estados de los mensajes salientes (`statuses[]`)

### 8.1 Campos

| Campo | Contenido |
|---|---|
| `id` | wamid del mensaje que enviamos (el que devolvió la API al enviar). |
| `status` | `sent` (salió de los servidores de Meta), `delivered` (llegó al dispositivo), `read` (se mostró en el chat abierto), `failed` (no se pudo enviar o entregar) o `played` (primera reproducción de una nota de voz enviada por el negocio; existe desde el 17-03-2026). **No existe `deleted` en la Cloud API.** |
| `timestamp` | Cadena con segundos Unix. |
| `recipient_id` / `recipient_user_id` | Teléfono y BSUID del destinatario (§6). |
| `recipient_type`, `recipient_participant_id` | Solo en grupos. |
| `biz_opaque_callback_data` | Solo si se envió con ese campo. Útil para correlacionar. |
| `conversation` | **Desde v24.0 no se envía**, salvo en ventanas de *free entry point*. Con v26.0 no hay que esperarlo. |
| `pricing` | `{billable, pricing_model, type, category}` (§8.3). Solo en algunos de los estados de cada mensaje. |
| `errors[]` | Solo si `failed`: `{code, title, message, error_data.details, href}`. `title` y `message` llevan el mismo texto. |

**Reglas de comportamiento** (oficiales):

- Un mensaje puede recibir hasta tres webhooks de estado (`sent`, `delivered` y `read`). Si el usuario
  está con el chat abierto, `delivered` **no se envía** y llega directamente `read`.
- Al enviar una **reacción** solo llega `sent`.
- `failed` puede tardar un poco en llegar.
- Si no llega `delivered` dentro del TTL, el mensaje se da por perdido. El TTL es de 30 días para todo
  salvo las plantillas de autenticación.

### 8.2 Cómo se aplican (el porqué)

- **Estados monótonos**: `queued` < `sent` < `delivered` < `read`. `played` es posterior a `read` y solo
  aplica a notas de voz. Un estado anterior que llega tarde se ignora. `failed` sustituye a `queued` o a
  `sent`, pero no a `delivered` ni a `read`.
- **Estado de un wamid desconocido**: el webhook de estado puede llegar antes de que termine de guardarse
  la respuesta del envío. **No verificado** en la documentación de Meta: es una carrera de tiempos posible
  en cualquier integración. Se guarda el evento en bruto y se reintenta asociarlo en el siguiente
  `tick()` en lugar de descartarlo.
- **Deduplicación**: aplicar dos veces el mismo `(wamid, status)` no cambia nada.

### 8.3 `pricing` y coste estimado

| Campo | Valores |
|---|---|
| `pricing_model` | `PMP` (precio por mensaje). `CBP` solo en webhooks anteriores al 01-07-2025. |
| `category` | `service`, `utility`, `marketing`, `marketing_lite`, `authentication`, `authentication-international`, `referral_conversion`, `group_service`, `group_utility` y `group_marketing`. |
| `type` | `regular` (se cobra), `free_customer_service`, `free_entry_point` o `free_group_customer_service`. |
| `billable` | Booleano. **Meta anuncia que se deprecará**: hay que usar `type` + `category`. |

Cambio del **1-10-2026**, en la página de precios y en la referencia de estados:

- Los **mensajes de servicio** (texto libre dentro de la ventana) pasan a cobrarse por mensaje, a la
  **misma tarifa que utilidad y autenticación de cada mercado**.
- Hay un **tramo gratuito de 1.000 mensajes de servicio entregados al mes por número**. No se acumula, se
  reinicia cada mes y lo comparten los mensajes 1:1 y los de grupo.
- Dentro del tramo gratuito: `type: "free_customer_service"`, `billable: false`. Agotado:
  `type: "regular"`, `billable: true`, `category: "service"`.
- Las **plantillas de utilidad** enviadas dentro de la ventana también pasan a cobrarse (`type: "regular"`).
  Hasta el 30-09-2026 eran `free_customer_service`.
- Sin método de pago, Meta entrega los mensajes de servicio dentro del tramo gratuito y deja de entregarlos
  cuando se agota.

**Cálculo del coste estimado en DominIA Agentes**:

1. Se toma el primer `pricing` que llegue para cada wamid. Puede venir en `sent` o en `delivered`; el
   ejemplo oficial de v24 dice que aparece en uno u otro. Se guarda una sola vez.
2. Si `type` es `regular`, coste = tarifa editable en Ajustes para (mercado del destinatario, `category`).
   Si `type` empieza por `free_`, coste 0.
3. **No hace falta contar nosotros los 1.000 gratuitos**: Meta ya lo indica en `type`. Llevar un contador
   propio duplicaría el descuento.
4. El mercado sale del prefijo del teléfono o, si no hay teléfono, del prefijo ISO del BSUID. Meta agrupa
   algunos países en regiones «Rest of…», así que la tabla de tarifas es por mercado.

## 9. Webhooks de cuenta

Todos llegan con `object: "whatsapp_business_account"`, `entry[].id` = ID de la WABA y `entry[].time`
(entero Unix). **No traen `metadata` ni `phone_number_id`.**

| `field` | Qué avisa | Datos clave en `value` | Cómo se encuentra el canal |
|---|---|---|---|
| `account_update` | Cambios de la cuenta: violaciones de política, restricciones, bloqueo, borrado, cambios de partners y de precios. | `event`: `ACCOUNT_VIOLATION` (`violation_info.violation_type`), `ACCOUNT_RESTRICTION` (`restriction_info[].{restriction_type, expiration}`), `DISABLED_UPDATE` (`ban_info.{waba_ban_state, waba_ban_date}`), `ACCOUNT_DELETED`, `VOLUME_BASED_PRICING_TIER_UPDATE`, `BUSINESS_PRIMARY_LOCATION_COUNTRY_UPDATE`, `PARTNER_*`, `MM_LITE_TERMS_SIGNED`, `AD_ACCOUNT_LINKED`, `AUTH_INTL_PRICE_ELIGIBILITY_UPDATE`, `ACCOUNT_OFFBOARDED` y `ACCOUNT_RECONNECTED`. | Solo WABA: todos sus canales. |
| `message_template_status_update` | Cambio de estado de una plantilla. | `event` (`APPROVED`, `REJECTED`, `PENDING`, `PAUSED`, `DISABLED`, `FLAGGED`, `REINSTATED`, `ARCHIVED`, `UNARCHIVED`, `DELETED`, `PENDING_DELETION`, `IN_APPEAL`, `LOCKED` o `LIMIT_EXCEEDED`), `message_template_id` (número), `message_template_name`, `message_template_language`, `reason` (puede ser `null`), `message_template_category`, y `rejection_info`, `disable_info` u `other_info` según el caso. | Solo WABA: las plantillas son de la WABA. Se actualiza `whatsapp_templates`. |
| `phone_number_quality_update` | Cambio de capacidad de envío del número. | `display_phone_number`, `event` (`THROUGHPUT_UPGRADE` u `ONBOARDING`), `max_daily_conversations_per_business` (`TIER_250`, `TIER_2K`, `TIER_10K`, `TIER_100K`, `TIER_UNLIMITED`…). `current_limit` y `old_limit` iban a retirarse en febrero de 2026 pero siguen en los ejemplos. | WABA + `display_phone_number`. |
| `phone_number_name_update` | Resultado de la revisión del nombre visible. | `display_phone_number`, `decision` (`APPROVED`, `REJECTED`, `PENDING` o `DEFERRED`), `requested_verified_name` y `rejection_reason` (`null` si se aprueba). | WABA + `display_phone_number`. Actualiza `name_status`. |
| `business_capability_update` | Cambio de límites del portfolio o de la WABA. | `max_daily_conversations_per_business` (la documentación dice `TIER_*`, pero el ejemplo trae el número `2000`), `max_phone_numbers_per_waba` y `max_phone_numbers_per_business`. | WABA. |
| `account_alerts` | Avisos: no se puede subir el límite, insignia de cuenta oficial, foto de perfil borrada. | `entity_type` (`BUSINESS`, `PHONE_NUMBER` o `CURRENT_STATUS_ID`), `entity_id` (ID del portfolio o del número) y `alert_info.{alert_severity (CRITICAL, WARNING o INFORMATIONAL), alert_status, alert_type, alert_description}`. | WABA. Si `entity_type` es `PHONE_NUMBER`, `entity_id` es el `phone_number_id`. |
| `security` | Cambios de la verificación en dos pasos del número. | `display_phone_number`, `event` (`PIN_CHANGED`, `PIN_RESET_REQUEST` o `PIN_REQUEST_SUCCESS`) y `requester`. | WABA + `display_phone_number`. Merece aviso al propietario. |

Notas:

- `display_phone_number` se compara normalizado a dígitos con el guardado en el canal.
- `message_template_language`: el ejemplo oficial trae `en-US` con guion, mientras que al enviar se usa
  `en_US` con guion bajo. Se compara normalizando `-` y `_`. **No verificado** cuál llega en realidad.
- Por qué se suscriben: `message_template_status_update` sincroniza las plantillas sin sondear.
  `account_update`, `phone_number_quality_update` y `phone_number_name_update` alimentan los semáforos del
  panel. `account_alerts` y `security` generan avisos.
- Para recibir mensajes y estados hace falta el permiso `whatsapp_business_messaging`. Para los demás
  webhooks, `whatsapp_business_management`.

## 10. Medios

### 10.1 Duración de IDs y URLs

| Elemento | Validez |
|---|---|
| ID de un medio **recibido por webhook** | **7 días**. Antes del 09-10-2025 eran 30. |
| ID de un medio **subido por nosotros** | 30 días, salvo que se borre antes. |
| URL de descarga (de `GET /{MEDIA_ID}` o del campo `url` del webhook) | **5 minutos**. Después hay que volver a pedir el ID. |

Por eso los medios se descargan **al recibirlos**, en un job inmediato, y se guardan en `FileStorage`.

### 10.2 Descarga

1. El webhook ya trae `url` en `image`, `audio`, `video`, `document` y `sticker`. Se fue activando de forma
   gradual desde el 12-11-2025 y puede faltar.
2. Si no viene, o si la descarga devuelve 404, se pide `GET https://graph.facebook.com/v26.0/{MEDIA_ID}`
   con `Authorization: Bearer <token>`. El parámetro opcional `?phone_number_id=` hace que solo responda si
   el medio es de ese número.
   - La respuesta es `{messaging_product, url, mime_type, sha256, file_size, id}`.
   - `file_size` es una **cadena** según la referencia (`"303833"`); se admite también número.
3. `GET <url>` **con el mismo `Authorization: Bearer`**: sin token, falla. Devuelve el binario y el
   `Content-Type`.
4. Si falla con 404: se pide una URL nueva. Si sigue fallando, se revisa el token.
5. Se comprueba la integridad con `sha256`: viene en base64 en los ejemplos. **No verificado** si es el hash
   del archivo tal cual. Si no coincide, se registra, pero no se bloquea.

Para los tests: la URL de Graph se construye con `META_GRAPH_BASE_URL`, pero la `url` de descarga es
absoluta (`https://lookaside.fbsbx.com/…`). En los tests unitarios se inyecta `fetch`. En E2E, el servidor
simulado devuelve en `GET /{MEDIA_ID}` una `url` que apunta a sí mismo. Si un fixture trae `url`, el
descargador debe poder saltársela y pedir `GET /{MEDIA_ID}`.

### 10.3 Tipos y tamaños admitidos (para enviar)

| Tipo | Formatos | Máximo |
|---|---|---|
| Audio | `audio/aac`, `audio/amr`, `audio/mpeg` (mp3), `audio/mp4` (m4a), `audio/ogg` (**solo OPUS y mono**; «audio/ogg» a secas no) | 16 MB |
| Documento | `text/plain`, PDF, Word (`.doc` y `.docx`), Excel (`.xls` y `.xlsx`), PowerPoint (`.ppt` y `.pptx`) | 100 MB |
| Imagen | `image/jpeg`, `image/png` (8 bits, RGB o RGBA) | 5 MB |
| Sticker | `image/webp`: animado 500 KB, estático 100 KB | — |
| Vídeo | `video/mp4`, `video/3gpp` (H.264 + AAC, una pista de audio o ninguna) | 16 MB |

- Lo que se **recibe** puede llegar hasta 100 MB. Por encima llega el error `131052`.
- El error más común al enviar es un MIME que no coincide con el archivo (`131053`).
- Una nota de voz de WhatsApp llega como `audio/ogg; codecs=opus`. Para OpenRouter se prueba tal cual y,
  si la rechaza, se convierte a MP3 con ffmpeg, como dice la especificación.

### 10.4 Subida

`POST /{PHONE_NUMBER_ID}/media` en `multipart/form-data`:

- `messaging_product=whatsapp`;
- `file`, con su tipo MIME en la parte;
- `type`, que la tabla de parámetros marca como obligatorio aunque el ejemplo oficial no lo envía. Se
  envía siempre.

Devuelve `{"id": "<MEDIA_ID>"}`. También existe `DELETE /{MEDIA_ID}`, que devuelve `{"success": true}`.

Se prefiere subir y enviar por `id` antes que por `link`: rinde mejor. Si se usa `link`, Meta guarda el
archivo 10 minutos y lo reutiliza si la URL es idéntica.

## 11. Envío

### 11.1 Petición común

`POST https://graph.facebook.com/v26.0/{PHONE_NUMBER_ID}/messages` con
`Authorization: Bearer <token>` y `Content-Type: application/json`.

| Campo | Contenido |
|---|---|
| `messaging_product` | `"whatsapp"`, obligatorio. |
| `recipient_type` | `"individual"` (o `"group"`, fuera de alcance). |
| `to` | Teléfono del usuario. **Siempre con `+` y prefijo del país**: sin `+`, Meta antepone el prefijo del país del número del negocio y el mensaje puede ir a otro número. Como `wa_id` llega sin `+`, se envía `+` + `wa_id`. |
| `recipient` | BSUID del usuario (desde julio de 2026). Si van `to` y `recipient`, **gana `to`**. Para enviar solo al BSUID se omite `to`. |
| `type` | `text`, `image`, `audio`, `document`, `video`, `sticker`, `location`, `contacts`, `interactive`, `template` o `reaction`. |
| `<type>` | Contenido según el tipo. |
| `context.message_id` | Opcional: responde citando un wamid recibido. No vale para reacciones. En plantillas no se ve la cita. |
| `biz_opaque_callback_data` | Opcional. Vuelve en los estados. |
| `messaging_account_id` | Solo con varias Messaging accounts en el mismo número (§1). No aplica. |

La referencia de la API (esquema de v25.0) aún marca `to` como obligatorio y no incluye `recipient`. La
guía del BSUID, más reciente, sí permite enviar solo `recipient`. **Criterio**: si hay teléfono, se usa
`to`; si no, `recipient`. Nunca los dos, para que la respuesta sea predecible.

### 11.2 Respuesta correcta

`{messaging_product, contacts: [{input, wa_id?, user_id?}], messages: [{id, message_status?}]}`.

- `contacts[].input` es lo que se envió.
- Se envió al teléfono: llega `wa_id` y no llega `user_id`.
- Se envió al BSUID: llega `user_id` y no llega `wa_id`.
- `messages[].id` es el wamid: se guarda **antes** de que lleguen sus estados.
- `message_status` solo aparece en plantillas con envío dosificado (*template pacing*): `accepted`,
  `held_for_quality_assessment` o `paused`.
- Un 200 **solo** significa que Meta aceptó la petición. La entrega se sabe por los estados.

### 11.3 Error síncrono

```json
{
  "error": {
    "message": "(#130429) Rate limit hit",
    "type": "OAuthException",
    "code": 130429,
    "error_data": { "messaging_product": "whatsapp", "details": "Cloud API message throughput has been reached." },
    "error_subcode": 2494055,
    "fbtrace_id": "Az8or2yhqkZfEZ-_4Qn_Bam"
  }
}
```

- La lógica se basa en `code` y `error_data.details`. Meta desaconseja depender de los títulos y del
  `error_subcode`, que está deprecado desde v16.0.
- Un mismo error puede llegar **de forma síncrona, asíncrona (estado `failed`) o por las dos vías**. El
  cliente tiene que tratar ambas.

### 11.4 Por tipo

- **Texto**: `text.{body, preview_url?}`. `body` admite hasta 4.096 caracteres. `preview_url: true`
  muestra la vista previa de la primera URL (tiene que empezar por `http://` o `https://`).
- **Imagen, audio, vídeo y documento**: `{id | link, caption?}`.
  - Solo uno de `id` o `link`.
  - `caption` admite hasta 1.024 caracteres. El audio no lleva `caption`.
  - El documento admite `filename`: el cliente elige el icono por la extensión.
  - `audio.voice: true` envía una nota de voz: tiene que ser OGG/OPUS y, por encima de 512 KB, se muestra
    como descarga. Para enviar audio normal se omite.
- **Plantilla**: `template.{name, language: {code}, components?}`.
  - `components[]` con `type` `header` (medios: `parameters: [{type: "image", image: {id}}]`, o `document` o
    `video`), `body` o `button`.
  - Parámetros **con nombre**: `{type: "text", parameter_name: "first_name", text: "…"}`, en cualquier
    orden. **Posicionales**: `{type: "text", text: "…"}`, en el orden de `{{1}}`, `{{2}}`…
  - El formato (`parameter_format`: `named` o `positional`) se fija al crear la plantilla. Por defecto es
    `positional`.
  - Errores típicos: `132000` (el número de parámetros no coincide), `132001` (plantilla inexistente en ese
    idioma o sin aprobar), `132012` (formato de parámetros incorrecto), `132015` y `132016` (plantilla
    pausada o desactivada por calidad).
- **Interactivo con botones** (`interactive.type: "button"`):
  - hasta 3 botones `{type: "reply", reply: {id ≤ 256, title ≤ 20 y único}}`;
  - `body.text` ≤ 1.024 caracteres y `footer.text` ≤ 60;
  - `header` opcional: `text`, `image`, `video` o `document`.
- **Interactivo con lista** (`interactive.type: "list"`):
  - `action.button` ≤ 20 caracteres;
  - hasta 10 secciones (`title` ≤ 24) y **10 filas en total**, cada una con `id` ≤ 200, `title` ≤ 24 y
    `description` ≤ 72;
  - `body.text` ≤ 4.096 caracteres, `header` solo de texto (≤ 60) y `footer` ≤ 60.
- **Reacción**: `reaction.{message_id, emoji}` sobre un mensaje recibido.
  - Si el mensaje tiene más de 30 días, no existe o es otra reacción, llega un webhook con el error
    `131009`.
  - Cómo **quitar** una reacción enviada (antes, con `emoji: ""`): **no verificado** en la página actual.

**Orden de envío**: Meta no garantiza que varios mensajes lleguen en el orden de las peticiones. Si importa
el orden, hay que esperar el `delivered` de uno antes de enviar el siguiente. Con «una sola respuesta por
turno» se evita casi siempre.

## 12. Marcar como leído y «escribiendo…»

- **Leído**: `POST /{PHONE_NUMBER_ID}/messages` con
  `{"messaging_product": "whatsapp", "status": "read", "message_id": "<wamid recibido>"}`.
  - Devuelve `{"success": true}`.
  - Solo sirve para mensajes de los últimos 30 días, y marca también como leídos los anteriores de la
    conversación.
  - Un wamid no válido devuelve `131009`.
- **Escribiendo…**: la misma llamada con `"typing_indicator": {"type": "text"}`. También marca como leído.
  - El indicador desaparece al responder o **a los 25 segundos**, lo que ocurra antes.
  - Meta pide mostrarlo solo si se va a responder.
- **Uso en DominIA Agentes**: se envía al empezar el job de respuesta (no en el webhook) con el último
  wamid del turno, y solo si la IA va a contestar. **No verificado** si repetir la llamada renueva los 25 s;
  si la respuesta tarda más, simplemente desaparece.
- Estas llamadas usan el wamid, así que funcionan igual si el usuario solo tiene BSUID.

## 13. Ventana de atención de 24 horas

- Se **abre cuando el usuario escribe o llama** al número y **se renueva a 24 h** con cada mensaje o llamada
  suyos.
- Dentro de la ventana se puede enviar cualquier mensaje de servicio. Fuera de ella **solo plantillas
  aprobadas**.
- Si se envía texto libre fuera de la ventana, falla con **`131047`**: «More than 24 hours have passed
  since the recipient last replied to the sender number». Meta lo documenta así en el campo `details`; en
  integraciones se ve con el título «Re-engagement message» (**no verificado** en la documentación actual).
  Puede llegar como error síncrono o como estado `failed`.
- La ventana es **por número del negocio y usuario**. Meta avisa de un problema conocido: en casos raros
  llega un mensaje y aun así no se puede responder dentro de la ventana.
- El tramo gratuito, el cobro del servicio desde el 1-10-2026 y las plantillas de utilidad dentro de la
  ventana cambian el precio, **no** cuándo se puede enviar (§8.3).

**Cálculo en DominIA Agentes**: `window_open = now < last_inbound_at + 24 h`, donde `last_inbound_at` es el
`timestamp` de Meta del último mensaje del cliente en esa conversación, no la hora de llegada del webhook.

- Si el cálculo dice «abierta» pero Meta devuelve `131047`, manda Meta: la conversación se marca como
  «ventana cerrada» y la bandeja exige una plantilla.
- **No verificado**: si una **reacción** del usuario abre o renueva la ventana. Por prudencia, las
  reacciones, los `system` y los `unsupported` no cuentan para `last_inbound_at`.

## 14. Límites de envío

| Límite | Valor | Error | Qué hacer |
|---|---|---|---|
| Rendimiento por número | 80 mensajes/s por defecto. Hasta 1.000 con subida automática, para negocios con límite ilimitado y 100.000 usuarios únicos al día. Cuenta mensajes entrantes y salientes. | `130429` | Reintentar con espera. |
| Par número-usuario | 1 mensaje cada 6 s al mismo usuario (unos 10 por minuto o 600 por hora). Admite ráfagas de hasta 45 en 6 s, que se descuentan de lo siguiente. | `131056` | Reintentar a los 4^X segundos (X = 0, 1, 2…). |
| Límite de mensajes (*messaging limit*) | Usuarios únicos al día con conversaciones que abre el negocio, **por portfolio**. Responder dentro de la ventana no cuenta. | Según el caso: no verificado aquí | Mostrar en el panel. Detalle en el documento de conexión. |
| Llamadas a la API de gestión | 200 por hora y app por WABA; 5.000 si la WABA tiene un número registrado. | `4` / `80007` | Espaciar las comprobaciones de salud. |
| Número en mantenimiento | Hasta 1 minuto durante la subida de rendimiento. | `131057` | Reintentar. |

## 15. Errores útiles y qué hace la app

Solo los relevantes para mensajería. Los de alta y registro van en el documento de conexión.

| Código | Significado (`details` oficial resumido) | Tipo | Acción |
|---|---|---|---|
| `130429` | Límite de rendimiento de la Cloud API | Temporal | Reintento con espera. |
| `131056` | Demasiados mensajes al mismo usuario en poco tiempo | Temporal | Reintento a los 4^X s. |
| `131016` | Servicio no disponible temporalmente | Temporal | Reintento. |
| `131000` | Error desconocido | Temporal | Reintento limitado. Después, fallido. |
| `131057` | Cuenta en mantenimiento | Temporal | Reintento. |
| `4`, `80007` | Límite de llamadas de la app o de la WABA | Temporal | Reintento más tarde. |
| `131047` | Han pasado más de 24 h desde el último mensaje del usuario | Permanente | Fallido y «ventana cerrada»: la bandeja pide plantilla. |
| `131026` | No se puede entregar (no es número de WhatsApp, condiciones sin aceptar, versión antigua) | Permanente | Fallido y aviso. |
| `131049` | No entregado «para mantener un ecosistema sano» (límite de marketing por usuario) | Permanente por ahora | No reintentar antes de 24 h. |
| `131050` | El usuario dejó de recibir marketing de este negocio | Permanente | No reintentar. |
| `131051` | Tipo de mensaje no admitido | Permanente | Error de programación. |
| `131052` | No se pudo descargar el medio del usuario (también si pasa de 100 MB) | Entrante | Aviso en la conversación. |
| `131053` | No se pudo subir el medio (MIME o formato) | Permanente | Fallido. Revisar el formato. |
| `131009` | Valor de parámetro no válido (también reacción o leído con un wamid malo) | Permanente | Fallido y log. |
| `131008`, `100` | Falta un parámetro o hay uno no admitido | Permanente | Error de programación. |
| `131062` | El BSUID no admite este tipo de mensaje (p. ej., plantillas de autenticación de un toque) | Permanente | Enviar al teléfono si se tiene. |
| `132000`, `132001`, `132012`, `132015`, `132016` | Errores de plantilla (§11.4) | Permanente | Fallido y aviso para revisar la plantilla. |
| `131042` | Problema con el método de pago | Permanente | Semáforo «Método de pago» en rojo. |
| `131048` | Restricción por spam o calidad | Permanente | Aviso de calidad. |
| `131031`, `368` | Cuenta restringida o desactivada por política | Permanente | Semáforo rojo y aviso al propietario. |
| `190` | Token caducado o no válido | Permanente | «Cambiar token». Estado `error` del canal. |
| `131005`, `200`–`299`, `3` | Permisos no concedidos o retirados | Permanente | Revisar los permisos del token. |
| `133010` | Número no registrado | Permanente | Volver al paso de registro. |

Ante un error permanente, la especificación pide marcar el mensaje como fallido, avisar y, opcionalmente,
traspasar a una persona.

## 16. Payloads de ejemplo para tests

Son JSON realistas con la forma oficial y datos inventados a la vista. Datos comunes:

| Dato | Valor |
|---|---|
| WABA | `100000000000001` |
| `phone_number_id` | `200000000000002` |
| Número del negocio | `15550001111` (los 555 son ficticios) |
| Cliente | «Ana Pruebas», `wa_id` `15550002222`, BSUID `US.10000000000000000001` |
| Hora base | `1790416800` = 2026-09-26 10:00:00 UTC |

Los wamid son cadenas legibles (`wamid.TEST_…`); los reales son base64 opacos y el código no debe
interpretarlos. Todos los mensajes entrantes llevan `user_id` y `from_user_id`, como desde abril de 2026.

Meta puede escapar los caracteres no ASCII (`¿`) o enviarlos en UTF-8. El parser debe aceptar ambas
formas, y la firma se calcula siempre sobre los bytes recibidos.

### 16.1 Texto entrante

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "100000000000001",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "15550001111", "phone_number_id": "200000000000002" },
            "contacts": [
              { "profile": { "name": "Ana Pruebas" }, "wa_id": "15550002222", "user_id": "US.10000000000000000001" }
            ],
            "messages": [
              {
                "from": "15550002222",
                "from_user_id": "US.10000000000000000001",
                "id": "wamid.TEST_IN_TEXT_0001",
                "timestamp": "1790416800",
                "type": "text",
                "text": { "body": "Hola, ¿tenéis hueco mañana por la tarde para un corte?" }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### 16.2 Nota de voz entrante

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "100000000000001",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "15550001111", "phone_number_id": "200000000000002" },
            "contacts": [
              { "profile": { "name": "Ana Pruebas" }, "wa_id": "15550002222", "user_id": "US.10000000000000000001" }
            ],
            "messages": [
              {
                "from": "15550002222",
                "from_user_id": "US.10000000000000000001",
                "id": "wamid.TEST_IN_AUDIO_0001",
                "timestamp": "1790416860",
                "type": "audio",
                "audio": {
                  "mime_type": "audio/ogg; codecs=opus",
                  "sha256": "dGVzdC1hdWRpby1zaGEyNTYtZmFrZQ==",
                  "id": "900000000000001",
                  "url": "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=TEST900000000000001",
                  "voice": true
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### 16.3 Imagen con pie de foto

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "100000000000001",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "15550001111", "phone_number_id": "200000000000002" },
            "contacts": [
              { "profile": { "name": "Ana Pruebas" }, "wa_id": "15550002222", "user_id": "US.10000000000000000001" }
            ],
            "messages": [
              {
                "from": "15550002222",
                "from_user_id": "US.10000000000000000001",
                "id": "wamid.TEST_IN_IMAGE_0001",
                "timestamp": "1790416920",
                "type": "image",
                "image": {
                  "caption": "Quiero este color de pelo",
                  "mime_type": "image/jpeg",
                  "sha256": "dGVzdC1pbWFnZS1zaGEyNTYtZmFrZQ==",
                  "id": "900000000000002",
                  "url": "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=TEST900000000000002"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### 16.4 Documento

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "100000000000001",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "15550001111", "phone_number_id": "200000000000002" },
            "contacts": [
              { "profile": { "name": "Ana Pruebas" }, "wa_id": "15550002222", "user_id": "US.10000000000000000001" }
            ],
            "messages": [
              {
                "from": "15550002222",
                "from_user_id": "US.10000000000000000001",
                "id": "wamid.TEST_IN_DOC_0001",
                "timestamp": "1790417000",
                "type": "document",
                "document": {
                  "caption": "Mi presupuesto",
                  "filename": "presupuesto-prueba.pdf",
                  "mime_type": "application/pdf",
                  "sha256": "dGVzdC1kb2Mtc2hhMjU2LWZha2U=",
                  "id": "900000000000003",
                  "url": "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=TEST900000000000003"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### 16.5 Estados `sent`, `delivered` y `read` de una respuesta nuestra

Nuestra respuesta tiene el wamid `wamid.TEST_OUT_0001` y se envió al teléfono. Sigue el patrón del ejemplo
oficial de v24+: `pricing` llega en `delivered` y no en `sent`. En otros casos llega en `sent`, así que el
código lo toma de donde llegue primero y una sola vez. `conversation` no aparece.

`sent`:

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "100000000000001",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "15550001111", "phone_number_id": "200000000000002" },
            "contacts": [
              { "profile": { "name": "Ana Pruebas" }, "wa_id": "15550002222", "user_id": "US.10000000000000000001" }
            ],
            "statuses": [
              {
                "id": "wamid.TEST_OUT_0001",
                "status": "sent",
                "timestamp": "1790416830",
                "recipient_id": "15550002222",
                "recipient_user_id": "US.10000000000000000001"
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

`delivered` con `pricing`: servicio dentro del tramo gratuito, antes o después del 1-10-2026.

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "100000000000001",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "15550001111", "phone_number_id": "200000000000002" },
            "contacts": [
              { "profile": { "name": "Ana Pruebas" }, "wa_id": "15550002222", "user_id": "US.10000000000000000001" }
            ],
            "statuses": [
              {
                "id": "wamid.TEST_OUT_0001",
                "status": "delivered",
                "timestamp": "1790416832",
                "recipient_id": "15550002222",
                "recipient_user_id": "US.10000000000000000001",
                "pricing": {
                  "billable": false,
                  "pricing_model": "PMP",
                  "type": "free_customer_service",
                  "category": "service"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

`read`:

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "100000000000001",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "15550001111", "phone_number_id": "200000000000002" },
            "contacts": [
              { "profile": { "name": "Ana Pruebas" }, "wa_id": "15550002222", "user_id": "US.10000000000000000001" }
            ],
            "statuses": [
              {
                "id": "wamid.TEST_OUT_0001",
                "status": "read",
                "timestamp": "1790416900",
                "recipient_id": "15550002222",
                "recipient_user_id": "US.10000000000000000001"
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

Variante de `pricing` para un servicio **de pago** (desde el 1-10-2026, con el tramo gratuito agotado). El
coste estimado debe ser la tarifa del mercado × 1:

```json
{ "billable": true, "pricing_model": "PMP", "type": "regular", "category": "service" }
```

### 16.6 Estado `failed` por la ventana de 24 h (`131047`)

Los estados `failed` no llevan `contacts`. Si se envió al teléfono, tampoco llevan `recipient_user_id`.
El `title` es el que se ve en integraciones (no verificado); el `details` es el texto oficial.

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "100000000000001",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "15550001111", "phone_number_id": "200000000000002" },
            "statuses": [
              {
                "id": "wamid.TEST_OUT_0002",
                "status": "failed",
                "timestamp": "1790503200",
                "recipient_id": "15550002222",
                "errors": [
                  {
                    "code": 131047,
                    "title": "Re-engagement message",
                    "message": "Re-engagement message",
                    "error_data": {
                      "details": "More than 24 hours have passed since the recipient last replied to the sender number."
                    },
                    "href": "/documentation/business-messaging/whatsapp/support/error-codes"
                  }
                ]
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### 16.7 Mensaje de un contacto que **solo** tiene BSUID

El usuario tiene nombre de usuario y el teléfono no se puede compartir: faltan `wa_id` y `from`. El test
comprueba que se crea la identidad con `external_id` = BSUID y `phone` vacío, y que la respuesta se envía
con `recipient`.

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "100000000000001",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "15550001111", "phone_number_id": "200000000000002" },
            "contacts": [
              { "profile": { "name": "Lucía Test", "username": "lucia_prueba" }, "user_id": "ES.20000000000000000002" }
            ],
            "messages": [
              {
                "from_user_id": "ES.20000000000000000002",
                "id": "wamid.TEST_IN_BSUID_0001",
                "timestamp": "1790417100",
                "type": "text",
                "text": { "body": "Buenas, ¿cuánto cuesta un tinte?" }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### 16.8 El mismo mensaje entregado dos veces

Es un reintento de Meta: el mismo cuerpo, con los mismos bytes y la misma firma, llega en dos `POST`
distintos. Cada elemento del array es un `POST`. El test comprueba que:

- las dos peticiones reciben 200;
- solo hay **un** registro en `messages` para (`channel_id`, `wamid.TEST_IN_TEXT_0001`);
- solo se encola **una** respuesta;
- `webhook_events` puede guardar las dos entregas en bruto.

```json
[
  {
    "object": "whatsapp_business_account",
    "entry": [
      {
        "id": "100000000000001",
        "changes": [
          {
            "value": {
              "messaging_product": "whatsapp",
              "metadata": { "display_phone_number": "15550001111", "phone_number_id": "200000000000002" },
              "contacts": [
                { "profile": { "name": "Ana Pruebas" }, "wa_id": "15550002222", "user_id": "US.10000000000000000001" }
              ],
              "messages": [
                {
                  "from": "15550002222",
                  "from_user_id": "US.10000000000000000001",
                  "id": "wamid.TEST_IN_TEXT_0001",
                  "timestamp": "1790416800",
                  "type": "text",
                  "text": { "body": "Hola, ¿tenéis hueco mañana por la tarde para un corte?" }
                }
              ]
            },
            "field": "messages"
          }
        ]
      }
    ]
  },
  {
    "object": "whatsapp_business_account",
    "entry": [
      {
        "id": "100000000000001",
        "changes": [
          {
            "value": {
              "messaging_product": "whatsapp",
              "metadata": { "display_phone_number": "15550001111", "phone_number_id": "200000000000002" },
              "contacts": [
                { "profile": { "name": "Ana Pruebas" }, "wa_id": "15550002222", "user_id": "US.10000000000000000001" }
              ],
              "messages": [
                {
                  "from": "15550002222",
                  "from_user_id": "US.10000000000000000001",
                  "id": "wamid.TEST_IN_TEXT_0001",
                  "timestamp": "1790416800",
                  "type": "text",
                  "text": { "body": "Hola, ¿tenéis hueco mañana por la tarde para un corte?" }
                }
              ]
            },
            "field": "messages"
          }
        ]
      }
    ]
  }
]
```

### 16.9 `account_update` (restricción de la cuenta)

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "100000000000001",
      "time": 1790420400,
      "changes": [
        {
          "value": {
            "event": "ACCOUNT_RESTRICTION",
            "restriction_info": [
              { "restriction_type": "RESTRICTED_BIZ_INITIATED_MESSAGING", "expiration": 1791025200 }
            ]
          },
          "field": "account_update"
        }
      ]
    }
  ]
}
```

### 16.10 `message_template_status_update` (plantilla aprobada)

Si es un rechazo, `event` vale `"REJECTED"`, `reason` lleva un valor como `"INVALID_FORMAT"` y puede
llegar `rejection_info.{reason, recommendation}`.

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "100000000000001",
      "time": 1790420500,
      "changes": [
        {
          "value": {
            "event": "APPROVED",
            "message_template_id": 300000000000003,
            "message_template_name": "recordatorio_cita",
            "message_template_language": "es_ES",
            "reason": "NONE",
            "message_template_category": "UTILITY"
          },
          "field": "message_template_status_update"
        }
      ]
    }
  ]
}
```

### 16.11 Respuesta a botones interactivos (`button_reply`)

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "100000000000001",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "15550001111", "phone_number_id": "200000000000002" },
            "contacts": [
              { "profile": { "name": "Ana Pruebas" }, "wa_id": "15550002222", "user_id": "US.10000000000000000001" }
            ],
            "messages": [
              {
                "context": { "from": "15550001111", "id": "wamid.TEST_OUT_0003" },
                "from": "15550002222",
                "from_user_id": "US.10000000000000000001",
                "id": "wamid.TEST_IN_BUTTON_0001",
                "timestamp": "1790417200",
                "type": "interactive",
                "interactive": {
                  "type": "button_reply",
                  "button_reply": { "id": "slot-2026-09-27T16:00", "title": "Sáb 16:00" }
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### 16.12 Reacción (y reacción retirada)

Reacción:

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "100000000000001",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "15550001111", "phone_number_id": "200000000000002" },
            "contacts": [
              { "profile": { "name": "Ana Pruebas" }, "wa_id": "15550002222", "user_id": "US.10000000000000000001" }
            ],
            "messages": [
              {
                "from": "15550002222",
                "from_user_id": "US.10000000000000000001",
                "id": "wamid.TEST_IN_REACTION_0001",
                "timestamp": "1790417300",
                "type": "reaction",
                "reaction": { "message_id": "wamid.TEST_OUT_0001", "emoji": "👍" }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

Reacción retirada: la misma estructura, con otro wamid y **sin `emoji`**.

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "100000000000001",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "15550001111", "phone_number_id": "200000000000002" },
            "contacts": [
              { "profile": { "name": "Ana Pruebas" }, "wa_id": "15550002222", "user_id": "US.10000000000000000001" }
            ],
            "messages": [
              {
                "from": "15550002222",
                "from_user_id": "US.10000000000000000001",
                "id": "wamid.TEST_IN_REACTION_0002",
                "timestamp": "1790417360",
                "type": "reaction",
                "reaction": { "message_id": "wamid.TEST_OUT_0001" }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### 16.13 Ubicación

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "100000000000001",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "15550001111", "phone_number_id": "200000000000002" },
            "contacts": [
              { "profile": { "name": "Ana Pruebas" }, "wa_id": "15550002222", "user_id": "US.10000000000000000001" }
            ],
            "messages": [
              {
                "from": "15550002222",
                "from_user_id": "US.10000000000000000001",
                "id": "wamid.TEST_IN_LOCATION_0001",
                "timestamp": "1790417400",
                "location": {
                  "address": "Calle de Prueba 1, 28000 Madrid",
                  "latitude": 40.4168,
                  "longitude": -3.7038,
                  "name": "Peluquería Demo",
                  "url": "https://example.com/"
                },
                "type": "location"
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### 16.14 Tipo no admitido

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "100000000000001",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "15550001111", "phone_number_id": "200000000000002" },
            "contacts": [
              { "profile": { "name": "Ana Pruebas" }, "wa_id": "15550002222", "user_id": "US.10000000000000000001" }
            ],
            "messages": [
              {
                "from": "15550002222",
                "from_user_id": "US.10000000000000000001",
                "id": "wamid.TEST_IN_UNSUPPORTED_0001",
                "timestamp": "1790417500",
                "errors": [
                  {
                    "code": 131051,
                    "title": "Message type unknown",
                    "message": "Message type unknown",
                    "error_data": { "details": "Message type is currently not supported." }
                  }
                ],
                "type": "unsupported",
                "unsupported": { "type": "poll_creation" }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### 16.15 Extra: cambio de BSUID sin teléfono (`user_changed_user_id`)

El test comprueba que la identidad con `previous_user_id` pasa al BSUID nuevo, sin crear un contacto nuevo.

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "100000000000001",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "15550001111", "phone_number_id": "200000000000002" },
            "messages": [
              {
                "id": "wamid.TEST_IN_SYSTEM_0001",
                "timestamp": "1790418000",
                "type": "system",
                "system": {
                  "body": "User changed from ES.20000000000000000002 to ES.20000000000000000003",
                  "user_id": "ES.20000000000000000003",
                  "previous_user_id": "ES.20000000000000000002",
                  "type": "user_changed_user_id"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

## 17. No verificado o pendiente

- Si una reacción del usuario abre o renueva la ventana de 24 h. Por prudencia, no cuenta.
- Cómo quitar una reacción enviada por el negocio. La página actual no lo documenta.
- El `title` exacto de `131047` («Re-engagement message»). Solo está verificado el `details`. Los tests deben
  depender del `code`.
- Si `message_template_language` llega con guion (`en-US`, como en el ejemplo oficial) o con guion bajo
  (`en_US`).
- Qué representa exactamente `sha256` en los medios recibidos.
- Si repetir la llamada de «escribiendo…» renueva los 25 s.
- Que un estado pueda llegar antes de que termine la petición de envío. Es una precaución de diseño, sin
  fuente de Meta.
- El orden de los webhooks: Meta no lo garantiza explícitamente. Se deduce de los reintentos y los lotes y
  se observa en integraciones como Chatwoot.
- `context` en respuestas citadas a mensajes de texto normales: documentado antes, no en las páginas
  actuales.

## Fuentes

Fuentes oficiales de Meta, consultadas el 2026-09-26. Entre paréntesis, la fecha de «última actualización»
de cada página.

- Webhooks, visión general: campos, 3 MB, 7 días, duplicados, mTLS, modo Live (2026-06-26).
  https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview/
- Crear el endpoint: GET de verificación, `X-Hub-Signature-256`, lotes de 1.000, reintentos (2026-06-17).
  https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint/
- Referencia del webhook `messages` y dónde aparecen los errores (2026-06-17).
  https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/
- Referencia de estados: `played`, `conversation` omitido en v24+, `pricing` (2026-09-14).
  https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status/
- Referencias por tipo de mensaje entrante. La ruta es
  `https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/<tipo>/`:
  - `text` (2026-05-21), `audio` (2026-06-17), `image` (2026-06-17), `document` (2026-06-17) y `video`
    (2026-06-17);
  - `sticker` (2026-05-21), `location` (2026-05-21), `contacts` (2026-06-17), `interactive` (2026-08-03) y
    `button` (2026-06-17);
  - `reaction` (2026-05-21), `order` (2026-05-21), `system` (2026-08-11), `unsupported` (2026-06-26) y
    `errors` (2026-06-17).
- Respuesta de WhatsApp Flows, `nfm_reply` (2026-06-16).
  https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/receiveflowresponse/
- Business-scoped user IDs: formato, fechas, campos, envío con `recipient`, `131062`, mensajes `system`
  (2026-09-15). https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/
- Webhooks de cuenta. La ruta es
  `https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/<campo>/`:
  - `account_update` (2026-05-21), `message_template_status_update` (2026-05-21),
    `phone_number_quality_update` (2026-05-21) y `phone_number_name_update` (2026-06-17);
  - `business_capability_update` (2026-05-21), `account_alerts` (2026-05-21) y `security` (2026-06-17).
- Medios: validez de IDs y URLs, descarga, tipos y tamaños, 100 MB, `131052` (2026-06-16).
  https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media/
- Referencia de la Media API: `file_size` como cadena.
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/media/media-api/
- Mensajes de servicio: ventana de 24 h, formato del teléfono, caché de 10 min, orden, TTL (2026-05-21).
  https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages/
- Guías de envío. La ruta es
  `https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/<guía>/`:
  - `text-messages` (2026-07-02), `image-messages` (2026-06-24), `audio-messages` (2026-07-02),
    `document-messages` (2026-05-21) y `video-messages` (2026-05-21);
  - `reaction-messages` (2026-05-21), `contextual-replies` (2026-07-02),
    `interactive-reply-buttons-messages` (2026-05-21) e `interactive-list-messages` (2026-07-02);
  - `mark-message-as-read` (2026-07-02).
- Indicador «escribiendo…», 25 s (2026-06-17).
  https://developers.facebook.com/documentation/business-messaging/whatsapp/typing-indicators/
- Fundamentos de plantillas: parámetros con nombre y posicionales (2026-05-21).
  https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview/
- Plantillas de utilidad: envío con cabecera de medios (2026-06-17).
  https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/utility-templates/utility-templates/
- Dosificación de plantillas, `message_status` (2026-05-21).
  https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-pacing/
- Referencia de la Messages API (esquema de v25.0): `message_status` (`accepted`,
  `held_for_quality_assessment`, `paused`) y `to` obligatorio.
  https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api/
- Rendimiento: 80 y 1.000 mps, `130429`, latencia del webhook (2026-06-17).
  https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput/
- Sobre la plataforma: límites de la API y límite por par, `131056` (2026-08-04).
  https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform/
- Códigos de error (2026-06-18).
  https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes/
- Precios: cambios del 1-10-2026, tramo gratuito de 1.000 y valores de `pricing` (2026-09-10).
  https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/
- Nuevo modelo de cuentas (2026-09-22).
  https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/
- Gestión de Messaging accounts (2026-08-29).
  https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/messaging/
- Changelog de WhatsApp: `played`, `url` en medios, `conversation` en v24, 7 días para los IDs, retirada de
  `request_welcome` y `user_id_update` (2026-09-25).
  https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog/
- Graph API, webhooks genéricos (36 h frente a los 7 días de WhatsApp; CN del mTLS).
  https://developers.facebook.com/docs/graph-api/webhooks/getting-started/
- Changelog de Graph API: v26.0 del 29-07-2026. https://developers.facebook.com/docs/graph-api/changelog/
- Fuente secundaria, indicio del desorden de estados: *issue* #14529 de Chatwoot, «WhatsApp message status
  downgraded (delivered -> sent) due to webhook race condition». Solo se vio su título en los resultados de
  búsqueda. https://github.com/chatwoot/chatwoot/issues/14529
