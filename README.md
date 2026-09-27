# DominIA Agentes

Plataforma de agentes IA de atención al cliente (WhatsApp, correo y chat web) que se instala una vez por
negocio y se configura sin tocar código. Cada instalación es de un solo negocio, con su propia base de datos y
sus propias claves.

**Estado: construidas las fases 0 a 7, solo en local.** Todo lo del encargo funciona ya en tu ordenador: el arranque
con la demo, el inicio de sesión con roles e invitaciones, el asistente de arranque, los ajustes, el cifrado de claves,
los agentes de IA (plantillas, versiones, modelos, «Probar agente» y herramientas HTTP propias), el chat web para pegar
en la web del negocio, la bandeja con traspaso a una persona, los contactos (con exportar, borrar y fusionar), los
canales con su agente activo, el motor que responde en segundo plano, el simulador de canales, WhatsApp con la API
oficial de Meta, el conocimiento del negocio con búsqueda por significado y por palabras, la agenda con citas que el
agente reserva sin dobles reservas, el correo (Gmail, Outlook e IMAP/SMTP con borradores para revisar), el cumplimiento
(aviso de IA, bajas con «BAJA», conservación y limpieza diaria, páginas legales editables), los informes y la app
instalable con avisos push. La app todavía no está publicada en internet: por eso WhatsApp y el correo reales aún no se
han probado contra Meta, Google y Microsoft de verdad (ver «Conectar WhatsApp real» y «Conectar el correo real»); todo
está probado contra esos servicios simulados.

## Requisitos

- **Node.js 24 LTS** (`node -v` debe mostrar `v24.…`).
- **pnpm 10**. Viene con Node a través de Corepack: actívalo una vez con `corepack enable` y el proyecto usa
  solo la versión exacta que pide (`packageManager` en `package.json`). No uses npm ni yarn.
- **Git**, para clonar el repositorio.

No hace falta ninguna cuenta ni servidor: la base de datos es un archivo local.

## Arranque rápido

```bash
git clone <url-del-repositorio> dominia-agentes
cd dominia-agentes
corepack enable
pnpm install && pnpm dev
```

Abre <http://localhost:3000> y entra con uno de los usuarios de prueba.

La primera vez, `pnpm dev` prepara la instalación antes de arrancar: crea `.env.local` con secretos al azar
(clave de cifrado, secreto de las sesiones y secreto del cron) y la demo activada, crea `data/local.db`, aplica
las migraciones y carga la demo de una peluquería. Las siguientes veces arranca directamente. Mientras está en
marcha, lanza el trabajo en segundo plano cada 15 segundos.

¿Otro puerto? `pnpm dev -p 3200` (o `PORT=3200 pnpm dev`): las direcciones locales de la app se ajustan solas.

## Usuarios de prueba

Todos con la contraseña `demo1234`. Solo existen en la demo y se pueden borrar desde Ajustes › Usuarios.

| Email | Contraseña | Rol |
|---|---|---|
| `propietario@demo.test` | `demo1234` | Propietario |
| `admin@demo.test` | `demo1234` | Administrador |
| `supervisor@demo.test` | `demo1234` | Supervisor |
| `agente@demo.test` | `demo1234` | Agente |
| `lectura@demo.test` | `demo1234` | Solo lectura |

Cada rol ve en el menú solo lo que puede usar (la tabla completa está en `docs/spec.md`, «Quién puede hacer
qué»). Si escribes a mano la dirección de una página que tu rol no puede ver, la app responde «No tienes
permiso» sin enseñar nada.

## La clave de OpenRouter

La IA (los agentes, las transcripciones y la búsqueda por significado en el conocimiento) necesita una clave de
[OpenRouter](https://openrouter.ai/settings/keys). Sin ella todo lo demás funciona, la búsqueda en el conocimiento va
solo por palabras y verás el aviso «Añade tu clave de OpenRouter». Hay dos formas de ponerla:

1. **En la app (recomendado):** entra como propietario o administrador, ve a **Ajustes › IA**, pega la clave,
   pulsa «Probar clave» y guarda. Funciona al momento. Se guarda cifrada y la pantalla solo enseña `••••1234`.
2. **En `.env.local`:** añade `OPENROUTER_API_KEY=<tu clave>` y reinicia `pnpm dev`. Al arrancar, la app calcula en
   segundo plano los embeddings que faltaban (los del conocimiento de la demo, si el archivo de la demo no los trae).

Si hay clave en los dos sitios, manda la de Ajustes. Antes de usar datos reales, revisa la privacidad de tu
cuenta de OpenRouter en <https://openrouter.ai/settings/privacy> (que los proveedores no guarden ni entrenen
con los datos); la app, además, lo prohíbe en cada petición.

Sin clave, la lista de modelos no se carga, los selectores de modelo y «Generar borrador con IA» están
desactivados y «Probar agente» no deja enviar: todos lo explican con el mismo aviso.

### Prueba a mano con una clave real

Las pruebas automáticas usan un OpenRouter simulado: nunca gastan. Para comprobar la fase 1 con OpenRouter de
verdad (gasta céntimos):

1. En <https://openrouter.ai/settings/keys> crea una clave nueva **con un límite de gasto pequeño** (por
   ejemplo, 1 US$) y comprueba que la cuenta tiene saldo. Revisa la privacidad de la cuenta (enlace de arriba).
2. Arranca la demo con `pnpm dev` y entra como `propietario@demo.test`.
3. **Ajustes › IA:** pega la clave, pulsa «Probar clave» (debe decir que es válida y enseñar el límite de
   gasto) y «Guardar cambios». La clave se ve solo como `••••` y sus 4 últimos caracteres, y el aviso «Añade
   tu clave de OpenRouter» desaparece.
4. **Agentes › Asistente de citas › Modelo:** abre «Modelo principal». Debe salir la lista real con
   «Recomendados» primero, el precio de entrada y de salida por millón de tokens en US$, el contexto y los
   iconos de imagen, PDF y audio, y abajo «Lista de tu cuenta de OpenRouter». Prueba «Actualizar lista» y el
   buscador.
5. **Probar:** escribe «Hola, ¿qué horario tenéis?». La respuesta debe usar el horario de Ajustes › Horario y,
   debajo, los tokens, el coste en US$ y el tiempo en ms. «Ver detalles» enseña el modelo y el proveedor que
   respondieron.
6. Cambia «Simular canal» a Correo y pregunta otra cosa: la respuesta llega con saludo y firma. Escribe
   «Quiero hablar con una persona»: se ve el traspaso simulado con el mensaje de la pestaña Traspaso.
7. Compara el coste con la actividad de tu cuenta en OpenRouter: debe coincidir con lo que muestra la app.
8. Vuelve a Ajustes › IA y pulsa «Quitar clave»: en Probar reaparece el aviso y no se puede enviar.

Si algo falla, el mensaje de la app explica el motivo en español (clave no válida, sin saldo, modelo no
disponible con tu privacidad…).

## Recorrido de la demo

Lo que ya puedes probar. Para que los agentes respondan hace falta la clave de OpenRouter (ver arriba); sin ella,
los mensajes llegan a la bandeja y esperan a una persona.

### Chat web, bandeja y traspaso (fase 2)

