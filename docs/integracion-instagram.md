# Integración con Instagram (mensajes directos)

Referencia técnica para atender los mensajes directos (DM) de una cuenta profesional de Instagram del negocio con la
**API de Instagram con inicio de sesión de Instagram** («Instagram API with Instagram Login»): la app de Meta es del
propio negocio, no hace falta página de Facebook y las llamadas van a `graph.instagram.com` (fase 16, decisión 0029).
Lo que hace la app con cada dato está en `docs/spec.md` ([IG-01]–[IG-13]); aquí, lo que dice Meta.

Todo se comprobó el **16-10-2026** en la documentación oficial de Meta (lista de fuentes `[Fn]` al final). Las
páginas se leyeron en su versión de texto (la misma URL terminada en `.md`). Lo que no se pudo confirmar va
marcado como **NO VERIFICADO**. Lo marcado como **decisión de diseño** es una recomendación nuestra, no un dato
de Meta. Los JSON de ejemplo tienen la forma oficial y datos inventados.

| Dato | Valor de ejemplo |
|---|---|
| ID de la cuenta profesional del negocio (`user_id` de `/me`, `entry[].id` del webhook) | `17840000000000001` |
| ID con ámbito de la app (`id` de `/me`) | `9000000000000002` |
| IGSID del cliente (`sender.id`) | `1100000000000003` |
| Identificador de mensaje (`mid`) | `aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQw` |

## Lo imprescindible

1. **Vía elegida**: Instagram API con inicio de sesión de Instagram. Sirve a cuentas profesionales (empresa o
   creador) **sin página de Facebook**; todas las llamadas van a `graph.instagram.com` [F1][F2].
2. **Token**: el que da el panel de la app (**Instagram > API setup with Instagram login > Generate token**) es
   un token de usuario de Instagram **de larga duración, válido 60 días** [F5]. Se renueva con
   `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=…` si tiene
   **al menos 24 horas**, **no ha caducado** y tiene `instagram_business_basic`. Un token sin renovar en 60 días
   caduca y ya no se puede renovar [F6][F7].
3. **Permisos**: `instagram_business_basic` e `instagram_business_manage_messages` [F14].
4. **Acceso estándar sin App Review** para una app que solo sirve a la cuenta del propio negocio [F1][F19]. **Pero**
   la página de webhooks pide «Advanced Access» y verificación de la empresa para recibir webhooks con este tipo
   de inicio de sesión [F11]. Las dos cosas se contradicen: es el **riesgo principal** (ver §1.3).
5. **La app tiene que estar publicada (Live)** para que Meta envíe webhooks [F11].
6. **Webhook**: `GET` de verificación con `hub.mode`, `hub.challenge` y `hub.verify_token`; `POST` con
   `X-Hub-Signature-256: sha256=<hex>` (HMAC-SHA256 del cuerpo). `object` vale `"instagram"` y los mensajes
   llegan en `entry[].messaging[]` [F11][F12]. Qué secreto firma (el de la app de Meta o el «Instagram app
   secret») **NO VERIFICADO**: se prueban los dos (§4.3).
7. **Suscribir la cuenta**: `POST https://graph.instagram.com/v26.0/me/subscribed_apps?subscribed_fields=messages,…`
   con el token de la cuenta. Responde `{"success": true}` [F11].
8. **Enviar**: `POST https://graph.instagram.com/v26.0/me/messages` (o `/<IG_ID>/messages`) con
   `Authorization: Bearer <token>` y `{"recipient":{"id":"<IGSID>"},"message":{"text":"…"}}`. Texto en UTF-8 de
   **1.000 bytes como máximo**. Respuesta: `recipient_id` y `message_id` [F14].
9. **Ventana de 24 h** desde el mensaje del cliente. El negocio **no puede empezar** una conversación. Fuera de la
   ventana, solo con la etiqueta de agente humano (7 días), que **exige App Review y verificación de la empresa**
   [F1][F14][F38].
10. **Ecos**: lo que envía la cuenta del negocio llega como `messages` con `is_echo: true` [F12][F31]. Sirve para
    ver en la app lo que se contesta desde Instagram y pausar la IA (§8).
11. **Errores clave** (lista de la Plataforma de Messenger, que incluye Instagram): `10`/`2534022` fuera de la
    ventana; `551` y `551`/`1545041` persona no disponible; `200`/`2534041` el titular desactivó el acceso a los
    mensajes; `613`/`2534040` límite de llamadas [F23].
12. **Versión**: la última de Graph API es **v26.0** (29-07-2026). Los ejemplos de Instagram usan `v25.0`. Se
    guarda por canal, como en WhatsApp [F26][F44].

---

## 1. Requisitos

### 1.1 Cuenta, app y producto

- **Cuenta**: profesional de Instagram, de **empresa o de creador** [F1][F2]. `/me` devuelve `account_type`
  `Business` o `Media_Creator` [F5].
- **Sin página de Facebook**: «This API setup does not require a Facebook Page» [F2].
- **App de Meta de tipo «Business»**. Para añadir Instagram: caso de uso **Other** → tipo **Business** → producto
  **Instagram** > **Set up**; «API setup with Instagram login» se añade solo [F3]. Si la app ya existe y no es de
  tipo Business, hay que crear otra [F5]. El panel nuevo por casos de uso lo llama **«Manage messaging and content
  on Instagram»** > **API setup with Instagram Login** [F4]. Una app solo puede tener una de las dos
  configuraciones (Instagram Login o Facebook Login) [F4][F19].
- **ID y secreto propios de Instagram**: el panel muestra un **Instagram app ID** y un **Instagram app secret**
  distintos del ID y el secreto de la app de Meta, en **Instagram > API setup with Instagram login > 3. Set up
  Instagram business login > Business login settings** [F1][F6].
- **Límite de apps**: una persona puede ser desarrolladora o administradora de 15 apps como mucho si no están
  conectadas a un portfolio verificado [F3].

### 1.2 Permisos

| Permiso | Para qué |
|---|---|
| `instagram_business_basic` | Básico: `/me`, renovar el token, perfil [F7][F10] |
| `instagram_business_manage_messages` | Recibir y enviar mensajes, perfil del cliente, conversaciones [F14][F15][F17] |

- En el caso de uso, los dos se añaden por defecto con **«Add all required permissions»** [F4].
- Los nombres antiguos (`business_basic`, `business_manage_messages`…) dejaron de valer el **27-01-2025** [F2][F6].
- **Human Agent** es una «feature» aparte, no un permiso; se añade sola al pedir `instagram_business_manage_messages`
  en la revisión [F3] (§6.2).

