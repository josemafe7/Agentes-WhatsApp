# Publicar la app en Vercel

Esta guía explica, paso a paso, cómo publicar en internet la instalación de un negocio con Vercel (la app), Turso
(la base de datos), Vercel Blob (los archivos) y un cron externo (el trabajo en segundo plano). Se hace una vez por
negocio. Al final hay un resumen de la otra opción, un servidor propio (VPS), para más adelante. Los datos técnicos
de cada servicio, con sus fuentes, están en `docs/plataforma-despliegue.md` del repositorio.

## Antes de empezar

- **Vercel Hobby (gratis) es solo para pruebas.** Sus normas lo limitan a uso personal y no comercial: sirve para
  enseñar la demo o probar la app. Un negocio real necesita Vercel Pro o, más adelante, un servidor propio (VPS).
- **Con datos reales de clientes** hace falta, además, un plan de Turso con contrato de encargo del tratamiento (el
  gratuito no lo tiene).
- Necesitas cuentas en Vercel, Turso y cron-job.org, y en GitHub si publicas desde GitHub. Todas con verificación en
  dos pasos.
- En tu ordenador: el proyecto clonado, con Node.js 24 y pnpm, y la CLI de Turso (su herramienta para la terminal;
  en Windows, dentro de WSL).
- Ten a mano un gestor de contraseñas: vas a crear claves que después no se pueden volver a ver.
- **Decide el dominio antes de conectar los canales.** WhatsApp, Google y Microsoft guardan la dirección de la app.
  Si vas a usar un dominio propio, ponlo antes (apartado 8).
- Si trabajas con un agente de código, la skill `desplegar` sigue esta guía contigo y comprueba cada paso.

Qué es cada pieza:

- **Vercel:** donde corre la app.
- **Turso:** la base de datos en internet. Usa libSQL, compatible con SQLite, como la base local.
- **Vercel Blob:** donde se guardan los archivos (notas de voz, imágenes, documentos, logos).
- **Cron externo:** un servicio que llama a la app cada minuto para que haga el trabajo pendiente: leer el correo,
  enviar recordatorios, reintentar lo que falló y limpiar lo caducado.

## 1. Crear la base de datos en Turso

La base de datos tiene que ser **libSQL** (la normal de Turso) y estar en la Unión Europea.

1. Instala la CLI de Turso (en Windows, dentro de WSL) y entra con `turso auth login`. También puedes hacerlo
   todo desde el panel web de Turso.
2. Mira las regiones con `turso db locations` y elige una de la UE (por ejemplo, Irlanda: `aws-eu-west-1`).
3. Si tu cuenta es nueva, crea el grupo en esa región y compruébalo:

   ```
   turso group create dominia --location aws-eu-west-1
   turso group list
   ```

4. Crea la base, **sin** la opción `--tursodb` (esa crea el motor nuevo de Turso, con el que la búsqueda del
   conocimiento no funciona):

   ```
   turso db create dominia-negocio --group dominia
   ```

5. Apunta su dirección y crea el token para Vercel. Un token es la llave que abre la base; indica siempre cuándo
   caduca:

   ```
   turso db show dominia-negocio --url
   turso db tokens create dominia-negocio --expiration never
   ```

   La dirección empieza por `libsql://` y no es secreta. El token sí: guárdalo en el gestor de contraseñas y pégalo
   solo en Vercel (apartado 4). Es la llave de todos los datos.

[Captura: la base creada en el panel de Turso, con su región en la UE]

## 2. Preparar la base con las migraciones

Las migraciones son los cambios que crean las tablas de la base y las ponen al día. **Vercel no las aplica al
desplegar:** se lanzan desde tu ordenador, con el proyecto clonado y `pnpm install` hecho. Así una versión de prueba
nunca toca la base equivocada.

1. Crea un token que caduque en un día, solo para esto (no uses el de Vercel):

   ```
   turso db tokens create dominia-negocio --expiration 1d
   ```

