# Integración de correo: Gmail, Outlook / Microsoft 365 e IMAP/SMTP

Referencia técnica de los tres conectores de correo del §6.3 de la especificación. Todo lo que aparece aquí
se comprobó en fuentes primarias a fecha **2026-09-26**; cada dato lleva su fuente (`[Fn]`, lista al final).
Lo que no se pudo confirmar va marcado como **no verificado** y debe probarse antes de darlo por bueno. Lo
marcado como **decisión de diseño** es una recomendación nuestra, no un dato del proveedor.

## Por qué tres conectores y no solo IMAP

- Gmail y Microsoft ya no aceptan contraseñas normales en IMAP/SMTP para la mayoría de cuentas (ver §2.6 y
  §3.1). Con su API y OAuth el negocio no entrega su contraseña, se puede revocar el acceso y se obtienen
  funciones que IMAP no da: sincronización incremental barata, borradores visibles en el propio buzón,
  etiquetas y, en Outlook, el cuerpo sin la cita (`uniqueBody`).
- IMAP/SMTP queda para el resto de proveedores (hosting con dominio propio, Yahoo, iCloud, Zoho…), casi
  siempre con contraseña del buzón o contraseña de aplicación.
- Cada negocio usa **sus propias credenciales** (proyecto de Google Cloud y app de Entra propios): así no hay
  una app compartida que verificar ni un límite de usuarios que repartir entre negocios.

---

## 1. Gmail (API + OAuth con el proyecto de Google Cloud del negocio)

### 1.1 Tipo de usuario y estado de publicación

| Configuración | Quién puede conectar | Caducidad del refresh token | Pantalla de aviso | Uso en el producto |
|---|---|---|---|---|
| **Internal** | Solo cuentas de la organización de Google Workspace / Cloud Identity propietaria del proyecto [F9] | Sin caducidad especial | No; las apps internas no necesitan verificación [F7] | Negocios con Workspace |
| **External + Testing** | Hasta 100 usuarios de prueba [F9] | **7 días** desde el consentimiento, salvo que solo se pidan nombre, email y perfil [F2][F9] | — | **Nunca** (spec §6.3) |
| **External + In production, sin verificar** | Cualquier cuenta de Google, con tope de **100 usuarios nuevos en total** que concedan scopes sensibles o restringidos sin aprobar [F6][F9] | Normal (ver §1.3) | Sí, «unverified app screen» antes del consentimiento [F6][F8] | Cuentas @gmail.com |

Puntos clave comprobados:

- `gmail.modify` es un scope **restringido** (no solo «sensible») [F5]. La verificación de scopes restringidos
  exige además una evaluación de seguridad externa (CASA) si los datos se guardan o transmiten en servidores
  [F8].
- Una app **sin verificar sigue funcionando en producción** con scopes restringidos: se muestra la pantalla de
  app no verificada y queda limitada a 100 usuarios nuevos hasta que se verifique [F6][F8]. El usuario debe
  pulsar para continuar a través del aviso.
- Google considera exento de verificación el **uso personal**: «fewer than 100 users», conocidos por quien
  crea la app, que aceptan el aviso [F7]. Una instalación de un solo negocio con sus propios buzones encaja en
  ese supuesto; por eso cada negocio crea su propio proyecto (spec §14, «No hacer»).
- El tope de 100 cuenta usuarios nuevos acumulados («in total») [F6]; la documentación no dice cómo se
  reinicia. Reconectar el mismo buzón no debería contar como usuario nuevo (**no verificado**).
- Texto exacto de la pantalla en español: **no verificado** (la ayuda en español no lo transcribe). La UI debe
  describirlo de forma aproximada («Google avisa de que no ha verificado la app») y enseñar a pulsar
  «Configuración avanzada → Ir a …».

### 1.2 Cliente OAuth y URI de redirección

- Tipo de cliente: «Web application». Reglas de las URI de redirección [F10]: HTTPS obligatorio (salvo
  localhost), sin IP en bruto, sin comodines, sin fragmento, y el TLD del host debe estar en la Public Suffix
  List. En producción el dominio debe figurar en «Authorized domains» de la pantalla de marca [F10].
- URI propuesta (decisión de diseño): `https://{dominio}/api/oauth/google/callback`, mostrada con botón de
  copiar. Que un subdominio `*.vercel.app` sea aceptado como dominio autorizado: **no verificado**; en
  producción real conviene dominio propio.

### 1.3 Flujo OAuth 2.0 (web server)

| Paso | Endpoint | Detalle |
|---|---|---|
| Autorizar | `GET https://accounts.google.com/o/oauth2/v2/auth` [F1] | `response_type=code`, `client_id`, `redirect_uri`, `scope`, `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, `state`; opcional `login_hint` |
| Canjear código | `POST https://oauth2.googleapis.com/token` (form-urlencoded) [F1] | `code`, `client_id`, `client_secret`, `redirect_uri`, `grant_type=authorization_code` |
| Refrescar | mismo endpoint [F1] | `grant_type=refresh_token`, `refresh_token`, `client_id` y `client_secret` (el ejemplo visible de la página es la variante DPoP, sin secreto; con cliente web se envía el secreto como en el canje) |
| Revocar | `POST https://oauth2.googleapis.com/revoke?token={token}` (form-urlencoded) [F1] | Vale access o refresh token; 200 si va bien, 400 si falla. Revoca **todos** los scopes concedidos al proyecto |
| Descubrimiento OIDC | `https://accounts.google.com/.well-known/openid-configuration` [F4] | Para localizar userinfo si hiciera falta |

Por qué cada parámetro:

- `access_type=offline`: sin él no hay refresh token y el canal dejaría de funcionar al caducar el access
  token [F1].
- `prompt=consent`: Google solo devuelve el refresh token en la **primera** autorización [F1]; al reconectar
  hay que forzar el consentimiento para recibir uno nuevo.
- `include_granted_scopes=true`: autorización incremental recomendada [F1].
- Scopes: `openid email https://www.googleapis.com/auth/gmail.modify`. `openid` + `email` devuelven un
  `id_token` con `sub`, `email` y `email_verified`; el identificador estable es `sub`, no el email [F4].
  `gmail.modify` cubre leer, enviar, etiquetar y borradores, pero no el borrado permanente [F5].

**Comprobar los scopes concedidos.** Con scopes de inicio de sesión + un scope de datos, Google muestra el
consentimiento granular y el usuario puede desmarcar `gmail.modify` [F3]. La respuesta del token trae `scope`
(lista separada por espacios) y la app **debe** comprobarla y desactivar lo que falte [F1][F3]. Si falta
`gmail.modify`, el canal queda en `error` con el aviso «No se concedió permiso para leer y enviar correo».

**Respuesta del token** [F1]: `access_token`, `expires_in` (segundos), `refresh_token` (solo con
`access_type=offline`), `scope`, `token_type=Bearer`, `id_token` (con `openid`) y `refresh_token_expires_in`,
que **solo aparece si el usuario concedió acceso por tiempo limitado** («time-based access»). Si llega,
guardar la fecha y avisar antes de que caduque.

**Cuándo deja de valer el refresh token** (→ estado «Requiere reconexión») [F2]:

- el usuario revoca el acceso;
- no se usa durante **6 meses**;
- el usuario cambia la contraseña y el token incluye scopes de Gmail;
- la cuenta supera el máximo de refresh tokens vivos: **100 por cuenta de Google y por client ID** (reconectar
  muchas veces invalida los más antiguos);
- el acceso por tiempo limitado expira;
- un administrador de Workspace restringe el servicio;
- proyecto en «Testing» (7 días).

Al refrescar, `invalid_grant` indica token caducado o revocado: hay que volver a pedir consentimiento [F1].

### 1.4 Recepción (sondeo en cada `tick()`)