### 1.3 Acceso estándar, avanzado y App Review

Lo que dice Meta, página por página:

| Fuente | Qué dice |
|---|---|
| Visión general [F1] | Acceso estándar: «If your app only serves your Instagram professional account or an account you manage, Standard Access is all your app needs». El avanzado exige App Review y verificación de la empresa. |
| App Review [F19] | «My app is only for a business I own or manage» + Instagram Login → **Standard Access**, App Review **Not required**. |
| Enviar mensajes [F14] | Estándar si sirves cuentas tuyas o añadidas en el panel; «Some features may not work properly until your app has been granted Advanced Access». |
| Webhooks [F11] | Tabla de requisitos: para Business Login for Instagram, **Access level: Advanced Access** y **Business Verification: Required**. En «Limitations» solo dice que el avanzado hace falta para `comments` y `live_comments`. |
| Niveles de acceso [F39] | Con acceso estándar, los permisos y funciones solo están activos para **usuarios con rol en la app**. |
| Mensajería con página (otra vía) [F29][F32] | «Apps with Standard Access can only send messages to people that have a role on the app». |

**Conclusión**: para la cuenta del propio negocio, la documentación de esta API dice que basta el acceso
estándar y que no hace falta App Review. **NO VERIFICADO**: que con acceso estándar lleguen los webhooks de los
mensajes de **clientes reales sin rol en la app** (la tabla de webhooks y la vía con página apuntan a que no).
**Decisión de diseño**: probarlo lo primero, con una cuenta de Instagram ajena a la app, antes de construir nada
más. Plan B si no llegan: pedir App Review como «app para tu propio negocio» [F37], que exige verificar la empresa
[F39][F43].

### 1.4 App publicada (Live) y verificación de la empresa

- «Your app must be set to **Live** in the App Dashboard for Meta to send webhook notifications» [F11]. En las apps
  por casos de uso: **Publish > Go live** [F42]. «Some functionality, such as webhooks, require your app to be
  published» [F4].
- Si la app solo la usan personas con rol, **no hace falta** verificar la empresa [F42][F43]. Pero la guía de
  creación dice que hay que conectar un negocio verificado **antes de publicar** [F3], y la tabla de webhooks pide
  verificación [F11]. **NO VERIFICADO** si el panel deja publicar sin verificación esta app.
- Las apps de tipo Business no tienen modo desarrollo/Live y dependen solo de los niveles de acceso [F42]; aun así,
  la página de webhooks de Instagram exige «Live» [F11]. Para el diagnóstico: «App publicada» es un punto a comprobar.

### 1.5 «Permitir acceso a los mensajes» en Instagram

- La guía de la **otra vía** (Messenger API para Instagram, con página) obliga a activar en la app de Instagram:
  **Configuración > Mensajes y respuestas a historias > Controles de mensajes > Herramientas conectadas > Permitir
  acceso a los mensajes** («Allow Access to Messages») [F30].
- El error `200`/`2534041` dice «The account owner has disabled access to instagram direct messages» [F23].
- La documentación de Instagram Login **no menciona** este ajuste. **NO VERIFICADO** que haga falta en esta vía, y
  la ruta exacta del menú puede haber cambiado en la app. **Decisión de diseño**: pedirlo en la guía del negocio
  y, si llega `2534041`, mostrar «Activa "Permitir acceso a los mensajes" en Instagram».

---

## 2. Token de acceso

### 2.1 Cómo se consigue (sin flujo de inicio de sesión)

- Si la app solo sirve a la cuenta propia, **no hace falta** programar el inicio de sesión: basta configurar el
  inicio de sesión de empresa en el panel y obtener tokens de larga duración [F1].
- Pasos en el panel [F5][F4][F3]:
  1. **Instagram > API setup with Instagram login** (en el panel por casos de uso, **Generate access tokens >
     Add account**).
  2. **Add account** / **Generate token** junto a la cuenta, iniciar sesión en Instagram y copiar el token.
  3. La cuenta que se añade **tiene que ser pública** [F3]. Se gestiona también en **App Roles > Roles** [F3].
- «Access tokens from the App Dashboard are long-lived and are valid for **60 days**» [F5]. Los del flujo de inicio
  de sesión duran 1 hora y se cambian por uno de 60 días [F5][F6][F8].
- Tipo: **Instagram User access token**, propio de la app y del usuario (OAuth 2.0) [F1].
- Formato: cadena opaca. **Decisión de diseño**: guardarlo cifrado, sin tamaño máximo, como el de WhatsApp.

### 2.2 Renovación

`GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<token>` [F6][F7]

| Condición (las tres) | Fuente |
|---|---|
| El token tiene **al menos 24 horas** | [F6][F7] |
| El token **no ha caducado** | [F6][F7] |
| La persona concedió `instagram_business_basic` | [F6][F7] |

Respuesta:

```json
{ "access_token": "IGAA…", "token_type": "bearer", "expires_in": 5183944 }
```

- `expires_in` son **segundos** hasta que caduca; el token renovado vale **60 días desde la renovación** [F7].
- «Tokens that have not been refreshed in 60 days will expire and can no longer be refreshed» [F6]: entonces hay
  que generar otro en el panel.
- El ejemplo oficial va **sin versión** en la ruta [F6][F7].
- No hace falta el secreto para renovar (sí para cambiar un token de 1 hora por uno de 60 días:
  `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=<Instagram app secret>&access_token=…`
  [F8]).
- **Decisión de diseño** (la que sigue la app): guardar `expires_at` = ahora + `expires_in` tras cada renovación. Del
  token pegado a mano no se sabe cuándo se creó: se suponen 60 días desde que se pega y se renueva en la primera
  revisión pasadas 24 h, para tener una fecha fiable; después, cada semana. Si Instagram la rechaza por el propio token
  (`190`, o un permiso que falta: `10`, `200`), el canal pasa a «error» al momento y avisa, con «Instagram no ha
  renovado el token» y cómo generar otro; cualquier otro fallo (la conexión, un código desconocido) se reintenta en la
  siguiente revisión y solo pasa a «error» si al token le quedan menos de 7 días.
- **NO VERIFICADO**: si `refresh_access_token` devuelve un token nuevo o el mismo (se guarda siempre el que
  llegue); el formato de error de una renovación fallida; y si existe un `debug_token` para tokens de Instagram.

### 2.3 Leer la cuenta: `GET /me`

