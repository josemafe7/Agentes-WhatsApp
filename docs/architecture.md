# Arquitectura

> Describe cómo está pensado el sistema según las decisiones de `docs/decisions/` (0001 a 0021) y qué hay ya
> construido. Las fases 0 (base), 1 (agentes y OpenRouter), 2 (bandeja, chat web y motor), 3 (WhatsApp) y 4
> (conocimiento) están hechas: «Lo que ya está construido» dice dónde vive cada pieza. Lo demás llega en las fases
> de `docs/spec.md` y se corrige aquí cuando se construya.

## Visión general

DominIA Agentes es una sola aplicación de Next.js que se instala una vez por negocio, con su propia base de
datos y sus propias credenciales (0001). Todo corre en Node (0002): las pantallas del equipo, la API a la que llaman
los canales, el chat web que el negocio pone en su web y el trabajo en segundo plano.

Las pantallas y las rutas son finas: validan lo que llega y piden el trabajo a dos capas de servidor. El acceso
a datos comprueba siempre quién pide qué (0004) y los servicios hacen el resto: canales, motor de respuesta,
conocimiento, agenda, avisos y cumplimiento. Lo que depende del motor de base de datos o del sitio donde se
publica va detrás de interfaces con adaptadores (búsqueda vectorial, búsqueda de texto, cola, tiempo real,
archivos y límites de peticiones), para que el mismo código sirva en local, en Vercel y en un VPS, hoy con
libSQL y mañana con Supabase (0003).

Nada lento ocurre mientras se atiende una petición: los avisos de los canales se guardan, se contesta enseguida
y la IA trabaja después, en una cola que avanza a trozos cortos (0008). La pantalla se entera de los cambios
preguntando cada pocos segundos (0009). Los servicios externos (OpenRouter, Meta, Google, Microsoft, servidores
de correo) se llaman con clientes propios cuya dirección base sale de una variable de entorno, para que las
pruebas usen un simulador y nunca los servicios reales.

## Lo que ya está construido (fases 0 a 4)

