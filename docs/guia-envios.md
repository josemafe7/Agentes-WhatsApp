# Envíos: novedades y publicidad a tus clientes

Esta guía explica cómo mandar novedades y publicidad a tus clientes por WhatsApp, Telegram o correo sin meterte en
problemas: el permiso que necesitan, cómo conseguirlo, cómo importar tus clientes, la plantilla de publicidad de
WhatsApp, cómo programar un envío y ver sus resultados, el correo con un servicio de envíos (y los registros del
dominio que piden Gmail, Outlook y Yahoo), las normas y cómo evitar bloqueos.

Lo de una cita concreta (avisar antes de la cita) no es un envío: lo hacen los recordatorios, en la guía de la
agenda.

## Antes de empezar

- **Quién puede hacer qué:**
  - El propietario y los administradores programan, cambian, pausan, reanudan y cancelan los envíos, y los ajustan en
    **Ajustes › Envíos**.
  - El supervisor y «Solo lectura» ven los envíos y sus resultados, sin cambiar nada.
  - El rol Agente no ve los envíos.
- **Hace falta al menos un canal:** un número de WhatsApp con la API oficial (Meta o YCloud; por código QR no se hacen
  envíos), un bot de Telegram o el correo del sistema. Cada canal tiene su guía.
- **La demo ya trae un envío terminado, con sus resultados, y otro programado.** En la demo no sale nada de verdad:
  lo que «sale» por un canal de demo solo se guarda.

[Captura: la pantalla Envíos con un envío terminado y otro programado]

## 1. El permiso «Novedades y publicidad»

La publicidad solo puede ir a quien la ha aceptado expresamente. Por eso cada contacto tiene, además de «Avisos de sus
citas», el permiso **«Novedades y publicidad»**, que vale para WhatsApp, Telegram y correo. Sin él, un envío no le
llega por ningún canal.

Se consigue así:

- **Lo anotas tú** en la ficha del contacto, «Permisos › Marcar permiso», diciendo cómo lo dio (en persona, por
  escrito, en la web, en la conversación, importado u otro) y, si quieres, una nota. Para varios a la vez,
  selecciónalos en Contactos y pulsa «Permisos». Solo si el cliente lo ha dado de verdad: queda anotado quién lo
  marca, cuándo y cómo.
- **Al importar tus clientes**, con las columnas del permiso (apartado 2).
- **La IA no lo pide sola** para publicidad: cuando reserva una cita solo pregunta por «Avisos de sus citas».

Pídelo aparte de los avisos de las citas: Meta recomienda un permiso separado para las promociones, y quien acepta
recibir avisos de su cita no ha aceptado recibir ofertas.

**Las bajas son por canal.** Si el cliente se da de baja de la publicidad en un canal, ya no recibe envíos por ese
canal, pero sí los recordatorios de sus citas y las respuestas de la IA. Se da de baja:

- por **WhatsApp**, con el botón de baja de la plantilla (apartado 3) o desde el propio WhatsApp, que tiene una opción
  para dejar de recibir publicidad de un negocio (Meta avisa a la app);
- por **Telegram**, con el botón «No quiero publicidad» que lleva cada envío;
- por **correo**, con el enlace «Darme de baja» del pie, o con el botón de baja que ofrecen Gmail o Yahoo junto al
  remitente;
- diciéndolo con sus palabras («no quiero más ofertas»): la IA lo da de baja y se lo confirma;
- por otra vía (por teléfono, en persona): lo anota una persona en su ficha.

Escribir «BAJA» o «STOP» sigue dando de baja de todo en ese canal. Una baja solo se quita si el cliente lo pide, desde
su ficha («Levantar baja»), diciendo cómo lo pidió.

## 2. Importar tus clientes

En **Contactos › Importar** subes un Excel o un CSV de hasta 5 MB con nombre, teléfono, email, etiquetas y, para cada
permiso, «sí» o «no», su fecha y cómo lo dio el cliente. Descarga allí la plantilla de Excel: trae las columnas que la
app entiende. Antes de importar, la app te enseña qué hará con cada fila; los clientes que ya están (mismo email o
teléfono) se saltan, así que importar dos veces el mismo archivo no crea nada.