`GET https://graph.instagram.com/v26.0/me?fields=user_id,username,name,account_type,profile_picture_url&access_token=…` [F5][F9]

| Campo | Qué es [F5] |
|---|---|
| `id` | ID **con ámbito de la app** (app-scoped) del usuario |
| `user_id` | **ID de la cuenta profesional (`<IG_ID>`)**. «This ID is value of the `id` field received in webhook notifications for this account» |
| `username` | Nombre de usuario de Instagram |
| `name` | Nombre |
| `account_type` | `Business` o `Media_Creator` |
| `profile_picture_url` | URL de la foto de perfil |
| `followers_count`, `follows_count`, `media_count` | Contadores |

- **La clave del canal es `user_id`**, no `id`: es lo que llega en `entry[].id` y en `recipient.id` [F5][F12].
- El ejemplo de la guía envuelve la respuesta en `"data": [ … ]` [F5]; la referencia de `/me` dice que equivale a
  `GET /{user-id}` [F9]. **Decisión de diseño**: aceptar las dos formas (objeto plano o `data[0]`).

---

## 3. Versión y forma de las llamadas

- Graph API: **v26.0** publicada el 29-07-2026, sin fecha de fin; **v25.0** (18-02-2026) vale hasta el 29-07-2028
  [F44]. La Plataforma de Messenger «follows Graph API Versioning. The latest version is: v26.0» [F26].
- Los ejemplos de Instagram usan `https://graph.instagram.com/v25.0/…` [F5][F11][F14]. La referencia del IG User
  enlaza la guía de versiones de Graph API [F10]. **NO VERIFICADO** expresamente que `graph.instagram.com` acepte
  ya `v26.0` (se deduce). **Decisión de diseño**: la app usa `v25.0`, la de los ejemplos de Instagram, que vale hasta
  el 29-07-2028, y la URL base es configurable (`INSTAGRAM_GRAPH_BASE_URL`, por defecto `https://graph.instagram.com`)
  para el simulado de las pruebas.
- Autenticación: la guía de mensajes usa `Authorization: Bearer <token>` [F14]; otras páginas pasan
  `access_token` en la URL [F5][F11][F15]. **Decisión de diseño**: siempre cabecera `Bearer`, para que el token no
  quede en URLs ni en logs.
- Errores: objeto `error` con `message`, `type`, `code`, `error_subcode`, `is_transient`, `error_user_title`,
  `error_user_msg` y `fbtrace_id` [F21]. La app decide por `code`/`error_subcode`, nunca por el texto.

---

## 4. Webhooks

### 4.1 Configuración en el panel

En **API setup with Instagram Login > Configure webhooks** [F3][F4]:

1. **Callback URL** y **Verify token**; **Verify and save**. La verificación tiene que salir bien para poder
   suscribir campos [F4].
2. Suscribir los campos. Por defecto se suscriben todos: `comments`, `live_comments`, `message_reactions`,
   `messages`, `messaging_optins`, `messaging_postbacks`, `messaging_referral`, `messaging_seen` [F3]. **Manage**
   permite darse de baja o cambiar la versión de los webhooks [F3].
3. HTTPS con certificado válido; los autofirmados no valen [F11].
4. **Además**, activar la cuenta con la API (§4.4). Sin ese paso no llegan avisos de esa cuenta [F11].

No se pueden personalizar los avisos por cuenta: si la cuenta está suscrita a algún campo, la app recibe todos los
campos a los que está suscrita la app [F11].

**Decisión de diseño** (fase 16): Meta llama a **una sola dirección por app**. Si varias cuentas comparten la app de
Meta, lo que llega a la dirección de un canal para otra cuenta conectada cuya clave también firma esos bytes (la misma
app) se lleva al canal de esa otra cuenta, aunque esté desactivado (su propia dirección también lo recibe; su IA no
contesta). Cada canal guarda en bruto solo las entradas (`entry[]`) de su cuenta: los clientes de una cuenta nunca
quedan en los avisos guardados de otra, y un mensaje borrado no deja su texto en ninguno.

### 4.2 Verificación (`GET`)

`GET /api/webhooks/instagram/<canal>?hub.mode=subscribe&hub.challenge=1158201444&hub.verify_token=<token>` [F11]
(la ruta es la de la app: una por canal).

- `hub.mode` siempre `subscribe`; `hub.challenge` es «an `int` you must pass back»; `hub.verify_token` es el del
  panel [F11].
- Si coincide el token: responder 200 con `hub.challenge` tal cual. Si no, cualquier otra respuesta [F11].

### 4.3 Firma de los `POST`

- Cabecera `X-Hub-Signature-256: sha256=<hex>`; HMAC-SHA256 del cuerpo con «your app's **App Secret**» [F11][F22].
- Meta firma la versión del cuerpo con Unicode escapado (`äöå` → `äöå`) y hex en minúsculas [F22].
  Como el cuerpo llega así, se calcula sobre **los bytes exactos** recibidos, igual que en WhatsApp.
- **Qué secreto**: la documentación solo dice «App Secret»; la app de ejemplo lo toma de **App settings > Basic**
  (el de la app de Meta) [F11]. Para Instagram Login el panel da además un «Instagram app secret» [F6]. **NO
  VERIFICADO** cuál firma. **Decisión de diseño** (como la decisión 0022 de WhatsApp): guardar los dos cifrados y
  aceptar el cuerpo si **cualquiera** de los dos da la firma, antes de parsear nada; registrar cuál funcionó para
  dejar de probar el otro.
- mTLS opcional con CN `client.webhooks.fbclientcerts.com` y la CA `meta-outbound-api-ca-2025-12.pem` [F11]. No hace
  falta.

Vector de prueba (calculado aquí con HMAC-SHA256 estándar, para tests):

| Secreto | Cuerpo exacto | `X-Hub-Signature-256` |
|---|---|---|
| `test_app_secret` | `{"object":"instagram","entry":[]}` | `sha256=4c166c139fb15bf4adbda063a21a4c7d870270ce3473257f03812313995045bd` |
| `test_ig_app_secret` | `{"object":"instagram","entry":[]}` | `sha256=2ce531a1c56b981f54fafa24190ed44731977a6b46fdc9d00c1798033cfba254` |

### 4.4 Suscribir la cuenta: `subscribed_apps`

```
POST https://graph.instagram.com/v26.0/me/subscribed_apps?subscribed_fields=messages,message_reactions,messaging_seen,messaging_postbacks,messaging_referral,message_edit
Authorization: Bearer <token>
```

