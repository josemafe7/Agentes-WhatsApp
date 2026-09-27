# Arquitectura

> Describe cómo está pensado el sistema según las decisiones de `docs/decisions/` (0001 a 0024) y qué hay ya
> construido. Las fases 0 (base), 1 (agentes y OpenRouter), 2 (bandeja, chat web y motor), 3 (WhatsApp), 4
> (conocimiento), 5 (agenda), 6 (correo) y 7 (cumplimiento y producción) están construidas: «Lo que ya está
> construido» dice dónde vive cada pieza. La fase 8 (Supabase, decisión 0024) cambia la base de datos, los archivos y
> el cron, y este documento ya lo describe así. Lo que queda para después (Telegram, Dokploy…) está en «Fases» de
> `docs/spec.md` y se corrige aquí cuando se construya.

## Visión general

DominIA Agentes es una sola aplicación de Next.js que se instala una vez por negocio, con su propia base de
datos y sus propias credenciales (0001). Todo corre en Node (0002): las pantallas del equipo, la API a la que llaman
los canales, el chat web que el negocio pone en su web y el trabajo en segundo plano.

Las pantallas y las rutas son finas: validan lo que llega y piden el trabajo a dos capas de servidor. El acceso
a datos comprueba siempre quién pide qué (0004) y los servicios hacen el resto: canales, motor de respuesta,
conocimiento, agenda, avisos y cumplimiento. Lo que depende del motor de base de datos o del sitio donde se
publica va detrás de interfaces con adaptadores (búsqueda vectorial, búsqueda de texto, cola, tiempo real,
archivos y límites de peticiones), para que el mismo código sirva en local, en Vercel y en un VPS. La base es Postgres
en todas partes: la integrada (PGlite, dentro del propio proceso) en local y en las pruebas, sin cuentas, y Supabase
solo en la app publicada, con sus archivos en Supabase Storage y el cron de cada minuto en Supabase Cron (0024).

Nada lento ocurre mientras se atiende una petición: los avisos de los canales se guardan, se contesta enseguida
y la IA trabaja después, en una cola que avanza a trozos cortos (0008). La pantalla se entera de los cambios
preguntando cada pocos segundos (0009). Los servicios externos (OpenRouter, Meta, Google, Microsoft, servidores
de correo) se llaman con clientes propios cuya dirección base sale de una variable de entorno, para que las
pruebas usen un simulador y nunca los servicios reales.

## Lo que ya está construido (fases 0 a 7)