2. En la carpeta del proyecto, en Git Bash, macOS o Linux:

   ```
   DATABASE_URL=libsql://dominia-negocio-tuorganizacion.turso.io DATABASE_AUTH_TOKEN=<token> pnpm db:migrate
   ```

   En PowerShell:

   ```
   $env:DATABASE_URL="libsql://dominia-negocio-tuorganizacion.turso.io"; $env:DATABASE_AUTH_TOKEN="<token>"; pnpm db:migrate
   ```

3. Tiene que decir «Base de datos al día: la base de datos remota (Turso)». Cierra después esa terminal.

Repite este apartado **antes de publicar cada versión nueva** (apartado 9). Las migraciones del proyecto solo
añaden, nunca borran, así que la versión que ya está publicada sigue funcionando con la base puesta al día. No
cargues la demo en esta base: `pnpm seed` se niega en una instalación sin demo.

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
direcciones cambian y Vercel las protege con su inicio de sesión, así que Meta, Google y Microsoft no llegan a ellas.
Con esta dirección la app monta la dirección de avisos de WhatsApp (`/api/webhooks/whatsapp`), las direcciones de
vuelta de Google y Microsoft (adonde vuelven tras dar permiso al buzón) y los enlaces de sus correos.

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

- `DATABASE_URL`: la dirección `libsql://…` de Turso.
- `DATABASE_AUTH_TOKEN` (Sensitive): el token de Turso que no caduca, del apartado 1.
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
- `BLOB_READ_WRITE_TOKEN` y `BLOB_STORE_ID`: no las crees tú. Las añade Vercel al conectar el almacén (apartado 5).
- `OPENROUTER_API_KEY` (Sensitive, opcional): mejor no ponerla aquí. El negocio pone su clave en Ajustes › IA, donde se
  guarda cifrada y se cambia sin volver a desplegar. Si está en los dos sitios, manda la de Ajustes.
- No pongas en Vercel `FFMPEG_BIN`, `ALLOW_PRIVATE_MAIL_HOSTS` ni `EMAIL_IMAP_IDLE` (son para un servidor propio), ni
  las que acaban en `_BASE_URL` ni `REPLY_DEBOUNCE_MS` (son solo para las pruebas).

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

## 5. Crear el almacén de archivos y desplegar

### El almacén (Vercel Blob)

1. En el proyecto de Vercel, **Storage › Create › Blob** y elige **Private**. No se puede cambiar después: en un
   almacén público, los archivos de tus clientes quedarían al alcance de quien tuviera su dirección.
2. Elige una región de la Unión Europea, cerca de la base de datos (con Turso en Irlanda, Dublín). Tampoco se puede
   cambiar después.
3. Conéctalo al proyecto, solo al entorno **Production**. Vercel añade sus variables (`BLOB_STORE_ID` y
   `BLOB_READ_WRITE_TOKEN`).

Con la CLI, lo mismo en una orden:

```
pnpm dlx vercel blob create-store dominia-archivos --access private --region dub1 --yes --environment production
```

Los archivos nunca tienen una dirección pública: la app los sirve después de comprobar quién los pide.

[Captura: el almacén Blob creado como Private y conectado al proyecto]

### Desplegar

- **Desde GitHub:** en **Deployments**, abre el último despliegue y pulsa **Redeploy**. Los cambios de variables solo
  valen para los despliegues nuevos.
- **Con la CLI:** `pnpm dlx vercel deploy --prod`.

El archivo `vercel.json` del repositorio ya fija dos cosas: las funciones corren en Dublín (`dub1`), cerca de una base
de datos en Irlanda, y hay un cron diario a `/api/cron/tick`, el único que admite el plan Hobby. Si eliges otra
región de la UE para Turso, habla antes con quien mantiene el código: `vercel.json` y su prueba fijan Dublín.

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
necesita una llamada cada minuto. Hobby solo permite un cron al día, así que se usa un servicio externo gratuito,
cron-job.org:

1. Crea un trabajo nuevo con la dirección `https://<tu-dominio>/api/cron/tick`, método **POST** y cada minuto.
2. En la configuración del trabajo añade la cabecera `Authorization` con el valor `Bearer <CRON_SECRET>` (la palabra
   `Bearer`, un espacio y tu `CRON_SECRET`).
3. Guarda y mira en su historial que las ejecuciones respondan **202**. Sin la cabecera correcta, la app responde
   **401** y no hace nada.
4. En la app, **Ajustes › Diagnóstico › Trabajo en segundo plano**: la «Última ronda» tiene que ser de hace un par de
   minutos como mucho.

cron-job.org corta cada llamada a los 30 segundos (la app contesta enseguida y sigue trabajando después) y desactiva
el trabajo tras más de 25 fallos seguidos: si la app deja de hacer su trabajo en segundo plano, míralo ahí. El
secreto queda guardado en un servicio de terceros: si se filtra, cámbialo en Vercel (y vuelve a desplegar) y en
cron-job.org.

**Con Vercel Pro** puedes seguir con cron-job.org, que funciona igual. Vercel Cron cada minuto también es posible,
pero exige cambiar `vercel.json` (y su prueba, que hoy pide un cron diario): pídeselo a quien mantiene el código.

[Captura: el trabajo de cron-job.org con la cabecera Authorization]

## 7. Poner en marcha el negocio

1. Abre `https://<tu-dominio>`. Como la instalación está vacía, la app te lleva al asistente de arranque (`/setup`).
2. En el primer paso, además de tu nombre, tu email y tu contraseña de propietario, escribe el **código de
   instalación** (el valor de `SETUP_TOKEN`). Así nadie que encuentre la dirección antes que tú puede quedarse con la
   instalación. Si falta en Vercel, el asistente dice «Falta el código de instalación» y no deja crear el propietario.
3. Sigue los pasos: negocio y sector, horario, clave de OpenRouter, primer agente, chat web de prueba y canales. Si lo
   dejas a medias, al volver a entrar como propietario sigues donde lo dejaste.
4. En **Ajustes › Correo del sistema** pon el servidor de correo del negocio, para que salgan las invitaciones, los
   enlaces de recuperación, los avisos y los recordatorios por email. Usa el puerto 465 o 587: Vercel bloquea el 25.
   Pulsa «Enviar correo de prueba».
5. En **Ajustes › Diagnóstico** comprueba que la cola de trabajo avanza.

Después, sigue la «Lista de puesta en marcha» (en Ayuda) para dejar el negocio listo. Puedes dejar `SETUP_TOKEN`
puesto: con el propietario creado, el asistente ya no se abre.

[Captura: el primer paso del asistente con el campo «Código de instalación»]

## 8. Un dominio propio

Mejor antes de conectar WhatsApp y el correo.

1. En Vercel, **Settings › Domains** del proyecto: añade tu dominio o un subdominio (por ejemplo,
   `atencion.tunegocio.es`) y crea en tu proveedor de dominios los registros que te indica Vercel. El certificado
   HTTPS lo pone Vercel.
2. Cambia `APP_URL` y `BETTER_AUTH_URL` a la dirección nueva y vuelve a desplegar. El equipo tendrá que volver a
   iniciar sesión en ella.
3. Si ya tenías algo conectado con la dirección anterior, cámbialo también:
   - el trabajo de cron-job.org;
   - la dirección de avisos en el panel de tu app de Meta (la nueva está en **Ajustes › WhatsApp**);
   - las direcciones de vuelta en Google Cloud y en Microsoft Entra, y después reconecta cada buzón (guía «Conectar el
     correo», en Ayuda);
   - el código del chat web que pegaste en tu web, que lleva la dirección de la app;
   - las direcciones de las páginas legales que diste a Meta y a Google.

## 9. Publicar una versión nueva

Cada versión nueva se publica en este orden:

1. **Copia de seguridad** de la base (apartado 10). Siempre, antes de nada.
2. **Migraciones:** repite el apartado 2 con un token nuevo de un día. Como solo añaden, la versión publicada sigue
   funcionando mientras tanto.
