# 0028 · Recordatorios, envíos y permisos: dos permisos por cliente, plantillas desde la app y correo por el del sistema

- **Estado:** sustituida en parte por 0030 (el permiso «Avisos de sus citas» se da por hecho y la IA ya no lo pregunta;
  lo demás sigue). Aceptada en la entrevista del propietario del 2026-10-16, con la ampliación de las fases 11 a 15 de
  `docs/spec.md` el mismo día
- **Fecha:** 2026-10-16

## Contexto y problema

El encargo del 2026-10-16 pide recordatorios automáticos de citas (también días antes) y envíos que programa el negocio
a los contactos que elige, por WhatsApp con plantillas de Meta o por correo, «todo bien planteado sin baneos». En la
entrevista se sumaron los envíos automáticos tras la cita y los repetidos, Telegram, importar contactos de un Excel y
crear las plantillas desde la app.

Hasta ahora la app mandaba un único recordatorio por cita a cualquiera con WhatsApp que no se hubiera dado de baja, y
no tenía envíos. Al comprobar las normas en sus fuentes oficiales (2026-10-16) aparecieron tres cosas que obligan a
decidir:

- **Meta pide permiso para cualquier plantilla**, también un recordatorio: la persona tiene que haber aceptado recibir
  mensajes de ese negocio (no hace falta que nombre WhatsApp). Que haya escrito alguna vez abre la ventana de 24 h;
  Meta no dice que cuente como ese permiso, y YCloud dice expresamente que no basta para la publicidad. Para la
  publicidad, Meta recomienda un permiso aparte y explícito.
- **Meta solo acepta como utilidad lo que habla de algo concreto del cliente** (su cita, su pedido) o lo esencial
  (emergencias, interrupciones del servicio). Para un mensaje igual para muchos, como «cerramos el lunes», no da ningún
  ejemplo y puede tratarlo como marketing; y clasificar mal plantillas de utilidad trae sanciones que acaban dejando sin
  plantillas de utilidad (y sin recordatorios) al negocio.
- **La LSSI** (arts. 20 a 22) exige, para la publicidad por correo, WhatsApp o un medio equivalente, el permiso expreso
  del cliente (o la excepción de «clientes con servicios parecidos» del art. 21.2), una forma sencilla y gratuita de
  darse de baja en cada mensaje y que se vea quién la envía. La AEPD no admite el consentimiento tácito ni el interés
  legítimo para esto, y la LOPDGDD (art. 23.4) pide consultar la Lista Robinson cuando no hay consentimiento.
- **El buzón con el que trabaja el negocio no sirve para envíos masivos**: Microsoft lo desaconseja, y Google pone
  topes diarios y puede suspender la cuenta que los supera o envía spam. Gmail y Yahoo piden a quien envía mucho SPF,
  DKIM, DMARC y baja en un clic; Outlook, SPF, DKIM y DMARC. Los servicios de envío (Brevo, Mailjet, Mailgun) exigen
  permiso para escribir a muchos y dan de 100 a 300 correos al día en sus planes gratuitos, que comparten con todo lo
  demás que sale por el correo del sistema.

## Opciones consideradas

- **Permisos**: (a) como hasta ahora, sin permiso para los avisos y con permiso solo para la publicidad; (b) dos
  permisos por cliente, «Avisos de sus citas» y «Publicidad», que marca el equipo o vienen al importar; (c) lo mismo, y
  además la IA pregunta al reservar si puede avisar.
- **Avisos generales a muchos** (cierres, horarios): con el permiso de avisos y una plantilla de utilidad, o como el
  resto de envíos, con el permiso de novedades y publicidad y una plantilla de marketing.
- **Publicidad sin permiso a clientes con servicios parecidos** (art. 21.2 LSSI) o **solo con permiso expreso**.
- **Correo de los envíos**: por el buzón del negocio (Gmail, Outlook o IMAP) o por el correo del sistema conectado a un
  servicio de envíos.
- **Plantillas de WhatsApp**: crearlas en el panel de Meta o de YCloud y traerlas, o crearlas desde la app.
- **Publicidad por WhatsApp**: por la Cloud API, como el resto, o por la Marketing Messages API de Meta.

