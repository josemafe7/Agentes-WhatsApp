# Integración con WhatsApp: conexión y gestión del número

Referencia técnica del alta y la gestión de un número de WhatsApp con la Cloud API oficial de Meta, como
«desarrollador directo»: la app de Meta es del propio negocio y usa un token permanente de usuario del
sistema. Cubre el §2 (WhatsApp) y el §6.2 (pasos 0–5, panel del número y límites) de la especificación.

Todo se comprobó el **2026-09-26** en fuentes primarias. Cada dato lleva su fuente (`[Fn]`, lista al final,
con la fecha de actualización que indica la propia página). Lo que no se pudo confirmar va marcado como
**no verificado**. Lo marcado como **decisión de diseño** es una recomendación nuestra, no un dato de Meta.

Lo que pasa con el canal ya conectado (recepción, firma, tipos de mensaje, estados, medios, envío y ventana
de 24 h) está en `docs/integracion-whatsapp-mensajes.md`. Aquí no se repite.

Los JSON de ejemplo tienen la forma oficial y datos inventados. Usan los mismos identificadores que el
documento de mensajes:

| Dato | Valor de ejemplo |
|---|---|
| WABA (Messaging account) | `100000000000001` |
| `phone_number_id` | `200000000000002` |
| Número del negocio | `+1 555-000-1111` (los 555 son ficticios) |
| App ID | `300000000000003` |
| Portfolio (Business ID) | `400000000000004` |
| Usuario del sistema | `500000000000005` |

## Lo imprescindible

1. **Versión**: la actual es **v26.0**, publicada el **29-07-2026**. Va siempre en la URL
   (`https://graph.facebook.com/v26.0/...`) y se guarda por canal. Nunca llamadas sin versión [F1][F3].
2. **Dos tipos de token**. El **token del usuario del sistema** (`Authorization: Bearer`) sirve para todo lo
   del número y la WABA. El **token de app** (`APP_ID|APP_SECRET`) solo para `GET /debug_token` y
   `/{APP_ID}/subscriptions` [F11][F14][F15].
3. **Validar**: `GET /{PHONE_NUMBER_ID}?fields=...,health_status` devuelve los IDs de la WABA, del portfolio y
   de la app en `health_status.entities` [F6]. Después, `GET /debug_token` con el token de app comprueba el
   token: `is_valid`, `app_id`, `type: "SYSTEM_USER"`, `expires_at: 0` y los dos permisos [F12].
4. **Webhook de la app**: `POST /{APP_ID}/subscriptions` con token de app y
   `object=whatsapp_business_account` **está documentado como alternativa** en la guía de WhatsApp. La
   referencia genérica del endpoint dice lo contrario [F15][F16]. Se intenta y, si falla, se guía a mano.
5. **Siempre** `POST /{WABA_ID}/subscribed_apps` sin cuerpo, y comprobar con `GET` que la app aparece.
   Sin esto no llegan eventos de ese número [F20][F22].
6. **`override_callback_uri` existe** (en la WABA y en el número) y **no se usa** [F21].
7. **Registro**: `POST /{PHONE_NUMBER_ID}/register` con `messaging_product` y `pin`. Máximo **10 intentos
   en 72 h**, igual que `deregister` (error `133016`) [F23]. El PIN de 6 cifras **se está retirando** para
   los números elegibles desde el 23-09-2026, pero hay que seguir enviándolo [F25].
8. **Cambio de nombre aprobado** → volver a registrar en **14 días**. Registrar antes de la aprobación no
   sirve [F10].
9. **App en Live**: si la app está en desarrollo, algunos webhooks no se envían [F22]. Un desarrollador
   directo no necesita App Review ni verificar la empresa para publicarla [F12][F36].
10. **Precios**: desde el **1-10-2026** Meta cobra los mensajes de servicio a la misma tarifa que utilidad y
    autenticación de cada mercado. Hay **1.000 gratis al mes por número**. Las plantillas de utilidad dentro
    de la ventana también se cobran. Sin método de pago, los mensajes de servicio dejan de entregarse al
    agotar los gratuitos [F40][F41].
11. **Cuentas**: desde el 23-09-2026 la WABA se divide en *WhatsApp account* y *Messaging account*. El ID de
    la WABA pasa a ser el de la Messaging account y todo sigue funcionando igual [F25][F26].

---

## 1. Versión de Graph API

| Versión | Publicada | Disponible hasta |
|---|---|---|
| **v26.0** | 29-07-2026 | Sin fecha (TBD) |
| v25.0 | 18-02-2026 | 29-07-2028 |
| v24.0 | 08-10-2025 | 18-02-2028 |
| v23.0 | 29-05-2025 | 08-10-2027 |
| v22.0 | 21-01-2025 | 20-05-2027 |
| v21.0 | 02-10-2024 | 21-01-2027 |

Fuente: tabla de versiones de Graph API [F1].

**Política de versiones** [F3]:

- Cada versión funciona **al menos dos años**. Deja de funcionar dos años después de que salga la
  siguiente.
- Una llamada a una versión caducada **se atiende con la versión más antigua que siga activa**. El
  comportamiento puede cambiar sin avisar.
- Una llamada **sin versión** usa la versión configurada en el panel de la app (Settings > Advanced).

**Cómo va en la URL**: `https://graph.facebook.com/v26.0/{nodo}/{arista}`. La documentación de WhatsApp
escribe `vLATEST` o versiones anteriores en sus ejemplos; los endpoints son los mismos.

**Por qué se guarda por canal** (`graph_api_version`, por defecto `v26.0`):

- Meta publica versiones nuevas varias veces al año y cada una puede romper algo.
- Con la versión en la configuración, se prueba una nueva en un canal y se vuelve atrás sin desplegar.
- La URL base sale de `META_GRAPH_BASE_URL` (por defecto `https://graph.facebook.com`), así los tests
  apuntan al simulador.

**Cambios de protocolo de v26.0** que afectan a todas las versiones desde el **27-10-2026** [F2]. El
cliente no debe usar nada de esto:

- `pretty` y `debug` se ignoran; `debug_token` no se ve afectado.
- `date_format` devuelve error.
- `GET /?ids=...` devuelve error.
- `If-None-Match` se ignora y ya no hay respuestas `304`.

**Semáforo «Versión» del panel** (decisión de diseño): verde si la versión del canal no tiene fecha de fin o
le quedan más de 6 meses. Ámbar si le quedan menos. Rojo si ya caducó. Las fechas se toman de la tabla de
arriba y se guardan en una constante revisable, no se calculan.

---

## 2. Cuentas, tokens y permisos

### 2.1 Modelo de cuentas desde el 23-09-2026

Meta separa la antigua WhatsApp Business Account (WABA) en dos cuentas. El despliegue es gradual y llega a
todos los negocios a mediados de octubre de 2026 [F25][F26]:

| Cuenta | Qué contiene | ID |
|---|---|---|
| **WhatsApp account (WAAC)** | Un solo número, su perfil y, en el futuro, un nombre de usuario | Todavía no se puede consultar por API (fase 2, primer semestre de 2027) |
| **Messaging account** | Plantillas, facturación, analíticas y suscripciones a webhooks | **El mismo que tenía la WABA** |

Qué supone para esta integración:

- Los endpoints, los `phone_number_id`, los tokens y el campo `waba_id` siguen igual. En la base de datos se
  sigue llamando `waba_id`; en la interfaz se puede mostrar como «Cuenta de mensajería (WABA)».
- Las suscripciones a webhooks (`subscribed_apps`) viven en la Messaging account [F25].
- La facturación y el método de pago también están en la Messaging account [F25][F26].
- **Fase 3 (primer semestre de 2028)**: las rutas que hoy llevan el `phone_number_id` tendrán que llevar el
  ID de la WAAC. Por eso los IDs y la versión son configurables y no se incrustan en el código.
- Un número puede tener varias Messaging accounts (una por partner). Con un solo desarrollador directo hay
  una, así que no hace falta `messaging_account_id` en los envíos [F25].
- **Meta Business Suite** muestra, en los negocios ya migrados, pestañas separadas de «WhatsApp accounts» y
  «Messaging accounts» en lugar de una sola [F25]. Hay que tenerlo en cuenta en la guía para el negocio.

### 2.2 Tipos de token

| Token | Formato | Para qué | Cómo se envía |
|---|---|---|---|
| **Usuario del sistema** | Cadena opaca (`EAA...`). Longitud variable: se guarda sin tamaño máximo [F13]. | Todo lo del número y la WABA: leer, registrar, suscribir, plantillas, enviar | `Authorization: Bearer <token>` |
| **App** | `APP_ID\|APP_SECRET`, o el token que devuelve `GET /oauth/access_token?client_id=…&client_secret=…&grant_type=client_credentials` [F14] | `GET /debug_token` [F11] y `GET/POST/DELETE /{APP_ID}/subscriptions` [F16] | Parámetro `access_token` (forma documentada [F14]) o `Authorization: Bearer` (así lo usa n8n [F19]) |

Notas:

- El token de app lleva el App Secret dentro. Solo se usa **en el servidor**, nunca se registra en logs y,
  si va en la URL, la URL tampoco se registra.
- Que el token de app funcione confirma a la vez que el App ID y el App Secret son correctos. Es la misma
  clave con la que se firma `X-Hub-Signature-256`, así que la firma de los webhooks funcionará.
- El App Secret **no se puede rotar por API**. Si Meta detecta una filtración, pide cambiarlo y, si no se
  hace a tiempo, lo cambia ella: entonces fallan todas las firmas. El panel necesita «Cambiar App Secret»
  [F36].

### 2.3 Permisos

| Permiso | Para qué [F12][F22] |
|---|---|
| `whatsapp_business_management` | Leer la WABA y sus números, plantillas, analíticas, `subscribed_apps` y los webhooks de cuenta |
| `whatsapp_business_messaging` | Enviar mensajes y recibir los webhooks de mensajes y estados |
| `business_management` | Solo para acceder al portfolio por API. La guía de inicio lo incluye al crear el token [F32]; no es imprescindible para esta integración [F12] |

