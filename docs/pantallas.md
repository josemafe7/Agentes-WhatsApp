# Pantallas

Inventario de pantallas de DominIA Agentes (paso 1 de `docs/design.md`), sacado de la especificación del
2026-09-26. Dice qué pantallas hay, para quién, qué se ve, qué se puede hacer y cómo se va de una a otra. El
aspecto lo manda `DESIGN.md`; lo que hace cada regla, la especificación.

Está al día con `docs/spec.md` (roles, ajustes y reglas del 2026-09-26). Si algo de aquí no coincide con la
especificación, manda la especificación y se avisa para corregir este documento. Las preguntas que la
especificación ya ha resuelto y las que siguen abiertas están al final.

Cómo leer cada ficha:

- **Ruta:** en español y en minúsculas. Los filtros y la vista van en la URL (`?estado=pendiente`), para
  poder compartir y volver atrás.
- **Fase:** la primera fase de la especificación en la que aparece (0 a 10). Algunas partes llegan después y se
  indica.
- **Estados:** los textos que importan. Lo que no se dice sigue las reglas comunes de `DESIGN.md` (esqueleto
  al cargar, aviso con «Reintentar» si falla, pantalla «Sin permiso» si el rol no llega).

## Quién ve qué

Resume «Quién puede hacer qué» de `docs/spec.md`, que es la que manda. ✔ = ve y usa · Ver = solo lectura ·
Suyos = solo lo de sus canales ([PER-02]) · Con acceso = solo los agentes internos que le han dado ([INT-05]) ·
— = no entra.

| Sección | Propietario | Administrador | Supervisor | Agente | Solo lectura |
|---|---|---|---|---|---|
| Bandeja | ✔ | ✔ | ✔ todas | Suyos | Ver |
| Contactos | ✔ | ✔ | ✔ sin exportar ni borrar | Suyos, sin fusionar, exportar ni borrar | Ver |
| Agenda: citas | ✔ | ✔ | ✔ con bloqueos y ausencias | ✔ sin bloqueos ni ausencias | Ver |
| Agenda: servicios, recursos, configuración | ✔ | ✔ | Solo las ausencias de los recursos | — | — |
| Asistentes | ✔ todos | ✔ todos | Con acceso | Con acceso | — |
| Agentes | ✔ | ✔ | Ver y Probar | — | Ver |
| Agentes internos (crear, configurar y dar acceso) | ✔ | ✔ | — | — | — |
| Herramientas HTTP | ✔ | ✔ | — | — | — |
| Conocimiento | ✔ | ✔ | ✔ | — | Ver |
| Bases de conocimiento internas | ✔ | ✔ | — | — | — |
| Canales | ✔ | ✔ | — | — | Ver (estado y panel, sin credenciales) |
| Informes | ✔ | ✔ | ✔ | — | Ver |
| Ajustes: Negocio, Horario, Correo del sistema, WhatsApp, Privacidad, Notificaciones, Diagnóstico, Actividad | ✔ | ✔ | — | — | — |
| Ajustes: IA (claves) | ✔ | ✔ | — | — | — |
| Ajustes: Usuarios | ✔ | ✔ (sin tocar al propietario ni traspasar la propiedad) | — | — | — |
| Mi cuenta, Acerca de, Ayuda | ✔ | ✔ | ✔ | ✔ | ✔ |

Pantallas por rol:

- **Propietario** (ordenador): todas.
- **Administrador** (ordenador): todas; no puede cambiar, desactivar ni borrar al propietario ni traspasar la
  propiedad ([PER-05], [PER-06]).
- **Supervisor** (ordenador): Bandeja y conversación (todas), Contactos, Agenda (citas, bloqueos y ausencias,
  sin configuración), Asistentes (los agentes internos que le han dado), Agentes (ver y Probar, solo los de
  clientes), Conocimiento (solo las bases para clientes), Informes, Mi cuenta, Acerca de y Ayuda. Nada de
  Canales ni del resto de Ajustes ([PER-04]).
- **Agente** (móvil como app instalada y ordenador): Bandeja, conversación y Contactos de sus canales, Agenda
  (citas), Asistentes (los agentes internos que le han dado), Mi cuenta, Acerca de y Ayuda.
- **Solo lectura** (ordenador): Bandeja, Contactos, Agenda (citas), Agentes, Conocimiento, Canales (estado y
  panel, sin credenciales) e Informes, siempre sin botones de acción; Mi cuenta, Acerca de y Ayuda. No ve
  ningún secreto ni el registro de actividad ([PER-03]), ni los agentes internos, sus bases o «Asistentes»
  ([INT-05], [INT-15]).
- **Sin sesión:** inicio de sesión, recuperación, invitación, asistente de arranque (solo en una instalación
  vacía), páginas legales, `/widget-demo` y el chat web en la web del negocio.

## Navegación

- **Menú lateral** (ordenador): Bandeja · Contactos · Agenda · Asistentes | Agentes · Conocimiento · Canales |
  Informes · Ajustes. Solo aparecen las secciones del rol, y «Asistentes» solo a quien tiene algún agente interno
  que usar ([INT-06]). Abajo, menú de usuario: Mi cuenta, Ayuda, Tema (Claro, Oscuro, Sistema), Cerrar sesión. Se
  pliega a iconos.
- **Barra inferior** (móvil y PWA): Bandeja · Agenda · Contactos · Más (el resto de secciones del rol, también
  «Asistentes», Mi cuenta y Ayuda). Se oculta dentro de una conversación.
- **Barra superior:** migas de pan y campana de notificaciones (popover con traspasos pendientes, canales con
  error, citas creadas por la IA; cada una lleva a su pantalla; «Marcar todo como leído»).
- **Entrada:** `/` lleva a `/setup` si no hay propietario, a `/login` sin sesión y, con sesión, a `/bandeja`
  (o a la primera sección que permita el rol). Tras iniciar sesión se vuelve a la página pedida.
- **Recorridos principales:**
  - Aviso «Añade tu clave de OpenRouter» → Ajustes › IA → vuelve a donde estaba.
  - Bandeja → conversación → ficha del contacto → «Nueva cita» → cita creada (visible en Agenda).
  - Conversación → «Ver fuentes» → documento de la base de conocimiento.
  - Agentes → «Nuevo agente» → «Interno» → Conocimiento (una base interna) → Acceso → la persona lo encuentra
    en Asistentes y pregunta.
  - Respuesta de una persona en la conversación → «Convertir en FAQ» → base elegida.
  - Canales → «Añadir canal» → asistente → panel del canal → «Probar» (simulador o `/widget-demo`).
  - Tarjeta de canal «Agente activo» ↔ pestaña Canales del agente («Activo aquí»).
  - Agente › Probar → cita de prueba → «Borrar citas de prueba».
  - Notificación de traspaso (app, push o email) → conversación.
  - Ajustes › Diagnóstico › Simulador → «Ver conversación» en la bandeja.

