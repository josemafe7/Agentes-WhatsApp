# Plataforma y despliegue

Referencia técnica de dónde corre la app y con qué límites: Vercel, Supabase (base de datos, Storage, Cron, claves y
copias), la base integrada de la demo (PGlite) y el futuro VPS con Dokploy. Lo de Vercel y Dokploy se comprobó el
26-09-2026, y lo de Supabase y PGlite el 27-09-2026, contra la documentación oficial (ver «Fuentes»). Si una cifra
cambia, se corrige aquí antes de tocar el código. El porqué de Supabase está en `docs/decisions/0024-datos-y-archivos-en-supabase.md`.

Hoy la app solo corre en local (decisión del 26-09-2026): este documento prepara la configuración y las
guías, pero no se publica nada. La guía paso a paso está aparte (`docs/guia-despliegue.md`, también en la app, en
Ayuda) y la configuración de Vercel, en `vercel.json`.

## Resumen

| Pieza | Dato que condiciona el diseño | Consecuencia en el proyecto |
|---|---|---|
| Vercel Hobby | Solo uso personal y no comercial | Solo pruebas. Un negocio real va en Pro o en el VPS |
| Duración de las funciones | Hobby: 300 s por defecto y como máximo. Pro: 300 s por defecto, hasta 800 s (1.800 s en beta) | `tick()` trabaja con presupuesto de tiempo y trocea |
| `after()` | Corre dentro de la misma invocación y comparte su tope de duración | Lo que se hace tras responder también tiene límite |
| Cuerpo de petición y de respuesta | 4,5 MB | Los webhooks de Meta caben. Los archivos se sirven en streaming. Las subidas de más de 4,5 MB necesitarán ir directas a Storage (pendiente) |
| Vercel Cron | Hobby: una vez al día y con ±59 min de margen. Pro: cada minuto | El de cada minuto lo lanza Supabase Cron |
| Deployment Protection | «Standard Protection» protege todo menos los dominios de producción | Webhooks, OAuth y el cron apuntan siempre al dominio de producción |
| Supabase Free | 500 MB de base, 1 GB de archivos, 50 MB por archivo, sin copias automáticas; se pausa tras una semana con poca actividad | Solo pruebas |
| Supabase Pro | 25 USD al mes; copias diarias guardadas 7 días; archivos de hasta 500 GB | El plan de un negocio real |
| Conexión con Supabase | Modo transacción (puerto 6543) sin sentencias preparadas; modo sesión (5432) por IPv4; la directa, por IPv6 | Vercel: 6543. Un VPS o un ordenador: 5432 |
| Claves de Supabase | Las secretas (`sb_secret_…`) son solo para el servidor y se saltan Row Level Security; `anon` y `service_role` se retiran a finales de 2026 | La app usa una sola clave secreta, en el servidor, para Storage |
| Región de Supabase | Se elige al crear el proyecto y no se puede cambiar | En la misma ciudad que las funciones: Londres (`eu-west-2` y `lhr1`, lo preparado) o Irlanda (`eu-west-1` y `dub1`) |
| Base integrada (PGlite) | Postgres 18.3 dentro del proceso de Node; un solo proceso por carpeta | Solo para la demo y las pruebas |
| Dokploy | Decenas de avisos de seguridad publicados el 21-07-2026 (versiones ≤ 0.29.8) | Instalar y mantener la última versión (0.30.7 el 18-09-2026) |

## Vercel

### Plan Hobby: solo pruebas

Las normas de uso de Vercel restringen Hobby a uso «non-commercial personal use only». Cuentan como uso
comercial, entre otros, cobrar por crear, actualizar o alojar el sitio y que lo programe alguien a quien se
le paga. Instalar esta plantilla para un negocio que paga es, por tanto, uso comercial: Hobby sirve para
probar y enseñar la demo; un negocio real necesita Pro (20 USD por asiento de desarrollador y mes, según la
página del plan) o el VPS.

Si se superan los límites de Hobby no se cobra, pero la función afectada queda parada hasta que pasan 30
días.

### Duración de las funciones y `after()`

- Fluid compute viene activado por defecto en los proyectos nuevos desde el 23-04-2025. Con él, para Node.js:

  | Plan | Por defecto | Máximo | Máximo ampliado |
  |---|---|---|---|
  | Hobby | 300 s | 300 s | — |
  | Pro | 300 s | 800 s | 1.800 s (beta, por función) |

- Se fija por ruta con `export const maxDuration = N` en el Route Handler. Si se supera, Vercel corta la
  invocación con un 504 (`FUNCTION_INVOCATION_TIMEOUT`).
- `after()` (estable desde Next.js 15.1) ejecuta trabajo cuando ya se ha enviado la respuesta. Según Next.js,
  «corre durante la duración máxima, por defecto o configurada, de la ruta». En Vercel se apoya en
  `waitUntil`, y Vercel dice que esas promesas «tienen el mismo tope que la propia función» y se cancelan si
  la función se agota. Vercel recomienda `after()` frente a `waitUntil` desde Next.js 15.1.
- Por eso `tick({ budgetMs })` calcula su presupuesto a partir del `maxDuration` de la ruta que lo lanza,
  menos lo ya gastado y un margen, y deja lo pendiente para el siguiente tick. Conviene fijar `maxDuration`
  de forma explícita en las rutas que lanzan `tick()` (webhooks, widget y cron), para que el presupuesto no
  dependa de un valor por defecto que puede cambiar.
- La documentación de Vercel avisa de que un cron puede no llegar o llegar dos veces, y de que dos
  ejecuciones pueden solaparse. La reclamación de trabajos (`FOR UPDATE SKIP LOCKED`, decisión 0024) y los handlers
  idempotentes cubren los tres casos.
- En el VPS, `after()` funciona igual con el servidor de Node.js. Para no perder trabajo al reiniciar, el
  contenedor debe pararse con `SIGTERM` y esperar: Next.js termina las peticiones en curso y los `after()`
  pendientes, y recomienda de 10 a 30 s de margen.