- Un **desarrollador directo que solo accede a sus propios datos no necesita App Review ni acceso
  avanzado** [F12].
- El usuario del sistema necesita, además del permiso, **acceso al activo**: control total de la app y
  acceso a la WhatsApp account y a la Messaging account. Si le falta, la API responde con el error `200`
  (no confundir con el HTTP 200) [F13].
- En Meta Business Suite hay que asignarle las dos cuentas por separado; por API, dar acceso a la
  Messaging account lo extiende a la WAAC, pero Meta avisa de que es provisional [F13].

### 2.4 Dónde encuentra el negocio cada dato

Texto para los «¿Dónde lo encuentro?» del asistente y para `docs/guia-whatsapp.md`:

| Campo | Dónde |
|---|---|
| Phone Number ID y WABA ID | Panel de la app > WhatsApp > **API Setup** [F32] |
| App ID y App Secret | Panel de la app > Configuración de la app > **Básica** [F36] |
| Token permanente | business.facebook.com > Configuración > **Usuarios del sistema** > Generar token, eligiendo la app, caducidad «Nunca» y los permisos de §2.3 [F13][F32] |
| PIN de verificación en dos pasos | Lo eligió quien registró el número. Si no se sabe, se cambia (§5.3) |

### 2.5 Límite de llamadas de gestión

Las llamadas de la app sobre una WABA cuentan en una ventana móvil de una hora [F33]:

- **200 por hora**, por app y por WABA, por defecto.
- **5.000 por hora** si la WABA tiene al menos un número registrado.
- Afecta a `GET /{WABA_ID}`, `/phone_numbers`, `/message_templates`, `/subscribed_apps` y al `GET` del
  número.
- Al superarlo: error `4` o `80007`.

La revisión de salud cada 6 horas usa unas cuatro llamadas por número, muy lejos del límite.

---

## 3. Paso 1 · «Validar con Meta»

Orden recomendado (decisión de diseño). Cada paso da un error claro si falla:

1. `GET /{PHONE_NUMBER_ID}` con el token del usuario del sistema → datos del número e IDs (§3.1 y §3.2).
2. `GET /debug_token` con el token de app → validez, app, tipo, caducidad y permisos (§3.3).
3. Opcional: `GET /{WABA_ID}` → nombre de la cuenta y estado de verificación de la empresa (§3.4).
4. Resumen «Negocio · Número · Estado» y guardado cifrado de los secretos.

### 3.1 `GET /{PHONE_NUMBER_ID}`

- **Token**: usuario del sistema (`Bearer`).
- **Parámetro**: `fields`, lista separada por comas.

| Campo | Documentado en | Valores y uso |
|---|---|---|
| `id`, `display_phone_number`, `verified_name`, `quality_rating` | Referencia, campos por defecto [F4] | `quality_rating`: `GREEN`, `YELLOW`, `RED` o `NA` (sin calcular). En el listado de la WABA aparece `UNKNOWN` en lugar de `NA` [F7]: tratar ambos igual. |
| `code_verification_status` | Referencia [F4] y guía [F5] | La referencia dice `VERIFIED` o `UNVERIFIED`; el listado de la WABA usa `VERIFIED`, `NOT_VERIFIED` o `EXPIRED` [F7]. Indica si se verificó la **propiedad** del número por SMS o llamada. La referencia lo describe como «verificación en dos pasos», pero la guía lo usa para decidir si hace falta `request_code` [F5]. **Regla**: todo lo que no sea `VERIFIED` = hay que verificar. |
| `name_status` | Referencia [F4] y nombres [F10] | `APPROVED`, `AVAILABLE_WITHOUT_REVIEW`, `DECLINED`, `EXPIRED`, `PENDING_REVIEW` o `NONE`. `verified_name` es el texto que se revisa, no indica si está aprobado. |
| `new_display_name`, `new_name_status` | Nombres [F10] | Nombre pendiente tras pedir un cambio y su estado. |
| `status` | Guía [F5] | Hace falta `CONNECTED` para enviar y recibir. Otros valores del listado: `BANNED`, `DELETED`, `DISCONNECTED`, `FLAGGED`, `MIGRATED`, `PENDING`, `RATE_LIMITED` y `RESTRICTED` [F7]. |
| `whatsapp_business_manager_messaging_limit` | Límites [F8] | Límite del portfolio, por ejemplo `TIER_250`. `messaging_limit_tier` está **obsoleto**: no usarlo. |
| `throughput` | Rendimiento [F9] | Nivel de rendimiento. **No verificado**: la forma del objeto devuelto no aparece en la documentación actual. Solo informativo. |
| `health_status` | Estado de salud [F6] | Ver §3.2. |
| `webhook_configuration` | Overrides [F21] | Ver §4.4. Útil en el diagnóstico. |

**No documentados en la referencia actual** (no se usan): `platform_type`, `is_pin_enabled`. El listado de
la WABA documenta `host_platform` (`CLOUD_API`, `ON_PREMISE`, `NOT_APPLICABLE`) y `account_mode` (`LIVE`,
`SANDBOX`) [F7], pero no es un indicador documentado de «registrado».

Petición:

`GET /v26.0/200000000000002?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,status,whatsapp_business_manager_messaging_limit,health_status`

Respuesta (número recién dado de alta en un portfolio sin verificar):

```json
{
  "id": "200000000000002",
  "display_phone_number": "+1 555-000-1111",
  "verified_name": "Peluquería Ejemplo",
  "quality_rating": "NA",
  "code_verification_status": "VERIFIED",
  "name_status": "PENDING_REVIEW",
  "status": "CONNECTED",
  "whatsapp_business_manager_messaging_limit": "TIER_250",
  "health_status": {
    "can_send_message": "LIMITED",
    "entities": [
      {
        "entity_type": "PHONE_NUMBER",
        "id": "200000000000002",
        "can_send_message": "LIMITED",
        "can_receive_call_sip": "AVAILABLE",
        "additional_info": [
          "Your display name has not been approved yet. Your message limit will increase after the display name is approved."
        ]
      },
      { "entity_type": "WABA", "id": "100000000000001", "can_send_message": "AVAILABLE" },
      { "entity_type": "BUSINESS", "id": "400000000000004", "can_send_message": "AVAILABLE" },
      {
        "entity_type": "APP",
        "id": "300000000000003",
        "can_send_message": "AVAILABLE",
        "can_receive_call_sip": "AVAILABLE"
      }
    ]
  }
}
```

Errores habituales en este paso:

| Código | Causa probable | Mensaje en español |
|---|---|---|
| `190` | Token caducado, revocado o mal copiado. Subcódigos `463` (caducado) y `467` (no válido) [F39] | «El token no es válido o ha caducado. Genera uno nuevo en Usuarios del sistema.» |
| `100` | Parámetro o campo no admitido, o ID inexistente | «El Phone Number ID no es correcto o el token no tiene acceso a él.» |
| `803` | Aparece en los ejemplos de la referencia para «número no encontrado» (HTTP 404) [F4]. No está en la tabla de errores de WhatsApp. | Mismo mensaje que `100`. |
| `200`–`299`, `10`, `3` | Falta un permiso o el usuario del sistema no tiene acceso al activo [F13][F38] | «El token no tiene permiso sobre este número. Revisa los permisos y los activos asignados al usuario del sistema.» |
| `4`, `80007` | Límite de llamadas [F38] | «Meta está limitando las consultas. Inténtalo en unos minutos.» |

### 3.2 `health_status`: estado y de dónde salen los IDs

`GET /{NODO}?fields=health_status` funciona sobre el número, la WABA y una plantilla. Resume si se puede
enviar con ese nodo teniendo en cuenta todos los implicados [F6]:

| `entity_type` | `id` | Cuándo aparece |
|---|---|---|
| `PHONE_NUMBER` | `phone_number_id` | Si se consulta un número |
| `MESSAGE_TEMPLATE` | ID de la plantilla | Si se consulta una plantilla |
| `WABA` | **ID de la Messaging account (WABA)** | Siempre |
| `BUSINESS` | **ID del portfolio** | Siempre |
| `APP` | **App ID** | Siempre |

Estados por entidad (`can_send_message`; `can_receive_call_sip` es para llamadas SIP) [F6]:

| Valor | Significado | Campo extra |
|---|---|---|
| `AVAILABLE` | Cumple todos los requisitos | — |
| `LIMITED` | Puede enviar con limitaciones | `additional_info`: lista de textos |
| `BLOCKED` | No puede enviar | `errors`: objetos con `error_code`, `error_description` y `possible_solution` |

El estado general (`health_status.can_send_message`) es `BLOCKED` si alguna entidad lo está, `LIMITED` si
alguna está limitada y `AVAILABLE` si todas están bien. Para llamadas SIP no hay estado general [F6].

**IDs que se guardan** en el canal: `waba_id`, `meta_business_id` y `meta_app_id`.

- La documentación llama a la entidad `APP` simplemente «App ID». Se entiende que es la app implicada en la
  petición, es decir, la del token. **No verificado** de forma explícita, pero se confirma en §3.3: el
  `app_id` de `debug_token` tiene que coincidir.
- Con varias Messaging accounts en el mismo número (varios partners), no está documentado cuál aparece como
  `WABA`. Con un desarrollador directo solo hay una.
- Los textos de `additional_info` y `error_description` llegan en inglés. Se muestran tal cual debajo de un
  mensaje nuestro en español.

**Plan B si faltan IDs** (decisión de diseño):

1. **App ID**: se pide en el formulario (Configuración de la app > Básica). Es imprescindible, porque sin él
   no se puede formar el token de app.
2. **WABA ID**: se pide en el formulario (API Setup). Alternativa por API: si `debug_token` trae
   `granular_scopes[].target_ids` para `whatsapp_business_management`, esos son los IDs de las WABA con
   acceso; el primero es el último incorporado [F54]. Con tokens de usuario del sistema es habitual que no
   traigan `target_ids` (§3.3).