| Operación | Endpoint (base `https://gmail.googleapis.com/gmail/v1`) | Coste de cuota [F11] |
|---|---|---|
| Perfil | `GET /users/me/profile` → `emailAddress`, `messagesTotal`, `threadsTotal`, `historyId` [F16] | 1 |
| Cambios | `GET /users/me/history` [F13] | 2 |
| Listar | `GET /users/me/messages` [F15] | 5 |
| Leer | `GET /users/me/messages/{id}` [F14] | 20 |
| Adjunto | `users.messages.attachments.get` | 20 |

Flujo:

1. **Al conectar**: `getProfile` → guardar `historyId` como punto de partida. No se procesa el correo antiguo
   (decisión de diseño: evita responder a correos de hace meses).
2. **En cada tick**: `history.list` con `startHistoryId` guardado. Parámetros [F13]: `startHistoryId`
   (obligatorio), `historyTypes[]` (`messageAdded`, `messageDeleted`, `labelAdded`, `labelRemoved`),
   `labelId` (un solo label), `maxResults` (por defecto 100, máx. 500), `pageToken`. Respuesta: `history[]`,
   `nextPageToken` e `historyId` actual, que se guarda al terminar todas las páginas.
3. **Si devuelve 404** (`startHistoryId` fuera de rango): sincronización completa [F12][F13]. El historial
   suele durar al menos una semana, pero puede ser de solo unas horas [F13]. Sincronización completa =
   `messages.list` con `labelIds=INBOX` y `q` acotado en el tiempo (sintaxis de búsqueda de Gmail; p. ej. los
   últimos 1–2 días, decisión de diseño), deduplicando por id, y nuevo `historyId` desde `getProfile`.
4. **Para cada mensaje nuevo**: `messages.get` con `format`:
   - `raw`: mensaje completo en `raw` (base64url), sin `payload` [F14]. **Recomendado**: se parsea con
     mailparser igual que en IMAP, así hay un único preprocesado.
   - `full`: cuerpo ya troceado en `payload`, sin `raw`.
   - `metadata`: solo id, etiquetas y cabeceras (con `metadataHeaders[]` para filtrar cuáles).
   - `minimal`: solo id y etiquetas.

   Como `messages.get` cuesta 20 unidades con cualquier formato [F11], lo más barato sería pedir `raw` directamente.
   Decisión de diseño (revisión de seguridad, 2026-09-27): primero `metadata` (tamaño `sizeEstimate` y cabeceras) y
   `raw` solo si no pasa de 40 MB. Cuesta el doble, pero un correo enorme nunca se descarga entero: se guarda con sus
   cabeceras ([COR-19]).

Decisión de diseño sobre `labelId`: `history.list` solo admite **un** `labelId`. Filtrar por `INBOX` pierde
los mensajes enviados desde Gmail por una persona (necesarios para «humano en el hilo», spec §6.3). Se
recomienda una sola llamada **sin** `labelId`, con `historyTypes=messageAdded` (y `labelAdded` para correos
que llegan a INBOX al sacarlos de spam), y clasificar por las `labelIds` de cada mensaje: `INBOX` → entrante;
`SENT` sin nuestra cabecera propia → respuesta humana; `SPAM`/`TRASH` → ignorar. Mismo coste (2 unidades).

**Cuotas por usuario** [F11] (actualizado 2026-09-10): 6.000 unidades/minuto por usuario y proyecto;
1.200.000/minuto por proyecto. Nuevo: umbral diario de **80.000.000 unidades por proyecto** por debajo del
cual no hay cargo; Google dará detalles de facturación «later in 2026» con 90 días de aviso [F11]. Un buzón
sondeado cada 15 s gasta ~8 unidades/minuto en `history.list`: muy lejos del límite.

### 1.5 Envío, borradores y etiqueta

**Envío** [F17]: `POST /users/me/messages/send` con un recurso `Message` cuyo `raw` es el mensaje MIME
RFC 2822 codificado en **base64url**, y `threadId`. Para archivos grandes existe
`POST https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send`. Tamaño máximo: **no verificado**
(la referencia remite a cada método) [F17]. Scopes que lo permiten: `mail.google.com`, `gmail.modify`,
`gmail.compose`, `gmail.send`. Coste: 100 unidades.

Para que la respuesta quede en el mismo hilo, **las tres condiciones** [F18]:

1. `threadId` del hilo en el `Message` (o en `draft.message`);
2. `In-Reply-To` y `References` conforme a RFC 2822 (ver §4.2);
3. `Subject` coincidente.

Que el prefijo «Re: » cuente como asunto coincidente es práctica habitual, pero la documentación solo dice que
deben coincidir: **no verificado**, cubrirlo con una prueba.

El mensaje se construye con MailComposer de Nodemailer (§3.3): el mismo constructor sirve para Gmail API,
SMTP y `APPEND` IMAP. Gmail pone la etiqueta `SENT` automáticamente a lo enviado con `messages.send` y
`drafts.send` [F20].

**Modo borrador** (por defecto, spec §6.3) [F19]: `drafts.create` (`POST /users/me/drafts`, 10 unidades) con
`message.raw` y `message.threadId` → el borrador aparece dentro del hilo en Gmail. Si una persona lo edita en
la bandeja, `drafts.update` **sustituye** el mensaje entero (los mensajes no se modifican; se destruye y se
crea otro) [F19]. Al aprobarlo, `drafts.send` (100 unidades). Si la persona lo envía desde el propio Gmail, se
detecta por `history.list` (mensaje nuevo con `SENT` y nuestra cabecera propia) y se marca como enviado
(decisión de diseño).

**Etiqueta «IA/Respondido»** [F20]:

- `labels.list` (1 unidad) para buscarla; si no existe, `labels.create` (5 unidades; scopes `gmail.modify`,
  `gmail.labels` o `mail.google.com`). Guardar el `id` de la etiqueta en la config del canal.
- `messages.modify` (5 unidades) con `addLabelIds` sobre el **mensaje entrante** respondido (hasta 100
  etiquetas por llamada). No se pueden poner etiquetas a borradores [F20].
- Crear una etiqueta con nombre reservado da `400 Invalid label name` [F20]. Límite: 10.000 etiquetas por
  buzón.
- Anidado con «/»: la API no lo documenta [F20]. Recomendación: crear primero «IA» y luego «IA/Respondido»
  (**no verificado** que haga falta).

**Límites de envío**: cuenta personal de Gmail, 500 correos/día y 500 destinatarios por correo; al superarlo
se bloquea entre 1 y 24 h [F22]. Workspace: 2.000 mensajes/día por usuario (500 en prueba) y 500
destinatarios por mensaje vía API [F23]. La API limita a 500 destinatarios por mensaje [F11].

### 1.6 Errores de la API de Gmail [F21]

| Código | Significado | Acción |
|---|---|---|
| 401 | Credenciales inválidas | Refrescar el access token; si el refresh falla con `invalid_grant` → «Requiere reconexión» |
| 403 `dailyLimitExceeded` / `userRateLimitExceeded` / `rateLimitExceeded` | Cuota | Reintento con espera exponencial (≥1 s) |
| 403 `domainPolicy` | El admin de Workspace desactivó el acceso de apps a Gmail | Estado `error`, aviso al admin del negocio |
| 404 en `history.list` | `historyId` caducado | Sincronización completa (§1.4) |
| 429 | Límite de envío diario, ancho de banda o peticiones concurrentes por usuario | Espera exponencial; no reintentar envíos en bucle |
| 500/502/503/504 | Error del servidor | Espera exponencial |

Lotes: no más de 50 peticiones por batch [F21].

---

## 2. Outlook / Microsoft 365 (Microsoft Graph + OAuth con app propia de Entra)

### 2.1 Registro de la app en Microsoft Entra

