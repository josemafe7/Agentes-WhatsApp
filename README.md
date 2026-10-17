# DominIA Agentes

Plataforma de agentes IA de atención al cliente (WhatsApp, correo, chat web, Telegram e Instagram) y de agentes internos para el
equipo, que se instala una vez por negocio y se configura sin tocar código. Cada instalación es de un solo negocio,
con su propia base de datos y sus propias claves.

**Estado: construidas las fases 0 a 7, solo en local; en marcha la fase 8 (Supabase para la app publicada).** Todo lo
del encargo funciona ya en tu ordenador: el arranque
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

**Fase 9 (2026-10-09):** Telegram (un bot con su token, también en local) y dos formas más de conectar WhatsApp:
YCloud con coexistencia (la API oficial sin dejar de usar el móvil) y código QR con Baileys (no oficial, con su aviso
de riesgo). Están probadas contra servicios simulados y, el código QR, generando un código real de WhatsApp; falta
probarlas con un bot, una cuenta de YCloud y un número de verdad.

**Fase 10 (2026-10-09):** agentes internos. Además de los agentes que atienden a tus clientes, puedes crear agentes
para tu equipo: responden con los documentos de la empresa (en bases de conocimiento internas, que un agente de
clientes nunca puede leer) a las personas a las que des acceso, desde el apartado «Asistentes». Lo que cada persona
pregunta solo lo ve ella. Está probado con la IA simulada; falta probarlo con una clave real y tus documentos.

**Fase 11 (2026-10-16):** la demo es ahora una clínica de fisioterapia, «Fisioterapia Movimiento» (los demás sectores
se cargan con `pnpm seed --sector=…`; la peluquería, con `pnpm seed --sector=peluqueria`), y el calendario se lee
mejor con muchas citas. En la semana, cada cita lleva su hora, su nombre y su servicio, acortados en palabra entera;
si coinciden más de tres a la vez, un «+N» abre la lista de las demás; lo libre se distingue de lo ocupado, y el
cierre de mediodía se pliega en una franja. En el mes, cada día dice cuántas citas tiene y lo lleno que está.

**Fase 12 (2026-10-16):** permisos, plantillas desde la app y recordatorios con confirmación. Cada cliente tiene dos
permisos, «Avisos de sus citas» y «Novedades y publicidad», con cómo y cuándo los dio, y sus bajas por canal (de todo o
solo de publicidad). Las plantillas de WhatsApp se crean desde el panel del número, con los modelos «Recordatorio de
cita» y «Novedades y publicidad». Una cita puede tener hasta tres recordatorios, cada uno por WhatsApp, Telegram o
correo en el orden que elijas, y el cliente los contesta con «Confirmo» (la cita queda «Confirmada por el cliente») o
«Necesito cambiarla» (la IA le ofrece otros huecos). La IA pregunta al reservar si puede avisar y da de baja a quien
lo pide con sus palabras. Está probado con Meta, YCloud, Telegram y la IA simulados; falta probarlo con un número y
un bot de verdad.

**Fase 13 (2026-10-16):** importar contactos. En Contactos › Importar, el propietario o un administrador trae sus
clientes de un Excel o un CSV (hay una plantilla para descargar): la app enseña antes lo que va a pasar, fila a fila,
salta los que ya existen sin cambiarlos y guarda los permisos que marque el archivo, después de que confirmes que los
clientes los dieron. A un contacto importado, el primer recordatorio por WhatsApp le llega a su teléfono; su WhatsApp
queda «sin confirmar» hasta que alguien del equipo lo confirma desde la conversación, y mientras la IA solo atiende la
cita del recordatorio. Si contesta a un recordatorio que le llegó por el correo del sistema, su respuesta llega a su
conversación. Probado con Meta y el correo simulados.

**Fase 14 (2026-10-16):** envíos programados. Desde Contactos, el propietario o un administrador manda novedades y
publicidad a los contactos marcados (o a todos los de una etiqueta o un canal) por WhatsApp, Telegram o correo: antes
de programarlo ve cuántos lo recibirán, quién no y por qué (sin el permiso «Novedades y publicidad», de baja, envío
reciente…) y el coste estimado. Sale a su hora, dentro de las horas de envío de Ajustes › Envíos y a un ritmo que
respeta el límite de Meta sin quitar sitio a los recordatorios; se para solo si algo va mal y se reanuda a mano. Cada
mensaje deja darse de baja (el botón de la plantilla, «No quiero publicidad» en Telegram o «Darme de baja» en el
correo, que funciona sin iniciar sesión). Probado con Meta, Telegram y el correo simulados; el correo de un envío
necesita la app publicada con HTTPS.

**Fase 15 (2026-10-16):** envíos automáticos y repetidos. Uno sale solo unos días después de cada cita (por ejemplo,
para preguntar qué tal fue), una vez por cita y solo a quien no tiene otra cita después; otro sale cada semana o cada
mes a los contactos que tienen una etiqueta en ese momento. Siguen las mismas reglas que cualquier envío, y cada vez
que salen es un envío más en la lista, con sus resultados. Probado con la hora fijada, también en el cambio de hora.

**Fase 16 (2026-10-16):** Instagram. Un agente responde a los mensajes directos de la cuenta profesional de Instagram
del negocio, y el equipo también puede responder desde la bandeja, donde cada conversación dice ahora a simple vista
por qué canal llegó («Instagram · @cuenta», «WhatsApp · Recepción»). Se conecta como WhatsApp con Meta: una app de
Meta del negocio, su token y su clave. Probado con Instagram simulado; falta probarlo con una cuenta real (la guía dice
cómo, empezando por escribir desde una cuenta que no tenga nada que ver con la app de Meta).

## Requisitos

- **Node.js 24 LTS** (`node -v` debe mostrar `v24.…`).
- **pnpm 10**. Viene con Node a través de Corepack: actívalo una vez con `corepack enable` y el proyecto usa
  solo la versión exacta que pide (`packageManager` en `package.json`). No uses npm ni yarn.
- **Git**, para clonar el repositorio.