| Pieza | Dónde | Notas |
|---|---|---|
| Pantallas y rutas | `src/app/` | `(auth)/`: entrar, `/dos-pasos`, `/recuperar`, `/restablecer` e `/invitacion/[token]`. `(app)/`: el panel (`agentes/` desde la fase 1; `bandeja/`, `contactos/` y `canales/` desde la fase 2; `conocimiento/` desde la fase 4; Agenda e Informes aún sin contenido; `ajustes/*` completo con el simulador, `/perfil`, «Mi cuenta», y `/ayuda`, las guías de `docs/guia-*.md`, que `next.config.ts` añade a la compilación con `outputFileTracingIncludes`). `setup/`: el asistente. `legal/`: las tres páginas públicas. `widget-demo/`: la web de ejemplo con el chat. `api/`: `auth/[...all]`, `cron/tick`, `health`, `files/[...key]`, `realtime`, `widget/[channelId]/*`, `webhooks/whatsapp` (fase 3) y `knowledge/bases/[id]/files` (fase 4, subida de archivos al conocimiento). |
| Proxy | `src/proxy.ts` | Sin cookie de sesión, una página privada redirige a `/login?next=…`. Pasa la ruta pedida en la cabecera `x-dominia-path` (siempre la sobrescribe) para el layout del panel. No es la frontera de seguridad. |
| Arranque del servidor | `src/instrumentation.ts` | Sin una `APP_ENCRYPTION_KEY` válida la app no atiende peticiones y lo dice en el registro ([SEG-03]). |
| Sesión y actor | `src/server/session.ts`, `src/server/session-2fa.ts` | `getActor()` lee la sesión de Better Auth y el rol, los canales y el estado de la verificación en dos pasos de la base en cada petición. Las páginas usan `requirePageActor()`; las acciones y rutas, `requireActor()` o `requirePermission()`. El layout del panel usa `requireTwoFactorCompliance()`: propietarios y administradores sin verificación en dos pasos, cuando el negocio la exige, solo pueden abrir `/perfil`. |
| Rutas de entrada | `src/lib/auth-paths.ts` | Rutas públicas y `sanitizeNextPath()`, la única comprobación de a dónde se vuelve tras entrar: solo rutas de la app, sin barras invertidas ni trucos con `//` ni puntos. |
| Permisos | `src/lib/permissions.ts` | `PERMISSIONS` (38 acciones), `can(actor, acción, alcance)` y `channelFilter()`, con la tabla de roles de la especificación. |
| Acceso a datos | `src/data/` | Uno por tema: `settings`, `business`, `business-hours`, `notification-settings`, `users`, `invitations`, `setup` (y `setup-agent`, el paso 5 «Primer agente», que guarda el id del agente en `app_kv` › `setup.first_agent` para el paso 6), `activity`, `diagnostics`, `system-mail` y `audit`. Todos con `server-only`, reciben el actor y comprueban con `assertCan()` (`guard.ts`). |
| Base de datos | `src/db/` y `drizzle/` | 52 tablas en `src/db/schema/`. Migraciones `0000_initial` (generada), `0001_kb_search_indexes` (a medida: índice vectorial y FTS5), `0002_ai_runs_cached_tokens` (fase 1, añade una columna) y `0003_handoff_closed_at` (fase 2). Las fases 3 y 4 no cambiaron el esquema: WhatsApp y el conocimiento usan columnas y tablas que ya existían. `db` se abre en el primer uso, nunca al importar. |
| Adaptadores | `src/server/adapters/` | `job-queue`, `realtime`, `rate-limiter`, `file-storage` (disco o Vercel Blob), `text-search` (FTS5), `vector-search`, y `database-health`/`database-info` para Diagnóstico. Único sitio con SQL propio de SQLite. |
| Trabajo en segundo plano | `src/server/jobs/` | `tick()` y el registro de trabajos (`handlers/index.ts`): correos del sistema, `reply` (motor de respuesta), `conversation.summary` (resumen acumulado), `channel.demo_status`, `notifications.deliver`, los de WhatsApp (fase 3) y los del conocimiento (fase 4: `knowledge.process`, `knowledge.reindex`, `knowledge.sitemap`, `knowledge.embeddings` y `knowledge.refresh`, en `src/server/knowledge/jobs.ts`). Se lanza con `after()` + `kickTick()` desde la API del chat web y el simulador, con el cron (`/api/cron/tick`), con el lanzador de `pnpm dev` cada 15 s y con `pnpm worker`. |
| Usuarios | `src/server/auth.ts`, `src/server/accounts.ts` | Better Auth (email y contraseña, sin registro público, verificación en dos pasos, límite de peticiones en base de datos). Por HTTP solo responde a `get-session`, `sign-out` y el enlace de recuperación (`httpAllowlist`); el resto va por Server Actions con `auth.api.*`. Las cuentas solo se crean en `accounts.ts`: asistente (con el código de instalación `SETUP_TOKEN` al publicar), invitaciones y demo. |
| Correo del sistema | `src/server/mailer.ts`, `src/server/email-templates.ts` | SMTP de Ajustes › Correo del sistema, con el nombre, el logo y el color del negocio en cada correo ([AJU-01]). La contraseña guardada solo se envía al mismo servidor, puerto, seguridad y usuario. Sin SMTP, en local o con la demo, cada correo se guarda como `.eml` en `data/outbox/`; publicado, da un error claro. Todos quedan anotados para Diagnóstico. |
| Cifrado | `src/server/crypto.ts`, `src/server/redact.ts` | AES-256-GCM (`v1:iv:tag:texto`), máscara `••••1234` y limpieza de secretos en registros y errores. |
| Límites de peticiones | `src/server/client-ip.ts` y cada acción | Las Server Actions que llaman a `auth.api.*` (entrar, dos pasos, recuperar, invitación, Mi cuenta, asistente) cuentan sus intentos con el `RateLimiter`, por IP y por email o usuario; sus rutas HTTP de Better Auth están cerradas para que nadie se salte esos límites. Better Auth limita las pocas que siguen abiertas. |
| Demo y órdenes | `scripts/`, `seed/`, `src/lib/sectors/`, `src/server/demo/` | Preparación (`scripts/lib/setup.ts`), demo por sector (pasos en `seed/steps/`: negocio, usuarios, horario, agenda, agentes —recepción desde la plantilla del sector, correo y uno fuera de horario preparado sin activar—, canales —un chat web real y un WhatsApp y un correo «Demo», cada uno con su agente activo— y siete conversaciones con fechas relativas: reserva, nota de voz con transcripción, traspaso urgente pendiente, traspaso resuelto con nota, imagen con su descripción, preguntas frecuentes e hilo de correo con borrador, con sus `ai_runs`, traspasos y avisos—, WhatsApp —plantillas y tarifas de ejemplo— y conocimiento —la base «Información del negocio» ya procesada, ver «Demo del conocimiento»—), `db:reset`, `db:fresh`, `seed:embeddings`, worker y el lanzador de `pnpm dev` (`scripts/dev.mjs`). Los archivos de la demo (una nota de voz WAV, una imagen PNG por sector y el PDF de ejemplo del simulador) se generan en código (`seed/media/`), sin binarios en el repositorio. Los datos de cada sector son datos puros en `src/lib/sectors/`, que también usa el asistente. |
| Cliente de OpenRouter (fase 1) | `src/lib/openrouter/` | `createOpenRouterClient()`: clave, catálogo (`/models/user` y, si falla, `/models`), proveedores de un modelo y lista sin retención de datos, chat sin streaming, embeddings, transcripción y rerank. Valida cada respuesta con Zod, trata el 200 con `error` como error y convierte cada fallo en `OpenRouterError` con su mensaje en español. Siempre `data_collection: "deny"` en chat, embeddings y rerank. |
| IA del servidor (fase 1) | `src/server/ai/` | `models.ts` (catálogo normalizado, 12 h en `app_kv`, filtros y validación del modelo y su respaldo), `prompt.ts` (prompt puro de lo estable a lo variable; el nombre del cliente va en una sola línea y el resumen acumulado citado línea a línea como datos, para que nada del cliente pase por una regla) y `context.ts` (los datos del negocio que lo alimentan), `tools/` (herramientas con Zod, registro de actividad, `transferir_a_humano` y, desde la fase 4, `buscar_conocimiento`), `run-agent.ts` (una vuelta del agente con hasta 6 pasos, registrada en `ai_runs`; en «Buscar siempre» busca antes de llamar al modelo y añade los fragmentos al final del mensaje de sistema, y devuelve los fragmentos usados), `draft.ts` («Generar borrador con IA» desde una web o una descripción, que son datos entre marcas y nunca órdenes), `usage.ts` (suma de tokens y coste de varias llamadas), `openrouter.ts` (cliente con la clave de la instalación, modelos por defecto y respaldo de otro proveedor) y `limits.ts` (límites de lo que gasta IA). |
| Lectura segura de webs (fase 1) | `src/server/web-fetch.ts` | Lee una página pública y la pasa a Markdown (Readability, linkedom y turndown). Solo direcciones públicas, comprobadas también al conectar y en cada redirección, con tiempo, tamaño y tipos máximos (`docs/security.md`). Lo usan el borrador con IA y las páginas web y mapas del sitio del conocimiento. |
| Pantallas de agentes (fase 1) | `src/app/(app)/agentes/` | Lista, «Nuevo agente» (plantilla del sector, de otro sector, en blanco o borrador con IA) y el editor con una ruta por pestaña (`[id]/`, `instrucciones`, `modelo`, `conocimiento`, `herramientas`, `traspaso`, `canales`, `probar` y `versiones`). Cada pestaña guarda solo sus campos con `updateAgent`, que crea una versión; barra «Cambios sin guardar» y aviso al salir. El layout no es la frontera de seguridad: cada página vuelve a comprobar el permiso. |
| Probar agente (fase 1) | `src/app/(app)/agentes/[id]/probar/` | El navegador guarda la conversación de prueba y la envía entera en cada mensaje (como mucho 20 mensajes); el servidor no guarda conversaciones ni mensajes, solo la fila de `ai_runs` con `is_test`. Sin clave no llama a OpenRouter ni gasta el límite de peticiones. Al navegador solo llega lo que se ve (texto, modelo, tokens, coste, tiempo, herramientas), nunca ids internos ni la clave. |
| Selector de modelos (fase 1) | `src/components/model-picker/` | `<ModelPicker kind>` para chat, transcripción, embeddings y visión, con búsqueda, recomendados, precios por millón y iconos. Pide la lista una vez por tipo y página (Server Actions con permiso y Zod) y reutiliza los filtros de `src/server/ai/models.ts`. Sin clave se desactiva y no pregunta a OpenRouter. Lo usan la pestaña Modelo y Ajustes › IA, que comprueba en el servidor los modelos por defecto y prueba de verdad un modelo de embeddings nuevo (1536 dimensiones). |
| Traspaso | `src/server/handoff/` | Contrato `HandoffService` e implementación (`service.ts`, fase 2), que se registra al importarse: «Pendiente de humano», IA parada, asignación por turnos (puntero por canal en `app_kv` › `handoff.round_robin:<canal>`) o sin asignar según Ajustes, `handoff_events` y avisos. Pedirlo otra vez mientras espera a una persona no cambia nada. Termina con la primera respuesta de una persona (que mide su tiempo) o, sin respuesta, al resolver la conversación o reactivar la IA (`closeOpenHandoffs()`, `handoff_events.closed_at`): entonces deja de destacarse y una respuesta posterior no cuenta como la suya. El mensaje al cliente lo envía quien lo pide, como la única respuesta del turno. «Probar agente» solo lo simula. |
| Canales (común, fase 2) | `src/server/channels/` | `ChannelAdapter` (capacidades, conectar, revisar, avisos → eventos comunes, enviar, descargar medios, leídos, «escribiendo…», desconectar) y el registro por tipo. Los canales de demo de WhatsApp y correo usan `DemoAdapter`, que nunca llama fuera: guarda lo que «envía» y simula «entregado» y «leído» con trabajos `channel.demo_status`. El chat web usa `WebchatAdapter` (enviar = guardar; el widget lo lee por sondeo). Las respuestas a mensajes del simulador van siempre por `DemoAdapter`, aunque el canal sea real. Secretos del canal: `secrets.ts`. La revisión periódica de cada canal ([CAN-15]) llega con los canales que se conectan a un servicio: WhatsApp en la fase 3 (cada 6 h) y el correo en la 6; el chat web y los de demo no dependen de nadie (`healthCheck` solo mira su configuración). El chat web no recibe avisos: `handleWebhook` lo rechaza y sus mensajes entran por su propia API. |
| Entrada de mensajes (fase 2) | `src/server/inbound/` | `ingestEvents()`: aviso en bruto (si viene de un webhook), contacto e identidad (nunca por teléfono), mensaje una sola vez, conversación (una por canal y contacto; una por hilo en correo; se reabre y vuelve a la IA), no leídos, eventos para las pantallas y trabajo `reply` agrupado (`src/server/engine/schedule.ts`: 4–8 s, hasta 20 s desde el primero; `REPLY_DEBOUNCE_MS` fija la espera solo en pruebas). Nunca llama a la IA. `kickTick()` lanza `tick()` con `after()` cuando vence la respuesta. Estados de entrega que solo avanzan: `status.ts`. |
| Motor de respuesta (fase 2) | `src/server/engine/` | Trabajo `reply` (`reply.ts`): un «alquiler» por conversación en `app_kv` (`reply.lease:<conversación>`) para no preparar dos respuestas a la vez; si llega otro mensaje del cliente, espera (nunca a una hora ya pasada) o descarta y vuelve a empezar. Solo cuentan los mensajes del cliente (`pending.ts`): los del sistema de un canal no son un turno. Comprobaciones puras (`checks.ts`; el modo pruebas compara solo lo que da el canal, `testModeIdentifiers()`, nunca lo que el visitante escribe en el formulario del chat web); las notas de voz se transcriben antes que nada, conteste o no la IA (así las reglas las leen y el equipo ve la transcripción); reglas de traspaso del agente (`rules.ts`: palabras clave, temas sensibles y «no lo sé»), entrada del modelo con `src/server/media/prepare.ts` dentro del tiempo del trabajo, `runAgent` en modo `live`, aviso de IA delante del primer mensaje de la IA (`disclosure.ts`) y una sola respuesta (o un borrador en «Borrador para revisar»). Si la IA falla dos veces, la conversación pasa a una persona sin enviar nada al cliente, y el fallo se ve en Ajustes › Diagnóstico › «Errores recientes de la IA» (los `ai_runs` fallidos que no son de «Probar agente»). Resumen acumulado (`summary.ts`, [MOT-13]): cuando 10 mensajes quedan fuera de los 20 que lee el modelo, el trabajo `conversation.summary` los resume con el modelo de chat de Ajustes (`conversations.summary` y `metadata.summaryUntil`); la respuesta lee el resumen y todo lo que aún no está en él. |
| Envío (fase 2) | `src/server/outbound/send.ts` | Todo lo que sale: se guarda «en cola» (o borrador), se entrega por el adaptador, se reintenta una vez si el error es pasajero y queda «fallido» con su error en español si no. `sendDraft()` envía un borrador aprobado (tal cual o editado) una sola vez aunque dos personas lo aprueben a la vez. |
| Medios (fase 2) | `src/server/media/` | `storeInboundMedia()` guarda lo que llega (clave generada, tipo, tamaño, SHA-256, nombre y duración en `messages.media`; límites en `limits.ts`). `prepareMessagesForModel()` prepara la entrada del modelo en el trabajo `reply`: audios transcritos una vez con el modelo de Ajustes › IA en español (tal cual; si lo rechaza, a MP3 con FFmpeg, `ffmpeg.ts`; si no, el modelo de respaldo, `transcribe.ts`, solo si todos sus proveedores están en la lista sin retención de OpenRouter, decisión 0018), con la transcripción guardada en el mensaje o `metadata.transcriptionFailed`; imágenes tal cual si el modelo las ve o descritas una vez por el modelo de visión (`describe-image.ts`, `metadata.imageDescription`); PDF como archivo si el modelo los abre o como texto (`pdf.ts`, unpdf); el resto, solo nombrado. Cada llamada queda en `ai_runs` con su coste. Nunca lee un archivo que otra conversación también usa. |
| Avisos al equipo (fase 2) | `src/server/notifications/` | `notify()`: avisos en la app al momento y, por la cola (`notifications.deliver`), email con el correo del sistema y push (enganche vacío hasta la fase de la PWA), según Ajustes › Notificaciones y las preferencias de cada persona; los Agentes solo de sus canales. |
| Tiempo real (fase 2) | `src/server/realtime/events.ts`, `src/app/api/realtime/` | Eventos con tipo (`conversation.updated`, `message.created`, `message.status`, `notification.created`) solo con ids, en los temas `channel:<id>`, `user:<id>` y `widget:<conversación>`. `GET /api/realtime?cursor=` exige sesión y devuelve solo lo que esa persona puede ver. |
| Bandeja, contactos y canales: datos (fase 2) | `src/data/conversations.ts`, `conversation-actions.ts`, `conversation-scope.ts`, `messages.ts`, `notes.ts`, `message-sources.ts`, `contacts.ts`, `channels.ts`, `webchat-logo.ts`, `setup-webchat.ts`, `simulator.ts`, `notifications.ts` | Lista con filtros y contadores, conversación, IA encendida, apagada o en pausa, traspaso a mano, estado, asignar y tomar, etiquetas, leída, agente de la conversación, respuestas de personas (pausan la IA las horas de Ajustes y miden la primera respuesta), adjuntos de la bandeja (imágenes y PDF por su contenido, hasta 3,5 MB, si el canal los admite), borradores de la IA (aprobar, editar o descartar), notas, fuentes de las respuestas, contactos básicos (un Agente limitado a sus canales no crea contactos a mano: no los vería), canales (chat web y ajustes comunes, agente activo, miembros; el logo del chat solo cambia subiendo un archivo, nunca por su clave), el chat web del paso 6 del asistente, el simulador y avisos propios. Todas con actor, permiso y canales del Agente; una conversación inexistente o ajena responde «sin permiso». |
| Chat web (widget, fase 2) | `public/widget.js`, `src/app/api/widget/[channelId]/*`, `src/server/channels/webchat/`, `src/app/widget-demo/`, `src/components/webchat/widget-embed.tsx` | Script sin dependencias (ES2019) que dibuja el chat en un Shadow DOM abierto, con el color, el logo y los textos del canal, accesible con teclado y lector de pantalla (las respuestas nuevas se leen en una región `aria-live` aparte de la lista «Mensajes») y adaptado al móvil. API propia: `config`, `session` (el servidor crea el visitante y firma su token), `messages` (enviar y sondear), `upload` (imágenes y notas de voz comprobadas por su contenido, hasta 4 MB, guardadas con `storeInboundMedia`), `media` y `logo`. Cada ruta comprueba el canal, el dominio permitido (CORS sin `*`), el canal desactivado, el token y los límites por IP y visitante. El visitante solo lee su propia conversación. `/widget-demo` lo carga como lo pegaría el negocio (con `?canal=` para elegir chat), y el paso 6 del asistente también. |
| Bandeja, contactos, canales y simulador: pantallas (fase 2) | `src/app/(app)/bandeja/`, `contactos/`, `canales/`, `ajustes/diagnostico/simulador/`, `src/hooks/use-realtime.ts`, `src/components/notifications/`, `src/components/app-shell/inbox-unread.tsx`, `src/components/channels/channel-identity.tsx` | Bandeja con la lista siempre montada en el layout y la conversación al lado (en el móvil, pantallas separadas), filtros en la URL, cabecera con el interruptor de IA, traspaso, estado, asignación, etiquetas y agente, mensajes con autor, canal y estado de entrega, notas, fuentes, borradores con «Aprobar y enviar», «Editar» y «Descartar», y el cuadro de escribir con adjuntos. Un solo sondeo por pestaña a `/api/realtime` (`useRealtime`) para la lista, la conversación, la campana de avisos y el contador de no leídos del menú: cada 3–4 s, cada 5 s sin actividad (nunca más con la pestaña a la vista, [BAN-03]), nada con la pestaña oculta y hasta 30 s solo si falla la conexión. Contactos: lista y ficha. Canales: lista con agente activo e IA, «Añadir canal», asistente del chat web con vista previa y el panel de cada canal. Simulador en Ajustes › Diagnóstico. La identidad de cada tipo de canal (icono, nombre y color) es una sola, compartida por todas las pantallas. |
| Agentes (fase 1) | `src/data/agents.ts`, `src/data/agent-channels.ts`, `src/lib/agent-input.ts`, `src/lib/agent-tools.ts` | Alta en blanco o desde la plantilla del sector, edición por pestañas con versión en cada guardado, restaurar, duplicar, borrar (con confirmación si está activo en canales), avatar y «Activo aquí» por canal. Los modelos nuevos salen de Ajustes › IA con un respaldo de otro proveedor (`defaultFallbackFor`, compartido con la demo). |
| Primer agente del asistente (fase 1) | `src/app/setup/_steps/agent-*.tsx`, `src/data/setup-agent.ts` | Paso 5: la plantilla del sector (o el borrador generado desde la web del negocio si hay clave) con nombre, tono, instrucciones y preguntas frecuentes editables; volver al paso edita el mismo agente. |
| Cliente de Meta (fase 3) | `src/lib/meta/` | `createMetaGraphClient()` (`client.ts`): la Graph API con la versión de cada canal en cada ruta (`v26.0` por defecto, `versions.ts`), el token del usuario del sistema como `Bearer` y el token de app solo en `debug_token` y `/{APP_ID}/subscriptions`; descarga archivos solo de Meta o del origen de `META_GRAPH_BASE_URL`. `errors.ts`: cada código de la tabla de `docs/integracion-whatsapp.md` §12 con su mensaje en español y qué hacer (`MetaGraphError`, nunca con el token ni la URL). `signature.ts` (firma HMAC-SHA256 en tiempo constante), `webhook.ts` (esquemas Zod de los avisos), `messages.ts` y `templates.ts` (cuerpos de envío y plantillas con variables con nombre o posición), `window.ts` (ventana de 24 h, que un 131047 cierra hasta que el cliente vuelve a escribir), `markets.ts` (mercado por el prefijo o por el país del BSUID) y `pricing.ts` (coste estimado y nombres en español de las categorías de Meta). Todo puro salvo el cliente. |
| Canal de WhatsApp (fase 3) | `src/server/channels/whatsapp/` | `WhatsAppAdapter` (registrado en `registry.ts`): validar y conectar (`connect.ts`: número, `debug_token` —solo un token de usuario del sistema, decisión 0019— y WABA), revisar (`health.ts`: 11 semáforos), avisos → eventos comunes (`normalize.ts`: todos los tipos; reacciones, «no admitido» y cambios de identidad sin turno de la IA: los dos últimos se guardan como mensajes del sistema), enviar (`send.ts`: a `+wa_id` o al BSUID, nunca a los dos; reintentos con esperas crecientes y error final en español), leídos y «escribiendo…», descargar archivos y desconectar. Secretos cifrados en `secrets_enc` (`config.ts`). `webhook.ts`: `processWhatsAppWebhook()` busca los canales por `phone_number_id` (los avisos de cuenta, por la WABA), comprueba la firma con el App Secret de cada candidato, guarda el aviso en bruto, aplica los cambios de identidad, los estados (`statuses.ts`: coste del primer `pricing`, aviso de método de pago y de envío fallido), une BSUID y `wa_id` (`identity.ts`), aplica los avisos de cuenta (`account-events.ts`) y programa las descargas. Trabajos (`jobs.ts`): `wa.media_download` (tiene el «alquiler» de la respuesta mientras descarga y transcribe las notas de voz), `wa.health_check` (cada 6 h y tras los avisos de Meta), `wa.templates_sync` y `wa.status_retry`. `demo.ts`: los estados simulados de un número de demo llevan el `pricing` que daría Meta. |
| Aviso de WhatsApp (fase 3) | `src/app/api/webhooks/whatsapp/route.ts` | Una sola dirección por instalación, hecha con `APP_URL`. GET: responde el `challenge` de Meta si el token de verificación de la instalación (cifrado en `integration_settings`) coincide; si no, 403. POST: lee los bytes tal cual (hasta 3 MB; 413 si pasa), límite de 1.800 por minuto e IP y otro de 60 respuestas rechazadas (400, 401 o 413) por minuto e IP (429), 400 antes de tocar la base de datos si trae más de 1.000 actualizaciones o más de 100 números o cuentas (decisión 0020), 401 con una firma mala sin guardar nada, 200 para un número que no es de ningún canal; después, `after()` + `kickTick()`. Nunca llama a la IA. |
| WhatsApp: datos (fase 3) | `src/data/whatsapp.ts`, `whatsapp-activation.ts`, `whatsapp-panel.ts`, `whatsapp-templates.ts`, `whatsapp-send.ts`, `whatsapp-pricing.ts`, `whatsapp-account-alerts.ts` | Validar y conectar (reutiliza el App Secret de otro número de la misma app; nunca dos veces el mismo número), suscripción de la app y de la WABA, registro con PIN (10 intentos cada 72 h), códigos de verificación, diagnóstico guiado, panel (secretos enmascarados solo para propietario y administrador), cambiar token, App Secret o versión (solo si Meta los valida), desconectar, plantillas (sincronizar y el mensaje de una plantilla aprobada, `templateMessageOf()`, que usan la bandeja y `sendTemplateMessage()` para los recordatorios), la ventana y las plantillas de cada conversación, las tarifas de Ajustes › WhatsApp y el historial de avisos de Meta. Todas con actor y permiso; plantillas, códigos y validaciones con Meta llevan límite por persona (`whatsapp-limits.ts`). |
| WhatsApp: pantallas (fase 3) | `src/app/(app)/canales/nuevo/whatsapp/`, `canales/[id]/_whatsapp/`, `bandeja/[id]/_whatsapp/`, `ajustes/whatsapp/` | Asistente de 6 pasos (Aviso, Datos, Webhook, Activar, Prueba y Agente) que se retoma donde se dejó (`?canal=…&paso=…`), con «¿Dónde lo encuentro?» y enlaces a `/ayuda/whatsapp#…`. Panel del número en el Resumen del canal (semáforos, credenciales enmascaradas, modo pruebas, ajustes de envío, plantillas, avisos de Meta y límites; «Continuar configuración» o «Volver a conectar» si el número está a medias o desconectado). En la bandeja, la ventana de 24 h, «Elegir plantilla» con sus variables y vista previa, y el coste estimado de cada mensaje enviado. Ajustes › WhatsApp: tarifas por mercado y categoría, y la dirección y el token de avisos para copiar. |
| Cliente de Mistral OCR (fase 4) | `src/lib/mistral/ocr.ts` | `createMistralClient()`: `POST /v1/ocr` con el PDF como data URL (cabeceras y pies aparte, sin tablas en HTML) y la comprobación de la clave. Errores con su mensaje en español (`MistralError`), nunca con la clave. Solo se usa si el negocio pone su clave en Ajustes › IA. |
| Conocimiento: servicio (fase 4) | `src/server/knowledge/` | Entrada única `index.ts`. `extract/`: tipo real por extensión y contenido, PDF página a página (unpdf) o por OCR en tandas de 20 páginas, DOCX (mammoth → turndown), XLSX y CSV en bloques de 20 filas con cabecera, texto (UTF-8 o Windows-1252), páginas web y mapas del sitio (con `web-fetch.ts`). `pages.ts`: el Markdown de un PDF lleva `<!-- página N -->` delante de cada página. `chunking.ts`: fragmentos por encabezados de unos 400 tokens (150–600) con 60 de solape, sin partir filas de tabla, con sección y página, y el texto exacto que se embebe (prefijo «Documento: título > sección» y resumen). `ingest.ts`: `processDocument()`, la máquina de pasos (en cola → extrayendo → troceando → embeddings → listo o error) que avanza lo que cabe en cada ronda. `embeddings.ts` (lotes de 96, siempre 1536, en `ai_runs`), `summary.ts` (resumen de 2 frases con el modelo de chat, o las 2 primeras frases sin clave), `reindex.ts` (versión nueva del índice que se construye aparte y se estrena de golpe), `search.ts` y `rrf.ts` (búsqueda híbrida, ver «Conocimiento» más abajo), `maintenance.ts` (embeddings pendientes, refresco de webs, páginas del mapa del sitio), `agent-knowledge.ts` (las bases de cada agente, «Buscar siempre»), `fixtures.ts` (embeddings guardados de la demo) y `queue.ts` y `jobs.ts` (los cinco trabajos). Todos los números con nombre, en `constants.ts`. |
| Conocimiento: datos (fase 4) | `src/data/knowledge.ts`, `knowledge-documents.ts`, `knowledge-search.ts`, `knowledge-faq.ts`, `knowledge-context-files.ts`, `knowledge-retrievals.ts`, `message-reason.ts` | Bases (crear, cambiar, borrar escribiendo el nombre, reindexar, cambiar el modelo, reindexar todas desde Ajustes › IA) y las bases de cada agente; documentos (archivo, web con mapa del sitio y refresco, pregunta frecuente, texto; reprocesar y borrar con sus fragmentos y su archivo; un archivo idéntico se rechaza); «Probar búsqueda» (20 por minuto y persona); «Convertir en FAQ» desde la respuesta de una persona; archivos de contexto del agente (tope de 30.000 tokens); los fragmentos de cada respuesta (`message_retrievals`) y «¿Por qué respondió esto?» (`getMessageReason`: fragmentos y herramientas de la respuesta). Todas con actor, permiso y Zod. `canViewKnowledgeFile()` deja a `/api/files` servir los originales (Conocimiento: `knowledge.view`; archivos de contexto: `agents.view`). |
| Conocimiento: pantallas (fase 4) | `src/app/(app)/conocimiento/`, `src/app/api/knowledge/bases/[id]/files/`, `src/app/(app)/agentes/[id]/conocimiento/`, `src/app/(app)/bandeja/[id]/_sources/`, `src/app/(app)/agentes/[id]/probar/` | Lista de bases, cada base con Documentos, Preguntas frecuentes, Probar búsqueda y Ajustes, y la página de cada documento con sus fragmentos; la página se recarga sola cada 4 s mientras algo se procesa. La pestaña Conocimiento del agente (archivos de contexto con su barra de tokens, bases con «Usar» y el modo). En la bandeja, «Ver fuentes» abre «¿Por qué respondió esto?» y «Convertir en FAQ» bajo la respuesta de una persona. «Probar agente» enseña la base de cada fragmento. Las acciones que dejan trabajo en la cola lo lanzan al momento con `kickTick()`. |
| Páginas legales (fase 3) | `src/app/legal/` | `/legal/privacidad`, `/legal/terminos` y `/legal/eliminacion-datos`, públicas, con los datos del negocio y los textos por defecto: Meta pide sus direcciones para publicar la app ([CUM-08]). |
| Pruebas | `src/**/*.test.ts`, `scripts/**/*.test.ts`, `e2e/` | Ver `docs/testing.md`. |