Si el archivo trae el permiso «Novedades y publicidad», tienes que confirmar antes de importar que esos clientes lo
dieron de verdad. Un listado comprado o sacado de internet no vale: además de ser ilegal, Brevo y los demás servicios
de envío de correo cierran la cuenta por usarlo.

Un cliente importado que nunca te ha escrito por WhatsApp recibe el envío en su teléfono (sin prefijo, se entiende
+34) si «su teléfono tiene WhatsApp»; si no lo tiene, se prueba el siguiente canal marcado.

## 3. La plantilla de publicidad de WhatsApp

Por WhatsApp, un mensaje que empieza el negocio tiene que ser una **plantilla aprobada por Meta**, y una de publicidad
es de la categoría **marketing**. Un envío solo usa plantillas de marketing aprobadas **con un botón de baja**.

- **Créala desde la app:** en el panel del número, «Nueva plantilla» › «Novedades y publicidad». Lleva el nombre del
  negocio y el botón «No quiero publicidad», y la app recuerda qué dato va en cada hueco. Meta la revisa: suele tardar
  minutos, a veces horas.
- **Si la creaste en Meta o en YCloud,** pulsa «Sincronizar plantillas» y, en la plantilla, elige qué botón es la baja.
- **Meta cobra cada mensaje de marketing.** La pantalla del envío te dice el coste estimado con las tarifas de
  **Ajustes › WhatsApp** (si falta la de algún país, lo dice).
- Si Meta pausa, desactiva o rechaza la plantilla, el envío se para solo y te avisa.

[Captura: «Nueva plantilla» con el modelo «Novedades y publicidad»]

## 4. Programar un envío

1. En **Contactos**, marca los contactos y pulsa **«Programar envío»**. O, sin marcar ninguno, usa **«Envío a todos»**
   (o **«Envío a los del filtro»** si has filtrado por etiqueta o por canal; con una búsqueda escrita, marca los
   contactos). También puedes empezar desde **Envíos › Programar envío**, que va a todos los contactos.
2. Ponle un **nombre** (solo lo ve el equipo).
3. Marca **por dónde**: WhatsApp, Telegram y Correo, siempre en ese orden. A cada contacto le llega por el primero que
   puede recibir; si falla (el canal lo rechaza o Meta avisa de que no se pudo entregar), por el siguiente. A cada
   contacto le llega como mucho un mensaje de cada envío.
   - **WhatsApp:** el número y la plantilla. Cada hueco de la plantilla lleva el nombre del contacto, el del negocio o
     un texto fijo para este envío.
   - **Telegram:** el bot y el texto. Solo llega a quien ha escrito a ese bot y no lo ha bloqueado.
   - **Correo:** el asunto y el texto. Sale por el correo del sistema con el nombre y los datos de contacto del negocio
     al pie y el enlace «Darme de baja». Las respuestas llegan a la Bandeja si tienes un buzón conectado; si no, van al
     email de contacto del negocio y las lee una persona fuera de la app (la pantalla te avisa). En local no se ofrece
     el correo: su enlace de baja necesita la dirección pública de la app, con HTTPS.
   - En los textos puedes poner {nombre} (el del contacto) y {negocio}.
4. Elige **cuándo**: ahora, o un día y una hora (en la zona del negocio).
5. Pulsa **«Revisar destinatarios»**. La app te dice cuántos lo recibirán por cada canal, cuántos no y por qué (sin
   permiso, de baja, envío reciente, sin vía en los canales marcados, ha bloqueado el bot…), el coste estimado por
   WhatsApp y, si hay que repartirlo, cuándo terminará.
6. Pulsa **«Programar envío»**. Si cambias algo después de revisar, la app te pide revisarlo otra vez.

La lista de contactos queda fijada al programarlo: los marcados, o los que tenía el filtro en ese momento. Desde
entonces solo puede encoger: justo antes de cada mensaje, la app vuelve a comprobar el permiso, las bajas y lo demás,
y quien ya no cumple queda «No enviado», con el motivo.

