# Plataforma y despliegue

Referencia técnica de dónde corre la app y con qué límites: Vercel, Vercel Blob, Turso, el cron externo y el
futuro VPS con Dokploy. Todo se comprobó el 26-09-2026 contra la documentación oficial (ver «Fuentes»). Si
una cifra cambia, se corrige aquí antes de tocar el código.

Hoy la app solo corre en local (decisión del 26-09-2026): este documento prepara la configuración y las
guías, pero no se publica nada. La guía paso a paso está aparte (`docs/guia-despliegue.md`, también en la app, en
Ayuda) y la configuración de Vercel, en `vercel.json`.

## Resumen

| Pieza | Dato que condiciona el diseño | Consecuencia en el proyecto |
|---|---|---|
| Vercel Hobby | Solo uso personal y no comercial | Solo pruebas. Un negocio real va en Pro o en el VPS |
| Duración de las funciones | Hobby: 300 s por defecto y como máximo. Pro: 300 s por defecto, hasta 800 s (1.800 s en beta) | `tick()` trabaja con presupuesto de tiempo y trocea |
| `after()` | Corre dentro de la misma invocación y comparte su tope de duración | Lo que se hace tras responder también tiene límite |
| Cuerpo de petición y de respuesta | 4,5 MB | Los webhooks de Meta caben. Las subidas grandes van directas a Blob y los archivos se sirven en streaming |
| Vercel Cron | Hobby: una vez al día y con ±59 min de margen. Pro: cada minuto | En Hobby, cron externo cada minuto |
| Deployment Protection | «Standard Protection» protege todo menos los dominios de producción | Webhooks y OAuth apuntan siempre al dominio de producción |
| Vercel Blob | Existen almacenes privados | Almacén privado y archivos servidos por `/api/files/…` |
| Turso | `turso db create` crea libSQL; `--tursodb` crea el motor nuevo, sin FTS5 | Se crea siempre una base libSQL |
| Turso Free | 5 GB, 500 M filas leídas y 10 M escritas al mes; se archiva tras 10 días sin uso; sin DPA | Vale para pruebas. Con datos reales, un plan con DPA |
| Dokploy | Decenas de avisos de seguridad publicados el 21-07-2026 (versiones ≤ 0.29.8) | Instalar y mantener la última versión (0.30.7 el 18-09-2026) |

## Vercel

### Plan Hobby: solo pruebas

Las normas de uso de Vercel restringen Hobby a uso «non-commercial personal use only». Cuentan como uso
comercial, entre otros, cobrar por crear, actualizar o alojar el sitio y que lo programe alguien a quien se
le paga. Instalar esta plantilla para un negocio que paga es, por tanto, uso comercial: Hobby sirve para
probar y enseñar la demo; un negocio real necesita Pro (20 USD por asiento de desarrollador y mes, según la
página del plan) o el VPS.

Si se superan los límites de Hobby no se cobra, pero la función afectada queda parada hasta que pasan 30
días.

### Duración de las funciones y `after()`

- Fluid compute viene activado por defecto en los proyectos nuevos desde el 23-04-2025. Con él, para Node.js:

  | Plan | Por defecto | Máximo | Máximo ampliado |
  |---|---|---|---|
  | Hobby | 300 s | 300 s | — |
  | Pro | 300 s | 800 s | 1.800 s (beta, por función) |

- Se fija por ruta con `export const maxDuration = N` en el Route Handler. Si se supera, Vercel corta la
  invocación con un 504 (`FUNCTION_INVOCATION_TIMEOUT`).
- `after()` (estable desde Next.js 15.1) ejecuta trabajo cuando ya se ha enviado la respuesta. Según Next.js,
  «corre durante la duración máxima, por defecto o configurada, de la ruta». En Vercel se apoya en
  `waitUntil`, y Vercel dice que esas promesas «tienen el mismo tope que la propia función» y se cancelan si
  la función se agota. Vercel recomienda `after()` frente a `waitUntil` desde Next.js 15.1.
- Por eso `tick({ budgetMs })` calcula su presupuesto a partir del `maxDuration` de la ruta que lo lanza,
  menos lo ya gastado y un margen, y deja lo pendiente para el siguiente tick. Conviene fijar `maxDuration`
  de forma explícita en las rutas que lanzan `tick()` (webhooks, widget y cron), para que el presupuesto no
  dependa de un valor por defecto que puede cambiar.
- La documentación de Vercel avisa de que un cron puede no llegar o llegar dos veces, y de que dos
  ejecuciones pueden solaparse. La reclamación atómica de jobs (`UPDATE … RETURNING`) y los handlers
  idempotentes cubren los tres casos.
- En el VPS, `after()` funciona igual con el servidor de Node.js. Para no perder trabajo al reiniciar, el
  contenedor debe pararse con `SIGTERM` y esperar: Next.js termina las peticiones en curso y los `after()`
  pendientes, y recomienda de 10 a 30 s de margen.

### Cron: Vercel Cron o cron externo