Detalles que salieron al construir y que conviene saber:

- **Claves foráneas:** el libSQL local (`@libsql/client` 0.18) las aplica en cada conexión. Aun así ningún borrado
  depende de cascadas: el código borra antes los datos dependientes.
- **Bloqueos de SQLite:** con el cliente local, una espera síncrona de bloqueo puede dejar colgado el proceso
  cuando una transacción espera a otra del mismo proceso. Por eso no se usa y `src/db/busy-retry.ts` reintenta
  sin bloquear durante 15 s. Las transacciones son cortas, usan solo `tx` y nunca llaman a servicios externos.
- **WAL:** lo activan las migraciones (`src/db/migrate.ts`), no el cliente.
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
  cuando alguien abre un selector o un agente responde y tiene más de 12 h. Los avisos de modelos que se retiran
  o desaparecen ([MOD-06]) solo leen esa copia, nunca llaman a OpenRouter al pintar una página. Si la descarga
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
  voz con su transcripción.
- **Demo de WhatsApp:** el número de demo trae sus plantillas sincronizadas (dos aprobadas) y Ajustes › WhatsApp,
  tarifas de ejemplo para España marcadas «ejemplo» (`seed/steps/whatsapp.ts`); una plantilla enviada desde la
  bandeja sale por `DemoAdapter` y su «entregado» simulado trae el `pricing` que daría Meta, así que se ve su coste
  estimado sin llamar a Meta.