- **Dónde**: en el tenant del propio negocio. La advertencia de «editor no verificado» y el bloqueo de
  consentimiento por riesgo solo afectan a usuarios de **otros** tenants distintos del de la app [F34]; con una
  app de un solo tenant (tenant ID del negocio) no aplica.
- **Tipos de cuenta** [F30][F33]: el `{tenant}` de las URL admite `common` (trabajo/escuela y personales),
  `organizations` (solo trabajo/escuela), `consumers` (solo personales) o el ID/dominio del tenant. Para
  Microsoft 365 del negocio: tenant ID. Para buzones personales (outlook.com, hotmail.com): la app debe
  admitir cuentas personales y usar `common` o `consumers`.
- **Cuentas personales sin tenant**: el registro de apps ya no se permite en el tenant de «Microsoft Services»
  de las cuentas personales; hay que crear un tenant de Entra propio. Fuente: Microsoft Q&A, **no
  documentación oficial** [F56].
- **URI de redirección** tipo «Web»: `https://{dominio}/api/oauth/microsoft/callback` (decisión de diseño).
  Debe coincidir exactamente con la registrada [F30].
- **Secreto de cliente**: vida máxima **24 meses**; Microsoft recomienda menos de 12 [F35]. Pedir y guardar la
  fecha de caducidad en el asistente para avisar antes. Caducado → `AADSTS7000222` [F36].

### 2.2 Flujo OAuth 2.0 (código de autorización, identity platform v2)

| Paso | Endpoint | Detalle |
|---|---|---|
| Autorizar | `GET https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize` [F30] | `client_id`, `response_type=code`, `redirect_uri`, `response_mode=query`, `scope`, `state`; `prompt` (`login`, `none`, `consent`, `select_account`); `login_hint`, `domain_hint`; PKCE `code_challenge` + `code_challenge_method=S256` (recomendado para todo tipo de app) |
| Canjear código | `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` [F30] | `client_id`, `scope`, `code`, `redirect_uri`, `grant_type=authorization_code`, `code_verifier`, `client_secret` (URL-encoded) |
| Refrescar | mismo endpoint [F30] | `client_id`, `grant_type=refresh_token`, `refresh_token`, `scope` (igual o subconjunto), `client_secret` |
| Consentimiento de administrador | `GET https://login.microsoftonline.com/{tenant}/v2.0/adminconsent` [F31] | `client_id`, `scope`, `redirect_uri`, `state` |

- **Scopes** (delegados): `offline_access`, `User.Read`, `Mail.ReadWrite`, `Mail.Send`. Ninguno exige
  consentimiento de administrador por defecto (`AdminConsentRequired: No`), y `Mail.ReadWrite`, `Mail.Send` y
  `User.Read` constan como disponibles para cuentas personales [F37]. `openid`/`profile`/`email` son opcionales: solo hacen falta si se quiere `id_token` [F30];
  `GET /me` ya da la identidad. En el parámetro se recomiendan los URI completos
  (`https://graph.microsoft.com/Mail.ReadWrite`), como en los ejemplos oficiales [F30].
- El **código** caduca en ~1 minuto [F30]: canjearlo en el callback, nunca en un job.
- **Respuesta del token** [F30]: `access_token`, `token_type=Bearer`, `expires_in`, `scope` (scopes para los que
  vale el token; comprobarlo igual que en Google), `refresh_token` (**solo si se pidió `offline_access`**),
  `id_token` (solo con `openid`).
- **Refresh token**: se reemplaza a sí mismo en cada uso; hay que guardar siempre el nuevo y descartar el
  anterior [F30][F32]. Vida por defecto **90 días** (24 h solo para SPA) [F32]; caduca por inactividad
  (`AADSTS700082`) [F36]. Un cliente confidencial no pierde el token si el usuario cambia su contraseña, pero
  sí si un admin la restablece desde el centro de administración de Entra/M365 o revoca sus sesiones [F32].
- **Consentimiento de administrador** [F31]: usar el tenant ID (o `organizations`), **nunca `common`**. Con
  `scope=https://graph.microsoft.com/.default` se piden todos los permisos configurados en la app. Éxito:
  vuelve a la URI con `admin_consent=True`, `tenant`, `scope` y `state`; error: `error` y
  `error_description`. El `tenant` devuelto no sirve para autenticar a nadie [F31]. Mostrar este enlace solo si
  el login falla por falta de consentimiento (`AADSTS65001`) o el tenant bloquea el consentimiento de usuario.
- **Revocación**: no se ha encontrado un endpoint de revocación de refresh tokens equivalente al de Google
  (**no verificado**). «Desconectar» = borrar los tokens cifrados; el negocio puede retirar la app desde su
  cuenta o desde Entra.

### 2.3 Recepción: consulta delta de la bandeja

1. **Identidad**: `GET /me` (base `https://graph.microsoft.com/v1.0`) devuelve por defecto `id`,
   `displayName`, `mail`, `userPrincipalName`, entre otros [F50b].
2. **Ronda inicial**: `GET /me/mailFolders/inbox/messages/delta` [F38]. `inbox` es un nombre conocido que
   funciona en cualquier idioma del buzón (también `sentitems`, `drafts`, `junkemail`) [F49]. Parámetros:
   - `$select` con solo lo necesario (el `id` siempre viene) [F38];
   - `changeType=created` para recibir solo altas en rondas siguientes [F38][F39];
   - `$filter` solo admite `receivedDateTime ge|gt {valor}`, y con filtro devuelve como máximo 5.000
     mensajes [F39]. Decisión de diseño: filtrar desde el momento de la conexión para no procesar lo antiguo;
   - `$orderby` solo `receivedDateTime desc`; `$search` no se admite [F38];
   - cabeceras `Prefer: odata.maxpagesize={n}` [F38] y `Prefer: IdType="ImmutableId"` (ids que no cambian al
     mover el mensaje de carpeta; compatible con los `deltaLink` existentes) [F45].
3. **Paginación**: seguir `@odata.nextLink` hasta recibir `@odata.deltaLink`; una página nunca trae los dos
   [F40]. Los parámetros van codificados en los enlaces: no repetirlos [F38][F40]. Guardar el `deltaLink`.
4. **En cada tick**: `GET {deltaLink}` guardado.
5. **Entradas raras**: `@removed` con `reason: deleted` (borrado o movido) y cambios de leído/no leído llegan
   aunque no encajen con el filtro [F38]; ignorarlas. Puede haber repeticiones («replays») y el mismo elemento
   varias veces [F40]: deduplicar por id (único `channel_id`+`external_id`).
6. **Resincronización**: `410 Gone` con cabecera `Location` → volver a sincronizar desde cero [F40]. Los tokens
   delta de Outlook no tienen caducidad fija (dependen de una caché interna); si caducan, error 40X con código
   tipo `syncStateNotFound` → misma acción [F40].
7. **Delta es por carpeta** [F39]: para «humano en el hilo» hace falta una segunda consulta delta sobre
   `sentitems` (decisión de diseño).
8. **Tamaño antes de leer**: el recurso `message` no trae su tamaño; se pide la propiedad extendida
   `PR_MESSAGE_SIZE` (`PidTagMessageSize`, 0x0E08, entero de 32 bits) con
   `GET /me/messages/{id}?$select=id&$expand=singleValueExtendedProperties($filter=id eq 'Integer 0x0E08')`. Por encima
   de 40 MB solo se leen sus cabeceras (`$select=internetMessageHeaders`); sin tamaño, la lectura del MIME se corta al
   pasar de ese límite (decisión de diseño, revisión de seguridad 2026-09-27, [COR-19]).