- `/me` es la cuenta profesional del token; también vale `/<user_id>/subscribed_apps` [F11].
- `subscribed_fields`: lista separada por comas. Respuesta: `{"success": true}` [F11].
- El ejemplo oficial pasa el token como `access_token` y usa `v25.0` [F11].
- **NO VERIFICADO**: el `GET /me/subscribed_apps` para comprobar la suscripción (no aparece en la documentación de
  Instagram Login; sí existe en la de páginas [F22]) y si «Add account» en el panel ya suscribe la cuenta.

**Campos y nombres** (hay erratas entre páginas):

| Campo | Para qué | Nota |
|---|---|---|
| `messages` | Mensajes del cliente y **ecos** de los del negocio | Imprescindible [F12][F31] |
| `message_reactions` | Reacciones | La guía de mensajes lo escribe `messaging_reactions` [F14]; la tabla de campos y el panel, `message_reactions` [F3][F11] |
| `messaging_seen` | Leído por el cliente | [F12] |
| `messaging_postbacks` | Botones y rompehielos | Solo si se usan [F12] |
| `messaging_referral` | Enlaces `ig.me` con `ref` en conversaciones ya abiertas | La guía de mensajes lo escribe `messaging_referrals` [F14] |
| `message_edit` | Mensaje editado por el cliente | Desde el 10-09-2025 [F26][F12] |
| `message_echoes` | Ecos | La tabla de campos lo lista para Instagram Login con un permiso de comentarios (parece errata) [F11]; en la vía con página los ecos van dentro de `messages` [F22]. **NO VERIFICADO** si hay que suscribirlo; los ejemplos de Instagram Login traen `is_echo` dentro de `messages` [F12] |

**Decisión de diseño**: suscribir los nombres de la tabla de campos y del panel, y comprobar con la prueba real
que llegan ecos solo con `messages`.

### 4.5 Entrega, reintentos y tiempo de respuesta

| Aspecto | Qué dice Meta |
|---|---|
| Respuesta | `200 OK` a todo [F11]; «within 5 or less seconds» [F22] |
| Lotes | Hasta 1.000 actualizaciones por `POST`, sin garantía de agrupar [F11] |
| Reintentos (Instagram, general) | Reintenta al momento y luego cada vez menos durante **36 horas**; lo no confirmado se descarta [F11] |
| Reintentos (mensajes) | La página de Instagram remite a la de Messenger para la frecuencia de los avisos de mensajería [F11]. Allí: reintenta varias veces; a los **15 minutos** sin entregar avisa al desarrollador; tras **1 hora** fallando envía «Webhooks Disabled» y **da de baja la app de esa cuenta de Instagram**: hay que volver a suscribirla [F22][F27] |
| Orden | No garantizado tras fallos; usar `timestamp` [F22] |
| Historial | No se pueden pedir avisos pasados [F11] |
| Tamaño máximo del cuerpo | **NO VERIFICADO** (no figura) |

**Decisión de diseño**: guardar en bruto antes de hacer nada más con el aviso y responder 200 enseguida (sin IA en el
webhook); un eco o un mensaje que falla queda anotado en ese aviso guardado sin perder los demás; deduplicar por `mid`;
en la revisión periódica volver a llamar a `POST /me/subscribed_apps` (es idempotente según la documentación de
páginas; **NO VERIFICADO** para Instagram) y avisar en el panel si hubo «Webhooks Disabled». Si se perdieron
mensajes, la API de conversaciones permite leer los 20 últimos de cada conversación (§9).

---

## 5. Forma de los datos

### 5.1 Sobre común

| Ruta | Contenido [F12] |
|---|---|
| `object` | `"instagram"` |
| `entry[].id` | ID de la cuenta profesional del negocio (= `user_id` de `/me`) **→ clave para encontrar el canal** |
| `entry[].time` | Cuándo envió Meta el aviso |
| `entry[].messaging[]` | Eventos. Cada uno con `sender.id`, `recipient.id`, `timestamp` y su contenido |

Quién es quién [F12]:

| Caso | `entry[].id` | `recipient.id` | `sender.id` |
|---|---|---|---|
| El negocio **recibe** un mensaje | ID de la cuenta | ID de la cuenta | **IGSID del cliente** |
| El negocio **envía** (eco) | ID de la cuenta | **IGSID del cliente** | ID de la cuenta |

- Con Instagram Login los mensajes llegan en `messaging[]`, no en `changes[]` (que es para comentarios) [F12].
- Unidades de tiempo: los ejemplos traen 13 cifras (`1569262485349`), o sea milisegundos [F12][F31]; la página
  genérica describe `time` como marca Unix [F11]. **NO VERIFICADO** expresamente. **Decisión de diseño**: si el
  número tiene 13 cifras, milisegundos; si tiene 10, segundos.
- Identidad del cliente: **IGSID** (`sender.id`), propio de la persona y de la cuenta del negocio [F1]. Es la
  clave en `contact_identities` (`channel_type` `instagram`). Se guarda como texto.

### 5.2 `messages`

`message.mid` siempre. Según el caso [F12][F31]:

| Campo | Cuándo |
|---|---|
| `text` | El mensaje tiene texto |
| `attachments[]` | `{type, payload:{url}}`, uno o varios (§7) |
| `is_echo: true` | Lo envió la cuenta del negocio |
| `is_self: true` | Mensaje de la cuenta a sí misma (pruebas) [F18] |
| `is_deleted: true` | El cliente lo borró. Meta exige borrar el mensaje al recibir este aviso [F29] |
| `is_unsupported: true` | Contenido no admitido |
| `quick_reply.payload` | Pulsó una respuesta rápida |
| `reply_to.mid` | Respuesta en línea a un mensaje |
| `reply_to.story` (`url`, `id`, y desde el 12-12-2025 `link_sticker_url`) | Respuesta a una historia [F12][F20] |
| `referral` (`ref`, `ad_id`, `source: "ADS"`, `type: "OPEN_THREAD"`, `ads_context_data`) | Llegó desde un anuncio a Direct |

Ejemplo (mensaje de texto entrante):

```json
{
  "object": "instagram",
  "entry": [
    {
      "id": "17840000000000001",
      "time": 1760600000500,
      "messaging": [
        {
          "sender": { "id": "1100000000000003" },
          "recipient": { "id": "17840000000000001" },
          "timestamp": 1760600000123,
          "message": {
            "mid": "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQw",
            "text": "Hola, ¿tenéis cita el viernes?"
          }
        }
      ]
    }
  ]
}
```

Ejemplo (eco de un mensaje enviado por el negocio):