| Pieza | Dónde | Notas |
|---|---|---|
| Pantallas y rutas | `src/app/` | `(auth)/`: entrar, `/dos-pasos`, `/recuperar`, `/restablecer` e `/invitacion/[token]`. `(app)/`: el panel (`agentes/` desde la fase 1, con `agentes/herramientas/` en la fase 7; `bandeja/`, `contactos/` y `canales/` desde la fase 2, con `contactos/duplicados` y `contactos/fusionar` en la fase 7; `conocimiento/` desde la fase 4; `agenda/` (con `agenda/configuracion/`) y `ajustes/recordatorios` desde la fase 5; `canales/nuevo/correo` y los paneles de correo en la fase 6; `informes/` en la fase 7; `ajustes/*` completo con el simulador, `/perfil`, «Mi cuenta», y `/ayuda`, las guías de `docs/guia-*.md` y la lista de puesta en marcha, que `next.config.ts` añade a la compilación con `outputFileTracingIncludes`). `setup/`: el asistente. `legal/`: las tres páginas públicas. `widget-demo/`: la web de ejemplo con el chat. `manifest.ts`: el manifiesto de la app instalable. `api/`: `auth/[...all]`, `cron/tick`, `health`, `files/[...key]`, `realtime`, `widget/[channelId]/*`, `webhooks/whatsapp` (fase 3), `knowledge/bases/[id]/files` (fase 4, subida de archivos al conocimiento), `oauth/google/callback` y `oauth/microsoft/callback` (fase 6) y `push/*` (fase 7: clave pública, suscripciones e icono). |
| Proxy | `src/proxy.ts` | Sin cookie de sesión, una página privada redirige a `/login?next=…`. Pasa la ruta pedida en la cabecera `x-dominia-path` (siempre la sobrescribe) para el layout del panel, y pone la Content Security Policy de cada página con un nonce nuevo (`x-nonce`, que lee el layout raíz para el script del tema). No es la frontera de seguridad. |
| Arranque del servidor | `src/instrumentation.ts`, `src/server/startup-checks.ts`, `src/instrumentation-client.ts` | Las comprobaciones de arranque, las mismas que `pnpm worker`: sin una `APP_ENCRYPTION_KEY` válida, o con una configuración insegura de la versión compilada (`APP_URL` sin https salvo `localhost`, direcciones de servicios cambiadas, `ALLOW_LOCAL_HTTP_TOOLS`), no atiende peticiones y lo dice en el registro ([SEG-03], `docs/security.md` «Configuración»). Después, en segundo plano: los embeddings pendientes, el relleno único de `search_text` de contactos y mensajes y el trabajo diario de conservación. En el navegador, `instrumentation-client.ts` deja Zod sin compilar (`jitless`) antes de crear ningún esquema, por la CSP. |
| Sesión y actor | `src/server/session.ts`, `src/server/session-2fa.ts` | `getActor()` lee la sesión de Better Auth y el rol, los canales y el estado de la verificación en dos pasos de la base en cada petición. Las páginas usan `requirePageActor()`; las acciones y rutas, `requireActor()` o `requirePermission()`. El layout del panel usa `requireTwoFactorCompliance()`: propietarios y administradores sin verificación en dos pasos, cuando el negocio la exige, solo pueden abrir `/perfil`. |
| Rutas de entrada | `src/lib/auth-paths.ts` | Rutas públicas y `sanitizeNextPath()`, la única comprobación de a dónde se vuelve tras entrar: solo rutas de la app, sin barras invertidas ni trucos con `//` ni puntos. |
| Permisos | `src/lib/permissions.ts` | `PERMISSIONS` (38 acciones), `can(actor, acción, alcance)` y `channelFilter()`, con la tabla de roles de la especificación. |
| Acceso a datos | `src/data/` | Uno por tema: `settings`, `business`, `business-hours`, `notification-settings`, `users`, `invitations`, `setup` (y `setup-agent`, el paso 5 «Primer agente», que guarda el id del agente en `app_kv` › `setup.first_agent` para el paso 6), `activity`, `diagnostics` (y `diagnostics-connections`, las pruebas de conexión de Diagnóstico, que reutilizan las de cada pantalla), `system-mail` y `audit`. Todos con `server-only`, reciben el actor y comprueban con `assertCan()` (`guard.ts`). |
| Base de datos | `src/db/` y `drizzle/` | 54 tablas en `src/db/schema/` (Drizzle con `pg-core`), todas con Row Level Security y sin políticas. Migraciones de Postgres (fase 8): `0000_extensions` (a medida: el esquema `extensions`, `vector`, `unaccent` y la configuración de texto `es_unaccent`) y `0001_initial` (generada: tablas, Row Level Security, índices, el HNSW de los embeddings y la columna generada del texto con su GIN). Sustituyen a las seis de SQLite de las fases 0 a 7, sin datos que pasar (0024): lo que añadió cada fase ya está en la inicial. `src/db/index.ts` elige la base por `DATABASE_URL` (vacía, la integrada en `data/pglite`; `postgresql://…`, Supabase por postgres.js sin sentencias preparadas; `pglite:…`, las pruebas), pone el candado de un solo proceso de la base integrada (`data/pglite.lock`) y hace que cada transacción de primer nivel tome el candado de escritura (un escritor a la vez). `db` se abre en el primer uso, nunca al importar. `src/db/migrate.ts` aplica `drizzle/` con el migrador de Drizzle. |
| Adaptadores | `src/server/adapters/` | `job-queue` (`PgJobQueue`), `realtime` (`PgRealtime`), `rate-limiter` (`PgRateLimiter`), `file-storage` (disco o Supabase Storage), `text-search` (`PgTextSearch`: `tsvector` con `es_unaccent`), `vector-search` (`PgVectorSearch`: `halfvec` con HNSW), y `database-health`/`database-info` para Diagnóstico. Con `drizzle/`, el único sitio con SQL propio de Postgres (y lo imprescindible de la conexión en `src/db/`). |
| Trabajo en segundo plano | `src/server/jobs/` | `tick()` y el registro de trabajos (`handlers/index.ts`): correos del sistema, `reply` (motor de respuesta), `conversation.summary` (resumen acumulado), `channel.demo_status`, `notifications.deliver`, los de WhatsApp (fase 3) y los del conocimiento (fase 4: `knowledge.process`, `knowledge.reindex`, `knowledge.sitemap`, `knowledge.embeddings` y `knowledge.refresh`, en `src/server/knowledge/jobs.ts`) el de los recordatorios de citas (fase 5: `booking.reminders`, cada 5 minutos mientras estén activados, en `src/server/booking/jobs.ts`), la lectura de cada buzón (fase 6: `email.poll`, cada minuto, en `src/server/channels/email/jobs.ts`) y los de la fase 7: `compliance.retention` (la limpieza diaria), `compliance.opt_out_confirmation` (la confirmación de una baja), `webchat.upload_cleanup` (archivos del chat web que nunca se enviaron) y `ai.model_catalog_refresh` (la lista de modelos cada 12 h, con los avisos de modelos que se retiran, [MOD-06]). Se lanza con `after()` + `kickTick()` desde la API del chat web, el simulador, reactivar la IA de una conversación y las acciones del conocimiento, con el cron (`/api/cron/tick`), con el lanzador de `pnpm dev` cada 15 s y con `pnpm worker`, que al arrancar también programa la lectura de cada buzón y, con `EMAIL_IMAP_IDLE=true`, escucha los IMAP con «Leer al momento». |
| Usuarios | `src/server/auth.ts`, `src/server/accounts.ts` | Better Auth (email y contraseña, sin registro público, verificación en dos pasos, límite de peticiones en base de datos). Por HTTP solo responde a `get-session`, `sign-out` y el enlace de recuperación (`httpAllowlist`); el resto va por Server Actions con `auth.api.*`. Las cuentas solo se crean en `accounts.ts`: asistente (con el código de instalación `SETUP_TOKEN` al publicar), invitaciones y demo. |
| Correo del sistema | `src/server/mailer.ts`, `src/server/email-templates.ts` | SMTP de Ajustes › Correo del sistema, con el nombre, el logo y el color del negocio en cada correo ([AJU-01]). La contraseña guardada solo se envía al mismo servidor, puerto, seguridad y usuario. Sin SMTP, en local o con la demo, cada correo se guarda como `.eml` en `data/outbox/`; publicado, da un error claro. Todos quedan anotados para Diagnóstico. |
| Cifrado | `src/server/crypto.ts`, `src/server/redact.ts` | AES-256-GCM (`v1:iv:tag:texto`), máscara `••••1234` y limpieza de secretos en registros y errores. |
| Límites de peticiones | `src/server/client-ip.ts`, `src/app/(auth)/_lib/throttle.ts` y cada acción | Las Server Actions que llaman a `auth.api.*` (entrar, dos pasos, recuperar, invitación, Mi cuenta, asistente) cuentan sus intentos con el `RateLimiter`, por IP y por email o usuario; al entrar, tras 5 fallos seguidos cada intento espera al anterior (1, 2, 4, 8 y como mucho 15 minutos). Sus rutas HTTP de Better Auth están cerradas para que nadie se salte esos límites. Better Auth limita las pocas que siguen abiertas. La IP sale de `X-Forwarded-For` según `TRUSTED_PROXY_HOPS`. |
| Demo y órdenes | `scripts/`, `seed/`, `src/lib/sectors/`, `src/server/demo/` | Preparación (`scripts/lib/setup.ts`), demo por sector (pasos en `seed/steps/`: negocio, usuarios, horario, agenda, agentes —recepción desde la plantilla del sector, correo y uno fuera de horario preparado sin activar—, canales —un chat web real y un WhatsApp y un correo «Demo», cada uno con su agente activo— y siete conversaciones con fechas relativas: reserva, nota de voz con transcripción, traspaso urgente pendiente, traspaso resuelto con nota, imagen con su descripción, preguntas frecuentes e hilo de correo con borrador, con sus `ai_runs`, traspasos y avisos—, citas —la agenda de la demo de dos semanas atrás a dos semanas adelante, colocada con el motor de disponibilidad (sin solapes ni aforo superado): todos los estados, citas de la IA unidas a sus conversaciones (la de la conversación «reserva», con sus herramientas en `ai_runs`), de personas y de «Probar agente», una ausencia y un bloqueo, avisos «Cita pendiente de confirmar» y el recordatorio preparado pero apagado (`seed/steps/bookings.ts`); el agente de recepción trae encendidas las herramientas de la agenda—, WhatsApp —plantillas y tarifas de ejemplo— y conocimiento —la base «Información del negocio» ya procesada, ver «Demo del conocimiento»—), `db:reset`, `db:fresh`, `seed:embeddings`, worker y el lanzador de `pnpm dev` (`scripts/dev.mjs`). Los archivos de la demo (una nota de voz WAV, una imagen PNG por sector y el PDF de ejemplo del simulador) se generan en código (`seed/media/`), sin binarios en el repositorio. Los datos de cada sector son datos puros en `src/lib/sectors/`, que también usa el asistente. |
| Cliente de OpenRouter (fase 1) | `src/lib/openrouter/` | `createOpenRouterClient()`: clave, catálogo (`/models/user` y, si falla, `/models`), proveedores de un modelo y lista sin retención de datos, chat sin streaming, embeddings, transcripción y rerank. Valida cada respuesta con Zod, trata el 200 con `error` como error y convierte cada fallo en `OpenRouterError` con su mensaje en español. Siempre `data_collection: "deny"` en chat, embeddings y rerank. |
| IA del servidor (fase 1) | `src/server/ai/` | `models.ts` (catálogo normalizado, 12 h en `app_kv`, filtros y validación del modelo y su respaldo), `prompt.ts` (prompt puro de lo estable a lo variable; el nombre del cliente va en una sola línea y el resumen acumulado citado línea a línea como datos, para que nada del cliente pase por una regla) y `context.ts` (los datos del negocio que lo alimentan), `tools/` (herramientas con Zod, registro de actividad, `transferir_a_humano`, desde la fase 4 `buscar_conocimiento` y desde la fase 5 las de la agenda: `listar_servicios`, `consultar_disponibilidad`, `crear_cita`, `ver_citas_del_cliente`, `cancelar_cita`, `reprogramar_cita` y `guardar_datos_contacto`), `run-agent.ts` (una vuelta del agente con hasta 6 pasos, registrada en `ai_runs`; en «Buscar siempre» busca antes de llamar al modelo y añade los fragmentos al final del mensaje de sistema, y devuelve los fragmentos usados), `draft.ts` («Generar borrador con IA» desde una web o una descripción, que son datos entre marcas y nunca órdenes), `usage.ts` (suma de tokens y coste de varias llamadas), `openrouter.ts` (cliente con la clave de la instalación, modelos por defecto y respaldo de otro proveedor) y `limits.ts` (límites de lo que gasta IA). |
| Lectura segura de webs (fase 1) | `src/server/web-fetch.ts` | Lee una página pública y la pasa a Markdown (Readability, linkedom y turndown). Solo direcciones públicas, comprobadas también al conectar y en cada redirección, con tiempo, tamaño y tipos máximos (`docs/security.md`). Lo usan el borrador con IA y las páginas web y mapas del sitio del conocimiento. |
| Pantallas de agentes (fase 1) | `src/app/(app)/agentes/` | Lista, «Nuevo agente» (plantilla del sector, de otro sector, en blanco o borrador con IA) y el editor con una ruta por pestaña (`[id]/`, `instrucciones`, `modelo`, `conocimiento`, `herramientas`, `traspaso`, `canales`, `probar` y `versiones`). Cada pestaña guarda solo sus campos con `updateAgent`, que crea una versión; barra «Cambios sin guardar» y aviso al salir. El layout no es la frontera de seguridad: cada página vuelve a comprobar el permiso. |
| Probar agente (fase 1) | `src/app/(app)/agentes/[id]/probar/` | El navegador guarda la conversación de prueba y la envía entera en cada mensaje (como mucho 20 mensajes); el servidor no guarda conversaciones ni mensajes, solo la fila de `ai_runs` con `is_test`. Sin clave no llama a OpenRouter ni gasta el límite de peticiones. Al navegador solo llega lo que se ve (texto, modelo, tokens, coste, tiempo, herramientas), nunca ids internos ni la clave. |
| Selector de modelos (fase 1) | `src/components/model-picker/` | `<ModelPicker kind>` para chat, transcripción, embeddings y visión, con búsqueda, recomendados, precios por millón y iconos. Pide la lista una vez por tipo y página (Server Actions con permiso y Zod) y reutiliza los filtros de `src/server/ai/models.ts`. Sin clave se desactiva y no pregunta a OpenRouter. Lo usan la pestaña Modelo y Ajustes › IA, que comprueba en el servidor los modelos por defecto y prueba de verdad un modelo de embeddings nuevo (1536 dimensiones). |
| Traspaso | `src/server/handoff/` | Contrato `HandoffService` e implementación (`service.ts`, fase 2), que se registra al importarse: «Pendiente de humano», IA parada, asignación por turnos (puntero por canal en `app_kv` › `handoff.round_robin:<canal>`) o sin asignar según Ajustes, `handoff_events` y avisos. Pedirlo otra vez mientras espera a una persona no cambia nada. Termina con la primera respuesta de una persona (que mide su tiempo) o, sin respuesta, al resolver la conversación o reactivar la IA (`closeOpenHandoffs()`, `handoff_events.closed_at`): entonces deja de destacarse y una respuesta posterior no cuenta como la suya. El mensaje al cliente lo envía quien lo pide, como la única respuesta del turno. «Probar agente» solo lo simula. |
| Canales (común, fase 2) | `src/server/channels/` | `ChannelAdapter` (capacidades, conectar, revisar, avisos → eventos comunes, enviar, descargar medios, leídos, «escribiendo…», desconectar) y el registro por tipo. Los canales de demo de WhatsApp y correo usan `DemoAdapter`, que nunca llama fuera: guarda lo que «envía» y simula «entregado» y «leído» con trabajos `channel.demo_status`. El chat web usa `WebchatAdapter` (enviar = guardar; el widget lo lee por sondeo). Las respuestas a mensajes del simulador van siempre por `DemoAdapter`, aunque el canal sea real. Secretos del canal: `secrets.ts`. La revisión periódica de cada canal ([CAN-15]) es la de los canales que se conectan a un servicio: WhatsApp (cada 6 h) y el correo (en cada lectura del buzón, que tras varios fallos seguidos lo pone en «error» y, sin acceso, en «Requiere reconexión»); el chat web y los de demo no dependen de nadie (`healthCheck` solo mira su configuración). El chat web no recibe avisos: `handleWebhook` lo rechaza y sus mensajes entran por su propia API. |
| Entrada de mensajes (fase 2) | `src/server/inbound/` | `ingestEvents()`: aviso en bruto (si viene de un webhook), contacto e identidad (nunca por teléfono), mensaje una sola vez (con su `search_text` sin tildes, `message-search.ts`), conversación (una por canal y contacto; una por hilo en correo; se reabre y vuelve a la IA; una nueva o reabierta por el cliente avisa «Conversación nueva: Ana» a quien lo tenga activado en Ajustes › Notificaciones), no leídos, eventos para las pantallas, la baja si el mensaje es «BAJA» o «STOP» y trabajo `reply` agrupado (`src/server/engine/schedule.ts`: 4–8 s, hasta 20 s desde el primero; `REPLY_DEBOUNCE_MS` fija la espera solo en pruebas). Nunca llama a la IA. `kickTick()` lanza `tick()` con `after()` cuando vence la respuesta. Estados de entrega que solo avanzan: `status.ts`. |
| Motor de respuesta (fase 2) | `src/server/engine/` | Trabajo `reply` (`reply.ts`): un «alquiler» por conversación en `app_kv` (`reply.lease:<conversación>`) para no preparar dos respuestas a la vez; si llega otro mensaje del cliente, espera (nunca a una hora ya pasada) o descarta y vuelve a empezar. Solo cuentan los mensajes del cliente (`pending.ts`): los del sistema de un canal no son un turno. Comprobaciones puras (`checks.ts`; el modo pruebas compara solo lo que da el canal, `testModeIdentifiers()`, nunca lo que el visitante escribe en el formulario del chat web); las notas de voz se transcriben antes que nada, conteste o no la IA (así las reglas las leen y el equipo ve la transcripción); reglas de traspaso del agente (`rules.ts`: palabras clave, temas sensibles y «no lo sé»), entrada del modelo con `src/server/media/prepare.ts` dentro del tiempo del trabajo, `runAgent` en modo `live`, aviso de IA delante del primer mensaje de la IA (`disclosure.ts`) y una sola respuesta (o un borrador en «Borrador para revisar»). Si la IA falla dos veces, la conversación pasa a una persona sin enviar nada al cliente, y el fallo se ve en Ajustes › Diagnóstico › «Errores recientes de la IA» (los `ai_runs` fallidos que no son de «Probar agente»). Resumen acumulado (`summary.ts`, [MOT-13]): cuando 10 mensajes quedan fuera de los 20 que lee el modelo, el trabajo `conversation.summary` los resume con el modelo de chat de Ajustes (`conversations.summary` y `metadata.summaryUntil`); la respuesta lee el resumen y todo lo que aún no está en él. |
| Envío (fase 2) | `src/server/outbound/send.ts` | Todo lo que sale: se guarda «en cola» (o borrador), se entrega por el adaptador, se reintenta una vez si el error es pasajero y queda «fallido» con su error en español si no. `sendDraft()` envía un borrador aprobado (tal cual o editado) una sola vez aunque dos personas lo aprueben a la vez. |
| Medios (fase 2) | `src/server/media/` | `storeInboundMedia()` guarda lo que llega (clave generada, tipo, tamaño, SHA-256, nombre y duración en `messages.media`; límites en `limits.ts`, también el tope de cada tipo de archivo de WhatsApp, `INBOUND_MEDIA_CAPS`). `download-gate.ts`: como mucho 3 descargas de archivos de clientes a la vez y 128 MB reservados por proceso. `prepareMessagesForModel()` prepara la entrada del modelo en el trabajo `reply`: audios transcritos una vez con el modelo de Ajustes › IA en español (tal cual; si lo rechaza, a MP3 con FFmpeg, `ffmpeg.ts`, con el formato de entrada forzado según sus primeros bytes y solo archivos locales; si no, el modelo de respaldo, `transcribe.ts`, solo si todos sus proveedores están en la lista sin retención de OpenRouter, decisión 0018), con la transcripción guardada en el mensaje o `metadata.transcriptionFailed`; imágenes tal cual si el modelo las ve o descritas una vez por el modelo de visión (`describe-image.ts`, `metadata.imageDescription`); PDF como archivo si el modelo los abre o como texto (`pdf.ts`, unpdf); el resto, solo nombrado. Cada llamada queda en `ai_runs` con su coste. Nunca lee un archivo que otra conversación también usa. |
| Avisos al equipo (fase 2) | `src/server/notifications/` | `notify()`: avisos en la app al momento y, por la cola (`notifications.deliver`), email con el correo del sistema y push (`push.ts`, fase 7), según Ajustes › Notificaciones y las preferencias de cada persona; los Agentes solo de sus canales. El título dice qué pasa y con quién («Traspaso: Ana», [PWA-04]); fuera de la app (email y push), los avisos de una conversación no llevan texto. Desde la fase 5, también «Cita pendiente de confirmar» (`booking_pending`, [AGD-22]); desde la 7, «Conversación nueva» (`new_conversation`, desactivado por defecto). |
| Tiempo real (fase 2) | `src/server/realtime/events.ts`, `src/app/api/realtime/` | Eventos con tipo (`conversation.updated`, `message.created`, `message.status`, `notification.created`) solo con ids, en los temas `channel:<id>`, `user:<id>` y `widget:<conversación>`. `GET /api/realtime?cursor=` exige sesión y devuelve solo lo que esa persona puede ver. |
| Bandeja, contactos y canales: datos (fase 2) | `src/data/conversations.ts`, `conversation-actions.ts`, `conversation-scope.ts`, `messages.ts`, `notes.ts`, `message-sources.ts`, `contacts.ts`, `channels.ts`, `webchat-logo.ts`, `setup-webchat.ts`, `simulator.ts`, `notifications.ts` | Lista con filtros y contadores, conversación, IA encendida, apagada o en pausa, traspaso a mano, estado, asignar y tomar, etiquetas, leída, agente de la conversación, respuestas de personas (pausan la IA las horas de Ajustes y miden la primera respuesta), adjuntos de la bandeja (imágenes y PDF por su contenido, hasta 3,5 MB, si el canal los admite), borradores de la IA (aprobar, editar o descartar), notas, fuentes de las respuestas, contactos básicos (un Agente limitado a sus canales no crea contactos a mano: no los vería), canales (chat web y ajustes comunes, agente activo, miembros; el logo del chat solo cambia subiendo un archivo, nunca por su clave), el chat web del paso 6 del asistente, el simulador y avisos propios. Todas con actor, permiso y canales del Agente; una conversación inexistente o ajena responde «sin permiso». |
| Chat web (widget, fase 2) | `public/widget.js`, `src/app/api/widget/[channelId]/*`, `src/server/channels/webchat/`, `src/app/widget-demo/`, `src/components/webchat/widget-embed.tsx` | Script sin dependencias (ES2019) que dibuja el chat en un Shadow DOM abierto, con el color, el logo y los textos del canal, accesible con teclado y lector de pantalla (las respuestas nuevas se leen en una región `aria-live` aparte de la lista «Mensajes») y adaptado al móvil. API propia: `config`, `session` (el servidor crea el visitante y firma su token), `messages` (enviar y sondear), `upload` (imágenes y notas de voz comprobadas por su contenido, hasta 4 MB, guardadas con `storeInboundMedia`), `media` y `logo`. Cada ruta comprueba el canal, el dominio permitido (CORS sin `*`), el canal desactivado, el token y los límites por IP y visitante. El visitante solo lee su propia conversación. `/widget-demo` lo carga como lo pegaría el negocio (con `?canal=` para elegir chat), y el paso 6 del asistente también. |
| Bandeja, contactos, canales y simulador: pantallas (fase 2) | `src/app/(app)/bandeja/`, `contactos/`, `canales/`, `ajustes/diagnostico/simulador/`, `src/hooks/use-realtime.ts`, `src/components/notifications/`, `src/components/app-shell/inbox-unread.tsx`, `src/components/channels/channel-identity.tsx` | Bandeja con la lista siempre montada en el layout y la conversación al lado (en el móvil, pantallas separadas), filtros en la URL, cabecera con el interruptor de IA, traspaso, estado, asignación, etiquetas y agente, mensajes con autor, canal y estado de entrega, notas, fuentes, borradores con «Aprobar y enviar», «Editar» y «Descartar», y el cuadro de escribir con adjuntos. Un solo sondeo por pestaña a `/api/realtime` (`useRealtime`) para la lista, la conversación, la campana de avisos y el contador de no leídos del menú: cada 3–4 s, cada 5 s sin actividad (nunca más con la pestaña a la vista, [BAN-03]), nada con la pestaña oculta y hasta 30 s solo si falla la conexión. Contactos: lista y ficha. Canales: lista con agente activo e IA, «Añadir canal», asistente del chat web con vista previa y el panel de cada canal. Simulador en Ajustes › Diagnóstico. La identidad de cada tipo de canal (icono, nombre y color) es una sola, compartida por todas las pantallas. |
| Agentes (fase 1) | `src/data/agents.ts`, `src/data/agent-channels.ts`, `src/lib/agent-input.ts`, `src/lib/agent-tools.ts` | Alta en blanco o desde la plantilla del sector, edición por pestañas con versión en cada guardado, restaurar, duplicar, borrar (con confirmación si está activo en canales), avatar y «Activo aquí» por canal. Los modelos nuevos salen de Ajustes › IA con un respaldo de otro proveedor (`defaultFallbackFor`, compartido con la demo). |
| Primer agente del asistente (fase 1) | `src/app/setup/_steps/agent-*.tsx`, `src/data/setup-agent.ts` | Paso 5: la plantilla del sector (o el borrador generado desde la web del negocio si hay clave) con nombre, tono, instrucciones y preguntas frecuentes editables; volver al paso edita el mismo agente. |
| Cliente de Meta (fase 3) | `src/lib/meta/` | `createMetaGraphClient()` (`client.ts`): la Graph API con la versión de cada canal en cada ruta (`v26.0` por defecto, `versions.ts`), el token del usuario del sistema como `Bearer` y el token de app solo en `debug_token` y `/{APP_ID}/subscriptions`; descarga archivos solo de Meta o del origen de `META_GRAPH_BASE_URL`. `errors.ts`: cada código de la tabla de `docs/integracion-whatsapp.md` §12 con su mensaje en español y qué hacer (`MetaGraphError`, nunca con el token ni la URL). `signature.ts` (firma HMAC-SHA256 en tiempo constante), `webhook.ts` (esquemas Zod de los avisos), `messages.ts` y `templates.ts` (cuerpos de envío y plantillas con variables con nombre o posición), `window.ts` (ventana de 24 h, que un 131047 cierra hasta que el cliente vuelve a escribir), `markets.ts` (mercado por el prefijo o por el país del BSUID) y `pricing.ts` (coste estimado y nombres en español de las categorías de Meta). Todo puro salvo el cliente. |
| Canal de WhatsApp (fase 3) | `src/server/channels/whatsapp/` | `WhatsAppAdapter` (registrado en `registry.ts`): validar y conectar (`connect.ts`: número, `debug_token` —solo un token de usuario del sistema, decisión 0019— y WABA), revisar (`health.ts`: 11 semáforos), avisos → eventos comunes (`normalize.ts`: todos los tipos; reacciones, «no admitido» y cambios de identidad sin turno de la IA: los dos últimos se guardan como mensajes del sistema), enviar (`send.ts`: a `+wa_id` o al BSUID, nunca a los dos; reintentos con esperas crecientes y error final en español), leídos y «escribiendo…», descargar archivos y desconectar. Secretos cifrados en `secrets_enc` (`config.ts`). `webhook.ts`: `processWhatsAppWebhook()` comprueba primero la firma con los App Secret guardados, antes de leer el JSON (decisión 0022; las firmas rechazadas se cuentan en memoria y se escriben como mucho una vez por minuto y canal), busca los canales por `phone_number_id` (los avisos de cuenta, por la WABA), exige que los firmara el App Secret de cada canal, guarda el aviso en bruto, aplica los cambios de identidad, los estados (`statuses.ts`: coste del primer `pricing`, aviso de método de pago y de envío fallido), une BSUID y `wa_id` (`identity.ts`), aplica los avisos de cuenta (`account-events.ts`) y programa las descargas. Trabajos (`jobs.ts`): `wa.media_download` (tiene el «alquiler» de la respuesta mientras descarga y transcribe las notas de voz), `wa.health_check` (cada 6 h y tras los avisos de Meta), `wa.templates_sync` y `wa.status_retry`. `demo.ts`: los estados simulados de un número de demo llevan el `pricing` que daría Meta. |
| Aviso de WhatsApp (fase 3) | `src/app/api/webhooks/whatsapp/route.ts` | Una sola dirección por instalación, hecha con `APP_URL`. GET: responde el `challenge` de Meta si el token de verificación de la instalación (cifrado en `integration_settings`) coincide; si no, 403. POST: lee los bytes tal cual (hasta 3 MB; 413 si pasa), límite de 1.800 por minuto e IP y otro de 60 respuestas rechazadas (400, 401 o 413) por minuto e IP (429), 401 sin guardar nada con una firma mala, ausente o que ningún App Secret guardado confirma, o con un cuerpo que no se puede leer (la firma va antes que el JSON, decisión 0022), ya firmado 400 si trae más de 1.000 actualizaciones o más de 100 números o cuentas (decisión 0020), 200 para un número que no es de ningún canal; después, `after()` + `kickTick()`. Nunca llama a la IA. |
| WhatsApp: datos (fase 3) | `src/data/whatsapp.ts`, `whatsapp-activation.ts`, `whatsapp-panel.ts`, `whatsapp-templates.ts`, `whatsapp-send.ts`, `whatsapp-pricing.ts`, `whatsapp-account-alerts.ts` | Validar y conectar (reutiliza el App Secret de otro número de la misma app; nunca dos veces el mismo número), suscripción de la app y de la WABA, registro con PIN (10 intentos cada 72 h), códigos de verificación, diagnóstico guiado, panel (secretos enmascarados solo para propietario y administrador), cambiar token, App Secret o versión (solo si Meta los valida), desconectar, plantillas (sincronizar y el mensaje de una plantilla aprobada, `templateMessageOf()`, que usan la bandeja y `sendTemplateMessage()` para los recordatorios), la ventana y las plantillas de cada conversación, las tarifas de Ajustes › WhatsApp y el historial de avisos de Meta. Todas con actor y permiso; plantillas, códigos y validaciones con Meta llevan límite por persona (`whatsapp-limits.ts`). |
| WhatsApp: pantallas (fase 3) | `src/app/(app)/canales/nuevo/whatsapp/`, `canales/[id]/_whatsapp/`, `bandeja/[id]/_whatsapp/`, `ajustes/whatsapp/` | Asistente de 6 pasos (Aviso, Datos, Webhook, Activar, Prueba y Agente) que se retoma donde se dejó (`?canal=…&paso=…`), con «¿Dónde lo encuentro?» y enlaces a `/ayuda/whatsapp#…`. Panel del número en el Resumen del canal (semáforos, credenciales enmascaradas, modo pruebas, ajustes de envío, plantillas, avisos de Meta y límites; «Continuar configuración» o «Volver a conectar» si el número está a medias o desconectado). En la bandeja, la ventana de 24 h, «Elegir plantilla» con sus variables y vista previa, y el coste estimado de cada mensaje enviado. Ajustes › WhatsApp: tarifas por mercado y categoría, y la dirección y el token de avisos para copiar. |
| Cliente de Mistral OCR (fase 4) | `src/lib/mistral/ocr.ts` | `createMistralClient()`: `POST /v1/ocr` con el PDF como data URL (cabeceras y pies aparte, sin tablas en HTML) y la comprobación de la clave. Errores con su mensaje en español (`MistralError`), nunca con la clave. Solo se usa si el negocio pone su clave en Ajustes › IA. |
| Conocimiento: servicio (fase 4) | `src/server/knowledge/` | Entrada única `index.ts`. `extract/`: tipo real por extensión y contenido, PDF página a página (unpdf) o por OCR en tandas de 20 páginas, DOCX (mammoth → turndown), XLSX y CSV en bloques de 20 filas con cabecera, texto (UTF-8 o Windows-1252), páginas web y mapas del sitio (con `web-fetch.ts`). `extract/title.ts`: el título propio de un PDF o un Word (sus metadatos) sustituye al que el archivo tomó de su nombre, nunca a uno escrito por alguien. `pages.ts`: el Markdown de un PDF lleva `<!-- página N -->` delante de cada página. `chunking.ts`: fragmentos por encabezados de unos 400 tokens (150–600) con 60 de solape, sin partir filas de tabla, con sección y página, y el texto exacto que se embebe (prefijo «Documento: título > sección» y resumen). `ingest.ts`: `processDocument()`, la máquina de pasos (en cola → extrayendo → troceando → embeddings → listo o error) que avanza lo que cabe en cada ronda. `embeddings.ts` (lotes de 96, siempre 1536, en `ai_runs`), `summary.ts` (resumen de 2 frases con el modelo de chat, o las 2 primeras frases sin clave), `reindex.ts` (versión nueva del índice que se construye aparte y se estrena de golpe), `search.ts` y `rrf.ts` (búsqueda híbrida, ver «Conocimiento» más abajo), `maintenance.ts` (embeddings pendientes, refresco de webs, páginas del mapa del sitio), `agent-knowledge.ts` (las bases de cada agente, «Buscar siempre»), `fixtures.ts` (embeddings guardados de la demo) y `queue.ts` y `jobs.ts` (los cinco trabajos). Todos los números con nombre, en `constants.ts`. |
| Conocimiento: datos (fase 4) | `src/data/knowledge.ts`, `knowledge-documents.ts`, `knowledge-search.ts`, `knowledge-faq.ts`, `knowledge-context-files.ts`, `knowledge-retrievals.ts`, `message-reason.ts` | Bases (crear, cambiar, borrar escribiendo el nombre, reindexar, cambiar el modelo, reindexar todas desde Ajustes › IA) y las bases de cada agente; documentos (archivo, web con mapa del sitio y refresco, pregunta frecuente, texto; cambiar el título, que vuelve a procesar sus fragmentos con el nuevo prefijo; reprocesar y borrar con sus fragmentos y su archivo; un archivo idéntico se rechaza); «Probar búsqueda» (20 por minuto y persona); «Convertir en FAQ» desde la respuesta de una persona (con el límite de altas de contenido y su proceso al momento); archivos de contexto del agente (tope de 30.000 tokens); los fragmentos de cada respuesta (`message_retrievals`) y «¿Por qué respondió esto?» (`getMessageReason`: fragmentos y herramientas de la respuesta). Todas con actor, permiso y Zod. `canViewKnowledgeFile()` deja a `/api/files` servir los originales (Conocimiento: `knowledge.view`; archivos de contexto: `agents.view`). |
| Conocimiento: pantallas (fase 4) | `src/app/(app)/conocimiento/`, `src/app/api/knowledge/bases/[id]/files/`, `src/app/(app)/agentes/[id]/conocimiento/`, `src/app/(app)/bandeja/[id]/_sources/`, `src/app/(app)/agentes/[id]/probar/` | Lista de bases, cada base con Documentos, Preguntas frecuentes, Probar búsqueda y Ajustes, y la página de cada documento con sus fragmentos; la página se recarga sola cada 4 s mientras algo se procesa. La pestaña Conocimiento del agente (archivos de contexto con su barra de tokens, bases con «Usar» y el modo). En la bandeja, «Ver fuentes» abre «¿Por qué respondió esto?» y «Convertir en FAQ» bajo la respuesta de una persona. «Probar agente» enseña la base de cada fragmento. Las acciones que dejan trabajo en la cola lo lanzan al momento con `kickTick()`. |
| Páginas legales (fase 3) | `src/app/legal/` | `/legal/privacidad`, `/legal/terminos` y `/legal/eliminacion-datos`, públicas, con los datos del negocio y los textos por defecto: Meta pide sus direcciones para publicar la app ([CUM-08]). |
| Agenda: motor y servicio (fase 5) | `src/server/booking/` | Entrada única `index.ts`. `availability.ts`: el motor de disponibilidad, una función pura (`computeAvailability`) que recibe servicio, recursos con su horario y ausencias, citas, horario del negocio, cierres, zona horaria, modo, rango, personas, intervalo y la hora actual, y devuelve los huecos libres o el motivo de que no haya ninguno; también `bookingTimes` (inicio, fin y franja ocupada con los márgenes), `pickSuggestions` (2 o 3 huecos repartidos) y `closestSlots` (alternativas). `time.ts`: la hora local del negocio y el instante UTC en los dos sentidos, con los cambios de hora resueltos a propósito (una hora que no existe avanza; una que se repite se ofrece dos veces, cada una con su desfase). `load.ts` lee de la base lo que el motor necesita. `service.ts`: crear, mover, cambiar el estado, cancelar y editar citas, ausencias y bloqueos, cada escritura en una transacción que toma el candado de escritura de la base y vuelve a comprobar el hueco con el motor ([AGD-13]). `events.ts` (historial en `booking_events`), `views.ts` (la cita con nombres y horas locales), `notices.ts` (aviso al cliente por su conversación cuando una persona confirma, mueve o cancela, y aviso al equipo `booking_pending` de una cita pendiente), `reminders.ts`, `reminder-fields.ts` y `jobs.ts` (recordatorios), `agent-tools.ts` (lo común de las herramientas de citas del agente), `format.ts` y `test-helpers.ts` (negocios de prueba para Vitest). |
| Agenda: datos (fase 5) | `src/data/bookings.ts`, `bookings-time-off.ts`, `agenda-config.ts` | Calendario con filtros, ficha con historial, huecos libres, crear (desde la agenda, un contacto o una conversación), mover, editar, estados con aviso opcional al cliente, citas de un contacto y la próxima de cada contacto, citas de prueba (contar y borrar todas); ausencias y bloqueos; palabras, modo e intervalo, servicios, recursos con horario semanal y servicios, y los recordatorios. Todas con actor, permiso (`agenda.view`, `agenda.bookings` —un Agente, solo para contactos y conversaciones de sus canales—, `agenda.block`, `agenda.configure` y `agenda.delete_test_bookings`), Zod y registro de actividad. |
| Agenda: pantallas (fase 5) | `src/app/(app)/agenda/`, `agenda/configuracion/`, `ajustes/recordatorios/`, `contactos/[id]/_bookings/`, `bandeja/[id]/_bookings/`, `src/lib/booking-display.ts` | Calendario por día, semana, mes y recursos con filtros en la URL, «Nueva cita» (solo huecos del motor), arrastrar para mover y alargar (con «Cambiar» en la ficha como alternativa de teclado), «Bloquear hueco», la ficha de la cita en un panel (`/agenda?cita=<id>`) y «Citas de prueba». Configuración: General (modo, intervalo y palabras), Servicios y Recursos (horario y ausencias; el supervisor solo ausencias). Ajustes › Recordatorios. La ficha del contacto (sus citas y «Nueva cita») y el panel del contacto en la bandeja (próximas citas y «Nueva cita» unida a la conversación) comparten `contactos/[id]/_bookings/`; la lista de Contactos enseña la próxima cita. «Probar agente» tiene «Borrar citas de prueba». Los estados, los orígenes y los colores de recurso de las citas son los mismos en todas (`src/lib/booking-display.ts`). |
| Cumplimiento: bajas, aviso de IA y conservación (fase 7) | `src/server/compliance/` (`opt-out.ts`, `opt-out-confirmation.ts`, `jobs.ts`, `retention.ts`), `src/data/consents.ts`, `src/server/jobs/handlers/retention.ts` | Bajas ([CUM-03], [CUM-04], [CUM-13]): un mensaje que es solo «BAJA» o «STOP» (sin distinguir mayúsculas, tildes, signos ni emojis) guarda la baja en los consentimientos del contacto para ese canal dentro de la misma transacción de `ingestEvents()` y, en vez de la respuesta de la IA, pone en cola una sola confirmación (`compliance.opt_out_confirmation`, que no se repite aunque el trabajo corra dos veces). Desde entonces, por ese canal, solo le llega lo que escribe una persona ([CUM-04]), avisada sobre el cuadro de escribir de que la IA, los recordatorios y las plantillas están parados (`isConversationOptedOut()` de `src/data/consents.ts`): en `sendOutbound()` lo que envía la plataforma sola (la IA, un aviso, una plantilla) queda «fallido» con el motivo, «Reintentar» solo reenvía el mensaje de una persona y aprobar un borrador de la IA se rechaza (`OptedOutError`); la confirmación sí pasa. En el correo, «BAJA» es la primera línea del cuerpo (sin el asunto ni el texto citado), la baja es de quien envía ese correo, y las comprobaciones miran al contacto al que va la respuesta: el remitente del último correo del hilo. La baja se quita con `liftOptOut()` (propietario, administrador y supervisor, [CTO-08]): un «alta» con quién, cuándo y por qué, y el registro de actividad. Aviso de IA ([CUM-01]): `withAiDisclosure()` lo pone mientras ninguna respuesta de la IA ha llegado al cliente (un borrador pendiente no cuenta). Conservación ([CUM-05], [CUM-06]): trabajo diario `compliance.retention`, pedido al arrancar el servidor (`src/instrumentation.ts`, `ensureRetentionJob()`), que avanza por tandas mientras le queda tiempo y sigue en la siguiente ronda; al terminar deja un resumen en el registro de actividad (`retention.cleanup`). Ver «Conservación» en `docs/modelo-de-datos.md`. Reactivar la IA a mano programa la respuesta a lo que el cliente dejó sin contestar ([BAN-16], `scheduleReplyToUnanswered()` en `src/server/engine/schedule.ts`) y la acción de la bandeja lanza la cola en cuanto vence (`kickTick`). Si la limpieza borró el audio de una nota de voz, la bandeja dice «El audio se borró por la política de conservación» y sigue enseñando su transcripción. |
| Contactos: derechos de los datos (fase 7) | `src/data/contacts-export.ts`, `contacts-erase.ts`, `contacts-merge.ts`, `contacts-merge-plan.ts`, `contacts-search.ts`, `consents.ts`, `src/server/compliance/contact-data-export.ts`, `contact-data-erase.ts`, `contact-data-csv.ts`, `src/app/(app)/contactos/` | Exportar los datos de un contacto (JSON con datos, identidades, consentimientos, conversaciones, mensajes y citas) y la lista (CSV con la búsqueda y los filtros, o los seleccionados) ([CTO-06]); borrar uno desde su ficha escribiendo su nombre, o varios desde la lista escribiendo cuántos son ([CTO-07]): se borran sus datos, mensajes, notas y archivos (hijos antes que padres, en una transacción con el registro de actividad, que solo guarda números) y sus citas quedan sin datos personales; posibles duplicados (mismo email o teléfono) y fusión a mano con vista previa de qué datos se quedan ([CTO-04], [CTO-05]); consentimientos y «Levantar baja» con quién, cuándo y por qué ([CTO-08]). La búsqueda de Contactos y de la Bandeja no distingue tildes ni mayúsculas: `contacts.search_text` y `messages.search_text` guardan el texto normalizado, se escriben con cada cambio y los rellena una vez el arranque para lo anterior; la limpieza y el borrado de un contacto se los llevan con el texto. |
| Informes (fase 7) | `src/data/reports.ts`, `src/app/(app)/informes/` | Conversaciones por canal, resueltas por la IA, traspasos y sus motivos, tiempo hasta la primera respuesta humana (mediana, percentil 90 y porcentaje en menos de 3 minutos), citas de la IA y costes de IA y de WhatsApp por mes, en la zona del negocio, por mes o por fechas y por canal, con gráficos (recharts), tablas y exportación CSV (anotada en el registro de actividad). Cómo se cuenta cada cifra: decisión 0023. Todo se suma en la base con Drizzle; solo los percentiles se calculan en el servidor. «Probar agente» nunca cuenta. |
| App instalable y avisos push (fase 7) | `src/app/manifest.ts`, `src/components/pwa/`, `public/sw.js`, `src/app/api/push/`, `src/server/notifications/push.ts` | Manifiesto dinámico con el nombre, el color y el icono del negocio (el icono lo dibuja `/api/push/icon`, también el `apple-touch-icon` del layout raíz), el service worker (sus cabeceras en `next.config.ts`), «Instalar la app» y «Activar avisos» por dispositivo en Mi cuenta y Ajustes › Notificaciones, las claves VAPID generadas y cifradas en la instalación, el envío con `web-push` desde `notifications.deliver`, las suscripciones caducadas (404/410) borradas y la de este dispositivo apagada al cerrar sesión. Detalles en `docs/notificaciones-push.md`. |
| Herramientas HTTP (fase 7) | `src/data/custom-tools.ts`, `src/server/ai/tools/http-tool*.ts`, `src/server/web-fetch.ts`, `src/app/(app)/agentes/herramientas/`, `src/app/(app)/agentes/[id]/herramientas/` | Las herramientas del negocio (nombre, descripción, parámetros, método, dirección con variables, cabeceras secretas cifradas y tiempo máximo), con «Probar», la lista de agentes que las usan y el interruptor en la pestaña Herramientas de cada agente. Solo HTTPS a direcciones públicas, comprobadas también al conectar, sin seguir redirecciones; respuesta recortada y sin los valores secretos ([HER-11]–[HER-14]). Cada llamada del agente deja dos entradas distintas en el registro de actividad: el uso de la herramienta y la llamada al servicio (método, servidor, respuesta y tiempo), nunca sus datos. |
| Correo: clientes (fase 6) | `src/lib/google/`, `src/lib/microsoft/` | OAuth y API de Gmail; OAuth de Microsoft Entra y Microsoft Graph. Con `fetch` propio, direcciones base configurables y errores en español, como los demás clientes. |
| Correo: canal (fase 6) | `src/server/channels/email/` | Un adaptador por proveedor (Gmail, Outlook, IMAP/SMTP con ImapFlow y Nodemailer) detrás del `ChannelAdapter` común: conectar (OAuth con PKCE y un `state` al azar de un solo uso que caduca a los 10 minutos, del que se guarda su SHA-256 y que solo gasta la persona que empezó la conexión, `oauth-state.ts`; IMAP con «Probar conexión»), leer (`email.poll` cada minuto: cambios de Gmail con `history.list`, delta de Outlook, UID nuevos de IMAP; si el punto de partida caduca, vuelve a sincronizar sin duplicar; el tamaño de cada correo se mira antes de descargarlo), leer y limpiar cada correo (`parse.ts` con mailparser, `quotes.ts`), filtrar lo que no se contesta y contarlo por motivo para Diagnóstico (`filters.ts`, [COR-16]), un hilo por conversación (`threading.ts`), borradores en la bandeja y en el buzón (`drafts.ts`), enviar en el mismo hilo con la firma y las cabeceras de respuesta, solo al remitente y nunca al Reply-To (`compose.ts`, `headers.ts`, `reply-context.ts`; en Outlook, si Graph no acepta nuestra cabecera en JSON, la respuesta se crea desde nuestro MIME), si el servidor que recibió cada correo verificó su remitente (`auth-results.ts`, [COR-25]; el motor quita a un remitente sin verificar las herramientas sobre sus citas y datos, `src/server/engine/email-sender.ts`), topes diarios por hilo, remitente y buzón (`caps.ts`) y «Requiere reconexión» cuando el acceso caduca (`status.ts`). Detalles en `docs/integracion-correo.md`. |
| Correo: datos y pantallas (fase 6) | `src/data/email*.ts`, `src/app/(app)/canales/nuevo/correo/`, `canales/[id]/_email/`, `bandeja/[id]/_email/`, `src/app/api/oauth/` | El asistente de correo (proveedor, conectar, respuestas y agente), el panel de cada buzón (estado, actividad, ignorados por motivo, respuestas de la IA, «Leer ahora», reconectar), el hilo en la bandeja con sus tarjetas, y la vuelta de Google o Microsoft. Diagnóstico enseña también los correos ignorados de cada buzón por motivo. |
| Seguridad web (fase 7) | `src/proxy.ts`, `next.config.ts`, `src/server/client-ip.ts`, `src/server/startup-checks.ts` | CSP con nonce por petición, cabeceras de seguridad, IP del cliente según `TRUSTED_PROXY_HOPS`, enlaces de recuperación guardados con su SHA-256 y quitados del trabajo que envía el correo, invitaciones revocadas cuando quien las envió deja de poder invitar, espera creciente al fallar la contraseña, `/api/files` con trozos (`Range`) y el chat web endurecido (límites antes de leer la base, topes diarios y limpieza de subidas sin enviar). Ver `docs/security.md`. |
| Pruebas | `src/**/*.test.ts`, `scripts/**/*.test.ts`, `e2e/` | Ver `docs/testing.md`. |

