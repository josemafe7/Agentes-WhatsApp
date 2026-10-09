# 0026 · WhatsApp se conecta de tres formas: Meta directo, YCloud (coexistencia) y código QR (Baileys)

- **Estado:** aceptada (encargo del propietario del 2026-10-09; cambia en parte la 0011)
- **Fecha:** 2026-10-09

## Contexto y problema

Hasta ahora WhatsApp solo se conectaba con la API oficial de Meta y la app de Meta del propio negocio (0011): es lo
más sólido, pero pide portfolio, app, token y varios pasos en Meta, y el número deja de funcionar en la app del
móvil. La regla del proyecto prohibía cualquier otra vía («Nunca Embedded Signup, coexistencia, APIs no oficiales
ni…»).

El propietario pidió que, al añadir un canal, se pueda elegir entre tres formas de conectar un número: la de
ahora, sin cambios; una con **coexistencia a través de YCloud**; y una con **código QR y Baileys**, escaneando con
el propio móvil. Cambiar esa regla era decisión suya: se le enseñó el texto nuevo y lo aprobó («Las tres vías»), y
aprobó también instalar Baileys 7.0.0-rc14.

Datos comprobados el 09-10-2026 (`docs/integracion-ycloud.md`, `docs/integracion-whatsapp-qr.md`):

- YCloud es partner oficial de Meta: su API es la oficial (plantillas, ventana de 24 horas, precios de Meta) y
  permite la coexistencia con la app WhatsApp Business. El alta del número se hace en su consola; no tiene API.
- Baileys no es oficial. WhatsApp avisa de que vincular apps no oficiales puede acabar en un bloqueo temporal o
  permanente. No tiene versión 7 estable y necesita un proceso siempre encendido.

## Opciones consideradas

- **Seguir solo con Meta directo.** No da la coexistencia ni una forma rápida de probar con el número de siempre.
- **Coexistencia propia con Embedded Signup.** Exige ser Tech Provider de Meta: verificación de empresa y revisión
  de la app de quien implanta. Queda fuera, como en la 0011.
- **YCloud como proveedor de la coexistencia.** El negocio crea su cuenta y pega una clave; la app crea sola la
  dirección de avisos.
- **Para el QR: Baileys, Evolution API, Whapi u otros.** Los demás son servicios o servidores aparte que usan
  Baileys por debajo o piden otra cuenta. Baileys se integra dentro de la propia app.
- **Dónde vive la conexión del QR:** en un servicio aparte, en `pnpm worker` o en el propio servidor web.

## Decisión

- **Tres vías, que elige el negocio**, cada una con su asistente y su panel. Se distinguen por el
  `connection_mode` del canal: `manual` (Meta), `ycloud` y `qr`. El tipo de canal sigue siendo `whatsapp`: la
  bandeja, los contactos y los informes no cambian.
- **Meta directo** sigue siendo la recomendada y no cambia.
- **YCloud**: clave de API cifrada, dirección de avisos propia de cada canal creada por la app, firma comprobada
  antes de leer nada. Reutiliza el normalizador, las plantillas y la ventana de 24 horas de la conexión directa.
- **Código QR**: marcada siempre como «No oficial», con un aviso que hay que aceptar, nunca como opción por
  defecto y rechazada donde no puede funcionar (Vercel). Sin plantillas ni ventana de 24 horas.
- **Un número, un canal**, sea cual sea la vía.
- **Un número con conversaciones de siempre empieza en modo pruebas con la lista vacía** (YCloud y QR): la IA no
  contesta a nadie hasta que el negocio lo decide.
- **Lo que el negocio escribe desde su móvil** (coexistencia o QR) entra en la conversación como mensaje de una
  persona y pausa la IA, igual que una respuesta desde la bandeja.
- **La conexión del QR vive en el proceso del servidor web**, que es el único que existe siempre (`pnpm dev` y
  `next start`). En un servidor propio con `pnpm worker`, el trabajador le pide los envíos por una ruta interna
  con el secreto que ya comparten.
- Sigue fuera: Embedded Signup propio, `override_callback_uri`, otros proveedores y otras APIs no oficiales.

## Consecuencias

- Gana: el negocio puede empezar en un minuto con el QR, pasar a YCloud para conservar el móvil con la API oficial,
  o usar Meta directo sin intermediarios. Añadir una vía no tocó el resto de la app.
- Acepta: con el QR, WhatsApp puede bloquear el número y la vía puede dejar de funcionar si WhatsApp cambia su
  protocolo. Queda escrito en el asistente, en el panel y en la guía.
- Acepta: una dependencia en versión candidata (Baileys 7.0.0-rc14) con una librería GPL-3.0 dentro (`libsignal`),
  anotada como excepción D6 en `docs/security.md`. Hay que revisarla cuando salga la 7.0.0 estable.
- Acepta: una tabla nueva (`whatsapp_qr_keys`) y, por tanto, una migración que aplicar en la base publicada.
- Acepta: el QR necesita una sola copia de la app y un proceso siempre encendido; no vale Vercel.
- Acepta: con YCloud hay un intermediario más (y su saldo) entre el negocio y Meta.
- Sustituye, de la 0011, que la conexión directa con Meta sea la única; lo demás de la 0011 sigue valiendo para
  esa vía.