## Acceso (sin sesión)

### Iniciar sesión · `/login` · fase 0

- **Se ve:** logo y nombre del negocio; email y contraseña; «¿Has olvidado tu contraseña?». En modo demo, la
  franja «Modo demo».
- **Acciones:** entrar (si el usuario tiene 2FA, pasa a `/dos-pasos`).
- **Áreas:** Roles y acceso, Seguridad (límite de intentos), Demo.
- **Estados:** error genérico «Email o contraseña incorrectos»; límite: «Demasiados intentos. Espera unos
  minutos.»; sin invitación no hay registro público (no hay enlace «Crear cuenta»).

### Verificación en dos pasos · `/dos-pasos` · fase 0

- **Se ve:** campo de 6 dígitos del autenticador y la opción de usar un código de recuperación.
- **Acciones:** verificar; volver al inicio de sesión.
- **Áreas:** Seguridad (2FA TOTP).
- **Estados:** código incorrecto; demasiados intentos.

### Recuperar y restablecer contraseña · `/recuperar`, `/restablecer` · fase 0

- **Se ve:** email para pedir el enlace; después, nueva contraseña y confirmación.
- **Acciones:** enviar enlace; guardar contraseña.
- **Áreas:** Roles y acceso, Correo del sistema (SMTP).
- **Estados:** siempre «Si el email existe, te hemos enviado un enlace» (no revela usuarios); enlace
  caducado con «Pedir otro».

### Aceptar invitación · `/invitacion/[token]` · fase 0

- **Se ve:** nombre del negocio, rol al que se invita, nombre y contraseña.
- **Acciones:** crear la cuenta; si está activado exigir 2FA y el rol es propietario o administrador, pasa a
  activarla ([USU-12]).
- **Áreas:** Roles (alta solo por invitación).
- **Estados:** invitación caducada o ya usada: «Esta invitación ya no es válida. Pide una nueva al
  propietario.»

## Arranque

### Asistente de arranque · `/setup` (el paso va en `?paso=1…7`) · fase 0

Solo mientras no hay propietario o el arranque no está terminado; después redirige a `/login`. Sin menú
lateral: logo, stepper y una columna.

1. **Propietario:** nombre, email, contraseña y, en una instalación publicada, el código de instalación
   (`SETUP_TOKEN`, [ASI-02]).
2. **Negocio y sector:** nombre y sector en tarjetas (Peluquería/Estética, Clínica dental,
   Clínica/Fisioterapia, Restaurante, Taller, Academia/Clases, Inmobiliaria, Tienda, Otro), color y logo.
   Explica que el sector carga datos editables (terminología, servicios, recursos, modo de agenda, plantilla
   de agente y preguntas frecuentes).
3. **Horario, festivos y zona horaria:** tramos por día, cierres y zona horaria (Europe/Madrid por defecto,
   [ASI-06]).
4. **IA** (fase 1): clave de OpenRouter con «Probar clave» y modelo de chat, comprobado contra la lista de
   OpenRouter como el de un agente ([MOD-02], [MOD-05]); «Hacerlo más tarde» deja el aviso.
5. **Primer agente** (fase 1): plantilla del sector u «Generar desde la web del negocio», con las instrucciones
   y las preguntas frecuentes propuestas editables ([ASI-08]).
6. **Chat web de prueba** (fase 2): crea el canal y deja probarlo ahí mismo.
7. **Conectar canales:** una tarjeta para WhatsApp y otra para el correo, cada una con «Conectar WhatsApp» o
   «Conectar el correo» (terminan el asistente y abren su asistente de Canales) y «Ver la guía» (su guía de Ayuda);
   «Ir a la bandeja» termina y lleva a la bandeja ([ASI-10]).

- **Áreas:** Asistente de arranque, Datos por sector, Modelos.
- **Estados:** clave no válida con el motivo en español; web que no se puede leer al generar el agente
  («Escribe una descripción del negocio»).

## Bandeja

### Bandeja · `/bandeja` · fase 2

- **Quién:** propietario, administrador, supervisor, agente (sus canales) y solo lectura (sin acciones).
- **Se ve:** lista de conversaciones de todos los canales permitidos con canal, contacto, último mensaje,
  hora, no leídos, estado, modo (IA, Persona, IA en pausa), asignado y etiquetas. En ordenador, a la derecha,
  la conversación elegida (o «Elige una conversación»).
- **Acciones:** buscar por contacto o por el texto de los mensajes, sin distinguir tildes ni mayúsculas; filtrar por
  canal, estado, asignado, IA o persona, sin leer y etiquetas; pestañas rápidas «Pendientes de humano», «Mías»,
  «Todas»; abrir una conversación.
- **Áreas:** Bandeja (lista, filtros, tiempo real, no leídos), Traspaso, Roles.
- **Estados:** vacío sin canales: «Todavía no hay conversaciones · Cuando un cliente escriba por WhatsApp,
  correo o el chat web, aparecerá aquí» con «Conectar un canal» (quien pueda) y «Probar con el simulador»;
  vacío por filtros; sin conexión: «Sin conexión. Reintentando…» sin perder la lista.

### Conversación · `/bandeja/[id]` · fase 2

- **Se ve:** cabecera (contacto, canal, estado, asignado, interruptor de IA con motivo, «IA en pausa hasta…»);
  mensajes con su autor (cliente, IA con el nombre del agente, persona, sistema), estados de entrega, audios
  con transcripción, imágenes y documentos, notas internas; en ordenador, la ficha del contacto a la derecha.
  - WhatsApp (fase 3): ventana de 24 h («Ventana abierta hasta … · quedan …») y, si está cerrada, solo plantillas
    aprobadas con «Elegir plantilla»: diálogo con idioma y categoría, un campo por variable y vista previa; bajo
    cada mensaje enviado, su coste estimado («≈ 0,02 US$ estimado · Utilidad», «Gratis · Servicio» o «Sin estimar»).
  - Correo (fase 6): hilo con asunto y borradores para aprobar. Un correo cuyo remitente no verificó el servidor que
    lo recibió lleva «Remitente no verificado», y uno que pedía las respuestas en otra dirección (Reply-To) lo dice:
    se responde solo a quien lo envió ([COR-25]).
  - Bajas (fase 7): si el cliente se ha dado de baja en ese canal, sobre el cuadro de escribir: «Este cliente se ha
    dado de baja en este canal: la IA, los recordatorios y las plantillas están parados.»; una persona puede seguir
    escribiéndole ([CUM-04]).
  - Fuentes de la IA (fase 4): «Ver fuentes» / «¿Por qué respondió esto?».
  - Conservación (fase 7): un archivo que la limpieza diaria ya borró dice «El archivo se borró por la política de
    conservación»; una nota de voz dice «El audio se borró por la política de conservación» y sigue enseñando su
    transcripción.