Detalles que salieron al construir y que conviene saber:

- **Claves foráneas:** Postgres las aplica siempre. Aun así ningún borrado depende de cascadas: el código borra antes
  los datos dependientes.
- **Un escritor a la vez (fase 8):** la app se construyó sobre el único escritor de SQLite, y Postgres admite muchos.
  Para no cambiar lo que dependía de ello (citas sin dobles reservas, cola, orden de los eventos de las pantallas,
  comprobaciones de la demo), cada transacción de primer nivel fija `lock_timeout` a 15 s y toma
  `pg_advisory_xact_lock(727252001)`, un candado de toda la base que se suelta al terminar (`src/db/index.ts`); las
  anidadas no lo vuelven a pedir, las de solo lectura (`accessMode: "read only"`) no lo toman, y también lo toman las
  transacciones de Better Auth. Es de transacción, así que funciona con el pooler de Supabase en modo transacción. Las
  transacciones son cortas, usan solo `tx` y nunca llaman a servicios externos: con la base integrada, una consulta
  con `db` dentro de una transacción espera a que esta termine y se queda colgada (decisión 0024).
- **Base integrada (PGlite):** la abre un solo proceso; `src/db/index.ts` deja junto a la carpeta un candado con el
  número del proceso (`data/pglite.lock`) y un segundo proceso se niega con «La base local (data/pglite) está abierta
  en otro proceso (¿pnpm dev en marcha?)». No guarda el `search_path`: se fija al abrirla (`public, extensions`). Solo
  sirve para la demo y las pruebas; publicada, la base es Supabase, y en Vercel sin su conexión la app se niega
  («Falta DATABASE_URL de Supabase») y `/api/health` responde 503.
