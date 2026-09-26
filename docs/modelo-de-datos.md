# Modelo de datos

Qué tablas guarda la app, qué hay en cada una, qué valores admiten sus estados, qué no se puede repetir y a
qué reglas de `docs/spec.md` sirven. Sale del §4 del encargo original («orientativo») y de las reglas de la
especificación del 2026-09-26. Los nombres exactos de columnas los fija el esquema de Drizzle
(`src/db/schema/`) en la fase que crea cada tabla; si el esquema y este documento se contradicen, se avisa
antes de cambiar ninguno de los dos. Aquí no se copia el esquema: se explica qué guarda y por qué.

## Reglas comunes

Vienen de la decisión 0003 y valen para todas las tablas:

- **Ids:** UUID v4 en texto, también en las tablas de Better Auth.
- **Fechas:** en UTC, como entero en milisegundos. Las horas locales (horarios, tramos) se guardan como hora
  del día sin fecha y se interpretan en la zona horaria del negocio.
- **JSON** en columnas de texto con su tipo; **booleanos** en enteros.
- **Borrados explícitos:** los hijos se borran en la misma transacción, antes que el padre, sin depender de
  `ON DELETE CASCADE`. El libSQL local sí aplica las claves ajenas en cada conexión (comprobado en la fase 0 con
  `@libsql/client` 0.18.0), así que un borrado en mal orden falla; en Turso no se da por hecho.
- **Secretos aparte:** lo secreto va en columnas cifradas (`secrets_enc` o un campo `*_enc`) con AES-256-GCM y
  `APP_ENCRYPTION_KEY`, nunca en `config` ni en otra columna en claro (ver «Qué se cifra»).
- **Autoría que sobrevive:** mensajes, notas y citas guardan el id de quien los escribió y una copia de su
  nombre en ese momento, porque un usuario borrado desaparece de las tablas de Better Auth y su nombre tiene
  que seguir viéndose ([USU-15]).
- **Marcas de prueba:** `is_demo` (canales y usuarios de la demo), `is_test` (conversaciones y citas de
  «Probar agente») y `simulated` (mensajes del simulador). Sirven para borrarlos juntos, para no mandarlos
  nunca fuera y para que no cuenten en los informes ([ARR-11], [ARR-20], [AJU-13], [PRU-04], [PRU-05],
  [INF-08]).

## Usuarios y negocio

| Tabla | Qué guarda y campos clave | Reglas |
|---|---|---|
| Tablas de Better Auth (`user`, `session`, `account`, `verification`, `two_factor`) | Cuentas, sesiones, huella de la contraseña, enlaces de recuperación y el segundo paso (TOTP y códigos de recuperación). Las gestiona Better Auth con su adaptador de Drizzle (0004). | [USU-01]–[USU-13] |
| `user_roles` | Una fila por usuario: rol `owner`, `admin`, `supervisor`, `agent` o `viewer`; si está desactivado (y desde cuándo); `is_demo`; sus preferencias de avisos (por suceso: en la app, push, email). Único por usuario. Siempre hay exactamente un `owner`: el traspaso cambia las dos filas en una transacción. | [PER-01]–[PER-06], [USU-14], [USU-16], [USU-18], [ARR-20] |
| `channel_members` | Canales de cada usuario con rol Agente. Único el par usuario + canal. Sin filas, el agente ve todos los canales. | [PER-02], [USU-17] |
| `invitations` | Email, rol, canales (si es Agente), huella del enlace (no el enlace en claro), quién invita, caducidad (7 días) y cuándo se usó o se revocó. Una sola pendiente por email. | [USU-05]–[USU-09] |
| `business_settings` | Una sola fila: nombre, datos de contacto, dirección, sector, zona horaria (`Europe/Madrid`), logo (clave del archivo), color principal (`#3d6df2`), terminología y modo de la agenda con su intervalo de huecos, textos legales, aviso de IA por defecto, plazos de conservación, horas de pausa de la IA (12), exigir 2FA, sucesos que avisan y a quién por defecto, paso actual del asistente y `setup_completed_at`. | [AJU-01], [AJU-03], [AJU-07], [AJU-08], [ASI-10], [ASI-11], [AGD-01], [AGD-06], [AGD-08], [BAN-11], [CUM-05], [USU-12] |
| `integration_settings` | Una sola fila: claves de OpenRouter y Mistral OCR (cifradas); ZDR; modelos por defecto (chat, respaldo, transcripción, embeddings, descripción de imágenes y reordenación, con su interruptor); lista de modelos recomendados; correo del sistema SMTP (la contraseña, cifrada); verify token de WhatsApp de la instalación y hora de la última verificación correcta de Meta; claves VAPID (la privada, cifrada). | [AJU-04], [AJU-06], [MOD-01], [WA-12], [WA-13], [PWA-03] |
| `pricing_rates` | Tarifas por mensaje: tipo de canal (hoy `whatsapp`), mercado (país), categoría de precio, importe, moneda (USD) y si es de ejemplo. Único por canal + mercado + categoría. No está en el §4 del encargo: la pide [AJU-09]. | [AJU-09], [WA-47] |
| `business_hours` | Tramos del horario semanal (día y horas de inicio y fin locales; varios por día). | [AJU-03], [ASI-06], [CAN-08] |
| `closures` | Festivos y cierres, por fecha o rango. | [AJU-03], [AGD-05] |

