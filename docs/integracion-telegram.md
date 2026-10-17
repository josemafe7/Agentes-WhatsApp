# Integración con Telegram

Un bot de Telegram del negocio atiende texto, notas de voz e imágenes con el agente activo del canal. Comprobado
el 09-10-2026 contra la Bot API 10.3, del 24-08-2026 (ver «Fuentes»). Las reglas del producto están en
`docs/spec.md` («Telegram», [TG-01]–[TG-11]) y el código, en `src/lib/telegram/` (el cliente) y
`src/server/channels/telegram/` (el canal).

## Peticiones a la Bot API

- Todas van por HTTPS a `https://api.telegram.org/bot<token>/<método>`, con `GET` o `POST` y cuerpo JSON
  (para subir archivos, `multipart/form-data`). La URL base es configurable con `TELEGRAM_API_BASE_URL`, que
  las pruebas apuntan al servidor simulado.
- La respuesta siempre trae `ok`. Si es `true`, el dato está en `result`; si es `false`, vienen
  `description`, `error_code` (Telegram avisa de que su contenido puede cambiar) y, a veces, `parameters`.
- **El token va dentro de la URL.** Esas URL nunca se registran en logs ni se guardan: quien tenga el token
  controla el bot. El token se guarda cifrado en `secrets_enc` y en pantalla solo se ve enmascarado.
- El token solo está documentado con un ejemplo (`123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`): números, dos
  puntos y letras. La app solo comprueba esa forma para que nada más llegue a la ruta de una URL; quien dice si
  es válido es `getMe`. El identificador del bot se toma de `getMe`, nunca del principio del token.

## Crear el bot

1. El negocio habla con @BotFather (`https://t.me/BotFather`; el asistente lo abre con un enlace y un código
   QR), escribe `/newbot` y le da un nombre (de 1 a 64 caracteres) y un usuario: de 5 a 32 caracteres, letras
   latinas, números y guiones bajos, terminado en `bot`, y que no se puede cambiar después.
2. @BotFather devuelve el token, que se pega en el asistente del canal.

### Por qué no se crea el bot escaneando un QR («bots gestionados»)

Desde la Bot API 9.6 (03-04-2026) un bot «gestor» puede pedir a una persona que cree otro bot con un enlace
`https://t.me/newbot/{bot_gestor}/{usuario_sugerido}?name={nombre}` (o un botón): la persona lo confirma en
Telegram y solo el gestor puede pedir el token del bot nuevo (`getManagedBotToken`). Es lo que usan las
herramientas en la nube que crean el bot «con un QR». Aquí no se usa, y la decisión está en
`docs/decisions/0025-telegram-bot-propio-y-modo-local.md`:

- hace falta un bot gestor ya creado en @BotFather, con el «Bot Management Mode» activado, y un servidor que
  tenga su token y reciba el aviso `managed_bot`: en una instalación por negocio habría que crear antes ese bot
  a mano, que es justo el paso que se quería ahorrar;
- un único gestor de quien implanta la app obligaría a montar un servicio central con el control de los tokens
  de todos los negocios, que es lo contrario de una instalación por negocio (decisión 0001).

Si algún día existe ese servicio central, los datos comprobados son estos: `User.can_manage_bots` (solo en
`getMe`), el aviso `managed_bot` (`ManagedBotUpdated`: `user` y `bot`), `getManagedBotToken(user_id)` y
`replaceManagedBotToken(user_id)`; el bot es de la persona que lo crea y cuenta para su límite de bots.

## Conectar un bot

1. `getMe` (sin parámetros) comprueba el token y devuelve el bot: `id`, `is_bot`, `first_name` y `username`,
   que se muestran para confirmar. Un bot solo se conecta una vez en la instalación ([TG-05]).
2. `getWebhookInfo` dice si el bot ya envía sus avisos a otra dirección. Un bot tiene una sola forma de recibir:
   conectarlo aquí lo quita de donde estuviera, así que el asistente lo avisa y pide confirmación ([TG-05]).
   De esa otra dirección solo se enseña el dominio: el resto puede llevar un secreto.
