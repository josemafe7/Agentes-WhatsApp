# 0024 · Datos y archivos en Supabase, con Postgres integrado para la demo y las pruebas

- **Estado:** aceptada
- **Fecha:** 2026-09-27

Sustituye a 0003 (datos en libSQL y Turso) y a 0010 (archivos en disco y Vercel Blob).

## Contexto y problema

El propietario decidió el 2026-09-27 pasar ya a Supabase (fase 8 de `docs/spec.md`): la base de datos en Postgres,
los archivos en Supabase Storage y el cron de cada minuto en Supabase, en lugar de Turso, Vercel Blob y
cron-job.org. Lo que no puede cambiar: quien clona el repositorio arranca la demo con `pnpm install && pnpm dev`
sin crear cuentas ni instalar Docker ([ARR-01]), las pruebas nunca tocan servicios reales, la app es de un solo
negocio (0001) y los usuarios siguen con Better Auth (0004). Había que decidir qué base usan la demo y las pruebas,
cómo se conserva lo que el código daba por hecho con SQLite (un solo escritor a la vez) y qué se hace con las
migraciones de SQLite. No había ninguna instalación real con SQLite ni con Turso: nada que migrar.

Datos comprobados el 2026-09-27:

- PGlite 0.5.8 (`@electric-sql/pglite`) es PostgreSQL 18.3 compilado a WebAssembly, que corre dentro del proceso
  de Node y guarda la base en una carpeta, sin servidor ni Docker; con `@electric-sql/pglite-pgvector` 0.0.9 trae
  pgvector 0.8.1, y `unaccent` viene incluida. Comprobado con los paquetes instalados: `halfvec` con índice HNSW,
  `hnsw.iterative_scan`, la configuración de texto `es_unaccent` en una columna generada con índice GIN y
  `ENABLE ROW LEVEL SECURITY` funcionan. Tres diferencias con un servidor: no guarda el `search_path` (hay que
  fijarlo al abrir), no impide que dos procesos abran la misma carpeta (hay que poner un candado propio) y, mientras
  hay una transacción abierta, cualquier otra consulta de la misma instancia espera a que termine.