```json
{
  "object": "instagram",
  "entry": [
    {
      "id": "17840000000000001",
      "time": 1760600100500,
      "messaging": [
        {
          "sender": { "id": "17840000000000001" },
          "recipient": { "id": "1100000000000003" },
          "timestamp": 1760600100321,
          "message": { "mid": "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQx", "text": "Sí, a las 17:00", "is_echo": true }
        }
      ]
    }
  ]
}
```

### 5.3 Otros eventos

| Campo suscrito | Contenido en `messaging[]` [F12] |
|---|---|
| `message_reactions` | `reaction`: `mid`, `action` (`react`/`unreact`), y al reaccionar `reaction` (p. ej. `love`) y `emoji`. Sin eco de las reacciones del negocio [F31] |
| `messaging_seen` | `read.mid`: el mensaje leído |
| `messaging_postbacks` | `postback`: `mid`, `title`, `payload` |
| `messaging_referral` | `referral`: `ref`, `source`, `type: "OPEN_THREAD"` (conversaciones ya abiertas) |
| `message_edit` | `message_edit`: `mid`, `text`, `num_edit` |

---

## 6. Envío

### 6.1 Petición

```
POST https://graph.instagram.com/v26.0/me/messages        (o /<user_id>/messages)
Authorization: Bearer <token>
Content-Type: application/json
```

| Tipo | Cuerpo [F14] |
|---|---|
| Texto | `{"recipient":{"id":"<IGSID>"},"message":{"text":"…"}}` |
| Una imagen | `"message":{"attachment":{"type":"image","payload":{"url":"<URL>"}}}` (el ejemplo oficial usa la clave `attachments` con un objeto) |
| Varias imágenes (hasta 10) | `"message":{"attachments":[{"type":"image","payload":{"url":"…"}}, …]}`. Fuera de beta desde el 06-05-2026 [F20] |
| Audio, vídeo o PDF | `"message":{"attachment":{"type":"audio"\|"video"\|"file","payload":{"url":"<URL>"}}}` |
| Corazón | `"message":{"attachment":{"type":"like_heart"}}` |
| Reacción | `{"recipient":{…},"sender_action":"react","payload":{"message_id":"<mid>","reaction":"<emoji>"}}`; `unreact` sin `reaction` |
| Publicación propia | `"attachment":{"type":"MEDIA_SHARE","payload":{"id":"<POST_ID>"}}` (solo publicaciones de la cuenta) |

- **Texto**: «UTF-8 and be a **1000 bytes** or less. Links must be valid formatted URLs» [F14]. La guía de la vía con
  página dice en un sitio «less than 1000 characters» y en otro «1,000 bytes or less» [F32]: manda el límite en
  bytes. Ojo: en español cada letra con tilde ocupa 2 bytes y un emoji 4 («Hola, ¿qué tal?» son 15 caracteres y
  17 bytes). **Decisión de diseño** (regla «nunca respuestas troceadas»): recortar a 1.000 bytes sin partir un
  carácter y terminar en «…», como en Telegram, e instruir a la IA para respuestas cortas. Un borrador de la IA que se
  aprueba sin cambiarlo se recorta igual; lo que escribe o cambia una persona no se recorta: la bandeja pide acortarlo.
- **Sin pie de foto**: no hay campo de texto junto al adjunto; texto y archivo van en mensajes separados [F14].
  **Decisión de diseño** (0029): la app solo envía texto; los adjuntos quedan fuera de esta fase.
- **Envío por URL**: Meta descarga el archivo de la URL. Tiene que ser pública, con SSL válido y responder rápido
  (error `100`/`2018008`); un vídeo que no se descarga en **75 segundos** falla (`100`/`2018294`) [F23].
  La app no envía archivos por Instagram (decisión 0029).
- La API de subida de adjuntos (`/message_attachments`) está documentada solo para la vía con página
  (`graph.facebook.com`, ID de página) [F36]. **NO VERIFICADO** en `graph.instagram.com`: no se usa.

Formatos y tamaños [F14]:

| Tipo | Formatos | Máximo |
|---|---|---|
| Audio | aac, m4a, wav, mp4 | 25 MB |
| Imagen | png, jpeg | 8 MB |
| Vídeo | mp4, ogg, avi, mov, webm | 25 MB |
| Archivo | pdf | 25 MB |

Respuesta correcta [F14]:

```json
{ "recipient_id": "1100000000000003", "message_id": "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQx" }
```

- **NO VERIFICADO**: que el `mid` del eco de ese envío sea igual a `message_id`. Si lo es, sirve para distinguir los
  ecos propios de los enviados desde la app de Instagram (§8).
- Instagram no avisa de la entrega; solo de la lectura (`messaging_seen`) [F24].

### 6.2 Ventana de 24 horas y agente humano

- Solo se puede escribir **después** de que el cliente escriba; hay **24 horas** para responder a cada mensaje
  [F14]. El negocio no puede empezar la conversación [F14][F24].
- Acciones que abren la ventana en la plataforma de mensajería (Messenger e Instagram): el cliente envía un
  mensaje, pulsa un botón de llamada a la acción, llega desde un anuncio y escribe, abre un enlace `ig.me` a una
  conversación existente, reacciona a un mensaje, entre otras [F24]. **Decisión de diseño**: contar la ventana
  desde el `timestamp` del último mensaje del cliente (no de los ecos), como en WhatsApp.
- **Etiqueta de agente humano**: permite responder **dentro de 7 días** desde el mensaje del cliente, solo con
  respuestas de una persona y cuando el asunto no se pudo resolver en 24 h (p. ej., fin de semana) [F1][F38].
  Requiere la función **Human Agent**, que **exige App Review y verificación de la empresa** [F38]. En la revisión
  es opcional y hay que explicar por qué se tarda hasta 7 días y grabar a una persona respondiendo [F37].
- Forma de la petición: `messaging_type: "MESSAGE_TAG"` [F27] y `tag: "HUMAN_AGENT"` [F45]. **Verificación
  parcial**: la referencia de la Send API no se pudo cargar (la página sale vacía); el nombre `HUMAN_AGENT` se
  confirmó solo por el índice del buscador de esa página. La guía de Instagram Login dice que se puede «tag the
  response» sin dar el formato [F14]. Las etiquetas `CONFIRMED_EVENT_UPDATE`, `ACCOUNT_UPDATE` y
  `POST_PURCHASE_UPDATE` dan error `100` desde el 27-04-2026 [F24][F26].