- **Acciones:** responder (pausa la IA 12 h por defecto), nota interna, adjuntar, enviar plantilla,
  aprobar/editar/descartar borrador, reintentar un envío fallido, cambiar estado (abierta, pendiente de
  humano, resuelta), asignar, pausar o reactivar la IA, traspasar a mano, etiquetas, cambiar el agente de
  esta conversación (opcional), «Convertir en FAQ» (fase 4), «Nueva cita» (fase 5), abrir el contacto. El
  agente no asigna a otros (solo toma para sí una sin asignar de sus canales), no cambia el agente de IA ni
  convierte en FAQ.
- **Áreas:** Bandeja (conversación), IA por conversación, Traspaso, WhatsApp (ventana, plantillas), Correo
  (borradores, humano en el hilo), Conocimiento (trazabilidad), Agenda, Cumplimiento (bajas visibles como
  mensaje de sistema).
- **Estados:** conversación que no existe o de un canal no permitido: «Sin permiso» (no se dice si existe);
  envío fallido en la burbuja con el error en español; solo lectura: sin compositor.

## Contactos

### Contactos · `/contactos` · fase 2 (exportar, borrar y fusionar en fase 7)

- **Se ve:** tabla con nombre, identidades (iconos de canal), teléfono o email, etiquetas, última
  conversación y próxima cita.
- **Acciones:** buscar, filtrar por canal y etiqueta, abrir ficha, crear un contacto a mano; seleccionar para
  fusionar duplicados (elegir dos y qué datos se quedan; propietario, administrador y supervisor) o para
  exportar (CSV) y borrar (propietario y administrador; se confirma escribiendo cuántos contactos son). «Posibles
  duplicados» y «Exportar» toda la lista con la búsqueda y los filtros. El agente solo ve los contactos de sus
  canales.
- **Áreas:** Contactos, Cumplimiento (exportar y borrar).
- **Estados:** vacío: «Aún no hay contactos · Se crean solos cuando alguien escribe por un canal».

### Ficha del contacto · `/contactos/[id]` (y panel lateral en la conversación) · fase 2

- **Se ve:** datos, identidades por canal (nunca el teléfono como clave), etiquetas, campos personalizados,
  consentimientos y bajas por canal, citas (fase 5) e historial de conversaciones.
- **Acciones:** editar datos y etiquetas; «Nueva cita»; abrir una conversación; exportar sus datos y borrarlos
  (fase 7, con confirmación escribiendo el nombre).
- **Áreas:** Contactos, Agenda, Cumplimiento.

## Agenda

### Agenda · `/agenda?vista=dia|semana|mes|recursos&fecha=…` · fase 5

- **Se ve:** calendario en vista de día, semana, mes o por recurso (columnas); horario, festivos, ausencias y
  huecos bloqueados; citas con su estado y origen; en aforo, ocupación por franja. La terminología del sector
  (Cita/Reserva, Profesional/Mesa/Sala/Box, Cliente/Paciente/Comensal).
- **Acciones:** nueva cita (servicio, recurso o cualquiera, inicio, personas, contacto, notas) con huecos
  libres calculados; mover y cambiar duración arrastrando (o desde la ficha); bloquear huecos; filtrar por
  recurso, servicio, estado, origen y citas de prueba; mostrar canceladas; «Citas de prueba (N)» con su lista y
  «Borrar todas»; menú «⋯» a la configuración (el supervisor, a las ausencias). `/agenda?nueva=1&contacto=<id>` o
  `&conversacion=<id>` abre «Nueva cita» ya rellena.
- **Áreas:** Agenda (pantalla, motor de disponibilidad, sin dobles reservas, modos por recurso y por aforo).
- **Estados:** sin servicios o recursos: «Configura la agenda · Añade al menos un servicio y un recurso» con
  enlace (quien pueda); hueco ocupado al guardar: «Ese hueco ya no está libre» y huecos alternativos.

### Ficha de la cita · panel lateral en `/agenda?cita=[id]` · fase 5

- **Se ve:** estado, servicio, recurso, inicio y fin, personas, contacto, conversación, origen (IA con canal,
  persona o web), notas, autor e historial.
- **Acciones:** confirmar, cambiar, cancelar (con motivo), marcar completada o no presentado, volver a confirmar una
  cancelada, con «Avisar al cliente por su conversación» al confirmar, cambiar o cancelar; ir al contacto o a la
  conversación. Una cita de prueba lo dice y se borra con las demás de prueba («Citas de prueba» o Probar), no sola.
- **Áreas:** Agenda (citas), Bandeja.

### Servicios · `/agenda/configuracion/servicios` · fase 5

- **Se ve:** tabla de servicios con categoría, duración, márgenes, precio orientativo, recursos, personas y
  «requiere confirmación manual».
- **Acciones:** crear, editar (panel lateral), desactivar.
- **Áreas:** Agenda (servicios), Datos por sector.

### Recursos · `/agenda/configuracion/recursos`, `/agenda/configuracion/recursos/nuevo` y `/agenda/configuracion/recursos/[id]` · fase 5

- **Se ve:** lista de recursos con tipo (persona, sala o box, mesa o zona, equipo), color, capacidad y
  servicios; en su ficha, horario semanal con varios tramos por día y ausencias.
- **Acciones:** crear, editar, activar/desactivar, añadir ausencias. El supervisor solo añade y quita
  ausencias; el resto es de propietario y administrador.
- **Áreas:** Agenda (recursos, horarios, ausencias).

### Configuración de la agenda · `/agenda/configuracion` · fase 5

Pestañas General, Servicios y Recursos (el supervisor solo ve Recursos, para las ausencias).

- **Se ve:** modo (por recurso individual o por aforo; la duración de mesa y el tamaño de grupo van en cada
  servicio), intervalo de huecos y terminología; enlaces a Ajustes › Horario (horario y festivos) y a Ajustes ›
  Recordatorios con el resumen de cómo están. La antelación es de cada servicio.
- **Acciones:** guardar.
- **Áreas:** Agenda (modos, palabras).

### Recordatorios · `/ajustes/recordatorios` · fase 5

- **Se ve:** interruptor (desactivado por defecto), cuándo (de 30 minutos a 1 semana antes) y por dónde: WhatsApp
  (número, plantilla de utilidad aprobada y la variable de cada dato de la cita, con el aviso de que se cobra) o
  email (asunto y texto con `{nombre}`, `{servicio}`, `{fecha}`, `{hora}`, `{recurso}`, `{personas}` y `{negocio}`).