No hace falta ninguna cuenta, servidor ni Docker: la base de datos es un Postgres integrado en la propia app (PGlite),
que se guarda en la carpeta `data/pglite`. Supabase solo se usa cuando se publica la app (ver «Despliegue»).

## Arranque rápido

```bash
git clone <url-del-repositorio> dominia-agentes
cd dominia-agentes
corepack enable
pnpm install && pnpm dev
```

Abre <http://localhost:3000> y entra con uno de los usuarios de prueba.

La primera vez, `pnpm dev` prepara la instalación antes de arrancar: crea `.env.local` con secretos al azar
(clave de cifrado, secreto de las sesiones y secreto del cron) y la demo activada, crea la base integrada en
`data/pglite`, aplica las migraciones y carga la demo de una clínica de fisioterapia. Las siguientes veces arranca directamente. Mientras está en
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
4. **Agentes › Recepción de fisioterapia › Modelo:** abre «Modelo principal». Debe salir la lista real con
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
   además ocho conversaciones de ejemplo: una reserva por WhatsApp, una nota de voz con su transcripción, un
   traspaso urgente pendiente, uno resuelto por una persona con su nota interna, una foto por el chat web,
   preguntas frecuentes, un hilo de correo con un borrador de la IA y un mensaje directo de Instagram que contestó la
   IA. Cada una dice por qué canal llegó: «WhatsApp», «Chat web · Chat de la web», «Correo · Gmail» o
   «Instagram · @cuenta». Hay filtros (canal, estado, asignado, IA o persona, sin leer, etiquetas), buscador y el
   contador de no leídos junto a «Bandeja» en el menú.
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
7. **Simulador** (**Ajustes › Diagnóstico › Simulador**): manda un mensaje como si fueras un cliente de cualquiera de
   tus canales (texto, audio, imagen o documento, con un ejemplo o un archivo tuyo de hasta 1 MB).
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
   de cómo queda) y envíala: la IA de esa conversación se pausa, como con cualquier respuesta de una persona. Solo sale
   a quien tiene el permiso que pide la plantilla: si falta, el diálogo lo dice y te deja anotarlo.
3. **Coste estimado:** bajo cada mensaje enviado por WhatsApp se ve su coste en cuanto Meta (aquí, la demo) dice si se
   cobra: «Gratis · Servicio» para las respuestas dentro de la ventana y «≈ 0,02 US$ estimado · Utilidad» para la plantilla,
   calculado con la tarifa de ejemplo de España.
4. **Ajustes › WhatsApp** (propietario y administrador): las tarifas por mercado y categoría de Meta. Las de la demo
   van marcadas «Ejemplo»: no son precios reales. Aquí también están la dirección de avisos de la instalación y su
   token de verificación, para copiarlos en la app de Meta.
5. **Canales › WhatsApp:** el panel del número (en la demo, con el aviso de canal de demostración), sus plantillas
   (las dos de los modelos de la app aprobadas, otra aprobada, una pendiente y una rechazada con su motivo), el modo
   pruebas, los ajustes de envío y los límites de Meta. «Nueva plantilla» crea una desde un modelo; en la demo queda
   aprobada al momento, sin llamar a Meta.
6. **Canales › Añadir canal › WhatsApp:** el asistente para conectar un número real, paso a paso (ver «Conectar
   WhatsApp real»). En local puedes validar los datos con Meta, pero sin una dirección pública con HTTPS no llegarán
   mensajes: el propio asistente lo avisa.
7. **Páginas legales**, sin iniciar sesión: `/legal/privacidad`, `/legal/terminos` y `/legal/eliminacion-datos`, con
   los datos del negocio. Meta pide sus direcciones para publicar la app.

### Conocimiento (fase 4)

La demo trae la base de conocimiento «Información del negocio», ya procesada: los servicios con sus precios (un
documento en Markdown), qué hacer antes de la sesión y cómo llegar (un PDF de dos páginas) y las preguntas frecuentes
del sector. Los tres agentes de la demo la usan en modo «Automático», con la herramienta «Buscar en el conocimiento».

1. **Conocimiento** (entra como `propietario@demo.test`): la tarjeta de la base con sus documentos, fragmentos, estado,
   modelo de embeddings y los agentes que la usan. Sin clave de OpenRouter se lee «Sin clave, la búsqueda va solo por
   texto» y los documentos están «Listo (solo texto)»: se encuentran por palabras desde el primer momento.
2. **Probar búsqueda** (pestaña de la base): escribe «autobus» o «cuanto cuesta la puncion seca». Salen los fragmentos
   numerados con su título, sección, página y puntuación, sin gastar en el modelo de chat; no distingue mayúsculas ni
   tildes y encuentra otras formas de la misma palabra («sesiones» encuentra «sesión»). Con algo que no está
   en la base sale «Nada relevante».
3. **Añadir contenido:** sube un PDF, Word, Excel, CSV, TXT o Markdown (hasta 25 MB; 4 MB con la app en Vercel), una
   página web (con su mapa del sitio, hasta 50 páginas, y lectura periódica si quieres) o una pregunta frecuente. Cada
   documento pasa por «En cola → Extrayendo → Troceando → Embeddings → Listo» en segundo plano, y el mismo archivo dos
   veces se rechaza. Pulsa un documento para ver su resumen y sus fragmentos, y si alguna de sus páginas se ha quedado
   sin leer por no tener texto. Un PDF escaneado necesita la clave de Mistral OCR (Ajustes › IA).
4. **El agente** (Agentes › Recepción de fisioterapia › Conocimiento): las bases que usa, «Automático» o «Buscar siempre» y,
   al final, sus archivos de contexto (texto que va entero en cada mensaje, con tope de 30.000 tokens y «Pasar a una
   base de conocimiento»). En **Probar**, pregunta «¿Cómo llego en autobús?»: con la clave, responde con el dato del PDF y
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