- **Decisión de diseño**: en v1, sin etiqueta: fuera de 24 h la bandeja bloquea el envío y lo explica. «Reintentar» un
  mensaje fallido es enviarlo ahora: con la ventana cerrada tampoco se ofrece ni se acepta.

### 6.3 «Escribiendo…» y marcar como leído

- `{"recipient":{"id":"<IGSID>"},"sender_action":"typing_on"}` (o `typing_off`, `mark_seen`) a `/me/messages`,
  en una petición sin nada más [F16].
- El ejemplo oficial usa `graph.facebook.com` con un token de Instagram [F16]; **NO VERIFICADO** el host correcto
  (se supone `graph.instagram.com`).
- Los mensajes que llegan por webhook **no se marcan como leídos** en Instagram hasta que se responde [F14].

### 6.4 Límites de envío

| Límite | Valor | Fuente |
|---|---|---|
| Send API, texto, enlaces, reacciones y stickers | **100 llamadas/s por cuenta** (Instagram Login) | [F1] |
| Send API, audio o vídeo | **10 llamadas/s por cuenta** | [F1] |
| Conversations API | 2 llamadas/s por cuenta | [F1] |
| Messenger API para Instagram (otra vía) | 300/s texto («up from 100» desde el 08-10-2024) | [F25][F26] |
| Muchos mensajes al mismo hilo | Puede limitar, sin cifra | [F25] |
| Volumen muy alto | Más de 72.000 mensajes: la bandeja deja de mostrar y enviar | [F25] |
| Resto de llamadas (no mensajería) | 4.800 × impresiones en 24 h, por app y cuenta | [F1] |

Para un negocio pequeño, muy lejos de los límites. Al superarlos: `4` o `613`/`2534040` [F23].

---

## 7. Medios recibidos

- Tipos en `attachments[].type` con Instagram Login: `media`, `audio`, `file`, `image` (imagen, GIF o sticker),
  `video`, `share` (antiguo, retirado después de febrero de 2026), `ig_post`, `story_mention`, `ig_reel`, `reel`,
  `story`, `ig_story` [F12]. La vía con página añade `ephemeral` (fotos de ver una vez), **sin URL** [F31].
- Cada uno trae `payload.url`. `ig_post` trae además `ig_post_media_id` y `title` [F13]; los reels, título e ID
  del vídeo [F26].
- **Son solo enlaces**: de un contenido compartido (publicación, reel) solo llega la URL [F12][F14]; las menciones
  en historias, la URL de la historia [F33].
- **Caducidad**: Meta no da un plazo. Las URL son de CDN «privacy-aware» y no devuelven nada cuando el contenido se
  borra o caduca [F1]. Las historias dejan de verse a las 24 h o al borrarse [F33]. La foto de perfil caduca «en
  unos días» [F15].
- **Menciones en historias**: **prohibido guardar o cachear el contenido**; se guarda la URL y se muestra desde el
  navegador; si ya no carga, un aviso de «historia no disponible» [F33]. Solo llegan si la cuenta que menciona es
  pública o sigue al negocio [F33].
- GIF y stickers: la vía con página dice que no generan webhook [F31]; Instagram Login los incluye en `image` [F12].
  Contradicción: **NO VERIFICADO**.
- **Decisión de diseño** (0029): descargar en segundo plano enseguida las imágenes, los audios y los PDF que el
  cliente envía (para la IA y la transcripción), sin cabecera de autorización (son URL de CDN; **NO VERIFICADO** que no
  la pidan). Los vídeos, `share`, `ig_post`, reels e historias aparecen como «Tipo de mensaje no admitido»; de
  `story_mention` no se guarda nada.

---

## 8. Convivencia con la bandeja de Instagram

- Lo que envía la cuenta del negocio llega como eco: «is_echo flag will be present to indicate that the message is
  sent from the Instagram account itself» [F31]; con Instagram Login, `is_echo` «included when the message was sent
  by your app user» [F12]. La documentación no distingue entre lo enviado por la API y lo enviado desde la app de
  Instagram. **NO VERIFICADO** en una prueba real que los mensajes escritos en la app de Instagram generen eco en
  esta vía (es lo que dicen los textos citados).
- En Messenger, el eco trae `app_id` y vale `26390203743090` cuando se envía desde la bandeja de la página [F46];
  para Instagram **no está documentado** que el eco traiga `app_id`.
- Sin enrutamiento configurado («zero config»), con una sola app más la bandeja, **el negocio es responsable de
  coordinar** para no responder dos veces [F35].
- Responder desde una app externa mueve la conversación a la carpeta **General**; las de no seguidores entran en
  **Solicitudes** [F14][F1]. La API no da información de carpetas [F14]. Las solicitudes inactivas 30 días no salen
  en la API [F14].
- Se exige una vía para pasar a una persona en las experiencias automáticas; una bandeja propia de la misma app
  cumple [F29][F34]. Donde la ley lo pida (Meta cita California y Alemania), avisar de que responde un sistema
  automático al empezar, tras mucho tiempo o al pasar de persona a bot; Meta lo recomienda siempre [F14].
- **Decisión de diseño**: el eco se atiende al momento, dentro del aviso y antes que los mensajes del cliente del
  mismo aviso, para que la IA quede en pausa antes de poder contestar. Si su `mid` ya es de un mensaje de la app, o su
  texto es el de un mensaje que la app está enviando a ese cliente o le entregó a Instagram hace un momento (el `mid`
  del eco puede no ser el del envío, §12, y el eco puede llegar antes de que Instagram conteste al envío), es un envío
  propio y no pasa nada. Cuenta cuándo se entregó a Instagram, no cuándo se escribió: un borrador aprobado o un
  «Reintentar» pueden ser de mucho antes. Si no, se guarda como mensaje «Desde Instagram» y pausa la IA en esa
  conversación, como en la coexistencia de WhatsApp. Si un eco con el `mid` del envío llegó antes de su respuesta y se
  tomó por del negocio (por ejemplo, porque Instagram cambió el texto), al guardar el `mid` del envío ese mensaje se
  quita y la pausa vuelve a como estaba: queda un solo mensaje y la IA no se pausa por un envío de la app.

---

## 9. Perfil del cliente y conversaciones

**Perfil** [F15]:

`GET https://graph.instagram.com/v26.0/<IGSID>?fields=name,username,profile_pic,follower_count,is_user_follow_business,is_business_follow_user,is_verified_user`

