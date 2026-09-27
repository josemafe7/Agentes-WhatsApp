# Pruebas

Qué se prueba y cómo, para demostrar que el código funciona.

## Qué se prueba

- Cada fase añade pruebas de lo que construye.
- El «se comprueba» de cada fase de `docs/spec.md` se convierte, siempre que se pueda, en una prueba de
  Playwright que hace lo mismo que haría la persona.
- Las reglas de «Qué hace» y los permisos de «Quién puede hacer qué» de `docs/spec.md` son la lista de lo
  que hay que probar: cada una tiene su prueba siempre que se pueda, la más sencilla que la demuestre. El
  nombre de la prueba cita el código de su regla (`[USU-01]`), para saber qué regla se rompe si falla.
- Las pruebas de esas reglas y permisos se escriben antes que el código que las cumple, leyendo la
  especificación y no el código: primero fallan y después se construye hasta que pasan. Es la forma de
  trabajar, no algo que haya que enseñarme ni preguntarme.
- La lógica (cálculos, reglas del negocio, validaciones, permisos) se prueba con Vitest, también con datos
  incorrectos. La agenda y los plazos, con la hora fijada en la prueba, incluidos los cambios de hora.
- Los permisos se prueban para cada rol: en cada fila de «Quién puede hacer qué», los roles que pueden lo
  hacen, y los que no reciben «no permitido» sin que cambie nada. Se llama a `src/data/` o a la acción
  directamente, no a través de la pantalla, porque ocultar un botón no protege.
- Cada dato protegido tiene una prueba de que otro usuario no puede verlo ni cambiarlo: un Agente, lo de
  canales que no son suyos; un visitante del chat web, la conversación de otro.
- Cuando se corrige un fallo de funcionamiento, primero se escribe una prueba que lo reproduce. Los textos,
  los colores y los detalles visuales no se prueban.

## Cómo

- Vitest, con la prueba junto al código que prueba (`invoice.test.ts`). No admite componentes de servidor
  asíncronos: esos se prueban con Playwright.
- `server-only` impide cargar un módulo fuera de Next.js: la configuración de Vitest lo sustituye por un
  módulo vacío, para poder probar `src/data/` y `src/server/`.
- Cada archivo de pruebas de Vitest trabaja con su propia base libSQL temporal, una copia vacía de una base
  con las migraciones aplicadas que se prepara una vez por ejecución (`src/test/global-setup.ts` y
  `src/test/setup.ts`), y crea solo los datos que necesita: nunca `data/local.db`. Así las pruebas no dependen
  unas de otras ni de la demo. Las pruebas usan Better Auth y la base de verdad, así que el tiempo máximo de
  cada una es de 30 s.
- Playwright, en `e2e/` y con Chromium (`pnpm exec playwright install chromium` la primera vez). Arranca él
  solo (`webServer`) el servidor que simula los servicios externos (`e2e/mocks/`, puerto 3101) y, como
  recomienda Next.js, la versión compilada de la app (`pnpm build` y `next start`) tres veces: la demo en el
  puerto 3100 con `data/e2e.db` (migraciones, demo de la peluquería, dos usuarios propios de las pruebas y la cita
  del recordatorio, `e2e/support/create-agenda-fixtures.ts`), una instalación vacía en el 3102 con
  `data/e2e-fresh.db`, para el asistente de arranque, y la demo del restaurante en el 3103 con
  `data/e2e-restaurante.db` (`pnpm seed --sector=restaurante`), solo para la agenda por aforo (proyecto
  `restaurant`, `e2e/restaurant/`; sus pruebas entran por el formulario y el servidor tiene la clave de prueba de
  OpenRouter simulado en su entorno). Las bases se preparan antes de compilar
  (`e2e/support/prepare-databases.mjs`, que solo borra archivos `data/e2e*.db`) y los secretos de prueba (también
  el código de instalación que la versión compilada pide en el asistente) se generan en cada ejecución: nunca toca
  `data/local.db` ni `.env.local`.
- Se entra siempre por el formulario, como una persona: el inicio de sesión de Better Auth no responde por HTTP
  (`src/server/auth.ts`). En Vitest, las pruebas usan `auth.api.*`, como las Server Actions.
