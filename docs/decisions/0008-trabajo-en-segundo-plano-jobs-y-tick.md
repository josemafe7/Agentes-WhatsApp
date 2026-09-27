# 0008 · Trabajo en segundo plano: tabla `jobs` y `tick()`

- **Estado:** aceptada
- **Fecha:** 2026-09-26

## Contexto y problema

Mucho de lo que hace la app no puede ocurrir mientras se atiende una petición: responder con la IA (nunca
dentro de un webhook), agrupar varios mensajes seguidos en una sola respuesta, descargar medios, transcribir
audios, procesar documentos por pasos, leer los buzones de correo, revisar cada número de WhatsApp cada 6
horas, enviar recordatorios y avisos, y la limpieza diaria de datos caducados. Tiene que funcionar igual en
local, en Vercel (funciones que se apagan) y en un VPS, sin servicios aparte que obliguen a crear cuentas.

Datos comprobados el 26-09-2026:

- Meta reintenta durante 7 días cualquier webhook que no reciba un 200, así que llegan duplicados, y su
  objetivo de respuesta es una mediana de 250 ms o menos, con menos del 1 % por encima de 1 s
  (`docs/integracion-whatsapp-mensajes.md`, «Lo imprescindible»).
- `after()` ejecuta trabajo cuando ya se ha enviado la respuesta, pero dentro de la misma invocación y con el
  mismo tope de duración que la ruta; si se supera, se corta (`docs/plataforma-despliegue.md`, «Duración de las
  funciones y `after()`»; https://nextjs.org/docs/app/api-reference/functions/after).
- Vercel Cron en Hobby: como mucho una vez al día y con ±59 min de margen; una expresión más frecuente hace
  fallar el despliegue. En Pro, cada minuto. Vercel avisa de que un cron puede no llegar, llegar dos veces o
  solaparse con el anterior (`docs/plataforma-despliegue.md`, «Cron»).
- Cron externo cada minuto: cron-job.org es gratis, admite la cabecera `Authorization` y corta a los 30 s;
  GitHub Actions no baja de 5 minutos; el plan gratuito de QStash da 1.000 mensajes al día, menos de los 1.440
  que hacen falta (`docs/plataforma-despliegue.md`, «Cron externo cada minuto»; ver 0024: hoy lo lanza Supabase
  Cron).
- SQLite admite `UPDATE … RETURNING` desde la 3.35.0 (https://www.sqlite.org/lang_returning.html): un trabajo se
  reclama en una sola orden. En Postgres, `FOR UPDATE SKIP LOCKED` sirve para que varios consumidores lean una
  tabla tipo cola sin bloquearse (https://www.postgresql.org/docs/current/sql-select.html).
- En Turso, una transacción interactiva bloquea las escrituras con un tope de 5 s
  (`docs/plataforma-despliegue.md`, «Conexión y limitaciones»; ver 0024).
- En un VPS, `after()` funciona igual con el servidor de Node; para no perder trabajo al reiniciar, el
  contenedor se para con `SIGTERM` y unos 30 s de margen (`docs/plataforma-despliegue.md`).

## Opciones consideradas

- **Llamar a la IA dentro del webhook:** prohibido por el encargo y por el tiempo de respuesta que pide Meta.
- **Un servicio de colas externo** (por ejemplo, QStash o una cola con Redis): otra cuenta, otro coste y otro
  encargado de datos, y rompe el arranque sin configurar.
- **Una tabla `jobs` en la propia base de datos y una función `tick()` idempotente, lanzada de varias formas.**

## Decisión

- **Tabla `jobs`** (tipo, datos, `run_at`, `attempts`, `locked_until`, `status`, `last_error`) detrás de la
  interfaz `JobQueue`. Un trabajo se reclama de forma atómica con `UPDATE … RETURNING`, que fija `locked_until`;
  si la ronda que lo tenía muere, el trabajo vuelve a estar disponible al vencer el bloqueo.
- **`tick({ budgetMs })`** en `src/server/jobs/`: ejecuta los trabajos vencidos hasta agotar su presupuesto,
  calculado a partir del `maxDuration` de la ruta que lo lanza, menos lo ya gastado y un margen. Lo pendiente
  queda para la ronda siguiente. Cada manejador es idempotente: ejecutarlo dos veces no duplica nada.
- **Quién lo lanza:**
  1. `after()` en los webhooks y en la API del chat web, justo tras responder;
  2. `/api/cron/tick`, con `GET` (Vercel Cron) y `POST` (cron externo), protegido con
     `Authorization: Bearer ${CRON_SECRET}` comparado en tiempo constante; responde enseguida y trabaja en
     `after()`. En `vercel.json` solo va un cron diario; en Hobby, un cron externo cada minuto; en Pro,
     `* * * * *` (ver 0024: el de cada minuto es Supabase Cron, en los dos planes);
  3. en local, `pnpm dev` arranca un lanzador que llama a esa ruta cada unos 15 s, sin configurar nada;
  4. en el VPS, `pnpm worker` ejecuta `tick()` en bucle.
- **Agrupación de respuestas:** un solo trabajo `reply` por conversación, con `run_at` a 4–8 s, que se aplaza
  con cada mensaje nuevo hasta 20 s desde el primero, y un bloqueo por conversación.
- **Trabajo largo por pasos:** cada paso es un trabajo (por ejemplo: extraer, trocear, embeddings), para
  respetar el `maxDuration`. Los trabajos periódicos (correo, salud de WhatsApp, limpieza, recordatorios, caché
  de modelos) se vuelven a programar desde su propio manejador.
- **Fallos:** reintentos con esperas crecientes; tras varios intentos, el trabajo queda como fallido y se ve en
  Diagnóstico.

## Consecuencias

- Gana: ninguna pieza más que instalar o pagar; el mismo código en local, Vercel y el VPS; rondas duplicadas o
  solapadas no hacen daño.
- Acepta: la rapidez depende de quién lance `tick()`. En local, unos 15 s como mucho; en Hobby sin tráfico,
  hasta un minuto (el cron externo; ver 0024: hoy, Supabase Cron).
- Pendiente de la fase 2: como la respuesta se programa a 4–8 s, el `tick()` que lanza `after()` al recibir un
  mensaje tiene que poder esperar, dentro de su presupuesto, a que venza esa respuesta; si no, saldría con la
  siguiente ronda del cron. Se resuelve y se prueba al construir el motor.
- Acepta: consultar la tabla cuesta lecturas (Turso cuenta cada fila recorrida; ver 0024): las consultas de la cola van
  por índice.
- Acepta: SQLite tiene un solo escritor (ver 0024: en Postgres se conserva con un candado); los pasos son cortos y no
  llaman a servicios externos dentro de una transacción.
- Acepta: el secreto del cron queda guardado en un servicio de terceros (ver 0024: hoy, en el trabajo de Supabase
  Cron). Solo permite lanzar `tick()`, que es idempotente; se usa uno largo y aleatorio y se cambia si se filtra.
- Con Postgres, la implementación de `JobQueue` usará `FOR UPDATE SKIP LOCKED` sin cambiar a quien la usa (hecho en
  la fase 8, `PgJobQueue`, ver 0024).
