# 0006 · Gestor de paquetes: solo pnpm

- **Estado:** aceptada
- **Fecha:** 2026-09-26

## Contexto y problema

El encargo (§3) pide que quien clone el repositorio arranque con `npm install && npm run dev`, y habla de
`npm run seed -- --sector=X`. `AGENTS.md` («Seguridad») dice que los paquetes se instalan solo con pnpm y que se
usa `pnpm dlx` en vez de `npx`. Había que elegir uno y fijar la versión de pnpm y de Node.

Decisión de la persona el 26-09-2026: **solo pnpm**. El arranque es `pnpm install && pnpm dev` y la demo de otro
sector se carga con `pnpm seed --sector=X`.

Datos comprobados el 26-09-2026:

- pnpm permite las protecciones de `docs/security.md` («Dependencias»): `minimumReleaseAge: 10080` (7 días),
  `trustPolicy: no-downgrade`, `blockExoticSubdeps` y `strictDepBuilds`, y aprobar los scripts de
  instalación uno a uno con `allowBuilds` (https://pnpm.io/10.x/settings).
- Se resolvió el árbol completo de dependencias previsto (1.109 paquetes) con pnpm 10.30.3 y Node 24.11, sin
  descargar ni ejecutar nada. Resultado:
  - solo `ffmpeg-static` necesita su script de instalación, que descarga el binario de FFmpeg 6.1.1 (licencia
    GPL-3.0-or-later) de las releases de GitHub sin comprobación de huella visible;
  - hacen falta dos exclusiones de `trustPolicy` (`eslint-import-resolver-typescript@3.10.1` y
    `semver@6.3.1`), dos versiones antiguas sin procedencia que llegan como dependencias indirectas;
  - `minimumReleaseAgeExclude` no admite patrones como `@next/*@16.3.6`: se listan los nombres exactos.
  Las tres cosas necesitan el permiso de la persona (`AGENTS.md`, «Seguridad»).
- `allowBuilds` existe desde pnpm 10.26 y sustituye a `onlyBuiltDependencies`, que desaparece en pnpm 11. Ya
  existen pnpm 11 (28-04-2026) y 12 (26-08-2026); la última 10.x es la 10.34.5 (10-07-2026)
  (https://pnpm.io/settings/build; https://registry.npmjs.org/pnpm).
- Node 24 es LTS desde el 28-10-2025, pasa a mantenimiento el 20-10-2026 y tiene soporte hasta el 30-04-2028;
  Node 26 será LTS el 28-10-2026 (https://github.com/nodejs/Release). Las dependencias piden Node 20 o
  posterior (ImapFlow 2, Nodemailer 10), 22 o posterior (unpdf) y `^22.12 || ^24` (Vitest 5)
  (`docs/integracion-correo.md` y registro de npm).

## Opciones consideradas

- **npm**, como decía el encargo: va en contra de `AGENTS.md`, y los ajustes de `docs/security.md`
  (`trustPolicy`, `allowBuilds`, `strictDepBuilds`…) están escritos para pnpm.
- **Solo pnpm, línea 10.x** (10.30 o posterior).
- **Solo pnpm, última versión mayor (12):** cambia ajustes y comportamiento; es un salto que se decide aparte.

## Decisión

Solo pnpm, de la línea 10.x (10.30 o posterior), con Node 24 LTS.

- Los comandos del proyecto son `pnpm …`; nunca `npm` ni `npx` (se usa `pnpm dlx`). Nunca hay
  `package-lock.json`: si aparece, alguien ha usado npm y se avisa.
- `pnpm-lock.yaml` va a Git y `pnpm-workspace.yaml` lleva los ajustes de `docs/security.md`, con `allowBuilds`
  (no `onlyBuiltDependencies`), para que el paso futuro a pnpm 11 o posterior no rompa la instalación.
- Pasar a pnpm 11/12 o a Node 26 se decide aparte, con una decisión nueva.
- Las excepciones (el parche de Next.js dentro del margen, las dos exclusiones de confianza y el script de
  `ffmpeg-static`) solo se aplican con el permiso de la persona y se apuntan en «Excepciones aprobadas» de
  `docs/security.md`. La exclusión del parche de Next.js se quita cuando cumpla 7 días (29-09-2026).

## Consecuencias

- Gana: protecciones de la cadena de suministro activas por defecto, un solo lockfile y un solo juego de
  órdenes en el README, las guías y las skills.
- Acepta: quien clone el repositorio necesita pnpm instalado; el README explica cómo (según `AGENTS.md`, npm
  solo se usa para instalar pnpm y con `--ignore-scripts --min-release-age=7`).
- Acepta: Node 24 pasa a mantenimiento en octubre de 2026; sigue con soporte hasta abril de 2028, y el cambio a
  Node 26 se estudiará en el mantenimiento.
- Acepta: un paquete nuevo con script de instalación hace fallar la instalación hasta que se revisa y se
  aprueba (`strictDepBuilds`). Es lo que se busca.