3. **Publica:** desde GitHub, sube los cambios a `main` y Vercel despliega solo; con la CLI,
   `pnpm dlx vercel deploy --prod` desde una copia limpia de la versión nueva.
4. **Comprueba** `/api/health` (con la versión nueva en `"version"`) y, en **Ajustes › Diagnóstico**, que no faltan
   migraciones y que la cola avanza.

Si la versión nueva falla, vuelve a la anterior desde **Deployments** en Vercel o con `pnpm dlx vercel rollback`. La
base ya puesta al día sirve también para la versión anterior. Si trabajas con un agente de código, la skill
`actualizar` hace estos pasos contigo.

## 10. Copias de seguridad y la clave de cifrado

- **La base de datos se puede llevar a un momento anterior.** Turso guarda un historial: 24 horas en el plan gratuito
  y 10 días en Developer. La vuelta atrás crea una base **nueva** (la hora, en UTC):

  ```
  turso db create dominia-restaurada --from-db dominia-negocio --timestamp 2026-10-01T08:00:00Z
  ```

  Después crea un token para ella, cambia `DATABASE_URL` y `DATABASE_AUTH_TOKEN` en Vercel y vuelve a desplegar.
- **Haz también una copia en archivo** antes de cada versión nueva y cada semana:

  ```
  turso db export dominia-negocio --output-file dominia-negocio-2026-10-01.db
  ```

  Puede no traer los últimos cambios: hazla en un momento tranquilo. Lleva datos personales: guárdala cifrada, fuera
  de la carpeta del proyecto y nunca en GitHub. Para comprobar que sirve, crea con ella una base de prueba
  (`turso db create prueba-copia --from-file dominia-negocio-2026-10-01.db`) y bórrala después.
- **Los archivos** (Vercel Blob) no tienen copia automática. Guarda los originales de los documentos que subes al
  conocimiento. Las notas de voz y los adjuntos de los clientes se borran igualmente al pasar su plazo de conservación.
- **`APP_ENCRYPTION_KEY`, en el gestor de contraseñas y nunca junto a las copias.** Si se pierde, las claves guardadas
  en la app (OpenRouter, WhatsApp, correo…) no se pueden leer: la app sigue funcionando con el resto de los datos, pero
  hay que volver a escribirlas y reconectar los canales. Si alguien consigue la clave y una copia, puede leerlo todo.
- Guarda también `BETTER_AUTH_SECRET`, `CRON_SECRET`, `SETUP_TOKEN` y el token de Turso. Si un token de Turso se
  filtra, `turso db tokens invalidate dominia-negocio` anula todos los de la base: crea uno nuevo, cámbialo en Vercel
  y vuelve a desplegar.

## Comprobaciones antes de usarla con clientes

- `DEMO_MODE` es `false` y no aparece la franja «Modo demo».
- `/api/health` responde `"status":"ok"`.
- Las variables están solo en Production, las secretas como Sensitive, y `APP_URL` y `BETTER_AUTH_URL` son la
  dirección de producción con `https://`.
- El almacén de Blob es privado y está conectado solo a Production. La base, el almacén y las funciones están en la UE.
- En **Settings › Deployment Protection**, la protección deja fuera la dirección de producción (lo normal es
  «Standard Protection»): si no, Meta, Google y Microsoft no llegan a la app.
- cron-job.org responde 202 cada minuto y la «Última ronda» de Diagnóstico es reciente.
- La verificación en dos pasos está activada en GitHub, Vercel, Turso, OpenRouter y cron-job.org, y en tu cuenta de
  propietario (Mi cuenta).
- `APP_ENCRYPTION_KEY` y el token de Turso están en el gestor de contraseñas, y hay una copia reciente de la base.
- Con clientes reales: Vercel Pro y un plan de Turso con contrato de encargo del tratamiento.

## Problemas frecuentes

- **El despliegue falla, o la app no arranca, y el registro dice «APP_ENCRYPTION_KEY falta o no es válida»:** falta la
  variable en Production o no son 32 bytes en Base64. Añádela (apartado 4) y vuelve a desplegar. Si ya había claves
  guardadas y la has perdido, hay que volver a escribirlas en la app.