- **Orden y comparaciones de Postgres:** los vacíos (`NULL`) van al final al ordenar en ascendente y al principio en
  descendente, al revés que SQLite, así que las listas que dependían de ello (la bandeja por último mensaje, los
  contactos) lo dicen explícito (`nulls last`); y `LIKE` distingue mayúsculas, así que donde se contaba con que no,
  va `ilike`. Esos fragmentos comunes (los patrones de `LIKE` con el texto buscado escapado, un `jsonb` leído como texto
  y dónde van los vacíos al ordenar) están en `src/server/sql-helpers.ts`, el único SQL a mano fuera de los adaptadores
  y de `drizzle/`.
- **Texto que la base no admite:** Postgres rechaza el carácter nulo (NUL) en el texto y en `jsonb`, y la mitad suelta
  de un carácter compuesto (como medio emoji) en `jsonb`; SQLite los aceptaba. Todo lo que entra (el lector de
  correos, el aviso de WhatsApp, la entrada común de mensajes y el texto que se pega en el conocimiento) pasa antes por
  `src/server/storable-text.ts`, que quita los NUL y cambia la mitad suelta por «�»: así ningún mensaje se pierde ni
  bloquea un buzón. El texto extraído de los documentos se guarda también sin NUL (`src/server/knowledge/store.ts`).