3. Con dirección pública, `setWebhook` con:
   - `url`: `https://<dominio de producción>/api/webhooks/telegram/<id del canal>`. Tiene que ser HTTPS y
     solo se admiten los puertos 443, 80, 88 y 8443. Como con Meta, nunca la URL de una preview.
   - `secret_token`: un valor aleatorio propio de cada canal, de 1 a 256 caracteres `A-Z`, `a-z`, `0-9`,
     `_` y `-`. Se guarda cifrado.
   - `allowed_updates: ["message"]`. Se envía siempre: si se omite, Telegram mantiene la lista anterior, y la
     lista vacía equivale a recibir casi todo.
   - `drop_pending_updates`, opcional, para descartar lo acumulado al reconectar (la app no lo usa).
4. Sin dirección pública con HTTPS (en local), «modo local» ([TG-06]): `deleteWebhook` y la app pide los avisos
   con `getUpdates` (ver «Recepción»).
5. `getWebhookInfo` alimenta el semáforo «Recepción» del canal: `url`, `pending_update_count`,
   `last_error_date` y `last_error_message` (este último es un texto de Telegram, en inglés: se muestra como
   dato detrás de la explicación en español).
6. Al desconectar: `deleteWebhook` y borrado del token ([TG-04]).

Mientras haya un webhook activo, `getUpdates` no funciona: los dos modos de recibir son excluyentes.

## Recepción

- **Por avisos.** Telegram hace un `POST` con un objeto `Update` en JSON e incluye la cabecera
  `X-Telegram-Bot-Api-Secret-Token` con el `secret_token` del canal. Se compara en tiempo constante con el
  guardado antes de leer el cuerpo; si no coincide, o la dirección no es la de un bot conectado, 401 y no se
  procesa nada ([TG-02]). Telegram llama desde las redes `149.154.160.0/20` y `91.108.4.0/22`, solo por IPv4 y
  con TLS 1.2 o superior.
- **En modo local.** `getUpdates` con `offset` (el `update_id` siguiente al último guardado), `limit` (de 1 a
  100) y `timeout` (segundos de espera si no hay nada: 0 en una ronda corta y 10 en la ronda larga del
  lanzador local). Un aviso queda confirmado cuando se pide con un `offset` mayor que su `update_id`, así que
  el `offset` solo avanza después de guardar; si la consulta se corta, los avisos vuelven a llegar y los
  mensajes repetidos se ignoran. Cada bot se consulta de uno en uno (`tg.poll`).
- En los dos casos se sigue el mismo orden que en el resto de canales: guardar en bruto, normalizar, contacto,
  insertar sin duplicados, encolar la respuesta y, por avisos, contestar 2xx enseguida. Si la respuesta no es
  2xx, Telegram reintenta «un número razonable de veces» y luego desiste. Los avisos pendientes se guardan
  como mucho 24 horas.
- Duplicados: `update_id` crece de uno en uno, aunque tras una semana sin avisos el siguiente puede ser
  aleatorio. El `external_id` del mensaje se forma con `chat.id` y `message_id`, que es único dentro de cada
  chat, y con él se ignoran los repetidos.
- Solo se atienden chats privados (`chat.type` igual a `private`) y mensajes de personas: los grupos, los
  canales y los demás bots (`from.is_bot`) se ignoran y ni siquiera se guardan.
- `/start` es lo que Telegram envía solo cuando alguien abre el chat con el bot por primera vez (y
  `/start <dato>` si entró por un enlace `https://t.me/<bot>?start=<dato>`, de hasta 64 caracteres `A-Z`, `a-z`,
  `0-9`, `_` y `-`). Se guarda como mensaje del cliente y el agente sabe que es un saludo ([TG-10]).
- Un bot no puede empezar una conversación: la persona tiene que escribirle antes. Por eso el panel da el
  enlace `https://t.me/<usuario>` y su código QR ([TG-07]).

## Forma de los datos

- `Update`: `update_id` y como mucho uno de los campos opcionales; aquí interesan `message`, `callback_query` y
  `my_chat_member` (ver «Botones del recordatorio y bloqueo del bot»).
- `Message`: `message_id`, `from` (el usuario), `chat` (`id`, `type`, `first_name`, `username`…), `date`
  (Unix, en segundos) y, según el tipo, `text`, `caption`, `photo`, `voice`, `audio`, `document`, `video`,
  `sticker`, `location` o `contact`. Lo que no sea texto, voz o foto se guarda como mensaje de sistema «Tipo de
  mensaje no admitido», que la IA no contesta ([TG-03]).
