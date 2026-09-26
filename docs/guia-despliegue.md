# Publicar la app en Vercel

Esta guía explica, paso a paso, cómo publicar una instalación de DominIA Agentes en internet con Vercel (la
app), Turso (la base de datos), Vercel Blob (los archivos) y un cron externo (el trabajo en segundo plano). Se
hace una vez por negocio. Los datos técnicos de cada servicio, con sus fuentes, están en
`docs/plataforma-despliegue.md` del repositorio.

## Antes de empezar

- **Vercel Hobby (gratis) es solo para pruebas.** Sus normas lo limitan a uso personal y no comercial: sirve para
  enseñar la demo o probar la app. Un negocio real necesita Vercel Pro o, más adelante, un servidor propio (VPS).
- **Con datos reales de clientes** hace falta un plan de Turso con contrato de encargo del tratamiento (el
  gratuito no lo tiene) y Vercel Pro o el VPS.
- Necesitas cuentas en GitHub, Vercel, Turso y cron-job.org, todas con verificación en dos pasos activada.
- El código tiene que estar en un repositorio de GitHub (privado).
- Ten a mano un gestor de contraseñas: vas a crear claves que no se pueden volver a ver.

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

4. Crea la base, **sin** la opción `--tursodb` (esa crea el motor nuevo, con el que la búsqueda no funciona):

   ```
   turso db create dominia-negocio --group dominia
   ```

5. Apunta su dirección y crea un token, indicando siempre cuándo caduca:

   ```
   turso db show dominia-negocio --url
   turso db tokens create dominia-negocio --expiration never
   ```

   La dirección empieza por `libsql://`. Guarda el token en el gestor de contraseñas: es la llave de todos los
   datos.

[Captura: la base creada en el panel de Turso, con su región en la UE]

## 2. Preparar la base con las migraciones

Las tablas se crean desde tu ordenador, con el proyecto clonado y `pnpm install` hecho. Nunca se hace en el
despliegue de Vercel, que también corre para las versiones de prueba y podría tocar la base equivocada.

En Git Bash, macOS o Linux:

```
DATABASE_URL=libsql://dominia-negocio-tuorganizacion.turso.io DATABASE_AUTH_TOKEN=<token> pnpm db:migrate
```

En PowerShell:

```
$env:DATABASE_URL="libsql://dominia-negocio-tuorganizacion.turso.io"; $env:DATABASE_AUTH_TOKEN="<token>"; pnpm db:migrate
```

Tiene que decir «Base de datos al día: la base de datos remota (Turso)». Cierra después esa terminal, para que
el token no se quede en ella. No cargues la demo en esta base: `pnpm seed` se niega en una instalación sin demo.

## 3. Crear el proyecto en Vercel

1. En Vercel, **Add New › Project** e importa el repositorio de GitHub. Vercel reconoce que es una app de Next.js.
2. Antes de desplegar, abre **Environment Variables** y añade estas variables solo en el entorno
   **Production**. Las secretas, con la opción **Sensitive** (después no se pueden volver a leer):

- `DATABASE_URL`: la dirección `libsql://…` de Turso.
- `DATABASE_AUTH_TOKEN` (secreta): el token de Turso.
- `APP_URL` y `BETTER_AUTH_URL`: la dirección de producción, con `https://`: `https://<proyecto>.vercel.app` o
  tu dominio.
- `APP_ENCRYPTION_KEY` (secreta): 32 bytes al azar en Base64.
- `BETTER_AUTH_SECRET` (secreta): al menos 32 caracteres al azar.
- `CRON_SECRET` (secreta): al menos 32 caracteres al azar.
- `SETUP_TOKEN` (secreta): el código de instalación, al menos 32 caracteres al azar.
- `DEMO_MODE`: `false`.

Para generar cada valor al azar, en una terminal:

```
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

3. Guarda `APP_ENCRYPTION_KEY` también en el gestor de contraseñas, y nunca junto a las copias de la base: sin
   ella, las claves que el negocio ponga en la app (OpenRouter, correo, WhatsApp…) no se pueden leer.
4. No pongas la base de producción en el entorno **Preview**: las versiones de prueba nunca deben tocar datos
   reales.

La clave de OpenRouter no hace falta aquí: el negocio la pone después en Ajustes › IA.

[Captura: la pantalla de variables de entorno de Vercel, con las secretas marcadas como Sensitive]

## 4. Crear el almacén de archivos (Vercel Blob)

1. En el proyecto de Vercel, **Storage › Create › Blob** y elige **Private**. Esto no se puede cambiar después.
2. Elige una región de la Unión Europea, cerca de la base de datos. Tampoco se puede cambiar después.
3. Conéctalo al proyecto. Vercel añade solo las variables del almacén (`BLOB_STORE_ID` y
   `BLOB_READ_WRITE_TOKEN`); no hace falta copiarlas a mano.

Los archivos nunca tienen una dirección pública: la app los sirve después de comprobar quién los pide.

[Captura: el almacén Blob creado como Private y conectado al proyecto]

## 5. Desplegar

Pulsa **Deploy**. El archivo `vercel.json` del repositorio ya fija dos cosas:

- las funciones corren en Dublín (`dub1`), cerca de una base de datos en Irlanda. Si has elegido otra región de
  la UE para Turso, cambia `regions` por la más cercana;
- un cron diario a `/api/cron/tick`, el único que admite el plan Hobby.

Cuando termine, abre `https://<tu-dominio>/api/health`: tiene que responder con `"status":"ok"`.