- **Errores de la base:** de un error de Postgres solo se registra «Error de la base de datos (SQLSTATE,
  restricción).», nunca su mensaje ni su detalle, que pueden llevar datos (`src/server/redact.ts`, que además tapa las
  claves de Supabase, `sb_secret_…` y `sb_publishable_…`, y el usuario y la contraseña de una dirección
  `postgres://…`). Un duplicado se reconoce por el código `23505` (`isUniqueViolation`), no por el texto del error.
- **Diagnóstico de la base:** Ajustes › Diagnóstico la llama «Supabase (Postgres)», «Postgres» (otro servidor) o
  «Postgres integrado (PGlite) · data/pglite», con su tamaño (`pg_database_size`) y las migraciones aplicadas (de
  `drizzle.__drizzle_migrations`).
- **Scripts y `server-only`:** las órdenes de `package.json` que usan código del servidor se lanzan con
  `tsx --conditions=react-server`, para que `import "server-only"` funcione fuera de Next.js.
- **Nada se lee de la base al compilar:** las páginas y metadatos que leen la base sin otra API de la petición
  llaman antes a `connection()`; si no, `next build` los prerenderizaría con los datos de ese momento.
- **Otro puerto en local:** `pnpm dev -p 3200` ajusta `APP_URL` y `BETTER_AUTH_URL` locales a ese puerto (si no,
  el inicio de sesión rechaza el origen). Las direcciones que no son locales, como un túnel, no se tocan.
