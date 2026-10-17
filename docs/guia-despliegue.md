# Publicar la app en Vercel

Esta guía explica, paso a paso, cómo publicar en internet la instalación de un negocio con Vercel (la app) y Supabase
(la base de datos, los archivos y el cron del trabajo en segundo plano). Se hace una vez por negocio. Al final está la
otra opción, paso a paso: un servidor propio (VPS) con Dokploy, con la base y los archivos también en Supabase. Los datos técnicos de cada servicio, con sus
fuentes, están en `docs/plataforma-despliegue.md` del repositorio.

## Antes de empezar

- **Vercel Hobby (gratis) es solo para pruebas.** Sus normas lo limitan a uso personal y no comercial: sirve para
  enseñar la demo o probar la app. Un negocio real necesita Vercel Pro o un servidor propio (VPS, al final de la guía).
- **Supabase Free (gratis) también es solo para pruebas:** no hace copias de seguridad, se pausa tras una semana con
  poca actividad y admite archivos de 50 MB como mucho (un documento que llega por WhatsApp puede pesar hasta
  100 MB). Un negocio real necesita Supabase Pro (25 USD al mes el 27-09-2026), que hace una copia de la base cada día,
  guarda las de los últimos 7 días y deja subir ese límite.
- Necesitas cuentas en Vercel y Supabase, y en GitHub si publicas desde GitHub. Todas con verificación en dos pasos.
- En tu ordenador: el proyecto clonado, con Node.js 24 y pnpm.
- Ten a mano un gestor de contraseñas: vas a crear claves que después no se pueden volver a ver.
- **Decide el dominio antes de conectar los canales.** WhatsApp, Google y Microsoft guardan la dirección de la app.
  Si vas a usar un dominio propio, ponlo antes (apartado 8).
- Si trabajas con un agente de código, la skill `desplegar` sigue esta guía contigo y comprueba cada paso.

Qué es cada pieza:

- **Vercel:** donde corre la app.
- **Supabase:** la base de datos en internet (Postgres, el mismo motor que la base integrada de la demo), los archivos
  (Supabase Storage: notas de voz, imágenes, documentos, logos) y el cron: una tarea que llama a la app cada minuto
  para que haga el trabajo pendiente (leer el correo, enviar recordatorios, reintentar lo que falló y limpiar lo
  caducado).

Supabase es solo para la app publicada. En tu ordenador todo sigue igual: `pnpm dev` arranca la demo con la base
integrada, sin cuentas. Los datos de Supabase van en las variables de Vercel (apartado 4), nunca en `.env.local`.

## 1. Crear el proyecto de Supabase

1. En <https://supabase.com/dashboard>, crea un proyecto nuevo y ponle nombre (por ejemplo, `dominia-negocio`).
2. **La contraseña de la base:** larga y solo con letras y números (un símbolo como `@`, `:` o `/` rompe la dirección
   de conexión si no se escribe codificado). Guárdala en el gestor de contraseñas: la vas a necesitar en el apartado
   siguiente y, si la pierdes, hay que cambiarla (en **Database › Settings**) y ponerla también en Vercel.
3. **La región, en la misma ciudad que las funciones de la app en Vercel:** cada consulta va de una a otra, y cuanto
   más cerca, más rápida responde la app. El repositorio viene preparado para Londres: elige **West Europe (London)**
   (`eu-west-2`), porque `vercel.json` pone las funciones en Londres (`lhr1`). Irlanda también vale, **West EU
   (Ireland)** (`eu-west-1`) con las funciones en Dublín (`dub1`), pero entonces quien mantiene el código tiene que
   cambiar `vercel.json` y su prueba. Elige siempre una región concreta, no la general «Europe», que deja elegir a
   Supabase. Londres está en el Reino Unido, fuera de la UE: con datos de clientes, revisa con el abogado del negocio
   que le vale (la plantilla de contrato de encargo lo recoge). **La región no se puede cambiar después:** habría que
   crear otro proyecto y pasar los datos.
4. El plan: Free para pruebas, Pro para un negocio real («Antes de empezar»).

[Captura: el proyecto nuevo de Supabase, con la región West Europe (London)]

### La dirección de la base

1. En el proyecto, pulsa **Connect** (arriba) y elige **Transaction pooler**. Si te deja elegir entre el pooler
   compartido y el dedicado, el compartido («Shared Pooler»).
2. Copia la dirección. Tiene que empezar por `postgresql://postgres.` y acabar en `pooler.supabase.com:6543/postgres`:
   el puerto **6543** es el del modo transacción, el que sirve para las funciones de Vercel, que abren y cierran
   muchas conexiones cortas. Si empieza por `postgresql://postgres:` y sigue con `@db.`, es otra opción (la conexión
   directa o el pooler dedicado, que van por IPv6): vuelve a elegir.
3. Cambia `[YOUR-PASSWORD]` por la contraseña del apartado anterior. Con la contraseña dentro, esta dirección es un
   secreto: guárdala en el gestor de contraseñas. Solo va en Vercel (apartado 4) y en tu terminal para las migraciones
   (apartado 2).

**Si lo prepara Claude Code con el conector de Supabase**, sin tu contraseña: crea un usuario de la base solo para la
app, `dominia_app`, que lee y escribe las tablas pero no puede cambiarlas (así está la instalación del propietario).
La dirección de Vercel es entonces `postgresql://dominia_app.<ref>:<su contraseña>@…pooler.supabase.com:6543/postgres`,
y las migraciones las sigue aplicando `postgres`, o el propio conector (apartado 2).