- **Acciones:** guardar (programa o quita el trabajo de los recordatorios).
- **Áreas:** Agenda (avisos), WhatsApp (plantillas).

## Asistentes

Los agentes internos, vistos por quien los usa (fase 10). Cómo se crean y a quién se dan: «Editor del agente».

### Asistentes · `/asistentes` · fase 10

- **Quién:** propietario y administrador (todos los agentes internos), supervisor y agente (los que les han dado).
  Solo lectura no entra.
- **Se ve:** una tarjeta por agente interno que la persona puede usar, con su avatar, nombre y descripción.
- **Acciones:** abrir uno para preguntarle.
- **Áreas:** Agentes internos.
- **Estados:** vacío para quien los crea: «Crea tu primer agente interno» con «Nuevo agente»; para el resto:
  «Todavía no tienes asistentes · Cuando un administrador te dé acceso a un agente interno, aparecerá aquí».

### Conversación con un asistente · `/asistentes/[id]` (la conversación abierta va en `?c=…`) · fase 10

- **Se ve:** a un lado, «Tus conversaciones» con ese agente (las de esa persona, nunca las de otra) y «Nueva
  conversación»; al otro, el chat: las preguntas a la izquierda («Tú») y las respuestas a la derecha («IA ·
  nombre del agente»), cada una con «Ver la fuente» (documento, sección, página y base). Debajo de la lista, la
  nota «Solo tú ves tus conversaciones».
- **Acciones:** preguntar (Intro envía), seguir una conversación anterior, empezar otra, borrar una (con
  confirmación), «Reintentar» si la IA ha fallado, «Cargar más» (cuando hay más de 50 conversaciones) y «Cargar
  mensajes anteriores» (cuando la abierta pasa de 200 mensajes).
- **Áreas:** Agentes internos, Conocimiento (búsqueda), Reglas de la plataforma.
- **Estados:** sin clave de OpenRouter: aviso y no se puede enviar ([INT-11]); demasiadas preguntas seguidas o
  tope del día: el mensaje lo dice y la pregunta no se envía ([INT-12]); un agente que no le han dado, o la
  conversación de otra persona, por su dirección: «Esta página no existe».

## Agentes

### Agentes · `/agentes` · fase 1

- **Se ve:** tarjetas de agentes con avatar, descripción, modelo y «Activo en:» sus canales. Con agentes internos
  (fase 10), dos grupos: «Para clientes» e «Internos», estos con «Responde al equipo en «Asistentes»» en lugar de
  los canales. Los internos solo los ven propietario y administrador.
- **Acciones:** «Nuevo agente», «Herramientas HTTP» (propietario y administrador, fase 7), abrir, borrar (la
  confirmación avisa si está activo en algún canal; la de un agente interno, de que se borran las conversaciones
  del equipo con él).
- **Áreas:** Agentes, Asignación a canales, Agentes internos.
- **Estados:** vacío: «Crea tu primer agente · Empieza desde la plantilla de tu sector».

### Nuevo agente · `/agentes/nuevo` · fase 1

- **Se ve:** «¿Para quién es?» («Para clientes» o «Interno, para tu equipo»; no se cambia después; fase 10). Para
  clientes: plantillas por sector, «En blanco» y «Generar desde la web del negocio o una descripción». Interno:
  solo el nombre (se crea en blanco).
- **Acciones:** elegir y crear (lleva al editor).
- **Áreas:** Agentes (plantillas), Instrucciones guiadas, Agentes internos.

### Editor del agente · `/agentes/[id]` y pestañas · fase 1

Pestañas con ruta propia y barra «Cambios sin guardar»:

- **General** (`/agentes/[id]`): nombre, descripción, avatar, idioma y tono.
- **Instrucciones** (`/instrucciones`): rol, información del negocio, qué puede y qué no, estilo, cuándo
  pasar a una persona; «Generar borrador con IA»; «Vista previa del prompt» (con las reglas de la plataforma
  delante, que no se pueden quitar).
- **Modelo** (`/modelo`): selector con buscador (nombre, proveedor, precio de entrada y salida por millón en
  US$, contexto, iconos de imagen, PDF y audio), recomendados, respaldo de otro proveedor, temperatura,
  razonamiento y longitud; «Actualizar lista»; aviso si el modelo va a caducar.
- **Conocimiento** (`/conocimiento`, fase 4): archivos de contexto con su tamaño en tokens (tope 30.000 y
  aviso de coste), bases elegidas y modo «Automático» o «Buscar siempre».
- **Herramientas** (`/herramientas`): traspaso (fase 1–2), conocimiento (fase 4), agenda (fase 5) y
  herramientas HTTP (fase 7), cada una con interruptor.
- **Traspaso** (`/traspaso`): palabras clave, número de «no lo sé», temas sensibles, mensajes dentro y fuera de
  horario y a quién avisar.
- **Canales** (`/canales`): canales con «Activo aquí»; si sustituye a otro agente, confirmación que lo dice.
- **Probar** (`/probar`): chat sin canales reales con «Simular canal» (WhatsApp, correo, web); al lado,
  herramientas usadas, fragmentos con puntuación y fuente, tokens, coste y latencia; «Empezar de nuevo» (borra
  la conversación de prueba) y «Borrar citas de prueba». El supervisor entra aquí aunque el resto del editor
  lo vea en solo lectura.
- **Versiones** (`/versiones`): lista con fecha y autor; ver y restaurar.
- **Agente interno** (fase 10): lleva la insignia «Interno» y sus pestañas son General, Instrucciones (sin
  «Cuándo pasar a una persona» ni «Generar borrador con IA»), Modelo, Conocimiento (puede usar bases internas y
  de clientes), **Acceso**, Probar (sin «Simular canal» ni citas de prueba) y Versiones. No tiene Herramientas,
  Traspaso ni Canales: esas direcciones no existen para él.
- **Acceso** (`/acceso`, solo agentes internos): «Todo el equipo» o «Personas concretas» (supervisores y agentes
  activos, uno a uno); «Guardar acceso». Propietario y administradores pueden usarlo siempre.
- **Áreas:** Agentes (editor), Modelos, Motor de respuesta, Reglas de la plataforma, Conocimiento,
  Herramientas, Traspaso, Agentes internos.
- **Estados:** sin clave de OpenRouter: el selector de modelos y «Probar» explican que hace falta la clave y
  enlazan a Ajustes › IA; modelo no válido al guardar, con el motivo.

### Herramientas HTTP · `/agentes/herramientas`, `/agentes/herramientas/nueva`, `/agentes/herramientas/[id]` · fase 7

