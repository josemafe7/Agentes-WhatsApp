# 0009 · Tiempo real por sondeo

- **Estado:** aceptada
- **Fecha:** 2026-09-26

## Contexto y problema

La bandeja, cada conversación, los contadores de no leídos y los avisos tienen que ponerse al día solos cuando
llega un mensaje, cambia un estado de entrega o hay un traspaso. El chat web también tiene que recibir la
respuesta sin recargar. El encargo (§2) pide sondeo cada 3–5 s ahora y Supabase Realtime en el futuro. Había
que decidir cómo, sabiendo que la app corre en local, en funciones de Vercel que se apagan y en un VPS.

Datos comprobados el 26-09-2026:

- Las funciones de Vercel tienen una duración máxima (en Hobby, 300 s): una conexión abierta mucho tiempo, como
  un flujo de eventos del servidor, se corta y hay que reconectar
  (https://vercel.com/docs/functions/limitations, actualizada el 24-08-2026).
- Vercel anunció el 22-06-2026 WebSockets en sus funciones, en beta pública y con los límites y precios de
  las funciones (https://vercel.com/changelog/websocket-support-is-now-in-public-beta). No se ha evaluado cómo
  repartir un mensaje entre varias instancias de funciones.
- Hobby incluye 1 millón de invocaciones al mes. Una pestaña que pregunta cada 4 s hace 900 peticiones por
  hora, y el cron cada minuto suma unas 43.200 al mes; si se supera el límite, la función queda parada 30 días
  (`docs/plataforma-despliegue.md`, «Consumo del plan Hobby»).
- Turso cuenta como leída cada fila que recorre una consulta, aunque no la devuelva: las consultas del sondeo
  deben ir por índice (`docs/plataforma-despliegue.md`, «Plan gratuito»).
- Varias instancias de un servidor sin estado no comparten memoria: un aviso guardado en memoria no llega a la
  instancia que atiende a otra pestaña. El cambio tiene que quedar en la base de datos.

## Opciones consideradas

- **WebSockets o flujo de eventos desde la propia app:** conexiones largas que en Vercel se cortan o están en
  beta, y que necesitan un canal común entre instancias.
- **Un servicio de tiempo real externo** (Supabase Realtime u otro): otra cuenta y otro servicio desde el
  primer día.
- **Sondeo cada pocos segundos detrás de una interfaz.**

## Decisión

Sondeo cada 3–5 s a `/api/realtime?cursor=…`, detrás de la interfaz `Realtime`:

- Cada cambio que la pantalla debe conocer (mensaje nuevo, estado de entrega, conversación asignada o
  traspasada, aviso) deja una fila de evento con un número de orden creciente. El cliente pide lo que hay
  después de su cursor.
- La ruta comprueba la sesión y devuelve solo lo que ese usuario puede ver (un agente, solo sus canales).
- El cliente deja de preguntar cuando la pestaña no está visible, pregunta menos cuando no hay actividad y
  vuelve al ritmo normal al recuperar el foco.
- El chat web sondea su propia API, con sus límites por IP, visitante y dominio.
- Los avisos push de la PWA (`docs/notificaciones-push.md`) cubren el caso de la app cerrada.
- En el futuro, una implementación con Supabase Realtime sustituye a esta sin tocar a quien usa la interfaz.

## Consecuencias

- Gana: funciona igual en local, en Vercel y en el VPS, sin conexiones largas ni servicios externos, y es fácil
  de probar.
- Acepta: unos segundos de retraso, suficientes para atención al cliente.
- Acepta: cuesta invocaciones y lecturas aunque no pase nada; por eso la pausa en segundo plano, la espera
  creciente y las consultas por índice. Los eventos viejos se borran con la limpieza diaria.