3. **Portfolio**: es opcional para funcionar. Existe `GET /{BUSINESS_ID}/owned_whatsapp_business_accounts`
   en la especificación OpenAPI de Meta [F53], pero requiere `business_management` y no hace falta.

### 3.3 `GET /debug_token`

- **Token**: **token de app** (`APP_ID|APP_SECRET`). Vale un token de app o el token de usuario de un
  desarrollador de la app a la que pertenece el token inspeccionado; los dos tokens tienen que ser **de la
  misma app** [F11][F55].
- **Parámetro**: `input_token` = token del usuario del sistema que se quiere comprobar.

Campos documentados [F11]: `app_id`, `application`, `type`, `expires_at`, `data_access_expires_at`,
`is_valid`, `issued_at`, `scopes`, `granular_scopes` (`scope` y `target_ids` opcional), `user_id`,
`profile_id`, `metadata` y `error` (`code`, `message`, `subcode`).

Petición:

`GET /v26.0/debug_token?input_token=<TOKEN_DEL_SISTEMA>&access_token=300000000000003|<APP_SECRET>`

Respuesta (forma del ejemplo oficial de la página de permisos de WhatsApp [F12]):

```json
{
  "data": {
    "app_id": "300000000000003",
    "type": "SYSTEM_USER",
    "application": "DominIA Peluquería Ejemplo",
    "data_access_expires_at": 0,
    "expires_at": 0,
    "is_valid": true,
    "issued_at": 1790380800,
    "scopes": [
      "business_management",
      "whatsapp_business_management",
      "whatsapp_business_messaging"
    ],
    "granular_scopes": [
      { "scope": "business_management" },
      { "scope": "whatsapp_business_management" },
      { "scope": "whatsapp_business_messaging" }
    ],
    "user_id": "500000000000005"
  }
}
```

Comprobaciones y resultado en la interfaz (decisión de diseño sobre datos documentados):

| Comprobación | Si falla |
|---|---|
| La llamada responde (no error de autenticación) | **Bloquea**: «El App ID o el App Secret no son correctos, o el token es de otra app». Meta no documenta el código concreto de este error. |
| `data.is_valid === true` | **Bloquea**: «El token no es válido». Si viene `data.error`, se muestra su `message`. |
| `data.app_id === meta_app_id` | **Bloquea**: «El token pertenece a otra app». |
| `data.type === "SYSTEM_USER"` | **Bloquea** ([WA-06]): «El token no es de un usuario del sistema. Genera uno permanente en Usuarios del sistema». `SYSTEM_USER` aparece en el ejemplo oficial [F12]; la referencia genérica solo muestra `USER` [F55]. Si Meta no devuelve `type`, no se bloquea. Decisión en `docs/decisions/0019-token-solo-de-usuario-del-sistema.md`. |
| `data.expires_at === 0` | **Aviso** con la fecha: «El token caduca el …». `0` = no caduca [F12]. |
| `scopes` incluye `whatsapp_business_management` y `whatsapp_business_messaging` | **Bloquea**: «Al token le falta el permiso …». |
| Si `granular_scopes` trae `target_ids` para esos permisos, incluyen el `waba_id` | **Bloquea**: «El token no tiene acceso a esta cuenta de WhatsApp». Sin `target_ids`, el permiso vale para todos los activos a los que accede el usuario del sistema [F11]. |

### 3.4 `GET /{WABA_ID}` (opcional)

- **Token**: usuario del sistema.
- **Campos útiles** [F52]: `id`, `name`, `timezone_id`, `message_template_namespace`,
  `account_review_status` (`APPROVED`, `DEFERRED`, `PENDING`, `REJECTED`), `business_verification_status`
  (`VERIFIED`, `NOT_VERIFIED`, `PENDING`, `PENDING_NEED_MORE_INFO`, `PENDING_SUBMISSION`, `REJECTED`,
  `REVOKED`, `EXPIRED`, `FAILED`, `INELIGIBLE`), `country`, `ownership_type` y
  `primary_business_location`. La guía actual también pide `status` y `currency` en su ejemplo [F26].

Sirve para mostrar los límites de «empresa sin verificar» (§8) cuando `business_verification_status` no es
`VERIFIED`.

```json
{
  "id": "100000000000001",
  "name": "Peluquería Ejemplo",
  "account_review_status": "APPROVED",
  "business_verification_status": "NOT_VERIFIED",
  "country": "ES",
  "timezone_id": "13"
}
```

### 3.5 Reutilizar datos de otra conexión

Si otro canal de la misma instalación ya usa la misma app (mismo `meta_app_id`), se reutilizan su App
Secret y su suscripción de la app. Solo cambia lo del número y, si procede, la WABA.

---

## 4. Paso 2 · Webhook

Una sola URL por instalación: `https://{dominio}/api/webhooks/whatsapp`, con el verify token de la
instalación. La verificación `GET` y la firma de los `POST` están en `docs/integracion-whatsapp-mensajes.md`.

### 4.1 Intento automático: `POST /{APP_ID}/subscriptions`

**¿Está soportado?** La documentación se contradice, y así se deja escrito:

- La guía de WhatsApp «Create a webhook endpoint» (actualizada el 17-06-2026) dice que se puede usar la API
  de suscripciones de la app como alternativa al panel. Exige token de app y `object` =
  `whatsapp_business_account` [F15].
- La referencia de `/{app-id}/subscriptions` dice que los webhooks de WhatsApp no están soportados y que se
  configuran en el panel. Su enumeración de `object` tampoco incluye WhatsApp [F16].
- **n8n lo usa en producción** en su nodo «WhatsApp Trigger» [F19]:
  - obtiene un token de app con `client_credentials`;
  - hace `POST /v19.0/{appId}/subscriptions` en formulario con `object=whatsapp_business_account`,
    `callback_url`, `verify_token`, `fields` (lista en JSON) e `include_values=true`;
  - antes lista las suscripciones y, si ya hay otra URL para ese `object`, se niega a pisarla: solo cabe
    una URL por app;
  - al desactivar el disparador borra la suscripción con `DELETE` y `object=whatsapp_business_account`.

**Petición** (token de app):

| Parámetro | Valor |
|---|---|
| `object` | `whatsapp_business_account` |
| `callback_url` | `https://{dominio}/api/webhooks/whatsapp` |
| `verify_token` | Verify token de la instalación |
| `fields` | `messages,account_update,phone_number_quality_update,phone_number_name_update,message_template_status_update` (más los recomendados abajo). La referencia usa lista separada por comas; n8n envía un array JSON [F16][F19]. |
| `include_values` | `true`, para que los avisos traigan los valores [F16] |

**Qué pasa en ese momento**: Meta envía el `GET` de verificación (`hub.mode=subscribe`, `hub.challenge`,
`hub.verify_token`) a la `callback_url` **durante** la petición, y la respuesta de la API dice si ha ido
bien [F18]. Consecuencias:

- La URL tiene que ser pública y con HTTPS válido. Los certificados autofirmados no valen [F15]. Desde
  `localhost` no funciona.
- El manejador del `GET` no puede depender de nada que la acción que hace el `POST` tenga bloqueado.
- El verify token tiene que estar guardado **antes** de llamar.

**Respuesta correcta** [F16][F17]:

```json
{ "success": true }
```

Si la verificación falla, Meta devuelve un error de Graph. **No está documentado** qué código usa en este
caso: se muestra el `message` y se pasa al modo manual.

**Comprobación**: `GET /{APP_ID}/subscriptions` con token de app [F16][F17].

```json
{
  "data": [
    {
      "object": "whatsapp_business_account",
      "callback_url": "https://agentes.peluqueria-ejemplo.es/api/webhooks/whatsapp",
      "active": true,
      "fields": [
        { "name": "messages", "version": "v26.0" },
        { "name": "account_update", "version": "v26.0" },
        { "name": "message_template_status_update", "version": "v26.0" }
      ]
    }
  ]
}
```

- Cada campo lleva su `version`, que marca el formato del webhook [F17]. **No verificado**: que la versión
  guardada sea la de la URL de la llamada. Se comprueba con este `GET` y se muestra en el panel.
- **Antes de suscribir** (decisión de diseño): si ya existe una suscripción `whatsapp_business_account` con
  otra `callback_url` (por ejemplo, un n8n del negocio), se avisa y se pide confirmación. Suscribir la
  cambia para toda la app.
- **Al desconectar** un número no se borra la suscripción de la app, porque la comparten todos los números
  de la app.

**Campos recomendados**, además de los de la especificación [F22]:

| Campo | Para qué |
|---|---|
| `messages` | Mensajes y estados. **Imprescindible** |
| `account_update` | Restricciones, bloqueos, borrado y cambios de la cuenta |
| `phone_number_quality_update` | Cambios de límite y de rendimiento |
| `phone_number_name_update` | Resultado de la revisión del nombre (dispara el recordatorio de volver a registrar) |
| `message_template_status_update` | Estado de las plantillas |
| `template_category_update` | Cambios de categoría de una plantilla (cambian su precio) |
| `message_template_quality_update` | Calidad de las plantillas |
| `business_capability_update` | Cambios del límite de mensajes y del número máximo de números |
| `account_alerts` | Avisos: no se puede subir el límite y similares |
| `security` | Cambios del PIN de verificación en dos pasos |

### 4.2 Modo manual (si falla el intento automático)

1. Mostrar la URL y el verify token con botón de copiar.
2. Instrucciones: panel de la app > **WhatsApp > Configuración**. Si la app se creó con el caso de uso
   «Connect with customers through WhatsApp», la ruta es **Casos de uso > Personalizar > Configuración**
   [F15][F22]. Pegar URL y token, pulsar «Verificar y guardar» y suscribir `messages` y los recomendados.
3. «Indicar en vivo cuando llegue la verificación»: el manejador del `GET` guarda la hora de la última
   verificación correcta y la interfaz la consulta por sondeo.
4. El panel de la app permite enviar un aviso de prueba [F22]. Llega firmado, pero con datos de ejemplo:
   se reconoce, se registra y no crea conversaciones.