- **Guías de Ayuda:** se leen de `docs/` en el servidor y `next.config.ts` las añade a la salida de la compilación
  (`outputFileTracingIncludes`). Importarlas como texto con el tipo `raw` de Turbopack no sirve en Next 16.3.6:
  compila, pero el contenido llega vacío; y el tipo `text` no existe.
- **Catálogo de modelos:** se guarda ya filtrado y normalizado en `app_kv` (`ai.model_catalog`) y se renueva
  cuando alguien abre un selector o un agente responde y tiene más de 12 h, y cada 12 h con el trabajo recurrente
  `ai.model_catalog_refresh` (`src/server/jobs/handlers/model-catalog.ts`; se programa tras la primera descarga con la
  clave de la instalación y, sin clave, no pregunta nada). Los avisos de modelos que se retiran o desaparecen
  ([MOD-06]) en las páginas solo leen esa copia, nunca llaman a OpenRouter al pintar una página. Tras cada descarga,
  `src/server/ai/model-retirement.ts` revisa los modelos en uso (principal y respaldo de cada agente y los modelos
  por defecto de Ajustes › IA) y avisa con `model_deprecated` una sola vez por modelo y estado (se recuerda en
  `ai.model_notices`, con un «alquiler» para que dos descargas a la vez no avisen dos veces) ([AJU-08]). Si la descarga
  falla, no se vuelve a pedir en 5 minutos (`ai.model_catalog_retry`) salvo con «Actualizar lista». Supervisor
  y Solo lectura solo ven la copia guardada: nunca hacen que el servidor llame a OpenRouter con la clave. Al
  guardar un agente (también el primero del asistente) o el modelo del paso 4, si todavía no hay copia se pide
  con la clave (en el paso 4, la que se está escribiendo) y se comprueba contra ella ([MOD-05]).
- **Privacidad de la transcripción:** la transcripción no admite `data_collection` ni `zdr` por petición, así
  que Ajustes › IA compara los proveedores del modelo elegido (`/models/{id}/endpoints`) con la lista pública
  sin retención (`/endpoints/zdr`) por su `tag`, y avisa junto al campo ([AJU-04], [CUM-10]). El resultado se
  guarda 12 h por modelo en `app_kv` (`ai.transcription_privacy`).
- **Herramientas de una respuesta:** de cada respuesta del modelo se ejecutan como mucho 5 llamadas; las demás
  reciben un error corto y una sola entrada en el registro de actividad. Tras un traspaso no se ejecuta nada más
  de esa respuesta ([MOT-10]). Un nombre de herramienta que el agente no tiene se registra como «desconocida».
- **Formularios que se vuelven a crear al guardar:** el aviso de guardado llega a veces antes que los datos
  nuevos del servidor. Por eso Ajustes › IA se vuelve a crear también cuando cambian esos datos, y un campo
  secreto (`SecretField`) vuelve a la máscara «••••1234» cuando cambia el valor guardado.
- **Listas desplegables largas:** el selector de modelos nunca es más alto que el espacio que queda en la
  pantalla (`--radix-popover-content-available-height`), para que el buscador y «Actualizar lista» siempre se
  puedan pulsar.
- **Claves repetidas en React:** tres hijos del mismo padre con la misma `key` (la cabecera, los mensajes y el
  cuadro de escribir de una conversación) hacían que, al refrescar la página con `router.refresh()`, React
  duplicara la lista de mensajes. Cada uno lleva ahora su propia clave (`header-…`, `timeline-…`,
  `composer-…`).
- **Tamaño de las Server Actions:** `next.config.ts` sube su límite de 1 MB a 4 MB para los adjuntos de la bandeja
  (3,5 MB más lo que añade el formulario), por debajo de los 4,5 MB de Vercel. Las subidas del chat web van por su
  propia ruta, con su límite.
- **Respuestas sin cron en local:** la petición que guarda un mensaje (chat web o simulador) deja con `after()` un
  `kickTick()` que espera a que venza el trabajo de respuesta y lo ejecuta; el lanzador de `pnpm dev` y el cron
  solo recogen lo que quede. Una prueba de Playwright lo comprueba sin llamar nunca al cron.
- **Un registro de adaptadores por copia del código:** la versión compilada lleva su propia copia del código del
  servidor en cada ruta (el aviso de WhatsApp, el cron, cada página con sus acciones). Por eso el registro de
  adaptadores de canal (`src/server/channels/registry.ts`) vive en su módulo y no en `globalThis`: compartido, una
  ruta usaba el adaptador de otra y su `instanceof ChannelSendError` fallaba, así que un error de Meta como el 131047
  salía como «error inesperado». El servicio de traspaso y el de push siguen en `globalThis`: hoy nadie comprueba con
  `instanceof` los errores que lanzan, pero conviene tenerlo en cuenta.
- **Ventana de 24 h de WhatsApp:** se cuenta desde la hora de Meta del último mensaje del cliente
  (`conversations.last_inbound_at`); los avisos del sistema y los tipos no admitidos no la abren ni la renuevan. Si
  Meta responde 131047, `conversations.metadata.whatsappWindowClosedAt` la deja cerrada hasta que el cliente vuelve a
  escribir: lo respetan la IA (`src/server/engine/checks.ts`), las respuestas de una persona y la bandeja, todas con
  `whatsappWindowState()` de `src/lib/meta/window.ts`.
- **Archivos de WhatsApp y respuesta:** el trabajo `wa.media_download` se lanza al momento y la respuesta espera
  mientras un archivo de su turno sigue pendiente de descargar (como mucho 2 minutos), para contestar a una nota de
  voz con su transcripción. Cada tipo tiene su tope (el del tipo del mensaje: un MP3 enviado como documento tiene el
  del documento) y la descarga se corta en cuanto lo pasa. `FileStorage.put` y el cliente de Meta trabajan con el
  archivo entero en memoria, así que en vez de pasarlo por partes se limita cuántos se descargan a la vez por proceso
  (`src/server/media/download-gate.ts`); uno que no consigue su turno en 20 s vuelve a la cola y se reintenta.
- **Demo de WhatsApp:** el número de demo trae sus plantillas sincronizadas (dos aprobadas) y Ajustes › WhatsApp,
  tarifas de ejemplo para España marcadas «ejemplo» (`seed/steps/whatsapp.ts`); una plantilla enviada desde la
  bandeja sale por `DemoAdapter` y su «entregado» simulado trae el `pricing` que daría Meta, así que se ve su coste
  estimado sin llamar a Meta.
- **Subidas al conocimiento:** los archivos van por su propia ruta, `/api/knowledge/bases/[id]/files` (el cuerpo es
  el archivo y su nombre va en la cabecera `x-file-name`), que comprueba el origen, la sesión, el permiso, 60 altas
  por persona cada 10 minutos y los 25 MB antes de leerlo entero. No va por una Server Action porque estas admiten
  4 MB (`next.config.ts`) y porque `src/proxy.ts`, que sí pasa por las páginas, solo conserva los primeros 10 MB de
  un cuerpo. En Vercel el límite de 4,5 MB por petición manda: subir directo del navegador a Supabase Storage con una
  dirección firmada de subida (`docs/plataforma-despliegue.md`) queda para cuando se publique. Los archivos de
  contexto de un agente, más pequeños, van por Server Action (hasta 3,5 MB).
- **Estados del conocimiento:** «Listo (solo texto)» no se guarda: es un documento listo con fragmentos del índice en
  uso sin embedding (`documentsWithPendingEmbeddings()`). Sin clave de OpenRouter, o si OpenRouter rechaza la clave,
  un documento queda listo para buscar por palabras y el trabajo `knowledge.embeddings` rellena los embeddings
  después: se programa al guardar una clave en Ajustes › IA (al momento), al terminar un documento sin clave y cada
  10 minutos mientras siga sin clave. Si la clave se pone solo en `.env.local`, los programa el arranque de la app
  (ver «Embeddings pendientes»); «Reindexar» en la base también los calcula.
- **Reindexar ([CON-13], [AJU-05]):** cada base busca en su `index_version`; un reindexado construye los fragmentos
  y embeddings de la versión `building_index_version` sin tocar los de la versión en uso y, completo, cambia de
  versión y de modelo en una transacción y borra los antiguos. Cambiar el modelo de embeddings por defecto en
  Ajustes › IA reindexa todas las bases con él. Un modelo que no da 1536 números aborta y la base se queda como
  estaba.
- **Qué recibe el modelo del conocimiento ([CON-19]):** fragmentos numerados («[n] Título · Sección · pág. N») hasta
  unos 3.500 tokens, o `SIN_RESULTADOS`, que el motor cuenta como un «no lo sé» para el traspaso. Nunca los
  embeddings ni ids internos. La herramienta `buscar_conocimiento` solo busca en las bases de su agente y su
  resultado admite unos 15.900 caracteres (las demás herramientas, 4.000).
- **Demo del conocimiento:** `seed/knowledge/` guarda, por sector, un Markdown y un texto que la semilla convierte en
  un PDF de dos páginas (`seed/knowledge/pdf.ts`, sin binarios en el repositorio); el paso `seed/steps/knowledge.ts`
  los pasa por el mismo extractor y troceado que la app, crea la base «Información del negocio» ya lista, se la da a
  los tres agentes de la demo (con `buscar_conocimiento` en «Automático») y anota los fragmentos de algunas
  respuestas de la demo, sin programar trabajos ni llamar a la IA. Cada fragmento lleva su embedding si
  `seed/fixtures/embeddings.json` lo tiene (clave SHA-256 del modelo, el tamaño y el texto); si no, queda para el
  trabajo de embeddings pendientes. `pnpm seed:embeddings` (`seed/knowledge/embeddings-command.ts`) rellena ese
  archivo con la clave de `.env.local`, sin abrir la base de datos. Hoy el archivo del repositorio está vacío: falta
  ejecutarlo una vez con una clave real ([ARR-12]).
- **Embeddings pendientes ([CON-12], [ARR-15]):** los pone en cola guardar una clave en Ajustes › IA y, al arrancar
  el servidor (`src/instrumentation.ts`, en segundo plano, nunca durante `next build`), cualquier fragmento sin
  embedding cuando ya hay clave: así cuenta la que se pone en `.env.local` al reiniciar (decisión 0021).
- **Relevancia de la búsqueda ([CON-16], [CON-18]):** basta con que aparezca alguna palabra de la pregunta (sin las
  palabras vacías); sin ninguna, decide la similitud del mejor resultado por significado (0,3). Los resultados por
  significado por debajo de 0,2 no se mezclan: no rellenan la respuesta con fragmentos que no tienen que ver
  (decisión 0021).
- **«Reordenar resultados» ([AJU-04], [CON-16]):** un interruptor de toda la instalación en Ajustes › IA,
  desactivado por defecto, con su modelo elegido de la lista comprobada (`src/lib/openrouter/rerank-models.ts`; por
  defecto `cohere/rerank-v3.5`). Con ZDR solo se ofrecen los que no guardan datos (hoy `qwen/qwen3-reranker-8b`); si
  el elegido no lo es, la pantalla lo avisa y la búsqueda no reordena. Con reordenación, 6 resultados; si falla, los
  8 de RRF.