- **Quién:** propietario y administrador. Se llega desde «Herramientas HTTP» en Agentes y desde la pestaña
  Herramientas de cada agente.
- **Se ve:** lista de herramientas personalizadas y en qué agentes están; formulario con nombre, descripción,
  parámetros, método, URL (solo `https://` a direcciones públicas, con `{variables}`), cabeceras secretas
  (enmascaradas) y tiempo máximo.
- **Acciones:** crear, probar con valores de ejemplo, editar, borrar; cada agente las enciende o apaga en su pestaña
  Herramientas.
- **Áreas:** Herramientas HTTP personalizadas, Seguridad (secretos).

## Conocimiento

### Bases de conocimiento · `/conocimiento` · fase 4

- **Se ve:** bases con número de documentos y fragmentos, estado (lista, indexando, con errores), modelo de
  embeddings, agentes que la usan y última actualización. Las internas (fase 10) llevan la insignia «Interna» y
  solo las ven propietario y administrador.
- **Acciones:** «Nueva base» (diálogo con nombre y descripción; propietario y administrador eligen además su
  «Uso»: «Para clientes» o «Interna», que no se cambia después), abrir.
- **Áreas:** Conocimiento (nivel 2).
- **Estados:** vacío: «Crea una base de conocimiento · Sube documentos, webs o preguntas frecuentes para que tus
  agentes respondan con datos del negocio»; sin clave: aviso «Sin clave, la búsqueda va solo por texto».

### Base de conocimiento · `/conocimiento/[id]` y pestañas · fase 4

- **Documentos** (`/conocimiento/[id]`): tabla con tipo, título, estado de ingesta (en cola → extrayendo →
  troceando → embeddings → listo o error), páginas, fragmentos y fecha; «Añadir contenido» (archivos PDF,
  DOCX, XLSX, CSV, TXT o MD; URL con sitemap opcional; pregunta frecuente); borrar; refrescar URLs.
- **Preguntas frecuentes** (`/faq`): lista editable de pregunta y respuesta.
- **Probar búsqueda** (`/probar`): consulta sin LLM con los resultados numerados, puntuación, título, sección y
  página; «Nada relevante» cuando no hay resultados.
- **Ajustes** (`/ajustes`): nombre, modelo de embeddings (1536 dimensiones), reindexar, borrar base (escribiendo
  el nombre).
- **Áreas:** Conocimiento (ingesta, búsqueda híbrida, mantenimiento).
- **Estados:** documento con error y el motivo en español; PDF escaneado sin clave de Mistral OCR: aviso con
  enlace a Ajustes › IA; duplicado detectado: «Este archivo ya está en la base».

### Documento · `/conocimiento/[id]/documentos/[docId]` · fase 4

- **Se ve:** estado, origen (archivo o URL con fecha), resumen, fragmentos con su sección y página.
- **Acciones:** cambiar título (archivo, URL o texto; sus fragmentos se vuelven a procesar con él), refrescar
  (URL), borrar (borra fragmentos y archivo).
- **Áreas:** Conocimiento (troceado, trazabilidad).

## Canales

### Canales · `/canales` · fase 2

- **Se ve:** tarjetas por canal (WhatsApp, correo, chat web y Telegram) con estado, número, correo, dominio o
  usuario del bot, agente activo e interruptor de IA, modo pruebas, «Demo» y último mensaje. Un número de WhatsApp
  dice además por qué vía está conectado: «WhatsApp · API de Meta», «· YCloud» o «· Código QR» ([WA-54]).
- **Acciones:** «Añadir canal»; cambiar agente activo o IA desde la tarjeta; abrir panel; «Continuar
  configuración» si está a medias.
- **Áreas:** Canales (común), Asignación a canales, Demo.
- **Estados:** vacío: «Conecta tu primer canal · WhatsApp, correo, chat web o Telegram».

### Añadir canal · `/canales/nuevo` · fases 2 y 9

- **Se ve:** primero «WhatsApp», con sus tres formas de conectar una al lado de otra ([WA-53]): «API oficial de
  Meta» (insignia «Recomendada»), «YCloud · coexistencia» y «Código QR · no oficial» (insignia «No oficial»). Cada
  tarjeta lleva el logotipo de WhatsApp, una frase y cuatro puntos, a favor o a tener en cuenta, que las
  distinguen. Debajo, «Comparar las tres formas» despliega una tabla (si es oficial, qué pasa con el móvil, qué
  hace falta, coste, plantillas, riesgo de bloqueo y dónde funciona). Después, «Otros canales»: Chat web, Correo y
  Telegram.
- **Acciones:** elegir y abrir su asistente.

### Asistente de WhatsApp · `/canales/nuevo/whatsapp` · fase 3

Cada campo con «¿Dónde lo encuentro?»: un texto corto con dónde está el dato y «Ver la guía», que abre su
apartado en Ayuda ([AJU-17]).

0. **Aviso** con casilla obligatoria (el número deja la app del móvil; opción «número de prueba de Meta»).
1. **Datos:** nombre, token permanente, App Secret, Phone Number ID; avanzado: PIN y versión de Graph API.
   «Validar con Meta» → «Negocio · Número · Estado», o el error de Meta en español.
2. **Webhook:** intento automático; si la app de Meta ya tiene otra dirección de avisos, diálogo que avisa de
   que la sustituiría para toda la app y pide confirmación (sin confirmar, camino manual); si falla, URL y
   token para copiar con los pasos y aviso en vivo al verificarse; comprobación de `subscribed_apps`.
3. **Activar:** registro con un PIN de 6 cifras (el que tenía o uno nuevo; si Meta dice que no es correcto,
   «Cambiar el PIN»), con confirmación y los intentos que quedan; verificación por SMS o voz si hace falta;
   lista «App publicada (Live)», con los enlaces a las páginas legales, y «Método de pago», que no deja
   terminar hasta confirmarlo a mano (enlace al Centro de facturación de Meta); sincronizar plantillas.
4. **Prueba:** «Escribe "hola" a {número}», aparece al llegar, «Enviar respuesta de prueba»; a los 2 minutos,
   diagnóstico guiado.
5. **Agente:** agente activo, IA encendida o apagada, modo pruebas «solo a estos números» (activado).

- **Áreas:** WhatsApp (asistente, límites de Meta), Cumplimiento (páginas legales).
- **Estados:** errores 190, 200, 100, 133016, 131042, 131047, 131026, 368… explicados con qué hacer.

### Asistente de correo · `/canales/nuevo/correo` · fase 6