### 4.3 `/{WABA_ID}/subscribed_apps` (siempre)

Suscribe la app a los eventos de **esa** WABA. Sin esto no llegan los mensajes de sus números, aunque la
app tenga la URL bien puesta [F20][F22]. Requiere `whatsapp_business_management`.

| Operación | Token | Cuerpo | Respuesta |
|---|---|---|---|
| `POST /{WABA_ID}/subscribed_apps` | Usuario del sistema | **Ninguno** | `{ "success": true }` |
| `GET /{WABA_ID}/subscribed_apps` | Usuario del sistema | — | Lista de apps suscritas |
| `DELETE /{WABA_ID}/subscribed_apps` | Usuario del sistema | — | `{ "success": true }`. Deja de enviar webhooks de esa WABA **a esta app** |

`GET` (campos admitidos: `id`, `name`, `link`) [F20][F21]:

```json
{
  "data": [
    {
      "whatsapp_business_api_data": {
        "id": "300000000000003",
        "link": "https://www.facebook.com/games/?app_id=300000000000003",
        "name": "DominIA Peluquería Ejemplo"
      }
    }
  ]
}
```

- **Idempotencia**: la documentación no lo dice con esas palabras, pero trata el volver a suscribir sin
  cuerpo como una operación normal: es la forma documentada de quitar un override [F21]. Se llama siempre
  y se comprueba después con `GET` que `data[].whatsapp_business_api_data.id` es nuestro App ID.
- **Efecto útil**: suscribir sin cuerpo **elimina cualquier override de la WABA** que hubiera dejado otra
  integración [F21].
- **Al desconectar** (decisión de diseño): `DELETE` solo si ningún otro canal de la instalación usa esa
  misma WABA. Si no, se cortarían sus webhooks.
- Errores documentados en la referencia: `100` (ID o parámetros), `190` (token), `200` con HTTP 403 (sin
  permiso sobre la WABA), `803` con HTTP 404 (WABA no encontrada), `2` con `is_transient: true` [F20].

### 4.4 `override_callback_uri`: existe y no se usa

Existe en dos niveles [F21]:

| Nivel | Cómo se pone | Cómo se ve |
|---|---|---|
| Messaging account (WABA) | `POST /{WABA_ID}/subscribed_apps` con `override_callback_uri` y `verify_token` | Propiedad `override_callback_uri` en el `GET /{WABA_ID}/subscribed_apps` |
| Número | `POST /{PHONE_NUMBER_ID}` con `webhook_configuration.override_callback_uri` y `verify_token` | `GET /{PHONE_NUMBER_ID}?fields=webhook_configuration` |

- Orden de prioridad: número, después WABA, después la URL de la app.
- Solo afecta a algunos campos (`messages`, `message_echoes`, `calls`, `history`, grupos…). Las plantillas y
  los avisos de cuenta siempre van a la URL de la app.
- **No se usa** (regla de la especificación): la instalación tiene una sola URL, la de la app.

**Uso en el diagnóstico** (decisión de diseño): `GET /{PHONE_NUMBER_ID}?fields=webhook_configuration` con el
token del usuario del sistema devuelve también la URL de la app, sin necesidad del token de app:

```json
{
  "webhook_configuration": {
    "application": "https://agentes.peluqueria-ejemplo.es/api/webhooks/whatsapp"
  },
  "id": "200000000000002"
}
```

- Si `application` no es nuestra URL → la app apunta a otro sitio.
- Si aparecen `phone_number` o `whatsapp_business_account` → hay un override que desvía los mensajes. Se
  avisa y **no se toca sin confirmación**: quitarlo exige enviar `override_callback_uri` vacío en el número,
  o volver a suscribir la WABA sin cuerpo.

### 4.5 App en Live

- La guía de webhooks de WhatsApp pide tener la app en Live, porque **algunos webhooks no se envían si la
  app está en desarrollo** [F22]. En la práctica, los mensajes de clientes reales no llegan: **no
  verificado** en una fuente oficial con esas palabras.
- Requisitos para publicarla y por qué no hace falta App Review: §5.6.
- **No verificado**: que exista un campo de la API para leer el modo de la app. El semáforo «App publicada»
  es una casilla que marca el usuario, apoyada en el diagnóstico (§6.3).

---

## 5. Paso 3 · Activar el número

### 5.1 Punto de partida

Con los datos de §3.1:

| Situación | Qué se hace |
|---|---|
| `code_verification_status` distinto de `VERIFIED` | Verificar la propiedad (§5.2) |
| Número sin registrar para la Cloud API | Registrar (§5.4) |
| `status` = `CONNECTED` y `health_status` sin `BLOCKED` | Listo; seguir con el checklist |

**No hay un campo documentado que diga «registrado»**. Señales (decisión de diseño):

- `status` distinto de `CONNECTED`.
- Errores `133010` («no registrado») o `131045` («error de registro») al enviar [F38].
- `health_status` bloqueado en la entidad `PHONE_NUMBER`.

El registro solo se hace por API: no se puede hacer desde WhatsApp Manager ni desde el panel de la app
[F23]. El número de prueba de Meta ya viene registrado (§7).

### 5.2 Verificar la propiedad: `request_code` y `verify_code`

**`POST /{PHONE_NUMBER_ID}/request_code`** (usuario del sistema) [F5][F27]:

| Parámetro | Valor |
|---|---|
| `code_method` | `SMS` o `VOICE` |
| `language` | La guía pide el código de dos letras de la lista de idiomas de plantillas, por ejemplo `en`. Su propio ejemplo usa `en_US`. Para español: **`es`**; también existe `es_ES` [F5][F28]. |

- Respuesta: `{ "success": true }` [F27].
- Si el número **ya está verificado**: HTTP 400 con el error `136024`. Por eso se mira antes
  `code_verification_status` [F5].
- La referencia avisa de límites adicionales para evitar abusos y de bloqueos temporales tras varios
  fallos, sin dar cifras [F27]. **No verificado**: el número de intentos permitido.

**`POST /{PHONE_NUMBER_ID}/verify_code`** (usuario del sistema) [F5][F27]:

| Parámetro | Valor |
|---|---|
| `code` | Código recibido (cadena numérica) |

- Respuesta: `{ "success": true }` (la referencia añade un `id` opcional).
- Según la referencia, el código caduca en unos 10 minutos y es de un solo uso.

### 5.3 PIN de verificación en dos pasos

**Cambiar o fijar el PIN**: `POST /{PHONE_NUMBER_ID}` con `{ "pin": "123456" }` (usuario del sistema) →
`{ "success": true }` [F5][F24].

- **No hace falta llamarlo antes de registrar**: si el número no tiene PIN, el PIN que se envía en
  `register` pasa a ser el suyo [F23].
- Sirve cuando el número ya tenía PIN y nadie lo recuerda: se cambia por API sin conocer el anterior
  [F5]. Útil ante el error `133005` (PIN incorrecto).
- No hay endpoint para **desactivar** la verificación en dos pasos; solo desde WhatsApp Manager, con un
  enlace por correo [F5][F24].
- Guardar el PIN **cifrado** (regla de la especificación).

**Retirada del PIN desde el 23-09-2026** [F24][F25]:

- Meta está retirando el PIN de 6 cifras en los números de la Cloud API **elegibles**. La elegibilidad llega
  de forma gradual, por grupos de negocios.
- Para un número elegible: la pestaña «Verificación en dos pasos» desaparece de WhatsApp Manager, Meta ya
  no usa el PIN para validar el registro, borra el que hubiera y no crea uno nuevo.
- **Hay que seguir enviando un `pin` válido de 6 cifras** en `register` hasta que Meta anuncie otro
  contrato de la API.
- Para los números que aún no son elegibles, todo sigue como antes.
- **No verificado**: qué hace `POST /{PHONE_NUMBER_ID}` con `pin` en un número elegible.

### 5.4 Registrar: `POST /{PHONE_NUMBER_ID}/register`

- **Token**: usuario del sistema con `whatsapp_business_management` y `whatsapp_business_messaging` [F23].

| Parámetro | Obligatorio | Valor |
|---|---|---|
| `messaging_product` | Sí | `"whatsapp"` |
| `pin` | Sí | PIN actual si ya tenía verificación en dos pasos; si no, un número de 6 cifras que pasa a ser el PIN |
| `data_localization_region` | No | Activa el almacenamiento local de datos en reposo. Código ISO de 2 letras: `AU`, `ID`, `IN`, `JP`, `SG`, `KR`, `DE` (UE), `CH`, `GB`, `BR`, `BH`, `ZA`, `AE`, `CA`. **No se usa** salvo que el negocio lo pida: para quitarlo o cambiarlo hay que desregistrar y volver a registrar [F23]. |

Respuesta: `{ "success": true }`.

**Límite: 10 peticiones por número en una ventana móvil de 72 horas** [F23]:

- Al superarlo, error `133016` y el número queda bloqueado para registrar durante las **72 horas
  siguientes**.
- Decisión de diseño: contar los intentos por canal con su hora y pedir confirmación antes de cada
  reintento, mostrando cuántos quedan.

```json
{
  "error": {
    "message": "(#133016) …",
    "type": "OAuthException",
    "code": 133016,
    "error_data": {
      "messaging_product": "whatsapp",
      "details": "Registration or Deregistration failed because there were too many attempts for this phone number in a short period of time"
    },
    "fbtrace_id": "A1b2C3d4E5f6G7h8"
  }
}
```

El `details` es el oficial [F38]. `message` lleva el código y un título que la tabla oficial no recoge para
este error, así que no se usa en la lógica.

**Cuándo hay que volver a registrar**:

| Caso | Regla |
|---|---|
| **Cambio de nombre aprobado** | Tras el webhook `phone_number_name_update` con `decision: "APPROVED"`, hay **14 días** para volver a registrar. Si pasan sin hacerlo, hay que enviar el nombre a revisión otra vez. Registrar antes de la aprobación no tiene efecto [F10][F23]. |
| Activar, cambiar o quitar el almacenamiento local | Desregistrar y registrar de nuevo [F23]. |
| Después de `deregister` | Hay que registrar para volver a usar el número [F23]. |
| Error `133000` | El desregistro anterior falló: desregistrar otra vez antes de registrar [F38]. |