9. **Detalle de cada mensaje nuevo**: `GET /me/messages/{id}` con
   `$select=internetMessageHeaders,uniqueBody,...` y `Prefer: outlook.body-content-type="text"` [F44][F46].
   - `internetMessageHeaders` solo se devuelve si se pide en `$select` [F44].
   - `uniqueBody`: la parte del cuerpo propia de ese mensaje, sin el historial citado [F44]. Es la mejor fuente
     para quitar citas en Outlook.
   - Por defecto el HTML se sanea; `Prefer: outlook.allow-unsafe-html` da el original [F46]. Usar el saneado.
   - Alternativa uniforme: `GET /me/messages/{id}/$value` devuelve el MIME completo [F50] para parsearlo con
     mailparser como en IMAP.
   - Adjuntos: `GET /me/messages/{id}/attachments/{id}` y `/$value` para el contenido en bruto [F50].

### 2.4 Envío, borradores e hilo

| Operación | Endpoint | Permiso mínimo | Respuesta |
|---|---|---|---|
| Responder en un paso | `POST /me/messages/{id}/reply` [F41] | `Mail.Send` | `202 Accepted`, **sin cuerpo** |
| Crear borrador de respuesta | `POST /me/messages/{id}/createReply` [F42] | `Mail.ReadWrite` | `201 Created` con el `message` borrador (`isDraft: true`) |
| Editar borrador | `PATCH /me/messages/{id}` [F46] | `Mail.ReadWrite` | mensaje actualizado |
| Enviar borrador | `POST /me/messages/{id}/send` (`Content-Length: 0`) [F43] | `Mail.Send` | `202 Accepted` |

- `reply` y `createReply` en JSON aceptan `comment` **o** `message.body`; los dos a la vez → `400` [F41][F42].
  Si el original tiene `replyTo`, la respuesta debe ir a esos destinatarios y no al `from` [F41]. Decisión de diseño
  ([COR-25]): la app responde solo al `from` (el Reply-To lo escribe quien envía), así que el `PATCH` del borrador fija
  `toRecipients` con ese único destinatario (en un borrador se pueden cambiar [F46]).
- Lo enviado con `reply` o `send` se guarda en **Elementos enviados**; los borradores, en **Borradores**
  [F41][F43][F46].
- El hilo lo mantiene Exchange: la respuesta comparte `conversationId` («The ID of the conversation the email
  belongs to») [F44]. Que Exchange rellene `In-Reply-To`/`References` en `reply`/`createReply` es lo esperable
  pero **no verificado** en la documentación.
- Decisión de diseño: usar **siempre** `createReply` → `PATCH` → `send`, también en modo automático, porque
  `reply` no devuelve nada y no deja localizar el enviado. Con `Prefer: IdType="ImmutableId"` el id del
  borrador sirve después para leer la copia de Elementos enviados (puede tardar en aparecer) [F45]. En modo
  borrador, el borrador de `createReply` es el que ve el negocio en Outlook.
- **Cabeceras propias**: Graph solo deja añadir cabeceras que empiecen por `x-`, **solo al crear** el mensaje,
  y no se pueden cambiar después [F44]. Consecuencias:
  - una cabecera `X-DominIA-…` se puede poner al crear (sendMail o crear mensaje) [F51]; ponerla en
    `createReply` vía `message.internetMessageHeaders` en JSON: **no verificado**;
  - `Auto-Submitted` **no** empieza por `x-`: no se puede poner en JSON. La única vía posible es la variante
    MIME de `createReply`/`reply` (cuerpo MIME en base64 con `Content-Type: text/plain`) [F41][F42]; que
    Exchange conserve `Auto-Submitted` al enviar: **no verificado**, requiere prueba real.
  - Decisión de diseño ([COR-18]): primero `createReply` en JSON con la cabecera; si Graph la rechaza (400), la misma
    respuesta se crea por la vía MIME (nuestro mensaje entero, con sus cabeceras, el texto, el adjunto y las cabeceras
    de hilo) y después solo se fija el destinatario. Si tampoco la acepta, no se envía: todo lo que sale lleva la marca.
- **Límites** [F44][F48]: 500 destinatarios por mensaje; por app y buzón, 10.000 peticiones cada 10 minutos,
  4 peticiones concurrentes y 150 MB de subida cada 5 minutos.

### 2.5 Errores

| Situación | Señal | Acción |
|---|---|---|
| Access token caducado | `401` de Graph | Refrescar y reintentar una vez |
| Refresh revocado o caducado | `invalid_grant` en `/token`; p. ej. `AADSTS50173` (revocado / cambio de contraseña), `AADSTS700082` o `AADSTS70008` (inactividad) [F30][F36] | Estado «Requiere reconexión» |
| Falta consentimiento | `AADSTS65001` [F36]; `consent_required` [F30] | Reconectar; si el tenant lo exige, enlace de consentimiento de admin |
| MFA o acceso condicional | `interaction_required`; p. ej. `AADSTS50076` [F30][F36] | «Requiere reconexión» |
| Secreto caducado o incorrecto | `invalid_client`; `AADSTS7000222` / `AADSTS7000215` [F30][F36] | Aviso «Secreto de cliente caducado o incorrecto» en el panel del canal |
| Sin permiso | `403` | Estado `error` con el permiso que falta (comprobar `scope` guardado) |
| Limitación | `429 Too Many Requests` con `Retry-After` (segundos) [F47] | Esperar exactamente `Retry-After`; si no viene, espera exponencial. En lotes JSON, cada petición se limita por separado [F47] |

### 2.6 Autenticación con contraseña en Microsoft (estado a 2026-09-26)

- **Exchange Online** (Microsoft 365): la autenticación básica está desactivada en todos los tenants para
  POP, IMAP, EAS, EWS, PowerShell remoto, etc., y ya no se puede reactivar [F52] (página actualizada
  2026-07-10). Esto también inutiliza las contraseñas de aplicación en esas apps [F52].
- **SMTP AUTH** en Exchange Online, calendario publicado el **27-01-2026** [F53]:
  - hasta diciembre de 2026, sin cambios;
  - **finales de diciembre de 2026**: desactivado por defecto en los tenants existentes; el admin puede volver
    a activarlo;
  - tenants creados después de diciembre de 2026: no disponible por defecto; OAuth como método soportado;
  - segunda mitad de 2027: Microsoft anunciará la fecha de retirada definitiva.
- **Outlook.com / Hotmail / Live** (cuentas personales): sin autenticación básica desde el **16-09-2024**
  [F54]; IMAP (`outlook.office365.com:993`) y SMTP (`smtp-mail.outlook.com:587`) solo con OAuth2 [F55].

Conclusión: en «Otro (IMAP/SMTP)», los dominios de Microsoft y los buzones de Microsoft 365 deben redirigir a la
opción «Outlook / Microsoft 365».

---

## 3. Otro (IMAP/SMTP)

### 3.1 Datos de servidor por proveedor (autocompletado por dominio)

Comprobado en la ayuda oficial de cada proveedor. «SSL/TLS» = TLS implícito desde el principio; «STARTTLS» =
conexión que se cifra tras conectar.

