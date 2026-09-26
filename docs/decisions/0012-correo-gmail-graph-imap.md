# 0012 · Correo: API de Gmail, Microsoft Graph e IMAP/SMTP, con credenciales de cada negocio

- **Estado:** aceptada
- **Fecha:** 2026-09-26

## Contexto y problema

La app tiene que atender buzones de cualquier servidor: Gmail, Outlook o Microsoft 365, y el correo del hosting
del negocio. Por defecto la IA deja un borrador que una persona aprueba, la respuesta sale en el mismo hilo, se
ignoran los boletines y las respuestas automáticas, y si una persona contesta desde su correo la IA se pausa.
Había que decidir cómo se conecta cada tipo de buzón.

Datos comprobados el 26-09-2026 (`docs/integracion-correo.md`):

- Gmail y Microsoft ya no aceptan la contraseña normal por IMAP/SMTP en la mayoría de cuentas: en Google
  Workspace, desde el 14-03-2025, solo contraseñas de aplicación; en Gmail personal hace falta contraseña de
  aplicación con verificación en dos pasos; en Exchange Online, IMAP y POP con contraseña están desactivados y
  no se pueden reactivar, y el envío SMTP con contraseña se desactiva por defecto a finales de diciembre de
  2026; Outlook.com no admite contraseña desde el 16-09-2024 (§2.6 y §3.1).
- Gmail: `gmail.modify` es un permiso restringido. Un proyecto «External» publicado «En producción» sin
  verificar funciona, con el aviso de app no verificada y un tope de 100 usuarios nuevos; en «Testing» los
  tokens caducan a los 7 días. Google exime de verificación el uso personal de menos de 100 usuarios (§1.1).
- Gmail: `history.list` cuesta 2 unidades de cuota y, si el historial es demasiado antiguo, devuelve 404 y hay
  que sincronizar entero; el hilo exige `threadId`, `In-Reply-To`, `References` y el mismo asunto (§1.4 y §1.5).
- Microsoft: con la app registrada en el tenant del negocio no aplica el bloqueo por «editor no verificado»;
  el secreto de cliente dura como mucho 24 meses; la recepción va por consulta delta de cada carpeta, y
  `/reply` no devuelve el id del mensaje enviado, así que se usa `createReply`, se edita y se envía (§2).
- IMAP/SMTP: ImapFlow 2 y Nodemailer 10 piden Node 20 o posterior; ImapFlow no se reconecta solo (§3). Vercel
  bloquea el puerto 25 de salida; el 465 y el 587 funcionan (`docs/plataforma-despliegue.md`, «Correo desde
  Vercel»).
- Según la RFC 3834, `Auto-Submitted: auto-replied` no debe ir en mensajes que una persona ha revisado: solo
  se pone en el modo «Automático» (§4.2).

## Opciones consideradas

- **Solo IMAP/SMTP con contraseña para todos:** no sirve para Microsoft 365 ni para Outlook.com, que para
  leer el correo solo admiten OAuth, y en Gmail obliga a contraseñas de aplicación.
- **Un servicio intermediario de correo:** otra cuenta, otro coste y otro encargado de datos (no evaluado).
- **Tres conectores:** API de Gmail y Microsoft Graph con OAuth y credenciales propias de cada negocio, e
  IMAP/SMTP para el resto.

## Decisión

Tres conectores detrás de la interfaz común de canales:

- **Gmail:** API de Gmail con OAuth y el proyecto de Google Cloud del propio negocio («Internal» si tiene
  Workspace; «External» publicado «En producción» sin verificar si es @gmail.com; nunca «Testing»). Permisos
  `gmail.modify` más `openid` y `email`, comprobando cuáles se concedieron.
- **Outlook / Microsoft 365:** Microsoft Graph con OAuth y una app de Microsoft Entra registrada en el tenant
  del negocio, con los permisos delegados `Mail.ReadWrite`, `Mail.Send`, `offline_access` y `User.Read`.
- **Otro:** IMAP y SMTP con contraseña o contraseña de aplicación, autocompletados por dominio, sin proponer
  nunca el puerto 25.
- La recepción se hace por sondeo en cada ronda de `tick()` (0008): `history.list` en Gmail, consulta delta en
  Outlook y UIDs nuevos en IMAP. En el VPS, IMAP IDLE será opcional.
- Nunca una app de Google o de Microsoft compartida entre negocios. Los tokens y contraseñas van cifrados; si
  caducan o se revocan, el canal pasa a «Requiere reconexión».
- Las URL de Google y Microsoft salen de variables de entorno (`GOOGLE_OAUTH_BASE_URL`, `GOOGLE_API_BASE_URL`,
  `MS_LOGIN_BASE_URL`, `MS_GRAPH_BASE_URL`) para que las pruebas usen un simulador.

## Consecuencias

- Gana: el negocio no entrega la contraseña de su buzón en Gmail ni en Microsoft y puede revocar el acceso; no
  hay una app común que verificar ni un tope de usuarios que repartir entre negocios; Gmail y Outlook dan
  sincronización barata, borradores visibles en el propio buzón y el hilo correcto.
- Acepta: el negocio crea su proyecto de Google Cloud o su app de Entra (guía de correo y skill
  `conectar-correo`), y los usuarios de @gmail.com ven el aviso de app no verificada.
- Acepta: tres caminos de código que probar, y avisar antes de que caduque el secreto de Microsoft.
- Acepta: con sondeo, un correo tarda en verse lo que tarde la siguiente ronda de `tick()`.
- Acepta: la redirección de OAuth usa el dominio de la instalación; conectar buzones reales se comprueba al
  publicar (0007).