- **El despliegue falla con «Hobby accounts are limited to daily cron jobs»:** `vercel.json` tiene un cron más
  frecuente que uno al día. En Hobby deja el diario y usa cron-job.org.
- **`/api/health` responde `"database":"error"`:** revisa `DATABASE_URL` y `DATABASE_AUTH_TOKEN`, y que aplicaste las
  migraciones (apartado 2). En el plan gratuito, una base sin uso durante 10 días se archiva: se recupera con
  `turso group unarchive <grupo>`. Si se pasa la cuota del plan, las consultas fallan con el código `BLOCKED`.
- **Diagnóstico dice que faltan migraciones:** repite el apartado 2.
- **Al abrir la app sale el inicio de sesión de Vercel:** has abierto la dirección de un despliegue concreto o de una
  versión de prueba, que Vercel protege. Usa la de producción (Settings › Domains).
- **El primer paso dice «Falta el código de instalación»:** no está `SETUP_TOKEN` en Production. Añádela y vuelve a
  desplegar.
- **«El código de instalación no es correcto»:** cópialo otra vez del gestor de contraseñas, sin espacios.
- **No se guardan los archivos (el logo, los documentos):** el almacén de Blob no está conectado a Production, o no has
  vuelto a desplegar después de conectarlo.
- **No llegan las invitaciones:** configura Ajustes › Correo del sistema (puerto 465 o 587) y pulsa «Enviar correo de
  prueba». Mientras tanto, la invitación te enseña su enlace para que lo envíes tú.
- **No se lee el correo, no salen los recordatorios o nada avanza en segundo plano:** revisa el trabajo de cron-job.org
  (dirección, método POST, cabecera `Authorization`, que responda 202 y que siga activo).
- **cron-job.org recibe 401:** la cabecera no es `Bearer`, un espacio y el `CRON_SECRET` exacto de Vercel, o cambiaste
  el secreto y no volviste a desplegar.
- **Meta, Google o Microsoft no llegan a la app:** `APP_URL` no es la dirección de producción, o diste a esos servicios
  la dirección de una versión de prueba.

## Más adelante: VPS con Dokploy

Para un negocio real, la alternativa a Vercel Pro será un servidor propio (VPS) con Dokploy, un panel para publicar
aplicaciones con Docker. El proyecto todavía no trae los archivos para hacerlo; cuando los tenga, esta guía tendrá su
apartado paso a paso. Esto es lo que ya está decidido:

- **Tres servicios** en un `docker-compose`, con la misma imagen: `migrate` aplica las migraciones y termina; `web` es
  la app; y `worker` hace el trabajo en segundo plano en bucle (`pnpm worker`), así que no hace falta cron externo.
  `web` y `worker` arrancan solo cuando `migrate` ha terminado bien.
- **Dominio propio con HTTPS**, con su certificado. Nunca los dominios `traefik.me` que genera Dokploy: no tienen HTTPS
  y Meta los rechaza.
- **Actualiza Dokploy nada más instalarlo** y mantenlo al día: en julio de 2026 publicó decenas de fallos de seguridad
  críticos. Su panel lleva verificación en dos pasos, se cierra su puerto 3000 cuando tenga dominio y nunca se da al
  negocio: quien lo maneja puede controlar el servidor entero.
- **Nunca «Deploy with Fresh Volumes»** (el botón «Fresh Volumes»): borra la base de datos y los archivos.
- **Copias diarias** de los datos a un almacenamiento S3 o Cloudflare R2, fuera del servidor, con la restauración
  probada. `APP_ENCRYPTION_KEY` se guarda aparte: fuera del servidor y lejos de las copias.
- Servidor orientativo: Hostinger KVM 2 (8 GB) con la plantilla «Ubuntu 24.04 with Dokploy».

Los detalles técnicos están en `docs/plataforma-despliegue.md`, apartado «Futuro: VPS con Dokploy».