- Las pruebas de Playwright van de una en una, porque comparten los archivos de base de datos.
- Respuestas de la IA en Playwright: la app de las pruebas espera `REPLY_DEBOUNCE_MS` (2 s, en
  `e2e/support/env.ts`) en vez de 4–8 s, lo justo para que tres mensajes escritos seguidos en el chat web caigan en
  la misma respuesta. Las pruebas esperan la respuesta ejecutando además la cola con `/api/cron/tick`
  (`e2e/support/engine.ts`), salvo `webchat-background-reply.spec.ts`, que nunca la llama para demostrar que la
  respuesta llega sola ([MOT-15]). Cada prueba crea sus propios agentes, chats web y textos únicos
  (`e2e/support/names.ts`), y cada visitante del chat es un navegador nuevo con su propia IP. La forma de las
  pantallas que usan (textos, roles y nombres accesibles) está en los ayudantes de `e2e/support/` (`channels.ts`,
  `widget.ts`, `inbox.ts`, `simulator.ts`, `team.ts`, `whatsapp.ts`, `knowledge.ts`, `agenda.ts` y `email.ts`), para
  cambiarla en un solo sitio.
- En Vitest, los tiempos de la IA (pausas, esperas, resúmenes) se prueban con la hora fijada: el motor recibe
  `now`, y cuando una función de `src/data/` usa la hora real solo se falsea `Date`
  (`vi.useFakeTimers({ toFake: ["Date"] })`), nunca los temporizadores, que usa la base de datos.
- La agenda (fase 5): el motor de disponibilidad es una función pura y se prueba sin base de datos, con la hora fijada,
  en los dos cambios de hora de Madrid (25-10-2026 y 28-03-2027), aforo, márgenes, antelación, ausencias y bloqueos
  (`src/server/booking/availability.test.ts`). El servicio de citas se prueba contra la base de verdad, también con
  reservas lanzadas a la vez para el último hueco (`service.test.ts`). `src/server/booking/test-helpers.ts` crea
  negocios de prueba (una peluquería, un negocio por aforo, recursos y servicios) para las pruebas de otras partes. Las
  acciones de la Agenda y de su configuración se prueban por rol con `Date` falseado. La demo de la agenda se
  comprueba para los nueve sectores y varios días de carga (también en los cambios de hora) en
  `scripts/lib/seed-bookings.test.ts`: el motor acepta cada cita de la demo.
- En la versión compilada los límites de peticiones están activos y todas las pruebas salen del mismo
  ordenador: cada prueba envía su propia IP en `X-Forwarded-For` (`e2e/support/test.ts`), así no se estorban,
  y dos pruebas demuestran que los límites existen.
- Vitest excluye `e2e/` en su configuración, porque por defecto recogería también los `.spec.ts` de
  Playwright.
- Las pruebas no dependen unas de otras ni del orden en que se ejecutan.
- Datos inventados y usuarios de prueba: los del seed (ver `docs/conventions.md`). Las pruebas nunca se
  ejecutan contra una base de datos con datos reales (tampoco la de Turso de producción): si la del
  proyecto ya los tiene, antes se separan desarrollo y producción, como dice `docs/security.md`.