### Cron: Vercel Cron y Supabase Cron

- Vercel Cron hace un `GET` a la URL de producción, a la ruta indicada en `crons` de `vercel.json`, con el
  agente `vercel-cron/1.0` y la cabecera `x-vercel-cron-schedule`. Si el proyecto tiene la variable
  `CRON_SECRET`, la envía como `Authorization: Bearer <CRON_SECRET>` (Vercel recomienda al menos 16
  caracteres aleatorios). La hora es siempre UTC.
- No reintenta si falla, no sigue redirecciones y no se puede probar con `next dev`: en local se usa el ticker
  de `pnpm dev`.
- Hobby: hasta 100 cron jobs por proyecto, pero cada uno como mucho una vez al día y con precisión de hora
  (un `0 1 * * *` puede saltar entre la 1:00 y la 1:59). Una expresión más frecuente hace fallar el
  despliegue con el error «Hobby accounts are limited to daily cron jobs». Pro: cada minuto y con precisión de
  minuto.
- Consecuencia: el `vercel.json` del repositorio no lleva `* * * * *`: con él fallaría un despliegue en Hobby, y
  una prueba (`project-config.test.ts`) lo impide. Lleva un cron diario a `/api/cron/tick` (red de seguridad y
  tareas diarias, válido en los dos planes) y el trabajo de cada minuto lo lanza Supabase Cron, también en Pro
  (ver «Supabase › Cron» y `docs/guia-despliegue.md`, «6. El cron cada minuto»). Si una instalación en Pro prefiere
  Vercel Cron cada minuto, quien mantiene el código cambia a la vez la expresión de `vercel.json` y esa prueba, que
  protege a las de Hobby.
- `/api/cron/tick` acepta `GET` (Vercel Cron) y `POST` (Supabase Cron y el lanzador de `pnpm dev`), compara el
  `Bearer` en tiempo constante y responde enseguida (202): el trabajo sigue en `after()`.

### Límite de 4,5 MB

- El cuerpo de la petición y el de la respuesta de una función no pueden pasar de 4,5 MB; si no, Vercel
  devuelve 413 (`FUNCTION_PAYLOAD_TOO_LARGE`). Las respuestas en streaming no tienen ese límite.
- Webhooks: los de WhatsApp (hasta 3 MB según la especificación) caben. Los medios no vienen en el webhook:
  se descargan después desde Graph, en un trabajo en segundo plano, y la función los sube a Storage sin pasar por
  una petición del navegador.
- Subidas desde la interfaz (documentos de conocimiento, archivos de contexto, logos): en Vercel no pueden
  pasar por un Route Handler ni por una Server Action si superan 4,5 MB. Hoy pasan por la app (hasta 4 MB por
  Server Action y 25 MB por la ruta del conocimiento, que en Vercel se queda en 4,5 MB). Para más, tendrán que ir
  directas del navegador a Supabase Storage con una dirección firmada de subida (`createSignedUploadUrl` y
  `uploadToSignedUrl` de supabase-js), que el servidor da tras comprobar la sesión y el rol: **pendiente**.
- Descargas: la ruta `/api/files/…` devuelve el archivo en streaming, así que no le afecta el límite.

### Dominio de producción, previews y Deployment Protection

- Cada despliegue tiene varias URL: la única del despliegue (cambia en cada uno), la de la rama de Git (fija
  por rama), la de producción y los dominios propios.
- «Standard Protection» protege todas las URL salvo los dominios de producción; también queda protegida la
  URL generada del propio despliegue de producción (la que lleva el identificador del despliegue). Con Vercel
  Authentication, quien no ha iniciado sesión en Vercel recibe una redirección al login de Vercel: Meta,
  Google, Microsoft, Telegram y el cron de Supabase no pueden llegar a una preview. Conviene revisar en Settings ›
  Deployment Protection qué alcance tiene el proyecto, porque el equipo puede fijar otro por defecto.
- Por eso los webhooks, las URI de redirección de OAuth y el cron usan siempre el dominio de producción
  (`<proyecto>.vercel.app` o el dominio propio). La variable de sistema `VERCEL_PROJECT_PRODUCTION_URL` lo da
  sin protocolo y existe incluso en las previews. `VERCEL_URL` no sirve con Standard Protection.
- Existe «Protection Bypass for Automation» (cabecera o parámetro `x-vercel-protection-bypass`). No se usa
  para Meta: el secreto quedaría escrito en la URL del panel de un tercero. Sirve, como mucho, para pruebas
  automáticas contra una preview.
- Las previews usan las variables del entorno «Preview»: no deben apuntar a la base de datos de producción.

### Variables de entorno «Sensitive»

- Una variable «Sensitive» no se puede volver a leer una vez creada; solo se puede editar su valor. Solo se
  puede crear en los entornos Production y Preview (no en Development). Para convertir una variable existente
  hay que borrarla y crearla de nuevo con la opción activada. En los logs de build, Vercel oculta los valores
  de 32 caracteres o más.