| Proveedor (dominios) | IMAP | SMTP | Requisitos | Fuente |
|---|---|---|---|---|
| Gmail (gmail.com; googlemail.com es el mismo servicio, **no verificado** en fuente) | `imap.gmail.com` 993 SSL/TLS | `smtp.gmail.com` 465 SSL/TLS o 587 STARTTLS | Contraseña de aplicación de 16 caracteres; exige verificación en dos pasos; no disponible con solo llaves de seguridad, Protección Avanzada o algunas cuentas de trabajo; se revocan al cambiar la contraseña. IMAP siempre activo desde enero de 2025. Guarda lo enviado por SMTP en Enviados | [F24][F25][F26][F27] |
| Google Workspace (dominio propio) | igual que Gmail | igual que Gmail | Desde el **14-03-2025** IMAP/SMTP/POP no funcionan con la contraseña normal, **salvo contraseñas de aplicación** | [F28] |
| Yahoo Mail (yahoo.com, yahoo.es…; lista de dominios **no verificada**) | `imap.mail.yahoo.com` 993 SSL | `smtp.mail.yahoo.com` 465 o 587, SSL | Contraseña de aplicación | [F60] |
| iCloud (icloud.com; me.com y mac.com **no verificados** en la página) | `imap.mail.me.com` 993 SSL | `smtp.mail.me.com` 587 (SSL, o TLS/STARTTLS si falla) | Contraseña específica de app. Usuario IMAP: nombre sin dominio (o completo si falla); usuario SMTP: dirección completa. Sin POP | [F61] |
| Zoho personal (zohomail.com) | `imap.zoho.com` 993 SSL | `smtp.zoho.com` 465 SSL o 587 TLS | Activar IMAP en el webmail. **Plan gratuito nuevo: sin IMAP** (solo de pago). Con 2FA, contraseña específica. El host exacto depende del centro de datos: verlo en Ajustes | [F62] |
| Zoho organización (dominio propio) | `imappro.zoho.com` 993 SSL | `smtppro.zoho.com` 465 SSL o 587 TLS | Igual que el anterior | [F62] |
| IONOS España (1&1) | `imap.ionos.es` 993 SSL/TLS | `smtp.ionos.es` 465 SSL/TLS | Contraseña del buzón | [F63] |
| IONOS (genérico, .com) | `imap.ionos.com` 993 SSL/TLS | `smtp.ionos.com` 465 SSL/TLS o 587 STARTTLS | Contraseña del buzón | [F64] |
| Hostinger | `imap.hostinger.com` 993 SSL | `smtp.hostinger.com` 465 SSL; alternativa 587 TLS/STARTTLS | Dirección completa y contraseña del buzón | [F65] |
| OVHcloud MX Plan | `imap.mail.ovh.net` o `ssl0.ovh.net` 993 SSL/TLS | `smtp.mail.ovh.net` o `ssl0.ovh.net` 465 SSL/TLS (587 STARTTLS: **no verificado** en la guía general) | Dirección completa. Email Pro, Exchange y Zimbra de OVH usan otros servidores | [F66] |
| STRATO (también España; servidores `.de`) | `imap.strato.de` 993 SSL/TLS | `smtp.strato.de` 465 SSL/TLS | 587 es **solo** para relay de servidores; sin CRAM-MD5; TLS 1.2/1.3 | [F67] |
| GMX Alemania (gmx.net, gmx.de) | `imap.gmx.net` 993 SSL (o 143 STARTTLS) | `mail.gmx.net` 587 STARTTLS (o 465 SSL) | Activar POP3/IMAP en ajustes; mínimo TLS 1.2 | [F68] |
| GMX internacional (gmx.com; gmx.es **no verificado**) | `imap.gmx.com` 993 SSL | `mail.gmx.com` 587 STARTTLS o 465 SSL/TLS | Desactivado por defecto; se desactiva solo tras mucho tiempo sin uso | [F69] |
| cPanel genérico | `mail.{dominio}` 993 SSL | `mail.{dominio}` 465 SSL | Usuario = dirección completa. Si el certificado no cubre el dominio, cPanel indica el nombre del servidor en «Connect Devices». Sin SSL (143/110/587): no recomendado | [F70] |
| Outlook.com, Hotmail, Live, MSN | `outlook.office365.com` 993 | `smtp-mail.outlook.com` 587 STARTTLS | **Solo OAuth2**: con contraseña no funciona → opción «Outlook» | [F55] |

Notas:

- Detectar el proveedor de un dominio propio por sus registros MX (Google, Microsoft 365, IONOS, OVH…) es
  útil para autocompletar, pero los patrones de MX **no se han verificado**: tratarlo como sugerencia editable.
- Nodemailer trae una lista de servicios SMTP conocidos (`well-known/services.json`) [F72]; solo cubre SMTP, no
  IMAP, así que no sustituye a esta tabla.

### 3.2 ImapFlow (lectura)

Versión: la última estable es 2.0.7 (25-09-2026); respetando el margen de 7 días de `docs/security.md`, la
instalable hoy es **2.0.5** (15-09-2026). La 2.0.0 (07-09-2026) exige **Node.js 20+**, pasa a TypeScript con
builds ESM y CommonJS y deja de publicar `lib/` [F71b].

- **Conexión** [F71]: `host`, `port` (993 por defecto con `secure: true`, si no 143), `secure` (TLS directo),
  `doSTARTTLS` (forzar STARTTLS), `auth` con `user` + `pass` o `accessToken` (OAuth; ImapFlow no renueva
  tokens), `logger: false` o un logger propio (nunca volcar credenciales), `connectionTimeout`,
  `socketTimeout`. Con `verifyOnly` se conecta y desconecta: útil para «Probar conexión».
- Escuchar siempre `error` y `close`; **ImapFlow no se reconecta solo** [F71].
- **Por tick** (decisión de diseño sobre la API documentada):
  1. `connect` → `getMailboxLock('INBOX')` (preferible a `mailboxOpen` por seguridad transaccional) [F71];
  2. leer `client.mailbox.uidValidity` y `uidNext` [F71];
  3. si `uidValidity` cambió, los UID guardados ya no valen [F71][F81]: no reprocesar todo; tomar
     `uidNext - 1` como nuevo último UID y, como mucho, recuperar lo reciente con `search({ since })`;
  4. `fetch('{últimoUID+1}:*', { uid, envelope, flags, internalDate, size, source }, { uid: true })` [F71].
     Por norma IMAP, un rango `N:*` **siempre incluye el último mensaje** aunque N sea mayor que cualquier UID
     [F81]: descartar los resultados con UID ≤ último guardado;
  5. no lanzar otros comandos IMAP dentro del bucle de `fetch` (bloqueo) [F71];
  6. guardar el UID máximo procesado, `release()` del lock y `logout()`.
- **Carpetas por SPECIAL-USE** [F71][F82]: `list()` devuelve `specialUse` (`\Sent`, `\Drafts`, `\Junk`,
  `\Trash`, `\Archive`, `\All`). Si el servidor no anuncia SPECIAL-USE, buscar por nombres habituales («Sent»,
  «Sent Items», «Enviados», «INBOX.Sent»…) y dejar elegir en la UI (decisión de diseño).
- **Copia en Enviados**: Gmail la hace sola al enviar por SMTP [F25]. Para el resto, decisión de diseño: tras
  enviar, buscar en `\Sent` por cabecera `Message-ID` (`search({ header: { 'message-id': … } })`) [F71] y, si
  no está, `append(ruta, mensaje, ['\\Seen'])` [F71]. Así no se duplica en servidores que sí la guardan.
- **Modo borrador en IMAP** (decisión de diseño): `append` a `\Drafts` con la marca `\Draft` para que el
  borrador se vea en el cliente de correo del negocio; al aprobar, enviar por SMTP, borrar el borrador y
  copiar a Enviados.
- **«IA/Respondido» en IMAP**: palabra clave con `messageFlagsAdd` [F71], solo si `permanentFlags` del buzón
  admite palabras clave (decisión de diseño).
- **IDLE** (solo en el worker del VPS): ImapFlow entra en IDLE automáticamente con un buzón seleccionado
  (`disableAutoIdle` para evitarlo, `maxIdleTime` para reiniciarlo) y emite `exists` al llegar correo [F71].
  En Vercel no sirve (conexiones cortas): allí, sondeo por tick.

### 3.3 Nodemailer (envío SMTP y construcción de mensajes)

Versión: 10.0.10 (14-09-2026), dentro del margen de 7 días. La 10.0.0 exige **Node.js 20+**; la 9.0.0 valida
por defecto los certificados TLS al descargar contenido remoto [F72b].