La demo trae la agenda de la clínica de fisioterapia en marcha: dos fisioterapeutas (Álvaro Díaz y Nuria Campos) con su
horario semanal (de lunes a viernes, de 8:00 a 14:00 y de 15:30 a 21:00), los servicios del sector con su duración,
márgenes y precio orientativo, y unas doscientas citas colocadas respecto al día en que se carga la demo (de dos
semanas atrás a dos semanas adelante), en todos los estados, hechas por la IA, por personas y desde «Probar agente»,
más unas vacaciones y un hueco bloqueado. Con `pnpm seed --sector=peluqueria` la misma agenda es la de una peluquería.
La guía completa es [`docs/guia-agenda.md`](docs/guia-agenda.md), también en **Ayuda › La agenda**.

1. **Agenda** (entra como `propietario@demo.test`): vistas **Día**, **Semana**, **Mes** y **Recursos** (una columna por
   profesional), con el horario, los festivos, las ausencias y los bloqueos, y filtros por profesional, servicio,
   estado, origen (IA, persona o web) y citas de prueba. Todas las horas son las del negocio (`Europe/Madrid`). En la
   **Semana**, cada cita lleva su hora, su nombre y su servicio (acortados en palabra entera si no caben; enteros al
   pasar el ratón), lo libre se ve en blanco y lo ocupado un poco más oscuro, y el cierre de mediodía (de 14:00 a
   15:30) se pliega en una franja; si coinciden más de tres citas a la vez (pruébalo con el restaurante), se ven tres
   y un «+N» con las demás. En el **Mes**, cada día dice cuántas citas tiene y lo lleno que está, y pulsándolo se abre.
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
6. **El agente reserva** (con la clave de OpenRouter): en `/widget-demo` escribe, por ejemplo, «Quiero una sesión de
   fisioterapia el jueves por la tarde». La «Recepción de fisioterapia» (con las herramientas de la agenda encendidas en
   Agentes › Herramientas) consulta los huecos, ofrece 2 o 3 concretos, espera a que elijas y confirma en una sola
   respuesta. La cita aparece en la Agenda con origen «IA · Chat de la web», enlazada a la conversación. Un servicio
   marcado «Requiere confirmación manual» (Agenda › Configuración › Servicios) deja la cita «Pendiente», el agente lo
   dice y la campana avisa «Cita pendiente de confirmar»; en la demo hay una «Primera valoración» pendiente de
   confirmar la hora. La conversación de WhatsApp de Laura Gil tiene la sesión que la IA le reservó.
7. **Probar agente:** una cita pedida en la pestaña Probar se crea marcada «Prueba» y sin cliente. Se borran todas con
   «Borrar citas de prueba» (en Probar) o «Citas de prueba (N)» › «Borrar todas» (en la Agenda).
8. **Contactos y bandeja:** la lista de Contactos enseña la próxima cita de cada uno; la ficha de un contacto, sus citas
   próximas y pasadas con «Nueva cita»; y en la bandeja, el panel del contacto enseña sus próximas citas y «Nueva cita»,
   que la deja unida a esa conversación.
9. **Recordatorios** (**Ajustes › Recordatorios**, propietario y administrador): desactivados por defecto en una
   instalación nueva; la demo los trae encendidos: el día antes a las 10:00 por WhatsApp (o, si no puede, por correo) y
   2 horas antes por WhatsApp, con la plantilla «recordatorio_cita» del WhatsApp de demo. Hasta tres por cita, cada uno
   con su antelación y sus canales en orden (WhatsApp, Telegram o correo). Por WhatsApp y Telegram solo salen a quien
   tiene el permiso «Avisos de sus citas» (en la demo, los clientes de WhatsApp menos uno, dado de baja). Cada
   recordatorio sale una vez por cada hora de la cita, nunca si está cancelada o el cliente se ha dado de baja, y se
   recalcula si la cita se mueve. En la demo, los de correo se guardan en `data/outbox/` y los de WhatsApp salen por el
   canal de demo, que nunca llama a Meta: se ven en la conversación de cada cliente y en la ficha de la cita
   («Recordatorios»). Por WhatsApp, cada recordatorio se cobra (plantilla de utilidad).
   Para ver los botones: en el **Simulador**, escribe como un cliente de WhatsApp de la demo y reserva con la IA; en la
   confirmación te preguntará si puede avisarte, y con «Sí» queda anotado en su ficha («Permisos»).
10. **Restaurante (agenda por aforo):** `pnpm seed --sector=restaurante` carga un restaurante con Comedor (40 plazas) y
    Terraza (24): cada reserva de mesa dura 90 minutos y la vista de Recursos enseña la ocupación de cada franja
    («22/24»). Un grupo que ya no cabe no tiene huecos.
11. **Cada rol:** el supervisor gestiona citas, bloqueos y ausencias; el Agente crea, cambia y cancela citas de los
    clientes de sus canales; «Solo lectura» ve la agenda sin cambiar nada.

### Correo (fase 6)

El canal «Correo» de la demo está marcado «Demo»: nunca llama a Google, a Microsoft ni a un servidor de correo. Lo que
recibe llega por el simulador y lo que «envía» solo se guarda. Como todo buzón nuevo, responde con borradores para
revisar. La guía completa es [`docs/guia-correo.md`](docs/guia-correo.md), también en **Ayuda › Conectar el correo**.

1. **Bandeja:** el hilo de correo de Isabel Prieto («Fisioterapia para un equipo de pádel») lleva el asunto arriba y
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
   espera en la bandeja a una persona. Lo mismo si escribe con sus palabras «no me mandéis más mensajes» (lo anota la IA;
   con «no quiero publicidad», solo de novedades y publicidad). En la ficha del contacto, el aviso «Dado de baja» y los
   consentimientos enseñan la baja con su fecha y canal, y «Levantar baja» la quita (solo si el cliente lo pide; queda
   anotado quién, cuándo y por qué).
2. **Contactos:** «Posibles duplicados» (mismo email o teléfono) y «Fusionar» dos contactos eligiendo qué datos se
   quedan; «Exportar» la lista (CSV, con la búsqueda y los filtros) o los seleccionados; y en la ficha, «Exportar datos»
   (todo lo del contacto en un archivo) y «Borrar contacto» escribiendo su nombre (o, desde la lista, «Borrar» varios
   escribiendo cuántos son): se borran sus datos, mensajes y archivos, y sus citas se quedan sin nombre para que los
   informes cuadren. La búsqueda de Contactos y de la Bandeja no distingue tildes: «jose» encuentra «José».