El verify token de WhatsApp se guarda cifrado (`whatsapp_verify_token_enc`), como el resto de secretos, aunque no
da acceso a nada: el asistente lo descifra en el servidor y lo muestra entero, solo a quien puede gestionar
canales, para copiarlo en Meta ([WA-13]).

## Canales

`channels` guarda cada canal:

- `type`: `whatsapp`, `email_gmail`, `email_outlook`, `email_imap`, `webchat` o `telegram`; `name` e `is_demo`.
- `status`: `draft`, `connecting`, `connected`, `error` o `disabled` ([CAN-01], [CAN-15], [CAN-16]).
  «Requiere reconexión» del correo ([COR-22]) es `error` con ese motivo en `last_health`, no un estado más.
- `config` (sin secretos) y `secrets_enc` ([CAN-17]).
- `active_agent_id` (puede estar vacío: entonces solo atienden personas) y `ai_enabled` ([CAN-03]–[CAN-05]).
- `test_mode` y `test_allowlist` ([CAN-06], [WA-25]); `reply_mode` `auto` o `draft` ([CAN-07]);
  `disclosure_message` ([CUM-01]); `off_hours_behavior`: responder igual o no responder ([CAN-08]).
- `last_health` (semáforos, error en español y fecha de la última revisión) y `last_inbound_at` ([CAN-01],
  [WA-26], [WA-29]).

Lo propio de cada tipo:

- **WhatsApp.** Identidad: `connection_mode` (`manual`; `embedded_signup` solo queda preparado),
  `phone_number_id`, `waba_id`, `meta_app_id`, `meta_business_id`. Estado del número: `display_phone_number`,
  `verified_name`, `quality_rating`, `name_status`, `code_verification_status`, `messaging_limit`. Conexión:
  `graph_api_version` (por defecto `v26.0`) y `webhook_status` (suscripción de la app a la cuenta comprobada o
  no). También los intentos de registro con su hora ([WA-18]), la fecha de aprobación de un cambio de nombre
  ([WA-20]) y si la persona confirmó el método de pago ([WA-21]). Secretos: `access_token`, `app_secret` y
  `two_step_pin`. `phone_number_id` y `waba_id` van en columnas con índice, porque el aviso de Meta busca el
  canal por ellos ([WA-33]); `phone_number_id` no se repite entre canales ([WA-11]).