1. **`/widget-demo`** (<http://localhost:3000/widget-demo>, sin iniciar sesión): una web de ejemplo del negocio con
   su chat web. Pulsa el botón redondo de abajo a la derecha y pregunta algo del negocio (horario, precios,
   servicios). Tras unos segundos (la app espera de 4 a 8 para juntar varios mensajes seguidos en una sola
   respuesta) contesta el agente activo del chat, con el aviso de IA delante de su primer mensaje. Si escribes
   varios mensajes seguidos, recibes una sola respuesta. Puedes mandar fotos y notas de voz (la demo las tiene
   activadas; las notas de voz se transcriben con la clave). Con varios chats web, la página deja elegir cuál.
2. **Bandeja** (entra como `propietario@demo.test`): la conversación aparece sola, sin recargar. La demo trae
   además siete conversaciones de ejemplo: una reserva por WhatsApp, una nota de voz con su transcripción, un
   traspaso urgente pendiente, uno resuelto por una persona con su nota interna, una foto por el chat web,
   preguntas frecuentes y un hilo de correo con un borrador de la IA. Hay filtros (canal, estado, asignado, IA o
   persona, sin leer, etiquetas), buscador y el contador de no leídos junto a «Bandeja» en el menú.
3. **Contesta tú desde la bandeja:** la IA de esa conversación se pausa (12 horas por defecto; se cambia en Ajustes ›
   Notificaciones › «Bandeja y traspasos», junto a si los traspasos se asignan por turnos) y la cabecera dice
   «IA en pausa hasta …». Vuelve sola al pasar ese tiempo o al pulsar «Reactivar». El interruptor de IA, la
   asignación, las etiquetas, el estado, el agente de la conversación y «Pasar a una persona» están en la cabecera;
   las notas internas (solo las ve el equipo) en el cuadro de escribir, donde también se adjuntan imágenes y PDF si
   el canal los admite.
4. **Traspaso:** en el chat escribe «Quiero que me atienda una persona». El agente pasa la conversación a una
   persona: el cliente recibe el mensaje de traspaso del agente (distinto dentro y fuera de horario), la
   conversación queda «Pendiente de humano» con el motivo, el resumen y la urgencia, se asigna por turnos y la
   campana de avisos (arriba a la derecha) avisa a quien diga la pestaña Traspaso del agente. Las palabras clave y
   los temas sensibles del agente también la traspasan, y la IA no vuelve hasta que una persona la reactiva o
   resuelve la conversación.
5. **Asignar agentes a canales:** en **Canales**, cada tarjeta tiene el «Agente activo» y el interruptor de la IA.
   Elige otro agente (la app pregunta antes «… sustituirá a …») y vuelve a escribir en `/widget-demo`: responde el
   nuevo, y cada respuesta anterior conserva el nombre de quien la escribió. También desde la pestaña Canales de
   cada agente, con el interruptor de cada canal («Activo aquí»; en el móvil se lee «Activo en <canal>»), y en una
   conversación concreta se puede elegir otro agente solo para ella.
6. **Canales › Añadir canal › Chat web:** crea otro chat con su color, logo, bienvenida, posición, textos legales,
   dominios permitidos, notas de voz e imágenes, con vista previa, y copia el código para pegar en tu web
   (`<script src=".../widget.js" data-channel="…" async></script>`). Con la lista de dominios vacía solo funciona
   dentro de la app, en `/widget-demo`. El panel de cada canal tiene su configuración: modo de respuesta
   («Automático» o «Borrador para revisar», en el que una persona aprueba, edita o descarta cada respuesta desde la
   bandeja), aviso de IA, fuera de horario, modo pruebas y quién lo atiende.
7. **Simulador** (**Ajustes › Diagnóstico › Simulador**): manda un mensaje como si fueras un cliente de WhatsApp,
   del correo o del chat web (texto, audio, imagen o documento, con un ejemplo o un archivo tuyo de hasta 1 MB).
   Entra por el mismo camino que uno real, aparece en la bandeja marcado «Simulado» y la IA responde como lo haría;
   esa respuesta nunca sale de la app. «Ver conversación» la abre.
8. **Contactos:** listado con buscador y filtros por etiqueta y canal, y la ficha de cada uno con sus datos, sus
   identidades en cada canal, etiquetas, campos personalizados, consentimientos y conversaciones.
9. **Cada rol:** el Agente (`agente@demo.test`) solo ve las conversaciones de sus canales (se eligen en Ajustes ›
   Usuarios); Solo lectura ve la bandeja sin poder responder; el Supervisor atiende la bandeja pero no entra en
   Canales.

### WhatsApp (fase 3)

El canal «WhatsApp» de la demo está marcado «Demo»: nunca llama a Meta. Lo que recibe llega por el simulador y lo que
«envía» solo se guarda, con los estados «entregado» y «leído» simulados unos segundos después.

1. **Simulador** (**Ajustes › Diagnóstico › Simulador**): elige el canal «WhatsApp» y manda un texto, una nota de voz,
   una imagen o un documento como si fueras un cliente. Entra por el mismo camino que un aviso real de Meta: el
   contacto se reconoce por su identificador de WhatsApp (nunca por el teléfono), el mensaje aparece en la bandeja y la
   IA contesta una sola vez (con la clave de OpenRouter; la nota de voz se transcribe y la transcripción se ve bajo el
   reproductor).
2. **Ventana de 24 horas** (Bandeja, una conversación de WhatsApp): encima del cuadro de escribir se lee «Ventana
   abierta hasta … · quedan …». La de Cristina Herrero es de hace dos días: la ventana está cerrada, no se puede
   escribir texto libre y aparece «Elegir plantilla». Elige «recordatorio_cita», rellena sus datos (con la vista previa
   de cómo queda) y envíala: la IA de esa conversación se pausa, como con cualquier respuesta de una persona.
3. **Coste estimado:** bajo cada mensaje enviado por WhatsApp se ve su coste en cuanto Meta (aquí, la demo) dice si se
   cobra: «Gratis · Servicio» para las respuestas dentro de la ventana y «≈ 0,02 US$ estimado · Utilidad» para la plantilla,
   calculado con la tarifa de ejemplo de España.
4. **Ajustes › WhatsApp** (propietario y administrador): las tarifas por mercado y categoría de Meta. Las de la demo
   van marcadas «Ejemplo»: no son precios reales. Aquí también están la dirección de avisos de la instalación y su
   token de verificación, para copiarlos en la app de Meta.
5. **Canales › WhatsApp:** el panel del número (en la demo, con el aviso de canal de demostración), sus plantillas
   sincronizadas (dos aprobadas, una pendiente y una rechazada con su motivo), el modo pruebas, los ajustes de envío y
   los límites de Meta.
6. **Canales › Añadir canal › WhatsApp:** el asistente para conectar un número real, paso a paso (ver «Conectar
   WhatsApp real»). En local puedes validar los datos con Meta, pero sin una dirección pública con HTTPS no llegarán
   mensajes: el propio asistente lo avisa.
7. **Páginas legales**, sin iniciar sesión: `/legal/privacidad`, `/legal/terminos` y `/legal/eliminacion-datos`, con
   los datos del negocio. Meta pide sus direcciones para publicar la app.

### Conocimiento (fase 4)

La demo trae la base de conocimiento «Información del negocio», ya procesada: los servicios con sus precios (un
documento en Markdown), las normas de citas y cómo llegar (un PDF de dos páginas) y las preguntas frecuentes del
sector. Los tres agentes de la demo la usan en modo «Automático», con la herramienta «Buscar en el conocimiento».

1. **Conocimiento** (entra como `propietario@demo.test`): la tarjeta de la base con sus documentos, fragmentos, estado,
   modelo de embeddings y los agentes que la usan. Sin clave de OpenRouter se lee «Sin clave, la búsqueda va solo por
   texto» y los documentos están «Listo (solo texto)»: se encuentran por palabras desde el primer momento.
2. **Probar búsqueda** (pestaña de la base): escribe «autobus» o «cuanto cuesta un corte». Salen los fragmentos
   numerados con su título, sección, página y puntuación, sin gastar en el modelo de chat; no distingue mayúsculas ni
   tildes. Con algo que no está en la base sale «Nada relevante».
3. **Añadir contenido:** sube un PDF, Word, Excel, CSV, TXT o Markdown (hasta 25 MB), una página web (con su mapa del
   sitio, hasta 50 páginas, y lectura periódica si quieres) o una pregunta frecuente. Cada documento pasa por «En cola
   → Extrayendo → Troceando → Embeddings → Listo» en segundo plano, y el mismo archivo dos veces se rechaza. Pulsa un
   documento para ver su resumen y sus fragmentos. Un PDF escaneado necesita la clave de Mistral OCR (Ajustes › IA).
4. **El agente** (Agentes › Asistente de citas › Conocimiento): sus archivos de contexto (texto que va entero en cada
   mensaje, con tope de 30.000 tokens y «Pasar a una base de conocimiento»), las bases que usa y «Automático» o
   «Buscar siempre». En **Probar**, pregunta «¿Cómo llego en autobús?»: con la clave, responde con el dato del PDF y
   dice de dónde lo saca; «Ver detalles» enseña los fragmentos que leyó. Si preguntas algo que no está, dice que no lo
   sabe y ofrece pasar con una persona.
5. **Bandeja:** en la conversación del chat web «¿Y dónde estáis?», «Ver fuentes» bajo una respuesta de la IA abre
   «¿Por qué respondió esto?» con los fragmentos que usó. Bajo una respuesta de una persona, «Convertir en FAQ» la
   guarda como pregunta frecuente de una base, editable antes de guardarla.
6. **Con la clave de OpenRouter:** al guardarla en Ajustes › IA, la búsqueda también va por significado. Si
   `seed/fixtures/embeddings.json` ya tiene los embeddings de la demo (ver «Órdenes»), funciona al momento; si no, se
   calculan en segundo plano en unos segundos (también al arrancar la app con la clave en `.env.local`). Basta con
   que la pregunta tenga alguna palabra que aparezca en la base: «autobus» sigue encontrando la página 2 del PDF.
   Hoy el archivo del repositorio está vacío: falta ejecutar `pnpm seed:embeddings` una vez con una clave real. Cambiar el modelo de embeddings en Ajustes › IA vuelve a procesar todas
   las bases, y mientras tanto se sigue buscando con el índice anterior.

### Agenda (fase 5)

La demo trae la agenda de la peluquería en marcha: tres profesionales (Lucía, Andrés y Marta) con su horario semanal,
los servicios del sector con su duración, márgenes y precio orientativo, y unas doscientas citas colocadas respecto al
día en que se carga la demo (de dos semanas atrás a dos semanas adelante), en todos los estados, hechas por la IA, por
personas y desde «Probar agente», más unas vacaciones y un hueco bloqueado. La guía completa es
[`docs/guia-agenda.md`](docs/guia-agenda.md), también en **Ayuda › La agenda**.

1. **Agenda** (entra como `propietario@demo.test`): vistas **Día**, **Semana**, **Mes** y **Recursos** (una columna por
   profesional), con el horario, los festivos, las ausencias y los bloqueos, y filtros por profesional, servicio,
   estado, origen (IA, persona o web) y citas de prueba. Todas las horas son las del negocio (`Europe/Madrid`).
2. **La ficha de una cita** (púlsala): estado, servicio, profesional, cliente, origen, quién la creó, recordatorio,
   notas e historial de cambios. Las que hizo la IA enlazan a su conversación y a su contacto. Desde ahí se confirma,
   se cambia, se marca completada o no presentado y se cancela (con motivo y, si quieres, «Avisar al cliente por su
   conversación»).
3. **«Nueva cita»:** eliges servicio, profesional o «Cualquier profesional», día y personas, y solo salen los huecos
   libres de verdad. Si otra persona o el agente coge ese hueco mientras tanto, al guardar sale «Ese hueco ya no está
   libre» con otros cercanos. Las citas se mueven y se alargan **arrastrando** (o con «Cambiar» en la ficha): si el
   destino no está libre, vuelven a su sitio.
4. **«Bloquear hueco»** (propietario, administrador y supervisor): un rato o un día, para un profesional o para todos.
5. **Configurar la agenda** (menú «⋯» de la Agenda, propietario y administrador): **Agenda › Configuración** con
   General (modo por recurso o por aforo, intervalo de los huecos y las palabras: Cita o Reserva, Profesional o Mesa…),
   Servicios y Recursos (horario semanal con varios tramos por día y ausencias). El supervisor solo entra en las
   ausencias.
6. **El agente reserva** (con la clave de OpenRouter): en `/widget-demo` escribe, por ejemplo, «Quiero cortarme el pelo
   el jueves por la tarde». El «Asistente de citas» (con las herramientas de la agenda encendidas en Agentes ›
   Herramientas) consulta los huecos, ofrece 2 o 3 concretos, espera a que elijas y confirma en una sola respuesta.
   La cita aparece en la Agenda con origen «IA · Chat de la web», enlazada a la conversación. «Tratamiento de
   keratina» necesita confirmación del equipo: queda «Pendiente», el agente lo dice y la campana avisa «Cita pendiente de
   confirmar». La conversación de WhatsApp de Laura Gil tiene la cita que la IA le reservó.
7. **Probar agente:** una cita pedida en la pestaña Probar se crea marcada «Prueba» y sin cliente. Se borran todas con
   «Borrar citas de prueba» (en Probar) o «Citas de prueba (N)» › «Borrar todas» (en la Agenda).
8. **Contactos y bandeja:** la lista de Contactos enseña la próxima cita de cada uno; la ficha de un contacto, sus citas
   próximas y pasadas con «Nueva cita»; y en la bandeja, el panel del contacto enseña sus próximas citas y «Nueva cita»,
   que la deja unida a esa conversación.
9. **Recordatorios** (**Ajustes › Recordatorios**, propietario y administrador): desactivados por defecto. La demo trae
   preparada la plantilla aprobada «recordatorio_cita» del WhatsApp de demo con sus variables asignadas; también se
   pueden enviar por email. Cada cita recibe uno solo, nunca si está cancelada o el cliente se ha dado de baja, y se
   recalcula si la cita se mueve. En la demo, los de email se guardan en `data/outbox/` y los de WhatsApp salen por el
   canal de demo, que nunca llama a Meta. Por WhatsApp, cada recordatorio se cobra (plantilla de utilidad).
10. **Restaurante (agenda por aforo):** `pnpm seed --sector=restaurante` carga un restaurante con Comedor (40 plazas) y
    Terraza (24): cada reserva de mesa dura 90 minutos y la vista de Recursos enseña la ocupación de cada franja
    («22/24»). Un grupo que ya no cabe no tiene huecos.
11. **Cada rol:** el supervisor gestiona citas, bloqueos y ausencias; el Agente crea, cambia y cancela citas de los
    clientes de sus canales; «Solo lectura» ve la agenda sin cambiar nada.

### Correo (fase 6)

El canal «Correo» de la demo está marcado «Demo»: nunca llama a Google, a Microsoft ni a un servidor de correo. Lo que
recibe llega por el simulador y lo que «envía» solo se guarda. Como todo buzón nuevo, responde con borradores para
revisar. La guía completa es [`docs/guia-correo.md`](docs/guia-correo.md), también en **Ayuda › Conectar el correo**.

1. **Bandeja:** el hilo de correo de Isabel Prieto («Peinados para cinco personas el sábado») lleva el asunto arriba y
   cada correo en su tarjeta, con remitente, destinatarios y fecha. El último es un borrador de la IA «pendiente de
   revisar» con «Aprobar y enviar», «Editar» y «Descartar»: aprobado, sale en el mismo hilo con la firma y el aviso de
   IA. Si contestas tú desde la bandeja, tu correo lleva la firma del canal y la IA se pausa en esa conversación.
2. **Simulador** (**Ajustes › Diagnóstico › Simulador**): elige el canal «Correo», pon el email del cliente y escribe
   como él. Con la clave de OpenRouter, la IA deja su borrador en la bandeja.
3. **Canales › Correo:** el panel del buzón (en la demo, con el aviso de buzón de demostración y los semáforos
   apagados), su actividad (recibidos, enviados, borradores por revisar e ignorados), los correos que la IA no contesta
   (respuestas automáticas, boletines y listas, remitentes «noreply», rebotes, lo que envía el propio buzón, spam y las
   promociones de Gmail) y las respuestas de la IA: modo de respuesta, tope diario por hilo y por remitente (5 y 10
   por defecto) y firma.
4. **Canales › Añadir canal › Correo:** el asistente para conectar un buzón real (ver «Conectar el correo real»).

### Cumplimiento, informes y la app instalable (fase 7)

1. **Bajas:** en el **Simulador**, escribe solo «BAJA» (o «STOP») como un cliente de WhatsApp. Recibe una sola
   confirmación, la IA deja de contestarle en ese canal y no le salen recordatorios ni plantillas; lo que escriba después
   espera en la bandeja a una persona. En la ficha del contacto, «Consentimientos y bajas» enseña la baja con su fecha y canal, y
   «Levantar baja» la quita (solo si el cliente lo pide; queda anotado quién, cuándo y por qué).
2. **Contactos:** «Posibles duplicados» (mismo email o teléfono) y «Fusionar» dos contactos eligiendo qué datos se
   quedan; «Exportar» la lista (CSV, con la búsqueda y los filtros) o los seleccionados; y en la ficha, «Exportar datos»
   (todo lo del contacto en un archivo) y «Borrar contacto» escribiendo su nombre (o, desde la lista, «Borrar» varios
   escribiendo cuántos son): se borran sus datos, mensajes y archivos, y sus citas se quedan sin nombre para que los
   informes cuadren. La búsqueda de Contactos y de la Bandeja no distingue tildes: «jose» encuentra «José».
3. **Ajustes › Privacidad y legal:** los textos de `/legal/privacidad`, `/legal/terminos` y
   `/legal/eliminacion-datos`, el aviso de IA por defecto y los plazos de conservación (conversaciones 12 meses, audios
   30 días tras transcribirlos, adjuntos 90 días y avisos en bruto 14 días), con borrado o anonimización. La limpieza
   corre cada día y deja en el Registro de actividad cuánto borró.
4. **Informes** (menú): conversaciones por canal, porcentaje resuelto por la IA, traspasos y sus motivos, tiempo hasta
   la primera respuesta de una persona (y cuántos en menos de 3 minutos), citas creadas por la IA y costes de IA y de
   WhatsApp, por mes o por fechas y por canal, con «Descargar CSV» en cada tabla. «Probar agente» nunca cuenta.
5. **App instalable y avisos push:** en **Mi cuenta** (o Ajustes › Notificaciones), «Instalar la app» la pone en el
   ordenador o el móvil con el nombre y el logo del negocio, y «Activar avisos en este dispositivo» manda un push cuando
   hay un traspaso («Traspaso: Ana», sin el texto del mensaje). En local funciona en <http://localhost:3000>; en el
   iPhone hace falta la app publicada con HTTPS y añadida a la pantalla de inicio. Al cerrar sesión, ese dispositivo
   deja de recibirlos.
6. **Herramientas HTTP** (**Agentes › Herramientas HTTP**, propietario y administrador): conecta un agente con n8n o tu
   CRM: nombre, descripción, datos que envía la IA, método, dirección `https://`, cabeceras secretas (cifradas) y
   tiempo máximo, con «Probar». Después se enciende en la pestaña Herramientas de cada agente.
7. **Ayuda:** además de las guías, la **Lista de puesta en marcha** de un negocio real (`/ayuda/puesta-en-marcha`).

### Lo demás

- **Entrar con cada rol** y ver cómo cambia el menú: Bandeja, Contactos, Agenda, Agentes, Conocimiento,
  Canales, Informes y Ajustes. En todas las pantallas aparece el aviso «Modo demo».
- **Ajustes › Negocio:** nombre, datos de contacto, sector, zona horaria, logo y color de la marca, con la
  vista previa en claro y oscuro. El color se aplica a todo el panel.
- **Ajustes › Usuarios:** invitar a alguien por email con su rol, cambiar roles, elegir los canales de un
  agente, desactivar, borrar, pasar la propiedad y exigir la verificación en dos pasos. Sin servidor de correo,
  la app te enseña el enlace de la invitación para copiarlo, y el correo queda guardado en `data/outbox/`.
- **Aceptar una invitación:** abre el enlace en otra ventana privada, pon nombre y contraseña, y entras con
  ese rol.
- **¿Has olvidado tu contraseña?** en la página de entrada: el correo con el enlace se guarda en
  `data/outbox/` al cabo de unos segundos (lo envía el trabajo en segundo plano).
- **Mi cuenta** (menú de tu usuario): nombre, contraseña, verificación en dos pasos con una app de
  autenticación y códigos de recuperación, tus avisos y cerrar sesión aquí o en los demás dispositivos.
- **Agentes:** la demo trae tres agentes, creados desde la plantilla de la peluquería: «Asistente de citas»
  (con dos versiones, para probar a restaurar), «Asistente de correo» y «Asistente fuera de horario», preparado
  sin activar. Crea uno con «Nuevo agente» (plantilla de tu sector, de otro sector, en blanco o «Generar
  borrador con IA» desde tu web o una descripción) y recorre su editor: General, Instrucciones (con «Vista
  previa del prompt»), Modelo, Conocimiento (ver «Conocimiento (fase 4)»), Herramientas («Pasar a una persona»,
  siempre activa, «Buscar en el conocimiento» y las de la agenda: consultar huecos, crear, cambiar y cancelar citas y
  guardar los datos del cliente), Traspaso, Canales, Probar y
  Versiones. Cada guardado crea una versión que se puede restaurar. Desde la tarjeta se duplica o se borra.
- **Probar agente** (pestaña Probar de un agente): un chat con el agente, sin canales reales, con «Simular
  canal» (WhatsApp, correo o chat web) y, en cada respuesta, los tokens, el coste en US$, el tiempo y «Ver
  detalles» (herramientas usadas y fragmentos de conocimiento con su puntuación y su fuente). Necesita la clave de
  OpenRouter (ver arriba); sin ella verás el aviso y no se puede enviar. El supervisor también puede probar; «Solo
  lectura» ve los agentes sin cambiar nada y el rol Agente no entra.
- **Ayuda** (menú de tu usuario, o Ajustes › Acerca de): las guías paso a paso dentro de la app: crear y probar
  agentes y darles el conocimiento del negocio, la agenda, conectar WhatsApp, conectar el correo, publicar en Vercel y
  la lista de puesta en marcha.
- **Ajustes › Horario, IA, Correo del sistema, Privacidad y legal y Notificaciones:** horario con varios tramos
  por día y festivos; la clave de OpenRouter, los modelos por defecto (chat, respaldo de otro proveedor,
  transcripción, embeddings y descripción de imágenes) elegidos de la lista con precios, la lista de
  recomendados y «Sin retención de datos», con aviso si un modelo en uso se retira o si el de transcripción tiene
  proveedores que pueden guardar los audios, «Reordenar resultados» del conocimiento con su modelo (desactivado por
  defecto; con «Sin retención de datos» solo se ofrece el que no guarda nada y, si el elegido sí guarda, lo avisa y
  no reordena), y la clave de Mistral OCR para los PDF escaneados; el servidor SMTP de los correos de la app; textos legales, aviso de IA y plazos de conservación; y quién recibe cada aviso.
- **Ajustes › Registro de actividad y Diagnóstico:** quién hizo qué (personas, IA y sistema), en español y con
  filtros; y el estado de la base de datos, de la cola de trabajos (con «Reintentar»), los errores recientes de la IA
  (si una respuesta falla también al reintentarla, la conversación pasa a una persona y el error aparece aquí), el
  último aviso de cada canal, los correos que cada buzón ignoró y por qué, y los correos que ha enviado la app, que en
  local puedes abrir desde ahí.
- **Asistente de arranque:** con `pnpm db:fresh` (ver «Paso a un negocio real») la app queda vacía y te guía:
  cuenta de propietario, negocio y sector, horario, clave de IA, primer agente (desde la plantilla del sector
  o generado desde la web del negocio si hay clave), un chat web con ese agente que se prueba ahí mismo (y en
  `/widget-demo`) y, al final, «Conectar WhatsApp», «Conectar el correo» (con sus guías) o «Ir a la bandeja».

## Órdenes

| Orden | Qué hace |
|---|---|
| `pnpm dev` | Arranca la app en local (y la prepara si falta `.env.local` o la base de datos). Lanza el trabajo en segundo plano cada 15 s; además, cada mensaje que llega lo lanza él mismo cuando toca responder, así que las respuestas llegan sin configurar ningún cron. |
| `pnpm run setup` | Solo la preparación. Siempre con `run`: `pnpm setup` es otra orden de pnpm que cambia el PATH del ordenador. Repetirla no cambia nada. |
| `pnpm lint` / `pnpm typecheck` | Revisan el código y los tipos. |
| `pnpm test` | Pruebas de Vitest (cada archivo con su propia base temporal; nunca toca `data/local.db`). |
| `pnpm test:e2e` | Pruebas de Playwright: compila la app, la arranca en los puertos 3100 (demo de la peluquería), 3102 (instalación vacía) y 3103 (demo del restaurante, para la agenda por aforo) con sus propias bases (`data/e2e.db`, `data/e2e-fresh.db` y `data/e2e-restaurante.db`) y simula los servicios externos en el 3101. La primera vez: `pnpm exec playwright install chromium`. |
| `pnpm build` / `pnpm start` | Compila la app como en producción y la arranca. En tu ordenador vale con `APP_URL=http://localhost:3000` (avisa de que solo funciona ahí) y el asistente pide el código de instalación (`SETUP_TOKEN`); publicada, `APP_URL` tiene que llevar `https://`. |
| `pnpm db:migrate` | Pone la base de datos al día (migraciones). |
| `pnpm db:generate` | Genera una migración nueva a partir del esquema (solo para desarrollar). |
| `pnpm seed [--sector=…]` | Carga la demo de un sector en lugar de la que haya: `peluqueria` (por defecto), `clinica-dental`, `fisioterapia`, `restaurante`, `taller`, `academia`, `inmobiliaria`, `tienda` u `otro`. Se niega si la base tiene datos de un negocio real, o si `DEMO_MODE` no es `true` (salvo con `--force-demo`). |
| `pnpm seed:embeddings` | Recalcula los embeddings de la demo de los nueve sectores con el modelo por defecto (`openai/text-embedding-3-small`, 1536 dimensiones) y los guarda en `seed/fixtures/embeddings.json`. Necesita `OPENROUTER_API_KEY` en `.env.local` y gasta céntimos de IA; sin la clave se niega y no cambia nada. No toca la base de datos. |
| `pnpm db:reset [--sector=…]` | Borra todo y deja la demo como recién instalada. Pregunta antes (`--yes` para no preguntar). |
| `pnpm db:fresh` | Borra todo y deja una instalación vacía con el asistente de arranque. Pregunta antes (`--yes`). |
| `pnpm worker` | Ejecuta el trabajo en segundo plano en bucle, para un servidor propio (VPS), con las mismas comprobaciones de arranque que la app. Con `EMAIL_IMAP_IDLE=true`, además lee al momento los buzones IMAP que tengan «Leer al momento». |

`db:reset` y `db:fresh` borran datos: para antes la app, y nunca los uses con datos reales. Con una base que no
es un archivo local se niegan salvo con `--remote-i-know`.

**Embeddings de la demo.** Un embedding es la versión en números de un trozo de texto, que permite buscar por
significado y no solo por palabras. La demo trae su base de conocimiento «Información del negocio» ya procesada:
dos documentos del negocio de ejemplo (en `seed/knowledge/<sector>/`, uno en Markdown y otro que se convierte en
PDF) y las preguntas frecuentes del sector. Sus embeddings se guardan en el repositorio, en
`seed/fixtures/embeddings.json`, para que la búsqueda por significado funcione nada más poner la clave, sin volver a
procesar nada. **Ese archivo está vacío hasta que el propietario del proyecto lo rellena una vez:**

1. Pon `OPENROUTER_API_KEY=<tu clave>` en `.env.local` (una clave real, con un límite de gasto pequeño).
2. Ejecuta `pnpm seed:embeddings`. Calcula los embeddings de los nueve sectores (unos cien trozos de texto; gasta muy
   poco), comprueba que cada uno tiene 1536 números y escribe el archivo. Si algo falla, no cambia nada.
3. Guarda `seed/fixtures/embeddings.json` en el repositorio (commit) y vuelve a cargar la demo (`pnpm db:reset`).

Mientras el archivo esté vacío, la demo busca solo por palabras hasta que haya clave, y `pnpm seed` avisa de cuántos
trozos esperan su embedding; con la clave guardada en Ajustes › IA, la app los calcula sola en segundo plano. Solo
hay que repetir la orden si cambian los documentos de `seed/knowledge/`, las preguntas frecuentes de los sectores o
el troceado.

## Variables de entorno

Están todas explicadas en `.env.example`. En local no tienes que tocar ninguna: `pnpm dev` crea `.env.local`.

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Base de datos: `file:./data/local.db` en local; la URL de Turso al publicar. |
| `DATABASE_AUTH_TOKEN` | Token de Turso (vacío en local). |
| `APP_URL`, `BETTER_AUTH_URL` | Dirección de la app, para los enlaces de los correos y el inicio de sesión. Con `APP_URL` se hacen también la dirección de avisos de WhatsApp (`https://<dominio>/api/webhooks/whatsapp`) y las de vuelta de Google y Microsoft: publicada, tiene que ser el dominio de producción con HTTPS (la versión compilada no arranca con `http://`, salvo `localhost` en tu ordenador). |
| `TRUSTED_PROXY_HOPS` | Opcional: cuántos proxies hay delante de la app (1 por defecto: Vercel o Traefik), para leer bien la IP de cada petición en los límites. |
| `BETTER_AUTH_SECRET` | Firma las sesiones. |
| `APP_ENCRYPTION_KEY` | Cifra las claves que el negocio pone en la app. **Guárdala aparte:** si se pierde, esas claves no se pueden leer. Sin ella la app no arranca. |
| `CRON_SECRET` | Protege la ruta del trabajo en segundo plano (`/api/cron/tick`). |
| `SETUP_TOKEN` | Código de instalación: en una instalación publicada, el primer paso del asistente lo pide para crear el propietario. En local, vacío. |
| `DEMO_MODE` | `true` en local: aviso «Modo demo» y canales de demo que nunca llaman a servicios reales. |
| `OPENROUTER_API_KEY` | Clave de OpenRouter (opcional; mejor en Ajustes › IA). |
| `BLOB_READ_WRITE_TOKEN` (y `BLOB_STORE_ID`) | Almacén privado de Vercel Blob al publicar (Vercel pone las dos al conectar el almacén); en local los archivos van a `data/uploads/`. |
| `FFMPEG_BIN` | Opcional: otro FFmpeg para convertir notas de voz a MP3. Sin ella se usa el que trae el proyecto. |
| `ALLOW_PRIVATE_MAIL_HOSTS` | Opcional: `true` permite conectar un buzón «Otro (IMAP/SMTP)» a un servidor de correo de la red local (uno propio junto a la app). Sin ella, la app solo se conecta a servidores con dirección pública. |
| `EMAIL_IMAP_IDLE` | Opcional, solo en un servidor propio con `pnpm worker`: `true` mantiene abierta la conexión IMAP de los buzones que tengan activado «Leer al momento» y lee el correo nuevo en cuanto llega. Sin ella, cada buzón se lee cada minuto. |
| `ALLOW_LOCAL_HTTP_TOOLS` | Solo para desarrollo y pruebas: `true` deja a las herramientas HTTP llamar a este ordenador o a la red local (con `pnpm dev` ya se permite). La versión compilada no arranca con ella. |
| `OPENROUTER_BASE_URL`, `META_GRAPH_BASE_URL`, `GOOGLE_OAUTH_BASE_URL`, `GOOGLE_API_BASE_URL`, `MS_LOGIN_BASE_URL`, `MS_GRAPH_BASE_URL`, `MISTRAL_BASE_URL` y `TELEGRAM_API_BASE_URL` | Solo para las pruebas, que apuntan a un simulador. No las cambies: la versión compilada no arranca con ellas. |
| `E2E_ALLOW_BASE_URL_OVERRIDES` | Solo la ponen los servidores de Playwright, para arrancar la versión compilada con el simulador. Nunca en una instalación real. |
| `REPLY_DEBOUNCE_MS` | Solo para las pruebas: espera fija antes de que la IA responda (en una instalación real, de 4 a 8 s). |

Los secretos van solo en `.env.local`, que nunca se sube a Git.

## Conectar canales reales

- **Chat web (ya disponible):** en Canales › Añadir canal › Chat web, añade el dominio de tu web (por ejemplo
  `www.tunegocio.es`) en «Dominios permitidos» y pega el código de «Apariencia y código» en tu web. El chat solo
  funciona en esos dominios y en la propia app. Hasta publicar la app, tu web no puede llegar a `localhost`:
  pruébalo en `/widget-demo`.
- **WhatsApp:** ver «Conectar WhatsApp real», justo debajo.
- **Correo** (Gmail, Outlook e IMAP/SMTP): ver «Conectar el correo real», más abajo.
- El correo de la propia app (invitaciones y recuperación de contraseña) ya se configura en Ajustes › Correo
  del sistema, con los datos SMTP de tu proveedor.

## Conectar WhatsApp real

Solo con la API oficial de Meta (Cloud API), con la app de Meta del propio negocio y un token permanente de un usuario
del sistema. La guía completa, con capturas y los problemas frecuentes, es
[`docs/guia-whatsapp.md`](docs/guia-whatsapp.md), también dentro de la app en **Ayuda › Conectar WhatsApp**
(`/ayuda/whatsapp`). Si usas un agente de código, la skill `conectar-whatsapp` (`.agents/skills/conectar-whatsapp/`)
te acompaña paso a paso. En resumen:

1. **Publica antes la app con HTTPS** (`docs/guia-despliegue.md`): Meta solo envía los avisos a una dirección pública
   con HTTPS. En local se pueden validar los datos, pero no llegan mensajes.
2. **En Meta** (portfolio del negocio, con acceso de administrador para quien lo implanta): crea la app con el caso de
   uso de WhatsApp en ese portfolio, un usuario del sistema con un token permanente con los permisos
   `whatsapp_business_messaging` y `whatsapp_business_management` (la app no acepta un token personal ni el
   temporal de API Setup), y copia el App Secret y el Phone Number ID.
3. **En la app:** Canales › Añadir canal › WhatsApp. El asistente valida los datos con Meta, suscribe la dirección de
   avisos (o te da la dirección y el token para pegarlos en el panel de Meta), registra el número con su PIN, te pide
   confirmar la app publicada (Live) y el método de pago, sincroniza las plantillas, te deja probar con un «hola» y
   termina con el agente activo en modo pruebas.
4. **Publica la app de Meta (Live)** con las direcciones de `/legal/terminos`, `/legal/privacidad` y
   `/legal/eliminacion-datos`, y **añade el método de pago** en WhatsApp Manager: desde el 1-10-2026, sin él Meta deja
   de entregar los mensajes de servicio al acabarse los 1.000 gratis del mes.
5. **Primero con el número de prueba de Meta** (apartado «Número de prueba de Meta» de la guía) y después con el
   número real. El número que conectes deja de funcionar en la app WhatsApp del móvil.
6. **Tarifas:** copia en Ajustes › WhatsApp las de tus mercados desde la tabla oficial de Meta, para ver el coste
   estimado de cada mensaje.

Esa prueba con el número de prueba de Meta está pendiente: se hará cuando la app esté publicada. Todo lo demás está
probado contra un Meta simulado con avisos reales de su documentación.

## Conectar el correo real

Cada buzón se conecta con las credenciales del propio negocio: su proyecto de Google Cloud o su app de Microsoft Entra,
nunca una compartida entre negocios. La guía completa, con los problemas frecuentes, es
[`docs/guia-correo.md`](docs/guia-correo.md), también dentro de la app en **Ayuda › Conectar el correo**
(`/ayuda/correo`), y la skill `conectar-correo` (`.agents/skills/conectar-correo/`) te acompaña paso a paso. Lo
comprobado de cada servicio está en `docs/integracion-correo.md`. En **Canales › Añadir canal › Correo**:

1. **Gmail:** un proyecto de Google Cloud del negocio con la API de Gmail activada, su pantalla de consentimiento
   («Internal» con Google Workspace; con @gmail.com, «External» publicada «En producción», nunca en «Testing», que corta
   el acceso a los 7 días) y un cliente OAuth de tipo «Aplicación web» con la dirección de redirección que da el
   asistente. Pega el Client ID y el Client Secret y pulsa «Conectar con Google»: si no se concedieron todos los
   permisos, la app lo dice y no conecta.
2. **Outlook / Microsoft 365:** una app de Microsoft Entra del negocio con la dirección de redirección, los permisos
   Mail.ReadWrite, Mail.Send, offline_access y User.Read y un Client Secret, que dura 24 meses como mucho: la app avisa
   30 días antes de que caduque. Pega el Client ID, el Client Secret con su caducidad y el Tenant ID («common» o el del
   negocio) y pulsa «Conectar con Microsoft».
3. **Otro (IMAP/SMTP):** el email y su contraseña (o una contraseña de aplicación); los servidores se rellenan según
   el dominio. «Probar conexión» comprueba la entrada y el envío, y el buzón solo queda conectado si funcionan los dos.
   Los buzones de Outlook y Microsoft 365 van por su opción: Microsoft ya no admite IMAP con contraseña.
4. **Respuestas y agente:** empieza con «Borrador para revisar» (la IA deja cada respuesta en la bandeja y en los
   borradores del buzón) y pasa a «Automático» cuando te fíes; elige el agente activo, la firma y los topes diarios.

En local también se puede probar: Google y Microsoft aceptan `http://localhost` en la dirección de redirección, y el
buzón se lee mientras la app está arrancada. Publicada, la dirección de redirección es la del dominio de producción
(sale de `APP_URL`). Hasta ahora todo está probado contra Google, Microsoft y servidores de correo simulados.

## Despliegue

La app todavía no está publicada: de momento funciona solo en local. Cuando toque, la guía paso a paso es
[`docs/guia-despliegue.md`](docs/guia-despliegue.md) (también dentro de la app, en Ayuda): Vercel con Turso (base
de datos), Vercel Blob privado (archivos), el código de instalación (`SETUP_TOKEN`) y un cron externo cada minuto,
porque el plan gratuito de Vercel solo admite uno al día. `vercel.json` ya trae ese cron diario a `/api/cron/tick`
y la región de las funciones en la UE. Los datos técnicos de cada servicio están en
`docs/plataforma-despliegue.md`. Con un agente de código, la skill `desplegar` (`.agents/skills/desplegar/`) sigue esa
guía, y `actualizar` pasa a una versión nueva con una copia de seguridad antes.

## Paso a un negocio real

1. Para la app y ejecuta `pnpm db:fresh`: borra la demo y deja la instalación vacía.
2. En `.env.local`, cambia `DEMO_MODE=true` por `DEMO_MODE=false` y arranca con `pnpm dev`.
3. Abre la app: el asistente de arranque te pide la cuenta de propietario, el negocio y su sector, el horario y
   la clave de OpenRouter.
4. Guarda `APP_ENCRYPTION_KEY` en un gestor de contraseñas.
5. Sigue la **lista de puesta en marcha** ([`docs/checklist-puesta-en-marcha.md`](docs/checklist-puesta-en-marcha.md),
   también en **Ayuda › Lista de puesta en marcha**): la privacidad de la cuenta de OpenRouter, los textos legales, el
   primer agente y su conocimiento, la agenda, los canales primero en modo pruebas, el equipo y las comprobaciones de
   cada semana y cada mes. Con datos de clientes, revisa con un abogado la plantilla de contrato de encargo del
   tratamiento ([`docs/contrato-encargo-tratamiento.md`](docs/contrato-encargo-tratamiento.md)).

A partir de aquí `pnpm seed` se niega a cargar la demo en esa base, para no mezclarla con datos reales. Con un agente
de código, la skill `nuevo-negocio` (`.agents/skills/nuevo-negocio/`) te acompaña en todo el recorrido, y
`crear-agente` prepara un agente a partir de la web o los documentos del negocio.

## Solución de problemas

- **`pnpm: command not found` o una versión de pnpm distinta:** ejecuta `corepack enable` y abre otra terminal.
- **Escribí `pnpm setup` y cambió el PATH:** era la orden de pnpm, no la del proyecto. La del proyecto es
  `pnpm run setup`.
- **El puerto 3000 está ocupado:** `pnpm dev -p 3200`.
- **Después de actualizar el proyecto falla la base de datos:** `pnpm db:migrate` (o `pnpm run setup`), que
  aplica las migraciones nuevas sin borrar nada.
- **«La base de datos está en uso» al usar `db:reset` o `db:fresh`:** para antes `pnpm dev` y `pnpm worker`.
- **«APP_ENCRYPTION_KEY falta o no es válida» y la app no arranca:** falta la clave en `.env.local`. En local,
  `pnpm run setup` la crea; si la tenías y la has perdido, las claves guardadas en la app hay que volver a
  escribirlas.
- **«Demasiados intentos. Espera unos minutos.»:** tras 5 contraseñas mal seguidas para el mismo email, cada intento
  tiene que esperar al anterior 1 minuto, luego 2, 4, 8 y como mucho 15; lo que intentes mientras tanto no cuenta. La
  contraseña correcta lo pone a cero. También hay un límite por IP.
- **No llegan las invitaciones ni los enlaces de recuperación:** sin servidor de correo se guardan en
  `data/outbox/` (y se ven en Ajustes › Diagnóstico). Para enviarlos de verdad, configura Ajustes › Correo del
  sistema.
- **Windows y rutas largas:** clona el proyecto en una ruta corta (por ejemplo `C:\proyectos\dominia-agentes`).
  Con rutas de más de 260 caracteres las herramientas no encuentran sus programas.
- **El asistente pide un «código de instalación» o dice que falta:** pasa en una instalación publicada (o con
  `pnpm build` y `pnpm start`). Es el valor de `SETUP_TOKEN`; si no existe, créalo como explica
  `docs/guia-despliegue.md`. Con `pnpm dev` no se pide.
- **Quiero empezar la demo de cero:** `pnpm db:reset` (o `pnpm seed --sector=…` para otro sector).
- **«Añade tu clave de OpenRouter» aunque la he puesto en `.env.local`:** reinicia `pnpm dev`; la de Ajustes › IA
  funciona al momento.
- **El agente no responde en Probar:** el mensaje dice por qué. Lo habitual: clave no válida o caducada, cuenta
  sin saldo o clave en su límite de gasto (se sube en OpenRouter), o «Este modelo no está disponible con tu
  configuración de privacidad» (elige otro modelo en la pestaña Modelo o revisa la privacidad de la cuenta).
- **El agente no contesta en el chat web ni en el simulador:** revisa, por este orden, que haya clave de OpenRouter,
  que el canal tenga «Agente activo» y la IA encendida (Canales), que la conversación no esté en pausa, apagada o
  «Pendiente de humano» (cabecera de la conversación), el modo pruebas del canal y «Fuera de horario». En cualquiera
  de esos casos el mensaje espera en la bandeja a una persona.
- **La respuesta tarda unos segundos:** es a propósito: la app espera de 4 a 8 segundos por si el cliente escribe
  algo más, y contesta todo junto (como mucho, 20 segundos desde el primer mensaje).
- **El chat no aparece en mi web:** añade su dominio exacto en «Dominios permitidos» del chat (sin `https://` ni
  rutas; con el puerto si lo tiene) y recuerda que la app tiene que estar publicada para que tu web llegue a ella.
- **Un adjunto no se envía desde la bandeja:** solo imágenes (JPG, PNG o WebP) y PDF de hasta 3,5 MB, y solo si el
  canal los admite (el chat web, imágenes si las tiene activadas).
- **No llegan los mensajes de WhatsApp:** revisa en el panel del número (Canales) los semáforos de avisos y
  suscripción, que la app esté publicada con HTTPS y la app de Meta en Live, y el modo pruebas del canal. Los errores
  de Meta salen en español con su código; la guía de WhatsApp los explica uno a uno en «Problemas».
- **En una conversación de WhatsApp no puedo escribir:** han pasado más de 24 horas desde el último mensaje del
  cliente (o Meta ha cerrado la ventana): solo se puede enviar una plantilla aprobada con «Elegir plantilla». Si no
  sale ninguna, sincroniza las plantillas desde el panel del número.
- **El correo no llega o la IA no lo contesta:** el panel del buzón (Canales) dice si «Requiere reconexión» (el acceso
  caducó, se revocó o cambió la contraseña; al reconectar sigue desde donde se quedó) y qué correos ignora (respuestas
  automáticas, boletines, «noreply»…). En la conversación, la cabecera dice si la IA está en pausa y por qué: una
  persona respondió desde su programa de correo o se llegó al tope diario. La guía del correo lo explica en «Problemas».
- **La lista de modelos no sale o le falta alguno:** sin clave no se carga. Solo aparecen modelos que admiten
  herramientas, con precio y sin fecha de retirada; «Actualizar lista» la vuelve a pedir a OpenRouter (se guarda
  12 horas).
- **El agente no usa el conocimiento:** en su pestaña Conocimiento, la base tiene que tener «Usar» encendido y, en
  «Automático», el agente necesita «Buscar en el conocimiento» encendida en Herramientas (la pestaña lo avisa).
  Comprueba con «Probar búsqueda» de la base que encuentra la respuesta.
- **La Agenda dice «Configura la agenda» o un servicio no tiene huecos:** hace falta al menos un servicio y un recurso
  activos (Agenda › Configuración). Un servicio solo tiene huecos donde coinciden el horario del negocio (Ajustes ›
  Horario) y el del recurso, fuera de festivos, ausencias y bloqueos, y dentro de su antelación mínima y máxima. La
  guía de la agenda lo explica paso a paso.
- **El agente no ofrece citas:** enciende sus herramientas de la agenda en Agentes › Herramientas («Consultar huecos
  libres», «Crear citas»…); un agente nuevo las trae apagadas.
- **Los documentos se quedan en «Listo (solo texto)»:** faltan los embeddings porque no había clave. Al guardar la
  clave en Ajustes › IA se calculan solos; si la pusiste en `.env.local`, reinicia la app: al arrancar los calcula en
  segundo plano («Reindexar», en los ajustes de la base, también sirve).
- **Un documento acaba en «Error»:** el motivo sale en la lista. Un PDF escaneado necesita la clave de Mistral OCR
  en Ajustes › IA; después, «Reintentar».
- **«Este archivo ya está en la base»:** ese mismo archivo ya se subió a esa base. Si ha cambiado, borra el antiguo.
- **`pnpm start` o `pnpm worker` no arrancan y dicen qué variable falla:** la versión compilada exige `APP_URL` y
  `BETTER_AUTH_URL` con `https://` (en tu ordenador, `http://localhost` también vale) y no admite las variables de
  pruebas (`*_BASE_URL`, `ALLOW_LOCAL_HTTP_TOOLS`). Corrige la que nombra el mensaje.
- **No me llegan los avisos push:** el navegador tiene que tener permiso de notificaciones para la app, y en el iPhone
  la app tiene que estar publicada con HTTPS y añadida a la pantalla de inicio. En Mi cuenta, «Tus dispositivos con avisos»
  dice cuáles los reciben; qué sucesos avisan se elige en Ajustes › Notificaciones.
- **Un cliente dice que no le llegan los mensajes:** mira en su ficha si se dio de baja en ese canal («Consentimientos y bajas»);
  mientras dure, nada sale hacia él por ese canal. Si te pide volver, «Levantar baja».
- **Una herramienta HTTP falla en «Probar»:** el mensaje dice por qué (sin HTTPS, dirección interna, tiempo agotado,
  error del servicio…). La dirección tiene que ser pública con `https://`; con n8n, la de producción del Webhook y el
  flujo activo.
- **`pnpm seed:embeddings` dice que falta la clave:** pon `OPENROUTER_API_KEY` en `.env.local` (la de Ajustes › IA
  no sirve para esta orden, que no abre la base de datos).

## Cómo se trabaja en este proyecto

Se construye por fases con un agente de código. Lo que el agente cumple sin que se lo pidan está en
`AGENTS.md` y en `docs/`. Esto es lo que se le pide en cada momento:

| Cuándo | Qué se le pide |
|---|---|
| Para decidir el aspecto, antes de la primera fase con pantallas | «Vamos con el diseño. Sigue docs/design.md.» |
| Al volver con el diseño hecho fuera | «Ya he dejado el diseño en docs/design/. Léelo y dime qué has entendido.» |
| Al empezar cada fase, en una conversación nueva | «Vamos con la fase 1 de docs/spec.md. Propón un plan.» |
| Si algo no funciona | Lo que se ve y lo que se esperaba: «Al pulsar Guardar no pasa nada; esperaba ver el contacto en la lista.» |
| Al acabar una fase | «Cierra la fase 1.» |
| Para un retoque: un texto, un color, un botón que se mueve | Se pide tal cual, sin más: «Cambia el título de la portada por…» |
| Para añadir o cambiar algo | «Quiero que la app también…» o «Quiero que esto funcione de otra forma»: primero cambia la especificación y después se construye |
| Para que el agente cumpla algo siempre | «Añade a las reglas de AGENTS.md: …» |
| Para que otro revise una fase, en una conversación nueva | «Revisa la fase 1 siguiendo docs/review.md. No cambies nada.» |
| Antes de publicar, en una conversación nueva | «Revisa el proyecto contra docs/security.md.» |
| Para publicar la app o una versión nueva | «Quiero publicar la app.» |
| Cada mes o dos, con la app publicada | «Haz el mantenimiento.» |

## Documentación

Todo lo demás está en `docs/`, con su índice en `docs/README.md`: la especificación (`docs/spec.md`), la
arquitectura (`docs/architecture.md`), la seguridad (`docs/security.md`), las pruebas (`docs/testing.md`) y los
datos comprobados de cada servicio externo (`docs/integracion-*.md`).

Guías para el negocio (también dentro de la app, en Ayuda):

- [Crear agentes y darles el conocimiento del negocio](docs/guia-agentes-y-conocimiento.md): crear, ajustar y
  probar un agente, ponerlo a responder en un canal, y darle archivos de contexto y bases de conocimiento con sus
  documentos, webs y preguntas frecuentes.
- [La agenda](docs/guia-agenda.md): palabras, modo por recurso o por aforo, servicios, recursos, horarios, ausencias
  y bloqueos, el calendario, qué hace el agente con las citas, las citas de prueba y los recordatorios.
- [Conectar WhatsApp](docs/guia-whatsapp.md): portfolio, app, token, publicación, método de pago, la prueba con
  el número de prueba de Meta y los problemas frecuentes.
- [Conectar el correo](docs/guia-correo.md): Gmail con el proyecto de Google Cloud del negocio, Outlook o Microsoft
  365 con su app de Microsoft Entra u otro buzón por IMAP/SMTP; modos de respuesta, filtros y problemas frecuentes.
- [Publicar la app en Vercel](docs/guia-despliegue.md).
- [Lista de puesta en marcha](docs/checklist-puesta-en-marcha.md): de `pnpm db:fresh` a la primera conversación de un
  negocio real.

Para el negocio, fuera de la app: la [plantilla de contrato de encargo del tratamiento](docs/contrato-encargo-tratamiento.md)
(revísala con un abogado).

Skills para un agente de código (en `.agents/skills/`, con su puente en `.claude/skills/`): `nuevo-negocio`,
`conectar-whatsapp`, `conectar-correo`, `crear-agente`, `desplegar`, `actualizar` y `diagnostico`.