- El nombre se puede cambiar **10 veces cada 30 días** [F10].
- En el modelo nuevo, volver a registrar un número ya registrado **funciona sin reiniciar el PIN** [F25].
  **No verificado**: la forma de la respuesta que indica que el PIN no se reinició.

### 5.5 Desregistrar: `POST /{PHONE_NUMBER_ID}/deregister`

- **Token**: usuario del sistema. Sin `whatsapp_business_management` responde con el error `200` [F23].
- Respuesta: `{ "success": true }`.
- El número deja de funcionar con la Cloud API y se desactiva el almacenamiento local. **No borra** el
  número ni su historial [F23].
- Mismo límite que el registro: **10 en 72 horas**, error `133016` [F23].
- En el modelo nuevo, cualquier partner con acceso al número puede desregistrarlo [F25].

### 5.6 Checklist: app publicada (Live)

**Qué pide Meta** para pasar la app a Live, según la página de ajustes básicos (actualizada el 18-10-2023)
[F36]:

| Campo | ¿Obligatorio para Live? | Nota |
|---|---|---|
| Nombre visible | Sí | No puede incluir «Facebook», «FB» ni nombres de productos de Meta como **WhatsApp** o Instagram |
| Email de contacto | Sí | Recibe los avisos para desarrolladores |
| URL de condiciones del servicio | Sí | `/legal/terminos` |
| Icono | Sí | Sin logotipos de Meta, **tampoco el de WhatsApp** |
| Categoría | Sí | — |
| Propósito de la app | Sí | — |
| URL de la política de privacidad | Descrita, pero la página no la marca como obligatoria | Se rellena igualmente: `/legal/privacidad` |
| Eliminación de datos (URL o callback) | Descrita, no marcada como obligatoria | Se rellena igualmente: `/legal/eliminacion-datos` |

- Para las apps creadas por casos de uso: panel > **Publicar > Go live** [F35].
- **Verificar la empresa no es necesario para publicar** [F36]. Solo hace falta para acceder a datos que no
  son tuyos.
- **App Review**: no hace falta para un desarrollador directo que solo accede a sus datos [F12].

### 5.7 Checklist: método de pago

- **No hay endpoint documentado** para leer si la Messaging account tiene método de pago.
- Se detecta por el error **`131042`** («error relacionado con el método de pago»). Causas documentadas
  [F38]:
  - no hay cuenta de pago asociada a la WABA;
  - la línea de crédito está por encima del límite, o no está puesta o activa;
  - la WABA está borrada o suspendida;
  - falta la zona horaria o la moneda;
  - hay una solicitud *On Behalf Of* pendiente o rechazada.
- **Por qué importa ahora**:
  - desde el **1-10-2026**, sin método de pago Meta entrega los mensajes de servicio del tramo gratuito y
    deja de entregarlos cuando se agota [F40];
  - la página de novedades de precios pidió añadir el método de pago **antes del 30-09-2026** [F41].
- **No verificado**: qué código de error devuelve Meta cuando deja de entregar por falta de método de
  pago; lo lógico es `131042`.
- Los números y cuentas de prueba **no necesitan método de pago** para enviar plantillas [F33].
- El método de pago se añade en Meta Business Suite > **Billing Hub** (Centro de facturación) >
  Métodos de pago [F41].

### 5.8 Sincronizar plantillas: `GET /{WABA_ID}/message_templates`

- **Token**: usuario del sistema.
- **Parámetros** [F29][F30]:
  - `fields`: `id`, `name`, `language`, `status`, `category`, `components`, `parameter_format`,
    `sub_category`, `previous_category`, `correct_category`, `rejected_reason`, `quality_score`,
    `last_updated_time`, `health_status` y otros de anuncios;
  - `limit`;
  - `after` y `before` (cursores);
  - `status` (por ejemplo `approved`) aparece en los ejemplos de la guía, no en la tabla de la referencia.

Valores [F30][F31]:

| Campo | Valores |
|---|---|
| `category` | `MARKETING`, `UTILITY`, `AUTHENTICATION`. La referencia añade `FREE_SERVICE`, que no se crea desde las guías. |
| `status` | `APPROVED`, `PENDING`, `REJECTED`, `PAUSED`, `DISABLED`, `IN_APPEAL`, `LIMIT_EXCEEDED`, `ARCHIVED`, `DELETED`, `PENDING_DELETION` |
| `parameter_format` | `NAMED` o `POSITIONAL` |
| `quality_score` | `GREEN`, `YELLOW`, `RED`, `UNKNOWN` |

Petición:

`GET /v26.0/100000000000001/message_templates?fields=id,name,language,status,category,parameter_format,components&limit=100`

```json
{
  "data": [
    {
      "id": "600000000000006",
      "name": "recordatorio_cita",
      "language": "es",
      "status": "APPROVED",
      "category": "UTILITY",
      "parameter_format": "NAMED",
      "components": [
        {
          "type": "BODY",
          "text": "Hola {{nombre}}, te recordamos tu cita el {{fecha}} a las {{hora}}.",
          "example": {
            "body_text_named_params": [
              { "param_name": "nombre", "example": "Ana" },
              { "param_name": "fecha", "example": "3 de octubre" },
              { "param_name": "hora", "example": "10:30" }
            ]
          }
        }
      ]
    }
  ],
  "paging": {
    "cursors": { "before": "QVFIUa...", "after": "QVFIUb..." },
    "next": "https://graph.facebook.com/v26.0/100000000000001/message_templates?after=QVFIUb..."
  }
}
```

- Se recorre `paging.next` hasta que no venga.
- La clave natural de una plantilla es `name` + `language`: el mismo nombre puede existir en varios idiomas
  y borrar por nombre borra todos [F29].
- Las plantillas son de la Messaging account y no se comparten entre Messaging accounts [F25].
- Tras la sincronización inicial, `message_template_status_update` y `template_category_update` mantienen
  la tabla al día sin sondear. Una sincronización completa en cada revisión de 6 h corrige lo que se haya
  perdido (decisión de diseño).
- **Límite de plantillas**: 250 por Messaging account si el portfolio no está verificado; hasta 6.000 si
  está verificado y tiene al menos un número con el nombre aprobado [F26].

---

## 6. Pasos 4 y 5, panel del número y desconexión

### 6.1 Paso 4 · Prueba

«Escribe "hola" a {número}» → el mensaje aparece al llegar → «Enviar respuesta de prueba». La respuesta es
de texto libre dentro de la ventana de 24 h: desde el 1-10-2026 cuenta para el tramo gratuito de servicio
(§9).

### 6.2 Paso 5 · Agente

Agente activo, IA encendida o apagada y modo pruebas «solo a estos números», activado por defecto. No hay
llamadas a Meta.

### 6.3 Diagnóstico guiado (si en 2 minutos no llega nada)

Orden de comprobación (decisión de diseño; todas las llamadas están documentadas):

| # | Comprobación | Cómo | Causa si falla |
|---|---|---|---|
| 1 | La URL de la app es la nuestra | `GET /{PHONE_NUMBER_ID}?fields=webhook_configuration` → `application` (§4.4), o `GET /{APP_ID}/subscriptions` | URL de otra integración o sin configurar |
| 2 | No hay override | Mismo `GET`: sin `phone_number` ni `whatsapp_business_account` | Otra integración desvía los mensajes |
| 3 | `messages` suscrito y activo | `GET /{APP_ID}/subscriptions` → `active` y `fields` | Falta el campo `messages` |
| 4 | La WABA tiene la app suscrita | `GET /{WABA_ID}/subscribed_apps` | Falta `subscribed_apps` |
| 5 | Llegó la verificación `GET` | Hora guardada de la última verificación | URL o token mal copiados, HTTPS no válido |
| 6 | Llegan `POST` con firma inválida | Contador de firmas rechazadas | App Secret incorrecto o de otra app |
| 7 | La app está en Live | Casilla manual (§4.5) | App en desarrollo |
| 8 | El número puede enviar | `health_status` | Bloqueo de cuenta, número o app |

### 6.4 Panel de cada número: semáforos

| Semáforo | Fuente | Verde | Ámbar | Rojo |
|---|---|---|---|---|
| Token | `debug_token` cada 6 h y errores `190`/`0` | Válido, sin caducidad, con los dos permisos | Caduca (`expires_at` > 0) o no es `SYSTEM_USER` | No válido o sin permisos |
| Registro | `status` y errores `133010`/`131045` | `CONNECTED` | `PENDING` u otro | `BANNED`, `DELETED`, `DISCONNECTED` o `RESTRICTED` |
| Suscripción | `GET /{WABA_ID}/subscribed_apps` | Nuestra app en la lista | — | No está |
| Webhook | Última verificación y último `POST` válido; `webhook_configuration` | URL correcta y eventos recientes | Sin eventos en X días | URL distinta u override |
| Último mensaje | `last_inbound_at` | — | — | — (informativo) |
| Calidad | `quality_rating` | `GREEN` | `YELLOW`, `NA` o `UNKNOWN` | `RED` |
| Nombre | `name_status`, `new_name_status` y `phone_number_name_update` | `APPROVED` o `AVAILABLE_WITHOUT_REVIEW` | `PENDING_REVIEW`, `NONE` o nombre aprobado pendiente de volver a registrar (cuenta atrás de 14 días) | `DECLINED` o `EXPIRED` |
| Límite | `whatsapp_business_manager_messaging_limit` y `business_capability_update` | — | — | — (informativo: `TIER_250`, `TIER_2K`, `TIER_10K`, `TIER_100K`, `TIER_UNLIMITED` [F51]) |
| Envío | `health_status.can_send_message` | `AVAILABLE` | `LIMITED` (+ `additional_info`) | `BLOCKED` (+ `errors`) |
| Método de pago | Último `131042` | Sin errores | — | `131042` reciente |
| Versión | `graph_api_version` y tabla de §1 | Sin fecha de fin o más de 6 meses | Menos de 6 meses | Caducada |