## Decisión

- **Dos permisos por cliente, con fecha y cómo se dieron**: «Avisos de sus citas» (vale para WhatsApp y Telegram) y
  «Novedades y publicidad» (vale para WhatsApp, Telegram y correo). Se marcan en la ficha (también a varios a la vez),
  vienen en el Excel al importar, y la IA pregunta al reservar por WhatsApp o Telegram, con el nombre del negocio, si
  puede avisar (opción c, la que eligió el propietario); de ese sí guarda la pregunta y la respuesta. El correo de
  recordatorio no necesita permiso: solo informa de la cita. Las bajas son por canal: de todo, o solo de novedades y
  publicidad.
- **Todos los envíos van con el permiso «Novedades y publicidad»** y, por WhatsApp, con plantilla de marketing y botón
  de baja, también los avisos generales: el propietario lo resumió así, «un recordatorio de cita será de utilidad, y
  los de marketing, de marketing». Lo de una cita concreta lo hacen los recordatorios y la bandeja.
- **Publicidad solo con permiso expreso**: no se usa la excepción del art. 21.2, porque no está claro si con ella hay
  que consultar la Lista Robinson y porque Meta pide el permiso igualmente.
- **Cualquier petición de baja cuenta**, no solo «BAJA»: la IA atiende la que llega con otras palabras y una persona
  anota la que llega por otra vía. La baja de publicidad que el cliente da desde el propio WhatsApp también se anota.
- **Los correos de los envíos salen por el correo del sistema**, conectado a un servicio de envíos con el dominio del
  negocio verificado, con «Responder a» el buzón del negocio. Los recordatorios siguen saliendo como hasta ahora.
- **Las plantillas se crean desde la app**, con Meta o con YCloud (las dos tienen API para crearlas), y la app trae
  preparados el modelo del recordatorio con sus dos botones y el de publicidad con su botón de baja.
- **Se envía por la Cloud API** (o por YCloud): la Marketing Messages API es opcional y en la Unión Europea no da
  optimizaciones de entrega.
- **Sin baneos, con reglas que se pueden comprobar**: nunca por código QR; topes de ritmo por canal; el límite de Meta
  contado por portfolio en 24 horas móviles, dejando sitio a los recordatorios; horas de envío para los envíos (los
  recordatorios salen a su hora); como mucho un envío cada 7 días por contacto; y parada automática cuando Meta pausa
  una plantilla, restringe el número o descarta mensajes, o cuando fallan demasiados por causas que no son de cada
  destinatario.

## Consecuencias

- Cumple la norma de Meta y la LSSI y reduce el riesgo de denuncias, que es lo que acaba bloqueando un número.
- Cambia algo que ya funcionaba: los recordatorios por WhatsApp (y las plantillas desde la bandeja) dejan de salir a
  quien no tiene el permiso de avisos. El equipo tiene que marcar los permisos de los clientes que ya tiene desde
  Contactos (a varios a la vez, diciendo cómo los dieron), y la IA los irá pidiendo al reservar; la importación solo
  añade contactos nuevos y salta los que ya existen.
- Los avisos generales (un cierre, un horario nuevo) solo llegan a quien aceptó novedades y publicidad; a los demás,
  si tienen cita, se les escribe desde la bandeja.
- La app guarda más datos personales (permisos con su origen, a quién se escribió en cada envío), que se borran o se
  anonimizan con el contacto como el resto, y los resultados de los envíos se anonimizan a los 12 meses.
- Hace falta un servicio de envíos para los correos de los envíos (los planes gratuitos dan de 100 a 300 al día) y
  añadir unos registros en el dominio del negocio; la guía lo explica. Sin una dirección pública con HTTPS (en local)
  no hay envíos por correo, porque su enlace de baja no funcionaría.
- La app crea plantillas en la cuenta de Meta o de YCloud del negocio: un error de categoría lo corrige Meta pasándola a
  marketing, y la app lo enseña y trata esa plantilla como publicidad desde entonces.