- Se crean así: `APP_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `CRON_SECRET`, `SETUP_TOKEN`, `DATABASE_URL` (lleva la
  contraseña de la base), `SUPABASE_SECRET_KEY` y `OPENROUTER_API_KEY` si se usa. `SUPABASE_URL` no es secreta. El
  propietario del equipo puede imponerlo para todas las variables nuevas («Enforce Sensitive Environment
  Variables»).
- Como no se puede volver a leer, `APP_ENCRYPTION_KEY` se guarda también en un gestor de contraseñas: si se
  pierde, los secretos cifrados de la base de datos quedan ilegibles.
- La integración de Supabase del Marketplace de Vercel no se usa: crea el proyecto de Supabase desde Vercel (con la
  factura en Vercel) y sincroniza variables con otros nombres (`POSTGRES_URL`, `POSTGRES_PRISMA_URL`…) y algunas
  `NEXT_PUBLIC_` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). Las variables se ponen a mano.

### Región de las funciones

Las funciones corren por defecto en Washington (`iad1`). En Hobby hay una sola región, que se puede cambiar
en Settings › Functions o con `regions` en `vercel.json`. Se pone la de la misma ciudad que la base de datos: con
Supabase en Londres (`eu-west-2`), Londres (`lhr1`), que es lo que fija `vercel.json` (y su prueba); con Supabase en
Irlanda (`eu-west-1`), Dublín (`dub1`).

### Paquetes con binarios, WebAssembly o módulos nativos

- Next.js empaqueta las dependencias del servidor. `serverExternalPackages` deja fuera las que deben
  cargarse con `require` de Node. Su lista por defecto ya incluye, entre otros, `pg`, `pino` (lo usa `imapflow`) y
  `sharp`, pero no `postgres` (postgres.js), `@electric-sql/pglite`, `ffmpeg-static` ni `imapflow`.
- PGlite (0.5.8) y su extensión de pgvector cargan sus archivos de WebAssembly y de datos desde la carpeta de su
  paquete: van en `serverExternalPackages` de `next.config.ts`. En Vercel no se abren (allí la base es Supabase).
- postgres.js (3.4.9) es JavaScript puro y va por red (TCP con TLS).
- `outputFileTracingIncludes` añade archivos que el trazado no detecta. Sus claves son rutas de la app
  (`/api/cron/tick`) y sus valores, patrones de archivos relativos a la raíz del proyecto. Solo afecta a
  rutas de servidor que no sean estáticas ni Edge.
- `ffmpeg-static` (5.3.0, ffmpeg 6.1.1, licencia GPL-3.0-or-later) exporta la ruta a un binario que descarga
  su script de instalación (`node install.js`). Consecuencias:
  - pnpm bloquea por defecto los scripts de instalación de las dependencias: hay que aprobar este en
    `allowBuilds` de `pnpm-workspace.yaml` (desde pnpm 10.26; `onlyBuiltDependencies` desapareció en la
    versión 11). Sin esa aprobación, el binario no existe. Según `AGENTS.md`, aprobarlo requiere permiso de
    la persona.
  - El binario no se importa con `require`, así que el trazado no lo ve: `ffmpeg-static` va en
    `serverExternalPackages` y su binario en `outputFileTracingIncludes` de las rutas que pueden convertir
    audio (las que lanzan `tick()`). No verificado todavía en un despliegue real de este proyecto: se
    comprueba en la primera prueba en Vercel.
  - Cada función puede pesar como mucho 250 MB sin comprimir: el binario solo se incluye donde hace falta.
  - La variable `FFMPEG_BIN` sustituye la ruta: en Docker se puede instalar el ffmpeg del sistema y apuntar a
    él.
- `imapflow` (2.0.7) es JavaScript puro. No se espera configuración especial (no verificado en Vercel). En
  Vercel no hay IMAP IDLE: se conecta en cada tick.

### Correo desde Vercel

Vercel bloquea el puerto 25 de salida; el 465 y el 587 funcionan. Los ajustes automáticos de SMTP deben
proponer 465 o 587. Vercel recomienda las API HTTP de los proveedores frente a SMTP en funciones.

### Consumo del plan Hobby

Hobby incluye al mes, entre otros: 1.000.000 de invocaciones de funciones, 1.000.000 de Edge Requests,
4 horas de CPU activa, 360 GB-h de memoria y 100 GB de transferencia. El sondeo del tiempo real es lo que
más invocaciones gasta: una pestaña que pregunta cada 4 s hace 900 peticiones por hora. Por eso el sondeo se
pausa cuando la pestaña no está visible y se espacia cuando no hay actividad. El cron cada minuto suma unas
43.200 invocaciones al mes.

## Supabase

Solo para la app publicada. En local (el clon de cualquiera y el ordenador del propietario) la base es la integrada
(ver «Base integrada»), sin Supabase ni cuentas. Sus datos (`DATABASE_URL`, `SUPABASE_URL` y `SUPABASE_SECRET_KEY`)
van en las variables de entorno de Vercel, marcadas Sensitive las secretas, nunca en `.env.local`. La instalación
publicada empieza vacía, con el asistente de arranque, o con la demo si se carga a propósito para enseñar la app
(`pnpm seed` con las variables de Supabase solo para esa orden; ver la guía de publicación, apartado 2, con su aviso
sobre las contraseñas públicas de la demo).

### Planes

| | Free | Pro |
|---|---|---|
| Precio | 0 | 25 USD al mes |
| Proyectos activos | 2 | — |
| Base de datos | 500 MB | 8 GB de disco por proyecto incluidos |
| Archivos (Storage) | 1 GB | 100 GB |
| Transferencia de salida | 5 GB | 250 GB |
| Tamaño máximo de un archivo | 50 MB | Hasta 500 GB (se sube en los ajustes de Storage) |
| Copias automáticas | No | Diarias, guardadas 7 días |
| Registros | 1 hora | 7 días |
| Pausa por inactividad | Sí, tras una semana | No |

- Un proyecto Free se pausa si la base no recibe suficiente actividad en una semana (Supabase avisa antes por correo).
  Se reactiva desde su página con «Resume project», y durante un año se puede recuperar con sus datos. Según Supabase,
  unas pocas consultas al día suelen bastar para que no se pause; con el cron de cada minuto, la app consulta la base a
  menudo (**no comprobado** con un proyecto real).
- Con datos personales de clientes reales: Pro, por las copias y porque no se pausa.

### Proyecto y región

- La región se elige al crear el proyecto y **no se puede cambiar**: habría que crear otro proyecto y pasar los datos.
- Se elige una región concreta en la misma ciudad que las funciones de Vercel: **West Europe (London)** (`eu-west-2`)
  con `lhr1`, que es como viene preparado (el proyecto del propietario está en Londres), o **West EU (Ireland)**
  (`eu-west-1`) con `dub1`. La región general «Europe» deja que Supabase elija, e incluye Londres y Zúrich.
- Londres y Zúrich no son de la UE, aunque tienen un régimen de protección de datos que la UE reconoce como adecuado
  (así lo dice Supabase en su guía del RGPD); para quedarse dentro de la UE, Irlanda (u otra región concreta de la UE,
  con la región de Vercel más cercana). Con datos de clientes, el negocio lo revisa con su abogado.
- La base, los usuarios de Supabase Auth (aquí no se usan) y los archivos de Storage viven en esa región. Las copias,
  los registros y los subencargados pueden tratar datos en otros sitios: cuenta en el análisis de transferencias.
- Supabase ofrece Postgres hasta la versión 17; la base integrada de la demo es Postgres 18 (ver «Base integrada»).
  La versión de pgvector de un proyecto se mira con `SELECT extversion FROM pg_extension WHERE extname = 'vector';`:
  la búsqueda necesita la 0.8.0 o posterior (`hnsw.iterative_scan`). **A comprobar** en el primer proyecto real.

### Conexión con la base

| Forma | Puerto | Servidor y usuario | Red | Para qué |
|---|---|---|---|---|
| Directa | 5432 | `db.<ref>.supabase.co`, usuario `postgres` | IPv6 (IPv4 con un complemento de pago) | Servidores que siguen encendidos, con IPv6 |
| Pooler compartido, modo sesión («Session pooler») | 5432 | `aws-<n>-<región>.pooler.supabase.com`, usuario `postgres.<ref>` | IPv4 | Un VPS o un ordenador desde una red IPv4; las copias con la CLI |
| Pooler compartido, modo transacción («Transaction pooler») | 6543 | el mismo del modo sesión | IPv4 | Funciones sin servidor, como las de Vercel |
| Pooler dedicado (planes de pago) | 6543 | `db.<ref>.supabase.co`, usuario `postgres` | IPv6 (IPv4 con un complemento de pago) | No se usa |

- Las direcciones se copian del botón **Connect** del proyecto (el número de `aws-<n>` no se deduce de la región).
- El modo transacción no admite sentencias preparadas: postgres.js va con `prepare: false` (lo que recomienda
  Supabase para postgres.js y Drizzle). Además, cada transacción puede ir por una conexión distinta del servidor: por
  eso los ajustes de una consulta van con `SET LOCAL` dentro de su transacción y el candado de escritura es de
  transacción (`pg_advisory_xact_lock`), nunca de sesión.
- SSL obligatorio (`ssl: "require"`), salvo con un Postgres del mismo ordenador. La app abre como mucho 5 conexiones
  por proceso, las cierra tras 20 s sin uso, espera 15 s para conectar y se presenta como `dominia-agentes`.
- La app no fija el `search_path` en las conexiones a un servidor: el de Supabase ya incluye el esquema `extensions`
  (donde están `vector` y `unaccent`). Un Postgres que no sea de Supabase (por ejemplo, uno propio junto al futuro VPS)
  necesita `extensions` en su `search_path`, o `halfvec` y `<=>` no existirán.
- La contraseña va dentro de la dirección: la dirección entera es un secreto. Con símbolos como `@`, `:` o `/` habría
  que codificarlos; por eso la guía pide una contraseña de letras y números. Se cambia en **Database › Settings**; justo
  después, el pooler puede rechazar la nueva unos instantes (error `28P01`): se vuelve a probar.
- Las migraciones se aplican desde el ordenador de quien publica (`pnpm db:migrate`, con `DATABASE_URL` puesta solo
  para esa orden en la terminal y nunca guardada en `.env.local`) o las aplica Claude Code con el conector de Supabase,
  anotándolas en `drizzle.__drizzle_migrations` como el migrador de Drizzle. Nunca en el build de Vercel, que también
  corre para las previews y podría migrar la base equivocada.

### Claves de la API

- Tipos: la publicable (`sb_publishable_…`), pensada para navegadores y apps, y la secreta (`sb_secret_…`), solo para
  el servidor. Las antiguas `anon` y `service_role` (tokens JWT de larga duración) se retiran a finales de 2026.
- Se crean y se ven en **Project Settings › API Keys**; la dirección del proyecto («Project URL»,
  `https://<ref>.supabase.co`) y las claves salen también en **Connect**.