Mientras no ha empezado, puedes **cambiarlo** (nombre, canales, mensajes y hora) o **cancelarlo**. Si a su hora la app
lo paró porque un canal no estaba listo, también puedes cambiarlo: al guardar, vuelve a quedar programado. En marcha,
puedes **pausarlo** (se para al momento, también lo que se estaba enviando), **reanudarlo** o **cancelar lo que
falta**. Lo que ya salió no se puede deshacer, y uno terminado ya no se cancela: si termina justo mientras lo
cancelas, la app te avisa de que ya ha terminado.

[Captura: «Programar envío» con WhatsApp y correo marcados y la revisión de destinatarios]

## 5. El ritmo y las paradas

Para no poner en riesgo tus cuentas, la app reparte el envío:

- **Horas de envío:** solo sale entre las horas de **Ajustes › Envíos** (de 9:00 a 21:00 por defecto). Lo que no cabe
  sigue al día siguiente.
- **Uno cada 7 días como mucho:** un mismo contacto recibe como mucho un envío cada 7 días (editable en Ajustes ›
  Envíos), sumando canales y envíos. Se cuenta por días: con 7, se salta a quien recibió uno ese día o en los 6
  anteriores.
- **WhatsApp:** como mucho 30 mensajes por minuto por número y, en las 24 horas anteriores, nunca más destinatarios
  distintos que el límite de mensajes de tu portfolio de Meta (250, 2.000, 10.000…), sumando lo que han enviado todos
  sus números en la app, recordatorios incluidos, y dejando sitio a los recordatorios de las 24 horas siguientes. Lo
  que envíes con el mismo portfolio desde otras herramientas (por ejemplo, campañas desde la consola de YCloud)
  también cuenta, y la app no lo ve.
- **Telegram:** como mucho 20 por minuto.
- **Correo:** como mucho los de **Ajustes › Envíos** por hora y por día (25 y 75 por defecto), y siempre dejando el
  resto del tope diario de tu servicio de correo para las invitaciones, las contraseñas, los avisos y los recordatorios.

**El envío se para solo** («En pausa», con el motivo) y avisa al propietario y a los administradores cuando: Meta
pausa, desactiva o rechaza su plantilla; Meta restringe el número o la cuenta, o descarta mensajes por calidad o por
sospecha de spam; un canal marcado está desconectado o en error; el servidor del correo del sistema rechaza los
correos (usuario o contraseña no válidos, o cuenta suspendida); o, de los últimos 50 mensajes por un canal, más de 5
han fallado por un error del canal. No cuentan los fallos de un destinatario (un teléfono sin WhatsApp, el límite de
publicidad por persona de Meta, quien paró la publicidad o bloqueó el bot, un cliente que bloqueaste en WhatsApp o uno
de un país al que Meta no deja escribir a tu cuenta).

Cuando lo resuelvas, pulsa **«Reanudar»**: la app vuelve a comprobar quién puede recibirlo, y a quien ya falló no se
le vuelve a intentar.

## 6. Los resultados

En **Envíos**, cada envío dice su estado (programado, enviando, en pausa, terminado o cancelado), cuándo sale, por qué
canales, a cuántos contactos y cómo va. Dentro, cada contacto con su canal y su estado:

- **Pendiente**, **Enviado**;
- **Entregado** o **Leído**, solo en WhatsApp: Telegram no avisa a los bots de la entrega ni de la lectura, y los
  correos no se rastrean, así que allí se quedan en «Enviado»;
- **Fallido**, con el motivo en español;
- **No enviado**, con el motivo.

Además, los totales y el coste estimado por WhatsApp. Las respuestas por WhatsApp, por Telegram y a un buzón conectado
llegan a la Bandeja como cualquier mensaje, y la conversación muestra a qué envío responden.

Los resultados de cada contacto se guardan 12 meses (editable en **Ajustes › Privacidad y legal**); después quedan los
totales de cada envío, sin a quién le llegó. Si borras un contacto, su fila se queda sin su nombre.

## 7. Automáticos y repetidos