3. **Ajustes › Privacidad y legal:** los textos de `/legal/privacidad`, `/legal/terminos` y
   `/legal/eliminacion-datos`, el aviso de IA por defecto y los plazos de conservación (conversaciones 12 meses, audios
   30 días tras transcribirlos, adjuntos 90 días, avisos en bruto 14 días y resultados de los envíos 12 meses), con
   borrado o anonimización. La limpieza
   corre cada día y deja en el Registro de actividad cuánto borró.
4. **Informes** (menú): conversaciones por canal, porcentaje resuelto por la IA, traspasos y sus motivos, tiempo hasta
   la primera respuesta de una persona (y cuántos en menos de 3 minutos), citas creadas por la IA y costes de IA y de
   WhatsApp, por mes o por fechas y por canal; el propietario y los administradores tienen además «Descargar CSV» en
   cada tabla. «Probar agente» nunca cuenta.
5. **App instalable y avisos push:** en **Mi cuenta** (o Ajustes › Notificaciones), «Instalar la app» la pone en el
   ordenador o el móvil con el nombre y el logo del negocio, y «Activar avisos en este dispositivo» manda un push cuando
   hay un traspaso («Traspaso: Ana», sin el texto del mensaje). En local funciona en <http://localhost:3000>; en el
   iPhone hace falta la app publicada con HTTPS y añadida a la pantalla de inicio. Al cerrar sesión, ese dispositivo
   deja de recibirlos.
6. **Herramientas HTTP** (**Agentes › Herramientas HTTP**, propietario y administrador): conecta un agente con n8n o tu
   CRM: nombre, descripción, datos que envía la IA, método, dirección `https://`, cabeceras secretas (cifradas) y
   tiempo máximo, con «Probar». Después se enciende en la pestaña Herramientas de cada agente.
7. **Ayuda:** además de las guías, la **Lista de puesta en marcha** de un negocio real (`/ayuda/puesta-en-marcha`).

### Agentes internos (fase 10)

La demo trae un agente interno, «Asistente del equipo», con la base interna «Manual interno» (un documento de
ejemplo con normas del equipo: apertura y cierre, vacaciones, incidencias, compras…). Lo puede usar todo el equipo.

1. **Asistentes** (entra como `agente@demo.test`): está en el menú porque tienes un agente interno que usar. Ábrelo
   y, con la clave de OpenRouter puesta, pregunta «¿Cuántos días de vacaciones tengo?». Responde con el dato del
   manual y «Ver la fuente» dice de qué documento sale. Sin clave, lo dice y no deja enviar.
2. **Tus conversaciones:** a la izquierda quedan las tuyas con ese agente; puedes seguir una, empezar otra o
   borrarla. Entra después como `propietario@demo.test` y abre el mismo asistente: no ves las del agente, solo las
   tuyas.
3. **Crear otro** (como `propietario@demo.test`): Conocimiento › «Nueva base» con «Uso: Interna» y un documento;
   Agentes › «Nuevo agente» › «Interno, para tu equipo»; en su pestaña Conocimiento, activa la base; en **Acceso**,
   elige «Personas concretas» y marca a quien quieras. Solo esa persona (y propietario y administradores) lo verá
   en «Asistentes».
4. **Lo que no se puede:** abre Agentes › Recepción de fisioterapia › Conocimiento: las bases internas no aparecen, porque
   ese agente atiende clientes. Y un agente interno no tiene las pestañas Canales, Herramientas ni Traspaso.
5. **Quién ve qué:** como `supervisor@demo.test`, ni «Asistente del equipo» sale en Agentes ni «Manual interno» en
   Conocimiento; solo puede usar el asistente desde «Asistentes». Como `lectura@demo.test` no hay «Asistentes».
6. **Informes:** bajo el coste de IA se lee cuánto de él han gastado los agentes internos y cuántas preguntas han
   respondido.

Si tu demo se cargó antes de esta fase, no trae el agente interno de ejemplo: `pnpm db:reset` la vuelve a cargar
(borra lo que hayas cambiado en local). Los pasos 3 a 6 funcionan igual sin recargarla.

### Envíos (fases 14 y 15)

La demo trae un envío ya hecho por el WhatsApp de demo, «Novedades de la temporada», y otro programado para dentro de
tres días, «Bonos de este mes». La guía completa es [`docs/guia-envios.md`](docs/guia-envios.md), también en
**Ayuda › Envíos**.

1. **Envíos** (menú, entra como `propietario@demo.test`): la lista con el estado de cada uno, cuándo sale, por qué
   canales, a cuántos contactos y cómo va, y arriba las normas en pocas líneas. Abre «Novedades de la temporada»: los
   dos clientes con el permiso «Novedades y publicidad» lo recibieron (uno lo leyó) y los demás no, cada uno con su
   motivo (sin permiso o de baja).
2. **Programar uno:** en **Contactos**, marca varios contactos y pulsa «Programar envío» (o «Envío a todos» / «Envío a
   los del filtro» arriba). Ponle nombre, marca WhatsApp, elige el número de demo y la plantilla
   «novedades_y_publicidad», y pulsa «Revisar destinatarios»: cuántos lo recibirán por cada canal, quién no y por qué,
   el coste estimado y, si hay que repartirlo, cuándo terminará. Después, «Programar envío». En local el correo no se
   ofrece (su enlace de baja necesita la dirección pública con HTTPS).
3. **Cómo sale:** solo entre las horas de **Ajustes › Envíos** (de 9:00 a 21:00 por defecto), 30 por minuto por
   WhatsApp, 20 por Telegram y los correos que digan los topes; un mismo contacto, como mucho uno cada 7 días. En la
   demo, lo que «sale» por el WhatsApp de demo solo se guarda: se ve en la conversación de cada cliente, con el nombre
   del envío, y en sus resultados (enviado, entregado, leído).
