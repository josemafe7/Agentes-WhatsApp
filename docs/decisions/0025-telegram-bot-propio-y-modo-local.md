# 0025 · Telegram: el bot del propio negocio por su token, y «modo local» sin dirección pública

- **Estado:** aceptada (encargo del propietario del 2026-10-09: terminar Telegram con una conexión fácil, «si es
  posible, incluso con QR»)
- **Fecha:** 2026-10-09

## Contexto y problema

Telegram estaba previsto desde el principio (`docs/spec.md`, [TG-01]–[TG-04]) y faltaba construirlo. El encargo
pedía que conectarlo fuera lo más fácil posible y preguntaba si se podía crear el bot escaneando un código QR, como
hacen otras herramientas. Había que decidir dos cosas: cómo se crea y se conecta el bot, y qué pasa en una
instalación sin dirección pública (en local), donde Telegram no puede avisar a la app.

Datos comprobados el 09-10-2026 (`docs/integracion-telegram.md`):

- Crear un bot «con un QR» existe desde la Bot API 9.6 (bots gestionados): un enlace
  `https://t.me/newbot/{bot_gestor}/…` abre en Telegram la pantalla de crear el bot, y solo el bot gestor puede
  pedir después su token. Hace falta, por tanto, un bot gestor ya creado y un servidor que tenga su token.
- Un bot recibe de una sola forma a la vez: o Telegram llama a una dirección HTTPS (`setWebhook`), o el programa
  pide los avisos (`getUpdates`). La segunda no necesita dirección pública.

## Opciones consideradas

- **Bots gestionados con un gestor por instalación:** el negocio tendría que crear antes a mano ese bot gestor,
  que es justo el paso que se quería ahorrar.
- **Bots gestionados con un único gestor de quien implanta:** un servicio central con el token de ese gestor, que
  podría leer y cambiar el token de los bots de todos los negocios. Rompe la instalación por negocio (0001) y
  obliga a mantener un servidor más.
- **El token de @BotFather, pegado en el asistente**, y todo lo demás automático.
- En local: **no recibir** (como WhatsApp, [WA-16]) o **pedir los avisos** con `getUpdates`.

## Decisión

- El negocio crea su bot con @BotFather y pega el token. El asistente lo pone fácil: un código QR y un enlace
  abren @BotFather, y al conectar la app comprueba el token, configura sola la dirección de avisos con un secreto
  propio del canal y enseña el enlace y el código QR del bot para probarlo y para dárselo a los clientes.
- Sin dirección pública con HTTPS, «modo local»: la app quita la dirección de avisos y pide ella los mensajes
  (`tg.poll`, un trabajo de la cola que se repite). En la ronda larga del lanzador de `pnpm dev` espera hasta
  10 segundos a que llegue algo; en las rondas cortas solo mira. Con dirección pública, «Revalidar» pasa a avisos.
- La descarga de archivos de los clientes, que ya hacía WhatsApp, pasa a un trabajo común
  (`src/server/channels/media-download.ts`) que usan los dos canales.

## Consecuencias

- Gana: Telegram funciona también en un portátil, sin túneles ni dominio, con unos segundos de espera; y no hay
  ningún servidor central ni nadie más con el token del bot.
- Acepta: crear el bot sigue siendo un paso a mano en Telegram (un minuto). Si algún día hay un servicio central
  de quien implanta, los bots gestionados se pueden añadir sin cambiar el canal.
- Acepta: en modo local un mensaje puede tardar unos segundos más en llegar que con avisos.
- Acepta: conectar un bot aquí lo quita de donde estuviera recibiendo; por eso el asistente pide confirmación
  cuando el bot ya tenía otra dirección ([TG-05]).