- Una clave secreta se salta Row Level Security en todo, también en Storage. Supabase la rechaza (401) si llega desde un
  navegador (lo detecta por la cabecera User-Agent). Supabase recomienda una por cada pieza del servidor, para cambiar
  solo esa si se filtra. Borrar una clave secreta no se puede deshacer.
- La app solo usa una clave secreta (`SUPABASE_SECRET_KEY`) y solo para Storage; la base la abre con `DATABASE_URL`.
  Nunca la publicable ni variables `NEXT_PUBLIC_` de Supabase.

### Row Level Security y la API de datos

- La API de datos de Supabase (REST y GraphQL) deja leer y escribir tablas desde fuera con una clave. Las tablas
  nuevas del esquema `public` dejan de exponerse solas: por defecto en los proyectos nuevos desde el 2026-05-30 y en
  todos desde el 2026-10-30. Hasta entonces, un proyecto antiguo da permisos automáticos a `anon` y `authenticated`.
- Todas las tablas de la app tienen Row Level Security desde su migración y ninguna política: aunque un rol tuviera
  permiso sobre una tabla, no vería ni cambiaría ninguna fila. La app no usa esa API: entra como `postgres`, el
  propietario de las tablas, al que Row Level Security no se aplica.
- La API de datos se puede apagar entera en su página de integración («Enable Data API»): entonces no responde
  ninguna de sus direcciones, tengan permisos o no. Que Storage siga funcionando con ella apagada es **no
  verificado** (Storage es otro servicio): si se apaga, se comprueba después que se suben archivos.