Los avisos llegan también por los webhooks de cuenta; su detalle está en el documento de mensajes, §9.

### 6.5 Desconectar

Con confirmación (decisión de diseño):

1. `DELETE /{WABA_ID}/subscribed_apps`, **solo** si ningún otro canal usa esa WABA (§4.3).
2. `POST /{PHONE_NUMBER_ID}/deregister`, contando el intento en el límite de 10 en 72 horas (§5.5).
3. Borrar las credenciales cifradas del canal.
4. No se borra la suscripción de la app (`/{APP_ID}/subscriptions`): la comparten todos sus números.

---

## 7. Número de prueba de Meta

Qué está documentado:

- Al seguir la guía de inicio se crean solos una WhatsApp account, una Messaging account y un **número de
  prueba ya registrado**. No hace falta `request_code`, `register` ni PIN [F5][F26][F33].
- Tiene **límites de mensajes relajados** y **no necesita método de pago** para enviar plantillas [F33].
- Los destinatarios se añaden en el campo «To» de **API Setup** [F32].
- El token temporal de API Setup caduca pronto: para la integración hace falta el token del usuario del
  sistema [F13][F32].
- Los recursos de prueba se pueden borrar desde WhatsApp > Configuración > Test Account, con condiciones
  [F33].

**No verificado** en la documentación actual:

- El tope de **5 destinatarios** y que cada destinatario tenga que confirmarse con un código. Aparece en
  guías de terceros, no en las páginas oficiales actuales.

Consecuencias para el asistente (decisión de diseño):

- La opción «número de prueba de Meta» del paso 0 se salta el paso 3 salvo la suscripción y el checklist.
- El modo pruebas («solo a estos números») se precarga con los destinatarios que el usuario haya añadido
  en API Setup.

---

## 8. Límites de Meta

Para mostrar en la interfaz y en `docs/guia-whatsapp.md`:

| Límite | Valor | Fuente |
|---|---|---|
| **Límite de mensajes** (*messaging limit*) | Usuarios únicos a los que el negocio puede entregar mensajes **fuera de la ventana de atención** (en la práctica, plantillas) en **24 h móviles**. Se fija **por portfolio** y lo comparten todos sus números. Portfolio nuevo: **250**. Responder dentro de la ventana no cuenta. | [F8] |
| Escalado a 2.000 | Por uno de estos caminos: verificar la empresa, o entregar 2.000 mensajes fuera de la ventana a usuarios únicos en 30 días con plantillas de alta calidad. Después Meta analiza la calidad y lo aprueba o no. | [F8] |
| Escalado automático | 2.000 → **10.000 → 100.000 → ilimitado**. Sube un nivel en menos de 6 h si la calidad es alta y en los últimos 7 días se usó al menos la mitad del límite. | [F8] |
| **Números registrados** | Portfolio nuevo: **2**. Pasa a **20** al verificar la empresa o al alcanzar el límite de 2.000. Aviso por `business_capability_update` (`max_phone_numbers_per_business`). | [F5] |
| Nombre visible | Siempre en el perfil. En la cabecera del chat y en la lista de chats **solo cuando el nombre está aprobado**, y esa revisión se hace sola al subir de límite. Mientras, `health_status` puede salir `LIMITED` por el nombre. | [F10][F6] |
| Cambios de nombre | 10 cada 30 días. | [F10] |
| **Apps por persona** | Máximo **15 apps** con rol de desarrollador o administrador que no estén conectadas a una empresa verificada. Las archivadas cuentan. | [F37] |
| Plantillas | 250 por Messaging account sin verificar; hasta 6.000 verificada y con nombre aprobado. | [F26] |
| Rendimiento | 80 mensajes/s por número; subida automática a 1.000 (error `130429`). Detalle en el documento de mensajes. | [F9] |
| Llamadas de gestión | 200/h por app y WABA; 5.000/h con un número registrado. | [F33] |

Matices sobre la especificación:

- La cifra «2 números» es **por portfolio** en la guía de números [F5]. La página del modelo nuevo de
  cuentas habla de 2 números **por jerarquía de WhatsApp accounts** y de 20 jerarquías por portfolio [F26].
  Las dos dicen que el tope sube a 20.
- Verificar la empresa no es necesario para empezar. Sí para escalar el límite por la vía rápida y para
  salir del tope de 15 apps.

---

## 9. Precios (a 2026-09-26)

**Regla del producto**: las tarifas **nunca van en el código**. Se editan en Ajustes por mercado y
categoría, con enlace a las tablas oficiales:

- Tablas de tarifas (CSV y PDF por moneda) y tramos por volumen: página de precios, secciones «Rate cards
  and volume tiers» y «Rate cards effective October 1, 2026» [F40].
- Tabla interactiva: `https://business.whatsapp.com/products/platform-pricing#rates` [F44].
- Meta solo cambia precios el 1 de enero, abril, julio u octubre, con un mínimo de un mes de aviso para las
  tarifas [F40].

### 9.1 Modelo actual (hasta el 30-09-2026)

- Precio **por mensaje entregado** desde el 01-07-2025. La tarifa depende de la categoría de la plantilla y
  del prefijo del destinatario [F40].
- Gratis: todos los mensajes que no son plantilla (dentro de la ventana de 24 h) y las plantillas de
  utilidad dentro de la ventana [F40].
- Gratis también todo lo enviado dentro de una **ventana de entrada gratuita** (72 h tras responder a quien
  escribió desde un anuncio Click to WhatsApp o un botón de una página de Facebook) [F40].

### 9.2 Cambios del 1-10-2026 (verificado en la página de precios, actualizada el 10-09-2026)

| Qué | Desde el 1-10-2026 | Fuente |
|---|---|---|
| **Mensajes de servicio** (texto libre dentro de la ventana, escritos por una persona o por una IA de terceros como la nuestra) | Se cobran **por mensaje**, a la **misma tarifa que utilidad y autenticación** de cada mercado. Sin tramos por volumen. | [F40][F41] |
| **Tramo gratuito** | **1.000 mensajes de servicio entregados al mes por número**, compartidos entre 1:1 y grupos. No se acumulan y se reinician cada mes. Solo para servicio. | [F40] |
| **Plantillas de utilidad dentro de la ventana** | Se cobran. Estaban gratis desde el 01-07-2025. **No tienen tramo gratuito.** | [F40][F41] |
| Ventana de entrada gratuita (72 h) | Sin cambios: sigue siendo gratis. | [F41] |
| Sin método de pago | Se entregan los mensajes de servicio del tramo gratuito y **no** los siguientes. | [F40] |

- **Meta Business Agent** (el agente de IA de la propia Meta): se cobra por tokens desde el 01-08-2026.
  **No lo usamos**: nuestras respuestas de IA son mensajes de servicio [F41].
- **Tarifas de «AI Providers»**: se aplican a proveedores de IA de propósito general (§10), no a negocios
  que usan IA para atender a sus clientes. Categoría `general_purpose_ai` en los webhooks [F42].

### 9.3 El objeto `pricing` de los estados

Llega con el estado `sent` y con `delivered` o `read` [F43]:

| Campo | Valores |
|---|---|
| `pricing_model` | `PMP` (por mensaje). `CBP` solo en webhooks anteriores al 01-07-2025. |
| `type` | `regular` (se cobra), `free_customer_service`, `free_entry_point`, `free_group_customer_service` |
| `category` | `service`, `utility`, `marketing`, `marketing_lite`, `authentication`, `authentication-international`, `referral_conversion`, `group_service`, `group_utility`, `group_marketing` |
| `billable` | Booleano. **Se deprecará**: usar `type` + `category` [F43]. |

Ejemplos del cambio [F40]:

```json
{ "billable": false, "pricing_model": "PMP", "type": "free_customer_service", "category": "service" }
```

(servicio dentro del tramo gratuito, antes y después del 1-10-2026)

```json
{ "billable": true, "pricing_model": "PMP", "type": "regular", "category": "service" }
```

(servicio con el tramo gratuito agotado, desde el 1-10-2026)

```json
{ "billable": true, "pricing_model": "PMP", "type": "regular", "category": "utility" }
```

(plantilla de utilidad dentro de la ventana, desde el 1-10-2026)

**Coste estimado**: la regla completa está en el documento de mensajes (§8.3). Lo esencial:

- Si `type` es `regular`, se aplica la tarifa editable de (mercado, `category`). Si empieza por `free_`,
  el coste es 0.
- **No hay que contar nosotros los 1.000 gratuitos**: Meta ya lo indica en `type`. Un contador propio
  descontaría dos veces.

---

## 10. Política: asistentes de IA de propósito general

Lo verificado en fuentes de Meta:

- Los términos de WhatsApp Business se actualizaron el **15-01-2026**. Definen «AI Providers»: proveedores y
  desarrolladores de tecnologías de IA o aprendizaje automático, como grandes modelos de lenguaje,
  plataformas de IA generativa o **asistentes de IA de propósito general** [F42].
- **Desde el 15-01-2026**, los AI Providers solo pueden ofrecer asistentes de IA de propósito general en la
  plataforma **donde la ley obligue a Meta a permitirlo** [F42].
- En esos países Meta les cobra cada mensaje que no es plantilla (desde el 16-02-2026): Brasil desde el
  11-03-2026; los países de la UE y el EEE del 11-03 al 12-05-2026; Italia del 16-02 al 12-05-2026 [F42].
- La política de mensajería de WhatsApp Business (actualizada el 23-09-2026, según la propia página) permite
  automatizar las respuestas dentro de la ventana de 24 h, **siempre que haya vías claras y rápidas para
  pasar a una persona**: agente en el chat, teléfono, email, web, tienda o formulario [F46].

**No verificado literalmente**: el texto de los términos según el cual la prohibición se aplica cuando la
IA es la funcionalidad **principal** y no algo accesorio a un servicio del negocio. La página de los
términos no se pudo cargar (se genera con JavaScript). Esa lectura la recogen guías de terceros y encaja
con la página oficial de precios para AI Providers [F42].

