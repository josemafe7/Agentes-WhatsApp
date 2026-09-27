# 0003 · Datos: libSQL (archivo local y Turso) ahora, Supabase en el futuro

- **Estado:** sustituida por 0024
- **Fecha:** 2026-09-26

## Contexto y problema

La plantilla recomienda Supabase para datos, usuarios y archivos. El encargo (§2 y §3) pide otra cosa: quien
clona el repositorio tiene que poder probarlo todo sin crear cuentas, así que ahora se usa SQLite con libSQL
(un archivo en local y Turso cuando se publique en Vercel), y Supabase queda para el futuro, con el código
preparado: IDs UUID en texto, fechas en UTC, JSON en columnas de texto, nada de SQL específico fuera de los
adaptadores y la búsqueda, la cola, el tiempo real y los archivos detrás de interfaces. Había que concretar
esas reglas para que el paso a Postgres no obligue a reescribir la app.

Datos comprobados el 26-09-2026:

- Las funciones de Vercel tienen el sistema de archivos de solo lectura, con `/tmp` de hasta 500 MB como
  espacio temporal (https://vercel.com/docs/functions/runtimes, actualizada el 12-08-2026): un archivo SQLite
  no sobrevive allí.
- `@libsql/client` 0.18.0 trae un binario compilado con FTS5 y con vectores, ya compilado para Windows,
  macOS y Linux y sin scripts de instalación (`docs/busqueda-hibrida.md`, §1).
- Turso Cloud tiene dos motores. `turso db create` crea una base libSQL, con FTS5 precargado y vectores
  nativos; `--tursodb` crea el motor nuevo, que no tiene FTS5 ni el índice vectorial de libSQL. Nunca se usa
  `--tursodb` (`docs/plataforma-despliegue.md`, «Turso»; `docs/busqueda-hibrida.md`, §1).
- Turso Free: 5 GB, 500 millones de filas leídas y 10 millones escritas al mes; la base se archiva tras 10
  días sin uso y el plan no incluye contrato de encargo del tratamiento (DPA). Vale para pruebas; un negocio
  real con datos personales necesita un plan con DPA (deducción a partir de la tabla de precios,
  `docs/plataforma-despliegue.md`, «Plan gratuito»).
- En Turso, una transacción interactiva bloquea las escrituras hasta que termina, con un tope de 5 s, y
  `VACUUM` está desactivado (`docs/plataforma-despliegue.md`, «Conexión y limitaciones»).
- `@libsql/client` 0.18.0 abre en local hasta 20 conexiones, con espera por bloqueo 0 por defecto y claves
  ajenas desactivadas en cada conexión: hay que fijar la espera y el modo WAL, y no fiarse de los borrados en
  cascada (código publicado de `@libsql/client` 0.18.0 y documentación de Turso sobre `PRAGMA foreign_keys`).
  Al construir la fase 0 se comprobó que el libSQL local sí activa las claves ajenas en cada conexión, y que
  una espera por bloqueo síncrona puede colgar el proceso: no se fija, y `src/db/busy-retry.ts` reintenta sin
  bloquear. Lo de no fiarse de las cascadas sigue igual.
- Drizzle ORM 0.45.2 es el mínimo (corrige una inyección SQL en `sql.identifier()`), con drizzle-kit
  0.31.10; sus migraciones son `drizzle/NNNN_nombre.sql` más `drizzle/meta/_journal.json`
  (https://github.com/drizzle-team/drizzle-orm/releases). El esquema de Drizzle es propio de cada motor
  (`sqliteTable` o `pgTable`), así que Postgres necesitará su propio esquema
  (https://orm.drizzle.team/docs/sql-schema-declaration).
- `drizzle-kit push` vería las tablas de FTS5 y del índice vectorial e intentaría borrarlas; las migraciones
  a medida se crean con `drizzle-kit generate --custom` (`docs/busqueda-hibrida.md`, §4).
- Con clave primaria UUID en texto, el `rowid` de SQLite es implícito y puede cambiar con `VACUUM` o si
  drizzle-kit recrea una tabla; el índice vectorial y FTS5 apuntan a ese `rowid` y hay que reconstruirlos
  (`docs/busqueda-hibrida.md`, §4).
- SQLite admite `RETURNING` en `INSERT`, `UPDATE` y `DELETE` desde la versión 3.35.0
  (https://www.sqlite.org/lang_returning.html), lo que permite reclamar trabajos de la cola en una sola orden.
- Para el futuro: el plan Free de Supabase se pausa tras 7 días de poca actividad, y desde un VPS solo IPv4 se
  conecta por el pooler en modo sesión; los vectores irán en `halfvec(1536)` con HNSW y el texto con la
  configuración `es_unaccent`, que sí saca raíces en español, a diferencia de FTS5 (`docs/busqueda-hibrida.md`,
  §8 y §9).

## Opciones consideradas

- **Supabase desde el principio** (la recomendada por la plantilla): exige una cuenta y un proyecto externo
  antes de poder probar nada, lo que rompe el arranque sin configurar del encargo, y su plan gratuito se pausa.
- **SQLite en un archivo con otra librería** (por ejemplo, Prisma o better-sqlite3): funciona en local y en un
  VPS, pero no en Vercel, donde el disco no persiste.
- **libSQL con Drizzle**: archivo en local, Turso al publicar en Vercel, y código preparado para Postgres.

## Decisión

libSQL con `@libsql/client` y Drizzle (dialecto SQLite). En local, `DATABASE_URL=file:./data/local.db`; al
publicar en Vercel, `DATABASE_URL=libsql://…` y `DATABASE_AUTH_TOKEN`, con una base del motor libSQL en una
región de la UE. Reglas de portabilidad, obligatorias en todo el código:

1. **IDs:** UUID v4 en texto (`crypto.randomUUID()`), también en las tablas de Better Auth.
2. **Fechas:** siempre en UTC, guardadas como entero en milisegundos (`timestamp_ms`, que Drizzle entrega como
   `Date`). La zona horaria del negocio (por defecto `Europe/Madrid`) solo se aplica al leer lo que escribe la
   persona y al mostrarlo.
3. **JSON:** en columnas de texto con su tipo (`text` en modo `json`); los booleanos, en enteros (modo
   `boolean`).
4. **SQL:** nada de SQL propio de un motor fuera de `src/server/adapters/**` y de las migraciones de
   `drizzle/`. El resto usa el constructor de consultas de Drizzle. Todo valor va como parámetro; nunca
   `sql.raw` con algo que venga de fuera.
5. **Interfaces:** `VectorSearch`, `TextSearch`, `JobQueue`, `Realtime`, `FileStorage` y `RateLimiter`, con
   implementación libSQL, disco o Vercel Blob. Una implementación para Postgres o Supabase se añade sin tocar a
   quien las usa.
6. **Migraciones:** generadas con `drizzle-kit generate` y, las de FTS5 y el índice vectorial, con
   `--custom`. Solo aditivas, las genera una sola persona o agente a la vez (el integrador de la fase) y nunca
   se usa `drizzle-kit push`. En Turso se aplican antes de publicar, a mano o desde CI, nunca en el build de
   Vercel, que también corre para las previews (`docs/plataforma-despliegue.md`, «Turso»).
7. **Borrados:** los registros hijos se borran de forma explícita en la misma transacción, sin depender de
   `ON DELETE CASCADE`.
8. **Transacciones cortas:** leer y escribir, sin llamadas a servicios externos dentro (el bloqueo de Turso es
   de 5 s).

## Consecuencias

- Gana: la demo arranca sin cuentas externas; el mismo motor, con FTS5 y vectores, en local y en Turso; y un
  camino a Supabase que no obliga a reescribir la lógica del negocio.
- Acepta: pasar a Supabase exigirá un segundo esquema de Drizzle para Postgres, las implementaciones de los
  adaptadores y una migración de datos (milisegundos a `timestamptz`, `F32_BLOB` a `halfvec`). La búsqueda
  por texto no dará exactamente los mismos resultados en los dos motores.
- Acepta: SQLite admite un solo escritor a la vez; la cola y las citas se diseñan con escrituras cortas.
- Acepta: tras un `VACUUM` o una tabla recreada por drizzle-kit hay que reconstruir los índices de búsqueda.
- Turso Free solo sirve para pruebas; un negocio real necesita un plan con DPA o el VPS.
- SQLite no tiene Row Level Security: las reglas de `docs/security.md` escritas para Supabase se cumplen con
  su equivalente (permisos comprobados en el servidor en `src/data/*`, ver 0004), y Row Level Security vuelve
  a ser obligatorio el día que los datos pasen a Supabase. `docs/security.md` y `docs/conventions.md` aún
  describen Supabase y hay que adaptarlos a esta decisión, como pide `AGENTS.md` («Tecnologías»).
