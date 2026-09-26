# Convenciones de código

Cómo se crea el proyecto y cómo se escribe y se organiza el código para que se pueda mantener.

## Crear el proyecto

Por qué Next.js y solo pnpm: `docs/decisions/0002-framework-nextjs.md` y
`docs/decisions/0006-gestor-de-paquetes-pnpm.md`. `create-next-app` no arranca en una carpeta que ya tiene
`README.md`, `AGENTS.md` o `CLAUDE.md`. Por eso:

1. Créalo en una carpeta temporal, fuera del proyecto, con `pnpm dlx create-next-app@<versión>` (fijada
   con el margen de 7 días de `docs/security.md`, que fuera del proyecto no se aplica solo) y todas las
   opciones escritas: `--ts --eslint --tailwind --app --src-dir --import-alias "@/*" --no-react-compiler
   --agents-md --use-pnpm --disable-git --skip-install --yes`. `--yes` usa las preferencias guardadas en el
   ordenador si las hay; por eso no basta con él.
2. Trae aquí sus archivos, también los que empiezan por punto, sin sobrescribir los que ya existen:
   - combina los dos `.gitignore` (la línea `!.env.example` va después de cualquier línea que ignore
     archivos `.env`, y `data/` se ignora: ahí están la base local y los archivos subidos);
   - añade al final de `AGENTS.md` el bloque de Next.js que trae su `AGENTS.md` (desde la 16.3, `next dev`
     lo mantiene al día él solo);
   - descarta su `CLAUDE.md`, su `README.md` y su `pnpm-workspace.yaml`.
3. Crea `pnpm-workspace.yaml` con los ajustes de `docs/security.md` y, después, instala las dependencias
   aquí, con versiones exactas.
4. Inicia shadcn/ui con su CLI instalada como dependencia de desarrollo (`pnpm exec shadcn …`), no con
   `pnpm dlx`, para que respete los ajustes de `pnpm-workspace.yaml`.
5. Prepara Vitest y Playwright como dice `docs/testing.md`, y los comandos de «Cómo se arranca y se prueba»
   de `AGENTS.md`.
6. Pon en `next.config.ts` la configuración de `docs/security.md`.
7. La base de datos no necesita cuenta ni servidor: `pnpm dev` (o `pnpm run setup`) crea `data/local.db`
   con libSQL, aplica las migraciones y carga la demo. Turso y Vercel Blob solo se crean al publicar,
   siguiendo `docs/guia-despliegue.md`, y sus claves las pongo yo.

## Documentación de las librerías

Antes de instalar, actualizar o escribir código con una librería, consulta su documentación actual con
Context7:

- Busca el identificador de la librería con `resolve-library-id` (o `ctx7 library`), salvo que ya lo sepas.
- Pide la documentación con `query-docs` (o `ctx7 docs`): una pregunta concreta y la versión de `package.json`.
- En Next.js manda la documentación del paquete instalado (`node_modules/next/dist/docs/`).
- La web de una librería puede ir por delante de la versión instalada (la de Drizzle ya enseña la 1.0):
  mandan la versión de `package.json` y los tipos de `node_modules`.
- Los datos de los servicios externos (Meta, OpenRouter, Google, Microsoft, Mistral, Telegram, Vercel,
  Turso) ya comprobados están en `docs/integracion-*.md`, `docs/busqueda-hibrida.md` y
  `docs/plataforma-despliegue.md`: se usan esos y, si algo ha cambiado, se corrige allí primero.
- Si no tienes Context7, dímelo y usa la documentación oficial.

## Principios

- Lo más simple que resuelva lo pedido. Nada de capas, abstracciones ni opciones «por si acaso».
- Antes de crear algo, se busca si ya existe y se reutiliza: una misma lógica no se escribe dos veces.
- Cada cambio toca solo lo necesario y sigue el estilo del código que ya hay, aunque haya otra forma válida.
- El código que deja de usarse se borra, no se comenta.

## Organización

- `src/app/`: rutas, páginas, layouts y Route Handlers. Tienen poca lógica: la piden a `src/data/` o a
  `src/server/`.
- `src/components/`: componentes compartidos. Los de shadcn/ui, en `src/components/ui/`.
- Si existe `DESIGN.md`, sus colores, tipografía, bordes y espaciado se ponen una sola vez como tema (las
  variables de shadcn/ui y Tailwind en los estilos globales) y todas las pantallas lo usan. El código que
  exporta una herramienta de diseño es una referencia para ver cómo debe quedar, no código para pegar.
- `src/lib/`: utilidades compartidas (permisos, formatos, esquemas de Zod, datos de cada sector). Los
  clientes de las APIs externas van en `src/lib/<servicio>/` (OpenRouter, Meta, Google, Microsoft, Mistral,
  Telegram, SMTP): cada uno toma su URL base de una variable de entorno y acepta un `fetch` inyectado, para
  poder simularlo en las pruebas. La IA va con un cliente propio de OpenRouter, sin AI SDK
  (`docs/decisions/0005-ia-openrouter-sin-ai-sdk.md`).
- `src/db/`: el esquema de Drizzle, repartido por temas, y la conexión. Solo lo usan `src/data/`,
  `src/server/` y los scripts.