- **Se ve:** desplegable Gmail, Outlook / Microsoft 365 u Otro (IMAP/SMTP).
  - Gmail: URI de redirección para copiar, Client ID, Client Secret, avisos («Nunca en Testing»), «Conectar con
    Google», permisos concedidos; enlace «¿Prefieres contraseña de aplicación? Usa Otro».
  - Outlook: Client ID, Client Secret y su fecha de caducidad (24 meses como máximo), Tenant ID, URI de
    redirección, «Conectar con Microsoft» y enlace de consentimiento del administrador si hace falta.
  - Cada campo con «¿Dónde lo encuentro?» y «Ver la guía» ([AJU-17]).
  - Otro: email, usuario, contraseña, IMAP y SMTP autocompletados por dominio, «Probar conexión».
  - Común: modo de respuesta («Borrador para revisar» por defecto o «Automático»), agente, IA, firma con aviso
    de IA, tope diario.
- **Áreas:** Correo, Seguridad.
- **Estados:** permisos insuficientes con los que faltan; conexión fallida con el motivo en español.

### Asistente de chat web · `/canales/nuevo/web` · fase 2

- **Se ve:** nombre, color, logo, bienvenida, posición, textos legales, dominios permitidos, voz e imágenes
  (opcionales) y, al lado, la vista previa del widget en vivo; al final, el código para pegar y «Abrir en
  /widget-demo».
- **Áreas:** Chat web, Cumplimiento (aviso de IA).

### Asistente de WhatsApp · YCloud · `/canales/nuevo/whatsapp-ycloud` · fase 9

1. **Conectar:** clave de API de YCloud (campo secreto) y «Comprobar clave»; al lado, «Antes de empezar, en
   YCloud», con los pasos para dar de alta el número con coexistencia, recargar saldo y copiar la clave, y el enlace
   a su consola. Con la clave aceptada: el saldo, los números de la cuenta para elegir uno (con nombre, estado y
   calidad; uno que ya está en otro canal no se puede elegir), nombre del canal, agente activo e IA. Sin dirección
   pública, aviso «Estás en local: podrás comprobar la clave, pero no llegarán mensajes». «Conectar número».
2. **Probar:** «+34… está conectado», el aviso de que empieza en modo pruebas, y «Esperando un mensaje…», que lo
   enseña al llegar. Sin dirección pública, lo que falta para recibir.

- Un número desconectado vuelve por aquí (`?canal=…`), conservando su canal y sus conversaciones.
- **Áreas:** WhatsApp con YCloud.
- **Estados:** clave rechazada, junto al campo y en español; cuenta sin números; número ya conectado en otro canal.

### Asistente de WhatsApp · Código QR · `/canales/nuevo/whatsapp-qr` · fase 9

1. **Aviso:** «Esta forma de conectar no es oficial», con sus cuatro riesgos y el enlace a la guía; nombre del
   canal, agente activo, IA y la casilla «He leído el aviso y acepto el riesgo…». Sin marcarla, «Generar código
   QR» está apagado. Donde no puede funcionar (Vercel), lo dice arriba y no deja seguir ([QR-02]).
2. **Vincular:** el código QR, que se renueva solo, y los tres pasos para escanearlo desde WhatsApp ›
   Dispositivos vinculados. Si caduca, «No se ha vinculado» y «Generar otro código». «Dejarlo para luego».
3. **Listo:** «+34… está vinculado», el aviso de que empieza en modo pruebas y los enlaces a la configuración y al
   panel.

- Un número cuya sesión se cerró se vuelve a vincular por aquí (`?canal=…`), con el mismo número.
- **Áreas:** WhatsApp por código QR.
- **Estados:** código caducado; escaneado con otro número, o con uno que ya está en otro canal.

### Asistente de Telegram · `/canales/nuevo/telegram` · fase 9

1. **Conectar:** token del bot (campo secreto, con «¿Dónde lo encuentro?»), nombre del canal, agente activo e IA; al
   lado, «¿Aún no tienes el bot?», con los tres pasos en @BotFather y un código QR y un enlace que lo abren. Sin
   dirección pública, aviso «Estás en local: funcionará en modo local». «Conectar bot» comprueba el token y lo
   configura todo; si el bot ya enviaba sus avisos a otra dirección, diálogo «¿Traer @bot a esta instalación?».
2. **Probar:** «@bot está conectado», el enlace `https://t.me/…` con «Copiar» y su código QR, y «Esperando tu
   "hola"…», que enseña el mensaje al llegar y dice si un agente lo va a contestar.

- Un bot desconectado vuelve por aquí (`?canal=…`), conservando su canal y sus conversaciones.
- **Áreas:** Telegram.
- **Estados:** token rechazado, junto al campo y en español; bot ya conectado en otro canal; Telegram no acepta la
  dirección de avisos (el bot queda guardado y se reintenta con «Revalidar»).

### Panel del canal · `/canales/[id]` y pestañas · fases 2, 3, 6 y 9

- **Resumen** (`/canales/[id]`): semáforos (WhatsApp: token, registro, suscripción, webhook, último mensaje,
  calidad, nombre, límite y versión; correo: conexión, permisos, última lectura y, en Outlook, caducidad del
  secreto; web: último mensaje; Telegram: token, recepción y último mensaje), errores en español, agente activo e
  IA, modo pruebas y su lista, límites de
  Meta (el de mensajes, del portfolio y compartido con sus otros números), aviso «Puede que falte el método de
  pago en Meta» si toca ([WA-51]) y recordatorio de volver a registrar tras un cambio de nombre ([WA-20]). En
  WhatsApp (fase 3) el panel del número va aquí mismo: además, credenciales enmascaradas (propietario y
  administrador), versión de la API, «Envíos y comprobaciones» (traspasar si un envío falla, app publicada y
  método de pago), la lista de plantillas con «Sincronizar», el historial de avisos de Meta y, si el número se dejó
  a medias o se desconectó, «Continuar configuración» o «Volver a conectar», que abren su asistente. En Telegram
  (fase 9): nombre y usuario del bot, token enmascarado (propietario y administrador), aviso «Modo local» si toca,
  «Enlace para tus clientes» con su código QR y, si el bot se desconectó, «Volver a conectar este bot». Un número
  de WhatsApp enseña el panel de su vía ([WA-54]). Con YCloud (fase 9): «WhatsApp · YCloud (coexistencia)», número
  y nombre, clave enmascarada, semáforos (clave, número, avisos, saldo y último mensaje), calidad, límite,
  plantillas sincronizadas y su dirección de avisos; «Todavía no recibe mensajes» sin dirección pública. Por código
  QR (fase 9): «WhatsApp · Código QR (no oficial)», número y nombre de la cuenta, cuándo se vinculó, semáforos
  (sesión de WhatsApp, app encendida y último mensaje), el aviso fijo «Esta vía no es la API oficial de WhatsApp» y,
  si la sesión se cerró o nunca se escaneó, «Volver a vincular».
