# 0029 · Instagram: los mensajes directos con la app de Meta del propio negocio y su token

- **Estado:** aceptada (encargo del propietario del 2026-10-16: «conectar con el canal de Instagram correctamente como
  WhatsApp y que permita una integración sencilla… solo DM, un agente que responda a DMs y que permita también dar
  respuesta en la bandeja de entrada»; pidió hacerlo sin preguntas, así que las elecciones de abajo son las más
  sencillas y quedan para que las revise)
- **Fecha:** 2026-10-16

## Contexto y problema

Instagram estaba fuera del alcance (`docs/spec.md`, «Qué queda fuera»). El encargo pide atender los mensajes directos
de la cuenta del negocio con un agente y desde la bandeja, con una conexión tan sencilla como la de WhatsApp. Meta
ofrece dos formas de usar los mensajes de Instagram, comprobadas el 16-10-2026 en su documentación oficial
(`docs/integracion-instagram.md`):

- **Con inicio de sesión de Instagram** (`graph.instagram.com`): sin página de Facebook; la app de Meta es del negocio;
  el token se genera en el panel de la app y dura 60 días, renovable.
- **Con inicio de sesión de Facebook** (Messenger API para Instagram, `graph.facebook.com`): la cuenta tiene que estar
  enlazada a una página de Facebook y el token es de la página.

## Opciones consideradas

- **Con página de Facebook:** un paso más para el negocio (enlazar la página) y otro token distinto.
- **Con inicio de sesión de Instagram y un botón «Conectar con Instagram»** (OAuth): exige registrar direcciones de
  vuelta en la app de Meta y, para cuentas sin rol en la app, la revisión de Meta. Para una sola cuenta del propio
  negocio no aporta nada.
- **Con inicio de sesión de Instagram y el token del panel**, pegado en el asistente como el de WhatsApp.

## Decisión

- **Conexión:** el negocio crea su app de Meta (tipo «Business») con el producto Instagram, añade su cuenta profesional,
  genera el token en el panel y lo pega en el asistente con la clave secreta de Instagram de la app (y, si quiere, la
  de la app de Meta). La app comprueba el token (`GET /me`), suscribe la cuenta a los mensajes
  (`POST /me/subscribed_apps`) y enseña la dirección de avisos y el token de verificación para pegarlos en Meta.
- **Una dirección de avisos por canal** (`/api/webhooks/instagram/{canal}`), con su token de verificación cifrado.
  **Firma:** Meta solo dice «App Secret» y el panel da dos claves (la de la app de Meta y la de Instagram); la app
  acepta el aviso si cualquiera de las dos guardadas da la firma, antes de leer nada (como hizo con WhatsApp).
- **Solo texto** al responder (la IA y las personas). Se reciben texto, notas de voz, imágenes y PDF; lo demás, como
  «Tipo de mensaje no admitido». De una mención en una historia no se guarda nada (lo exige Meta).
- **Ventana de 24 h sin la etiqueta de agente humano** (que exige la revisión de Meta y verificar la empresa): fuera de
  ella no se responde. Por eso Instagram no entra en recordatorios ni envíos.
- **Lo que el negocio contesta desde Instagram** llega como «eco» y entra en la conversación «Desde Instagram», pausando
  la IA. El eco se atiende al momento, dentro del aviso y antes que los mensajes del cliente que vengan con él, para
  que la IA quede en pausa antes de contestar. Para no confundirlo con lo que envía la propia app, si su identificador
  ya es de un mensaje de la app, o su texto es el de un mensaje que la app está enviando a ese cliente o le entregó a
  Instagram hace un momento (cuenta cuándo se entregó, no cuándo se escribió: un borrador aprobado o un «Reintentar»
  pueden ser de mucho antes), se ignora. Si aun así un eco con el identificador del envío llega antes que su respuesta
  y se toma por del negocio, al terminar el envío se quita y la pausa vuelve a como estaba.
- **Token:** se renueva solo cada semana (`GET /refresh_access_token`); si Instagram rechaza el token (no válido,
  caducado, revocado o sin un permiso), el canal pasa a «error» y avisa; otro fallo se reintenta en la siguiente
  revisión y solo es «error» cerca de su fin.
- **Sin dirección pública** (en local) Meta no puede avisar: como WhatsApp, recibe cuando la app está publicada con
  HTTPS; la demo trae una cuenta de Instagram de demo y el simulador escribe por ella.
- **Bandeja:** cada conversación enseña en texto el tipo y el nombre de su canal, además del icono ([BAN-17]). El icono
  de Instagram es uno genérico (`camera`), porque Lucide no tiene logotipos y DESIGN.md no usa marcas fuera de WhatsApp.

## Consecuencias

- Conectar Instagram es como conectar WhatsApp con Meta: una app de Meta, un token y una clave, sin páginas de
  Facebook ni flujos de inicio de sesión que mantener.
- **Lo que hay que comprobar con una cuenta real** (la documentación de Meta se contradice o no lo dice, ver
  `docs/integracion-instagram.md` §12): que lleguen los avisos de clientes sin rol en la app con el acceso estándar
  (si no, hay que pedir la revisión de Meta como «app para tu propio negocio», con la empresa verificada); que la app
  se pueda publicar sin verificar la empresa; qué clave firma los avisos; que los mensajes escritos en la app de
  Instagram lleguen como eco. La guía del negocio pide probar primero con una cuenta de Instagram ajena a la app.
- No se responde pasadas 24 horas ni se envían imágenes o archivos; si hiciera falta, sería otra fase.