4. **Pausar, reanudar, cambiar, cancelar:** un envío programado se cambia o se cancela hasta que empieza; en marcha,
   se pausa, se reanuda o se cancela lo que falta. Si algo va mal (Meta pausa la plantilla, un canal se desconecta,
   fallan muchos mensajes), se para solo, dice por qué y avisa al propietario y a los administradores («Envío parado»).
5. **Darse de baja:** con el botón de la plantilla de WhatsApp, «No quiero publicidad» en Telegram o «Darme de baja» al
   pie del correo, el cliente deja de recibir publicidad por ese canal (los recordatorios de sus citas siguen) y queda
   en sus consentimientos.
6. **Quién ve qué:** el supervisor y «Solo lectura» ven los envíos y sus resultados sin programarlos; el rol Agente no
   ve Envíos.

7. **Automáticos y repetidos** (fase 15): en **Envíos › Automáticos y repetidos** está «¿Qué tal tu cita?», activo:
   dos días después de cada cita, a las 11:00, pregunta al cliente qué tal le fue, solo si no tiene otra cita después.
   Con «Nuevo automático o repetido» se crea otro: tras la cita, cada semana o cada mes (si el mes no tiene ese día,
   el último), a los contactos de una etiqueta en ese momento. Se pausa, se activa, se cambia o se borra desde su
   página, que dice cuándo sale la próxima vez y los envíos que ha hecho.

Si tu demo se cargó antes de esta fase, no trae los envíos de ejemplo: `pnpm db:reset` la vuelve a cargar (borra lo
que hayas cambiado en local). Los pasos 2 a 7 funcionan igual sin recargarla.

### Instagram (fase 16)

La cuenta de Instagram de la demo, «@fisioterapia_movimiento.demo» (en otro sector, el nombre del negocio seguido de
«.demo»), está marcada «Demo»: nunca llama a Instagram. Lo que recibe llega por el simulador y lo que «envía» solo se
guarda. La guía completa es [`docs/guia-instagram.md`](docs/guia-instagram.md), también en **Ayuda › Guía de
Instagram**.

1. **Bandeja:** el mensaje directo de Instagram (un cliente pregunta dónde estáis y qué horario tenéis, y la IA le
   contesta) dice su canal en la lista y en su cabecera: «Instagram · @fisioterapia_movimiento.demo». El filtro
   «Canal» lo nombra igual.
2. **Ventana de 24 horas:** encima del cuadro de escribir se lee «Puedes responder hasta … · quedan …». Pasadas 24
   horas desde el último mensaje del cliente (si cargaste la demo hace más de un día, ya han pasado), no se puede
   enviar nada hasta que vuelva a escribir y la bandeja lo explica; sí se puede dejar una nota interna.
3. **Simulador** (**Ajustes › Diagnóstico › Simulador**): elige el canal «@fisioterapia_movimiento.demo · Instagram»
   y escribe como un cliente nuevo (texto, nota de voz, imagen o PDF). Llega a la bandeja con la ventana abierta y,
   con la clave de OpenRouter, la IA responde; esa respuesta nunca sale de la app.
4. **Canales › Añadir canal › Instagram:** el asistente para conectar una cuenta real (ver «Conectar canales
   reales»).

Si tu demo se cargó antes de esta fase, no trae la cuenta de Instagram: `pnpm db:reset` la vuelve a cargar (borra lo
que hayas cambiado en local).

### Lo demás