- `src/data/`: el acceso a datos, solo de servidor (`import 'server-only'`). Cada función recibe quién la
  pide (el actor) y comprueba sus permisos con `can()` de `src/lib/permissions.ts` antes de leer o escribir.
- `src/server/`: lo que solo corre en el servidor y no es una pantalla: el trabajo en segundo plano
  (`docs/decisions/0008-trabajo-en-segundo-plano-jobs-y-tick.md`), los canales, la IA, el conocimiento, la
  agenda, los avisos, el cumplimiento, el cifrado y Better Auth.
- Lo que cambiará al pasar a Supabase o a un VPS (búsqueda por vectores y por texto, cola, tiempo real,
  archivos y límites de peticiones) va detrás de una interfaz en `src/server/adapters/`: el resto del
  código no sabe qué hay detrás, y una versión nueva se añade sin tocarlo.
- `scripts/`: lo que lanzan los comandos de `package.json` (arranque, preparación, seed, borrado de la
  base y worker). `seed/`: el contenido de la demo por sector, con sus documentos y embeddings.
- Lo que solo usa una ruta va junto a ella, en carpetas privadas (`_components/`, `_lib/`).
- El proxy de Next.js (`src/proxy.ts`, lo que antes era el middleware) también va en `src/`. En la raíz se
  quedan la configuración, `public/` y `.env.local`.
- Las Server Actions son finas: validan con Zod y llaman a `src/data/`.
- Componentes de servidor por defecto. `'use client'` solo en los que necesitan interacción, y lo más abajo
  posible en el árbol.
- La base de datos cambia solo con migraciones: cada cambio del esquema se genera con `pnpm db:generate`
  (drizzle-kit) como un archivo en `drizzle/`, que se sube a Git, y se aplica con `pnpm db:migrate` o al
  preparar la instalación. Nunca con SQL suelto ni a mano en un panel (el de Turso o, en el futuro, el de
  Supabase), ni con `drizzle-kit push`, que borraría las tablas de la búsqueda: así la base de datos se
  puede volver a crear entera desde el repositorio. Sus tipos salen del esquema, no se escriben a mano.
- Las migraciones solo añaden (tablas, columnas, índices): nunca borran ni renombran lo que usa una
  versión anterior, para que actualizar una instalación no pierda datos. Lo que Drizzle no sabe generar
  (FTS5, índice vectorial, disparadores) va en una migración a medida (`drizzle-kit generate --custom`).
- Las migraciones las genera una sola persona o agente a la vez: una generada más tarde con una fecha
  anterior se salta sin avisar.
- Todas las consultas, con el constructor de Drizzle. SQL propio de SQLite solo en `src/server/adapters/`
  y en `drizzle/`: es lo que habrá que reescribir para Postgres.
- Datos portables, para pasar a Supabase sin reescribirlos: identificadores UUID en texto, fechas en UTC
  (la hora del negocio solo al mostrarlas o al leerlas de un formulario, con su zona horaria), JSON en
  columnas de texto y nada de funciones propias de SQLite fuera de los adaptadores. Las reglas exactas, en
  `docs/decisions/0003-datos-libsql-turso-y-futuro-supabase.md`.
- No se confía en los borrados en cascada: al borrar algo se borran antes sus datos dependientes. El libSQL
  local aplica las claves foráneas (un borrado en mal orden falla), pero no se da por hecho en Turso ni se
  usa `ON DELETE CASCADE`.
- Los datos de ejemplo van en un seed dentro del repositorio, que se carga con `pnpm seed`
  (`--sector=…` para otro sector): datos realistas del negocio y un usuario de prueba de cada rol. Lo usan
  las pruebas, la demo y quien descargue el proyecto para probarlo.
- No se crea una segunda base de datos ni un modo de demostración aparte: la app es la misma, con datos de
  ejemplo. `DEMO_MODE` solo añade el aviso «Modo demo» y canales marcados «Demo» que nunca llaman a
  servicios reales, y solo se activa en local.
- Cuando el proyecto crezca, el código se agrupa por funcionalidad, y se explica en `docs/architecture.md`.

## TypeScript y nombres

- Modo estricto. Nada de `any`: si no se conoce el tipo, `unknown`, y se valida. Nada de `@ts-ignore` ni de
  desactivar ESLint sin un comentario que explique por qué.
- Los tipos de lo que entra (formularios, API) salen de los esquemas de Zod.
- Nombres en inglés en el código y en español los textos que ve el usuario (español de España, tratando de
  tú). Nombres que dicen qué hacen: `getOverdueInvoices`, no `getData`.
- Archivos en minúsculas con guiones (`invoice-list.tsx`) y componentes en PascalCase (`InvoiceList`).
- Funciones cortas que hacen una sola cosa. Un archivo que pasa de unas 300 líneas o mezcla temas se divide.
- Nada de números ni textos sueltos repetidos: constantes con nombre.

## Errores y estilo

- Los errores esperados (datos no válidos, «no encontrado», sin permiso) se devuelven como resultado y se
  explican al usuario; los inesperados se lanzan y los recoge `error.tsx`. Nunca un `catch` vacío ni un
  error ignorado.
- Los comentarios explican el porqué, no el qué. Sin código comentado ni `console.log` de depuración en lo
  que se sube.