- **Correo.** En `config`, lo de `docs/integracion-correo.md` §6 (dirección, punto de sincronización de cada
  proveedor, carpetas, permisos concedidos), la fecha de caducidad del secreto de cliente de Outlook
  ([COR-07]), los topes diarios ([COR-17]) y la firma ([COR-21]). Secretos: secreto de cliente, tokens de
  acceso y contraseñas IMAP/SMTP.
- **Chat web.** Color, logo, bienvenida, posición, textos legales, dominios permitidos y si admite voz e
  imágenes ([WEB-02], [WEB-07], [WEB-10]).
- **Telegram** (después de la v1). Secretos: token del bot y secreto de los avisos ([TG-01], [TG-02]).

`whatsapp_templates` guarda las plantillas sincronizadas de cada número: nombre, idioma, categoría, estado,
variables y el id de Meta. Único por canal + nombre + idioma. Sirve a [WA-22], [WA-43] y a los recordatorios
([AGD-24]).

## Agentes y conocimiento

| Tabla | Qué guarda y campos clave | Reglas |
|---|---|---|
| `agents` | Nombre, descripción, avatar, idioma, tono, instrucciones guiadas (rol, negocio, qué puede y qué no, estilo, cuándo pasar a una persona y «Otras instrucciones»), número de la versión actual, modelo y respaldo, temperatura, razonamiento, longitud máxima, modo de conocimiento (`auto` o `always`), configuración de traspaso (palabras clave, número de «no lo sé», temas sensibles, mensajes dentro y fuera de horario, a quién avisar) y herramientas del sistema activas. | [AGE-03]–[AGE-09], [MOD-05], [MOD-07] |
| `agent_versions` | Copia completa del agente en cada guardado, con número de versión, autor y fecha. Único agente + número. Recuperar una crea otra nueva. | [AGE-12] |
| `agent_context_files` | Archivos de contexto del nivel 1: título, Markdown editable, tamaño en tokens y archivo de origen. | [CON-01], [CON-02] |
| `custom_tools` | Herramientas HTTP: nombre (único), descripción, parámetros, método, URL, tiempo máximo y cabeceras secretas cifradas. | [HER-11]–[HER-14] |
| `agent_custom_tools` | Qué herramientas HTTP usa cada agente. Único agente + herramienta. | [AGE-08] |
| `knowledge_bases` | Nombre, descripción, modelo y dimensiones de los embeddings (1536) y versión del índice en uso y en construcción. | [CON-03], [CON-11], [CON-13], [AJU-05] |
| `agent_knowledge_bases` | Qué bases usa cada agente. Único agente + base. | [CON-03] |
| `kb_documents` | Documento de una base: tipo (archivo, página web o pregunta frecuente), título, origen (archivo, URL o sitemap), estado `queued`, `extracting`, `chunking`, `embedding`, `ready` o `error` con su motivo, huella del contenido (no se repite dentro de la base), páginas, resumen, fecha de lectura y refresco de las URL. | [CON-04]–[CON-09], [CON-14], [CON-15], [CON-22] |
| `kb_chunks` | Fragmentos: documento, base, versión del índice, título, sección, página, texto, tokens y embedding (`F32_BLOB(1536)`, vacío hasta que hay clave). Su tabla FTS5 y su índice vectorial están en `docs/busqueda-hibrida.md`. | [CON-10]–[CON-13], [CON-16]–[CON-19] |
| `message_retrievals` | Fragmentos usados en cada respuesta, con su posición y puntuación. | [CON-20], [PRU-02] |

## Contactos

- `contacts`: nombre, teléfono y email (solo como datos, nunca para identificar), etiquetas, campos
  personalizados y notas. Al fusionar, las identidades, conversaciones, citas y consentimientos pasan al que
  queda ([CTO-01]–[CTO-05]).