- **Advisors › Security Advisor** revisa el proyecto (también `supabase db advisors` con la CLI). Lo que importa: sin
  errores (por ejemplo, `rls_disabled_in_public`, una tabla de `public` sin Row Level Security) ni avisos (por
  ejemplo, `extension_in_public`: las extensiones de la app van en el esquema `extensions`). El aviso informativo
  `rls_enabled_no_policy` («RLS Enabled No Policy») sale en cada una de las 54 tablas y es lo que se busca: nadie
  entra por la API de datos. **Nunca se añaden políticas para quitarlo**: una política abre filas a esa API.

### Storage

- La app guarda los archivos en el bucket **privado** `dominia-archivos`, que crea ella la primera vez
  (`createBucket` con `public: false`) con supabase-js (2.116.0) y la clave secreta. Sube con `upsert`, descarga y
  borra; nunca pide direcciones públicas ni firmadas para servir un archivo: los sirve `/api/files/…` tras comprobar
  el permiso. Si el bucket existe y es público, se niega a guardar nada en él con un error que lo explica. En Vercel
  sin `SUPABASE_URL` y `SUPABASE_SECRET_KEY`, también se niega: el disco de una función no conserva archivos.
- En un bucket privado todas las operaciones pasan por Row Level Security; sin políticas en `storage.objects`, Storage
  no deja subir nada a nadie salvo a quien tiene la clave secreta, que se salta las políticas.
- El tamaño máximo de un archivo es global del proyecto (50 MB en Free; en Pro hasta 500 GB) y cada bucket puede
  bajarlo. Los documentos de WhatsApp llegan a 100 MB (`docs/integracion-whatsapp-mensajes.md` §10.3): en Pro conviene
  subir el límite global a 100 MB.
- Las copias de la base no llevan los archivos de Storage (solo sus metadatos). Pasarlos a otro proyecto se hace con un
  script de supabase-js, como explica la guía de Supabase para migrar Storage.
- Para las subidas grandes desde el navegador (más de 4,5 MB en Vercel), supabase-js tiene direcciones firmadas de
  subida (`createSignedUploadUrl` y `uploadToSignedUrl`): no se usan todavía.

### Cron

- Supabase Cron es un módulo de Postgres sobre `pg_cron`. Se configura en **Integrations › Cron** (o con SQL) y cada
  trabajo puede ejecutar SQL, una función de la base, una petición HTTP a cualquier dirección o una función Edge. Va
  de cada segundo a una vez al año; Supabase recomienda como mucho 8 trabajos a la vez y que ninguno dure más de 10
  minutos.
- En el panel: **Create job** abre «Create a new cron job», con **Name** (no se puede cambiar después), la
  programación (sintaxis cron o lenguaje natural) y el tipo. Con **HTTP Request**: **Method** (GET o POST),
  **Endpoint URL**, **Timeout** (en ms; 1.000 si no se cambia) y **HTTP Headers** (**Add header**). **History**, junto al
  trabajo, enseña cada ejecución, y su interruptor lo pausa. Comprobado en el código del panel de Supabase
  (`apps/studio/…/Integrations/CronJobs/`), no solo en su documentación.
- La petición la hace `pg_net`, de forma asíncrona: sale cuando termina la transacción del trabajo, y la respuesta se
  guarda 6 horas en `net._http_response` (`status_code`, `error_msg`, `created`…). Por SQL, `net.http_post` espera 2 s
  por defecto (`timeout_milliseconds`). Admite hasta unas 200 peticiones por segundo.
- El trabajo de la app: `POST https://<dominio de producción>/api/cron/tick` cada minuto (`* * * * *`), cabecera
  `Authorization: Bearer <CRON_SECRET>` y 5.000 ms de espera. La ruta responde 202 al momento y trabaja en `after()`.
- `CRON_SECRET` queda escrito en la definición del trabajo, dentro de la base: lo ve quien entra en el proyecto (o en
  una copia de la base). Solo permite lanzar `tick()`, que se puede repetir sin efecto; se usa uno largo y aleatorio y
  se cambia si se filtra.
- Otras formas, si hiciera falta (comprobadas el 26-09-2026): cron-job.org (gratis, cada minuto, admite la cabecera
  `Authorization` y corta a los 30 s) y Vercel Cron en Pro (exige cambiar `vercel.json` y su prueba).

### Copias de seguridad

- **Free:** sin copias automáticas. Supabase recomienda exportar con la CLI (`supabase db dump`, que ejecuta `pg_dump`
  en un contenedor: necesita Docker) y guardar las copias fuera. Con la dirección del «Session pooler», en tres
  archivos: los roles (`--role-only`), el esquema y los datos (`--use-copy --data-only`, sin
  `storage.buckets_vectors` ni `storage.vector_indexes`). Se restauran con `psql` en una sola transacción.
- **Pro:** copias diarias de los últimos 7 días (Team, 14; Enterprise, hasta 30), que se restauran desde **Database ›
  Backups**. El proyecto no responde mientras se restaura, más tiempo cuanto más grande es la base.
- **PITR** (volver a un momento concreto): complemento de pago de Pro, Team y Enterprise, que además exige al menos el
  tamaño de servidor Small; 7 días cuestan unos 100 USD al mes.
- Los archivos de Storage no entran en ninguna de estas copias.

### Servidor MCP

- El servidor MCP de Supabase deja a un agente de código consultar y cambiar un proyecto. Se limita a uno solo con
  `project_ref=<ref>` en su dirección (y entonces no ve la cuenta) y a solo lectura con `read_only=true`, que ejecuta
  cada consulta con un usuario de Postgres de solo lectura. Por ejemplo:
  `https://mcp.supabase.com/mcp?project_ref=<ref>&read_only=true`.
- Supabase avisa de que lo que los usuarios escriben en la base puede traer instrucciones escondidas para el agente, y
  recomienda conectarse a producción solo cuando haga falta, con esas dos limitaciones, y revisar cada llamada.