- **Configuración** (`/configuracion`): modo de respuesta, aviso de IA del primer mensaje, comportamiento fuera
  de horario y lo propio de cada tipo.
- **Plantillas** (WhatsApp): lista con estado, categoría, idioma, variables y motivo de rechazo; «Sincronizar». En
  la fase 3 está en el Resumen, no en una pestaña propia.
- **Apariencia y código** (`/apariencia`, chat web): lo del asistente de chat web.
- **Acciones de las otras vías de WhatsApp:** con YCloud, Revalidar, Cambiar clave, Sincronizar plantillas y
  Desconectar; por código QR, Reconectar (si la sesión sigue vinculada pero la conexión está cerrada), Volver a
  vincular y Desconectar.
- **Acciones:** Revalidar, Cambiar token, «Volver a registrar» (WhatsApp, tras un cambio de nombre), Pausar
  IA, Desconectar (confirmación escribiendo el nombre; en WhatsApp borra credenciales y, si se confirma, da de
  baja la suscripción y el registro; un número desconectado no se «Activa»: se vuelve a conectar con su
  asistente); «Reconectar» si el correo requiere reconexión.
- **Áreas:** Canales, WhatsApp (panel, revisión cada 6 h), Correo, Chat web, Telegram (panel, revisión cada 6 h).

## Informes

### Informes · `/informes` · fase 7

- **Quién:** propietario, administrador, supervisor y solo lectura (el rol Agente no entra).
- **Se ve:** periodo (el mes actual por defecto, otro mes o unas fechas, como mucho un año) y canal; indicadores:
  conversaciones, % resuelto por la IA, traspasos, tiempo hasta la primera respuesta humana tras un traspaso
  (mediana y percentil 90) y % en menos de 3 min ([INF-05]), citas creadas por la IA, coste de IA (con lo que de él
  gastaron los agentes internos y cuántas preguntas respondieron, [INT-16]) y coste estimado
  de WhatsApp (US$, con los mensajes sin tarifa aparte); gráficos por canal, de los motivos de traspaso, de los
  tiempos de respuesta por día o por mes y de los costes de los últimos meses, cada uno con su tabla. Cómo se cuenta
  cada cifra: `docs/decisions/0023-como-se-cuentan-los-informes.md`.
- **Acciones:** cambiar el periodo y el canal (van en la dirección); «Descargar CSV» de cada tabla (queda en el
  registro de actividad).
- **Áreas:** Informes, Cumplimiento (medición de la primera respuesta).
- **Estados:** sin datos del periodo: «Todavía no hay datos de este periodo».

## Ajustes

`/ajustes` lleva a la primera página que permita el rol. Subnavegación a la izquierda.

| Página | Ruta | Fase | Qué se ve y se hace | Áreas |
|---|---|---|---|---|
| Mi cuenta | `/perfil` | 0 (push en 7) | Nombre, email, contraseña, activar o quitar 2FA (QR, código y códigos de recuperación), tema, qué avisos recibo y por dónde (en la app, push en este dispositivo, email), «Instalar la app» y cerrar sesión, que apaga antes el push de este dispositivo ([USU-18], [PWA-03]) | Seguridad, PWA |
| Negocio | `/ajustes/negocio` | 0 | Nombre, sector, logo, color principal con vista previa y resultado de contraste, zona horaria, datos de contacto | Ajustes, Marca |
| Usuarios | `/ajustes/usuarios` | 0 | Tabla (nombre, email, rol, canales del agente, 2FA, último acceso, insignia «Prueba»); invitar; reenviar o revocar invitaciones; cambiar rol; desactivar y reactivar; borrar; «Borrar usuarios de prueba»; exigir 2FA a propietario y administradores (desactivado por defecto, [USU-12]); «Traspasar la propiedad», solo para el propietario y con su contraseña ([USU-16]). Al quitarle a un Agente su último canal, avisa de que desde ese momento ve todos ([PER-02]) | Roles, Demo, Seguridad |
| Horario | `/ajustes/horario` | 0 | Tramos por día, festivos y cierres | Agenda, Traspaso |
| IA | `/ajustes/ia` | 1 (reordenación, 4) | Clave de OpenRouter (enmascarada) con «Probar clave»; modelos por defecto de chat y su respaldo (de otro proveedor), transcripción (con aviso si algún proveedor no es sin retención de datos), embeddings (comprobado de verdad al cambiarlo, con aviso de volver a procesar el conocimiento) y descripción de imágenes, con selectores desactivados hasta que hay clave y aviso si un modelo en uso se retira; recomendados; ZDR; «Reordenar resultados» con su modelo (desactivado por defecto; con ZDR, solo modelos sin retención); clave de Mistral OCR (opcional) ([AJU-04]) | IA, Modelos, Seguridad |
| Correo del sistema | `/ajustes/correo` | 0 | SMTP y «Enviar correo de prueba» (invitaciones, recuperación, avisos) | Ajustes |
| WhatsApp | `/ajustes/whatsapp` | 3 | Tarifas por mercado y categoría (editables; las de la demo marcadas «ejemplo»), con la nota de que los mensajes gratis los marca Meta en cada estado y no se configuran ([AJU-09]); dirección de avisos y token de verificación de la instalación para copiar, si Meta ya la verificó y el aviso cuando no hay dirección pública con HTTPS | WhatsApp (coste estimado) |
| Privacidad y legal | `/ajustes/privacidad` | 7 | Datos del responsable, textos de las páginas legales con enlace a cada una, aviso de IA por defecto, conservación (conversaciones, audios, adjuntos, webhooks) | Cumplimiento |
| Recordatorios | `/ajustes/recordatorios` | 5 | Recordatorios de citas: activar (desactivados por defecto), antelación y canal (plantilla de utilidad de WhatsApp con sus variables, o email con su texto) ([AGD-24]); también enlazado desde Agenda › Configuración | Agenda |
| Notificaciones | `/ajustes/notificaciones` | 2 | Qué sucesos avisan (traspaso, conversación nueva —desactivado por defecto—, conversación asignada, canal con error, calidad de WhatsApp, modelo que se retira y, desde la fase 5, cita pendiente de confirmar) y a quién por defecto ([AJU-08]); desde la fase 7, «Instalar la app» y «Activar avisos» en este dispositivo; «Bandeja y traspasos»: horas de pausa de la IA cuando responde una persona ([BAN-11]) y traspasos por turnos o sin asignar ([TRA-04]); cada persona elige después en Mi cuenta por dónde le llegan | Traspaso, PWA |
| Registro de actividad | `/ajustes/actividad` | 7 | Tabla de acciones de personas e IA con filtros | Seguridad (trazabilidad) |
| Diagnóstico | `/ajustes/diagnostico` | 2 | Base de datos, cola (pendientes y fallidos con «Reintentar»), errores recientes de la IA (hora, tipo, canal, modelo, error y «Ver la conversación»), último webhook por canal (y, de los avisos para números que no son de ningún canal, cuántos, cuándo y el número del último, [WA-34]), correos ignorados de cada buzón por motivo ([COR-16]), correos del sistema y pruebas de conexión (la clave de OpenRouter, el correo de prueba del sistema y la prueba de cada canal conectado, con su resultado en español, [AJU-11]) | Ajustes (diagnóstico) |
| Simulador de canales | `/ajustes/diagnostico/simulador` | 2 | Elegir canal, contacto y tipo (texto, audio, imagen o documento), escribir y «Enviar»; «Ver conversación» | Demo, Simulador |
| Acerca de | `/ajustes/acerca` | 0 | Versión y enlaces a Ayuda | Ajustes |