En **Envíos › Automáticos y repetidos**, con **«Nuevo automático o repetido»**:

- **Tras la cita:** sale solo unos días después de cada cita (de 1 a 90), a la hora que elijas, para todos los
  servicios o solo algunos. Va a quien tuvo una de esas citas (completada, o confirmada y ya pasada; nunca cancelada,
  no presentado ni pendiente) si no tiene otra cita después, como mucho una vez por cita. Al activarlo, solo cuenta
  para las citas que terminan desde entonces. Si el cliente pide otra cita antes de que le llegue, queda «No enviado:
  ya tiene otra cita». Sirve, por ejemplo, para preguntar qué tal fue o pedir una opinión.
- **Cada semana** (un día y una hora) o **cada mes** (un día del mes y una hora; si el mes no tiene ese día, el
  último): a los contactos de una etiqueta y, si quieres, de un canal, calculados cada vez que sale (sin etiqueta,
  todos). Si la vez anterior aún no ha terminado, la siguiente espera a que termine.

Los dos siguen las mismas reglas que cualquier envío: el permiso «Novedades y publicidad», las bajas, uno cada 7 días
como mucho, el ritmo y las horas de envío. Cada vez que salen es un envío más en la lista, con su nombre y la fecha, y
con sus resultados. Las veces que no salieron porque la app estaba parada no se recuperan: sale solo la siguiente.

Desde su página se **cambia** (vale desde la próxima vez), se **pausa**, se **activa** o se **borra** (los envíos que
ya hizo se quedan en la lista).

## 8. El correo: un servicio de envíos y los registros del dominio

El correo de un envío sale por el **correo del sistema** (**Ajustes › Correo del sistema**). Para enviar a muchos
contactos:

- **No uses la cuenta con la que trabajas** (Gmail, Outlook o tu buzón de Microsoft 365): Microsoft desaconseja su
  correo para envíos masivos, y Google pone topes diarios y puede suspender la cuenta que los supera o envía spam.
- **Usa un servicio especializado en enviar correos**, con datos en la Unión Europea. Por ejemplo, en sus planes
  gratuitos: **Brevo** (hasta 300 correos al día), **Mailjet** (200 al día y 6.000 al mes) o **Mailgun** (100 al día).
  Te dan un servidor, un puerto, un usuario y una contraseña que pones en Ajustes › Correo del sistema.
- **Pon el tope de tu plan** en **Ajustes › Envíos** («Tope diario del correo del sistema») y cuántos de ellos pueden
  ser de envíos por hora y por día.
- **Verifica el dominio del negocio** en ese servicio. Te pedirá añadir unos registros en el DNS de tu dominio (donde
  lo compraste: IONOS, Hostinger, Cloudflare…):
  - **SPF**: dice qué servidores pueden enviar en nombre de tu dominio. Si ya tienes uno, se amplía (solo puede haber
    un registro SPF).
  - **DKIM**: una firma que demuestra que el correo es tuyo y no se ha cambiado por el camino.
  - **DMARC**: dice qué hacer con un correo que no pasa las comprobaciones. Para empezar vale `p=none`.

  Gmail y Yahoo los piden a quien envía mucho (Gmail, desde unos 5.000 al día a sus cuentas), y Outlook rechaza desde
  mayo de 2025 los correos de quien envía más de 5.000 al día sin ellos. Aunque envíes menos, con ellos tus correos
  llegan mejor a la bandeja de entrada y no a spam.
- La app pone en cada correo de un envío el enlace «Darme de baja» y las cabeceras de **baja en un clic** que piden
  Gmail y Yahoo, y aplica la baja al momento (Gmail pide hacerlo en 48 horas como mucho).
- **Vigila las quejas:** Gmail pide que menos del 0,3 % de los correos se marquen como spam (mejor por debajo del
  0,1 %). Lo ves en Google Postmaster Tools.

[Captura: los registros SPF, DKIM y DMARC en el panel de un servicio de envíos]

## 9. Las normas

Resumen orientativo de la ley española; revísalo con tu asesor.