- Vercel Cron hace un `GET` a la URL de producción, a la ruta indicada en `crons` de `vercel.json`, con el
  agente `vercel-cron/1.0` y la cabecera `x-vercel-cron-schedule`. Si el proyecto tiene la variable
  `CRON_SECRET`, la envía como `Authorization: Bearer <CRON_SECRET>` (Vercel recomienda al menos 16
  caracteres aleatorios). La hora es siempre UTC.
- No reintenta si falla, no sigue redirecciones y no se puede probar con `next dev`: en local se usa el ticker
  de `pnpm dev`.
- Hobby: hasta 100 cron jobs por proyecto, pero cada uno como mucho una vez al día y con precisión de hora
  (un `0 1 * * *` puede saltar entre la 1:00 y la 1:59). Una expresión más frecuente hace fallar el
  despliegue con el error «Hobby accounts are limited to daily cron jobs». Pro: cada minuto y con precisión de
  minuto.
- Consecuencia: el `vercel.json` del repositorio no lleva `* * * * *`: con él fallaría un despliegue en Hobby, y
  una prueba (`project-config.test.ts`) lo impide. Lleva un cron diario a `/api/cron/tick` (red de seguridad y
  tareas diarias, válido en los dos planes) y el trabajo de cada minuto lo lanza un cron externo, también en Pro
  (`docs/guia-despliegue.md`, «6. El cron cada minuto»). Si una instalación en Pro prefiere Vercel Cron cada minuto,
  quien mantiene el código cambia a la vez la expresión de `vercel.json` y esa prueba, que protege a las de Hobby.
- `/api/cron/tick` acepta `GET` (Vercel Cron) y `POST` (cron externo) y compara el `Bearer` en tiempo
  constante. Las opciones de cron externo están en «Cron externo cada minuto».

### Límite de 4,5 MB

- El cuerpo de la petición y el de la respuesta de una función no pueden pasar de 4,5 MB; si no, Vercel
  devuelve 413 (`FUNCTION_PAYLOAD_TOO_LARGE`). Las respuestas en streaming no tienen ese límite.
- Webhooks: los de WhatsApp (hasta 3 MB según la especificación) caben. Los medios no vienen en el webhook:
  se descargan después desde Graph.
- Subidas desde la interfaz (documentos de conocimiento, archivos de contexto, logos): en Vercel no pueden
  pasar por un Route Handler ni por una Server Action si superan 4,5 MB. Van directas del navegador a Blob
  («subidas de cliente», ver «Vercel Blob»). Además, las Server Actions de Next.js aceptan por defecto solo
  1 MB de cuerpo (`serverActions.bodySizeLimit`), así que las subidas no deben ir por Server Actions.
- Descargas: la ruta `/api/files/…` devuelve el archivo en streaming, así que no le afecta el límite.

### Dominio de producción, previews y Deployment Protection

- Cada despliegue tiene varias URL: la única del despliegue (cambia en cada uno), la de la rama de Git (fija
  por rama), la de producción y los dominios propios.
- «Standard Protection» protege todas las URL salvo los dominios de producción; también queda protegida la
  URL generada del propio despliegue de producción (la que lleva el identificador del despliegue). Con Vercel
  Authentication, quien no ha iniciado sesión en Vercel recibe una redirección al login de Vercel: Meta,
  Google, Microsoft y Telegram no pueden llegar a una preview. Conviene revisar en Settings › Deployment
  Protection qué alcance tiene el proyecto, porque el equipo puede fijar otro por defecto.
- Por eso los webhooks y las URI de redirección de OAuth usan siempre el dominio de producción
  (`<proyecto>.vercel.app` o el dominio propio). La variable de sistema `VERCEL_PROJECT_PRODUCTION_URL` lo da
  sin protocolo y existe incluso en las previews. `VERCEL_URL` no sirve con Standard Protection.
- Existe «Protection Bypass for Automation» (cabecera o parámetro `x-vercel-protection-bypass`). No se usa
  para Meta: el secreto quedaría escrito en la URL del panel de un tercero. Sirve, como mucho, para pruebas
  automáticas contra una preview.
- Las previews usan las variables del entorno «Preview»: no deben apuntar a la base de datos de producción.

### Variables de entorno «Sensitive»

- Una variable «Sensitive» no se puede volver a leer una vez creada; solo se puede editar su valor. Solo se
  puede crear en los entornos Production y Preview (no en Development). Para convertir una variable existente
  hay que borrarla y crearla de nuevo con la opción activada. En los logs de build, Vercel oculta los valores
  de 32 caracteres o más.