### Contrato de encargo del tratamiento

- El DPA de Supabase forma parte de su contrato: rige desde que se aceptan sus condiciones e incluye las cláusulas tipo
  para las transferencias. Lo firma Supabase Pte. Ltd. (Singapur). Si hace falta una copia firmada aparte, se pide a
  Supabase (**a comprobar** cómo).
- Su lista de subencargados está publicada, con aviso de cambios por suscripción.

## Base integrada (PGlite)

- Es Postgres 18.3 compilado a WebAssembly (`@electric-sql/pglite` 0.5.8), dentro del proceso de Node, con pgvector
  0.8.1 (`@electric-sql/pglite-pgvector` 0.0.9) y `unaccent`. No necesita cuentas, servidor ni Docker: con él
  arrancan la demo de un clon limpio y todas las pruebas. Comprobado con los paquetes instalados.
- Con `DATABASE_URL` vacía, la demo guarda la base en `data/pglite` (con el antiguo `file:./data/local.db` de SQLite,
  también). Las pruebas de Vitest usan una en memoria por archivo, y las de Playwright, `data/e2e-pglite`,
  `data/e2e-fresh-pglite` y `data/e2e-restaurante-pglite`.
- **Un solo proceso por carpeta.** PGlite no lo impide por sí mismo, así que la app deja un candado junto a la carpeta
  (`data/pglite.lock`, con el número del proceso): un segundo proceso se niega con «La base local (data/pglite) está
  abierta en otro proceso (¿pnpm dev en marcha?). Ciérralo y vuelve a probar.». Por eso `pnpm dev`, `pnpm worker`,
  `pnpm db:reset` y `pnpm db:fresh` no pueden usarla a la vez. Un negocio real va publicado, con Supabase (y, en un
  servidor propio, la app y `pnpm worker` con Supabase).
- No guarda el `search_path`: la app ejecuta `SET search_path TO public, extensions` al abrirla (sin él, `halfvec` y
  `<=>` no existen).
- Mientras una transacción está abierta, cualquier otra consulta de la misma instancia espera a que termine: dentro de
  una transacción, todo con `tx` (con `db` se quedaría colgada para siempre).
- Tiempos medidos: arrancar en memoria, ~1,1 s; copiar una base en memoria, ~230 ms; guardar su carpeta en un archivo
  (`dumpDataDir`), ~40 ms; abrir una en memoria desde ese archivo (`loadDataDir`), ~180 ms sola y unos 0,4 s por
  archivo de prueba (más con el ordenador cargado); una carpeta nueva en disco, ~1,4 s.
- Se copia como cualquier carpeta, con la app parada. Nunca se abre en Vercel: allí la base es Supabase.

## Futuro: VPS con Dokploy

### Servidor

- Hostinger KVM 2: 2 vCPU, 8 GB de RAM, 100 GB NVMe y 8 TB de transferencia. Hostinger ofrece la plantilla
  «Ubuntu 24.04 with Dokploy», que deja Dokploy instalado; el panel queda en `http://<IP>:3000`. Dokploy pide
  al menos 2 GB de RAM y 30 GB de disco, y usa los puertos 80, 443 y 3000.
- La plantilla puede traer una versión antigua: nada más instalar se actualiza con
  `curl -sSL https://dokploy.com/install.sh | sh -s update` y se comprueba la versión.

### Seguridad

- El 21-07-2026 Dokploy publicó decenas de avisos de seguridad, la mayoría críticos (ejecución de comandos
  como root en el servidor, fallos de control de acceso, acceso a datos de otras organizaciones) para las
  versiones hasta la 0.29.8; algunas correcciones indican la 0.29.13. El 11-05-2026 ya había publicado otros,
  entre ellos una toma de control del administrador sin autenticación (CVE-2026-45631, versiones 0.27.0 a
  0.28.8). La última versión el 26-09-2026 es la 0.30.7, del 18-09-2026.
- Algunos avisos no indican versión corregida y marcan todas como afectadas: por ejemplo, cualquier usuario
  que pueda editar un Compose puede ejecutar órdenes en el servidor a través de su comando personalizado
  (GHSA-qh6h-669j-77rw). Quien entra en el panel puede acabar siendo root del servidor: **el panel nunca se
  da al negocio**. Solo lo usa quien implanta, con verificación en dos pasos o passkeys.
- La guía de producción de Dokploy pide, entre otras cosas:
  - cortafuegos que solo abra 22, 80 y 443, con `ufw-docker`, porque Docker salta las reglas de UFW para los
    puertos publicados;
  - cerrar el puerto 3000 cuando el panel ya tenga un dominio con HTTPS funcionando:
    `docker service update --publish-rm "published=3000,target=3000,mode=host" dokploy`;
  - el panel de Traefik apagado y HSTS en el router HTTPS;
  - copias a S3 y restauraciones probadas.

### docker-compose

- Tres servicios que usan la misma imagen:
  - `migrate`: aplica las migraciones y termina (sin reinicio automático);
  - `web`: el servidor de Next.js en modo `standalone`;
  - `worker`: `tick()` en bucle, con IMAP IDLE opcional.

  `web` y `worker` dependen de `migrate` con `condition: service_completed_successfully`, que Docker define
  como «la dependencia debe terminar con éxito antes de arrancar el servicio que depende de ella».
- La base de datos es la de Supabase, por el «Session pooler» (puerto 5432, IPv4), la que Supabase propone para
  servidores que siguen encendidos cuando no hay IPv6. Nunca la base integrada: `web` y `worker` son dos procesos.
- Sin `ports:`: se usa `expose` y el dominio se configura en la pestaña Domains, desde donde Dokploy añade las
  etiquetas de Traefik. Sin `container_name`, porque dos instalaciones en el mismo servidor chocarían. Para
  varias instalaciones, Dokploy tiene «Isolated Deployments», que crea una red por aplicación y conecta
  Traefik a ella.