- `contact_identities`: `contact_id`, `channel_type`, `external_id` y `phone` opcional. **Única por
  `channel_type` + `external_id`** ([CTO-03], [CAN-13]). `external_id` es el BSUID en WhatsApp (o el `wa_id`
  como identificador provisional si un aviso antiguo no trae BSUID), el email en correo, el id del visitante en
  el chat web y el id de Telegram. El teléfono va en `phone` porque puede faltar y porque `wa_id` y el teléfono
  real no siempre coinciden (`docs/integracion-whatsapp-mensajes.md` §6). Un cambio de identidad de WhatsApp
  actualiza esta fila en el mismo contacto ([WA-39], [WA-40], [WA-50]). El BSUID es distinto en cada
  portfolio de Meta: el mismo cliente en números de portfolios distintos son dos identidades, y la app solo
  lo señala como posible duplicado ([CTO-04]).
- `consents`: contacto, canal, tipo (aceptación de los textos legales, baja o alta), origen y quién y cuándo.
  Mientras una baja sigue vigente, en ese canal no contestan la IA ni salen recordatorios ni plantillas
  ([CUM-03], [CUM-13], [CTO-08]).

## Conversaciones y mensajes

`conversations`:

- `channel_id`, `contact_id` y `external_thread_id` (el hilo del correo). Una por canal + contacto en
  WhatsApp, chat web y Telegram (se reabre), y una por canal + hilo en correo ([CAN-12]); se comprueba al crear,
  dentro de la transacción.
- `status`: `open`, `pending_human` o `resolved` ([BAN-12], [TRA-02], [TRA-08]).
- `ai_mode`: `ai` o `human`; `ai_paused_until` y `pause_reason` ([BAN-10], [BAN-11], [COR-20]).
- `assigned_user_id` y `agent_override_id` ([TRA-04], [AGE-14]).
- `last_inbound_at` (abre la ventana de 24 h de WhatsApp, con la hora del mensaje y no la de llegada),
  `last_outbound_at`, `unread_count`, `labels` y `summary` ([WA-43], [BAN-03], [MOT-13]).
- `is_test` para «Probar agente», que no tiene canal real ([PRU-05]).

`messages`:

- `direction` (entrante o saliente), `sender_type` `contact`, `ai`, `human` o `system`, `sender_user_id` con
  la copia del nombre, y `agent_id`: qué agente respondió ([CAN-05], [BAN-05]).
- `external_id`, **único junto con `channel_id`**: un mensaje repetido por el canal no se guarda dos veces
  ([CAN-11], [WA-35]).
- `content_type`, `text`, `media` (clave del archivo, tipo, tamaño y nombre) y `transcript` ([WA-36],
  [MED-04]).
- `status`: `received`, `queued`, `sent`, `delivered`, `read`, `played`, `failed` o `draft`, y `error`.
  Los estados de salida solo avanzan (`queued` < `sent` < `delivered` < `read` < `played`) y `failed` solo
  sustituye a `queued` o `sent` ([WA-38]). `played` no está en el §4 del encargo: Meta lo envía desde el
  17-03-2026 para las notas de voz. `draft` es la respuesta que espera aprobación ([CAN-07], [MOT-14]).
- `pricing_category`, `pricing_type` y `cost_estimate` ([WA-38], [WA-47]). `pricing_type` no está en el §4
  del encargo: sin él no se sabe si Meta cobró el mensaje.
- `metadata`: lo propio de cada canal (cabeceras del correo, mensaje citado, marca `simulated`…). Las
  reacciones se guardan en el mensaje al que reaccionan, no como mensaje nuevo ([WA-37]).