| Campo | Nota |
|---|---|
| `name` | Puede ser `null` |
| `username` | Nombre de usuario |
| `profile_pic` | Puede ser `null`; la URL caduca en unos días |
| `follower_count`, `is_verified_user` | Datos del cliente |
| `is_user_follow_business`, `is_business_follow_user` | Quién sigue a quién |

- **Consentimiento**: solo funciona si el cliente **escribió** al negocio o pulsó un rompehielos o el menú
  persistente. Si solo comentó, error «User consent is required to access user profile» (código **NO
  VERIFICADO**) [F15].
- Si el cliente bloqueó al negocio, no se puede ver su perfil [F15].
- **Decisión de diseño**: pedir el perfil una vez al crear el contacto (y refrescar `profile_pic` si falla al
  cargar). El nombre de usuario solo se muestra, nunca identifica.

**Conversaciones** [F17]: `GET /me/conversations?platform=instagram`, `GET /me/conversations?user_id=<IGSID>`,
`GET /<CONVERSATION_ID>?fields=messages` y `GET /<MESSAGE_ID>?fields=id,created_time,from,to,message`. Solo se
pueden leer los detalles de los **20 mensajes más recientes** de cada conversación. Útil para recuperar lo perdido
si se dieron de baja los webhooks.

---

## 10. Errores

Lista oficial de la Plataforma de Messenger, que incluye la mensajería de Instagram [F23]. La documentación de
Instagram Login no publica una lista propia de errores de mensajería (la de Instagram [F21] es de publicación de
contenido). **NO VERIFICADO** que `graph.instagram.com` devuelva exactamente estos códigos.

| `code` / `error_subcode` | Significado oficial | Qué hace la app (decisión de diseño) |
|---|---|---|
| `10` / `2534022` | «This message is sent outside of allowed window» | Fallo definitivo: «Han pasado más de 24 h desde el último mensaje del cliente» |
| `10` / `2018278` | Fuera de la ventana permitida (variante) | Igual |
| `551` | «This person isn't receiving messages from you right now» | Fallo definitivo; contacto marcado como no disponible |
| `551` / `1545041` y `200` / `1545041` | «This person isn't available right now» | Igual |
| `10` / `2018108` | «They can't receive your messages right now» | Igual |
| `200` / `2534041` | El titular desactivó el acceso a los mensajes de Instagram | Canal en «error»: activar «Permitir acceso a los mensajes» (§1.5) |
| `100` / `2534014` | «No matching Instagram user» (IGSID no válido) | Fallo definitivo |
| `100` / `2534015` | «Invalid message data» | Fallo definitivo |
| `100` / `2534029` | Negocio bloqueado para enviar por la API de mensajería de Instagram | Canal en «error» |
| `10` / `1893063` | Envío restringido temporalmente por incumplir políticas | Canal en «error» |
| `100` / `2018008` | No se pudo descargar el archivo de la URL | Fallo con explicación |
| `100` / `2018047` | El tipo no coincide con el archivo | Fallo con explicación |
| `100` / `2018109` | El adjunto supera el tamaño | Fallo con explicación |
| `100` / `2018294` | Vídeo: tiempo agotado (75 s) o dañado | Fallo con explicación |
| `190` | Token no válido | Canal en «error»: «El token de Instagram no es válido o ha caducado» |
| `4` | Límite de llamadas de la app | Esperar y reintentar |
| `613` / `2534040` | Límite de llamadas superado | Esperar y reintentar |
| `2` | Error inesperado; también puede pasar si el cliente bloqueó al negocio | Reintentar pocas veces |
| `9000001` | Mensaje borrado por el cliente o el negocio | Ignorar |

Ojo: la tabla resumida de la guía de envío dice que `1545041` es «Messaging window closed» [F24], lo contrario que
la lista de errores [F23]. Se sigue la lista de errores.

---

## 11. Pruebas y demostración

- **Cuenta de prueba**: se añade en el panel (**Generate access tokens > Add account**, o **App Roles > Roles**) y
  tiene que ser pública [F3]. Quien prueba tiene que tener rol en la app, haber concedido los permisos y tener rol
  en la cuenta profesional [F14]. **NO VERIFICADO**: si el rol aparece como «Instagram Tester» y hay que aceptar una
  invitación (era así en la API antigua; la documentación actual no lo dice).
- **Roles**: hasta 50 «testers» en una app sin negocio verificado [F40].
- **Botón «Test»** del webhook: en el panel, **Test** junto a un campo muestra un ejemplo y **Send to My Server**
  lo envía [F11]. **NO VERIFICADO**: si ese envío va firmado y con qué IDs (seguramente de ejemplo): la app debe
  responder 200 aunque `entry[].id` no sea de ningún canal.
- **API Integration Helper**: el panel permite enviar un mensaje de prueba con la API (solo Instagram Login) [F3][F4].
- **Mensajes a uno mismo**: la cuenta profesional puede escribirse a sí misma; llega un eco con `is_echo` e
  `is_self` a `true` y la ventana de 24 h no se aplica [F18][F11]. En el ejemplo oficial de respuesta, el envío
  va a `graph.facebook.com` y la respuesta trae solo `id` [F18]: **NO VERIFICADO** en `graph.instagram.com`.
- **Prueba de verdad** (decisión de diseño): una cuenta de Instagram **sin rol** en la app escribe a la cuenta del
  negocio. Si no llega el webhook, el acceso estándar no basta (§1.3).

---

## 12. No verificado o pendiente