- Los archivos, en Supabase Storage (con `SUPABASE_URL` y `SUPABASE_SECRET_KEY`) o en un volumen con nombre para
  `data/uploads` compartido por `web` y `worker`. Las copias de volúmenes de Dokploy solo funcionan con volúmenes con
  nombre, y Dokploy avisa de que las rutas absolutas del servidor se limpian en los despliegues.
- Variables: Dokploy escribe las de su pestaña Environment en un `.env`, pero **no las pasa a los
  contenedores**. Cada una se referencia en el compose con `${VAR}` (o se usa `env_file: .env`). La forma
  `${VAR:?mensaje}` hace fallar el despliegue si falta, que es mejor que arrancar sin clave.
- Next.js mete las variables `NEXT_PUBLIC_` en el código al compilar: una imagen compartida por varios
  negocios no puede llevar valores públicos propios de cada uno. Lo que cambia por instalación (URL, clave
  pública VAPID, nombre) se lee en el servidor en tiempo de ejecución.
- `output: 'standalone'` genera `.next/standalone` con un `server.js` mínimo. `public/` y `.next/static` se
  copian a mano, y el puerto y la interfaz se fijan con `PORT` y `HOSTNAME` (en el contenedor,
  `HOSTNAME=0.0.0.0`). El modo standalone solo incluye lo que usa el servidor de Next.js: el worker y las
  migraciones necesitan su propio empaquetado dentro de la imagen.
- `web` expone `/api/health`, que comprueba la base de datos. Si se usa como healthcheck de Docker, la imagen
  necesita algo con que llamarla (por ejemplo, el propio Node): no todas las imágenes base traen `curl`.
- Para no cortar `after()` ni jobs a medias, el contenedor se para con `SIGTERM` y un margen de unos 30 s.

### Imágenes en GHCR

- Se construyen en GitHub Actions y se suben a `ghcr.io`, nunca en el VPS. GitHub documenta el flujo con
  `docker/login-action`, `docker/metadata-action` y `docker/build-push-action`, autenticado con el
  `GITHUB_TOKEN` del flujo y el permiso `packages: write`.
- En el VPS, Dokploy descarga la imagen con un registro GHCR configurado. GHCR solo admite tokens personales
  clásicos: para descargar basta `read:packages`, aunque la guía de Dokploy muestre `write:packages`.
- Las imágenes se etiquetan con la versión (`APP_VERSION`), no solo con `latest`, para poder volver atrás.

### Dominio propio con HTTPS

Los dominios `traefik.me` que genera Dokploy son solo HTTP (HTTPS apagado y sin certificado) y Dokploy los
presenta para desarrollo y pruebas. Meta exige HTTPS con un certificado válido y no admite certificados
autofirmados: con `traefik.me` los webhooks de WhatsApp no funcionan. Cada instalación lleva un dominio o
subdominio propio con Let's Encrypt.

### Copias de seguridad

- La base: las de Supabase (ver «Supabase › Copias de seguridad»).
- Si los archivos van en un volumen del servidor: las copias de volúmenes de Dokploy suben los volúmenes con nombre a
  un destino S3 (AWS S3, Cloudflare R2, Backblaze B2 o Google Cloud Storage), con horario tipo cron. Tienen la opción
  de parar el contenedor mientras copian. Para restaurar, el volumen de destino no puede existir.
- `APP_ENCRYPTION_KEY` se guarda fuera del servidor y fuera del mismo cubo que las copias: sin ella, los
  secretos de la copia son ilegibles; junto a ella, una copia filtrada lo expone todo.

### Nunca «Fresh Volumes»

Desde la versión 0.30.5 (02-09-2026), los Compose de Dokploy tienen un botón «Fresh Volumes» (su diálogo se
titula «Deploy with Fresh Volumes») que ejecuta `docker compose down --volumes` antes de desplegar: borra los volúmenes,
y con ellos los archivos que se guarden ahí. La API tiene la misma opción (`freshVolumes`). No se usa nunca en una
instalación real; los datos solo vuelven desde una copia.

## Fuentes

Consultadas el 26-09-2026 (Vercel, Next.js, pnpm, Dokploy, Docker, GitHub, Meta, Hostinger y cron-job.org) y el
27-09-2026 (Supabase y PGlite). Entre paréntesis, la fecha de actualización que indica la propia fuente.

