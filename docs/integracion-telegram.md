# Integración con Telegram (opcional)

Canal opcional que se construye al final: un bot de Telegram del negocio atiende texto, notas de voz e
imágenes con el agente activo del canal. Comprobado el 26-09-2026 contra la Bot API 10.3, del 24-08-2026
(ver «Fuentes»).

## Peticiones a la Bot API

- Todas van por HTTPS a `https://api.telegram.org/bot<token>/<método>`, con `GET` o `POST` y cuerpo JSON
  (para subir archivos, `multipart/form-data`). La URL base es configurable con `TELEGRAM_API_BASE_URL`, que
  las pruebas apuntan al servidor simulado.
- La respuesta siempre trae `ok`. Si es `true`, el dato está en `result`; si es `false`, vienen
  `description`, `error_code` (Telegram avisa de que su contenido puede cambiar) y, a veces, `parameters`.
- **El token va dentro de la URL.** Esas URL nunca se registran en logs ni se guardan: quien tenga el token
  controla el bot. El token se guarda cifrado en `secrets_enc` y en pantalla solo se ve enmascarado.

## Conectar un bot

1. El negocio crea el bot con @BotFather y pega el token en el asistente del canal.
2. `getMe` (sin parámetros) comprueba el token y devuelve el bot: `id`, `is_bot`, `first_name` y
   `username`, que se muestran para confirmar.
3. `setWebhook` con:
   - `url`: `https://<dominio de producción>/api/webhooks/telegram/<id del canal>`. Tiene que ser HTTPS y
     solo se admiten los puertos 443, 80, 88 y 8443. Como con Meta, nunca la URL de una preview.
   - `secret_token`: un valor aleatorio propio de cada canal, de 1 a 256 caracteres `A-Z`, `a-z`, `0-9`,
     `_` y `-`. Se guarda cifrado.
   - `allowed_updates: ["message"]`. Se envía siempre: si se omite, Telegram mantiene la lista anterior, y la
     lista vacía equivale a recibir casi todo.
   - `drop_pending_updates`, opcional, para descartar lo acumulado al reconectar.
4. `getWebhookInfo` alimenta el semáforo del canal: `url`, `pending_update_count`, `last_error_date` y
   `last_error_message`.
5. Al desconectar: `deleteWebhook` y borrado del token.

Mientras haya un webhook activo, `getUpdates` no funciona: los dos modos de recibir son excluyentes.

## Recepción

- Telegram hace un `POST` con un objeto `Update` en JSON e incluye la cabecera
  `X-Telegram-Bot-Api-Secret-Token` con el `secret_token` del canal. Se compara en tiempo constante con el
  guardado; si no coincide, 401 y no se procesa nada.
- Se sigue el mismo orden que en el resto de canales: guardar en bruto, normalizar, contacto, insertar sin
  duplicados, encolar la respuesta y contestar 2xx enseguida. Si la respuesta no es 2xx, Telegram reintenta
  «un número razonable de veces» y luego desiste. Los updates pendientes se guardan como mucho 24 horas.
- Duplicados: `update_id` crece de uno en uno y sirve para ignorar repetidos, aunque tras una semana sin
  updates el siguiente puede ser aleatorio. El `external_id` del mensaje se forma con `chat.id` y
  `message_id`, que es único dentro de cada chat.
- Solo se atienden chats privados (`chat.type` igual a `private`); los grupos y canales se ignoran.

## Forma de los datos

- `Update`: `update_id` y como mucho uno de los campos opcionales; aquí solo interesa `message`.
- `Message`: `message_id`, `from` (el usuario), `chat` (`id`, `type`, `first_name`, `username`…), `date`
  (Unix, en segundos) y, según el tipo, `text`, `caption`, `photo`, `voice`, `audio`, `document`, `video`,
  `sticker`, `location` o `contact`. Lo que no sea texto, voz o foto se guarda como mensaje de sistema.
- Voz (`voice`): `file_id`, `file_unique_id`, `duration`, y opcionalmente `mime_type` (el que declara el
  remitente) y `file_size`. Va a transcripción como las notas de voz de WhatsApp.
- Foto (`photo`): una lista de `PhotoSize` (`file_id`, `width`, `height`, `file_size` opcional), una por
  tamaño disponible. Se descarga la más grande. El texto que la acompaña viene en `caption`.
- Identidad: `contact_identities` con `channel_type` `telegram` y `external_id` igual a `from.id`. Los
  identificadores de usuario y de chat pueden tener hasta 52 bits significativos: se guardan como texto. La
  conversación guarda `chat.id` para responder.

## Archivos

1. `getFile` con el `file_id` devuelve un `File` con `file_path`.
2. Se descarga de `https://api.telegram.org/file/bot<token>/<file_path>`. El enlace dura al menos una hora y
   el límite de descarga es de 20 MB.
3. Se descarga en el job y se guarda en `FileStorage` al momento. Esa URL lleva el token: nunca se guarda ni
   se muestra.

`getFile` puede no conservar el nombre ni el tipo MIME originales: se guardan los que vienen en el mensaje.
Los `file_id` son persistentes según la FAQ de bots.

## Envío

- `sendMessage` con `chat_id` y `text`, de 1 a 4.096 caracteres después de procesar el formato. La regla de
  una sola respuesta por turno obliga a limitar la longitud de la respuesta del agente en este canal. Sin
  `parse_mode`, para no tener que escapar caracteres.
- `sendChatAction` con `action: "typing"` muestra «escribiendo…» durante 5 segundos como mucho, o hasta que
  llega el mensaje.
- Límites de la FAQ de bots: no más de un mensaje por segundo en un mismo chat (se toleran ráfagas cortas,
  luego llegan errores 429) y unos 30 por segundo en total. Un 429 trae `parameters.retry_after`, los
  segundos que hay que esperar antes de reintentar.

## Fuentes

Consultadas el 26-09-2026.

- Telegram Bot API (versión 10.3, 24-08-2026): https://core.telegram.org/bots/api
  - Peticiones y respuestas: https://core.telegram.org/bots/api#making-requests
  - `Update` y `getUpdates`: https://core.telegram.org/bots/api#getting-updates
  - `setWebhook`: https://core.telegram.org/bots/api#setwebhook
  - `getWebhookInfo` y `WebhookInfo`: https://core.telegram.org/bots/api#getwebhookinfo
  - `getMe`: https://core.telegram.org/bots/api#getme
  - `Message`, `Chat`, `PhotoSize`, `Voice`: https://core.telegram.org/bots/api#message
  - `getFile` y `File`: https://core.telegram.org/bots/api#getfile
  - `sendMessage`: https://core.telegram.org/bots/api#sendmessage
  - `sendChatAction`: https://core.telegram.org/bots/api#sendchataction
  - `ResponseParameters`: https://core.telegram.org/bots/api#responseparameters
- Telegram, FAQ de bots (límites y `file_id`): https://core.telegram.org/bots/faq