- Voz (`voice`): `file_id`, `file_unique_id`, `duration`, y opcionalmente `mime_type` (el que declara el
  remitente) y `file_size`. Va a transcripción como las notas de voz de WhatsApp.
- Foto (`photo`): una lista de `PhotoSize` (`file_id`, `width`, `height`, `file_size` opcional), una por
  tamaño disponible. Se descarga la más grande. El texto que la acompaña viene en `caption`.
- Identidad: `contact_identities` con `channel_type` `telegram` y `external_id` igual a `from.id`. Los
  identificadores de usuario y de chat pueden tener hasta 52 bits significativos: se guardan como texto. Cada
  mensaje guarda `chat.id` (en `metadata.telegramChatId`) para responder en ese chat; el nombre de usuario
  (`metadata.telegramUsername`) solo se muestra, nunca identifica a nadie.

## Archivos

1. `getFile` con el `file_id` devuelve un `File` con `file_path`.
2. Se descarga de `https://api.telegram.org/file/bot<token>/<file_path>`. El enlace dura al menos una hora y
   el límite de descarga es de 20 MB.
3. Se descarga en el job `tg.media_download` y se guarda en `FileStorage` al momento ([TG-11]). Esa URL lleva
   el token: nunca se guarda ni se muestra.

`getFile` puede no conservar el nombre ni el tipo MIME originales: el tipo guardado es el que muestran los
primeros bytes del archivo (una imagen o un audio) y, si no se reconoce, el que venía en el mensaje. Los
`file_id` son persistentes según la FAQ de bots.

## Envío

- `sendMessage` con `chat_id` y `text`, de 1 a 4.096 caracteres después de procesar el formato. Como la IA
  envía una sola respuesta por turno, un texto más largo se recorta y termina en «…» ([TG-09]). Sin
  `parse_mode`, para no tener que escapar caracteres.
- `sendPhoto` con `chat_id`, la imagen en `photo` (por `multipart/form-data`, hasta 10 MB) y `caption` (de 0 a
  1.024 caracteres): es como sale la imagen que adjunta una persona desde la bandeja.
- `sendChatAction` con `action: "typing"` muestra «escribiendo…» durante 5 segundos como mucho, o hasta que
  llega el mensaje.
- Telegram no avisa a los bots de la entrega ni de la lectura: un mensaje enviado se queda en «enviado».
- Límites de la FAQ de bots: no más de un mensaje por segundo en un mismo chat (se toleran ráfagas cortas,
  luego llegan errores 429) y unos 30 por segundo en total. Un 429 trae `parameters.retry_after`, los
  segundos que hay que esperar antes de reintentar: la app espera eso y reintenta, sin pasar de 10 segundos en
  total.

## Botones del recordatorio y bloqueo del bot

Para los recordatorios con «Confirmo» y «Necesito cambiarla» ([TG-13], [AGD-32]) y para saber si el cliente ha
bloqueado el bot ([TG-12]). Comprobado en la Bot API 10.3 el 2026-10-16.

- **Qué avisos se piden.** `allowed_updates` es `["message", "callback_query", "my_chat_member"]`, en `setWebhook` y
  en cada `getUpdates`. Si no se manda, Telegram sigue con la lista anterior, así que un bot conectado antes con
  `["message"]` no recibiría ni los toques ni los bloqueos: la app vuelve a llamar a `setWebhook` con la lista nueva
  cuando `getWebhookInfo.allowed_updates` no coincide (en la revisión de cada 6 horas y al revalidar).
- **Enviar con botones.** `sendMessage` con `reply_markup: {inline_keyboard: [[{text, callback_data}, …]]}`.
  `callback_data` tiene de 1 a 64 bytes: la app manda un código corto con el recordatorio y la acción, nunca datos
  del cliente.
- **El toque.** Llega un `Update` con `callback_query`: `id`, `from` (quien pulsó), `message` (el mensaje con el
  botón; si ya no existe llega `date: 0`) y `data`. `data` viene del cliente: la app comprueba que el recordatorio
  existe, que es de ese bot y que la cita es del contacto que pulsa ([HER-04]). El `external_id` del toque es
  `cb:<id>`, para ignorar repetidos.