- Vercel, plan Hobby (14-09-2026): https://vercel.com/docs/plans/hobby
- Vercel, normas de uso justo y uso comercial (14-09-2026): https://vercel.com/docs/limits/fair-use-guidelines
- Vercel, límites de las funciones (24-08-2026): https://vercel.com/docs/functions/limitations
- Vercel, duración máxima (24-08-2026): https://vercel.com/docs/functions/configuring-functions/duration
- Vercel, Fluid compute (24-08-2026): https://vercel.com/docs/fluid-compute
- Vercel, `@vercel/functions` y `waitUntil` (03-09-2026): https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package
- Vercel, cron jobs (16-09-2026): https://vercel.com/docs/cron-jobs
- Vercel, gestionar cron jobs y `CRON_SECRET` (11-08-2026): https://vercel.com/docs/cron-jobs/manage-cron-jobs
- Vercel, precios y límites de cron (15-07-2026): https://vercel.com/docs/cron-jobs/usage-and-pricing
- Vercel, límite de 4,5 MB (10-11-2025): https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions
- Vercel, Deployment Protection (15-09-2026): https://vercel.com/docs/deployment-protection
- Vercel, Vercel Authentication (15-09-2026): https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication
- Vercel, Protection Bypass for Automation (16-09-2026): https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
- Vercel, URL generadas (08-09-2026): https://vercel.com/docs/deployments/generated-urls
- Vercel, variables de sistema (15-07-2026): https://vercel.com/docs/environment-variables/system-environment-variables
- Vercel, variables Sensitive (28-08-2026): https://vercel.com/docs/environment-variables/sensitive-environment-variables
- Vercel, regiones de las funciones (11-08-2026): https://vercel.com/docs/functions/configuring-functions/region
- Vercel, enviar correo desde Vercel (24-09-2026): https://vercel.com/kb/guide/sending-emails-from-an-application-on-vercel
- Next.js 16.3.6, `after` (13-03-2026): https://nextjs.org/docs/app/api-reference/functions/after
- Next.js 16.3.6, `serverExternalPackages` (05-12-2025): https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages
- Next.js 16.3.6, `output` y `outputFileTracingIncludes` (08-10-2025): https://nextjs.org/docs/app/api-reference/config/next-config-js/output
- Next.js 16.3.6, `serverActions` (07-09-2026): https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions
- Next.js 16.3.6, alojamiento propio (25-08-2026): https://nextjs.org/docs/app/guides/self-hosting
- `ffmpeg-static` 5.3.0 en npm (código y `package.json`): https://registry.npmjs.org/ffmpeg-static/latest y https://github.com/eugeneware/ffmpeg-static
- pnpm, ajustes de build (documentación de la versión 12): https://pnpm.io/settings/build
- Supabase, precios y planes: https://supabase.com/pricing
- Supabase, conectar con Postgres (tipos de conexión, IPv4/IPv6, sentencias preparadas, SSL): https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase, Drizzle (`prepare: false`, «Shared Pooler»): https://supabase.com/docs/guides/database/drizzle
- Supabase, cambiar la contraseña de la base: https://supabase.com/docs/guides/troubleshooting/how-do-i-reset-my-supabase-database-password-oTs5sB
- Supabase, claves de la API: https://supabase.com/docs/guides/api/api-keys
- Supabase, API de datos y permisos: https://supabase.com/docs/guides/api/securing-your-api
- Supabase, novedades (tablas que dejan de exponerse, 2026-04-28; Postgres 17): https://supabase.com/changelog.md y https://supabase.com/changelog/45827-deprecation-notice-support-for-postgres-14-ending-on-1st-july-2026
- Supabase, asesores (Security Advisor y avisos `rls_enabled_no_policy`, `rls_disabled_in_public`, `extension_in_public`): https://supabase.com/docs/guides/database/database-advisors
- Supabase, regiones: https://supabase.com/docs/guides/platform/regions y https://supabase.com/docs/guides/troubleshooting/change-project-region-eWJo5Z
- Supabase, RGPD (región concreta de la UE, DPA): https://supabase.com/docs/guides/security/gdpr-compliance
- Supabase, pausa del plan gratuito: https://supabase.com/docs/guides/platform/free-project-pausing
- Supabase, copias de seguridad y PITR: https://supabase.com/docs/guides/platform/backups
- Supabase, copiar y restaurar con la CLI: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore y https://supabase.com/docs/reference/cli/supabase-db-dump
- Supabase Storage, límites de tamaño: https://supabase.com/docs/guides/storage/uploads/file-limits
- Supabase Storage, control de acceso: https://supabase.com/docs/guides/storage/security/access-control
- Supabase Storage, crear buckets: https://supabase.com/docs/guides/storage/buckets/creating-buckets
- supabase-js, direcciones firmadas de subida: https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl
- Supabase Cron: https://supabase.com/docs/guides/cron y https://supabase.com/docs/guides/cron/quickstart
- Panel de Supabase, formulario de los trabajos de cron (código): https://github.com/supabase/supabase/tree/master/apps/studio/components/interfaces/Integrations/CronJobs
- Supabase, `pg_net`: https://supabase.com/docs/guides/database/extensions/pg_net
- Supabase, servidor MCP: https://supabase.com/docs/guides/getting-started/mcp
- Supabase, integración del Marketplace de Vercel: https://supabase.com/docs/guides/integrations/vercel-marketplace
- Supabase, contrato de encargo (DPA) y subencargados: https://supabase.com/legal/dpa y https://supabase.com/legal/customer-resources/subprocessor-list
- PGlite: https://pglite.dev/docs/about
- cron-job.org, preguntas frecuentes: https://cron-job.org/en/faq/
- Dokploy, instalación: https://docs.dokploy.com/docs/core/installation
- Dokploy, guía de producción: https://docs.dokploy.com/docs/core/guides/production-hardening
- Dokploy, Docker Compose: https://docs.dokploy.com/docs/core/docker-compose
- Dokploy, dominios en Compose: https://docs.dokploy.com/docs/core/docker-compose/domains
- Dokploy, utilidades de Compose (Isolated Deployments): https://docs.dokploy.com/docs/core/docker-compose/utilities
- Dokploy, dominios generados `traefik.me`: https://docs.dokploy.com/docs/core/domains/generated
- Dokploy, copias de volúmenes: https://docs.dokploy.com/docs/core/volume-backups
- Dokploy, registro GHCR: https://docs.dokploy.com/docs/core/registry/ghcr
- Dokploy, avisos de seguridad: https://github.com/Dokploy/dokploy/security/advisories
- Dokploy, versiones: https://github.com/Dokploy/dokploy/releases
- Dokploy, «Fresh Volumes» (PR #4195, fusionado el 02-09-2026): https://github.com/Dokploy/dokploy/pull/4195
- Docker Compose, servicios (`depends_on`, `expose`): https://docs.docker.com/reference/compose-file/services/
- Docker Compose, interpolación de variables: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/
- GitHub, publicar imágenes Docker: https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images
- GitHub, Container registry: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- Meta, webhooks (HTTPS y certificado válido): https://developers.facebook.com/docs/graph-api/webhooks/getting-started
- Hostinger, VPS: https://www.hostinger.com/vps-hosting
- Hostinger, plantilla Dokploy (actualizada el 14-08-2026): https://www.hostinger.com/support/9822596-how-to-use-the-dokploy-vps-template-at-hostinger/