- **Texto de fuera y el servidor:** mapas del sitio, páginas web, documentos, respuestas de OCR y resúmenes se leen
  sin patrones que retrocedan sin límite (encabezados, `<loc>`, frases y enlaces con bucles o patrones lineales, cada
  línea recortada de espacios con `trimLineEnds`), y un DOCX o XLSX se descomprime primero con tope (100 MB) antes de
  dárselo a su lector (`src/server/knowledge/extract/zip.ts`).
- **Sin dobles reservas ([AGD-13]):** cada escritura de una cita (crear, mover, volver a confirmar) abre una transacción
  que primero toma el candado de escritura de toda la base (`pg_advisory_xact_lock` de `src/db/index.ts`: un escritor a
  la vez; las transacciones de solo lectura no lo toman), vuelve a leer las citas y
  ausencias del recurso y pasa el hueco por el mismo motor que ofreció los huecos antes de guardar; si ya no está libre,
  responde «Ese hueco ya no está libre» con los huecos más cercanos. La segunda de dos reservas simultáneas espera a la
  primera y encuentra el hueco ocupado, como debe, también entre procesos (la web y `pnpm worker`), porque el candado es
  de la base. Una restricción de exclusión en la tabla sería un refuerzo posible (`docs/modelo-de-datos.md`, «Sin
  dobles reservas»), no necesario con el candado.
- **Horas de la agenda:** la base guarda instantes UTC; las pantallas, el agente y los mensajes usan la hora del negocio
  (`src/server/booking/time.ts`). Los huecos salen de una rejilla de tiempo transcurrido desde cada medianoche local,
  así que el día que se atrasa el reloj la hora repetida sale dos veces (cada una con su desfase y, en pantalla, «antes
  del cambio de hora» o «después del cambio de hora») y el día que se adelanta la hora que no existe no sale nunca
  ([AGD-10]). Las pruebas del motor cubren el 25-10-2026 y el 28-03-2027 en Madrid.
- **Confirmación de la IA ([AGD-23], [MOT-10]):** cuando la IA crea, mueve o cancela una cita, la herramienta devuelve el
  texto de confirmación (`confirmar_al_cliente`) y el agente lo dice en su única respuesta del turno: no sale ningún
  mensaje aparte. Los avisos al cliente por su conversación (`sendBookingNotice`) son solo para lo que hacen las
  personas desde la agenda, y solo si marcan «Avisar al cliente»: respetan la ventana de 24 h de WhatsApp, las bajas y
  los canales desactivados.
- **Herramientas de citas y su alcance ([HER-04]):** en una conversación real solo actúan sobre el contacto y la
  conversación del turno, nunca sobre ids que diga el modelo; en «Probar agente» crean citas `is_test` sin contacto y
  solo ven y cambian citas de prueba.
- **Recordatorios ([AGD-24], [AGD-25]):** apagados por defecto; al activarlos se programa el trabajo periódico
  `booking.reminders` y al apagarlos se quita (`syncBookingReminderJob`). Cada cita se «toma» con una sola sentencia
  que pone `bookings.reminder_sent_at` solo si estaba vacío, antes de enviar nada: dos rondas a la vez nunca envían dos
  recordatorios. Si el envío falla, queda en el historial de la cita (`reminder_failed`, con el motivo que enseña su
  ficha) y no se reintenta. Mover una cita vacía `reminder_sent_at` si su nuevo momento de recordatorio aún no ha
  pasado. Por WhatsApp va con `sendTemplateMessage` (plantilla de utilidad aprobada, que respeta bajas y canales
  desactivados); por email, con el correo del sistema.
- **IP del cliente:** la de `x-forwarded-for` que escribe el proxy de delante, contando `TRUSTED_PROXY_HOPS`
  entradas desde la derecha (1 por defecto: Vercel o Traefik; 2 con otro delante, como Cloudflare). Con 0 (la app sin
  proxy, que no se recomienda) no se fía de ninguna cabecera y todos comparten los límites por IP; los límites por
  email, visitante y usuario siguen funcionando. Un valor no válido no deja arrancar la app.