[Captura: Connect, con Transaction pooler y la dirección del puerto 6543]

### Las claves de los archivos

La app guarda los archivos en Supabase Storage y entra con dos datos:

- **La dirección del proyecto** («Project URL», en **Connect**): `https://<ref>.supabase.co`, donde `<ref>` es el
  identificador del proyecto (el mismo que va en la dirección de la base, detrás de `postgres.`). No es secreta.
- **Una clave secreta** (empieza por `sb_secret_`), en **Project Settings › API Keys**. Crea una solo para esta app:
  si algún día se filtra, cambias solo esa. Es secreta: abre todos los datos del proyecto sin pasar por ningún
  permiso, así que va solo en Vercel, marcada Sensitive, y nunca en una variable que empiece por `NEXT_PUBLIC_`
  (Supabase, además, la rechaza si llega desde un navegador). La app no necesita la clave publicable ni las antiguas
  `anon` y `service_role`.

No hace falta crear nada en Storage: la app crea sola su bucket privado `dominia-archivos` la primera vez que guarda
un archivo, y los sirve después de comprobar quién los pide. Nunca tienen una dirección pública.

[Captura: Project Settings › API Keys, con la clave secreta de la app]

## 2. Preparar la base con las migraciones

Las migraciones son los cambios que crean las tablas de la base y las ponen al día. **Vercel no las aplica al
desplegar:** se lanzan desde tu ordenador, con el proyecto clonado y `pnpm install` hecho. Así una versión de prueba
nunca toca la base equivocada.

La dirección de la base se da **solo para esa orden**, en la terminal. Nunca la guardes en `.env.local`: ese archivo
es el de tu ordenador, que trabaja con la base integrada de la demo, y con la dirección de Supabase dentro `pnpm dev`
trabajaría sobre los datos del negocio.

1. En la carpeta del proyecto, en Git Bash, macOS o Linux, lanza esta orden y pega la dirección de la base (la del
   apartado 1, con la contraseña) cuando te la pida. No se ve al pegarla ni queda en el historial de la terminal:

   ```
   read -rsp "Dirección de la base: " DATABASE_URL && echo && export DATABASE_URL && pnpm db:migrate
   ```

   En PowerShell (la dirección se ve mientras la pegas, pero no queda en el historial):

   ```
   $env:DATABASE_URL = Read-Host "Dirección de la base"; pnpm db:migrate
   ```

   Es lo mismo que `$env:DATABASE_URL="…"; pnpm db:migrate` (o `DATABASE_URL="…" pnpm db:migrate`), pero sin dejar la
   contraseña escrita en el historial de la terminal.
2. Tiene que terminar diciendo «Base de datos al día: la base de datos de Supabase.» (nunca enseña la dirección ni la
   contraseña). Cierra después esa terminal: guarda la dirección mientras está abierta.

**O pídeselo a Claude Code**, si tiene el conector de Supabase (su servidor MCP) limitado a este proyecto: puede
aplicar las mismas migraciones de la carpeta `drizzle/`. Tiene que dejarlas anotadas como lo hace `pnpm db:migrate`
(en la tabla `drizzle.__drizzle_migrations`); si no, la siguiente vez `pnpm db:migrate` intentaría repetirlas.

Todas las tablas nacen con Row Level Security (la protección por filas de Postgres) activado y sin ninguna regla que
dé acceso: por la API de datos de Supabase no se puede leer ni escribir nada. La app entra solo desde su servidor,
con la dirección de la base.

Repite este apartado **antes de publicar cada versión nueva** (apartado 9). Las migraciones del proyecto solo
añaden, nunca borran, así que la versión que ya está publicada sigue funcionando con la base puesta al día.