Estados propios: clave de OpenRouter no válida, con el motivo; SMTP sin configurar: aviso «Sin correo del
sistema no salen las invitaciones ni los enlaces de recuperación»; supervisor, agente y solo lectura solo ven
Mi cuenta y Acerca de («Sin permiso» en las demás).

## Ayuda

### Guías · `/ayuda` y `/ayuda/[guia]` · fase 0 (cada guía llega con su fase)

- **Quién:** cualquier persona con sesión.
- **Se ve:** la lista de guías (`docs/guia-*.md` y la lista de puesta en marcha: publicación, WhatsApp,
  correo, agentes y conocimiento, agenda y puesta en marcha, en `/ayuda/puesta-en-marcha`) y cada guía con el
  índice de sus apartados. Van incluidas en la app al compilar ([AJU-17]). La plantilla de contrato de encargo del
  tratamiento es un documento para el abogado del negocio y se queda en `docs/`.
- **Acciones:** abrir un apartado; los «¿Dónde lo encuentro?» de los asistentes llegan aquí con su ancla.
- **Áreas:** Ajustes (Acerca de), asistentes de WhatsApp y correo.

## Públicas

### Páginas legales · `/legal/privacidad`, `/legal/terminos`, `/legal/eliminacion-datos` · fase 3 (básicas) y 7

- **Se ve:** logo y nombre del negocio, título, fecha de actualización, texto y enlaces entre las tres. En la
  fase 3, con los datos del negocio y textos por defecto, porque Meta pide sus direcciones para publicar la app
  ([WA-21]); desde la fase 7, con los textos de Ajustes › Privacidad ([CUM-08]).
- **Áreas:** Cumplimiento, WhatsApp (Meta pide estas URLs para publicar la app).

### Prueba del chat web · `/widget-demo` · fase 2

- **Se ve:** una página de ejemplo con el nombre del negocio, el aviso «Página de prueba del chat web» y el
  widget; si hay varios chats web, selector.
- **Áreas:** Chat web, Demo (criterio de aceptación de la fase 2).
- **Estados:** sin chat web: «No hay ningún chat web · Crea uno en Canales».

### Chat web (widget) · en la web del negocio, con `/widget.js` · fase 2

- **Se ve:** lanzador; panel con cabecera del negocio, bienvenida, aviso de IA, textos legales, mensajes y
  compositor; formulario de datos dentro de la conversación cuando hace falta.
- **Acciones:** escribir, adjuntar imagen o voz (si está activo), pedir una persona, cerrar.
- **Áreas:** Chat web (visitante anónimo, sondeo, límites), Cumplimiento.
- **Estados:** conectando, sin conexión, límite de mensajes, error al enviar, dominio no permitido (no se
  muestra), «Una persona te atenderá pronto».

## Elementos comunes

- **Franja «Modo demo»:** en todas las pantallas con `DEMO_MODE`, también en el inicio de sesión.
- **Aviso «Añade tu clave de OpenRouter»:** en todas las pantallas con sesión mientras falte la clave; botón a
  Ajustes › IA solo para quien puede ponerla.
- **Página no encontrada:** «Esta página no existe» y «Ir a la bandeja».
- **Sin permiso:** la del `DESIGN.md`, en cualquier ruta que el rol no pueda ver.

## Preguntas

Salieron de huecos de la especificación. Se mantiene la numeración para poder citarlas.

Resueltas por `docs/spec.md` (2026-09-26):

- **1 · Administrador:** usa Bandeja, Contactos, citas e Informes; se diferencia del propietario en que no puede
  cambiar, desactivar ni borrar al propietario ni traspasar la propiedad ([PER-05], [PER-06]).
- **2 · Supervisor:** ve y edita contactos y fusiona duplicados, sin exportar ni borrar; ve los agentes en solo
  lectura y puede probarlos; en la agenda gestiona citas, bloqueos y ausencias, pero no la configuración.
- **3 · Agente:** ve los contactos y las conversaciones de sus canales ([PER-02]); en la agenda ve todas las
  citas y crea, cambia y cancela; toma para sí conversaciones sin asignar de sus canales y cambia su estado.
- **4 · Solo lectura:** ve Bandeja, Contactos, Agenda, Agentes, Conocimiento, Canales (estado y panel, sin
  credenciales) e Informes, sin acciones; de Ajustes, solo Mi cuenta y Acerca de ([PER-03]).
- **5 · 2FA «exigible»:** interruptor en Ajustes › Usuarios, desactivado por defecto ([USU-12]).
- **6 · Tarifas de WhatsApp:** en `/ajustes/whatsapp` ([AJU-09]).
- **7 · Recordatorios:** en `/ajustes/recordatorios` (Ajustes › Recordatorios), con una tarjeta y su enlace en
  Agenda › Configuración › General ([AGD-20], [AGD-24]). Así se construyó en la fase 5; falta que el propietario lo
  confirme (antes decía `/agenda/configuracion`).
- **8 · Páginas legales:** versión básica en la fase 3 y completa en la fase 7 ([CUM-08], [WA-21]).
- **10 · «¿Dónde lo encuentro?»:** texto corto en el propio campo y «Ver la guía», que abre la guía dentro de la
  app, en Ayuda, con sesión ([AJU-17]).

Siguen abiertas (hasta que se respondan, se construye la recomendación):

- **9 · Inicio de sesión en la demo:** ¿mostrar los usuarios de prueba con «Entrar como…» (solo con
  `DEMO_MODE`)? Recomendación: sí.
- **11 · Color de los recursos:** `DESIGN.md` propone 8 colores con nombre en vez de un selector libre, para que
  las citas se lean igual en claro y oscuro. ¿De acuerdo?
- **12 · Widget:** siempre en tema claro en la v1 (no sigue el modo oscuro de la web donde está). ¿De acuerdo?