- Se crean así: `APP_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `CRON_SECRET`, `DATABASE_AUTH_TOKEN` y
  `OPENROUTER_API_KEY` si se usa. `BLOB_READ_WRITE_TOKEN` la añade Vercel al conectar el almacén (no
  verificado si la marca como Sensitive). El propietario del equipo puede imponerlo para todas las variables
  nuevas («Enforce Sensitive Environment Variables»).
- Como no se puede volver a leer, `APP_ENCRYPTION_KEY` se guarda también en un gestor de contraseñas: si se
  pierde, los secretos cifrados de la base de datos quedan ilegibles.

### Región de las funciones

Las funciones corren por defecto en Washington (`iad1`). En Hobby hay una sola región, que se puede cambiar
en Settings › Functions o con `regions` en `vercel.json`. Se pone la más cercana a la base de datos: con
Turso en Irlanda, Dublín (`dub1`). El almacén de Blob se crea también en una región de la UE, y esa región
no se puede cambiar después.

### Paquetes con binarios o módulos nativos

- Next.js empaqueta las dependencias del servidor. `serverExternalPackages` deja fuera las que deben
  cargarse con `require` de Node. Su lista por defecto ya incluye `@libsql/client`, `libsql`, `pino` (lo usa
  `imapflow`), `sharp` y `better-sqlite3`. No incluye `ffmpeg-static` ni `imapflow`.
- `outputFileTracingIncludes` añade archivos que el trazado no detecta. Sus claves son rutas de la app
  (`/api/cron/tick`) y sus valores, patrones de archivos relativos a la raíz del proyecto. Solo afecta a
  rutas de servidor que no sean estáticas ni Edge.
- `ffmpeg-static` (5.3.0, ffmpeg 6.1.1, licencia GPL-3.0-or-later) exporta la ruta a un binario que descarga
  su script de instalación (`node install.js`). Consecuencias:
  - pnpm bloquea por defecto los scripts de instalación de las dependencias: hay que aprobar este en
    `allowBuilds` de `pnpm-workspace.yaml` (desde pnpm 10.26; `onlyBuiltDependencies` desapareció en la
    versión 11). Sin esa aprobación, el binario no existe. Según `AGENTS.md`, aprobarlo requiere permiso de
    la persona.
  - El binario no se importa con `require`, así que el trazado no lo ve: `ffmpeg-static` va en
    `serverExternalPackages` y su binario en `outputFileTracingIncludes` de las rutas que pueden convertir
    audio (las que lanzan `tick()`). No verificado todavía en un despliegue real de este proyecto: se
    comprueba en la primera prueba en Vercel.
  - Cada función puede pesar como mucho 250 MB sin comprimir: el binario solo se incluye donde hace falta.
  - La variable `FFMPEG_BIN` sustituye la ruta: en Docker se puede instalar el ffmpeg del sistema y apuntar a
    él.
- `imapflow` (2.0.7) es JavaScript puro. No se espera configuración especial (no verificado en Vercel). En
  Vercel no hay IMAP IDLE: se conecta en cada tick.
- `@libsql/client` (0.18.0): con URL remota va por red; con `file:` usa el módulo nativo `libsql`. En Docker
  las dependencias se instalan dentro de la imagen, para la plataforma de la imagen.

### Correo desde Vercel

Vercel bloquea el puerto 25 de salida; el 465 y el 587 funcionan. Los ajustes automáticos de SMTP deben
proponer 465 o 587. Vercel recomienda las API HTTP de los proveedores frente a SMTP en funciones.

### Consumo del plan Hobby

Hobby incluye al mes, entre otros: 1.000.000 de invocaciones de funciones, 1.000.000 de Edge Requests,
4 horas de CPU activa, 360 GB-h de memoria y 100 GB de transferencia. El sondeo del tiempo real es lo que
más invocaciones gasta: una pestaña que pregunta cada 4 s hace 900 peticiones por hora. Por eso el sondeo se
pausa cuando la pestaña no está visible y se espacia cuando no hay actividad. El cron cada minuto suma unas
43.200 invocaciones al mes.

## Vercel Blob

### Almacén privado

- Vercel Blob tiene almacenes privados (disponibilidad general; requiere `@vercel/blob` 2.3 o posterior,
  la última el 26-09-2026 es la 2.8.0). El modo privado o público se elige al crear el almacén y no se puede
  cambiar. Se crea como **Private**: en Storage › Create › Blob › Private, o con
  `vercel blob create-store <nombre> --access private`.
- En un almacén privado toda lectura y escritura requiere autenticación. La URL de cada archivo
  (`https://<id>.private.blob.vercel-storage.com/<ruta>`) no es pública.
- La alternativa pensada al principio (almacén público con nombres imposibles de adivinar servidos por una
  ruta autenticada) ya no hace falta. Los nombres aleatorios se mantienen igualmente como defensa extra.

### Credenciales

- Al conectar el almacén a un proyecto, Vercel añade `BLOB_STORE_ID` y usa OIDC (un token de vida corta que
  rota solo), además de `BLOB_WEBHOOK_PUBLIC_KEY`. También añade `BLOB_READ_WRITE_TOKEN`, de larga
  duración, que hace falta para `handleUpload` y para código fuera de Vercel.
- El SDK busca credenciales en este orden: la opción `token`; OIDC con el id del almacén; y
  `BLOB_READ_WRITE_TOKEN`. Si no hay ninguna, lanza un error.
- El adaptador `FileStorage` activa `vercel-blob` si existe `BLOB_STORE_ID` o `BLOB_READ_WRITE_TOKEN`, no
  solo con el segundo.