**Si la app entra con el usuario `dominia_app`** (apartado 1): una migración que crea tablas no le da permiso sobre
ellas por sí sola. Después de migrar, comprueba en el **SQL Editor** de Supabase que no le falta ninguna:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and not has_table_privilege('dominia_app', format('%I.%I', table_schema, table_name), 'INSERT');
```

No debe salir ninguna fila. Si sale alguna tabla, dale permiso sobre las que hay y deja dicho que lo tenga también
sobre las que creen las próximas migraciones (el segundo permiso vale para las que cree `postgres`, que es quien
migra):

```sql
grant select, insert, update, delete on all tables in schema public to dominia_app;
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to dominia_app;
```

Sin ese permiso, la versión nueva falla al abrir cualquier pantalla que use una tabla nueva. Desde la fase 10 eso
incluye el menú de cada persona, que consulta las tablas de los agentes internos.

Las tablas tienen además Row Level Security sin reglas (`docs/security.md`), y un usuario creado por ti queda sujeto
a ella en las tablas que no son suyas salvo que tenga el atributo `bypassrls` (documentación de Supabase, «Row Level
Security», consultada el 2026-10-09). Compruébalo una vez, y de nuevo si alguna pantalla sale vacía tras migrar:

```sql
select rolname, rolbypassrls from pg_roles where rolname = 'dominia_app';
```

Tiene que salir `true` en `rolbypassrls`. Si sale `false`, las tablas le saldrían vacías: no añadas reglas a las
tablas para arreglarlo (abrirían la tabla a la API de datos); dale el atributo:

```sql
alter role dominia_app with bypassrls;
```

### ¿Vacía o con la demo?

- **Vacía, para un negocio real:** no hagas nada más. Al abrir la app, el asistente de arranque crea el propietario
  (apartado 7).
- **Con la demo, para enseñar la app:** cárgala desde tu ordenador con `pnpm seed`, con las tres variables de Supabase
  (la dirección de la base, la «Project URL» y la clave secreta; sin las dos últimas, los archivos de la demo se
  quedarían en tu ordenador) y `DEMO_MODE=true`, solo para esa orden. En Git Bash, macOS o Linux:

  ```
  read -rsp "Dirección de la base: " DATABASE_URL && echo && read -rsp "Clave secreta: " SUPABASE_SECRET_KEY && echo && read -rp "Project URL: " SUPABASE_URL && export DATABASE_URL SUPABASE_SECRET_KEY SUPABASE_URL DEMO_MODE=true && pnpm seed
  ```

  En PowerShell:

  ```
  $env:DATABASE_URL = Read-Host "Dirección de la base"; $env:SUPABASE_SECRET_KEY = Read-Host "Clave secreta"; $env:SUPABASE_URL = Read-Host "Project URL"; $env:DEMO_MODE = "true"; pnpm seed
  ```

  Cierra después la terminal. También se lo puedes pedir a Claude Code con el conector de Supabase.

**Cuidado con la demo publicada.** Las contraseñas de sus usuarios de prueba están en el README, que lee cualquiera si
el repositorio es público: con la demo en internet, cualquiera podría entrar como propietario. Nada más cargarla,
entra como propietario, cambia su contraseña en **Mi cuenta** y borra los demás usuarios de prueba en **Ajustes ›
Usuarios** (o cambia también sus contraseñas). Mientras alguna siga siendo la del README, no pongas claves reales, como
la de OpenRouter. **Antes de trabajar con clientes, vacíala:** con la dirección de la base solo para esa orden,

```
read -rsp "Dirección de la base: " DATABASE_URL && echo && export DATABASE_URL && pnpm db:fresh --remote-i-know
```

o en PowerShell `$env:DATABASE_URL = Read-Host "Dirección de la base"; pnpm db:fresh --remote-i-know`. Te pide
confirmación, borra todo (la demo y sus usuarios) y deja la instalación vacía, con el asistente de arranque. Los
archivos de la demo se quedan en Storage: puedes borrarlos allí.

## 3. Crear el proyecto en Vercel

Puedes crearlo desde GitHub (recomendado: cada cambio que subas a la rama `main` se publica solo) o con la CLI de
Vercel desde tu ordenador.

### Desde GitHub

1. Sube el código a un repositorio **privado** de GitHub.
2. En Vercel, **Add New › Project** e importa el repositorio. Vercel reconoce que es una app de Next.js.
3. Pulsa **Deploy** sin añadir variables en esa pantalla: las pondrás en el apartado 4, solo para producción.
4. Ese primer despliegue puede fallar (el registro dirá que falta `APP_ENCRYPTION_KEY`): es normal, todavía no
   tiene sus variables.

### Con la CLI de Vercel

Hazlo desde una copia limpia del repositorio, hecha con `git clone` en otra carpeta (sirve la de tu ordenador:
`git clone <carpeta-del-proyecto> <carpeta-nueva>`). La CLI sube casi todo lo que hay en la carpeta, y una copia
limpia no lleva tu base local (`data/`) ni tus claves.

```
pnpm dlx vercel login
pnpm dlx vercel link
```

`vercel link` te hace unas preguntas: crea un proyecto nuevo (no lo enlaces a uno que ya exista) y ponle nombre.
Todavía no despliegues.

### La dirección de producción

La app necesita saber su dirección pública. Es la de producción: `https://<nombre-del-proyecto>.vercel.app` o tu
dominio propio. Compruébala en **Settings › Domains** del proyecto: si ese nombre ya estaba cogido, Vercel pone otro.

Usa **siempre** esa dirección, nunca la de un despliegue concreto ni la de una versión de prueba (preview): esas
direcciones cambian y Vercel las protege con su inicio de sesión, así que Meta, Google, Microsoft y el cron de
Supabase no llegan a ellas. Con esta dirección la app monta la dirección de avisos de WhatsApp (`/api/webhooks/whatsapp`),
las direcciones de vuelta de Google y Microsoft (adonde vuelven tras dar permiso al buzón) y los enlaces de sus correos.

[Captura: Settings › Domains del proyecto, con la dirección de producción]

## 4. Las variables de entorno

Las variables de entorno son los datos propios de cada instalación, algunos secretos, que la app lee al arrancar.
Todas están explicadas también en `.env.example`. Añádelas **solo en el entorno Production**, nunca en Preview: las
versiones de prueba no deben tocar datos reales.

- **En el panel:** **Settings › Environment Variables**, entorno **Production**. Las marcadas «Sensitive», con esa
  opción activada: una variable Sensitive no se puede volver a leer, así que guárdala antes en el gestor de
  contraseñas.
- **Con la CLI:** `pnpm dlx vercel env add NOMBRE production`, y escribe el valor cuando te lo pida (nunca en la misma
  orden, porque quedaría en el historial de la terminal). La CLI crea como Sensitive todas las de Production; a las
  que no son secretas puedes añadirles `--no-sensitive` para poder leerlas después.

Las variables:

- `DATABASE_URL` (Sensitive): la dirección de la base del apartado 1 («Transaction pooler», puerto 6543), con la
  contraseña.