- Los servicios externos nunca se llaman de verdad: ni los de pago (IA, OCR) ni los demás. En Vitest,
  `src/test/setup.ts` hace fallar cualquier `fetch` a otra máquina, así que una prueba que olvida su `fetch`
  falso falla en vez de llamar al servicio real.
  - En Vitest, cada cliente de `src/lib/<servicio>/` recibe un `fetch` falso con la respuesta de la
    prueba. Para OpenRouter, `src/test/fake-openrouter.ts` trae ese `fetch` (guarda cada llamada), las
    respuestas documentadas (chat, catálogo con un ejemplo de cada exclusión) y una clave de prueba; el código
    del servidor lo recibe con `fetchImpl` (por ejemplo, `runAgent(input, { fetchImpl })`).
  - En Playwright, un servidor simulado (`e2e/mocks/`) responde por Meta, OpenRouter, Google, Microsoft,
    Mistral y Telegram, y la app apunta a él con sus variables de URL base (`OPENROUTER_BASE_URL`,
    `META_GRAPH_BASE_URL`, `GOOGLE_OAUTH_BASE_URL`, `GOOGLE_API_BASE_URL`, `MS_LOGIN_BASE_URL`,
    `MS_GRAPH_BASE_URL`, `MISTRAL_BASE_URL` y `TELEGRAM_API_BASE_URL`).
  - OpenRouter simulado (`e2e/mocks/routes/openrouter.mjs`): solo responde a las claves de prueba de
    `e2e/mocks/test-keys.json`; su catálogo tiene modelos de cuatro proveedores y uno de cada exclusión; da los
    proveedores de cada modelo y la lista sin retención de datos (Whisper está en ella, Voxtral no); el chat
    contesta de forma fija con el nombre del agente, el canal y lo que escribió el cliente, llama a
    `transferir_a_humano` cuando el cliente pide «una persona» (argumentos en `e2e/mocks/openrouter-scenarios.json`)
    y devuelve tokens y coste que crecen con cada mensaje; las notas de voz reciben una transcripción fija. Cada prueba puede forzar errores con `mock.stub`.
  - Conocimiento en el OpenRouter simulado (fase 4): los embeddings son una «bolsa de palabras» fija
    (`e2e/mocks/routes/bag-of-words.mjs`: sin tildes ni palabras vacías, cada palabra repartida en las 1536
    posiciones con sha256), así un texto se parece a otro en la medida en que comparten palabras. `POST /rerank`
    ordena por palabras compartidas. En el chat, si el prompt ya trae «# Conocimiento encontrado para este mensaje»
    («Buscar siempre») responde con él; si se le ofrece `buscar_conocimiento`, la llama con lo último que escribió el
    cliente y después responde con la frase del fragmento [1] que más palabras comparte y «(Fuente: título, pág.
    N)»; con `SIN_RESULTADOS` dice que no lo sabe y ofrece una persona. Un resumen de documento son sus dos primeras
    frases. Todas las respuestas empiezan igual que las demás («Soy … Me has escrito: «…»»). Como el modelo simulado
    siempre busca cuando tiene la herramienta, un agente con `buscar_conocimiento` hace dos llamadas por respuesta
    (los de la demo la tienen).
  - Citas en el OpenRouter simulado (fase 5, `e2e/mocks/routes/booking.mjs`): solo si al agente se le ofrecen
    `listar_servicios`, `consultar_disponibilidad` y `crear_cita` y el cliente escribe una fecha «AAAA-MM-DD» (o
    responde a una oferta del propio simulado). Entonces reserva como un cliente: lista los servicios, consulta los
    huecos de ese día y ofrece los sugeridos, cada uno con su «[inicio]» para que la prueba lo lea; «Me va bien la
    primera» (o la segunda, o una hora) llama a `crear_cita` con ese hueco y responde con la confirmación de la
    herramienta, o con el error y las alternativas. «Confirmo … el AAAA-MM-DD a las HH:MM …» reserva directamente.
    Los ayudantes de la agenda (fechas de prueba lejos de las citas de la demo, un agente con las herramientas de citas,
    «Probar», el calendario, la ficha, arrastrar, los recordatorios y los correos de `data/outbox`) están en
    `e2e/support/agenda.ts`. La cita del recordatorio se crea «hace diez días» para mañana antes de arrancar
    (`e2e/support/create-agenda-fixtures.ts`), porque una cita creada durante la prueba no tendría recordatorio sin
    esperar de verdad.
  - Documentos del conocimiento hechos en código, sin binarios en el repositorio: en Playwright,
    `e2e/support/knowledge-files.ts` (un PDF de texto de 120 páginas con un dato solo en la 112 y un Markdown con
    encabezados; las preguntas evitan las palabras clave de traspaso de la plantilla, como «novia»); en Vitest,
    `src/test/fixtures/knowledge/long-pdf.ts` (120 páginas, dato solo en la 87) y los ayudantes de
    `src/server/knowledge/test-helpers.ts` (OpenRouter falso con la misma bolsa de palabras, DOCX, XLSX, PDF y ZIP
    de prueba). Mistral OCR solo se prueba en Vitest, con su `fetch` falso.
  - Meta en Vitest (fase 3): `src/test/fixtures/whatsapp/` guarda los avisos reales de
    `docs/integracion-whatsapp-mensajes.md` §16 (texto, nota de voz, imagen, documento, estados enviado, entregado,
    leído y fallido 131047, contacto solo con BSUID, duplicado, avisos de cuenta y de plantillas, reacción y su
    retirada, ubicación, tipo no admitido y los dos cambios de identidad) con `signWebhook()` para firmarlos con el
    App Secret de prueba; `fake-meta.ts` es la Graph API falsa (`fakeMetaFetch`, `connectedNumberRoutes`,
    `metaError(código)` y las respuestas documentadas) y `memory-storage.ts`, un almacén de archivos en memoria. Las
    funciones de `src/data/whatsapp*.ts` reciben `{ fetchImpl, baseUrl: FAKE_META_BASE_URL }` como último argumento.
  - Meta simulado en Playwright (`e2e/mocks/routes/meta.mjs`, datos en `meta-data.json`): responde a todo lo que la
    app pide a la Graph API con cualquier versión (`/v26.0/…`): `debug_token` y `/{APP_ID}/subscriptions` solo con el
    token de app, el resto con `Bearer`; números, WABA, `subscribed_apps` (rechaza `override_callback_uri`, [WA-15]),
    registro, códigos de verificación, plantillas paginadas, envío (texto de hasta 4.096 caracteres y plantillas
    aprobadas con todas sus variables, si no 132000/132001), leídos y «escribiendo…», subida y descarga de archivos.
    Regla de números: cualquier id de 15 cifras que empieza por 2 es un número, su WABA es el mismo con un 1 delante
    y se muestra como +1 555-XXX-XXXX; está PENDING hasta registrarlo. `POST /meta/dashboard/apps/:appId/webhooks`
    hace de la persona que pulsa «Verificar y guardar» en el panel de Meta (Meta llama a la app con el token). Cada
    prueba conecta su propio número (`e2e/support/whatsapp-meta.ts` genera números, clientes, wamids y avisos firmados
    a partir de los mismos archivos de `src/test/fixtures/whatsapp/`) y deja su canal desactivado o desconectado al
    terminar. Las pantallas de WhatsApp se recorren con los ayudantes de `e2e/support/whatsapp.ts`.
  - El `request` de Playwright lleva la sesión del `storageState` del archivo: para comprobar que algo no se sirve
    sin sesión, la prueba crea un contexto sin cookies (`playwright.request.newContext({ storageState: { cookies: [],
    origins: [] } })`).
  - En e2e la app corre en `http://localhost`: sin dirección pública con HTTPS, el asistente no intenta suscribir la
    app de Meta sola y va por el camino manual ([WA-16]); ese intento automático solo se prueba en Vitest.
  - La demo de Playwright arranca sin clave de OpenRouter. Una prueba que necesita IA pide el fixture
    `openRouterKey` (`e2e/support/test.ts`): guarda la clave como el propietario desde Ajustes › IA y la quita al
    terminar, aunque la prueba falle, para que las demás sigan viendo la instalación sin IA.
  - Los servidores de correo (IMAP y SMTP) se simulan en Vitest sustituyendo su conexión
    (`src/server/channels/email/test-fakes/`).
  - Google y Microsoft simulados en Playwright (fase 6, `e2e/mocks/routes/google.mjs` y `microsoft.mjs`, con lo común en
    `google-microsoft-mail.mjs`): las pantallas de consentimiento (se puede desmarcar un permiso), los tokens con PKCE,
    la API de Gmail y Microsoft Graph de cada buzón, que las pruebas manejan como un guion: llega un correo, una persona
    responde desde su programa, se revoca el acceso… y después leen lo que hizo la app (borradores, envíos con sus
    cabeceras e hilo, etiquetas). Cada prueba usa sus propios clientes y direcciones (`e2e/support/email-mailboxes.ts`),
    así que nunca comparten buzones ni contactos. Los ayudantes de las pantallas de correo están en `e2e/support/email.ts`.
  - Herramientas HTTP en Playwright (fase 7, `e2e/mocks/routes/http-tools.mjs`): una pequeña API de tienda en el
    simulador y el paso del modelo simulado que llama a la herramienta que el cliente nombra. La app de las pruebas corre
    con `ALLOW_LOCAL_HTTP_TOOLS=true` (y `E2E_ALLOW_BASE_URL_OVERRIDES=true`, sin el cual la versión compilada no arranca
    con ella) para poder llamar al simulador por `http` en este ordenador ([HER-14]).
  - Avisos push y app instalable (fase 7): Playwright comprueba el manifiesto, el service worker y los iconos sin
    sesión, y la suscripción y los dispositivos de Mi cuenta con el permiso de notificaciones concedido al navegador; el
    envío con `web-push` se prueba en Vitest con su transporte falso, sin llamar a ningún servicio de push.
  - Las respuestas y los avisos simulados copian los reales de `docs/integracion-*.md` (por ejemplo, los
    avisos de WhatsApp de `docs/integracion-whatsapp-mensajes.md`), firmas incluidas.
- Cuando el proyecto esté en GitHub, se propone ejecutar las pruebas automáticamente en cada subida.