### API del SDK

- `put(ruta, cuerpo, { access: 'private', … })` sube y devuelve `pathname`, `contentType`,
  `contentDisposition`, `url`, `downloadUrl` y `etag`. Opciones útiles: `addRandomSuffix`,
  `allowOverwrite` (por defecto, subir a una ruta que ya existe da error), `contentType`,
  `cacheControlMaxAge`, `multipart` (recomendado por encima de 100 MB) e `ifMatch`.
- `get(rutaOUrl, { access: 'private' })` devuelve `null` si no existe o
  `{ statusCode, stream, headers, blob }`, con `statusCode` 200 o 304. Admite `ifNoneMatch` y
  `useCache: false`, para leer justo después de sobrescribir.
- `head()` devuelve los metadatos y lanza `BlobNotFoundError` si no existe. `del()` acepta una ruta o una
  lista, no falla si no existe y es gratis; la caché puede tardar hasta un minuto en olvidar el archivo.
  También existen `list()`, `copy()` y `rename()`.
- Una subida desde el servidor (`put` con el archivo recibido en la función) sigue limitada a 4,5 MB.
- Subidas de cliente: el navegador usa `upload()` de `@vercel/blob/client` y el servidor genera el permiso
  con `handleUpload` (necesita `BLOB_READ_WRITE_TOKEN`) o con `uploadPresigned` y `handleUploadPresigned`
  (funcionan con OIDC). La sesión y el rol se comprueban en `onBeforeGenerateToken`, que también fija los
  tipos permitidos. Vercel avisa de que, sin esa comprobación, cualquiera puede subir.
- El aviso `onUploadCompleted` no llega a localhost y en las previews va a la URL de la rama, protegida por
  Deployment Protection. Por eso no se depende de él: al terminar, el navegador avisa a una ruta propia y el
  servidor comprueba el archivo con `head()` antes de registrarlo.
- Existen URL firmadas de vida corta (`issueSignedToken` y `presignUrl`). No se usan de momento.

### Servir los archivos

`/api/files/…` comprueba la sesión y el permiso sobre ese archivo concreto, lo lee con `get()` y lo
devuelve en streaming con su `Content-Type`, `X-Content-Type-Options: nosniff` y
`Cache-Control: private, no-store` (lo que Vercel recomienda para datos sensibles). Vercel desaconseja cachear
archivos privados en su CDN (`s-maxage`) y fiarse del middleware para autorizarlos: la comprobación va en la
propia ruta, junto a `get()`.

### Límites y precio en Hobby

| Recurso (al mes) | Incluido en Hobby |
|---|---|
| Almacenamiento (media del mes) | 1 GB |
| Operaciones simples (`head`, lecturas que no están en caché) | 10.000 |
| Operaciones avanzadas (`put`, `copy`, `list`, crear almacén; cada parte de una subida multiparte) | 2.000 |
| Transferencia de Blob | 10 GB |

- Si se superan no se cobra, pero Blob queda inaccesible hasta que pasan 30 días. Navegar el almacén desde el
  panel de Vercel también cuenta como operaciones.
- Límite de ritmo en Hobby: 1.200 operaciones simples y 900 avanzadas por minuto. Tamaño máximo por archivo:
  5 TB; los de más de 512 MB no se cachean.
- 2.000 subidas al mes se agotan rápido: la demo no sube su contenido a Blob en Vercel si puede evitarse.

## Turso

### Qué base crear: libSQL

- Turso Cloud aloja dos motores compatibles con SQLite: **libSQL** (el fork de SQLite que ha movido Turso
  Cloud durante años) y **Turso** (una reescritura desde cero, en «early preview» en Turso Cloud).
  `turso db create <nombre>` crea una base libSQL; con `--tursodb` crea una del motor nuevo.
- La app usa FTS5 (`unicode61 remove_diacritics 2`), `F32_BLOB(1536)`, `vector_distance_cos` y el índice
  vectorial de libSQL. En libSQL de Turso Cloud, FTS5 viene precargado junto a JSON y R*Tree, y la búsqueda
  vectorial es nativa, sin extensiones. El motor nuevo sustituye FTS3/4/5 por su propia búsqueda de texto
  (basada en Tantivy, con `CREATE INDEX … USING fts`) y tiene otras funciones de vectores: las migraciones de
  la app no funcionarían. **Nunca se usa `--tursodb`.**
- Turso recomienda su motor nuevo para proyectos nuevos; aquí se mantiene libSQL porque Drizzle y
  `@libsql/client` lo soportan de forma estable y porque la búsqueda depende de FTS5.
- Vectores en libSQL: tipos `F32_BLOB` y otros, `vector_distance_cos`, `vector_top_k(índice, vector, k)` e
  índice con `libsql_vector_idx(columna)` y opciones como `metric=cosine`; hasta 65.536 dimensiones. El
  índice necesita una tabla con `ROWID` o con clave primaria de una sola columna. Funciona igual en Turso Cloud
  y en libSQL local. El detalle de la búsqueda híbrida es cosa de su propio documento.