| Tema | Estado |
|---|---|
| Que con acceso estándar lleguen webhooks de clientes sin rol en la app | Contradicción entre [F1][F19] y [F11]; probar antes de nada |
| Publicar la app sin verificar la empresa | Contradicción entre [F42][F43] y [F3][F11] |
| Qué secreto firma `X-Hub-Signature-256` (app de Meta o Instagram app secret) | Solo dice «App Secret»; se prueban los dos |
| Si hay que suscribir `message_echoes` o los ecos llegan solo con `messages` | Las páginas no coinciden |
| Que los mensajes escritos en la app de Instagram generen eco en esta vía | Lo sugiere el texto; falta prueba real |
| Que el `mid` del eco sea igual al `message_id` del envío | No documentado |
| Si el eco de Instagram trae `app_id` | Solo documentado para Messenger |
| Que «Permitir acceso a los mensajes» sea obligatorio con Instagram Login, y la ruta actual del menú | Solo en la guía de la vía con página |
| `GET /me/subscribed_apps` en `graph.instagram.com` | No documentado para esta vía |
| Si «Add account» en el panel ya suscribe la cuenta a los webhooks | No documentado |
| Reintentos de los webhooks de mensajes: 36 h o el régimen de Messenger (baja a la hora) | Dos páginas distintas |
| Tamaño máximo del cuerpo del webhook | No documentado |
| Unidad de `timestamp` y `entry[].time` (ms en los ejemplos) | No se dice expresamente |
| `graph.instagram.com` con `v26.0` | Los ejemplos usan `v25.0` |
| Formato literal de la etiqueta (`tag: "HUMAN_AGENT"`) en `graph.instagram.com` | La referencia de la Send API no carga |
| Host correcto para `typing_on`/`mark_seen` | El ejemplo oficial usa `graph.facebook.com` |
| Que `graph.instagram.com` devuelva los mismos códigos de error que Messenger | No hay lista propia |
| Código del error «User consent is required to access user profile» | Solo el texto |
| Plazo de caducidad de las URL de los adjuntos recibidos | Meta no da cifra |
| Si las URL de adjuntos piden autorización al descargarlas | No documentado |
| GIF y stickers entrantes (¿llegan como `image` o no llegan?) | Las páginas no coinciden |
| Rol «Instagram Tester» con invitación que aceptar | No aparece en la documentación actual |
| Firma e IDs del botón «Test» del panel | No documentado |
| Envío a uno mismo por `graph.instagram.com` | El ejemplo usa `graph.facebook.com` |
| Si la renovación devuelve un token nuevo, y el formato de su error | No documentado |

---

## Fuentes

Consultadas el 16-10-2026. Para las páginas de `developers.facebook.com/documentation/…` se leyó la versión de
texto (misma URL con `.md` al final). Las páginas no muestran fecha de actualización en esa versión.

- [F1] Instagram Platform, Overview (niveles de acceso, tokens, Human Agent, límites, bandeja): https://developers.facebook.com/documentation/instagram-platform/overview
- [F2] Instagram API with Instagram Login: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login
- [F3] Create a Meta App for Instagram Platform: https://developers.facebook.com/documentation/development/create-an-app/other-app-types/instagram-apis
- [F4] Customize the Manage messaging and content on Instagram Use Case: https://developers.facebook.com/documentation/development/create-an-app/instagram-use-case
- [F5] Get Started (token del panel, `/me` y sus campos): https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started
- [F6] Business Login for Instagram (scopes, tokens, renovación): https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
- [F7] Refresh Access Token (referencia): https://developers.facebook.com/documentation/instagram-platform/reference/refresh_access_token
- [F8] Access Token (referencia): https://developers.facebook.com/documentation/instagram-platform/reference/access_token
- [F9] /me (referencia): https://developers.facebook.com/documentation/instagram-platform/reference/me
- [F10] IG User (referencia): https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user
- [F11] Setup Webhooks Subscriptions (Instagram): https://developers.facebook.com/documentation/instagram-platform/webhooks
- [F12] Instagram Platform Webhook Notification Examples: https://developers.facebook.com/documentation/instagram-platform/webhooks/examples
- [F13] Instagram Post Shares: New Attachment Type: https://developers.facebook.com/documentation/instagram-platform/webhooks/new
- [F14] Send Messages (Instagram Login): https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api
- [F15] Instagram User Profile API (Instagram Login): https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile
- [F16] Sender Actions (Instagram Login): https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/sender-actions
- [F17] Get Conversations (Instagram Login): https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api
- [F18] Self Messaging: https://developers.facebook.com/documentation/instagram-platform/self-messaging
- [F19] App Review for Instagram API: https://developers.facebook.com/documentation/instagram-platform/app-review
- [F20] Changelog for Instagram Platform: https://developers.facebook.com/documentation/instagram-platform/changelog
- [F21] Error Codes (Instagram Platform): https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes
- [F22] Meta Webhooks for Messenger Platform (5 s, reintentos, baja a la hora, firma): https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks
- [F23] Common Error Codes (Messenger Platform): https://developers.facebook.com/documentation/business-messaging/messenger-platform/error-codes
- [F24] Send a Message (Messenger Platform; ventana, etiquetas): https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages
- [F25] Messenger Platform rate limits: https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview/rate-limiting
- [F26] Messenger Platform Changelog (v26.0, `ig_reel`, `message_edit`, 300/s): https://developers.facebook.com/documentation/business-messaging/messenger-platform/changelog
- [F27] Messenger Platform FAQ (`messaging_type=MESSAGE_TAG`, baja de webhooks): https://developers.facebook.com/documentation/business-messaging/messenger-platform/faq
- [F28] Messenger Platform and IG Messaging API policy: https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy
- [F29] Overview of Instagram Messaging API (vía con página): https://developers.facebook.com/documentation/business-messaging/instagram-messaging/overview
- [F30] Instagram Messaging, Getting Started («Allow Access to Messages»): https://developers.facebook.com/documentation/business-messaging/instagram-messaging/get-started
- [F31] Webhooks for Instagram Messaging (ecos, tipos, efímeros): https://developers.facebook.com/documentation/business-messaging/instagram-messaging/webhooks
- [F32] Instagram Messaging, Send a Message: https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/send-message
- [F33] Story Mention: https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/story-mention
- [F34] Human Agent Escalation: https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/human-agent-escalation
- [F35] Conversation Routing for Instagram («zero config»): https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/conversation-routing
- [F36] Upload Media for Instagram Messaging: https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/attachment-upload
- [F37] App Review, Apps For Your Own Business: https://developers.facebook.com/documentation/business-messaging/instagram-messaging/app-review/apps-for-your-own-business
- [F38] Human Agent (features reference): https://developers.facebook.com/documentation/development/features-reference/human-agent
- [F39] Access Levels: https://developers.facebook.com/documentation/development/graph-api/overview/access-levels
- [F40] App Roles: https://developers.facebook.com/documentation/development/build-and-test/app-roles
- [F41] App Modes: https://developers.facebook.com/documentation/development/build-and-test/app-modes
- [F42] Publish: https://developers.facebook.com/documentation/development/release
- [F43] Business Verification: https://developers.facebook.com/documentation/development/release/business-verification
- [F44] Graph API, versiones: https://developers.facebook.com/docs/graph-api/changelog/versions/
- [F45] Send API reference (no se pudo cargar: la página sale vacía; `HUMAN_AGENT` y `MESSAGE_TAG` confirmados solo por el índice del buscador): https://developers.facebook.com/docs/messenger-platform/reference/send-api/
- [F46] `message_echoes` (Messenger, `app_id` de la bandeja): https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhook-events/message-echoes
