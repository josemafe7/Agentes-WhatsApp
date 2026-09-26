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
  recomienda Next.js, la versión compilada de la app (`pnpm build` y `next start`) dos veces: la demo en el
  puerto 3100 con `data/e2e.db` (migraciones, demo y dos usuarios propios de las pruebas) y una instalación
  vacía en el 3102 con `data/e2e-fresh.db`, para el asistente de arranque. Las bases se preparan antes de
  compilar (`e2e/support/prepare-databases.mjs`, que solo borra archivos `data/e2e*.db`) y los secretos de
  prueba (también el código de instalación que la versión compilada pide en el asistente) se generan en cada
  ejecución: nunca toca `data/local.db` ni `.env.local`.
- Se entra siempre por el formulario, como una persona: el inicio de sesión de Better Auth no responde por HTTP
  (`src/server/auth.ts`). En Vitest, las pruebas usan `auth.api.*`, como las Server Actions.
- Las pruebas de Playwright van de una en una, porque comparten los archivos de base de datos.
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
    y devuelve tokens y coste que crecen con cada mensaje. Cada prueba puede forzar errores con `mock.stub`.
  - La demo de Playwright arranca sin clave de OpenRouter. Una prueba que necesita IA pide el fixture
    `openRouterKey` (`e2e/support/test.ts`): guarda la clave como el propietario desde Ajustes › IA y la quita al
    terminar, aunque la prueba falle, para que las demás sigan viendo la instalación sin IA.
  - Los servidores de correo (IMAP y SMTP) se simulan sustituyendo su conexión.
  - Las respuestas y los avisos simulados copian los reales de `docs/integracion-*.md` (por ejemplo, los
    avisos de WhatsApp de `docs/integracion-whatsapp-mensajes.md`), firmas incluidas.
- Cuando el proyecto esté en GitHub, se propone ejecutar las pruebas automáticamente en cada subida.