### Crear la base, la URL y el token

1. Instalar la CLI (en Windows, dentro de WSL) e iniciar sesión con `turso auth signup` o `turso auth login`.
   También se puede hacer desde el panel web de Turso.
2. Elegir la región: `turso db locations` da la lista actual. En el ejemplo de la documentación de la API,
   la única ubicación de la UE es `aws-eu-west-1` (Irlanda); si hoy hay otras, se elige la más cercana.
   Las bases viven en grupos con una ubicación principal, y en los planes Free y Developer solo hay un grupo
   (crear más de uno es de Scaler en adelante). Si la cuenta es nueva, se crea primero el grupo en la UE con
   `turso group create <grupo> --location <código>` y se comprueba con `turso group list`. No verificado: si
   `turso db create` crea solo un grupo por defecto en la región más cercana cuando no hay ninguno.
3. `turso db create <nombre>` (con `--group <grupo>` si hace falta), sin `--tursodb`.
4. URL: `turso db show <nombre> --url` devuelve `libsql://<base>-<organización>.turso.io`. La misma base
   responde en `https://` para ir por HTTP.
5. Token: `turso db tokens create <nombre>`, con `--expiration` (`never` o una duración como `7d`) y
   `--read-only` para tokens de solo lectura. La documentación no dice cuál es la caducidad por defecto: se
   indica siempre de forma explícita. `turso db tokens invalidate <nombre>` anula todos los tokens de la
   base.
6. En Vercel: `DATABASE_URL=libsql://…` y `DATABASE_AUTH_TOKEN` (Sensitive).
7. Las migraciones se aplican a mano, desde local o desde un flujo de CI, antes de publicar. No se lanzan en
   el build de Vercel: el build también corre para las previews y podría migrar la base equivocada.

### Plan gratuito

| Free | Incluido |
|---|---|
| Bases de datos | 100 |
| Almacenamiento | 5 GB |
| Filas leídas al mes | 500 millones |
| Filas escritas al mes | 10 millones |
| Sincronización al mes | 3 GB |
| Restauración a un momento anterior | 1 día |
| Registro de auditoría, recuperar bases borradas, DPA | No |

- Si se supera una cuota, las consultas fallan con el código `BLOCKED`.
- En el plan gratuito, las bases se archivan tras 10 días sin actividad; se recuperan con
  `turso group unarchive <grupo>`. Con el cron cada minuto no pasa, pero una instalación de pruebas parada sí
  se archiva.
- Cada fila que recorre una consulta cuenta como leída, aunque no se devuelva. Los `count(*)` y las consultas
  sin índice recorren la tabla entera: las consultas del sondeo deben ir por índice.
- El plan gratuito no incluye DPA (contrato de encargo del tratamiento). Con datos personales de clientes
  reales, el RGPD lo exige con cada encargado: para un negocio real hace falta un plan que lo incluya
  (Developer en adelante; la página muestra 4,99 USD al mes con pago anual). Esto es una deducción a partir
  de la tabla de precios, no una afirmación de Turso.

### Conexión y limitaciones

- `createClient({ url, authToken })` de `@libsql/client` acepta `libsql://`, `https://`, `wss://` y
  `file:`. La variante `@libsql/client/web` no admite `file:`: la app usa siempre la de Node. Por defecto hace
  hasta 20 peticiones a la vez (`concurrency`).
- Turso indica que WebSocket rinde mejor con muchas consultas seguidas y HTTP con consultas sueltas, y
  recomienda medir. Si WebSocket da problemas en las funciones, se usa la URL `https://`.
- Un `batch` es una transacción implícita. Una transacción interactiva bloquea las escrituras de la base
  hasta que termina, con un tope de 5 s: la comprobación de citas sin doble reserva debe ser corta (leer e
  insertar, sin llamadas externas dentro).
- En Turso Cloud, `PRAGMA user_version` y `application_id` son de solo lectura, `busy_timeout` y
  `journal_mode` no se admiten y `VACUUM` está desactivado.
- Drizzle se conecta con `drizzle-orm/libsql`. Para Turso, la documentación de Turso y la de Drizzle usan
  `dialect: 'turso'` en `drizzle.config.ts`.

## Cron externo cada minuto (Hobby)

| Opción | ¿Cada minuto? | Cabecera `Authorization` | Límites relevantes | Veredicto |
|---|---|---|---|---|
| cron-job.org | Sí, hasta 60 veces por hora | Sí, admite cabeceras y métodos a elección | Gratis; corta a los 30 s; lee como mucho 64 KB de respuesta; desactiva el job tras más de 25 fallos seguidos | Recomendado |
| GitHub Actions (`schedule`) | No: mínimo cada 5 min | Sí, con un secreto del repositorio | Se retrasa en horas de carga; solo la rama por defecto; en repos públicos se desactiva tras 60 días sin actividad | Solo como respaldo |
| Upstash QStash | Sí (`* * * * *`) | Sí, con el prefijo `Upstash-Forward-` (`Upstash-Forward-Authorization`) | Free: 1.000 mensajes al día y 10 programaciones; cada reintento cuenta | El plan gratuito no llega (cada minuto son 1.440 al día); cada 2 minutos sí |
| Vercel Cron | Solo en Pro | Automática con `CRON_SECRET` | Exige cambiar `vercel.json` y su prueba (hoy, cron diario para que Hobby despliegue) | Posible en Pro; el cron externo sirve en los dos planes |