- **Subidas al conocimiento:** los archivos van por su propia ruta, `/api/knowledge/bases/[id]/files` (el cuerpo es
  el archivo y su nombre va en la cabecera `x-file-name`), que comprueba el origen, la sesión, el permiso, 60 altas
  por persona cada 10 minutos y los 25 MB antes de leerlo entero. No va por una Server Action porque estas admiten
  4 MB (`next.config.ts`) y porque `src/proxy.ts`, que sí pasa por las páginas, solo conserva los primeros 10 MB de
  un cuerpo. En Vercel el límite de 4,5 MB por petición manda: subir directo del navegador a Blob (lo que pide
  `docs/plataforma-despliegue.md`) queda para cuando se publique. Los archivos de contexto de un agente, más
  pequeños, van por Server Action (hasta 3,5 MB).
- **Estados del conocimiento:** «Listo (solo texto)» no se guarda: es un documento listo con fragmentos del índice en
  uso sin embedding (`documentsWithPendingEmbeddings()`). Sin clave de OpenRouter, o si OpenRouter rechaza la clave,
  un documento queda listo para buscar por palabras y el trabajo `knowledge.embeddings` rellena los embeddings
  después: se programa al guardar una clave en Ajustes › IA (al momento), al terminar un documento sin clave y cada
  10 minutos mientras siga sin clave. Si la clave se pone solo en `.env.local`, nada lo lanza: «Reindexar» en la base
  los calcula.
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
- **IP del cliente:** la de más a la derecha de `x-forwarded-for` (la que añade el proxy de delante: Vercel o
  Traefik). Si `next start` se expone sin proxy, un cliente podría cambiarla para esquivar los límites por IP; el
  límite por email sigue funcionando.

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
| Base de datos | Todo lo que guarda la app; sus tablas, en `docs/modelo-de-datos.md` | libSQL: archivo en local, Turso al publicar; Supabase en el futuro (0003) |
| Adaptadores | Búsqueda vectorial, búsqueda de texto, cola, tiempo real, archivos y límites de peticiones | libSQL (vectores, FTS5, tablas), disco o Vercel Blob |
| Canales | Un adaptador común por tipo (WhatsApp, Gmail, Outlook, IMAP/SMTP, chat web, Telegram): conectar, revisar, recibir, enviar y descargar medios | Clientes propios con `fetch`, ImapFlow y Nodemailer (0011, 0012); mailparser para leer los correos de los tres conectores y ffmpeg-static para convertir notas de voz (ver «Lectores de documentos y correo») |
| Simulador | Inyecta mensajes de WhatsApp, correo o web (texto, audio, imagen o documento) en cualquier canal; sus respuestas nunca salen de la app aunque el canal sea real | La misma entrada que los canales reales (`src/data/simulator.ts`), con las respuestas por `DemoAdapter` |
| Motor de respuesta | Decide si la IA contesta, prepara el prompt, llama al modelo con herramientas y envía una sola respuesta | Cliente propio de OpenRouter (0005) |
| Herramientas del agente | Buscar en el conocimiento, consultar huecos, crear o cambiar citas, guardar datos del contacto, pasar a una persona y herramientas HTTP del negocio | Funciones con esquema Zod que usan el acceso a datos |
| Conocimiento | Procesa documentos por pasos (extraer, trocear, embeddings) y busca de forma híbrida | unpdf (PDF), mammoth (DOCX), read-excel-file (XLSX), papaparse (CSV), Readability, linkedom y turndown (páginas web), Mistral OCR opcional, vectores de 1536 dimensiones (0013) y FTS5 (ver «Lectores de documentos y correo») |
| Agenda | Calcula huecos libres y crea citas sin dobles reservas | Función pura de disponibilidad, `date-fns` con zona horaria |
| Trabajo en segundo plano | Cola de trabajos y `tick()` idempotente | Tabla `jobs` (0008) |
| Tiempo real | Avisa a las pantallas de lo que ha cambiado | Sondeo cada 3–5 s con cursor (0009) |
| Archivos | Guarda y sirve medios y documentos, siempre con permisos | Disco o Vercel Blob privado (0010) |
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