- **Transporte SMTP** [F72]: `port: 465` + `secure: true` (TLS desde el inicio); `port: 587` + `secure: false`
  (sube a TLS con STARTTLS). Añadir `requireTLS: true` en 587 para fallar si no hay STARTTLS, en vez de enviar
  sin cifrar. `transporter.verify()` comprueba que el servidor acepta la conexión y está listo para recibir
  mensajes: es la base del botón «Probar conexión» (que también valide el usuario y la contraseña es lo
  esperable, pero la documentación no lo dice: **no verificado**, cubrirlo con una prueba).
- **Construir el mensaje una sola vez** con MailComposer (`compile().build()` → Buffer RFC 822) [F72] y usarlo
  para SMTP, para `raw` de Gmail (en base64url) y para `APPEND` IMAP.
- Campos que importan [F72]: `messageId` propio (para localizar el enviado después), `inReplyTo`,
  `references`, `headers` (cabeceras propias; Nodemailer normaliza `x-mi-clave` a `X-Mi-Clave`).
- Seguridad: el texto lo genera la IA a partir de correos de terceros. Activar `disableFileAccess` y
  `disableUrlAccess` para que ningún adjunto o parte del mensaje pueda leer archivos del servidor ni descargar
  URL [F72].

---

## 4. Qué se ignora y qué llevan nuestras respuestas

### 4.1 Señales para no responder

| Señal | Base | Acción |
|---|---|---|
| `Auto-Submitted` con valor distinto de `no` | RFC 3834: las respuestas automáticas SHOULD NOT enviarse [F80] | Ignorar |
| `Return-Path: <>` (remitente nulo) | RFC 3834: **MUST NOT** responder [F80] | Ignorar |
| Remitente `MAILER-DAEMON`, `owner-*`, `*-request`, `postmaster`, `noreply`/`no-reply`/`donotreply` | RFC 3834 permite rechazar los tres primeros [F80]; el resto es decisión de diseño | Ignorar |
| `Precedence: bulk`, `list` o `junk` | Cabecera no estándar; RFC 3834 permite ignorarla y no recomienda nada concreto [F80] | Ignorar |
| `List-Id` [F85], `List-Unsubscribe` [F84], `List-Unsubscribe-Post` [F86] o cualquier `List-*` | RFC 3834 permite ignorar mensajes con `List-*` [F80] | Ignorar |
| `X-Auto-Response-Suppress` con `All`, `AutoReply` u `OOF` | Cabecera de Microsoft: pide suprimir respuestas automáticas [F87] | Ignorar (interpretación nuestra) |
| Mensajes propios: `From` = buzón del canal, o con nuestra cabecera `X-` | — | No responder; si `From` es el buzón y no lleva nuestra cabecera → «humano en el hilo» |
| Gmail: etiqueta `SPAM` o `TRASH` | [F20] | Ignorar |
| Gmail: `CATEGORY_PROMOTIONS` | [F20] | Ignorar |
| Gmail: `CATEGORY_SOCIAL`, `CATEGORY_UPDATES`, `CATEGORY_FORUMS` | [F20] | Solo como señal junto a las cabeceras: «Updates» incluye avisos legítimos. Si las categorías llegan con las pestañas desactivadas: **no verificado** |
| Outlook: carpeta `junkemail` | [F49] | No se consulta (el delta es solo de `inbox`) |
| Outlook: `inferenceClassification = other` | Solo «focused»/«other» por relevancia [F44] | **No** equivale a promociones: usar como señal, nunca como filtro único |
| IMAP: carpeta `\Junk` | [F82] | No se consulta |

Además, RFC 3834 recomienda no repetir la misma respuesta al mismo remitente en varios días (7 por defecto)
para respondedores personales [F80]. Nuestro tope diario por hilo y remitente (spec §6.3) cumple ese fin.

### 4.2 Cabeceras de lo que enviamos

- `In-Reply-To`: el `Message-ID` del mensaje al que se responde. `References`: los `References` del original
  seguidos de su `Message-ID` (RFC 5322 §3.6.4; RFC 3834 §3.1.6) [F80][F83].
- `Subject`: el mismo del hilo (con «Re: »). **No** usar el prefijo «Auto:»: RFC 3834 lo deja como opcional
  [F80] y rompería la coincidencia de asunto que Gmail exige para el hilo [F18].
- `Auto-Submitted: auto-replied` en las respuestas **automáticas** (RFC 3834 §3.1.7: SHOULD) [F80]. RFC 3834
  §5.2 dice que `auto-replied` **no debe** usarse en mensajes generados manualmente [F80]: en modo «Borrador
  para revisar», cuando una persona aprueba o edita, lo coherente es no ponerla (ver correcciones).
- Cabecera propia, p. ej. `X-DominIA-Agentes: <versión>` (nombre por decidir): siempre con prefijo `X-`
  para que Graph la acepte [F44]. Sirve para reconocer lo nuestro al volver por `history.list`, delta de
  `sentitems` o IMAP.
- Opcional: `X-Auto-Response-Suppress: OOF, AutoReply` para que los buzones de Exchange/Outlook no contesten
  con «fuera de la oficina» [F87]. No usar `All`: también suprime los avisos de no entrega, que nos sirven para
  detectar fallos.
- En Outlook, ver las limitaciones de §2.4: `Auto-Submitted` solo es posible por la vía MIME, sin verificar.

### 4.3 Remitente verificado ([COR-25])

- El `From` lo escribe quien envía. El servidor que recibe el correo (Gmail, Exchange Online y la mayoría de los
  servidores IMAP) comprueba SPF, DKIM y DMARC y lo anota en una cabecera `Authentication-Results` (RFC 8601) que
  añade **encima** del mensaje; las que hay más abajo ya venían en el correo y las puede escribir cualquiera. Solo se lee
  la de más arriba. Gmail escribe `mx.google.com; dkim=pass header.i=@dominio; spf=pass smtp.mailfrom=…; dmarc=pass
  (p=…) header.from=dominio`; Microsoft la escribe sin identificador del servidor (`spf=pass (sender IP is …)
  smtp.mailfrom=dominio; dkim=pass … header.d=dominio;dmarc=pass action=none header.from=dominio;compauth=pass`).
- Verificado: `dmarc=pass` para el dominio del `From`; sin resultado de DMARC (o `dmarc=none`, el dominio no publica
  política), `dkim=pass` o `spf=pass` de un dominio alineado con el del `From` (el mismo, o uno dentro del otro). Más de
  un `From`, ninguna cabecera o cualquier otro resultado: no verificado.
- Con «Otro (IMAP/SMTP)» depende de que el servidor del buzón añada esa cabecera: si no la añadiera, la de más arriba
  sería la del remitente. Conviene mirarlo en un correo recibido.

---

## 5. Parseo y preprocesado (mailparser)

mailparser es del proyecto Nodemailer. Versión 3.9.28 (15-09-2026); depende de `html-to-text`, `iconv-lite`,
`libmime` y `nodemailer` [F73b].

- `simpleParser` devuelve [F73]: `headers` (Map con claves en minúsculas; `from`/`to` como objetos de
  dirección, fechas como `Date`, `references` como array y las `List-*` agrupadas en un objeto `list`),
  `subject`, `from`, `to`, `cc`, `date`, `messageId`, `inReplyTo`, `text`, `html`, `textAsHtml` y
  `attachments` (con `filename`, `contentType`, `size`, `checksum` y `content` como Buffer).
- `simpleParser` guarda todo el mensaje, adjuntos incluidos, en memoria [F73]. Decisión de diseño: comprobar el
  tamaño antes de descargar (`size` en IMAP, `sizeEstimate` en Gmail, `PR_MESSAGE_SIZE` en Outlook, §2.3) y rechazar o
  truncar por encima del límite configurado.
