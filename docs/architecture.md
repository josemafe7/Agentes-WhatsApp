# Arquitectura

> Describe cómo está pensado el sistema según las decisiones de `docs/decisions/` (0001 a 0015) y qué hay ya
> construido. La fase 0 (base) está hecha: «Lo que ya está construido» dice dónde vive cada pieza. Lo demás llega
> en las fases de `docs/spec.md` y se corrige aquí cuando se construya.

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

## Lo que ya está construido (fase 0)

| Pieza | Dónde | Notas |
|---|---|---|
| Pantallas y rutas | `src/app/` | `(auth)/`: entrar, `/dos-pasos`, `/recuperar`, `/restablecer` e `/invitacion/[token]`. `(app)/`: el panel (las 7 secciones aún sin contenido, `ajustes/*` completo, `/perfil`, «Mi cuenta», y `/ayuda`, las guías de `docs/guia-*.md`, que `next.config.ts` añade a la compilación con `outputFileTracingIncludes`). `setup/`: el asistente. `legal/`: las tres páginas públicas. `api/`: `auth/[...all]`, `cron/tick`, `health` y `files/[...key]`. |
| Proxy | `src/proxy.ts` | Sin cookie de sesión, una página privada redirige a `/login?next=…`. Pasa la ruta pedida en la cabecera `x-dominia-path` (siempre la sobrescribe) para el layout del panel. No es la frontera de seguridad. |
| Arranque del servidor | `src/instrumentation.ts` | Sin una `APP_ENCRYPTION_KEY` válida la app no atiende peticiones y lo dice en el registro ([SEG-03]). |
| Sesión y actor | `src/server/session.ts`, `src/server/session-2fa.ts` | `getActor()` lee la sesión de Better Auth y el rol, los canales y el estado de la verificación en dos pasos de la base en cada petición. Las páginas usan `requirePageActor()`; las acciones y rutas, `requireActor()` o `requirePermission()`. El layout del panel usa `requireTwoFactorCompliance()`: propietarios y administradores sin verificación en dos pasos, cuando el negocio la exige, solo pueden abrir `/perfil`. |
| Rutas de entrada | `src/lib/auth-paths.ts` | Rutas públicas y `sanitizeNextPath()`, la única comprobación de a dónde se vuelve tras entrar: solo rutas de la app, sin barras invertidas ni trucos con `//` ni puntos. |
| Permisos | `src/lib/permissions.ts` | `PERMISSIONS` (38 acciones), `can(actor, acción, alcance)` y `channelFilter()`, con la tabla de roles de la especificación. |
| Acceso a datos | `src/data/` | Uno por tema: `settings`, `business`, `business-hours`, `notification-settings`, `users`, `invitations`, `setup`, `activity`, `diagnostics`, `system-mail` y `audit`. Todos con `server-only`, reciben el actor y comprueban con `assertCan()` (`guard.ts`). |
| Base de datos | `src/db/` y `drizzle/` | 52 tablas en `src/db/schema/`. Migraciones `0000_initial` (generada) y `0001_kb_search_indexes` (a medida: índice vectorial y FTS5). `db` se abre en el primer uso, nunca al importar. |
| Adaptadores | `src/server/adapters/` | `job-queue`, `realtime`, `rate-limiter`, `file-storage` (disco o Vercel Blob), `text-search` (FTS5), `vector-search`, y `database-health`/`database-info` para Diagnóstico. Único sitio con SQL propio de SQLite. |
| Trabajo en segundo plano | `src/server/jobs/` | `tick()` y el registro de trabajos; hoy solo existe el de los correos del sistema. |
| Usuarios | `src/server/auth.ts`, `src/server/accounts.ts` | Better Auth (email y contraseña, sin registro público, verificación en dos pasos, límite de peticiones en base de datos). Por HTTP solo responde a `get-session`, `sign-out` y el enlace de recuperación (`httpAllowlist`); el resto va por Server Actions con `auth.api.*`. Las cuentas solo se crean en `accounts.ts`: asistente (con el código de instalación `SETUP_TOKEN` al publicar), invitaciones y demo. |
| Correo del sistema | `src/server/mailer.ts`, `src/server/email-templates.ts` | SMTP de Ajustes › Correo del sistema, con el nombre, el logo y el color del negocio en cada correo ([AJU-01]). La contraseña guardada solo se envía al mismo servidor, puerto, seguridad y usuario. Sin SMTP, en local o con la demo, cada correo se guarda como `.eml` en `data/outbox/`; publicado, da un error claro. Todos quedan anotados para Diagnóstico. |
| Cifrado | `src/server/crypto.ts`, `src/server/redact.ts` | AES-256-GCM (`v1:iv:tag:texto`), máscara `••••1234` y limpieza de secretos en registros y errores. |
| Límites de peticiones | `src/server/client-ip.ts` y cada acción | Las Server Actions que llaman a `auth.api.*` (entrar, dos pasos, recuperar, invitación, Mi cuenta, asistente) cuentan sus intentos con el `RateLimiter`, por IP y por email o usuario; sus rutas HTTP de Better Auth están cerradas para que nadie se salte esos límites. Better Auth limita las pocas que siguen abiertas. |
| Demo y órdenes | `scripts/`, `seed/`, `src/lib/sectors/`, `src/server/demo/` | Preparación (`scripts/lib/setup.ts`), demo por sector, `db:reset`, `db:fresh`, worker y el lanzador de `pnpm dev` (`scripts/dev.mjs`). Los datos de cada sector son datos puros en `src/lib/sectors/`, que también usa el asistente. |
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
| Simulador | Inyecta mensajes de WhatsApp, correo o web en los canales de demo | La misma entrada que los canales reales |
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

El chat web entra igual por su API. El correo no avisa: un trabajo periódico pregunta en cada ronda
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

Lo que sube el equipo se valida en el servidor (tipo y tamaño) y se guarda con una clave aleatoria: en disco, o
directo del navegador a Blob cuando la app esté en Vercel, con un permiso que da el servidor tras comprobar la
sesión. Los medios de los canales se descargan en un trabajo nada más llegar. Todo se sirve por `/api/files/…`,
que comprueba el permiso sobre ese archivo concreto antes de devolverlo.

### Conocimiento

Un documento subido pasa por pasos en la cola, con su estado a la vista: extraer a Markdown con páginas,
trocear, calcular embeddings y quedar listo. Al buscar, se piden 40 resultados por significado (solo con clave
de OpenRouter) y 40 por palabras, se mezclan con RRF y se quedan los 8 mejores (6 si está activada la
reordenación de Ajustes > IA, que vale para toda la instalación), con su título, sección y página. Sin clave,
la búsqueda es solo por palabras.

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