1. Se lee el cuerpo en bruto y se localiza el canal por el número de destino.
2. Se comprueba la firma con el App Secret de ese canal; si no cuadra, se rechaza.
3. Se guarda el aviso en bruto (se borra pronto por conservación).
4. Se pasa a un formato común: mensaje entrante, cambio de estado o aviso de cuenta.
5. Se busca o se crea el contacto por su identidad en ese canal (BSUID o `wa_id`), nunca por el teléfono.
6. Se guarda el mensaje ignorando duplicados (el mismo canal y el mismo identificador externo).
7. Se deja un evento para las pantallas.
8. Se crea o se aplaza el trabajo de respuesta de esa conversación (4–8 s, hasta 20 s desde el primero).
9. Se responde 200 enseguida y, ya respondido, `after()` lanza `tick()`.

El chat web entra igual por su API (`/api/widget/<canal>/messages`), sin aviso en bruto que guardar: comprueba el
dominio, el token del visitante y los límites, guarda el mensaje por `ingestEvents()`, contesta y, ya contestado,
`after()` lanza `kickTick()`. El widget pregunta cada pocos segundos por lo nuevo de su conversación. El correo no avisa: un trabajo periódico pregunta en cada ronda
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
cron, desde Vercel Cron o un cron externo), el lanzador de `pnpm dev` cada unos 15 s en local y `pnpm worker`
en bucle en el VPS. Cada ronda reclama trabajos vencidos, los ejecuta mientras le quede tiempo y deja el resto
para la siguiente; si dos rondas coinciden, cada trabajo se hace una sola vez. El trabajo largo va por pasos y
los trabajos periódicos se vuelven a programar solos.