- **Charsets**: los decodifica con `iconv-lite`; la opción `Iconv` añade juegos de caracteres extra [F73].
- **HTML a texto**: si solo hay HTML, `text` se genera con html-to-text salvo `skipHtmlToText`;
  `maxHtmlLengthToParse` limita el trabajo con HTML enorme [F73].
- **Citas** (heurística, decisión de diseño; no hay librería oficial):
  - Outlook: usar `uniqueBody` de Graph [F44];
  - resto: cortar en la primera línea de encabezado de cita («El … escribió:», «On … wrote:»,
    «-----Mensaje original-----», «-----Original Message-----», bloque «De: … Enviado: …») y en bloques con
    `>`; en HTML, los contenedores de cita de Gmail, Outlook y Apple (`blockquote`). Selectores concretos:
    **no verificados**.
- **Firmas** (heurística): cortar en la línea separadora `-- ` (convención recogida en RFC 3676 §4.3) [F88];
  el resto de fórmulas de despedida, con prudencia. Si la heurística duda, conservar el texto.
- Se guarda siempre el original completo; el recorte solo afecta a lo que se da al modelo.
- **Adjuntos**: PDF e imágenes al modelo, audios a transcripción; las imágenes en línea (`cid:`) de firmas se
  descartan por tamaño o tipo (decisión de diseño).
- **Seguridad**: el correo entrante es dato, no instrucciones (AGENTS.md). El texto que llega al modelo va
  marcado como contenido del cliente.

---

## 6. Estado que guarda cada canal

Sin secretos en `config`; tokens y contraseñas en `secrets_enc` (spec §4).

- **Gmail**: `emailAddress`, `sub`, scopes concedidos, `historyId`, id de la etiqueta «IA/Respondido»,
  caducidad del acceso por tiempo si la hay.
- **Outlook**: `id` y `mail` del usuario, tenant, scopes concedidos, `deltaLink` de `inbox` y de `sentitems`,
  fecha de caducidad del secreto de cliente.
- **IMAP/SMTP**: hosts, puertos y seguridad; rutas SPECIAL-USE; por carpeta, `uidValidity` y último UID; si
  el servidor guarda solo lo enviado.

---

## 7. Correcciones y matices a la especificación original

1. «Gmail External en producción sin verificar, máximo 100 usuarios»: correcto, con matices. `gmail.modify` es
   **restringido**; sin verificar funciona con aviso y tope de 100 usuarios nuevos en total [F5][F6][F8]. Encaja
   en la excepción de uso personal [F7]. Verificarla exigiría evaluación de seguridad CASA [F8].
2. «Nunca Testing: los tokens caducan a los 7 días»: correcto [F2][F9].
3. «`history.list` cuesta 2 unidades; 404 → sincronización completa»: correcto [F11][F12][F13]. Filtrar por
   `labelId=INBOX` impide ver las respuestas humanas desde Gmail (§1.4).
4. Gmail: el usuario puede conceder acceso **por tiempo limitado** (`refresh_token_expires_in`) [F1]; y hay un
   máximo de 100 refresh tokens por cuenta y client ID [F2].
5. Cuotas de Gmail: nuevo umbral diario de 80 millones de unidades por proyecto con facturación anunciada para
   finales de 2026 [F11]. No afecta a un negocio, pero conviene saberlo.
6. «Microsoft desactiva por defecto el SMTP con contraseña a finales de 2026»: **correcto** para Exchange
   Online, en tenants existentes y con posibilidad de reactivarlo; retirada definitiva por anunciar en 2027
   [F53]. En Outlook.com personal ya no hay contraseña desde el 16-09-2024 [F54].
7. «Envío `/messages/{id}/reply`»: `reply` devuelve 202 sin cuerpo; mejor `createReply` + `PATCH` + `send` con
   ids inmutables para localizar lo enviado [F41][F45]. `reply` solo necesita `Mail.Send`; `createReply`,
   `Mail.ReadWrite` [F41][F42].
8. «Lo que se envía lleva `Auto-Submitted: auto-replied`»: (a) RFC 3834 prohíbe `auto-replied` en mensajes
   generados manualmente: en modo borrador aprobado o editado por una persona no debería ponerse [F80]; (b) en
   Graph no se puede poner por JSON (solo cabeceras `x-`) y por MIME no está verificado [F44].
9. «Se ignoran spam y promociones»: en Outlook no existe «promociones»; `inferenceClassification=other` es
   relevancia (Focused/Other) y no debe usarse como filtro único [F44].
10. «Zoho de pago»: correcto para cuentas gratuitas nuevas [F62].
11. «`APPEND` a Enviados si el servidor no lo hace (Gmail sí)»: Gmail sí [F25]. Para el resto no hay forma
    estándar de saberlo: buscar por `Message-ID` antes de hacer `APPEND` (§3.2).
12. Opción «Otro» con Gmail: una cuenta de Workspace ya no puede usar su contraseña normal por IMAP/SMTP (desde
    el 14-03-2025); solo contraseña de aplicación [F28].
13. Scopes de Microsoft: `openid`/`profile`/`email` no hacen falta para leer y enviar; `User.Read` + `GET /me`
    bastan [F30][F37].
14. Versiones: ImapFlow 2.x y Nodemailer 10.x exigen Node 20+ (el proyecto usa Node 24). La última ImapFlow
    (2.0.7, 25-09-2026) aún no cumple el margen de 7 días: instalar 2.0.5 [F71b].

---

## Fuentes

Fecha de consulta: 2026-09-26. Entre paréntesis, la fecha de actualización que indica la fuente, si la da.

**Google**

- [F1] Using OAuth 2.0 for Web Server Applications (2026-09-14): https://developers.google.com/identity/protocols/oauth2/web-server
- [F2] Using OAuth 2.0 to Access Google APIs, caducidad de refresh tokens (2026-05-26): https://developers.google.com/identity/protocols/oauth2
- [F3] Granular permissions (2026-05-26): https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions
- [F4] OpenID Connect: https://developers.google.com/identity/openid-connect/openid-connect
- [F5] Gmail API scopes (2026-09-10): https://developers.google.com/workspace/gmail/api/auth/scopes
- [F6] Unverified apps: https://support.google.com/cloud/answer/7454865
- [F7] When is verification not needed: https://support.google.com/cloud/answer/13464323
- [F8] Restricted scope verification (2026-08-19): https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- [F9] Manage App Audience: https://support.google.com/cloud/answer/15549945
- [F10] Manage OAuth Clients (reglas de URI de redirección): https://support.google.com/cloud/answer/6158849
- [F11] Gmail API usage limits (2026-09-10): https://developers.google.com/workspace/gmail/api/reference/quota
- [F12] Synchronizing clients with Gmail: https://developers.google.com/workspace/gmail/api/guides/sync
- [F13] users.history.list: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
- [F14] users.messages.get y Format: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get , https://developers.google.com/workspace/gmail/api/reference/rest/v1/Format
- [F15] users.messages.list: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
- [F16] users.getProfile: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile
- [F17] Sending email y users.messages.send: https://developers.google.com/workspace/gmail/api/guides/sending , https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send , uploads (2026-09-10): https://developers.google.com/workspace/gmail/api/guides/uploads
- [F18] Managing threads: https://developers.google.com/workspace/gmail/api/guides/threads
- [F19] Working with drafts y users.drafts.create: https://developers.google.com/workspace/gmail/api/guides/drafts , https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create
- [F20] Labels (guía, recurso, create) y messages.modify: https://developers.google.com/workspace/gmail/api/guides/labels , https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels , https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels/create , https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/modify
- [F21] Resolve errors (2026-09-15): https://developers.google.com/workspace/gmail/api/guides/handle-errors
- [F22] Gmail sending limits (cuentas personales): https://support.google.com/mail/answer/22839
- [F23] Gmail sending limits in Google Workspace: https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace
- [F24] IMAP, POP, and SMTP (2026-09-15): https://developers.google.com/workspace/gmail/imap/imap-smtp
- [F25] Choose your IMAP email client settings for Gmail: https://support.google.com/mail/answer/78892
- [F26] Add Gmail to another email client: https://support.google.com/mail/answer/7126229
- [F27] Sign in with app passwords: https://support.google.com/accounts/answer/185833
- [F28] Transition from less secure apps to OAuth: https://knowledge.workspace.google.com/admin/sync/transition-from-less-secure-apps-to-oauth