- Configuración: `POST https://<dominio de producción>/api/cron/tick` con
  `Authorization: Bearer <CRON_SECRET>`.
- Como cron-job.org corta a los 30 s, la ruta responde enseguida (202) y hace el trabajo en `after()` con el
  presupuesto de su `maxDuration`, o termina antes de unos 25 s.
- El secreto queda guardado en un servicio de terceros. Solo permite lanzar `tick()`, que es idempotente, pero
  se usa uno largo y aleatorio y se cambia si se filtra.

## Futuro: VPS con Dokploy

### Servidor

- Hostinger KVM 2: 2 vCPU, 8 GB de RAM, 100 GB NVMe y 8 TB de transferencia. Hostinger ofrece la plantilla
  «Ubuntu 24.04 with Dokploy», que deja Dokploy instalado; el panel queda en `http://<IP>:3000`. Dokploy pide
  al menos 2 GB de RAM y 30 GB de disco, y usa los puertos 80, 443 y 3000.
- La plantilla puede traer una versión antigua: nada más instalar se actualiza con
  `curl -sSL https://dokploy.com/install.sh | sh -s update` y se comprueba la versión.

### Seguridad

- El 21-07-2026 Dokploy publicó decenas de avisos de seguridad, la mayoría críticos (ejecución de comandos
  como root en el servidor, fallos de control de acceso, acceso a datos de otras organizaciones) para las
  versiones hasta la 0.29.8; algunas correcciones indican la 0.29.13. El 11-05-2026 ya había publicado otros,
  entre ellos una toma de control del administrador sin autenticación (CVE-2026-45631, versiones 0.27.0 a
  0.28.8). La última versión el 26-09-2026 es la 0.30.7, del 18-09-2026.
- Algunos avisos no indican versión corregida y marcan todas como afectadas: por ejemplo, cualquier usuario
  que pueda editar un Compose puede ejecutar órdenes en el servidor a través de su comando personalizado
  (GHSA-qh6h-669j-77rw). Quien entra en el panel puede acabar siendo root del servidor: **el panel nunca se
  da al negocio**. Solo lo usa quien implanta, con verificación en dos pasos o passkeys.
- La guía de producción de Dokploy pide, entre otras cosas:
  - cortafuegos que solo abra 22, 80 y 443, con `ufw-docker`, porque Docker salta las reglas de UFW para los
    puertos publicados;
  - cerrar el puerto 3000 cuando el panel ya tenga un dominio con HTTPS funcionando:
    `docker service update --publish-rm "published=3000,target=3000,mode=host" dokploy`;
  - el panel de Traefik apagado y HSTS en el router HTTPS;
  - copias a S3 y restauraciones probadas.

### docker-compose

- Tres servicios que usan la misma imagen:
  - `migrate`: aplica las migraciones y termina (sin reinicio automático);
  - `web`: el servidor de Next.js en modo `standalone`;
  - `worker`: `tick()` en bucle, con IMAP IDLE opcional.

  `web` y `worker` dependen de `migrate` con `condition: service_completed_successfully`, que Docker define
  como «la dependencia debe terminar con éxito antes de arrancar el servicio que depende de ella».
- Sin `ports:`: se usa `expose` y el dominio se configura en la pestaña Domains, desde donde Dokploy añade las
  etiquetas de Traefik. Sin `container_name`, porque dos instalaciones en el mismo servidor chocarían. Para
  varias instalaciones, Dokploy tiene «Isolated Deployments», que crea una red por aplicación y conecta
  Traefik a ella.
- Los datos (`data/`: base SQLite y archivos) van en un volumen con nombre compartido por los tres servicios.
  Las copias de volúmenes de Dokploy solo funcionan con volúmenes con nombre, y Dokploy avisa de que las rutas
  absolutas del servidor se limpian en los despliegues.
- Variables: Dokploy escribe las de su pestaña Environment en un `.env`, pero **no las pasa a los
  contenedores**. Cada una se referencia en el compose con `${VAR}` (o se usa `env_file: .env`). La forma
  `${VAR:?mensaje}` hace fallar el despliegue si falta, que es mejor que arrancar sin clave.
- Next.js mete las variables `NEXT_PUBLIC_` en el código al compilar: una imagen compartida por varios
  negocios no puede llevar valores públicos propios de cada uno. Lo que cambia por instalación (URL, clave
  pública VAPID, nombre) se lee en el servidor en tiempo de ejecución.