- `SUPABASE_URL`: la dirección del proyecto de Supabase (`https://<ref>.supabase.co`).
- `SUPABASE_SECRET_KEY` (Sensitive): la clave secreta `sb_secret_…` del apartado 1.
- `APP_URL`: la dirección de producción, con `https://` y sin barra al final.
- `BETTER_AUTH_URL`: la misma que `APP_URL`. La usa el inicio de sesión.
- `BETTER_AUTH_SECRET` (Sensitive): al menos 32 caracteres al azar. Firma las sesiones y cifra la verificación en dos
  pasos: si la cambias, todos los usuarios pierden su verificación en dos pasos.
- `APP_ENCRYPTION_KEY` (Sensitive): 32 bytes al azar en Base64. Cifra las claves que el negocio pone en la app
  (OpenRouter, WhatsApp, correo…). Sin ella la app no arranca.
- `CRON_SECRET` (Sensitive): al menos 32 caracteres al azar. Protege la dirección del trabajo en segundo plano
  (apartado 6).
- `SETUP_TOKEN` (Sensitive): el código de instalación, al menos 32 caracteres al azar. Lo pide el asistente de
  arranque para crear el propietario (apartado 7).
- `DEMO_MODE`: `false`.
- `OPENROUTER_API_KEY` (Sensitive, opcional): mejor no ponerla aquí. El negocio pone su clave en Ajustes › IA, donde se
  guarda cifrada y se cambia sin volver a desplegar. Si está en los dos sitios, manda la de Ajustes.
- No pongas en Vercel `FFMPEG_BIN`, `ALLOW_PRIVATE_MAIL_HOSTS` ni `EMAIL_IMAP_IDLE` (son para un servidor propio), ni
  las que acaban en `_BASE_URL` ni `REPLY_DEBOUNCE_MS` (son solo para las pruebas). Ninguna variable secreta empieza
  por `NEXT_PUBLIC_`.

Para esta guía no hace falta la integración de Supabase del Marketplace de Vercel: crea el proyecto desde Vercel, con
la factura en Vercel, y añade variables con otros nombres (`POSTGRES_URL` y otras que empiezan por `NEXT_PUBLIC_`).
Aquí las variables se ponen a mano.

Para generar los valores al azar, en una terminal de tu ordenador (no los pegues en ningún chat):

- Para `APP_ENCRYPTION_KEY`:

  ```
  node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
  ```

- Para `BETTER_AUTH_SECRET`, `CRON_SECRET` y `SETUP_TOKEN`, uno distinto para cada una:

  ```
  node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
  ```

Guarda `APP_ENCRYPTION_KEY` en el gestor de contraseñas y nunca junto a las copias de la base (apartado 10).

[Captura: la pantalla de variables de entorno de Vercel, con las secretas marcadas como Sensitive]

## 5. Desplegar y comprobar

### Desplegar

- **Desde GitHub:** en **Deployments**, abre el último despliegue y pulsa **Redeploy**. Los cambios de variables solo
  valen para los despliegues nuevos.
- **Con la CLI:** `pnpm dlx vercel deploy --prod`.

El archivo `vercel.json` del repositorio ya fija dos cosas: las funciones corren en Londres (`lhr1`), al lado de la
base de Supabase en Londres, y hay un cron diario a `/api/cron/tick`, el único que admite el plan Hobby (el de cada
minuto lo pone Supabase, apartado 6). Si tu proyecto de Supabase está en otra región, habla antes con quien mantiene
el código: `vercel.json` y su prueba fijan Londres.

### Comprobar que responde

Abre `https://<tu-dominio>/api/health`. Tiene que responder algo así:

```
{"status":"ok","database":"ok","databaseLatencyMs":45,"version":"0.1.0"}
```

- `"version"` es la versión publicada.
- `"status":"error"` con `"database":"error"`: la app funciona, pero no llega a la base de datos (ver «Problemas
  frecuentes»).
- Si no responde o sale un error de Vercel, mira el registro del despliegue en **Deployments**.

## 6. El cron cada minuto

El trabajo en segundo plano (leer el correo, enviar recordatorios, reintentar lo que falló, limpiar lo caducado)
necesita una llamada cada minuto. Hobby solo permite un cron al día, así que la hace Supabase Cron, desde tu proyecto
de Supabase:

1. En Supabase, **Integrations › Cron**. Si te pide activarlo, actívalo (usa las extensiones `pg_cron` y, para
   llamar a una dirección, `pg_net` de Postgres).
2. Pulsa **Create job** y rellena «Create a new cron job»:
   - **Name:** `dominia-tick` (no se puede cambiar después).
   - La programación: `* * * * *` (cada minuto).
   - El tipo: **HTTP Request**.
   - **Method:** POST. **Endpoint URL:** `https://<tu-dominio>/api/cron/tick`.
   - **Timeout:** 5000 ms. La app contesta enseguida, pero tras un rato sin uso puede tardar algo más en despertar.
   - **HTTP Headers**, con **Add header**: nombre `Authorization` y valor `Bearer <CRON_SECRET>` (la palabra `Bearer`,
     un espacio y tu `CRON_SECRET`).
