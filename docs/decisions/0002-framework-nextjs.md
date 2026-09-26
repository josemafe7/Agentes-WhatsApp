# 0002 · Framework: Next.js con runtime de Node en todas las rutas

- **Estado:** aceptada
- **Fecha:** 2026-09-26

## Contexto y problema

La plantilla recomienda Next.js y el encargo (§2) lo fija: App Router, versión estable, runtime de Node,
TypeScript estricto, Tailwind, shadcn/ui, Drizzle y Zod. Quedaba por decidir qué versión exacta, en qué
runtime corre cada ruta y qué hacer donde la última versión de una herramienta choca con otra.

Datos comprobados el 26-09-2026:

- La línea actual es Next.js 16.3. La 16.3.6 (22-09-2026) corrige CVE-2026-94545 / GHSA-vcvr-r3jv-pc5j,
  crítica (CVSS 9,5): ejecución remota de código en `ImageResponse` de `next/og` en Node, que afecta a las
  versiones de 16.2.0 a 16.3.5. Está dentro del margen de 7 días, así que instalarla necesita excluirla de
  `minimumReleaseAge` con nombres exactos y el permiso de la persona
  (https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j).
- En Next.js 16 `middleware` pasa a llamarse `proxy` (`src/proxy.ts`), corre en Node por defecto y no cubre
  todas las peticiones: la sesión se comprueba en cada página, acción y ruta
  (https://nextjs.org/docs/app/api-reference/file-conventions/proxy).
- `after()` es estable desde Next.js 15.1, funciona con el servidor de Node y en Docker, y en Vercel se apoya
  en `waitUntil` con el mismo tope de duración que la ruta
  (https://nextjs.org/docs/app/api-reference/functions/after; `docs/plataforma-despliegue.md`).
- Varias piezas necesitan Node: `@libsql/client` con `file:` usa el módulo nativo `libsql`, `ffmpeg-static`
  ejecuta un binario, e ImapFlow y Nodemailer abren conexiones TCP. Next.js ya deja fuera del empaquetado
  `@libsql/client` y `libsql`, pero `ffmpeg-static` hay que añadirlo a `serverExternalPackages`
  (https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages;
  `docs/plataforma-despliegue.md`, «Paquetes con binarios o módulos nativos»).
- `output: 'standalone'` genera un servidor mínimo para Docker, que servirá para el futuro VPS
  (`docs/plataforma-despliegue.md`, «docker-compose»).
- TypeScript 7 no trae la API de compilador en JavaScript y typescript-eslint solo admite versiones
  anteriores a la 6.1: se usa TypeScript 6.0.3 (https://typescript-eslint.io/users/dependency-versions).
- `eslint-config-next` 16.3 falla con ESLint 10 (https://github.com/vercel/next.js/issues/89764, abierta) y
  ESLint 9 dejó de tener soporte el 06-08-2026 (https://eslint.org/version-support): la opción es ESLint
  9.39.5 como excepción solo de desarrollo, pendiente de aprobar, o cambiar a Biome.

## Opciones consideradas

- **Next.js con runtime de Node en todas las rutas.**
- **Next.js con algunas rutas en runtime Edge:** el runtime Edge no puede cargar los módulos nativos ni abrir
  las conexiones que necesitan libSQL en local, ffmpeg o ImapFlow.
- **Otro framework:** la plantilla y toda su documentación están escritas para Next.js
  (`docs/interview.md`).

## Decisión

Next.js 16.3 (la última estable que permita el margen de 7 días; la 16.3.6 si la persona aprueba la excepción
del parche de seguridad, y si no la 16.3.5 sin usar `next/og` con textos del negocio o de los usuarios), con
App Router y carpeta `src/`, TypeScript 6 estricto, Tailwind v4 con shadcn/ui, Zod v4 y Server Components por
defecto. Todas las rutas usan `runtime = 'nodejs'`; ninguna usa Edge. `proxy.ts` solo hace redirecciones
baratas (si no hay cookie de sesión, al inicio de sesión) y nunca es la frontera de seguridad.

## Consecuencias

- Gana: el mismo código corre en local (`pnpm dev`), en Vercel y en un VPS con Docker (`standalone`), y
  `after()` está disponible en los tres. Las dependencias nativas funcionan sin trucos.
- Acepta: TypeScript y ESLint quedan una versión por detrás hasta que typescript-eslint y
  `eslint-config-next` admitan las nuevas; se revisa en el mantenimiento. Si se aprueba ESLint 9, se apunta
  como excepción en `docs/security.md`.
- Acepta: `ffmpeg-static` necesita configuración propia en `next.config.ts` y su binario se comprueba en el
  primer despliegue real.
- Desde Next.js 16.3, `next dev` vuelve a escribir su bloque de reglas en `AGENTS.md` si detecta un agente de
  código (https://nextjs.org/docs/app/guides/ai-agents): el bloque se deja y se sube a Git.
