# 0007 · Publicación: solo en local por ahora, Vercel para pruebas después y VPS con Dokploy en el futuro

- **Estado:** aceptada
- **Fecha:** 2026-09-26

## Contexto y problema

El encargo (§2 y §12) pide publicar ahora en Vercel, para pruebas, y en el futuro en un VPS con Dokploy, con el
mismo código para los dos. La fase 0 terminaba con la app en `xxx.vercel.app` y la fase 3, con una prueba en
Vercel con el número de prueba de Meta. La plantilla recomienda Vercel.

Decisión de la persona el 26-09-2026: **de momento, solo en local**. Se dejan preparadas la configuración y la
guía para Vercel con Turso y Blob (con Supabase desde 0024), pero no se publica nada, y los agentes no escriben en
Vercel, Turso ni Supabase a través de sus servidores MCP (ver 0024: en la fase 8, con permiso expreso, sí en el
proyecto de Supabase del propietario). La especificación ya recoge el cambio en sus fases.

Datos comprobados el 26-09-2026 (`docs/plataforma-despliegue.md`, salvo donde se indica otra fuente):

- Vercel Hobby es solo para uso personal no comercial; instalar la app para un negocio que paga es uso
  comercial. Hobby sirve para probar y enseñar la demo; un negocio real necesita Pro o el VPS.
- Hobby: funciones de 300 s como máximo, cron como mucho una vez al día (una expresión más frecuente hace fallar
  el despliegue), cuerpos de 4,5 MB y 1 millón de invocaciones al mes; si se supera un límite, esa función queda
  parada 30 días.
- «Standard Protection» protege todas las URL salvo los dominios de producción: los webhooks y las URI de
  redirección de OAuth usan siempre el dominio de producción (`VERCEL_PROJECT_PRODUCTION_URL`).
- Meta exige HTTPS con un certificado válido para los webhooks (`docs/plataforma-despliegue.md`, «Dominio
  propio con HTTPS»). Sin una URL pública con HTTPS, los WhatsApp reales no llegan a una instalación local; en
  local se usan los canales de demo y el simulador.
- Dokploy publicó unos 50 avisos de seguridad el 21-07-2026 (versiones hasta la 0.29.8); la última versión es
  la 0.30.7 (18-09-2026). Uno de ellos no tiene corrección: quien puede editar un Compose puede ejecutar
  órdenes como root en el servidor (https://github.com/Dokploy/dokploy/security/advisories/GHSA-qh6h-669j-77rw).
- En Dokploy: los dominios `traefik.me` no tienen HTTPS; el botón «Fresh Volumes» borra los volúmenes; las
  variables de su pestaña no llegan a los contenedores si no se referencian con `${VAR}`; y `output:
  'standalone'` no incluye el worker ni las migraciones.

## Opciones consideradas

- **Publicar ya en Vercel Hobby**, como decía el encargo.
- **Solo en local por ahora**, con Vercel y el VPS preparados.
- **Publicar ya en un VPS con Dokploy:** más trabajo de servidor y de seguridad antes de tener la app.

## Decisión

- **Ahora:** la app solo corre en local (`pnpm dev`, y `pnpm build` y `pnpm start` para probar la versión
  compilada), con la demo y el simulador de canales. Nada se publica y no se escribe en Vercel, Turso ni
  Supabase (ver 0024).
- **Preparado, sin ejecutar:** la configuración de Vercel (un cron diario a `/api/cron/tick` en `vercel.json`,
  `maxDuration` en las rutas que lanzan trabajo, `ffmpeg-static` en `next.config.ts`, región cercana a la base
  de datos), Turso con motor libSQL en la UE (0003), un almacén privado de Blob (0010), el cron externo cada
  minuto (0008) y la guía `docs/guia-despliegue.md` (ver 0024: hoy Supabase, Supabase Storage y Supabase Cron).
- **Cuando se publique:** Vercel Hobby solo para pruebas y la demo, con los webhooks y OAuth en el dominio de
  producción. Un negocio real, en Vercel Pro o en el VPS.
- **Futuro:** VPS con Dokploy (compose con `web`, `worker` y `migrate`, dominio propio con HTTPS, copias
  diarias fuera del servidor, Dokploy actualizado y su panel nunca en manos del negocio).
- El código es el mismo en los tres sitios; solo cambian las variables de entorno y el adaptador que se activa
  (base de datos, archivos, forma de lanzar el trabajo en segundo plano).

## Consecuencias

- Gana: ningún coste ni exposición pública mientras se construye, y ningún dato real en un servicio externo.
- Acepta: WhatsApp, Gmail y Outlook reales solo se prueban cuando la app se publique; hasta entonces las
  pruebas usan Meta, Google y Microsoft simulados, y la prueba con el número de prueba de Meta queda escrita
  paso a paso en `docs/guia-whatsapp.md`.
- Acepta: la configuración de despliegue no se comprueba de verdad hasta la primera publicación (el binario de
  `ffmpeg-static` en Vercel, las subidas directas a Blob, la conexión con Turso; ver 0024). La primera publicación lleva
  su lista de comprobación y, como pide `docs/security.md`, crea `docs/deployment.md`.
- Acepta: la línea «Despliegue: [Vercel]» de `AGENTS.md` pasa a describir este plan en tres pasos (cambio de
  `AGENTS.md` que se enseña antes a la persona).