3. Pulsa **Create cron job**. Con **History**, junto al trabajo, ves que se ejecuta cada minuto.
4. En la app, **Ajustes › Diagnóstico › Trabajo en segundo plano**: la «Última ronda» tiene que ser de hace un par de
   minutos como mucho. Si no, mira qué contesta la app al cron: en el **SQL Editor** de Supabase,

   ```
   select status_code, error_msg, created from net._http_response order by created desc limit 5;
   ```

   tiene que dar **202**. Con **401**, la cabecera no coincide con el `CRON_SECRET` de Vercel.

El secreto queda guardado en la definición del trabajo, dentro de tu proyecto de Supabase: si se filtra, cámbialo en
Vercel (y vuelve a desplegar) y en el trabajo. Para pararlo un rato, el interruptor del trabajo en Integrations › Cron.

**Con Vercel Pro** puedes seguir con el cron de Supabase, que funciona igual. Vercel Cron cada minuto también es
posible, pero exige cambiar `vercel.json` (y su prueba, que hoy pide un cron diario): pídeselo a quien mantiene el
código.

[Captura: el trabajo de Supabase Cron con la petición POST y la cabecera Authorization]

## 7. Poner en marcha el negocio

1. Abre `https://<tu-dominio>`. Como la instalación está vacía, la app te lleva al asistente de arranque (`/setup`).
   Si cargaste la demo, en cambio, entras con los usuarios de prueba: sigue antes el «Cuidado con la demo publicada»
   del apartado 2.
2. En el primer paso, además de tu nombre, tu email y tu contraseña de propietario, escribe el **código de
   instalación** (el valor de `SETUP_TOKEN`). Así nadie que encuentre la dirección antes que tú puede quedarse con la
   instalación. Si falta en Vercel, el asistente dice «Falta el código de instalación» y no deja crear el propietario.
3. Sigue los pasos: negocio y sector, horario, clave de OpenRouter, primer agente, chat web de prueba y canales. Si lo
   dejas a medias, al volver a entrar como propietario sigues donde lo dejaste.
4. En **Ajustes › Negocio**, sube el logo del negocio. Es el primer archivo: en Supabase, **Storage**, aparece el
   bucket `dominia-archivos`, que la app crea privado. Nunca lo cambies a público.
5. En **Ajustes › Correo del sistema** pon el servidor de correo del negocio, para que salgan las invitaciones, los
   enlaces de recuperación, los avisos y los recordatorios por email. Usa el puerto 465 o 587: Vercel bloquea el 25.
   Pulsa «Enviar correo de prueba».
6. En **Ajustes › Diagnóstico** comprueba que la cola de trabajo avanza.

Después, sigue la «Lista de puesta en marcha» (en Ayuda) para dejar el negocio listo. Puedes dejar `SETUP_TOKEN`
puesto: con el propietario creado, el asistente ya no se abre.

**WhatsApp en Vercel.** De las tres formas de conectar un número (Canales › Añadir canal), en Vercel funcionan dos:
la API oficial de Meta y YCloud. El código QR no: necesita que la app esté siempre encendida para mantener la
conexión con WhatsApp, y en Vercel la app solo vive mientras atiende una petición. El asistente lo dice y no deja
crear el canal.

[Captura: el primer paso del asistente con el campo «Código de instalación»]

## 8. Un dominio propio

Mejor antes de conectar WhatsApp y el correo.

1. En Vercel, **Settings › Domains** del proyecto: añade tu dominio o un subdominio (por ejemplo,
   `atencion.tunegocio.es`) y crea en tu proveedor de dominios los registros que te indica Vercel. El certificado
   HTTPS lo pone Vercel.
2. Cambia `APP_URL` y `BETTER_AUTH_URL` a la dirección nueva y vuelve a desplegar. El equipo tendrá que volver a
   iniciar sesión en ella.
3. Si ya tenías algo conectado con la dirección anterior, cámbialo también:
   - la dirección del trabajo de Supabase Cron (Integrations › Cron);
   - la dirección de avisos en el panel de tu app de Meta (la nueva está en **Ajustes › WhatsApp**);
   - las direcciones de vuelta en Google Cloud y en Microsoft Entra, y después reconecta cada buzón (guía «Conectar el
     correo», en Ayuda);
   - el código del chat web que pegaste en tu web, que lleva la dirección de la app;
   - las direcciones de las páginas legales que diste a Meta y a Google.

## 9. Publicar una versión nueva

Cada versión nueva se publica en este orden:

1. **Copia de seguridad** de la base (apartado 10). Siempre, antes de nada.
2. **Migraciones:** repite el apartado 2. Como solo añaden, la versión publicada sigue funcionando mientras tanto.
3. **Publica:** desde GitHub, sube los cambios a `main` y Vercel despliega solo; con la CLI,
   `pnpm dlx vercel deploy --prod` desde una copia limpia de la versión nueva.
4. **Comprueba** `/api/health` (con la versión nueva en `"version"`) y, en **Ajustes › Diagnóstico**, que no faltan
   migraciones y que la cola avanza.

Si la versión nueva falla, vuelve a la anterior desde **Deployments** en Vercel o con `pnpm dlx vercel rollback`. La
base ya puesta al día sirve también para la versión anterior. Si trabajas con un agente de código, la skill
`actualizar` hace estos pasos contigo.

## 10. Copias de seguridad y la clave de cifrado

- **Supabase Pro hace una copia de la base cada día** y guarda las de los últimos 7 días. Se restaura desde
  **Database › Backups**; mientras se restaura, el proyecto no responde. Volver a un minuto concreto (PITR) es un
  complemento de pago.