**Qué está permitido y qué hace DominIA Agentes**:

- Permitido: bots de atención y reservas de un negocio concreto, limitados a sus temas.
- La especificación ya lo cumple con las reglas de la plataforma (§7): solo temas del negocio, redirigir
  con amabilidad lo demás y traspaso a una persona siempre disponible (`transferir_a_humano`).
- La interfaz y las plantillas de agente **nunca** deben presentar el agente como un asistente general.

---

## 11. MCP oficial «WhatsApp Business Tools»

**Verificado**: existe, es de Meta, se anunció el **15-09-2026** y está en **beta** [F47][F48][F50].

| Dato | Valor |
|---|---|
| Qué es | Servidor MCP remoto para que un agente (Claude, Codex, Cursor, ChatGPT) gestione una integración de la Cloud API **actuando como el usuario** |
| Endpoint | `https://mcp.facebook.com/whatsapp_business_tools` (Streamable HTTP) |
| Autenticación | OAuth con la cuenta de desarrollador de Meta; en el consentimiento se eligen los negocios y las apps |
| Permisos que pide | `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging` |
| Estado | Beta, despliegue gradual: puede no estar disponible para todos todavía |
| Uso previsto | **Desarrollo y pruebas, no envío en producción a escala** [F50] |

**Instalación en Claude Code** [F47]:

1. `claude mcp add --transport http whatsapp_business_tools https://mcp.facebook.com/whatsapp_business_tools`
2. En una sesión, `/mcp`, elegir `whatsapp_business_tools` y autenticarse en el navegador.
3. Comprobar pidiendo la lista de herramientas y una lectura de bajo riesgo, por ejemplo
   `whatsapp_biz_businesses`.
4. Hay que repetir el inicio de sesión al reiniciar el cliente.

**Requisitos** [F47]:

- Ser administrador del negocio.
- Tener una app con WhatsApp en ese negocio y ser **administrador de la app**, no solo del negocio.
- Haber aceptado las condiciones de la Cloud API en ese negocio.

**Herramientas** (prefijo `whatsapp_biz_`) [F47]:

| Grupo | Herramientas |
|---|---|
| Descubrir | `businesses`, `accounts`, `phone_numbers` |
| Alta del número | `add_phone_number`, `send_verification_code`, `verify_phone_number`, `register_phone_number` |
| Plantillas | `list_templates`, `get_template`, `create_template`, `update_template`, `delete_template` |
| Mensajes | `send_message` (pide confirmación del destino antes de enviar) |
| Webhooks | `configure_webhooks` (URL, verify token y campos de la app), `subscribe_webhook` (suscribe una WABA a la app) |
| Cuenta | `configure_payments`, `verify_business`, `system_user_token` (devuelve un enlace a Usuarios del sistema; **no genera el token**) |

**Cómo encaja en la skill `conectar-whatsapp`** (decisión de diseño):

- Se usa, si está disponible, para las tareas del lado de Meta: listar cuentas, alta y verificación del
  número, webhooks y plantillas.
- El token permanente y el App Secret los sigue copiando el negocio en la interfaz de DominIA Agentes. El
  MCP no los entrega.
- Cada acción que cambia algo (registrar, suscribir, enviar) se confirma con el usuario.
- Riesgo que Meta avisa: el agente puede hacer todo lo que permiten los permisos concedidos, incluso si
  contenido no fiable (webhooks, documentos, webs) le inyecta instrucciones. No conceder permisos de
  gestión a agentes que procesan contenido no fiable [F48].

**Relacionado**: el MCP «Meta Social Technologies» (`https://mcp.facebook.com/devtools`) gestiona las
suscripciones de webhooks de una app (`devtools_webhook_manage`, con permiso *Manage*) y revisa el estado de
la app [F49]. Es otra vía para el paso 2 desde Claude Code.

**Aviso**: el paquete npm `meta-mcp` que circula en guías de terceros **no es oficial**.

---

## 12. Errores

Solo códigos de la tabla oficial de la Cloud API [F38], más los generales de Graph API [F39] y `136024`
[F5]. Tipo:

- **Permanente**: no se reintenta; hay que corregir algo.
- **Reintentable**: reintento automático con espera exponencial.
- **Espera**: no reintentar hasta que pase el tiempo indicado.

Meta recomienda basar la lógica en `code` y en `error_data.details`, no en el título ni en el
`error_subcode`, que no se devuelve desde v16.0 [F38]. Si llega `is_transient: true`, se trata como
reintentable [F4].

| Código | Significado | Mensaje en español | Acción | Tipo |
|---|---|---|---|---|
| `0` | No se pudo autenticar: token caducado, invalidado o bloqueado | «La conexión con Meta ha caducado. Genera un token nuevo.» | Semáforo Token en rojo; «Cambiar token» | Permanente |
| `1` | Petición no válida o error del servidor | «Meta ha devuelto un error. Lo reintentamos.» | Reintento limitado; después, revisar la petición | Reintentable |
| `2` | Caída temporal o sobrecarga | «Meta no está disponible ahora mismo. Lo reintentamos.» | Reintento con espera | Reintentable |
| `3` | Problema de capacidad o permisos | «La app no tiene permiso para esta operación.» | Revisar permisos del token | Permanente |
| `4` | La app superó su límite de llamadas | «Demasiadas consultas a Meta. Lo reintentamos más tarde.» | Espaciar llamadas | Reintentable |
| `10` | Permiso no concedido o retirado | «Al token le falta un permiso.» | Nuevo token con los permisos de §2.3 | Permanente |
| `100` | Parámetro no admitido, mal escrito, o ID que no coincide | «Algún dato no es correcto (por ejemplo, el Phone Number ID).» | Revisar datos; si es nuestro, error de programación | Permanente |
| `190` | Token caducado | «El token ha caducado. Genera uno permanente.» | «Cambiar token» | Permanente |
| `200` | Sin token («Provide valid app ID»); o el usuario del sistema sin acceso al activo | «El token no tiene acceso a esta cuenta o a este número.» | Revisar activos del usuario del sistema | Permanente |
| `200`–`299` | Permiso no concedido o retirado | «Al token le falta un permiso.» | Revisar permisos | Permanente |
| `368` | WABA restringida o desactivada por incumplir una política | «Meta ha restringido la cuenta de WhatsApp por su política.» | Aviso al propietario; ver Business Support | Permanente |
| `80007` | La WABA alcanzó su límite de llamadas | «Demasiadas consultas a Meta. Lo reintentamos más tarde.» | Espaciar llamadas | Reintentable |
| `130429` | Límite de rendimiento de mensajes | «Estamos enviando demasiado rápido; se reintentará.» | Reintento con espera | Reintentable |
| `130472` | No enviado por formar parte de un experimento de Meta | «Meta no ha enviado este mensaje (experimento de marketing).» | Marcar fallido | Permanente |
| `131000` | Error desconocido | «No se pudo enviar por un error de Meta.» | Reintento limitado; si sigue, fallido | Reintentable |
| `131005` | Permiso no concedido o retirado | «Al token le falta un permiso.» | Revisar permisos | Permanente |
| `131008` | Falta un parámetro obligatorio | «No se pudo enviar: falta un dato.» | Error de programación | Permanente |
| `131009` | Valor de parámetro no válido | «No se pudo enviar: algún dato no es válido.» | Error de programación o número no añadido | Permanente |
| `131016` | Servicio no disponible temporalmente | «WhatsApp no está disponible ahora mismo. Lo reintentamos.» | Reintento con espera | Reintentable |
| `131021` | Remitente y destinatario son el mismo número | «No se puede enviar un mensaje al propio número del negocio.» | Marcar fallido | Permanente |
| `131026` | No entregable: no es número de WhatsApp, condiciones sin aceptar o app antigua | «No se pudo entregar: el cliente no tiene WhatsApp o debe actualizarlo.» | Fallido; contactar por otra vía | Permanente |
| `131031` | Cuenta bloqueada por política, o dato que no coincide con la cuenta (p. ej., PIN incorrecto) | «La cuenta está bloqueada o el PIN no es correcto.» | Revisar `health_status`; revisar PIN | Permanente |
| `131042` | Problema con el método de pago | «Falta un método de pago válido en WhatsApp Manager.» | Semáforo Pago en rojo (§5.7) | Permanente |
| `131045` | Error de registro del número | «El número no está registrado. Termina el paso de activación.» | Volver al paso 3 | Permanente |
| `131047` | Más de 24 h desde el último mensaje del cliente | «La ventana de 24 h está cerrada. Usa una plantilla aprobada.» | La bandeja pide plantilla | Permanente |
| `131048` | Restricción por spam o calidad | «Meta limita los envíos de este número por su calidad.» | Aviso de calidad | Permanente |
| `131049` | No entregado para mantener sano el ecosistema (límite de marketing por usuario) | «Meta no ha entregado esta plantilla de marketing a este cliente.» | No reintentar antes de 24 h | Espera |
| `131051` | Tipo de mensaje no admitido | «Este tipo de mensaje no se puede enviar.» | Error de programación | Permanente |
| `131052` | No se pudo descargar el medio enviado por el cliente | «No se pudo descargar el archivo del cliente.» | Aviso en la conversación | Permanente |
| `131053` | No se pudo subir el medio | «El archivo no tiene un formato admitido.» | Revisar formato | Permanente |
| `131056` | Demasiados mensajes al mismo cliente en poco tiempo | «Demasiados mensajes seguidos a este cliente; se reintentará.» | Reintento a los 4^X s | Reintentable |
| `131057` | Cuenta en mantenimiento (p. ej., subida de rendimiento) | «WhatsApp está en mantenimiento para este número; se reintentará.» | Reintento | Reintentable |
| `132000` | Número de variables distinto del de la plantilla | «La plantilla necesita otro número de datos.» | Revisar variables en Ajustes | Permanente |
| `132001` | Plantilla inexistente en ese idioma o sin aprobar | «La plantilla no existe en ese idioma o no está aprobada.» | Sincronizar plantillas | Permanente |
| `132005` | Texto traducido demasiado largo | «La plantilla traducida es demasiado larga.» | Revisar en WhatsApp Manager | Permanente |
| `132007` | El contenido de la plantilla incumple una política | «La plantilla incumple la política de WhatsApp.» | Revisar plantilla | Permanente |
| `132012` | Variables con formato incorrecto | «Los datos de la plantilla no tienen el formato esperado.» | Revisar variables | Permanente |
| `132015` | Plantilla en pausa por baja calidad | «La plantilla está en pausa por baja calidad.» | Editarla y esperar aprobación | Permanente |
| `132016` | Plantilla desactivada para siempre por pausas repetidas | «La plantilla está desactivada. Crea otra.» | Crear una nueva | Permanente |
| `132068` | Flow bloqueado | «El formulario (Flow) está bloqueado.» | Corregir el Flow | Permanente |
| `132069` | Flow limitado: ya se enviaron 10 mensajes con él en la última hora | «El formulario (Flow) está limitado temporalmente.» | Esperar y corregir | Espera |
| `133000` | Falló un desregistro anterior | «Hay un desregistro a medias. Hay que desregistrar de nuevo.» | Desregistrar y registrar | Permanente |
| `133004` | Servidor no disponible temporalmente | «Meta no está disponible ahora mismo. Inténtalo más tarde.» | Reintentar tras revisar `details` | Reintentable |
| `133005` | PIN de verificación en dos pasos incorrecto | «El PIN no es correcto.» | Pedir el PIN o cambiarlo (§5.3) | Permanente |
| `133006` | Hay que verificar el número antes de registrar | «Primero hay que verificar el número con el código.» | `request_code` / `verify_code` | Permanente |
| `133008` | Demasiados intentos de PIN | «Demasiados intentos de PIN. Espera antes de volver a probar.» | Esperar el tiempo de `details` | Espera |
| `133009` | PIN introducido demasiado rápido | «Espera un momento antes de volver a introducir el PIN.» | Esperar según `details` | Espera |
| `133010` | Número no registrado en la plataforma | «El número no está registrado. Termina el paso de activación.» | Volver al paso 3 | Permanente |
| `133015` | Número borrado hace poco; el borrado no ha terminado | «El número se borró hace poco. Espera 5 minutos.» | Reintentar a los 5 min | Espera |
| `133016` | Demasiados registros o desregistros | «Demasiados intentos de registro. Espera 72 horas.» | Bloquear el botón 72 h | Espera |
| `135000` | Error desconocido con los parámetros | «Meta no ha aceptado la petición.» | Revisar sintaxis; soporte si persiste | Permanente |
| `136024` | `request_code` sobre un número ya verificado (HTTP 400) [F5] | «Este número ya está verificado.» | Saltar al registro | Permanente |