- **Responder al toque.** Hay que llamar siempre a `answerCallbackQuery` con `callback_query_id` (y un `text` de 0 a
  200 caracteres, opcional): si no, el cliente ve una barra de carga. La app lo hace desde la cola, enseguida; si
  Telegram contesta 400 porque la consulta es demasiado antigua, no es un error grave.
- **Bloqueo.** En un chat privado, `my_chat_member` solo llega cuando el cliente bloquea o desbloquea el bot:
  `new_chat_member.status` pasa a `"kicked"` al bloquearlo y vuelve a `"member"` al desbloquearlo (la página de la
  API no lo dice con esas palabras; lo confirma el código oficial de TDLib y del servidor de la Bot API). La app trata
  `kicked` o `left` como bloqueado y `member` como desbloqueado. Un 403 al enviar también lo marca como bloqueado.

No comprobado: el plazo para contestar a `answerCallbackQuery` (la app contesta enseguida desde la cola) y la
longitud máxima del texto de un botón (los de la app son cortos).

## Errores

La app decide solo por `error_code`; `description` (en inglés, y que Telegram puede cambiar) nunca se muestra ni
se compara. Los textos de esta tabla no están en la documentación: son los que da el servidor oficial de la
Bot API (su código es público).

| Código | Cuándo | Qué hace la app |
|---|---|---|
| 401 | Token revocado o incorrecto (`Unauthorized`) | «El token del bot no es válido o se ha revocado»; el canal pasa a «error» |
| 404 | El token ni siquiera tiene la forma correcta (`Not Found`) | Lo mismo que 401 |
| 403 | El cliente bloqueó el bot o no lo ha iniciado (`Forbidden: bot was blocked by the user`) | El mensaje queda como fallido, sin reintentos |
| 409 | `getUpdates` con un webhook activo, o dos programas pidiendo avisos a la vez (`Conflict`) | El canal pasa a «error»: «El bot ya está recibiendo mensajes por otra vía» |
| 429 | Demasiado rápido; trae `retry_after` | Espera y reintenta |
| 400 | Petición no válida (por ejemplo, una dirección de avisos en un puerto no admitido) | Fallo definitivo, con su explicación |
| 5xx | Fallo de Telegram | Reintento |

## Fuentes

Consultadas el 09-10-2026.

- Telegram Bot API (versión 10.3, 24-08-2026): https://core.telegram.org/bots/api
  - Peticiones y respuestas: https://core.telegram.org/bots/api#making-requests
  - `Update` y `getUpdates`: https://core.telegram.org/bots/api#getting-updates
  - `setWebhook`: https://core.telegram.org/bots/api#setwebhook
  - `getWebhookInfo` y `WebhookInfo`: https://core.telegram.org/bots/api#getwebhookinfo
  - `getMe`: https://core.telegram.org/bots/api#getme
  - `Message`, `Chat`, `PhotoSize`, `Voice`: https://core.telegram.org/bots/api#message
  - `getFile` y `File`: https://core.telegram.org/bots/api#getfile
  - `sendMessage`: https://core.telegram.org/bots/api#sendmessage
  - `sendPhoto` y envío de archivos: https://core.telegram.org/bots/api#sendphoto y
    https://core.telegram.org/bots/api#sending-files
  - `sendChatAction`: https://core.telegram.org/bots/api#sendchataction
  - `ResponseParameters`: https://core.telegram.org/bots/api#responseparameters
  - Bots gestionados: https://core.telegram.org/bots/api#getmanagedbottoken y
    https://core.telegram.org/bots/features#managed-bots
- Registro de cambios de la Bot API (9.6, 03-04-2026): https://core.telegram.org/bots/api-changelog
- Guía de webhooks (redes de origen, TLS): https://core.telegram.org/bots/webhooks
- Crear un bot y enlaces: https://core.telegram.org/bots/features#creating-a-new-bot y
  https://core.telegram.org/bots/features#deep-linking
- Telegram, FAQ de bots (límites y `file_id`): https://core.telegram.org/bots/faq
- Servidor oficial de la Bot API (textos de los errores): https://github.com/tdlib/telegram-bot-api