- **Solo a quien lo aceptó expresamente** (LSSI, art. 21): la publicidad por correo, WhatsApp o Telegram necesita el
  permiso previo del cliente. La app no usa la excepción de «clientes con servicios parecidos» del art. 21.2: no está
  claro si con ella habría que consultar además la Lista Robinson (LOPDGDD, art. 23.4), y Meta exige igualmente el
  permiso.
- **Una forma sencilla y gratuita de darse de baja en cada mensaje** (art. 22): la app la pone en cada canal.
- **Que se vea que es publicidad y quién la envía** (art. 20) y, si es una oferta o un descuento, sus condiciones. Ya no
  hace falta poner la palabra «publicidad» al principio.
- **Poder demostrar el permiso** (RGPD, art. 7.1): por eso la app guarda de cada permiso cuándo y cómo lo dio y quién
  lo anotó. No marques permisos que el cliente no ha dado.
- **Datos de salud** (clínicas, fisioterapia, dentistas…): elegir a quién se envía por su dolencia (por ejemplo, con
  una etiqueta «lumbalgia») es tratar datos de salud con fines comerciales y necesita su consentimiento explícito para
  eso (RGPD, art. 9.2.a). Elegir por datos que no son de salud (la fecha de la última visita, el servicio que contrató)
  no lo exige por sí mismo. No pongas síntomas, enfermedades ni tratamientos en los mensajes.
- **WhatsApp no deja promocionar productos sanitarios** (vendas, órtesis…); sí tus servicios.

## 10. Cómo evitar bloqueos

**WhatsApp**

- Envía solo a quien dio el permiso y espera tus mensajes: los bloqueos y las denuncias bajan la calidad del número, y
  Meta puede restringirlo.
- Mensajes útiles y para cada cliente (con su nombre), lo importante en las primeras líneas, pocos emojis. Renueva las
  plantillas cada pocas semanas.
- Pocos envíos: vigila cuántos recibe cada cliente a la semana (la app no deja más de uno cada 7 días por defecto).
- Empieza con pocos contactos y ve subiendo; durante una semana, mira los avisos del número y de la plantilla.
- Meta puede limitar cuánta publicidad recibe una persona de todos los negocios si apenas la lee: ese fallo no cuenta
  para parar el envío, y no se le vuelve a intentar.

**Telegram**

- El bot solo puede escribir a quien le ha escrito antes. No hagas spam: Telegram puede cerrar el bot o la cuenta.
- La app envía como mucho 20 por minuto, muy por debajo del límite gratuito de Telegram.

**Correo**

- Un servicio de envíos con el dominio verificado (apartado 8), nunca tu buzón de trabajo.
- Nada de listas compradas; asuntos veraces (sin «Re:» si no es una respuesta).
- Empieza con poco volumen y a ritmo constante; la app ya reparte los correos por hora y por día.

## Problemas frecuentes

- **No aparece mi número de WhatsApp al programar:** solo salen los números con la API oficial (Meta o YCloud)
  conectados. Por código QR no se hacen envíos.
- **No aparece ninguna plantilla:** el número no tiene plantillas de marketing aprobadas con un botón de baja. Crea una
  con el modelo «Novedades y publicidad» o, en una traída, elige qué botón es la baja.
- **No se ofrece el correo:** la app no tiene una dirección pública con HTTPS (en local). Su enlace de baja no
  funcionaría.
- **Casi nadie lo recibirá:** mira los motivos de la revisión. Lo habitual: falta el permiso «Novedades y publicidad»
  (apartado 1) o recibieron otro envío hace poco.
- **El envío está «En pausa» y no lo he parado yo:** el motivo está arriba, en el envío. Resuélvelo (reconecta el
  canal, revisa la plantilla o el correo del sistema) y pulsa «Reanudar».
- **Va muy despacio:** fuera de las horas de envío no sale nada, y por WhatsApp no pasa del límite de tu portfolio de
  Meta. La revisión te dice cuándo terminará.
- **Un contacto dice «Se interrumpió mientras se enviaba»:** la app se paró justo al enviárselo. No se vuelve a
  intentar, para no mandárselo dos veces.