Otros códigos oficiales que conviene reconocer [F38]: `33` (número borrado), `130403` (el negocio bloqueó
al usuario), `130497` (cuenta restringida para enviar a ciertos países), `131037` (número 555 sin nombre
aprobado), `131050` (el usuario dejó de recibir marketing), `131063` (marketing desactivado en la Cloud
API) y `131064` (límite por clasificar mal las plantillas).

---

## 13. No verificado o pendiente

| Tema | Estado |
|---|---|
| Forma de la respuesta de `?fields=throughput` | No aparece en la documentación actual |
| `platform_type`, `is_pin_enabled` | No documentados en la referencia actual del número |
| Que la entidad `APP` de `health_status` sea siempre la app del token | Deducción; se confirma con `debug_token` |
| Código de error de `POST /{APP_ID}/subscriptions` si falla la verificación | No documentado |
| Que la `version` de los campos suscritos sea la de la URL de la llamada | No documentado; se comprueba con `GET /{APP_ID}/subscriptions` |
| Campo de la API con el modo de la app (Live o desarrollo) | No encontrado |
| Tope de 5 destinatarios y código de confirmación del número de prueba | Solo en fuentes de terceros |
| Nº de intentos de `request_code` / `verify_code` | La referencia habla de límites sin cifras |
| `POST /{PHONE_NUMBER_ID}` con `pin` en números sin PIN (retirada gradual) | No documentado |
| Respuesta de `register` que indica que el PIN no se reinició | Anunciada, sin ejemplo |
| Código de error al no entregar por falta de método de pago | Probablemente `131042`; sin confirmar |
| Texto literal de los términos sobre IA «principal» frente a «accesoria» | La página oficial no se pudo cargar |

---

## Fuentes

Fechas «act.» = fecha de actualización que muestra la propia página. Consultadas el 2026-09-26.

- [F1] Graph API, versiones: https://developers.facebook.com/docs/graph-api/changelog/versions/ y https://developers.facebook.com/docs/graph-api/changelog
- [F2] Graph API v26.0 (29-07-2026): https://developers.facebook.com/docs/graph-api/changelog/version26.0/
- [F3] Graph API, control de versiones: https://developers.facebook.com/docs/graph-api/guides/versioning/
- [F4] WhatsApp Business Phone Number API (referencia): https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/whatsapp-business-account-phone-number-api
- [F5] Business phone numbers (act. 21-05-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers
- [F6] Messaging and Calling Health Status (act. 17-06-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/support/health-status/
- [F7] Phone Numbers API de la WABA (referencia): https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/phone-number-management-api
- [F8] Messaging limits (act. 21-05-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
- [F9] Throughput (act. 17-06-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput
- [F10] Display names (act. 16-06-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names
- [F11] Graph API, `debug_token`: https://developers.facebook.com/docs/graph-api/reference/debug_token/
- [F12] WhatsApp permissions (act. 01-07-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions
- [F13] Access tokens de WhatsApp (act. 19-09-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens
- [F14] Access tokens (token de app): https://developers.facebook.com/documentation/facebook-login/guides/access-tokens
- [F15] Create a webhook endpoint (act. 17-06-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint
- [F16] Graph API, `/{app-id}/subscriptions`: https://developers.facebook.com/docs/graph-api/reference/app/subscriptions/
- [F17] Webhooks, Subscriptions Edge: https://developers.facebook.com/docs/graph-api/webhooks/subscriptions-edge/
- [F18] Webhooks, Getting Started: https://developers.facebook.com/docs/graph-api/webhooks/getting-started/
- [F19] n8n, nodo WhatsApp Trigger: https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/WhatsApp/WhatsAppTrigger.node.ts y https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/WhatsApp/GenericFunctions.ts
- [F20] Subscribed Apps API (referencia): https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/subscribed-apps-api
- [F21] Webhook overrides (act. 28-06-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override
- [F22] WhatsApp webhooks (act. 26-06-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview
- [F23] Register a business phone number (act. 26-06-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration
- [F24] Two-Step Verification (act. 28-06-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/two-step-verification
- [F25] Updates to WhatsApp Business accounts (act. 22-09-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution
- [F26] WhatsApp accounts and Messaging accounts (act. 05-08-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/whatsapp-business-accounts
- [F27] Request Code API y Verify Code API (referencias): https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/phone-number-verification-request-code-api y https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/verify-code-api
- [F28] Supported languages (act. 21-05-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/supported-languages
- [F29] Template management (act. 02-07-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-management
- [F30] Message Template API (referencia): https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api
- [F31] Template categorization (act. 15-09-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization
- [F32] Cloud API Get Started (act. 16-06-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started
- [F33] About the WhatsApp Business Platform (act. 04-08-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform
- [F34] App Modes (act. 05-05-2025): https://developers.facebook.com/documentation/development/build-and-test/app-modes
- [F35] Publish (act. 05-05-2025): https://developers.facebook.com/documentation/development/release
- [F36] Basic Settings (act. 18-10-2023): https://developers.facebook.com/documentation/development/create-an-app/app-dashboard/basic-settings
- [F37] Create an App, límite de 15 apps (act. 16-09-2025): https://developers.facebook.com/documentation/development/create-an-app
- [F38] Error codes de la Cloud API (act. 18-06-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
- [F39] Graph API, gestión de errores: https://developers.facebook.com/docs/graph-api/guides/error-handling/
- [F40] Pricing on the WhatsApp Business Platform (act. 10-09-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- [F41] Upcoming pricing updates for Meta Business Agent, service and utility messages (act. 25-08-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages
- [F42] Pricing policy for AI Providers (act. 01-09-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers
- [F43] Webhook de estados (act. 14-09-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status
- [F44] Tarifas interactivas: https://business.whatsapp.com/products/platform-pricing#rates
- [F45] WhatsApp Business Solution Terms (no se pudo cargar el contenido): https://www.whatsapp.com/legal/business-solution-terms/
- [F46] WhatsApp Business Messaging Policy (act. 23-09-2026, según la página): https://business.whatsapp.com/policy
- [F47] WhatsApp Business Tools MCP (act. 03-09-2026): https://developers.facebook.com/documentation/mcp/whatsapp-business-tools-mcp
- [F48] Connect AI Agents to Meta with MCP (act. 12-06-2026): https://developers.facebook.com/documentation/mcp
- [F49] Meta Social Technologies MCP (act. 08-09-2026): https://developers.facebook.com/documentation/mcp/devtools-mcp
- [F50] Blog de Meta for Developers, 15-09-2026: https://developers.facebook.com/blog/post/2026/09/15/whatsapp-business-messaging-mcp-ai-agent/
- [F51] Webhooks `business_capability_update`, `phone_number_quality_update` y `phone_number_name_update` (act. 21-05 y 17-06-2026): https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/business_capability_update
- [F52] WhatsApp Business Account API (referencia): https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/whatsapp-business-account-api
- [F53] Especificación OpenAPI de Meta (v23.0): https://github.com/facebook/openapi
- [F54] Embedded Signup, gestionar cuentas (`granular_scopes`): https://developers.facebook.com/docs/whatsapp/embedded-signup/manage-accounts/
- [F55] Access tokens, depuración: https://developers.facebook.com/docs/facebook-login/access-tokens/debugging-and-error-handling