### Pantallas al día

La pantalla pregunta cada 3–5 s a `/api/realtime` qué ha pasado desde su último cursor. La ruta comprueba la
sesión y devuelve solo lo que ese usuario puede ver; la pantalla recarga lo afectado. Con la pestaña oculta deja
de preguntar.

### Archivos

Lo que sube el equipo se valida en el servidor (tipo, por su contenido, y tamaño) y se guarda con una clave
aleatoria: hoy pasa por el servidor, que lo guarda en disco o en Blob; cuando la app esté en Vercel, los archivos
grandes irán directos del navegador a Blob, con un permiso que da el servidor tras comprobar la sesión. Los medios de los canales se descargan en un trabajo nada más llegar. Todo se sirve por `/api/files/…`,
que comprueba el permiso sobre ese archivo concreto antes de devolverlo.

### Conocimiento

Un documento subido pasa por pasos en la cola, con su estado a la vista: extraer a Markdown con páginas,
trocear, calcular embeddings y quedar listo. Al buscar, se piden 40 resultados por significado (solo con clave
de OpenRouter: la pregunta necesita su embedding) y 40 por palabras (FTS5 sin tildes ni mayúsculas, con prefijos y
plurales), se mezclan con RRF (k = 60) y se quedan los 8 mejores (6 si está activada la reordenación de Ajustes > IA,
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
| Al publicar: Vercel, Vercel Blob, Turso y un cron externo | Alojar la app, los archivos y la base de datos, y lanzar `tick()` cada minuto | `docs/plataforma-despliegue.md`; los pasos, en `docs/guia-despliegue.md` y `vercel.json` (región UE y cron diario) |
| En el futuro: Supabase, Dokploy y GitHub | Base de datos y archivos en Postgres, VPS propio e imágenes | `docs/plataforma-despliegue.md`, `docs/busqueda-hibrida.md` |