## 6. El cron cada minuto

El trabajo en segundo plano (enviar correos, procesar mensajes, recordatorios) necesita una llamada cada
minuto. Hobby solo permite un cron al día, así que se usa un servicio externo gratuito, cron-job.org:

1. Crea un trabajo nuevo con la dirección `https://<tu-dominio>/api/cron/tick`, método **POST** y cada minuto.
2. En la configuración del trabajo añade la cabecera `Authorization` con el valor `Bearer <CRON_SECRET>` (la palabra `Bearer`,
   un espacio y tu `CRON_SECRET`).
3. Guarda y mira que las ejecuciones respondan **202**. Sin la cabecera correcta la app responde 401 y no hace
   nada.

cron-job.org desactiva el trabajo tras más de 25 fallos seguidos: si la app se queda sin trabajo en segundo
plano, míralo ahí. El secreto queda guardado en un servicio de terceros: si se filtra, cámbialo en Vercel y en
cron-job.org.

**Con Vercel Pro** no hace falta el cron externo: cambia en `vercel.json` la expresión `0 3 * * *` por
`* * * * *` y vuelve a desplegar.

[Captura: el trabajo de cron-job.org con la cabecera Authorization]

## 7. Poner en marcha el negocio

1. Abre `https://<tu-dominio>`: aparece el asistente de arranque.
2. En el primer paso, además del nombre, el email y la contraseña del propietario, escribe el **código de
   instalación** (el valor de `SETUP_TOKEN`). Así nadie que encuentre la dirección antes que tú puede quedarse
   con la instalación.
3. Sigue los pasos: negocio y sector, horario, clave de OpenRouter y canales.
4. En **Ajustes › Correo del sistema** configura el servidor de correo del negocio para que salgan las
   invitaciones y los enlaces de recuperación. Usa el puerto 465 o 587: Vercel bloquea el 25.
5. En **Ajustes › Diagnóstico** comprueba que la cola de trabajo avanza (la última ronda, hace menos de un par de
   minutos).

## Comprobaciones antes de usarla con clientes

- `DEMO_MODE` es `false` y no aparece la franja «Modo demo».
- El almacén de Blob es privado, y la base, el almacén y las funciones están en la UE.
- La verificación en dos pasos está activada en GitHub, Vercel, Turso, OpenRouter y cron-job.org, y en la
  cuenta de propietario de la app (Mi cuenta).
- `APP_ENCRYPTION_KEY` y el token de Turso están en el gestor de contraseñas.
- Los webhooks y los accesos de Google y Microsoft usarán siempre la dirección de producción: las demás
  direcciones de Vercel están protegidas y esos servicios no llegan a ellas.

## Problemas frecuentes

- **El despliegue falla con «Hobby accounts are limited to daily cron jobs»:** `vercel.json` tiene un cron más
  frecuente que uno al día. En Hobby deja el diario y usa cron-job.org.
- **La app no arranca y el registro dice que falta `APP_ENCRYPTION_KEY`:** falta la variable o no son 32 bytes
  en Base64. Si ya había claves guardadas y la has perdido, hay que volver a escribirlas en la app.
- **`/api/health` responde `"database":"error"`:** revisa `DATABASE_URL` y `DATABASE_AUTH_TOKEN`, y que hayas
  aplicado las migraciones (paso 2). En el plan gratuito, una base sin uso durante 10 días se archiva: se
  recupera con `turso group unarchive <grupo>`.
- **El primer paso dice «Falta el código de instalación»:** no está `SETUP_TOKEN` en las variables de
  Production. Añádela y vuelve a desplegar.
- **No llegan las invitaciones:** configura Ajustes › Correo del sistema (puerto 465 o 587).
- **Nada avanza en segundo plano:** revisa el trabajo de cron-job.org (dirección, método POST y cabecera
  `Authorization`).

## Más adelante: un servidor propio (VPS)

Para un negocio real, la alternativa a Vercel Pro será un VPS con Dokploy. Todavía no está preparada: tendrá
su propio apartado en esta guía. Lo comprobado hasta ahora (servidor, seguridad del panel, copias de seguridad y
dominio con HTTPS) está en `docs/plataforma-despliegue.md`.