- `output: 'standalone'` genera `.next/standalone` con un `server.js` mínimo. `public/` y `.next/static` se
  copian a mano, y el puerto y la interfaz se fijan con `PORT` y `HOSTNAME` (en el contenedor,
  `HOSTNAME=0.0.0.0`). El modo standalone solo incluye lo que usa el servidor de Next.js: el worker y las
  migraciones necesitan su propio empaquetado dentro de la imagen.
- `web` expone `/api/health`, que comprueba la base de datos. Si se usa como healthcheck de Docker, la imagen
  necesita algo con que llamarla (por ejemplo, el propio Node): no todas las imágenes base traen `curl`.
- Para no cortar `after()` ni jobs a medias, el contenedor se para con `SIGTERM` y un margen de unos 30 s.

### Imágenes en GHCR

- Se construyen en GitHub Actions y se suben a `ghcr.io`, nunca en el VPS. GitHub documenta el flujo con
  `docker/login-action`, `docker/metadata-action` y `docker/build-push-action`, autenticado con el
  `GITHUB_TOKEN` del flujo y el permiso `packages: write`.
- En el VPS, Dokploy descarga la imagen con un registro GHCR configurado. GHCR solo admite tokens personales
  clásicos: para descargar basta `read:packages`, aunque la guía de Dokploy muestre `write:packages`.
- Las imágenes se etiquetan con la versión (`APP_VERSION`), no solo con `latest`, para poder volver atrás.

### Dominio propio con HTTPS

Los dominios `traefik.me` que genera Dokploy son solo HTTP (HTTPS apagado y sin certificado) y Dokploy los
presenta para desarrollo y pruebas. Meta exige HTTPS con un certificado válido y no admite certificados
autofirmados: con `traefik.me` los webhooks de WhatsApp no funcionan. Cada instalación lleva un dominio o
subdominio propio con Let's Encrypt.

### Copias de seguridad

- Las copias de volúmenes de Dokploy suben los volúmenes con nombre a un destino S3 (AWS S3, Cloudflare R2,
  Backblaze B2 o Google Cloud Storage), con horario tipo cron. Tienen la opción de parar el contenedor
  mientras copian, que Dokploy recomienda para no corromper datos. Para restaurar, el volumen de destino no
  puede existir.
- Una base SQLite copiada mientras se escribe puede quedar corrupta: o se para el contenedor durante la copia
  (un rato sin servicio, de madrugada) o se hace antes una copia consistente con SQLite y se sube esa.
- `APP_ENCRYPTION_KEY` se guarda fuera del servidor y fuera del mismo cubo que las copias: sin ella, los
  secretos de la copia son ilegibles; junto a ella, una copia filtrada lo expone todo.

### Nunca «Fresh Volumes»

Desde la versión 0.30.5 (02-09-2026), los Compose de Dokploy tienen un botón «Fresh Volumes» (su diálogo se
titula «Deploy with Fresh Volumes») que ejecuta `docker compose down --volumes` antes de desplegar: borra la
base de datos y los archivos. La API tiene la misma opción (`freshVolumes`). No se usa nunca en una
instalación real; los datos solo vuelven desde una copia.

## Fuentes

Consultadas el 26-09-2026. Entre paréntesis, la fecha de actualización que indica la propia fuente.