- **Búsqueda sin tildes:** `contacts.search_text` y `messages.search_text` guardan el texto en minúsculas y sin
  tildes, y la búsqueda compara con un `LIKE` sobre esa columna; lo que aún no la tenga se busca por su texto con
  `ILIKE`, que no distingue mayúsculas. En los dos casos, lo que escribe la persona va escapado (`%`, `_` y `\` son
  texto, no comodines: `src/server/sql-helpers.ts`). El arranque rellena una vez lo que no tenga `search_text` (marca
  en `app_kv`).
- **Clics y teclas antes de que la página sea interactiva:** hasta que React toma la página, un botón con `onClick` no
  hace nada y lo escrito en un campo se puede pisar. El panel entero va dentro de un `<fieldset disabled>` que se
  habilita en cuanto la página es interactiva (`src/components/hydration-gate.tsx`, con `display: contents`, sin rol
  y sin cambiar el aspecto de los controles): en la primera carga los controles esperan una fracción de segundo y
  nada se pierde; al navegar dentro de la app ya están habilitados.
- **Cabecera de la conversación en ordenador:** con la lista y la ficha del contacto a la vista, la columna central es
  estrecha; sus controles se ajustan a su ancho y el texto «IA en pausa hasta…» salta de línea, para no quedar debajo
  de la ficha (que se llevaría el clic).
- **`kickTick()` fuera de una petición:** `after()` solo existe dentro de una petición; fuera (un script, una prueba)
  `kickTick` no hace nada y el trabajo lo recoge el cron o el lanzador local.

## Piezas

| Pieza | Qué hace | Con qué está hecha |
|---|---|---|
| Panel del equipo | Bandeja, contactos, agenda, agentes, conocimiento, canales, informes y ajustes; instalable como PWA para usar la bandeja en el móvil | Next.js (App Router, Server Components), Tailwind v4 y shadcn/ui con las reglas de `DESIGN.md` (0015) |
| Asistente de arranque | Crea el primer propietario y deja el negocio listo en una instalación vacía | Next.js |
| Páginas públicas | Páginas legales y `/widget-demo` | Next.js |
| Chat web (widget) | Script que el negocio pega en su web; anónimo, con id de visitante; pregunta por sondeo | Script servido por `/widget.js` y una API propia con límites por IP, visitante y dominio |
| Inicio de sesión | Sesiones, contraseña, recuperación, verificación en dos pasos e invitaciones | Better Auth con el adaptador de Drizzle (0004) |
| Permisos | Decide si un usuario puede hacer algo con un dato concreto | Función pura `can()` con la tabla de roles de `docs/spec.md` |
| Acceso a datos | Consultas por tema que siempre reciben al usuario y comprueban sus permisos | Drizzle, solo en el servidor |
| Base de datos | Todo lo que guarda la app; sus tablas, en `docs/modelo-de-datos.md` | Postgres: la base integrada (PGlite, en `data/pglite`) en local y en las pruebas; Supabase en la app publicada (0024) |
| Adaptadores | Búsqueda vectorial, búsqueda de texto, cola, tiempo real, archivos y límites de peticiones | Postgres (pgvector, `tsvector`, tablas), disco o Supabase Storage |
| Canales | Un adaptador común por tipo (WhatsApp, Gmail, Outlook, IMAP/SMTP, chat web, Telegram): conectar, revisar, recibir, enviar y descargar medios | Clientes propios con `fetch`, ImapFlow y Nodemailer (0011, 0012); mailparser para leer los correos de los tres conectores y ffmpeg-static para convertir notas de voz (ver «Lectores de documentos y correo») |
| Simulador | Inyecta mensajes de WhatsApp, correo o web (texto, audio, imagen o documento) en cualquier canal; sus respuestas nunca salen de la app aunque el canal sea real | La misma entrada que los canales reales (`src/data/simulator.ts`), con las respuestas por `DemoAdapter` |
| Motor de respuesta | Decide si la IA contesta, prepara el prompt, llama al modelo con herramientas y envía una sola respuesta | Cliente propio de OpenRouter (0005) |
| Herramientas del agente | Buscar en el conocimiento, consultar huecos, crear o cambiar citas, guardar datos del contacto, pasar a una persona y herramientas HTTP del negocio | Funciones con esquema Zod que usan el acceso a datos |
| Conocimiento | Procesa documentos por pasos (extraer, trocear, embeddings) y busca de forma híbrida | unpdf (PDF), mammoth (DOCX), read-excel-file (XLSX), papaparse (CSV), Readability, linkedom y turndown (páginas web), Mistral OCR opcional, vectores de 1536 dimensiones en `halfvec` (0013) y la búsqueda de texto de Postgres con `es_unaccent` (ver «Lectores de documentos y correo» y `docs/busqueda-hibrida.md`) |
| Agenda | Calcula huecos libres y crea citas sin dobles reservas | Función pura de disponibilidad, `date-fns` con zona horaria |
| Trabajo en segundo plano | Cola de trabajos y `tick()` idempotente | Tabla `jobs` (0008) |
| Tiempo real | Avisa a las pantallas de lo que ha cambiado | Sondeo cada 3–5 s con cursor (0009) |
| Archivos | Guarda y sirve medios y documentos, siempre con permisos | Disco en local o el bucket privado `dominia-archivos` de Supabase Storage (0024) |
| Avisos | Avisos en la app, push y email al equipo | Web Push con claves VAPID y el SMTP del sistema |
| Cifrado de secretos | Cifra tokens, claves y contraseñas de servicios externos | AES-256-GCM con `APP_ENCRYPTION_KEY` |
| Cumplimiento | Aviso de IA, bajas, conservación y limpieza diaria, exportar y borrar datos de un contacto | Trabajos de la cola |
| Órdenes del proyecto | Preparación automática, demo, migraciones, lanzador local de `tick()` y worker del VPS | Scripts con pnpm (0006) |

### Lectores de documentos y correo

El encargo pide lectores de PDF, DOCX (mammoth), XLSX y CSV. Estos son los elegidos y por qué. Versiones y
fechas comprobadas en el registro de npm el 2026-09-26 (`https://registry.npmjs.org/<paquete>`); todas
cumplen el margen de 7 días de `docs/security.md` y ninguna tiene scripts de instalación salvo ffmpeg-static.
Como cualquier paquete, se instalan cuando se aprueba el plan de su fase.

| Para qué | Paquete | Por qué |
|---|---|---|
| Texto de los PDF, página a página | unpdf 1.8.1 (13-08-2026) | Devuelve el texto de cada página por separado, que es lo que necesita [CON-06] para citar la página; sin dependencias y activo. Un PDF escaneado devuelve texto vacío: entonces va a Mistral OCR ([CON-07]). Se prefirió a pdf-parse, sin versiones desde octubre de 2025. |
| DOCX | mammoth 1.12.3 (12-09-2026) | Lo pide el encargo. Convierte el documento a HTML conservando los encabezados, y de ahí pasa a Markdown con turndown para trocear por encabezados ([CON-10]). |
| XLSX | read-excel-file 9.3.10 (10-08-2026) | Lee todas las hojas como filas, lo justo para los bloques de unas 20 filas con cabeceras ([CON-08]). No se usa `xlsx` (SheetJS), cuya copia en npm está parada en 0.18.5 de 2022, ni exceljs, sin versiones desde 2023. Solo lee `.xlsx`: un `.xls` antiguo se rechaza con aviso ([CON-04]). |
| CSV | papaparse 5.7.0 (24-08-2026) | Maneja comillas, saltos de línea dentro de un campo y separadores distintos de la coma, que un `split` a mano rompe. |
| Páginas web a Markdown | @mozilla/readability 0.6.0 (03-03-2025), linkedom 0.18.13 (07-07-2026) y turndown 7.2.4 (03-04-2026) | Readability se queda con el contenido principal (sin menús ni pies), linkedom le da un DOM en el servidor sin navegador y turndown lo pasa a Markdown con sus encabezados ([CON-09]). |
| Correo entrante | mailparser 3.9.28 (15-09-2026) | Del proyecto Nodemailer. Decodifica juegos de caracteres, separa adjuntos y pasa el HTML a texto (con html-to-text) para [COR-19]. Gmail y Outlook también pasan por él, así hay un solo preprocesado (`docs/integracion-correo.md` §5). |
| Notas de voz a MP3 | ffmpeg-static 5.3.0 (14-11-2025) | Solo si el modelo de transcripción rechaza el OGG/Opus de WhatsApp ([MED-02]). Su instalación descarga el binario de FFmpeg y hay que aprobarla (0006). |

## Cómo viajan los datos

### Entrar y cada petición

1. La persona pone su email y su contraseña; Better Auth los comprueba y, si tiene verificación en dos pasos,
   pide el código antes de crear la sesión (una cookie).
   Entrar, el código de dos pasos, la recuperación y aceptar una invitación son Server Actions que llaman a
   Better Auth en el servidor, con límite de intentos por IP y por email, y anotan cada entrada en el registro de
   actividad.
2. En cada página, Server Action y ruta de la API, el servidor lee la sesión, carga el rol y los canales del
   usuario y forma el «actor». El proxy solo redirige al inicio de sesión si no hay cookie; no decide nada más.
3. El acceso a datos recibe al actor, pregunta a `can()` si puede y solo entonces lee o escribe con Drizzle.
   Devuelve solo los campos que necesita la pantalla.
4. Las cuentas nuevas solo nacen en el asistente de arranque, al aceptar una invitación (enlace de un solo uso
   que caduca a los 7 días) o con la demo.

### Un mensaje que llega

En WhatsApp, Meta llama a `/api/webhooks/whatsapp` (Telegram, después de la v1, tendrá su propia ruta y
comprobará un secreto en una cabecera en lugar de una firma):

1. Se lee el cuerpo en bruto y se comprueba su firma con los App Secret guardados antes de leerlo (decisión 0022);
   si ninguno la confirma, 401 y no se guarda nada.
2. Se localiza el canal por el número de destino, que tiene que ser uno cuyo propio App Secret firmó el aviso.
3. Se guarda el aviso en bruto (se borra pronto por conservación).
4. Se pasa a un formato común: mensaje entrante, cambio de estado o aviso de cuenta.
5. Se busca o se crea el contacto por su identidad en ese canal (BSUID o `wa_id`), nunca por el teléfono.
6. Se guarda el mensaje ignorando duplicados (el mismo canal y el mismo identificador externo).
7. Se deja un evento para las pantallas.
8. Se crea o se aplaza el trabajo de respuesta de esa conversación (4–8 s, hasta 20 s desde el primero).
9. Se responde 200 enseguida y, ya respondido, `after()` lanza `tick()`.

El chat web entra igual por su API (`/api/widget/<canal>/messages`), sin aviso en bruto que guardar: comprueba el
dominio, el token del visitante y los límites, guarda el mensaje por `ingestEvents()`, contesta y, ya contestado,
`after()` lanza `kickTick()`. El widget pregunta cada pocos segundos por lo nuevo de su conversación. El correo no avisa: un trabajo periódico por buzón (`email.poll`, cada minuto) pregunta
(`history.list` en Gmail, consulta delta en Outlook, UIDs nuevos en IMAP) y cada correo nuevo sigue desde el
paso 4, con sus filtros de boletines y respuestas automáticas. El simulador inyecta mensajes en los canales de
demo por el mismo camino, y lo que esos canales «envían» solo se guarda.

### La respuesta de la IA

1. `tick()` reclama el trabajo de respuesta y bloquea la conversación.
2. Comprueba que el canal tiene agente activo y la IA encendida, que la conversación está en modo IA y sin
   pausa, el modo pruebas, la ventana de 24 h de WhatsApp, las bajas, el horario y que hay clave de
   OpenRouter. Si algo falla, el mensaje espera a una persona.
3. Prepara la entrada: transcribe los audios y, si el modelo no ve imágenes, las describe otro modelo barato.
4. Monta el prompt de lo estable a lo variable: reglas de la plataforma, perfil del negocio, instrucciones del
   agente, archivos de contexto, datos del momento y los últimos mensajes.
5. Llama a OpenRouter con la conversación como sesión, sin que los proveedores guarden los datos, y con hasta 6
   pasos de herramientas. Las herramientas trabajan con el acceso a datos y solo sobre el contacto y el canal
   de esa conversación.
6. Si mientras tanto ha llegado otro mensaje, descarta la respuesta y se reprograma para contestar a todo junto.
7. Envía una sola respuesta por el adaptador del canal, o la deja como borrador si el canal está en modo
   borrador (el correo, por defecto).
8. Registra el uso (modelos, tokens, coste que indica OpenRouter, tiempo, herramientas), los fragmentos de
   conocimiento usados y el registro de actividad, y deja un evento para las pantallas.

Si la IA falla, se reintenta una vez; si vuelve a fallar, el cliente no recibe nada y la conversación queda
para una persona.

### Traspaso a una persona y avisos

La herramienta de traspaso, una regla o una persona pasa la conversación a «Pendiente de humano», manda al
cliente el mensaje configurado (distinto dentro y fuera de horario) y la asigna por turnos o la deja sin
asignar. Un trabajo de la cola avisa al equipo en la app, por push (si el servicio de push dice que la
suscripción ya no existe, se borra) y por email. Si una persona escribe desde la bandeja, la IA de esa
conversación se pausa (12 horas por defecto) y vuelve sola, salvo que alguien la reactive antes.

### Trabajo en segundo plano

`tick()` se lanza desde cuatro sitios: `after()` al contestar un aviso, `/api/cron/tick` (con el secreto del
cron, desde Supabase Cron cada minuto y el cron diario de Vercel), el lanzador de `pnpm dev` cada unos 15 s en local y
`pnpm worker` en bucle en el VPS (con la base en Supabase). Cada ronda reclama trabajos vencidos, los ejecuta mientras le quede tiempo y deja el resto
para la siguiente; si dos rondas coinciden, cada trabajo se hace una sola vez. El trabajo largo va por pasos y
los trabajos periódicos se vuelven a programar solos.

### Pantallas al día

La pantalla pregunta cada 3–5 s a `/api/realtime` qué ha pasado desde su último cursor. La ruta comprueba la
sesión y devuelve solo lo que ese usuario puede ver; la pantalla recarga lo afectado. Con la pestaña oculta deja
de preguntar.

### Archivos

Lo que sube el equipo se valida en el servidor (tipo, por su contenido, y tamaño) y se guarda con una clave
aleatoria: pasa por el servidor, que lo guarda en disco (en local) o en el bucket privado de Supabase Storage (en la
app publicada). En Vercel, los archivos de más de 4,5 MB tendrán que ir directos del navegador a Storage, con una
dirección firmada de subida que dé el servidor tras comprobar la sesión (pendiente). Los medios de los canales se
descargan en un trabajo nada más llegar. Todo se sirve por `/api/files/…`, que comprueba el permiso sobre ese archivo
concreto antes de devolverlo.

### Conocimiento

Un documento subido pasa por pasos en la cola, con su estado a la vista: extraer a Markdown con páginas,
trocear, calcular embeddings y quedar listo. Al buscar, se piden 40 resultados por significado (solo con clave
de OpenRouter: la pregunta necesita su embedding) y 40 por palabras (la búsqueda de texto de Postgres con
`es_unaccent`: sin tildes ni mayúsculas y con las raíces del español, así «tintes» encuentra «tinte»), se mezclan con
RRF (k = 60) y se quedan los 8 mejores (6 si está activada la reordenación de Ajustes > IA,
que vale para toda la instalación), con su título, sección y página. Sin clave, la búsqueda es solo por palabras. Si
nada es relevante, la respuesta es `SIN_RESULTADOS`.

El agente busca de dos formas ([AGE-07]): en «Automático», el modelo llama a `buscar_conocimiento` cuando lo necesita;
en «Buscar siempre», la app busca con las palabras del cliente antes de llamar al modelo y le pasa los fragmentos al
final del mensaje de sistema (así el principio del prompt no cambia y se aprovecha la caché). Los fragmentos usados se
guardan con la respuesta en `message_retrievals` (con copia del título, la sección y la página, por si el documento se
borra) y son los que enseña «¿Por qué respondió esto?».

### Citas

La herramienta de citas pide a la función de disponibilidad los huecos libres (horarios, ausencias, márgenes,
aforo y zona horaria del negocio) y, confirmada la cita con el cliente, la crea dentro de una transacción corta
que vuelve a comprobar que el hueco sigue libre. El historial de la cita queda en `booking_events`.

### Secretos

Las claves y tokens que se escriben en Ajustes o en los asistentes se cifran en el servidor antes de guardarse
y solo se descifran en el servidor en el momento de llamar al servicio. El navegador solo ve «••••1234», y los
logs nunca los muestran.

## Servicios externos

Todas sus direcciones base se pueden cambiar con variables de entorno, y las pruebas usan un simulador en su
lugar. Los detalles verificados están en los documentos de cada integración.

| Servicio | Para qué | Documento |
|---|---|---|
| OpenRouter | Chat de los agentes, transcripción, embeddings, rerank, catálogo de modelos y comprobar la clave | `docs/integracion-openrouter.md` |
| Meta (WhatsApp Cloud API, Graph v26.0) | Conectar números, recibir y enviar mensajes, medios, plantillas y estado del número | `docs/integracion-whatsapp.md`, `docs/integracion-whatsapp-mensajes.md` |
| Google (OAuth y API de Gmail) | Buzones de Gmail y Google Workspace del negocio | `docs/integracion-correo.md` |
| Microsoft (Entra y Graph) | Buzones de Outlook y Microsoft 365 del negocio | `docs/integracion-correo.md` |
| Servidores IMAP/SMTP | Buzones de otros proveedores y el correo del sistema (invitaciones, recuperación y avisos) | `docs/integracion-correo.md` |
| Mistral OCR (opcional) | Leer PDF escaneados, si el negocio pone su clave | `docs/integracion-mistral-ocr.md` |
| Telegram Bot API (opcional, después de la v1) | Canal de Telegram | `docs/integracion-telegram.md` |
| Servicios de push de los navegadores | Entregar los avisos push de la PWA | `docs/notificaciones-push.md` |
| Herramientas HTTP del negocio | Lo que el negocio conecte a sus agentes (n8n, un CRM…) | `docs/spec.md` |
| Al publicar: Vercel y Supabase (Postgres, Storage y Cron) | Alojar la app, la base de datos y los archivos, y lanzar `tick()` cada minuto | `docs/plataforma-despliegue.md`; los pasos, en `docs/guia-despliegue.md` y `vercel.json` (funciones en Londres, junto a la base, y cron diario) |
| En el futuro: Dokploy y GitHub | VPS propio e imágenes | `docs/plataforma-despliegue.md` |