- **Supabase Free no hace copias:** hazlas tú. Y, también en Pro, haz una antes de cada versión nueva (apartado 9).
  Hace falta la CLI de Supabase (su herramienta para la terminal) con Docker Desktop encendido, como explica
  <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>. Usa la dirección del
  «Session pooler» (en **Connect**; puerto 5432) y guarda los tres archivos de la copia en una carpeta nueva. En Git
  Bash, macOS o Linux (pega la dirección cuando te la pida):

  ```
  read -rsp "Dirección (Session pooler): " DB && echo && supabase db dump --db-url "$DB" -f roles.sql --role-only && supabase db dump --db-url "$DB" -f schema.sql && supabase db dump --db-url "$DB" -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
  ```

  En PowerShell:

  ```
  $db = Read-Host "Dirección (Session pooler)"; supabase db dump --db-url $db -f roles.sql --role-only; supabase db dump --db-url $db -f schema.sql; supabase db dump --db-url $db -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
  ```

  La copia lleva datos personales: guárdala cifrada, fuera de la carpeta del proyecto y nunca en GitHub. Para
  comprobar que sirve, restáurala cada pocos meses en un proyecto de Supabase de pruebas, como explica esa misma
  página de Supabase, y bórralo después.
- **Los archivos** (Supabase Storage) no entran en las copias de la base. Guarda los originales de los documentos que
  subes al conocimiento. Las notas de voz y los adjuntos de los clientes se borran igualmente al pasar su plazo de
  conservación.
- **`APP_ENCRYPTION_KEY`, en el gestor de contraseñas y nunca junto a las copias.** Si se pierde, las claves guardadas
  en la app (OpenRouter, WhatsApp, correo…) no se pueden leer: la app sigue funcionando con el resto de los datos, pero
  hay que volver a escribirlas y reconectar los canales. Si alguien consigue la clave y una copia, puede leerlo todo.
- Guarda también `BETTER_AUTH_SECRET`, `CRON_SECRET`, `SETUP_TOKEN`, la contraseña de la base y la clave secreta de
  Supabase. Si la contraseña de la base se filtra, cámbiala en **Database › Settings**, pon la nueva `DATABASE_URL` en
  Vercel y vuelve a desplegar. Si se filtra la clave secreta, crea otra en **Project Settings › API Keys**, ponla en
  Vercel, vuelve a desplegar y borra la antigua.

## Comprobaciones antes de usarla con clientes

- `DEMO_MODE` es `false` y no aparece la franja «Modo demo».
- Si cargaste la demo, la has vaciado (`pnpm db:fresh --remote-i-know`, apartado 2): no queda ningún usuario de prueba.
- `/api/health` responde `"status":"ok"`.
- Las variables están solo en Production, las secretas como Sensitive, ninguna secreta empieza por `NEXT_PUBLIC_`, y
  `APP_URL` y `BETTER_AUTH_URL` son la dirección de producción con `https://`.
- El proyecto de Supabase y las funciones de Vercel están en la misma ciudad: Londres (`eu-west-2` y `lhr1`, como viene
  preparado) o Irlanda (`eu-west-1` y `dub1`).
- El bucket `dominia-archivos` es privado: en el **SQL Editor** de Supabase, `select name, public from storage.buckets;`
  da `public` en `false`.
- **Advisors › Security Advisor** de Supabase, sin errores ni avisos. Sale un aviso informativo «RLS Enabled No
  Policy» por cada tabla, y es lo esperado: todas tienen Row Level Security sin reglas de acceso, a propósito, porque
  nadie entra por la API de datos. No añadas reglas (políticas) para quitarlos: abrirían las tablas a esa API.
- En Vercel, **Settings › Deployment Protection** deja fuera la dirección de producción (lo normal es «Standard
  Protection»): si no, Meta, Google, Microsoft y el cron no llegan a la app.
- El cron de Supabase responde 202 cada minuto y la «Última ronda» de Diagnóstico es reciente.
- La verificación en dos pasos está activada en GitHub, Vercel, Supabase y OpenRouter, y en tu cuenta de propietario
  (Mi cuenta).
- `APP_ENCRYPTION_KEY`, la contraseña de la base y la clave secreta de Supabase están en el gestor de contraseñas, y
  hay una copia reciente de la base.
- Con clientes reales: Vercel Pro y Supabase Pro.

## Problemas frecuentes

- **El despliegue falla, o la app no arranca, y el registro dice «APP_ENCRYPTION_KEY falta o no es válida»:** falta la
  variable en Production o no son 32 bytes en Base64. Añádela (apartado 4) y vuelve a desplegar. Si ya había claves
  guardadas y la has perdido, hay que volver a escribirlas en la app.
- **El despliegue falla con «Hobby accounts are limited to daily cron jobs»:** `vercel.json` tiene un cron más
  frecuente que uno al día. En Hobby deja el diario y usa el cron de Supabase (apartado 6).
- **`/api/health` responde `"database":"error"`:** revisa `DATABASE_URL` en Vercel: la dirección del «Transaction
  pooler» (puerto 6543), con la contraseña en lugar de `[YOUR-PASSWORD]`. Comprueba que aplicaste las migraciones
  (apartado 2). En el plan Free, un proyecto con poca actividad durante una semana se pausa: se reactiva desde su
  página en Supabase, con **Resume project**.