- **Entrar con cada rol** y ver cómo cambia el menú: Bandeja, Contactos, Agenda, Envíos, Asistentes (solo si tienes
  algún agente interno que usar), Agentes, Conocimiento, Canales, Informes y Ajustes. En todas las pantallas aparece el
  aviso «Modo demo».
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
- **Agentes:** la demo trae tres agentes para clientes, creados desde la plantilla de la fisioterapia: «Recepción de
  fisioterapia» (con dos versiones, para probar a restaurar), «Asistente de correo» y «Asistente fuera de horario», preparado
  sin activar; y un agente interno, «Asistente del equipo» (ver «Agentes internos (fase 10)»). Crea uno con «Nuevo agente» (plantilla de tu sector, de otro sector, en blanco o «Generar
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
  agentes y darles el conocimiento del negocio, la agenda, los envíos, conectar WhatsApp, conectar el correo, publicar
  en Vercel y la lista de puesta en marcha.
- **Ajustes › Horario, IA, Correo del sistema, Privacidad y legal y Notificaciones:** horario con varios tramos
  por día y festivos; la clave de OpenRouter, los modelos por defecto (chat, respaldo de otro proveedor,
  transcripción, embeddings y descripción de imágenes) elegidos de la lista con precios, la lista de
  recomendados y «Sin retención de datos», con aviso si un modelo en uso se retira (también en la campana y por email al
  propietario y a los administradores, una vez por modelo; la lista se vuelve a pedir sola cada 12 horas) o si el de transcripción tiene
  proveedores que pueden guardar los audios, «Reordenar resultados» del conocimiento con su modelo (desactivado por
  defecto; con «Sin retención de datos» solo se ofrece el que no guarda nada y, si el elegido sí guarda, lo avisa y
  no reordena), y la clave de Mistral OCR para los PDF escaneados; el servidor SMTP de los correos de la app; textos legales, aviso de IA y plazos de conservación; y quién recibe cada aviso.
- **Ajustes › Registro de actividad y Diagnóstico:** quién hizo qué (personas, IA y sistema), en español y con
  filtros; y, empezando por un resumen que dice si todo funciona o qué hay que revisar, el estado de la base de datos, de la cola de trabajos (con «Reintentar»), los errores recientes de la IA
  (si una respuesta falla también al reintentarla, la conversación pasa a una persona y el error aparece aquí), el
  último aviso de cada canal, los correos que cada buzón ignoró y por qué, y los correos que ha enviado la app, que en
  local puedes abrir desde ahí. **Pruebas de conexión** ejecuta en el momento «Probar clave» de OpenRouter, «Enviar
  correo de prueba» y la prueba de cada canal (revalidar WhatsApp con Meta, el acceso a Gmail u Outlook y «Probar
  conexión» de otro buzón), con el resultado en español; los canales de demo nunca llaman a nadie.
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
| `pnpm test` | Pruebas de Vitest (cada archivo con su propia base en memoria; nunca toca `data/pglite` ni Supabase). |
| `pnpm test:e2e` | Pruebas de Playwright: compila la app, la arranca en los puertos 3100 (demo de la peluquería, cargada con `--sector=peluqueria`: las pruebas se escribieron para ella), 3102 (instalación vacía) y 3103 (demo del restaurante, para la agenda por aforo) con sus propias bases (`data/e2e-pglite`, `data/e2e-fresh-pglite` y `data/e2e-restaurante-pglite`) y simula los servicios externos en el 3101. La primera vez: `pnpm exec playwright install chromium`. |
| `pnpm build` / `pnpm start` | Compila la app como en producción y la arranca. En tu ordenador vale con `APP_URL=http://localhost:3000` (avisa de que solo funciona ahí) y el asistente pide el código de instalación (`SETUP_TOKEN`); publicada, `APP_URL` tiene que llevar `https://`. |
| `pnpm db:migrate` | Pone la base de datos al día (migraciones): la integrada, en tu ordenador. Para la de Supabase, con su dirección puesta solo para esa orden, nunca en `.env.local` (`docs/guia-despliegue.md`, apartado 2). |
| `pnpm db:generate` | Genera una migración nueva a partir del esquema (solo para desarrollar). |
| `pnpm seed [--sector=…]` | Carga la demo de un sector en lugar de la que haya: `fisioterapia` (por defecto), `peluqueria`, `clinica-dental`, `restaurante`, `taller`, `academia`, `inmobiliaria`, `tienda` u `otro`. Se niega si la base tiene datos de un negocio real, o si `DEMO_MODE` no es `true` (salvo con `--force-demo`). |
| `pnpm seed:embeddings` | Recalcula los embeddings de la demo de los nueve sectores con el modelo por defecto (`openai/text-embedding-3-small`, 1536 dimensiones) y los guarda en `seed/fixtures/embeddings.json`. Necesita `OPENROUTER_API_KEY` en `.env.local` y gasta céntimos de IA; sin la clave se niega y no cambia nada. No toca la base de datos. |
| `pnpm db:reset [--sector=…]` | Borra todo y deja la demo como recién instalada. Pregunta antes (`--yes` para no preguntar). |
| `pnpm db:fresh` | Borra todo y deja una instalación vacía con el asistente de arranque. Pregunta antes (`--yes`). |
| `pnpm worker` | Ejecuta el trabajo en segundo plano en bucle, para un servidor propio (VPS) con la base en Supabase (la integrada no la pueden abrir dos procesos a la vez), con las mismas comprobaciones de arranque que la app. Con `EMAIL_IMAP_IDLE=true`, además lee al momento los buzones IMAP que tengan «Leer al momento». |

`db:reset` y `db:fresh` borran datos: para antes la app, y nunca los uses con datos reales. Con una base de Supabase
se niegan salvo con `--remote-i-know`. La base integrada (`data/pglite`) solo la abre un programa a la vez: mientras
`pnpm dev` la tiene abierta, `pnpm seed`, `pnpm db:reset`, `pnpm db:fresh` y `pnpm worker` se niegan con un mensaje
que lo explica; para antes `pnpm dev`.

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
| `DATABASE_URL` | Base de datos. Vacía en local: la base integrada, en `data/pglite`. Al publicar, la dirección del «Transaction pooler» de Supabase (puerto 6543), que lleva la contraseña: solo en las variables de Vercel (Sensitive), nunca en `.env.local`. |
| `APP_URL`, `BETTER_AUTH_URL` | Dirección de la app, para los enlaces de los correos y el inicio de sesión. Con `APP_URL` se hacen también la dirección de avisos de WhatsApp (`https://<dominio>/api/webhooks/whatsapp`) y las de vuelta de Google y Microsoft: publicada, tiene que ser el dominio de producción con HTTPS (la versión compilada no arranca con `http://`, salvo `localhost` en tu ordenador). |
| `TRUSTED_PROXY_HOPS` | Opcional: cuántos proxies hay delante de la app (1 por defecto: Vercel o Traefik), para leer bien la IP de cada petición en los límites. |
| `BETTER_AUTH_SECRET` | Firma las sesiones. |
| `APP_ENCRYPTION_KEY` | Cifra las claves que el negocio pone en la app. **Guárdala aparte:** si se pierde, esas claves no se pueden leer. Sin ella la app no arranca. |
| `CRON_SECRET` | Protege la ruta del trabajo en segundo plano (`/api/cron/tick`). |
| `SETUP_TOKEN` | Código de instalación: en una instalación publicada, el primer paso del asistente lo pide para crear el propietario. En local, vacío. |
| `DEMO_MODE` | `true` en local: aviso «Modo demo» y canales de demo que nunca llaman a servicios reales. |
| `OPENROUTER_API_KEY` | Clave de OpenRouter (opcional; mejor en Ajustes › IA). |
| `SUPABASE_URL` y `SUPABASE_SECRET_KEY` | Archivos al publicar, en el bucket privado `dominia-archivos` de Supabase Storage, que la app crea sola: la dirección del proyecto («Project URL») y una clave secreta (`sb_secret_…`, solo en el servidor y marcada Sensitive). Solo en las variables de Vercel, nunca en `.env.local`: en local, vacías, y los archivos van a `data/uploads/`. |
| `FFMPEG_BIN` | Opcional: otro FFmpeg para convertir notas de voz a MP3. Sin ella se usa el que trae el proyecto. |
| `ALLOW_PRIVATE_MAIL_HOSTS` | Opcional: `true` permite conectar un buzón «Otro (IMAP/SMTP)» a un servidor de correo de la red local (uno propio junto a la app). Sin ella, la app solo se conecta a servidores con dirección pública. |
| `EMAIL_IMAP_IDLE` | Opcional, solo en un servidor propio con `pnpm worker`: `true` mantiene abierta la conexión IMAP de los buzones que tengan activado «Leer al momento» y lee el correo nuevo en cuanto llega. Sin ella, cada buzón se lee cada minuto. |
| `ALLOW_LOCAL_HTTP_TOOLS` | Solo para desarrollo y pruebas: `true` deja a las herramientas HTTP llamar a este ordenador o a la red local (con `pnpm dev` ya se permite). La versión compilada no arranca con ella. |
| `OPENROUTER_BASE_URL`, `META_GRAPH_BASE_URL`, `GOOGLE_OAUTH_BASE_URL`, `GOOGLE_API_BASE_URL`, `MS_LOGIN_BASE_URL`, `MS_GRAPH_BASE_URL`, `MISTRAL_BASE_URL`, `TELEGRAM_API_BASE_URL`, `YCLOUD_API_BASE_URL` e `INSTAGRAM_GRAPH_BASE_URL` | Solo para las pruebas, que apuntan a un simulador. No las cambies: la versión compilada no arranca con ellas. |
| `E2E_ALLOW_BASE_URL_OVERRIDES` | Solo la ponen los servidores de Playwright, para arrancar la versión compilada con el simulador. Nunca en una instalación real. |
| `REPLY_DEBOUNCE_MS` | Solo para las pruebas: espera fija antes de que la IA responda (en una instalación real, de 4 a 8 s). |

Los secretos van solo en `.env.local`, que nunca se sube a Git.

## Conectar canales reales

- **Chat web (ya disponible):** en Canales › Añadir canal › Chat web, añade el dominio de tu web (por ejemplo
  `www.tunegocio.es`) en «Dominios permitidos» y pega el código de «Apariencia y código» en tu web. El chat solo
  funciona en esos dominios y en la propia app. Hasta publicar la app, tu web no puede llegar a `localhost`:
  pruébalo en `/widget-demo`.
- **WhatsApp**, de tres formas, a elegir en Canales › Añadir canal (un mismo número, solo por una):
  - **API oficial de Meta** (la recomendada): ver «Conectar WhatsApp real», justo debajo.
  - **YCloud · coexistencia:** la API oficial a través de YCloud, un partner de Meta; el número sigue funcionando en
    la app WhatsApp Business del móvil. Das de alta el número en YCloud, pegas su clave de API y la app hace el resto.
    Paso a paso, en la [guía de WhatsApp con YCloud](docs/guia-whatsapp-ycloud.md).
  - **Código QR · no oficial:** escaneas un código con el móvil, como WhatsApp Web. Lista en un minuto y funciona en
    local, pero va contra las condiciones de WhatsApp (pueden bloquear el número), necesita que la app esté siempre
    encendida y no funciona en Vercel. Lee antes la [guía de WhatsApp por código QR](docs/guia-whatsapp-qr.md).
- **Correo** (Gmail, Outlook e IMAP/SMTP): ver «Conectar el correo real», más abajo.
- **Telegram (ya disponible, también en local):** crea un bot con @BotFather, pega su token en Canales › Añadir canal ›
  Telegram y la app lo configura sola. En tu ordenador funciona en «modo local» (la app pregunta a Telegram por los
  mensajes nuevos cada pocos segundos); al publicarla, «Revalidar» en el panel del canal hace que lleguen al momento.
  Paso a paso, en la [guía de Telegram](docs/guia-telegram.md).
- **Instagram (fase 16, mensajes directos):** con la app de Meta del negocio y el producto Instagram, genera el token de
  tu cuenta profesional en su panel y pégalo, con la clave secreta de Instagram, en Canales › Añadir canal ›
  Instagram. La app comprueba el token, suscribe la cuenta y te da la dirección de avisos y su token de verificación
  para pegarlos en Meta. Necesita la app publicada con HTTPS para recibir mensajes; responde solo con texto y dentro de
  las 24 horas desde el último mensaje del cliente. Paso a paso, en la [guía de Instagram](docs/guia-instagram.md).
- El correo de la propia app (invitaciones y recuperación de contraseña) ya se configura en Ajustes › Correo
  del sistema, con los datos SMTP de tu proveedor.

## Conectar WhatsApp real

Este apartado es el de la API oficial de Meta (Cloud API), la vía recomendada, con la app de Meta del propio negocio y
un token permanente de un usuario del sistema. Las otras dos vías (YCloud con coexistencia y código QR) tienen su
propia guía, enlazada arriba. La guía completa, con capturas y los problemas frecuentes, es
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
[`docs/guia-despliegue.md`](docs/guia-despliegue.md) (también dentro de la app, en Ayuda): Vercel para la app y
Supabase para la base de datos (Postgres), los archivos (un bucket privado de Supabase Storage) y el cron de cada
minuto (Supabase Cron, porque el plan gratuito de Vercel solo admite uno al día), con el código de instalación
(`SETUP_TOKEN`). `vercel.json` ya trae ese cron diario a `/api/cron/tick` y las funciones en Londres (`lhr1`), en la
misma ciudad que la base de Supabase. Los datos técnicos de cada servicio están en `docs/plataforma-despliegue.md`, y
el porqué, en `docs/decisions/0024-datos-y-archivos-en-supabase.md`.

**O en un servidor propio con Dokploy** (por ejemplo, un VPS de Hostinger), con la base y los archivos también en
Supabase: el apartado «Servidor propio con Dokploy (Hostinger)» de esa misma guía. El proyecto trae el `Dockerfile`
(la imagen de la app), `docker-compose.yml` (las tres piezas que corren en el servidor: `migrate`, `web` y `worker`) y
el flujo de GitHub «Imagen para el servidor» (`.github/workflows/imagen.yml`), que en cada subida a `main` construye la
imagen, la prueba con una base de datos de verdad y la publica en `ghcr.io/josemafe7/agentes-whatsapp`. En el
servidor no se compila nada, las migraciones se aplican solas en cada despliegue y no hace falta cron.

Supabase es solo para la app publicada: `DATABASE_URL`, `SUPABASE_URL` y `SUPABASE_SECRET_KEY` van en las variables
de Vercel, nunca en `.env.local`, y tu ordenador sigue con la base integrada. Las migraciones se aplican desde tu
ordenador con la dirección de la base puesta solo para esa orden (o con Claude Code y el conector de Supabase). La
instalación publicada empieza vacía, con el asistente de arranque, o con la demo si la cargas para enseñar la app;
entonces cambia enseguida las contraseñas de prueba, que están en este README, y vacíala con
`pnpm db:fresh --remote-i-know` antes de trabajar con clientes (la guía lo explica, apartado 2).

Con un agente de código, la skill `desplegar` (`.agents/skills/desplegar/`) sigue esa guía, y `actualizar` pasa a una
versión nueva con una copia de seguridad antes.

## Paso a un negocio real

Un negocio real nunca usa `pnpm dev`, que es el modo de desarrollo (más lento y más permisivo: por ejemplo, deja a las
herramientas HTTP llamar a la red local). Un negocio real va publicado, en Vercel con Supabase (ver «Despliegue»): la
instalación publicada empieza vacía y empiezas en el paso 4. Antes, si quieres, pruébalo en tu ordenador con la base
integrada y la versión compilada:

1. Para la app y ejecuta `pnpm db:fresh`: borra la demo y deja la instalación vacía.
2. En `.env.local`, cambia `DEMO_MODE=true` por `DEMO_MODE=false` y pon en `SETUP_TOKEN` un código largo al azar
   (se crea como explica `docs/guia-despliegue.md`, apartado «4. Las variables de entorno»).
3. Arranca la versión compilada con `pnpm build && pnpm start`. Es para probar: en tu ordenador no llegan WhatsApp ni
   correos reales, y `pnpm worker` (el trabajo en segundo plano en bucle) es para un servidor propio con Supabase.
   Para volver a la demo, `DEMO_MODE=true` y `pnpm db:reset`.
4. Abre la app: el asistente de arranque te pide el código de instalación, la cuenta de propietario, el negocio y su
   sector, el horario y la clave de OpenRouter.
5. Guarda `APP_ENCRYPTION_KEY` en un gestor de contraseñas.
6. Sigue la **lista de puesta en marcha** ([`docs/checklist-puesta-en-marcha.md`](docs/checklist-puesta-en-marcha.md),
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
- **«La base de datos está en uso» al usar `db:reset` o `db:fresh`, o «La base local (data/pglite) está abierta en
  otro proceso»:** la base integrada solo la abre un programa a la vez. Para antes el otro `pnpm dev`, `pnpm start`,
  `pnpm worker` o `db:reset` que la esté usando y vuelve a probar.
- **Aviso de que la línea `DATABASE_URL=file:./data/local.db` ya no se usa:** es de una versión anterior, con SQLite.
  Borra esa línea de `.env.local` (o déjala vacía). La demo está ahora en `data/pglite`, y `data/local.db` ya no se usa:
  puedes borrarlo.
- **«Turso ya no se usa»:** tu `DATABASE_URL` es una dirección antigua (`libsql://…`). En tu ordenador, déjala vacía;
  publicada, pon la de Supabase en Vercel (`docs/guia-despliegue.md`).
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
  12 horas y, con clave, se vuelve a pedir sola cada 12 horas).
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
- [Los agentes internos](docs/guia-asistentes-internos.md): un agente para tu equipo con su base de conocimiento
  interna, a quién le das acceso, cómo se usa en «Asistentes», la privacidad de lo que se pregunta y los documentos
  grandes.
- [La agenda](docs/guia-agenda.md): palabras, modo por recurso o por aforo, servicios, recursos, horarios, ausencias
  y bloqueos, el calendario, qué hace el agente con las citas, las citas de prueba y los recordatorios.
- [Envíos](docs/guia-envios.md): novedades y publicidad por WhatsApp, Telegram o correo: el permiso de los clientes,
  importarlos, la plantilla de publicidad, programar un envío, el correo con un servicio de envíos (SPF, DKIM y DMARC),
  las normas y cómo evitar bloqueos.
- [Conectar WhatsApp](docs/guia-whatsapp.md): portfolio, app, token, publicación, método de pago, la prueba con
  el número de prueba de Meta y los problemas frecuentes.
- [Conectar WhatsApp con YCloud](docs/guia-whatsapp-ycloud.md): coexistencia con la app del móvil, el alta del número
  en YCloud, la clave, el modo pruebas, las plantillas y los problemas frecuentes.
- [Conectar WhatsApp por código QR](docs/guia-whatsapp-qr.md): los riesgos de esta vía no oficial, qué necesita,
  vincular, el modo pruebas, qué lee la app y los problemas frecuentes.
- [Conectar el correo](docs/guia-correo.md): Gmail con el proyecto de Google Cloud del negocio, Outlook o Microsoft
  365 con su app de Microsoft Entra u otro buzón por IMAP/SMTP; modos de respuesta, filtros y problemas frecuentes.
- [Conectar Telegram](docs/guia-telegram.md): crear el bot con @BotFather, pegar su token, el modo local, el enlace y
  el código QR para tus clientes y los problemas frecuentes.
- [Conectar Instagram](docs/guia-instagram.md): la cuenta profesional, la app de Meta con el producto Instagram, el
  token y la clave, la dirección de avisos, la prueba desde otra cuenta, la ventana de 24 horas y los problemas
  frecuentes.
- [Publicar la app en Vercel](docs/guia-despliegue.md): con Supabase para la base de datos, los archivos y el cron,
  paso a paso.
- [Lista de puesta en marcha](docs/checklist-puesta-en-marcha.md): de `pnpm db:fresh` a la primera conversación de un
  negocio real.

Para el negocio, fuera de la app: la [plantilla de contrato de encargo del tratamiento](docs/contrato-encargo-tratamiento.md)
(revísala con un abogado).

Skills para un agente de código (en `.agents/skills/`, con su puente en `.claude/skills/`): `nuevo-negocio`,
`conectar-whatsapp`, `conectar-correo`, `crear-agente`, `desplegar`, `actualizar` y `diagnostico`. Las instaladas desde
fuera (`frontend-design`, `supabase` y `supabase-postgres-best-practices`) están anotadas en `skills-lock.json`, con su
origen, y conservan su propio formato.