**Microsoft**

- [F30] OAuth 2.0 authorization code flow (ms.date 2026-01-09): https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- [F31] Admin consent protocols: https://learn.microsoft.com/en-us/entra/identity-platform/v2-admin-consent
- [F32] Refresh tokens: https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens
- [F33] Supported account types: https://learn.microsoft.com/en-us/entra/identity-platform/v2-supported-account-types
- [F34] Publisher verification: https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview
- [F35] Add credentials (secretos de cliente): https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials
- [F36] Entra authentication and authorization error codes: https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes
- [F37] Microsoft Graph permissions reference (repositorio oficial de la documentación): https://github.com/microsoftgraph/microsoft-graph-docs-contrib/blob/main/concepts/permissions-reference.md
- [F38] message: delta: https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0
- [F39] Get incremental changes to messages in a folder: https://learn.microsoft.com/en-us/graph/delta-query-messages
- [F40] Use delta query (actualizada 2026-05-14): https://learn.microsoft.com/en-us/graph/delta-query-overview
- [F41] message: reply: https://learn.microsoft.com/en-us/graph/api/message-reply?view=graph-rest-1.0
- [F42] message: createReply: https://learn.microsoft.com/en-us/graph/api/message-createreply?view=graph-rest-1.0
- [F43] message: send: https://learn.microsoft.com/en-us/graph/api/message-send?view=graph-rest-1.0
- [F44] message resource type: https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0
- [F45] Immutable identifiers for Outlook resources: https://learn.microsoft.com/en-us/graph/outlook-immutable-id
- [F46] Create, send and process messages: https://learn.microsoft.com/en-us/graph/outlook-create-send-messages
- [F47] Throttling guidance: https://learn.microsoft.com/en-us/graph/throttling
- [F48] Outlook service limits (incluido en throttling-limits): https://learn.microsoft.com/en-us/graph/throttling-limits , fuente: https://github.com/microsoftgraph/microsoft-graph-docs-contrib/blob/main/includes/throttling-outlook.md
- [F49] mailFolder resource (nombres conocidos): https://learn.microsoft.com/en-us/graph/api/resources/mailfolder?view=graph-rest-1.0
- [F50] Get attachment: https://learn.microsoft.com/en-us/graph/api/attachment-get?view=graph-rest-1.0 ; [F50b] Get user: https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0
- [F51] user: sendMail y Create message (cabeceras x-): https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0 , https://learn.microsoft.com/en-us/graph/api/user-post-messages?view=graph-rest-1.0
- [F52] Deprecation of Basic authentication in Exchange Online (ms.date 2026-07-10): https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/deprecation-of-basic-authentication-exchange-online
- [F53] Updated Exchange Online SMTP AUTH Basic Authentication Deprecation Timeline (2026-01-27): https://techcommunity.microsoft.com/blog/exchange/updated-exchange-online-smtp-auth-basic-authentication-deprecation-timeline/4489835
- [F54] Keeping our Outlook Personal Email Users Safe (2024-06-11): https://techcommunity.microsoft.com/blog/outlook/keeping-our-outlook-personal-email-users-safe-reinforcing-our-commitment-to-secu/4164184
- [F55] POP, IMAP, and SMTP settings for Outlook.com: https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-for-outlook-com-d088b986-291d-42b8-9564-9c414e2aa040
- [F56] Microsoft Q&A, registro de apps con cuenta personal (no es documentación oficial): https://learn.microsoft.com/en-us/answers/questions/5508903/how-can-i-register-an-app-for-microsoft-authentica

**Proveedores IMAP/SMTP**

- [F60] Yahoo: https://help.yahoo.com/kb/SLN4075.html
- [F61] Apple iCloud Mail (2026-02-03): https://support.apple.com/en-us/102525
- [F62] Zoho Mail IMAP: https://www.zoho.com/mail/help/imap-access.html
- [F63] IONOS España: https://www.ionos.es/ayuda/correo/microsoftr-outlook/configurar-manualmente-una-cuenta-de-correo-electronico-en-microsoft-outlook-microsoft-365/
- [F64] IONOS (genérico): https://www.ionos.com/help/email/general-topics/ionos-mail-server-details-for-imap-pop3-and-smtp/
- [F65] Hostinger: https://www.hostinger.com/support/1575756-how-to-get-email-account-configuration-details-for-hostinger-email/
- [F66] OVHcloud MX Plan (2026-07-07): https://docs.ovhcloud.com/en/guides/web-cloud/email-and-collaborative-solutions/mx-plan/email-generalities
- [F67] STRATO España: https://www.strato.es/faq/correo/direcciones-de-servidor-de-correo-electronico-puertos-ssl-tls/
- [F68] GMX Alemania: https://hilfe.gmx.net/pop-imap/imap/imap-serverdaten.html
- [F69] GMX internacional: https://support.gmx.com/pop-imap/imap/server.html , https://support.gmx.com/pop-imap/toggle.html
- [F70] cPanel, Set Up Mail Client: https://docs.cpanel.net/cpanel/email/set-up-mail-client/

**Librerías**

- [F71] ImapFlow (documentación vía Context7 `/websites/imapflow`): https://imapflow.com/docs/api/imapflow-client , https://imapflow.com/docs/guides/basic-usage , https://imapflow.com/docs/guides/mailbox-management , https://imapflow.com/docs/guides/searching ; [F71b] CHANGELOG y registro npm: https://github.com/postalsys/imapflow/blob/master/CHANGELOG.md , https://registry.npmjs.org/imapflow
- [F72] Nodemailer (Context7 `/nodemailer/nodemailer-homepage`): https://nodemailer.com/smtp/ , https://nodemailer.com/extras/mailcomposer/ , https://nodemailer.com/message/custom-headers/ ; [F72b] CHANGELOG: https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md
- [F73] mailparser (Context7 `/nodemailer/mailparser`): https://github.com/nodemailer/mailparser ; [F73b] package.json y registro npm: https://github.com/nodemailer/mailparser/blob/master/package.json , https://registry.npmjs.org/mailparser

**Estándares**

- [F80] RFC 3834, Recommendations for Automatic Responses to Electronic Mail: https://www.rfc-editor.org/rfc/rfc3834
- [F81] RFC 9051, IMAP4rev2 (UID, UIDVALIDITY, rangos `N:*`): https://www.rfc-editor.org/rfc/rfc9051
- [F82] RFC 6154, IMAP LIST Extension for Special-Use Mailboxes: https://www.rfc-editor.org/rfc/rfc6154
- [F83] RFC 5322, Internet Message Format (§3.6.4): https://www.rfc-editor.org/rfc/rfc5322
- [F84] RFC 2369, List-* header fields: https://www.rfc-editor.org/rfc/rfc2369
- [F85] RFC 2919, List-Id: https://www.rfc-editor.org/rfc/rfc2919
- [F86] RFC 8058, One-Click List-Unsubscribe: https://www.rfc-editor.org/rfc/rfc8058
- [F87] [MS-OXCMAIL] X-Auto-Response-Suppress: https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxcmail/ced68690-498a-4567-9d14-5c01f974d8b1
- [F88] RFC 3676 §4.3, separador de firma: https://www.rfc-editor.org/rfc/rfc3676