- **El registro dice «Falta DATABASE_URL de Supabase» o «Turso ya no se usa»:** `DATABASE_URL` no está en Production,
  o es una dirección antigua de Turso (`libsql://`). Pon la de Supabase (apartado 4) y vuelve a desplegar.
- **Diagnóstico dice que faltan migraciones:** repite el apartado 2.
- **Al abrir la app sale el inicio de sesión de Vercel:** has abierto la dirección de un despliegue concreto o de una
  versión de prueba, que Vercel protege. Usa la de producción (Settings › Domains).
- **El primer paso dice «Falta el código de instalación»:** no está `SETUP_TOKEN` en Production. Añádela y vuelve a
  desplegar.
- **«El código de instalación no es correcto»:** cópialo otra vez del gestor de contraseñas, sin espacios.
- **No se guardan los archivos (el logo, los documentos), o el registro dice «Faltan SUPABASE_URL y
  SUPABASE_SECRET_KEY»:** falta alguna de las dos en Production, la clave no es la secreta (`sb_secret_…`) o no has
  vuelto a desplegar después de ponerlas.
- **El registro dice que el bucket «dominia-archivos» de Supabase Storage es público:** alguien lo cambió a público, y
  la app se niega a guardar nada en él para que ningún archivo se pueda abrir sin permiso. Vuelve a hacerlo privado en
  Supabase (Storage) y prueba otra vez.
- **Un archivo grande no se guarda:** Supabase Free admite 50 MB por archivo, y un documento de WhatsApp puede llegar a
  100 MB; en Pro, el límite se sube en los ajustes de Storage. En Vercel, además, lo que se sube desde el navegador
  pasa por una función, que admite 4,5 MB por petición.
- **No llegan las invitaciones:** configura Ajustes › Correo del sistema (puerto 465 o 587) y pulsa «Enviar correo de
  prueba». Mientras tanto, la invitación te enseña su enlace para que lo envíes tú.
- **No se lee el correo, no salen los recordatorios o nada avanza en segundo plano:** revisa el trabajo de Supabase
  Cron (activo, cada minuto, método POST, la dirección de producción y la cabecera `Authorization`) y qué contesta la
  app (apartado 6).
- **El cron recibe 401:** la cabecera no es `Bearer`, un espacio y el `CRON_SECRET` exacto de Vercel, o cambiaste el
  secreto y no volviste a desplegar.
- **Meta, Google o Microsoft no llegan a la app:** `APP_URL` no es la dirección de producción, o diste a esos servicios
  la dirección de una versión de prueba.

## Servidor propio con Dokploy (Hostinger)

La otra forma de publicar: la app en un servidor propio (un VPS de Hostinger con Dokploy, un panel para publicar
aplicaciones con Docker) y, como con Vercel, la base de datos y los archivos en Supabase. Tu ordenador sigue igual:
`pnpm dev` con la demo y la base integrada, sin tocar nunca la de Supabase.

Cómo funciona:

- **La imagen de la app** (todo lo que la app necesita para funcionar, empaquetado con el `Dockerfile` del proyecto) la
  construye GitHub cada vez que subes cambios a `main`: el flujo «Imagen para el servidor» (pestaña **Actions** del
  repositorio) la prueba con una base de datos de verdad y, si todo va bien, la publica en
  `ghcr.io/josemafe7/agentes-whatsapp`. El servidor solo la descarga: nunca compila nada.
- **En el servidor** corren tres piezas de esa imagen (`docker-compose.yml`): `migrate` pone la base de Supabase al día
  y termina; después arrancan `web` (la app) y `worker` (el trabajo en segundo plano, siempre en marcha). Por eso aquí
  no hace falta el cron del apartado 6 y **sí funciona WhatsApp por código QR**.
- Cada despliegue pone la base al día solo: no hay que lanzar las migraciones a mano.

### 1. Supabase

Como en el apartado 1, con dos diferencias:

- **La región:** la misma ciudad que el servidor de Hostinger, o la más cercana (`vercel.json` no cuenta aquí).
- **La dirección de la base es la del «Session pooler»**, no la del «Transaction pooler»: en **Connect**, elige
  **Session pooler**. Empieza por `postgresql://postgres.` y acaba en `pooler.supabase.com:5432/postgres` (puerto
  **5432**). Es la que sirve para un servidor que está siempre encendido. Cambia `[YOUR-PASSWORD]` por la contraseña
  y guárdala en el gestor de contraseñas.

Necesitas también la «Project URL» y una clave secreta `sb_secret_…` (apartado 1, «Las claves de los archivos»).

### 2. La imagen, pública

La primera vez que el flujo «Imagen para el servidor» termina en verde, GitHub guarda la imagen como privada. El
repositorio ya es público y la imagen no lleva ninguna clave, así que lo más sencillo es hacerla pública: en GitHub,
tu perfil › **Packages** › `agentes-whatsapp` › **Package settings** › **Change visibility** › **Public**. Así el
servidor la descarga sin contraseña.

Si prefieres que siga privada: crea en GitHub un token clásico (**Settings › Developer settings › Personal access
tokens › Tokens (classic)**) solo con el permiso `read:packages`, y añádelo en Dokploy en **Settings › Registry**
(registro `ghcr.io`, tu usuario de GitHub y el token como contraseña).

[Captura: Package settings de GitHub, con la visibilidad pública]

### 3. El servidor