- Supabase: Postgres 17 es la última versión que ofrece
  (https://supabase.com/changelog/45827-deprecation-notice-support-for-postgres-14-ending-on-1st-july-2026).
  Conexiones: la directa es IPv6 (o IPv4 con un complemento de pago); el pooler compartido en modo sesión (puerto
  5432) sirve desde redes IPv4 y servidores que siguen encendidos; el modo transacción (puerto 6543) es el de las
  funciones sin servidor y no admite sentencias preparadas; SSL con `require`
  (https://supabase.com/docs/guides/database/connecting-to-postgres).
- Las claves secretas (`sb_secret_…`) son solo para el servidor, se saltan Row Level Security y Supabase las
  rechaza con 401 si llegan desde un navegador; las antiguas `anon` y `service_role` se retiran a finales de 2026
  (https://supabase.com/docs/guides/api/api-keys).
- La API de datos de Supabase deja de exponer las tablas nuevas: por defecto en los proyectos nuevos desde el
  2026-05-30 y en todos desde el 2026-10-30 (https://supabase.com/changelog.md, entrada del 2026-04-28).
- Copias: el plan Free no tiene copias automáticas; Pro guarda 7 días de copias diarias; la restauración a un
  momento anterior (PITR) es un complemento de pago; las copias de la base no llevan los archivos de Storage
  (https://supabase.com/docs/guides/platform/backups).
- Supabase Cron programa trabajos con `pg_cron` desde Integrations › Cron, también peticiones HTTP a cualquier
  dirección (https://supabase.com/docs/guides/cron).
- Un bucket privado solo se abre con políticas de RLS o con la clave secreta, que se las salta
  (https://supabase.com/docs/guides/storage/security/access-control). En Free, cada archivo tiene como mucho 50 MB
  (https://supabase.com/docs/guides/storage/uploads/file-limits).
- La región se elige al crear el proyecto y no se puede cambiar; West Europe (London) es `eu-west-2` y West EU
  (Ireland), `eu-west-1` (https://supabase.com/docs/guides/platform/regions,
  https://supabase.com/docs/guides/troubleshooting/change-project-region-eWJo5Z).
- Supabase Realtime decide quién recibe cada cambio con Row Level Security y el token de los usuarios de Supabase
  Auth (https://supabase.com/docs/guides/realtime/authorization).

## Opciones consideradas

- **Supabase también en local, con su CLI (`supabase start`):** necesita Docker, y el clon limpio dejaría de
  arrancar sin instalar nada.
- **Un Postgres propio con Docker para la demo y las pruebas:** el mismo problema.
- **SQLite en local y Postgres al publicar:** dos esquemas, dos juegos de adaptadores y unas pruebas que solo
  prueban uno de los dos motores.
- **Postgres en todas partes: Supabase al publicar y PGlite (Postgres integrado) para la demo y las pruebas.**

## Decisión

La última. Postgres con Drizzle (dialecto `postgresql`, un solo esquema en `src/db/schema/`) en la demo, en las
pruebas y al publicar.

- **Supabase, solo para la app publicada** (decisión del propietario del 2026-09-27). Quien clona el repositorio, y
  el propio ordenador del propietario, trabajan con la base integrada, sin Supabase ni cuentas (solo la clave de
  OpenRouter, para la IA). `DATABASE_URL`, `SUPABASE_URL` y `SUPABASE_SECRET_KEY` van en las variables de entorno de
  Vercel, marcadas Sensitive, nunca en `.env.local`. Una instalación publicada empieza vacía, con el asistente de
  arranque (un negocio real), o con la demo para enseñar la app, cargada con `pnpm seed` y esas tres variables puestas
  solo para esa orden (o por Claude Code con el conector de Supabase). Las contraseñas de la demo están en el README:
  publicada, se cambian nada más cargarla, no lleva claves reales mientras tanto y se vacía con
  `pnpm db:fresh --remote-i-know` antes de trabajar con clientes.
- **Qué base se abre (`DATABASE_URL`):** una dirección `postgres://` o `postgresql://` es un servidor (Supabase),
  con postgres.js sin sentencias preparadas, SSL obligatorio (salvo con un Postgres de este mismo ordenador) y 5
  conexiones; vacía, la base integrada en `data/pglite`; `pglite:<carpeta>` o `pglite:memory` para las pruebas. Un
  `file:` de SQLite que siga en un `.env.local` antiguo cuenta como vacía (las herramientas avisan una vez de que esa
  línea sobra) y `libsql://` da un error que pide la conexión de Supabase. En Vercel sin conexión de servidor, un
  error claro y `/api/health` responde 503.
- **La base integrada, para la demo y las pruebas:** la abre un solo proceso. Un candado (`data/pglite.lock`, con el
  número del proceso) hace que un segundo proceso se niegue con un mensaje en español en vez de estropear la base. Por
  eso `pnpm worker`, que corre junto a la app en un servidor propio, necesita Supabase.
- **Row Level Security en todas las tablas**, activado en la misma migración que crea cada una (`.enableRLS()` en
  el esquema) y sin políticas: nadie entra por la API de datos de Supabase. La app se conecta solo desde el servidor,
  como propietaria de las tablas, a la que Row Level Security no se aplica; los permisos siguen en `src/data/`
  (0004). Una prueba falla si una tabla de `public` no lo tiene. Es el equivalente de lo que se había previsto (un
  disparador que lo activara solo en las tablas nuevas), sin código que corra dentro de la base.
- **Un escritor a la vez, como con SQLite:** cada transacción de primer nivel fija `lock_timeout` a 15 s y toma
  `pg_advisory_xact_lock(727252001)`, un candado de toda la base que se suelta al terminar la transacción (las
  anidadas no lo vuelven a pedir y las de solo lectura no lo necesitan). Por qué: la app se construyó sobre el único escritor de SQLite (`BEGIN
  IMMEDIATE`), y de eso dependen las citas sin dobles reservas ([AGD-13]), la cola, el orden de los eventos de las
  pantallas y las comprobaciones de la demo. Conservarlo evita reescribir y volver a demostrar todo eso, y para un
  solo negocio las escrituras en fila no se notan. Es de transacción, así que funciona con el pooler en modo
  transacción de Vercel (uno de sesión no serviría). Se quita `src/server/booking/write-queue.ts`, que ya no hace
  falta.
- **Cola:** la misma tabla `jobs` (0008); un trabajo se reclama con `FOR UPDATE SKIP LOCKED`.
- **Tiempo real:** sigue el sondeo (0009). Supabase Realtime no se usa: reparte los cambios según los usuarios de
  Supabase Auth y Row Level Security, y aquí los usuarios son de Better Auth. El número de orden de cada evento
  crece en el orden en que se confirman, con su propio candado (`pg_advisory_xact_lock(727252002)`).
- **Búsqueda del conocimiento:** embeddings en `halfvec(1536)` con índice HNSW, y texto en una columna generada
  `tsvector` con la configuración `es_unaccent`, que quita tildes y ahora sí saca las raíces del español («tintes»
  encuentra «tinte»). Las extensiones `vector` y `unaccent`, en el esquema `extensions`. Detalle en
  `docs/busqueda-hibrida.md`.
- **Archivos:** la interfaz `FileStorage` (con lo que ya decía 0010: claves al azar, nunca una dirección pública,
  servidos solo por `/api/files/…` tras comprobar el permiso) guarda en disco (`data/uploads`) en local y, con
  `SUPABASE_URL` y `SUPABASE_SECRET_KEY` (solo en el servidor, nunca con `NEXT_PUBLIC_`), en el bucket privado
  `dominia-archivos` de Supabase Storage, que la app crea la primera vez si no existe. En Vercel sin esas variables,
  un error claro: su disco no conserva nada. Se quita Vercel Blob.
- **Usuarios:** Better Auth (0004) con su adaptador de Drizzle para Postgres; sus tablas, en la misma base.
- **Cron:** un trabajo de Supabase Cron (Integrations › Cron) llama cada minuto a `/api/cron/tick` con
  `Authorization: Bearer <CRON_SECRET>`. Ya no hace falta cron-job.org. `vercel.json` mantiene su cron diario.
- **Migraciones:** las seis de SQLite se sustituyen por una base de Postgres: `0000_extensions` (a medida: el
  esquema `extensions`, `vector`, `unaccent` y `es_unaccent`) y `0001_initial` (generada: 54 tablas, Row Level
  Security, índices y la columna del texto). Las aplica el migrador de Drizzle (su tabla es
  `drizzle.__drizzle_migrations`), nunca `drizzle-kit push`. Desde aquí, solo aditivas. En Supabase se aplican desde el
  ordenador de quien publica, con `DATABASE_URL` puesta solo para esa orden en la terminal (`pnpm db:migrate`), o las
  aplica Claude Code con el conector de Supabase (su servidor MCP) dejándolas anotadas en esa misma tabla; nunca en el
  build de Vercel, que también corre para las versiones de prueba.
- **Región:** la base de Supabase y las funciones de Vercel, en la misma ciudad, porque cada consulta va de una a
  otra. El proyecto del propietario está en Londres (West Europe (London), `eu-west-2`) y `vercel.json` pone las
  funciones en Londres (`lhr1`); Irlanda (`eu-west-1` con `dub1`) también vale, cambiando `vercel.json` y su prueba.
  El Reino Unido no es de la UE, aunque la UE le reconoce una protección de datos adecuada: con datos de clientes, el
  negocio lo revisa con su abogado.
- **Errores de la base:** de un error de Postgres solo se registran su código (SQLSTATE) y el nombre de la
  restricción, nunca el mensaje ni el detalle, que pueden llevar datos personales; un duplicado se reconoce por el
  código `23505`.
- **Texto que Postgres no admite:** el carácter nulo (NUL), en texto y en `jsonb`, y la mitad suelta de un carácter
  compuesto, en `jsonb`; SQLite los aceptaba. Lo que entra de fuera se limpia antes de guardarlo
  (`src/server/storable-text.ts`): ningún mensaje se pierde ni bloquea un buzón por un carácter.
- **Siguen las reglas de portabilidad de 0003 que aún sirven:** ids UUID en texto; fechas en UTC
  (`timestamp with time zone` con milisegundos); JSON con su tipo (`jsonb`, o `json` donde importa el orden de las
  claves, que `jsonb` no guarda); SQL propio solo en los adaptadores, la conexión y las migraciones, siempre con
  parámetros; los hijos se borran a mano, sin `ON DELETE CASCADE`; y transacciones cortas, sin llamar dentro a
  servicios externos. Donde SQLite y Postgres ordenan o comparan distinto (los vacíos al ordenar, `LIKE` con
  mayúsculas) se escribe explícito para que la app haga lo mismo que antes.

## Consecuencias

- Gana: el mismo motor en la demo, en las pruebas y publicado; búsqueda por palabras con raíces del español; Row
  Level Security, que deja cerrada la API de datos de Supabase aunque alguien la abriera; base, archivos y cron en un
  solo proveedor, en Europa, con un tercero menos (cron-job.org); y el clon limpio sigue arrancando sin cuentas ni
  Docker.
- Acepta: el Security Advisor de Supabase enseña un aviso informativo «RLS Enabled No Policy» por cada tabla. Es lo
  que se busca (nadie entra por la API de datos): no se añaden políticas para quitarlo.
- Acepta: la base integrada la abre un solo proceso. No se pueden tener a la vez `pnpm dev`, `pnpm worker` y
  `pnpm db:reset` sobre ella. En un ordenador sirve para la demo y para probar (también la versión compilada con el
  asistente); un negocio real va publicado, con Supabase (o, más adelante, en un servidor propio con Supabase).
- Acepta: la base integrada es Postgres 18 y Supabase, 17. La app no usa nada propio de la 18, pero las pruebas no
  lo garantizan solas: se comprueba contra un proyecto de Supabase (fase 8).
- Acepta: las escrituras van de una en una en toda la instalación. Una que espera el candado más de 15 s falla con
  error: un trabajo de la cola se reintenta y una persona ve un error y puede repetirlo. Las transacciones tienen que
  seguir siendo cortas. Las transacciones de solo lectura (como la de la búsqueda por el índice de vectores) no toman
  el candado, así que las búsquedas no esperan a las escrituras.
- Acepta: el plan Free de Supabase no tiene copias automáticas, se pausa tras una semana con poca actividad y
  limita cada archivo a 50 MB, cuando un documento de WhatsApp puede llegar a 100 MB. Sirve para pruebas; un negocio
  real necesita Pro (copias diarias de 7 días), con el límite de tamaño de Storage subido a 100 MB. Las copias de la
  base no llevan los archivos.
- Acepta: `CRON_SECRET` queda guardado en la definición del trabajo de cron, dentro de la base de Supabase: lo ve
  quien entra en el proyecto. Solo permite lanzar `tick()`, que se puede repetir sin efecto.
- Acepta: en Vercel, una subida de más de 4,5 MB sigue sin caber en una petición. Subir directo del navegador a
  Storage con una dirección firmada de subida (`createSignedUploadUrl` de supabase-js) queda pendiente, como antes
  con Blob.
- El contrato de encargo del tratamiento de Supabase forma parte de su contrato (https://supabase.com/legal/dpa);
  su lista de subencargados está en https://supabase.com/legal/customer-resources/subprocessor-list.