| Tabla | Qué guarda y campos clave | Reglas |
|---|---|---|
| `internal_notes` | Notas del equipo en una conversación, con autor. Nunca se envían. | [BAN-07] |
| `handoff_events` | Cada traspaso: conversación, quién lo lanza (herramienta, regla o persona), motivo, resumen, urgencia, a quién se asigna, hora de la petición y hora y mensaje de la primera respuesta humana. De aquí salen los informes de traspasos y del tiempo de respuesta. | [TRA-01], [TRA-06], [TRA-07], [INF-04], [INF-05], [CUM-11] |
| `webhook_events` | Avisos en bruto de los canales: origen, canal, cuerpo, si la firma era correcta, cuándo se procesó y error. Para un número de WhatsApp que no es de ningún canal, solo la hora y el número. Se borran a los 14 días por defecto. | [CAN-09], [WA-34], [WA-35], [CUM-05], [AJU-11] |
| `ai_runs` | Cada uso de la IA (chat, transcripción, embeddings, reordenación, descripción de imágenes): modelo pedido y usado, proveedor, tokens (de entrada, de salida, de razonamiento y leídos de la caché), coste de `usage.cost`, tiempo, herramientas usadas, error y si fue de «Probar agente». | [MOT-11], [MED-01], [INF-07], [PRU-02] |

## Operación

| Tabla | Qué guarda y campos clave | Reglas |
|---|---|---|
| `notifications` | Avisos de la app por usuario: suceso, enlace, si está leído. | [PWA-06], [TRA-05], [AJU-08] |
| `push_subscriptions` | Suscripciones push de cada dispositivo: usuario, `endpoint` (único) y sus claves. Se borran cuando el servicio de push dice que caducaron. | [PWA-03], [PWA-05] |
| `jobs` | Cola: tipo, datos, `run_at`, `attempts`, `locked_until`, `status`, `last_error` y una clave para no duplicar (una respuesta pendiente por conversación). | [MOT-01], [MOT-02], [MOT-15], [MOT-16] (0008) |
| `audit_log` | Registro de actividad: quién (persona, IA o sistema), qué, sobre qué y cuándo, sin datos personales. Solo se añade: nadie lo edita ni lo borra a mano. | [AJU-10], [SEG-10], [HER-03], [CUM-06] |
| `realtime_events` | Cambios para las pantallas, con un cursor que crece. Se borran pronto. No está en el §4: la pide el sondeo (0009). | [BAN-03], [WEB-06] |
| `rate_limits` | Contadores de límites de peticiones por clave (IP, visitante, email) y ventana. Better Auth usa además su propia tabla para el inicio de sesión. | [SEG-07], [USU-13], [WEB-08] |
| `app_kv` | Almacén pequeño de clave y valor: el catálogo de modelos de OpenRouter ya normalizado (`ai.model_catalog`, se renueva a las 12 h), el agente que creó el asistente y sus preguntas frecuentes (`setup.first_agent`), la última ronda del trabajo en segundo plano y otros cursores. | [MOD-01], [MOD-06], [ASI-11], [AJU-11] |

## Agenda

| Tabla | Qué guarda y campos clave | Reglas |
|---|---|---|
| `services` | Nombre, categoría, duración, márgenes antes y después, precio orientativo, descripción para el agente, personas mínimas y máximas, antelación mínima y máxima, «requiere confirmación manual» y activo. | [AGD-04], [AGD-07], [AGD-22] |
| `resources` | Tipo (persona, sala o box, mesa o zona, equipo), nombre, color (uno de los 8 de `DESIGN.md`), capacidad y activo. | [AGD-02], [AGD-03], [AGD-06] |
| `resource_schedules` | Tramos semanales de cada recurso, varios por día. | [AGD-02] |
| `resource_time_off` | Ausencias de un recurso y huecos bloqueados, con inicio, fin y motivo. | [AGD-02], [AGD-09], [AGD-18] |
| `service_resources` | Qué recursos hacen cada servicio. Único servicio + recurso. | [AGD-04], [AGD-12] |
| `bookings` | Contacto, servicio, recurso, inicio y fin, franja ocupada (inicio − margen, fin + margen), personas, estado `pending`, `confirmed`, `cancelled`, `completed` o `no_show`, origen `ai` (con su canal), `human` o `web`, conversación, notas, autor con la copia del nombre, `is_test` y cuándo se envió el recordatorio. | [AGD-13], [AGD-14], [AGD-17], [AGD-19], [AGD-25], [PRU-04] |
| `booking_events` | Historial de cada cita: quién (persona, IA, cliente o sistema), qué cambió y cuándo. | [AGD-15] |
| `reminder_settings` | Recordatorio: activado (no, por defecto), antelación, canal (plantilla de WhatsApp con sus variables asignadas, o email) y texto. | [AGD-20], [AGD-24], [AGD-25] |