1. En Hostinger, un VPS **KVM 2** (8 GB) con la plantilla **«Ubuntu 24.04 with Dokploy»**.
2. **Actualiza Dokploy nada más instalarlo** (la plantilla puede traer una versión antigua, y en 2026 se publicaron
   fallos de seguridad graves): entra por SSH (`ssh root@<IP del servidor>`) y lanza

   ```
   curl -sSL https://dokploy.com/install.sh | sh -s update
   ```

3. Abre el panel en `http://<IP del servidor>:3000`, crea tu cuenta de administrador y activa la verificación en dos
   pasos. **El panel nunca se da al negocio:** quien entra en él puede controlar el servidor entero.
4. En el cortafuegos del VPS (en el panel de Hostinger) deja abiertos solo los puertos 22 (SSH), 80 y 443 (la web) y,
   mientras configuras el panel, el 3000.
5. Opcional pero recomendado: pon al panel su propio dominio con HTTPS (en Dokploy, **Settings › Web Server**) y,
   cuando funcione, cierra el puerto 3000, también en el cortafuegos:

   ```
   docker service update --publish-rm "published=3000,target=3000,mode=host" dokploy
   ```

### 4. El dominio de la app

En tu proveedor de dominios, crea un registro **A** para el subdominio de la app (por ejemplo,
`atencion.tunegocio.es`) que apunte a la IP del servidor. Hazlo antes de desplegar: el certificado HTTPS se pide
nada más poner el dominio en Dokploy. Nunca uses las direcciones `traefik.me` que propone Dokploy: no tienen HTTPS y
Meta las rechaza.

### 5. Crear la app en Dokploy

1. **Projects › Create Project** (por ejemplo, `dominia-negocio`) y dentro **Create Service › Compose**.
2. En **General**, el origen **Git**: la dirección `https://github.com/josemafe7/Agentes-WhatsApp.git`, la rama `main`
   y el archivo `./docker-compose.yml`. Guarda.
3. En **Environment**, pega las variables, una por línea (`NOMBRE=valor`). Los secretos se generan como en el
   apartado 4 (en una terminal de tu ordenador, nunca en un chat):

   ```
   DATABASE_URL=postgresql://postgres.<ref>:<contraseña>@aws-….pooler.supabase.com:5432/postgres
   APP_URL=https://atencion.tunegocio.es
   BETTER_AUTH_SECRET=…
   APP_ENCRYPTION_KEY=…
   CRON_SECRET=…
   SETUP_TOKEN=…
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_…
   ```

   Opcionales: `OPENROUTER_API_KEY` (mejor en Ajustes › IA), `TRUSTED_PROXY_HOPS=2` si pones Cloudflare delante y
   `EMAIL_IMAP_IDLE=true` para leer al momento los buzones IMAP con «Leer al momento». `BETTER_AUTH_URL` y
   `DEMO_MODE=false` ya los pone `docker-compose.yml`. Si falta una obligatoria, el despliegue se para y dice cuál.
4. En **Domains**, **Add Domain**: el servicio **web**, el dominio del paso anterior, el puerto **3000**, **HTTPS**
   activado y el certificado **Let's Encrypt**.
5. **Deploy**. En **Logs** verás, en este orden: `migrate` termina con «Base de datos al día: la base de datos de
   Supabase.»; `web` dice «Ready»; y `worker`, «[worker] En marcha».

[Captura: el servicio Compose de Dokploy con sus pestañas General, Environment y Domains]

### 6. Comprobar y poner en marcha

1. Abre `https://<tu-dominio>/api/health`: tiene que responder `"status":"ok"` y `"database":"ok"`.
2. Sigue el apartado 7 («Poner en marcha el negocio»), con el código de instalación (`SETUP_TOKEN`). Aquí también
   puedes conectar WhatsApp por código QR. El correo del sistema, por el puerto 465 o 587.
3. En **Ajustes › Diagnóstico**, comprueba que la cola de trabajo avanza (lo hace el `worker`).

### 7. Publicar una versión nueva

1. **Copia de seguridad** de la base (apartado 10).
2. Sube los cambios a `main` y espera a que el flujo «Imagen para el servidor» termine en verde en **Actions**.
3. En Dokploy, **Deploy**: descarga la imagen nueva, `migrate` pone la base al día y después arrancan `web` y
   `worker`. Como las migraciones solo añaden, mientras tanto no se rompe nada.
4. Comprueba `/api/health` (con la versión nueva en `"version"`).

**Volver a la versión anterior:** cada imagen queda también con el código de su commit (`sha-…`, en **Packages** de
GitHub). Añade en **Environment** `APP_IMAGE=ghcr.io/josemafe7/agentes-whatsapp:sha-<código>` y pulsa **Deploy**.
Quítala para volver a la última.

### Cuidado

- **Una sola copia de `web`:** la conexión de WhatsApp por código QR la mantiene ese servicio, y dos copias se la
  quitarían la una a la otra.
- **Nunca «Deploy with Fresh Volumes»** («Fresh Volumes»): borra los volúmenes del servidor. La app no guarda nada en
  el servidor (todo va a Supabase), pero es una costumbre que conviene no tener.
- **Mantén Dokploy al día** y entra en su panel solo tú, con verificación en dos pasos.
- **Copias:** las de Supabase (apartado 10). `APP_ENCRYPTION_KEY`, en el gestor de contraseñas: nunca en el servidor
  fuera de Dokploy ni junto a las copias.

Los detalles técnicos están en `docs/plataforma-despliegue.md`, apartado «VPS con Dokploy».