- Vercel, plan Hobby (14-09-2026): https://vercel.com/docs/plans/hobby
- Vercel, normas de uso justo y uso comercial (14-09-2026): https://vercel.com/docs/limits/fair-use-guidelines
- Vercel, límites de las funciones (24-08-2026): https://vercel.com/docs/functions/limitations
- Vercel, duración máxima (24-08-2026): https://vercel.com/docs/functions/configuring-functions/duration
- Vercel, Fluid compute (24-08-2026): https://vercel.com/docs/fluid-compute
- Vercel, `@vercel/functions` y `waitUntil` (03-09-2026): https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package
- Vercel, cron jobs (16-09-2026): https://vercel.com/docs/cron-jobs
- Vercel, gestionar cron jobs y `CRON_SECRET` (11-08-2026): https://vercel.com/docs/cron-jobs/manage-cron-jobs
- Vercel, precios y límites de cron (15-07-2026): https://vercel.com/docs/cron-jobs/usage-and-pricing
- Vercel, límite de 4,5 MB (10-11-2025): https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions
- Vercel, Deployment Protection (15-09-2026): https://vercel.com/docs/deployment-protection
- Vercel, Vercel Authentication (15-09-2026): https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication
- Vercel, Protection Bypass for Automation (16-09-2026): https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
- Vercel, URL generadas (08-09-2026): https://vercel.com/docs/deployments/generated-urls
- Vercel, variables de sistema (15-07-2026): https://vercel.com/docs/environment-variables/system-environment-variables
- Vercel, variables Sensitive (28-08-2026): https://vercel.com/docs/environment-variables/sensitive-environment-variables
- Vercel, regiones de las funciones (11-08-2026): https://vercel.com/docs/functions/configuring-functions/region
- Vercel, enviar correo desde Vercel (24-09-2026): https://vercel.com/kb/guide/sending-emails-from-an-application-on-vercel
- Vercel Blob (26-08-2026): https://vercel.com/docs/vercel-blob
- Vercel Blob, almacenamiento privado (15-09-2026): https://vercel.com/docs/vercel-blob/private-storage
- Vercel Blob, SDK (26-08-2026): https://vercel.com/docs/vercel-blob/using-blob-sdk
- Vercel Blob, subidas de cliente (15-09-2026): https://vercel.com/docs/vercel-blob/client-upload
- Vercel Blob, precios y límites (23-09-2026): https://vercel.com/docs/vercel-blob/usage-and-pricing
- Next.js 16.3.6, `after` (13-03-2026): https://nextjs.org/docs/app/api-reference/functions/after
- Next.js 16.3.6, `serverExternalPackages` (05-12-2025): https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages
- Next.js 16.3.6, `output` y `outputFileTracingIncludes` (08-10-2025): https://nextjs.org/docs/app/api-reference/config/next-config-js/output
- Next.js 16.3.6, `serverActions` (07-09-2026): https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions
- Next.js 16.3.6, alojamiento propio (25-08-2026): https://nextjs.org/docs/app/guides/self-hosting
- `ffmpeg-static` 5.3.0 en npm (código y `package.json`): https://registry.npmjs.org/ffmpeg-static/latest y https://github.com/eugeneware/ffmpeg-static
- pnpm, ajustes de build (documentación de la versión 12): https://pnpm.io/settings/build
- Turso Cloud: https://docs.turso.tech/turso-cloud
- Turso, quickstart y `--tursodb`: https://docs.turso.tech/quickstart
- Turso, libSQL: https://docs.turso.tech/libsql
- Turso, extensiones precargadas (FTS5): https://docs.turso.tech/features/sqlite-extensions
- Turso, vectores: https://docs.turso.tech/features/ai-and-embeddings
- Turso, extensiones del motor nuevo (FTS con Tantivy): https://docs.turso.tech/sql-reference/extensions
- Turso, CLI `db create`, `db show`, `db tokens create`, `db locations`, `group create`, `group unarchive`: https://docs.turso.tech/cli/db/create, https://docs.turso.tech/cli/db/show, https://docs.turso.tech/cli/db/tokens/create, https://docs.turso.tech/cli/db/locations, https://docs.turso.tech/cli/group/create, https://docs.turso.tech/cli/group/unarchive
- Turso, API de ubicaciones: https://docs.turso.tech/api-reference/locations/list
- Turso, autenticación y URL: https://docs.turso.tech/sdk/authentication
- Turso, referencia TypeScript: https://docs.turso.tech/sdk/ts/reference
- Turso, limitaciones de Turso Cloud: https://docs.turso.tech/cloud/limitations
- Turso, uso y facturación (`BLOCKED`): https://docs.turso.tech/help/usage-and-billing
- Turso, precios: https://turso.tech/pricing
- Turso, Drizzle: https://docs.turso.tech/sdk/ts/orm/drizzle
- cron-job.org, preguntas frecuentes: https://cron-job.org/en/faq/
- GitHub Actions, evento `schedule`: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- Upstash QStash, programaciones: https://upstash.com/docs/qstash/features/schedules
- Upstash QStash, reenviar cabeceras: https://upstash.com/docs/qstash/howto/publishing
- Upstash QStash, precios: https://upstash.com/pricing/qstash
- Dokploy, instalación: https://docs.dokploy.com/docs/core/installation
- Dokploy, guía de producción: https://docs.dokploy.com/docs/core/guides/production-hardening
- Dokploy, Docker Compose: https://docs.dokploy.com/docs/core/docker-compose
- Dokploy, dominios en Compose: https://docs.dokploy.com/docs/core/docker-compose/domains
- Dokploy, utilidades de Compose (Isolated Deployments): https://docs.dokploy.com/docs/core/docker-compose/utilities
- Dokploy, dominios generados `traefik.me`: https://docs.dokploy.com/docs/core/domains/generated
- Dokploy, copias de volúmenes: https://docs.dokploy.com/docs/core/volume-backups
- Dokploy, registro GHCR: https://docs.dokploy.com/docs/core/registry/ghcr
- Dokploy, avisos de seguridad: https://github.com/Dokploy/dokploy/security/advisories
- Dokploy, versiones: https://github.com/Dokploy/dokploy/releases
- Dokploy, «Fresh Volumes» (PR #4195, fusionado el 02-09-2026): https://github.com/Dokploy/dokploy/pull/4195
- Docker Compose, servicios (`depends_on`, `expose`): https://docs.docker.com/reference/compose-file/services/
- Docker Compose, interpolación de variables: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/
- GitHub, publicar imágenes Docker: https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images
- GitHub, Container registry: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- Meta, webhooks (HTTPS y certificado válido): https://developers.facebook.com/docs/graph-api/webhooks/getting-started
- Hostinger, VPS: https://www.hostinger.com/vps-hosting
- Hostinger, plantilla Dokploy (actualizada el 14-08-2026): https://www.hostinger.com/support/9822596-how-to-use-the-dokploy-vps-template-at-hostinger/
