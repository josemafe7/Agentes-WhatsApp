# 0011 · WhatsApp: Cloud API oficial de Meta como desarrollador directo

- **Estado:** aceptada
- **Fecha:** 2026-09-26

## Contexto y problema

WhatsApp es el canal principal de los negocios a los que va dirigida la app, y cada negocio puede tener uno o
varios números. Hay varias formas de conectarlo: la Cloud API oficial de Meta con la app del propio negocio, el
programa de Tech Provider con Embedded Signup, un proveedor intermediario (BSP), la coexistencia con la app
WhatsApp del móvil o APIs no oficiales. La elección fija qué tiene que hacer el negocio, qué costes tiene y qué
riesgos corre su número.

Datos comprobados el 26-09-2026 (`docs/integracion-whatsapp.md` y `docs/integracion-whatsapp-mensajes.md`):

- Como desarrollador directo, la app de Meta está en el portfolio del negocio y usa un token de usuario del
  sistema que no caduca (`debug_token` devuelve `type: "SYSTEM_USER"` y `expires_at: 0`). No hace falta App
  Review ni verificar la empresa para empezar ni para publicar la app.
- La versión actual de Graph API es la v26.0 (29-07-2026); la v25.0 funciona hasta el 29-07-2028. La versión va
  siempre en la URL.
- Una app tiene una sola URL de callback. `POST /{APP_ID}/subscriptions` está documentado como alternativa en
  la guía de webhooks de WhatsApp, pero la referencia general del endpoint dice que WhatsApp no se admite: se
  intenta y, si falla, se guía a mano. `POST /{WABA_ID}/subscribed_apps` hace falta siempre.
  `override_callback_uri` existe y no se usa.
- Desde el 23-09-2026 la WABA se divide en «WhatsApp account» y «Messaging account». El ID de la WABA pasa a ser
  el de la Messaging account y todo sigue funcionando; en el primer semestre de 2028 las rutas que usan el
  `phone_number_id` pasarán al ID de la WhatsApp account.
- Desde abril de 2026 el identificador fiable del cliente es el BSUID (`user_id`); el teléfono (`wa_id`) puede
  faltar y el BSUID cambia si el cliente cambia de número (llega un aviso para enlazar las dos identidades).
- Webhooks: firma HMAC-SHA256 del cuerpo exacto con el App Secret, reintentos durante 7 días, lotes de hasta
  1.000 actualizaciones y cuerpos de hasta 3 MB; objetivo de respuesta de 250 ms de mediana.
- Precios desde el 01-10-2026: los mensajes de servicio se cobran a la tarifa de utilidad y autenticación de
  cada mercado, con 1.000 gratis al mes por número. Meta marca en cada estado si el mensaje fue gratis
  (`pricing.type`), así que la app no cuenta los 1.000 por su cuenta. Sin método de pago, los mensajes de
  servicio dejan de entregarse al agotar los gratuitos.
- Límites sin verificar la empresa: 250 destinatarios únicos cada 24 h fuera de la ventana de atención y 2
  números; 15 apps por persona que no estén conectadas a una empresa verificada.
- Política: desde el 15-01-2026 los proveedores de IA no pueden ofrecer asistentes de propósito general; los
  bots de atención de un negocio concreto sí están permitidos, con vías claras para pasar a una persona.
- El servidor MCP oficial «WhatsApp Business Tools» (15-09-2026, beta) es para desarrollo y pruebas, no para
  enviar en producción.

## Opciones consideradas

- **Cloud API oficial como desarrollador directo.**
- **Tech Provider con Embedded Signup:** exige entrar en el programa de partners de Meta. El encargo lo deja
  fuera; solo se deja preparado el modo de conexión.
- **Proveedor intermediario (BSP):** otro contrato, otro coste y otro encargado de los datos.
- **Coexistencia con la app del móvil:** según el encargo, Meta la reserva a partners.
- **APIs no oficiales** (Baileys, Evolution, Whapi, conexión por QR): el encargo las excluye.

## Decisión

Solo la Cloud API oficial de Meta, como desarrollador directo, con la app de Meta del propio negocio.

- `connection_mode: 'manual' | 'embedded_signup'` queda en los datos del canal, pero solo se implementa
  `manual`.
- Una URL de webhook por instalación (`/api/webhooks/whatsapp`) con el verify token de la instalación. El canal
  se localiza por `metadata.phone_number_id` (los avisos de cuenta y plantillas, por `entry[].id`, la WABA) y la
  firma se comprueba con el App Secret de ese canal, en tiempo constante.
- El webhook guarda el aviso en bruto, deduplica por `wamid` y responde 200 enseguida; la IA trabaja después
  (0008). Los medios se descargan nada más llegar (0010).
- La versión de Graph API (por defecto v26.0) y los IDs (WABA, app, portfolio, número) se guardan por canal, y
  la URL base sale de `META_GRAPH_BASE_URL` para las pruebas.
- El contacto se identifica por el BSUID o el `wa_id`, nunca por el teléfono.
- El token, el App Secret y el PIN van cifrados (AES-256-GCM).
- Las tarifas por país se editan en Ajustes y nunca van en el código; el coste estimado solo se aplica cuando
  Meta marca el mensaje como de pago.
- El modo pruebas «solo a estos números» viene activado por defecto y la ventana de 24 h se respeta siempre.

## Consecuencias

- Gana: sin programa de partners ni intermediarios; el negocio es dueño de su app, su número y su token.
- Acepta: el negocio (con ayuda de quien implanta) crea su portfolio, su app, su usuario del sistema y su
  método de pago en Meta; lo cubren la guía `docs/guia-whatsapp.md` y la skill `conectar-whatsapp`.
- Acepta: el número deja de funcionar en la app WhatsApp del móvil.
- Acepta: los límites de una empresa sin verificar hasta que el negocio la verifique.
- Acepta: Meta cambia a menudo (modelo de cuentas, precios, retirada del PIN). Por eso los IDs y la versión son
  configurables por canal, cada número se revisa cada 6 horas y los avisos de cuenta llegan por webhook.
- Acepta: sin una URL pública con HTTPS no se puede probar con un número real (0007); en local se usan el canal
  de demo y el simulador.