Solo ocupan hueco las citas `pending` y `confirmed`: las canceladas y los no presentados lo liberan
([AGD-09]). Al borrar un contacto, sus citas se anonimizan en vez de borrarse, para que los informes cuadren
([CTO-07]).

### Sin dobles reservas

- **Ahora (libSQL):** la cita se crea en una transacción corta que vuelve a comprobar que el hueco sigue libre
  (con los márgenes y, en aforo, la suma de personas) antes de guardar. SQLite admite un solo escritor a la
  vez, así que dos reservas simultáneas del último hueco no pueden entrar las dos; la segunda recibe «Ese hueco
  ya no está libre» con alternativas ([AGD-13], [HER-06]). En Turso, una transacción interactiva bloquea las
  escrituras hasta 5 s: dentro no se llama a ningún servicio externo (0003).
- **Futuro (Postgres), capacidad 1:** una restricción de exclusión con la extensión `btree_gist` sobre el
  recurso (igual) y el rango de la franja ocupada (solapa), limitada a las citas `pending` y `confirmed`.
  `btree_gist` hace falta para comparar con `=` el id del recurso en un índice GiST, y admite `uuid` y `text`.
  El rango sin tercer argumento es cerrado al inicio y abierto al final, así que una cita que acaba a las
  10:00 no choca con otra que empieza a las 10:00. La franja incluye los márgenes del servicio porque también
  ocupan el recurso: por eso se guardan aparte del inicio y el fin visibles (propuesta de diseño). En Supabase
  las extensiones se crean en el esquema `extensions`.
- **Futuro (Postgres), aforo:** la restricción no sirve; se bloquea la fila del recurso y se suman las plazas
  dentro de la transacción.

## Qué se cifra

Con AES-256-GCM y `APP_ENCRYPTION_KEY` ([SEG-01], `docs/security.md`):

- `channels.secrets_enc`: tokens de Meta, App Secret y PIN; secretos de cliente y tokens de Google y
  Microsoft; contraseñas IMAP y SMTP; token y secreto de Telegram.
- `integration_settings`: claves de OpenRouter y Mistral OCR, contraseña SMTP del sistema y clave privada VAPID.
- `custom_tools`: cabeceras secretas.

Además, sin cifrado reversible: las contraseñas del equipo solo como huella (Better Auth) y los enlaces de
invitación solo como huella. Si la clave de cifrado se pierde, lo cifrado queda ilegible y los canales piden
reconexión ([SEG-03]).

## Conservación

La limpieza diaria ([CUM-05], [CUM-06]) actúa sobre `conversations` y `messages` (12 meses por defecto), los
archivos de audio ya transcritos (30 días), los adjuntos (90 días) y `webhook_events` (14 días, entre 7 y 30);
`realtime_events` y los trabajos terminados de `jobs` se borran antes, porque no tienen valor pasado un rato.

## Fuentes

- Encargo original, §4 «Datos (orientativo)» y §9 «Sin dobles reservas» (2026-09-26).
- Estados, `pricing` e identidad de WhatsApp: `docs/integracion-whatsapp-mensajes.md` §6 y §8.
- Restricción de exclusión, `btree_gist` y rangos (consultado el 2026-09-26):
  https://www.postgresql.org/docs/current/btree-gist.html, https://www.postgresql.org/docs/current/rangetypes.html
  y https://www.postgresql.org/docs/current/sql-createtable.html
- Extensiones en Supabase (esquema `extensions`): https://supabase.com/docs/guides/database/extensions
