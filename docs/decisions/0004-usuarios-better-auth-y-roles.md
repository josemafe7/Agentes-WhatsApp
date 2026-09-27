# 0004 · Usuarios: Better Auth y roles en una tabla propia

- **Estado:** aceptada
- **Fecha:** 2026-09-26

## Contexto y problema

El equipo del negocio entra con email y contraseña, puede recuperar la contraseña y activar la verificación en
dos pasos con una app de códigos (TOTP). No hay registro público: las cuentas solo se crean en el asistente de
arranque (el primer propietario), aceptando una invitación o con la demo. Hay cinco roles (propietario,
administrador, supervisor, agente y solo lectura) y el rol Agente se limita a sus canales. La plantilla
recomienda los usuarios de Supabase, que no se usa ahora (0003; ver 0024: Supabase guarda ya los datos y los
archivos de la app publicada, y los usuarios siguen en Better Auth). El encargo (§2) pide Better Auth, que funciona
con SQLite y con Postgres. Había que decidir cómo encajarlo y dónde viven los roles y los permisos.

Datos comprobados el 26-09-2026 (en el código publicado de las versiones indicadas y en su documentación):

- `better-auth` 1.7.5 (14-09-2026) cumple el margen de 7 días; su adaptador de Drizzle admite `sqlite`, `pg` y
  `mysql`, así que el paso a Supabase no cambia de librería
  (https://github.com/better-auth/better-auth/blob/main/docs/content/docs/installation.mdx).
- La opción `advanced.database.generateId: 'uuid'` hace que sus tablas usen también UUID en texto (0003).
- Con `emailAndPassword.disableSignUp: true`, la 1.7.5 bloquea el registro por HTTP y también
  `auth.api.signUpEmail` llamado desde el servidor. Los usuarios se crean insertando el usuario y su cuenta de
  contraseña (con `hashPassword` de `better-auth/crypto`) en una transacción propia, o con
  `internalAdapter.createUser` (https://cdn.jsdelivr.net/npm/better-auth@1.7.5/dist/api/routes/sign-up.mjs).
- El limitador de peticiones de Better Auth solo cubre las peticiones HTTP a `/api/auth/*` y solo se activa
  con `NODE_ENV=production`; las llamadas a `auth.api.*` desde Server Actions no pasan por él
  (https://github.com/better-auth/better-auth/blob/main/docs/content/docs/concepts/rate-limit.mdx).
- El plugin `twoFactor` no permite exigir la verificación en dos pasos por rol: hay que hacerlo en la app.
- La recuperación de contraseña es `requestPasswordReset` y después `resetPassword`; `forgetPassword` ya no
  existe en la 1.7.5 (https://cdn.jsdelivr.net/npm/better-auth@1.7.5/dist/api/routes/password.mjs).
- La herramienta de línea de órdenes es ahora el paquete `auth` (1.7.5); `@better-auth/cli` está obsoleto en
  npm (https://www.better-auth.com/docs/concepts/cli).
- En Next.js 16 el proxy no cubre todas las peticiones: la sesión se comprueba en cada página, Server Action y
  Route Handler (https://nextjs.org/docs/app/api-reference/file-conventions/proxy).
- Las claves ajenas de libSQL no son fiables para borrar en cascada (0003; ver 0024): los borrados de usuarios se hacen a
  mano, incluidas las filas de `twoFactor`, que el borrado de Better Auth no quita.

## Opciones consideradas

- **Usuarios de Supabase** (la recomendada por la plantilla): exige Supabase desde el primer día y rompe la
  demo sin cuentas externas.
- **Otra librería o una autenticación hecha a mano:** más código propio que mantener y probar en la parte más
  delicada de la app.
- **Organizaciones o roles de un plugin de Better Auth:** las organizaciones chocan con 0001, y los permisos de
  esta app dependen de los canales asignados a cada agente, que son propios de ella.
- **Better Auth para la sesión y una tabla propia de roles con una función de permisos.**

## Decisión

Better Auth 1.7 con el adaptador de Drizzle (dialecto SQLite; Postgres desde 0024): email y contraseña, recuperación y el plugin
`twoFactor` (TOTP con códigos de recuperación), con IDs UUID.

- **Sin registro público:** `disableSignUp` y la ruta de registro desactivada. Las cuentas solo las crean el
  asistente de arranque (mientras no existe ningún usuario), la aceptación de una invitación y el seed, con
  código propio probado.
- **Roles:** en la tabla `user_roles` (owner, admin, supervisor, agent, viewer), donde el usuario no puede
  cambiarlos, más `channel_members` para los canales de cada agente. Un agente sin filas en `channel_members`
  ve todos los canales, lo más sencillo para un negocio pequeño.
- **Permisos:** una función pura `can(actor, acción, recurso?)` con la tabla de «Quién puede hacer qué» de
  `docs/spec.md`. El acceso a datos (`src/data/*`, con `import 'server-only'`) siempre recibe al actor y
  comprueba antes de leer o escribir.
- **Sesión:** `auth.api.getSession({ headers })` en cada página, acción y ruta. El proxy solo redirige al inicio
  de sesión si no hay cookie; nunca decide quién puede qué.
- **Límites de peticiones:** los de Better Auth en `/api/auth/*`, y un `RateLimiter` propio (0003) para las
  Server Actions, los webhooks y el chat web.
- **Verificación en dos pasos exigible:** si está activado el ajuste, la comprobación de sesión lleva a
  propietarios y administradores sin 2FA a configurarla antes de dejarles seguir.

## Consecuencias

- Gana: la misma autenticación ahora en SQLite y después en Postgres; roles que el usuario no puede tocar;
  permisos en una función pura que se prueba rol por rol; sin registro público.
- Acepta: crear usuarios fuera de los endpoints de Better Auth (huella de la contraseña y fila de cuenta
  hechas por nosotros, con pruebas); un limitador propio para las Server Actions; el código que exige la
  verificación en dos pasos; y borrar a mano las filas relacionadas de un usuario.
- El esquema de sus tablas se genera con la herramienta `auth` y debe conservar los nombres que Better Auth
  comprueba al arrancar.
- Equivalencias con las reglas de `docs/security.md`, que están escritas para Supabase: `getClaims()` pasa a
  ser `auth.api.getSession()` en el servidor; los roles en `app_metadata` pasan a la tabla `user_roles`; la
  confirmación de email y el CAPTCHA del registro no aplican porque no hay registro público (las cuentas llegan
  por invitación de un solo uso que caduca).
