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
- **Fase:** la primera fase de la especificación en la que aparece (0 a 14). Algunas partes llegan después y se
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
| Envíos | ✔ | ✔ | Ver | — | Ver |
| Asistentes | ✔ todos | ✔ todos | Con acceso | Con acceso | — |
| Agentes | ✔ | ✔ | Ver y Probar | — | Ver |
| Agentes internos (crear, configurar y dar acceso) | ✔ | ✔ | — | — | — |
| Herramientas HTTP | ✔ | ✔ | — | — | — |
| Conocimiento | ✔ | ✔ | ✔ | — | Ver |
| Bases de conocimiento internas | ✔ | ✔ | — | — | — |
| Canales | ✔ | ✔ | — | — | Ver (estado y panel, sin credenciales) |
| Informes | ✔ | ✔ | ✔ | — | Ver |
| Ajustes: Negocio, Horario, Correo del sistema, WhatsApp, Privacidad, Notificaciones, Envíos, Diagnóstico, Actividad | ✔ | ✔ | — | — | — |
| Ajustes: IA (claves) | ✔ | ✔ | — | — | — |
| Ajustes: Usuarios | ✔ | ✔ (sin tocar al propietario ni traspasar la propiedad) | — | — | — |
| Mi cuenta, Acerca de, Ayuda | ✔ | ✔ | ✔ | ✔ | ✔ |

Pantallas por rol:

- **Propietario** (ordenador): todas.
- **Administrador** (ordenador): todas; no puede cambiar, desactivar ni borrar al propietario ni traspasar la
  propiedad ([PER-05], [PER-06]).
- **Supervisor** (ordenador): Bandeja y conversación (todas), Contactos, Agenda (citas, bloqueos y ausencias,
  sin configuración), Envíos (ver), Asistentes (los agentes internos que le han dado), Agentes (ver y Probar, solo los de
  clientes), Conocimiento (solo las bases para clientes), Informes, Mi cuenta, Acerca de y Ayuda. Nada de
  Canales ni del resto de Ajustes ([PER-04]).
- **Agente** (móvil como app instalada y ordenador): Bandeja, conversación y Contactos de sus canales, Agenda
  (citas), Asistentes (los agentes internos que le han dado), Mi cuenta, Acerca de y Ayuda.
- **Solo lectura** (ordenador): Bandeja, Contactos, Agenda (citas), Envíos, Agentes, Conocimiento, Canales (estado y
  panel, sin credenciales) e Informes, siempre sin botones de acción; Mi cuenta, Acerca de y Ayuda. No ve
  ningún secreto ni el registro de actividad ([PER-03]), ni los agentes internos, sus bases o «Asistentes»
  ([INT-05], [INT-15]).
- **Sin sesión:** inicio de sesión, recuperación, invitación, asistente de arranque (solo en una instalación
  vacía), páginas legales, `/widget-demo`, el chat web en la web del negocio y «Darme de baja» de un envío por correo
  (`/baja/[token]`).

## Navegación

- **Menú lateral** (ordenador): Bandeja · Contactos · Agenda · Envíos · Asistentes | Agentes · Conocimiento ·
  Canales | Informes · Ajustes. Solo aparecen las secciones del rol, y «Asistentes» solo a quien tiene algún agente interno
  que usar ([INT-06]). Abajo, menú de usuario: Mi cuenta, Ayuda, Tema (Claro, Oscuro, Sistema), Cerrar sesión. Se
  pliega a iconos.
- **Barra inferior** (móvil y PWA): Bandeja · Agenda · Contactos · Más (el resto de secciones del rol, también
  «Asistentes», Mi cuenta y Ayuda). Se oculta dentro de una conversación.
- **Barra superior:** migas de pan (en Ajustes, «Ajustes › página», también en Mi cuenta) y campana de notificaciones
  (popover con traspasos pendientes, canales con error, citas creadas por la IA; cada una lleva a su pantalla; «Marcar
  todo como leído»).
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
  - Contactos → marcar contactos → «Programar envío» → «Revisar destinatarios» → «Programar envío» → el envío con sus
    resultados en Envíos.

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
  hora, no leídos, estado, modo (IA, Persona, IA en pausa), asignado y etiquetas. El canal va en texto, en una
  pastilla con su icono, al principio de la línea de datos: «Instagram · @cuenta», «WhatsApp · Recepción» (si el
  nombre es el del tipo, una sola vez); el filtro de canal los nombra igual (fase 16, [BAN-17]). En ordenador, a la derecha,
  la conversación elegida (o «Elige una conversación»).
- **Acciones:** buscar por contacto o por el texto de los mensajes, sin distinguir tildes ni mayúsculas; filtrar por
  canal, estado, asignado, IA o persona, sin leer y etiquetas; pestañas rápidas «Pendientes de humano», «Mías»,
  «Todas»; abrir una conversación.
- **Áreas:** Bandeja (lista, filtros, tiempo real, no leídos), Traspaso, Roles.
- **Estados:** vacío sin canales: «Todavía no hay conversaciones · Cuando un cliente escriba por cualquiera de tus
  canales, aparecerá aquí» con «Conectar un canal» (quien pueda) y «Probar con el simulador»;
  vacío por filtros; sin conexión: «Sin conexión. Reintentando…» sin perder la lista.

### Conversación · `/bandeja/[id]` · fase 2

- **Se ve:** cabecera en dos o tres líneas (contacto y canal; quién responde: interruptor de IA con motivo e «IA en
  pausa hasta…»; estado, asignado, agente y etiquetas); el aviso de traspaso con su motivo y su resumen (uno largo
  se corta, con «Ver todo»); mensajes con su autor (cliente, IA con el nombre del agente, persona, sistema), estados
  de entrega, audios con transcripción, imágenes y documentos, notas internas; en ordenador, la ficha del contacto a
  la derecha cuando la conversación conserva al menos 480 px de ancho y, si no, en un panel lateral que abre su botón
  de la cabecera. La pantalla ocupa justo el alto disponible: el cuadro de escribir está siempre a la vista. Desde la
  fase 14, el mensaje de un envío lleva delante «Envío «nombre»:», para saber a qué envío responde el cliente
  ([ENV-12]).
  - WhatsApp (fase 3): ventana de 24 h («Ventana abierta hasta … · quedan …») y, si está cerrada, solo plantillas
    aprobadas con «Elegir plantilla»: diálogo con idioma y categoría, un campo por variable y vista previa; bajo
    cada mensaje enviado, su coste estimado («≈ 0,02 US$ estimado · Utilidad», «Gratis · Servicio» o «Sin estimar»).
    Desde la fase 12, una plantilla que el cliente no puede recibir lo dice en el diálogo y no deja enviarla: sin
    el permiso que pide (el de «Novedades y publicidad», o el de «Avisos de sus citas» si el cliente dijo que no lo
    quiere: «Este cliente dijo que no quiere «Avisos de sus citas»…»), con «Anotar permiso» (cómo lo dio y una nota)
    allí mismo; dado de baja; o una de marketing sin botón de baja ([WA-61]).
  - Instagram (fase 16): la cabecera dice «Instagram · @cuenta»; ventana de 24 h como en WhatsApp, pero cerrada no
    ofrece plantillas: «Han pasado más de 24 horas desde el último mensaje del cliente: Instagram no deja responder
    hasta que vuelva a escribir.» y el cuadro de escribir se desactiva ([BAN-18]). Solo texto, de 1.000 bytes como
    mucho (una respuesta más larga se rechaza diciendo por qué, [IG-05]). Lo que el negocio responde desde la app de
    Instagram aparece firmado «Desde Instagram» y pausa la IA ([IG-06]); un mensaje que el cliente borra queda «El
    cliente borró este mensaje», también en la lista ([IG-07]).
  - Correo (fase 6): hilo con asunto y borradores para aprobar. Un correo cuyo remitente no verificó el servidor que
    lo recibió lleva «Remitente no verificado», y uno que pedía las respuestas en otra dirección (Reply-To) lo dice:
    se responde solo a quien lo envió ([COR-25]).
  - Bajas (fase 7): si el cliente se ha dado de baja en ese canal, sobre el cuadro de escribir: «Este cliente se ha
    dado de baja en este canal: la IA, los recordatorios, las plantillas y los envíos están parados.»; una persona
    puede seguir escribiéndole ([CUM-04]).
  - Sin confirmar (fase 13): si la identidad del cliente la hizo la app (el primer WhatsApp a su teléfono, o su
    respuesta a un recordatorio del correo del sistema), sobre el cuadro de escribir: «Sin confirmar: la app escribió
    a un teléfono o a un correo que nadie ha confirmado que sea de este cliente…» con «Confirmar» para quien puede
    editar el contacto ([WA-63]).
  - Permisos y bajas (fase 12), en la ficha del lateral: «Avisos de sus citas» y «Novedades y publicidad» (Sí, «Sí,
    por defecto» para los avisos mientras no diga que no, o No),
    las bajas vigentes con su fecha y «Anotar una baja» para la que el cliente pide por otra vía ([CTO-08], [CTO-09]).
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
  fusionar duplicados (elegir dos y qué datos se quedan; propietario, administrador y supervisor), para
  exportar (CSV) y borrar (propietario y administrador; se confirma escribiendo cuántos contactos son) o, desde la
  fase 12, para «Permisos»: marcar o quitar un permiso a todos los elegidos diciendo cómo lo dieron (hasta 500; se
  saltan los dados de baja y dice cuántos se marcaron; también el agente, en sus canales, [CTO-09]). «Posibles
  duplicados» y «Exportar» toda la lista con la búsqueda y los filtros. El agente solo ve los contactos de sus
  canales. Desde la fase 14, propietario y administrador: «Programar envío» con los seleccionados y, arriba, «Envío a
  todos» o «Envío a los del filtro» (etiqueta y canal; con una búsqueda escrita no sale, [ENV-02]).
- **Áreas:** Contactos, Cumplimiento (exportar y borrar), Envíos.
- **Estados:** vacío: «Aún no hay contactos · Se crean solos cuando alguien escribe por un canal».

### Importar contactos · `/contactos/importar` · fase 13

Propietario y administrador ([CTO-11]–[CTO-13]); en Contactos, «Importar».

- **Se ve:** «1. El archivo»: qué columnas entiende (Nombre, Teléfono, Email, Etiquetas y, para cada permiso, «sí» o
  «no», su fecha y cómo lo dio), «Descargar plantilla» (un Excel con esos títulos), el archivo (.xlsx o .csv, hasta
  5.000 contactos y 5 MB; 4 MB en Vercel) y el prefijo de los teléfonos que no lo llevan (+34). «2. Lo que se
  importará»: cuántas filas entran, cuántas se saltan porque ya existen (con el contacto o la fila con los que
  coinciden y «Descargar la lista») y las filas con errores con lo que les pasa; las columnas que no conoce. Si el
  archivo marca permisos, la casilla «Confirmo que estos clientes dieron de verdad los permisos que marca el archivo».
- **Acciones:** «Revisar archivo» (no escribe nada) e «Importar N contactos»; al terminar, lo que hizo, «Ir a
  Contactos» e «Importar otro archivo».
- **Estados:** un archivo que no se puede leer, sin columna de teléfono ni de email, sin filas o demasiado grande lo
  dice en una frase; sin permiso, «Sin permiso».

### Ficha del contacto · `/contactos/[id]` (y panel lateral en la conversación) · fase 2

- **Se ve:** datos, identidades por canal (nunca el teléfono como clave), etiquetas, campos personalizados,
  consentimientos y bajas por canal, citas (fase 5) e historial de conversaciones. Desde la fase 12, «Permisos»:
  «Avisos de sus citas» («Sí, por defecto» mientras no diga que no, [CTO-09]) y «Novedades y publicidad», cada uno
  con desde cuándo, cómo lo dio o lo retiró y quién lo anotó (si fue la IA, su último mensaje y el del cliente); el
  aviso «Dado de baja» dice de qué (de todo o de novedades y
  publicidad) y en qué tipo de canal; y los consentimientos, en español, con su tipo de canal y cómo.
- **Acciones:** editar datos y etiquetas; «Nueva cita»; abrir una conversación; exportar sus datos y borrarlos
  (fase 7, con confirmación escribiendo el nombre); «Marcar permiso» / «Quitar permiso» (cómo y cuándo lo dio),
  «Anotar una baja» (de qué y en qué canal) y «Levantar baja» de cada una, solo si el cliente lo pide y diciendo cómo
  lo pidió (fase 12).
- **Áreas:** Contactos, Agenda, Cumplimiento.

## Agenda

### Agenda · `/agenda?vista=dia|semana|mes|recursos&fecha=…` · fase 5 (semana y mes rehechos en la fase 11)

- **Se ve:** calendario en vista de día, semana, mes o por recurso (columnas); horario, festivos, ausencias y
  huecos bloqueados; citas con su estado y origen; en aforo, ocupación por franja. La terminología del sector
  (Cita/Reserva, Profesional/Mesa/Sala/Box, Cliente/Paciente/Comensal). En la semana, cada cita con su hora, su
  nombre y su servicio (y el profesional si cabe), acortados en palabra entera; tres a la vez como mucho y un
  «+N» con las demás; lo libre en blanco y lo ocupado un poco más oscuro; los días con más citas a la vez, más
  anchos. En el día y la semana, el cierre de mediodía común a todos los días, plegado en una franja «Cerrado de
  14:00 a 16:00». En el mes, cuántas citas tiene cada día y una barra con lo lleno que está (y, en pantallas
  anchas, sus dos primeras citas); los cerrados dicen «Cerrado» o «Cerrado · 2 citas».
- **Acciones:** nueva cita (servicio, recurso o cualquiera, inicio, personas, contacto, notas) con huecos
  libres calculados; mover y cambiar duración arrastrando (o desde la ficha); bloquear huecos; filtrar por
  recurso, servicio, estado, origen y citas de prueba; mostrar canceladas; «Citas de prueba (N)» con su lista y
  «Borrar todas»; menú «⋯» a la configuración (el supervisor, a las ausencias). En el móvil, «Bloquear hueco» y
  «Citas de prueba (N)» están en ese mismo menú «⋯». `/agenda?nueva=1&contacto=<id>` o
  `&conversacion=<id>` abre «Nueva cita» ya rellena. «+N» abre la lista de las citas que no caben, cada una con su
  ficha; pulsar un día del mes abre ese día.
- **Áreas:** Agenda (pantalla, motor de disponibilidad, sin dobles reservas, modos por recurso y por aforo).
- **Estados:** sin servicios o recursos: «Configura la agenda · Añade al menos un servicio y un recurso» con
  enlace (quien pueda); hueco ocupado al guardar: «Ese hueco ya no está libre» y huecos alternativos.

### Ficha de la cita · panel lateral en `/agenda?cita=[id]` · fase 5

- **Se ve:** estado, servicio, recurso, inicio y fin, personas, contacto, conversación, origen (IA con canal,
  persona o web), notas, autor e historial. Desde la fase 12, la marca «Confirmada por el cliente» (también en el
  calendario, [AGD-33]) y «Recordatorios»: cada uno con su antelación y si salió (por qué canal y cuándo) o por qué
  no salió.
- **Acciones:** confirmar, cambiar, cancelar (con motivo), marcar completada o no presentado, volver a confirmar una
  cancelada, con «Avisar al cliente por su conversación» al confirmar, cambiar o cancelar; ir al contacto o a la
  conversación. Una cita de prueba lo dice y se borra con las demás de prueba («Citas de prueba» o Probar), no sola.
- **Áreas:** Agenda (citas), Bandeja.

### Servicios · `/agenda/configuracion/servicios` · fase 5

- **Se ve:** la lista de servicios; con sitio, en columnas con cabecera para compararlos de un vistazo: «Servicio»
  (nombre, categoría y «Confirmación manual» o «Inactivo»), «Duración» (con sus márgenes debajo), «Precio orientativo»
  (a la derecha), «Reserva» (personas y antelación mínima y máxima) y «Quién lo hace» (los recursos con su color). En
  el móvil, cada servicio en una tarjeta con los mismos datos en una línea.
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

### Recordatorios · `/ajustes/recordatorios` · fase 5 (varios por cita desde la fase 12)

- **Se ve:** interruptor (desactivado por defecto) y hasta tres tarjetas «Recordatorio N» («Añadir recordatorio»,
  «Quitar»). Cada una: cuándo, «En horas» (de 15 minutos a 1 semana antes) o «En días, a una hora» (de 1 a 7 días
  antes, a las HH:MM); por dónde, en orden (casillas WhatsApp, Telegram y Correo con flechas para subir y bajar: sale
  por el primero que el cliente puede recibir y, si falla, por el siguiente); y el mensaje de cada canal marcado:
  WhatsApp (número, plantilla de utilidad aprobada, el dato de la cita de cada variable y qué botón es «Confirmo» y
  cuál «Necesito cambiarla», con el aviso de que Meta la cobra y de que solo sale a quien tiene el permiso), Telegram
  (bot y texto, con los dos botones) o correo (asunto y texto con `{nombre}`, `{servicio}`, `{fecha}`, `{hora}`,
  `{recurso}`, `{personas}` y `{negocio}`; no necesita permiso). Lo que impide guardarlo sale junto a su tarjeta; lo
  que puede hacer que llegue tarde (la caducidad de la plantilla) o enseñar datos de salud (el servicio en un sector
  sanitario), como aviso. Al final, «Respuesta a «Confirmo»».
- **Acciones:** guardar (programa o quita el trabajo de los recordatorios).
- **Áreas:** Agenda (avisos), WhatsApp (plantillas), Telegram, Cumplimiento (permisos).

## Envíos

Propietario y administrador los programan; supervisor y «Solo lectura» los ven; el Agente no entra ([ENV-01]).

### Envíos · `/envios` · fases 14 y 15

- **Se ve:** arriba, «Antes de enviar publicidad»: las normas en tres líneas (solo a quien la aceptó, baja fácil y
  gratuita en cada mensaje, que se vea que es publicidad y quién la envía) con «Guía de envíos» y, en un sector con
  datos de salud, el aviso de elegir por dolencia y de los productos sanitarios ([CUM-14], [CUM-15]). Después,
  «Automáticos y repetidos» (fase 15): cada uno con su nombre, su estado (Activo o En pausa), cuándo sale y para quién
  en una línea, sus canales y la próxima vez (o «Esperando a que termine el envío anterior»). Y, aparte, la
  tabla de los envíos: nombre, estado (Programado, Enviando, En pausa, Terminado, Cancelado), cuándo, canales, contactos y
  resultados (enviados, fallidos, no enviados y pendientes), del más reciente al más antiguo y de 25 en 25. En el
  móvil, tarjetas.
- **Acciones:** abrir un envío o un automático; «Programar envío» (a todos los contactos); «Nuevo automático o
  repetido»; «Anterior» y «Siguiente» entre páginas.
- **Estados:** vacío: «Aún no hay envíos» con cómo programar uno; sin automáticos, qué son en una frase.

### Programar envío · `/envios/nuevo?contactos=…` o `?etiqueta=…&canal=…` · fase 14

- **Se ve:** «Para:» los contactos marcados o los del filtro, con «Elegir en Contactos»; las normas; el nombre (solo
  para el equipo); «Por dónde» (WhatsApp, Telegram y Correo, siempre en ese orden) y el mensaje de cada canal marcado:
  WhatsApp (número de la API oficial, plantilla de marketing aprobada con botón de baja, cada dato con el nombre del
  contacto, el del negocio o un texto fijo, el texto de la plantilla con lo que dirá, el aviso de que Meta la cobra y,
  con YCloud, de que lo enviado desde su consola también cuenta), Telegram (bot y texto, con «No quiero publicidad») o
  correo (asunto y texto, con los avisos de correo del sistema sin configurar y de respuestas fuera de la app si no hay
  buzón conectado); y «Cuándo sale»: ahora o un día y una hora, con las horas de envío. Sin dirección pública con
  HTTPS, el correo sale desactivado y lo explica ([ENV-04]).
- **Acciones:** «Revisar destinatarios»: cuántos lo recibirán por cada canal (los que solo tienen teléfono, «solo si
  su teléfono tiene WhatsApp»), cuántos no y por qué, el coste estimado por WhatsApp (y los países sin tarifa) y, si
  hay que repartirlo, cuándo terminará ([ENV-07]); «Programar envío», solo después de revisar (cambiar algo pide
  revisar otra vez).
- **Estados:** lo que impide programarlo sale junto a su canal o su hora; demasiados envíos seguidos: «Espera un
  rato».

### Envío · `/envios/[id]` (cambiar en `/envios/[id]/editar`) · fase 14

- **Se ve:** estado, cuándo sale (o empezó, terminó o se canceló), cuántos contactos y quién lo programó; si está en
  pausa, el motivo (si se paró solo, cómo seguir); los totales (pendientes, enviados, entregados, leídos, fallidos y no
  enviados), la nota de que entregado y leído solo existen en WhatsApp y el coste estimado; el mensaje de cada canal; y
  los contactos de 25 en 25 con su canal, estado, motivo, cuándo salió y coste ([ENV-12]).
- **Acciones:** «Cambiar» (mientras no ha empezado, también si la app lo paró a su hora; sus contactos no cambian),
  «Pausar» (solo en marcha), «Reanudar» y «Cancelar envío» (con confirmación: lo que salió no se deshace) ([ENV-10]);
  abrir la ficha de un contacto. Si lo hizo un automático o un repetido, «Lo hizo «…»» lleva a él.

### Nuevo automático o repetido · `/envios/automaticos/nuevo` (cambiar en `/envios/automaticos/[id]/editar`) · fase 15

- **Se ve:** nombre (solo para el equipo); «Cuándo sale»: «Tras la cita» (días después, de 1 a 90, hora y «Todos los
  servicios» o algunos), «Cada semana» (día y hora) o «Cada mes» (día del mes y hora, con «si el mes no tiene ese día,
  sale el último»); en los repetidos, a quién: una etiqueta (o todos) y, si se quiere, el canal por el que escribieron;
  los canales y el mensaje de cada uno, como al programar un envío; y, al crearlo, «Activarlo al guardar» (marcado)
  ([ENV-15], [ENV-16]).
- **Acciones:** «Guardar» (al cambiarlo, vale desde la próxima vez).
- **Estados:** lo que falta sale junto a su campo.

### Automático o repetido · `/envios/automaticos/[id]` · fase 15

- **Se ve:** su tipo, estado, canales y quién lo creó; cuándo sale y para quién en una línea; la próxima vez (o que
  está en pausa, o que espera a que termine el envío anterior); el mensaje de cada canal; y los envíos que ha hecho
  (los 25 últimos), cada uno con su estado, que llevan a su página.
- **Acciones:** «Cambiar», «Pausar» o «Activar» y «Borrar» (con confirmación: los envíos que hizo se quedan).

## Asistentes

Los agentes internos, vistos por quien los usa (fase 10). Cómo se crean y a quién se dan: «Editor del agente».

### Asistentes · `/asistentes` · fase 10

- **Quién:** propietario y administrador (todos los agentes internos), supervisor y agente (los que les han dado).
  Solo lectura no entra.
- **Se ve:** una tarjeta por agente interno que la persona puede usar, con su avatar, nombre y descripción.
- **Acciones:** abrir uno para preguntarle.
- **Áreas:** Agentes internos.
- **Estados:** vacío para quien los crea: «Crea tu primer agente interno» con «Nuevo agente» (abre el formulario
  con «Interno» ya elegido); para el resto: «Todavía no tienes asistentes · Cuando un administrador te dé acceso a
  un agente interno, aparecerá aquí».

### Conversación con un asistente · `/asistentes/[id]` (la conversación abierta va en `?c=…`) · fase 10

- **Se ve:** a un lado, «Tus conversaciones» con ese agente (las de esa persona, nunca las de otra; cada una con
  su título y cuándo fue su última pregunta; la abierta, marcada) y «Nueva conversación»; al otro, el chat: las
  preguntas a la izquierda («Tú») y las respuestas a la derecha («IA · nombre del agente»), cada una con «Ver la
  fuente», que despliega lo que consultó para responder, de lo más a lo menos relevante (documento, sección y
  página, y su base). Debajo de la lista, la nota «Solo tú ves tus conversaciones». En el móvil el chat va primero
  y ocupa lo que deja libre la pantalla, con el campo a la vista.
- **Acciones:** preguntar (Intro envía; en el móvil, el botón), seguir una conversación anterior, empezar otra,
  borrar una (la confirmación dice cuál), «Reintentar» cuando repetir la pregunta puede servir, «Cargar más»
  (cuando hay más de 50 conversaciones) y «Cargar mensajes anteriores» (cuando la abierta pasa de 200 mensajes).
  Mientras responde se puede abrir otra conversación o salir de la pantalla; al volver con «Atrás», lo preguntado
  sigue ahí.
- **Áreas:** Agentes internos, Conocimiento (búsqueda), Reglas de la plataforma.
- **Estados:** sin clave de OpenRouter: aviso y no se puede enviar ([INT-11]); demasiadas preguntas seguidas o
  tope del día: el mensaje lo dice y la pregunta no se envía ([INT-12]); la IA no ha podido responder: el aviso
  dice qué puede hacer quien pregunta, o que avise a un administrador ([INT-07]); un agente que no le han dado, por
  su dirección: «Esta página no existe»; la conversación de otra persona, por su dirección: se abre una nueva.

## Agentes

### Agentes · `/agentes` · fase 1

- **Se ve:** tarjetas de agentes con avatar, descripción, modelo y «Activo en:» sus canales. Con agentes internos
  (fase 10), dos grupos: «Para clientes» e «Internos», estos con «Responde al equipo en «Asistentes»» y «Con
  acceso:» (todo el equipo, cuántas personas o solo propietario y administradores) en lugar de los canales. Los
  internos solo los ven propietario y administrador.
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
- **Conocimiento** (`/conocimiento`, fase 4): primero lo que usa casi todo el mundo, las bases elegidas y el modo
  «Automático» o «Buscar siempre»; al final, los archivos de contexto con su tamaño en tokens (tope 30.000 y aviso de
  coste).
- **Herramientas** (`/herramientas`): cada una con interruptor, agrupadas por lo que tocan: «Conocimiento» (fase 4),
  «Agenda» (fase 5), «Clientes» y «Traspaso» (fase 1–2; una que la app no conozca iría a «Otras»); debajo, las
  herramientas HTTP (fase 7).
- **Traspaso** (`/traspaso`): en tres secciones: «Cuándo pasa a una persona» (palabras clave, número de «no lo sé» y
  temas sensibles), «Qué le dice al cliente» (mensajes dentro y fuera de horario) y «A quién se avisa».
- **Canales** (`/canales`): canales con «Activo aquí»; si sustituye a otro agente, confirmación que lo dice.
- **Probar** (`/probar`): chat sin canales reales con «Simular canal» (WhatsApp, correo, web); al lado,
  herramientas usadas, fragmentos con puntuación y fuente, tokens, coste y latencia; «Empezar de nuevo» (borra
  la conversación de prueba) y «Borrar citas de prueba». El supervisor entra aquí aunque el resto del editor
  lo vea en solo lectura.
- **Versiones** (`/versiones`): lista con fecha y autor; ver y restaurar.
- **Agente interno** (fase 10): lleva la insignia «Interno» y sus pestañas son General, Instrucciones (sin
  «Cuándo pasar a una persona» ni «Generar borrador con IA»), Modelo, Conocimiento (puede usar bases internas y
  de clientes), **Acceso**, Probar (sin «Simular canal» ni citas de prueba, y con la respuesta en el mismo formato
  que verá el equipo) y Versiones. No tiene Herramientas, Traspaso ni Canales: esas direcciones no existen para él.
- **Acceso** (`/acceso`, solo agentes internos): «Todo el equipo» o «Personas concretas» (supervisores y agentes
  activos, uno a uno); «Guardar acceso». Propietario y administradores pueden usarlo siempre. Sin nadie marcado,
  lo dice; salir con cambios sin guardar pide confirmación, como en el resto del editor.
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
  DOCX, XLSX, CSV, TXT o MD, de hasta 25 MB, o 4 MB con la app en Vercel; URL con sitemap opcional; pregunta
  frecuente); borrar; refrescar URLs.
- **Preguntas frecuentes** (`/faq`): lista editable de pregunta y respuesta.
- **Probar búsqueda** (`/probar`): consulta sin LLM con los resultados numerados, puntuación, título, sección y
  página; «Nada relevante» cuando no hay resultados.
- **Ajustes** (`/ajustes`): nombre, modelo de embeddings (1536 dimensiones), reindexar, borrar base (escribiendo
  el nombre).
- **Áreas:** Conocimiento (ingesta, búsqueda híbrida, mantenimiento).
- **Estados:** documento con error y el motivo en español; PDF escaneado sin clave de Mistral OCR: aviso con
  enlace a Ajustes › IA; duplicado detectado: «Este archivo ya está en la base».

### Documento · `/conocimiento/[id]/documentos/[docId]` · fase 4

- **Se ve:** estado, origen (archivo o URL con fecha), resumen, fragmentos con su sección y página. Si alguna
  página no tiene texto (en blanco, solo imágenes o escaneada dentro de un PDF con texto), un aviso con cuántas
  son ([CON-06]).
- **Acciones:** cambiar título (archivo, URL o texto; sus fragmentos se vuelven a procesar con él), refrescar
  (URL), borrar (borra fragmentos y archivo).
- **Áreas:** Conocimiento (troceado, trazabilidad).

## Canales

### Canales · `/canales` · fase 2

- **Se ve:** tarjetas por canal (WhatsApp, correo, chat web, Telegram e Instagram) con estado, número, correo, dominio,
  usuario del bot o de la cuenta de Instagram (enteros, sin cortar), agente activo e interruptor de IA, modo pruebas, «Demo» y último mensaje. Un número de WhatsApp
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
  hace falta, coste, plantillas, riesgo de bloqueo y dónde funciona). Después, «Otros canales»: Chat web, Correo,
  Telegram e Instagram.
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

### Asistente de Instagram · `/canales/nuevo/instagram` (volver a conectar con `?canal=`) · fase 16

- **Quién:** propietario y administrador.
- **Se ve:** cuatro pasos ([IG-01]). «Prepara tu app de Meta»: la cuenta profesional y pública, crear la app (tipo
  «Business», producto Instagram), «Add account» y «Generate token», la «Instagram app secret» y publicar la app, cada
  paso con su página oficial de Meta; sin dirección pública con HTTPS, el aviso de que Meta no puede avisar a la app
  hasta publicarla. «Conectar»: token de la cuenta, clave secreta de Instagram, clave secreta de la app de Meta
  (opcional), nombre del canal, agente activo e IA del canal; las claves en campos de contraseña. «Avisos de Meta»: la
  cuenta conectada (@usuario), la dirección de avisos y el token de verificación para copiarlos, cómo pegarlos en
  «Configure webhooks» y un semáforo que se pone en verde cuando Meta comprueba la dirección. «Prueba»: escribir a la
  cuenta desde otra cuenta de Instagram, y «Ha llegado tu mensaje» en cuanto llega.
- **Estados:** un token que Instagram rechaza no guarda nada y dice por qué en español; la misma cuenta ya conectada
  en otro canal ([IG-11]).

### Panel del canal · `/canales/[id]` y pestañas · fases 2, 3, 6, 9 y 16

- **Resumen** (`/canales/[id]`): arriba, lado a lado, «Estado» (estado, último mensaje y agente) y «Agente e IA» (el
  agente activo y el interruptor de IA, que es lo que más se cambia); después, los avisos que piden hacer algo y lo
  propio de cada tipo de canal; al final, «Desactivar o borrar». Lo que es solo de consulta va plegado: «Límites de
  Meta que conviene conocer» en un número de WhatsApp y «Qué correos se ignoran» en un buzón (debajo de «Ignorados
  hasta ahora»). Semáforos (WhatsApp, en dos columnas: token, registro, suscripción, webhook, último mensaje,
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
- **Plantillas** (WhatsApp): lista con estado, categoría, idioma, variables y motivo de rechazo (en español);
  «Sincronizar». En la fase 3 está en el Resumen, no en una pestaña propia. Desde la fase 12 (Meta y YCloud):
  «Nueva plantilla» (propietario y administrador), que empieza con los modelos «Recordatorio de cita» y «Novedades y
  publicidad» o en blanco: nombre, idioma, categoría, caducidad, encabezado, texto con «Insertar dato», pie y
  botones de respuesta rápida con lo que hace cada uno, y vista previa con datos de ejemplo; la manda a revisar (en
  un número de demo queda aprobada al momento). Cada plantilla dice si se creó desde la app, su caducidad, los
  cambios de categoría de Meta y, si tiene botones, «Qué hace cada botón» ([WA-57]–[WA-62]).
- **Apariencia y código** (`/apariencia`, chat web): lo del asistente de chat web.
- **Acciones de las otras vías de WhatsApp:** con YCloud, Revalidar, Cambiar clave, Sincronizar plantillas y
  Desconectar; por código QR, Reconectar (si la sesión sigue vinculada pero la conexión está cerrada), Volver a
  vincular y Desconectar.
- **Acciones:** Revalidar, Cambiar token, «Volver a registrar» (WhatsApp, tras un cambio de nombre), Pausar
  IA, Desconectar (confirmación escribiendo el nombre; en WhatsApp borra credenciales y, si se confirma, da de
  baja la suscripción y el registro; un número desconectado no se «Activa»: se vuelve a conectar con su
  asistente); «Reconectar» si el correo requiere reconexión.
- **Instagram** (fase 16, [IG-10]): la cuenta (@usuario, con su enlace), los semáforos (token, caducidad del token,
  recepción y último mensaje), el token enmascarado y «Vale hasta…» (se renueva sola cada semana), y la dirección de
  avisos con su token de verificación (solo propietario y administrador). Acciones: Revalidar (vuelve a comprobar el
  token y a suscribir la cuenta), Cambiar token (diálogo con campo de contraseña; solo de la misma cuenta) y
  Desconectar (escribiendo el nombre: borra token y claves y deja el canal desactivado con su historial). Un canal de
  demo solo lo explica.
- **Áreas:** Canales, WhatsApp (panel, revisión cada 6 h), Correo, Chat web, Telegram (panel, revisión cada 6 h),
  Instagram (panel, revisión cada 6 h con la renovación semanal del token).

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

`/ajustes` es el índice de Ajustes (en el móvil, su menú): las páginas del rol, en una lista por grupo. En ordenador,
subnavegación a la izquierda con los mismos grupos separados por una línea, siempre a la vista. «Mi cuenta» (`/perfil`)
se ve dentro de Ajustes, con la subnavegación y las migas «Ajustes › Mi cuenta», salvo mientras haya que activar la
verificación en dos pasos ([USU-12]).

| Página | Ruta | Fase | Qué se ve y se hace | Áreas |
|---|---|---|---|---|
| Mi cuenta | `/perfil` | 0 (push en 7) | Nombre, email, contraseña, activar o quitar 2FA (QR, código y códigos de recuperación), tema, qué avisos recibo y por dónde (en la app, push en este dispositivo, email), «Instalar la app» y cerrar sesión, que apaga antes el push de este dispositivo ([USU-18], [PWA-03]) | Seguridad, PWA |
| Negocio | `/ajustes/negocio` | 0 | Nombre, sector, logo, color principal con vista previa y resultado de contraste, zona horaria, datos de contacto | Ajustes, Marca |
| Usuarios | `/ajustes/usuarios` | 0 | Tabla (nombre, email, rol, canales del agente, 2FA, último acceso, insignia «Prueba»); invitar; reenviar o revocar invitaciones; cambiar rol; desactivar y reactivar; borrar; «Borrar usuarios de prueba»; exigir 2FA a propietario y administradores (desactivado por defecto, [USU-12]); «Traspasar la propiedad», solo para el propietario y con su contraseña ([USU-16]). Al quitarle a un Agente su último canal, avisa de que desde ese momento ve todos ([PER-02]) | Roles, Demo, Seguridad |
| Horario | `/ajustes/horario` | 0 | Tramos por día, festivos y cierres | Agenda, Traspaso |
| IA | `/ajustes/ia` | 1 (reordenación, 4) | Clave de OpenRouter (enmascarada) con «Probar clave»; modelos por defecto de chat y su respaldo (de otro proveedor), transcripción (con aviso si algún proveedor no es sin retención de datos), embeddings (comprobado de verdad al cambiarlo, con aviso de volver a procesar el conocimiento) y descripción de imágenes, con selectores desactivados hasta que hay clave y aviso si un modelo en uso se retira; recomendados; ZDR; «Reordenar resultados» con su modelo (desactivado por defecto; con ZDR, solo modelos sin retención); clave de Mistral OCR (opcional) ([AJU-04]). En tarjetas, por lo que se decide en cada una: «Clave de OpenRouter», «Modelos por defecto» (chat y respaldo), «Audio, imágenes y búsqueda» (transcripción, embeddings y descripción de imágenes), «Modelos recomendados», «Privacidad» (ZDR), «Reordenar resultados» y la clave de Mistral OCR, con un solo «Guardar cambios» | IA, Modelos, Seguridad |
| Correo del sistema | `/ajustes/correo` | 0 | SMTP y «Enviar correo de prueba» (invitaciones, recuperación, avisos, recordatorios y envíos); desde la fase 14, «Para enviar a muchos contactos»: un servicio de envíos con el dominio verificado (SPF, DKIM y DMARC), no la cuenta de trabajo, con enlaces a Ajustes › Envíos y a la guía ([AJU-06]) | Ajustes |
| WhatsApp | `/ajustes/whatsapp` | 3 | Tarifas por mercado y categoría (editables; las de la demo marcadas «ejemplo»), con la tabla primero y, plegado debajo, «Cómo se calcula el coste estimado», que incluye la nota de que los mensajes gratis los marca Meta en cada estado y no se configuran ([AJU-09]); dirección de avisos y token de verificación de la instalación para copiar, si Meta ya la verificó y el aviso cuando no hay dirección pública con HTTPS | WhatsApp (coste estimado) |
| Privacidad y legal | `/ajustes/privacidad` | 7 | Datos del responsable, textos de las páginas legales con enlace a cada una, aviso de IA por defecto, conservación (conversaciones, audios, adjuntos, webhooks y, desde la fase 14, resultados de los envíos) | Cumplimiento |
| Recordatorios | `/ajustes/recordatorios` | 5 (12) | Recordatorios de citas: activar (desactivados por defecto) y hasta tres por cita, cada uno con su antelación y sus canales en orden (plantilla de utilidad de WhatsApp con sus datos y botones, Telegram o correo) y la respuesta a «Confirmo» ([AGD-24], [AGD-32]); también enlazado desde Agenda › Configuración | Agenda |
| Envíos | `/ajustes/envios` | 14 | Cuándo salen (de 9:00 a 21:00 por defecto, en la zona del negocio), días entre envíos a un mismo contacto (7) y el correo: tope diario del correo del sistema (100, el del plan del servicio) y cuántos pueden ser de envíos por hora y por día (25 y 75) ([AJU-18]) | Envíos |
| Notificaciones | `/ajustes/notificaciones` | 2 | Qué sucesos avisan (traspaso, conversación nueva —desactivado por defecto—, conversación asignada, canal con error, calidad de WhatsApp, modelo que se retira y, desde la fase 5, cita pendiente de confirmar) y a quién por defecto ([AJU-08]); desde la fase 7, «Instalar la app» y «Activar avisos» en este dispositivo; «Bandeja y traspasos»: horas de pausa de la IA cuando responde una persona ([BAN-11]) y traspasos por turnos o sin asignar ([TRA-04]); cada persona elige después en Mi cuenta por dónde le llegan | Traspaso, PWA |
| Registro de actividad | `/ajustes/actividad` | 7 | Acciones de personas, IA y sistema con filtros (quién y qué acción; debajo, las fechas y «Filtrar»): fecha y hora, quién, qué hizo —con sus detalles debajo, en español y con los identificadores abreviados— y sobre qué. Cabe en su columna sin scroll de lado; si no llega a unos 640 px, pasa a tarjetas | Seguridad (trazabilidad) |
| Diagnóstico | `/ajustes/diagnostico` | 2 | Arriba, «Resumen»: si todo funciona o cuántas cosas hay que revisar, y una línea con semáforo por área (base de datos, trabajo en segundo plano, IA, correo del sistema y canales) que lleva a su apartado. Después, cada apartado: base de datos, cola (pendientes y fallidos con «Reintentar»), errores recientes de la IA (hora, tipo, canal, modelo, error y «Ver la conversación»), último webhook por canal (y, de los avisos para números que no son de ningún canal, cuántos, cuándo y el número del último, [WA-34]), correos ignorados de cada buzón por motivo ([COR-16]), correos del sistema y pruebas de conexión (la clave de OpenRouter, el correo de prueba del sistema y la prueba de cada canal conectado, con su resultado en español, [AJU-11]) | Ajustes (diagnóstico) |
| Simulador de canales | `/ajustes/diagnostico/simulador` | 2 | Elegir canal, contacto y tipo (texto, audio, imagen o documento), escribir y «Enviar»; «Ver conversación» | Demo, Simulador |
| Acerca de | `/ajustes/acerca` | 0 | Versión y enlaces a Ayuda | Ajustes |

Estados propios: clave de OpenRouter no válida, con el motivo; SMTP sin configurar: aviso «Sin correo del
sistema no salen las invitaciones ni los enlaces de recuperación»; supervisor, agente y solo lectura solo ven
Mi cuenta y Acerca de («Sin permiso» en las demás).

## Ayuda

### Guías · `/ayuda` y `/ayuda/[guia]` · fase 0 (cada guía llega con su fase)

- **Quién:** cualquier persona con sesión.
- **Se ve:** las guías (`docs/guia-*.md` y la lista de puesta en marcha) por grupos con su título: «Para empezar»
  (la lista de puesta en marcha, en `/ayuda/puesta-en-marcha`, y la publicación), «Canales» (WhatsApp con la API de
  Meta, con YCloud y por código QR, correo y Telegram), «Agentes y conocimiento» (agentes y conocimiento, y agentes
  internos), «Agenda» y, desde la fase 14, «Envíos»; y cada guía con el índice de sus apartados. Van incluidas en la app al compilar ([AJU-17]). La plantilla de contrato de encargo del
  tratamiento es un documento para el abogado del negocio y se queda en `docs/`.
- **Acciones:** abrir un apartado; los «¿Dónde lo encuentro?» de los asistentes llegan aquí con su ancla.
- **Áreas:** Ajustes (Acerca de), asistentes de WhatsApp y correo.

## Públicas

### Páginas legales · `/legal/privacidad`, `/legal/terminos`, `/legal/eliminacion-datos` · fase 3 (básicas) y 7

- **Se ve:** logo y nombre del negocio, título, fecha de actualización, texto y enlaces entre las tres. En la
  fase 3, con los datos del negocio y textos por defecto, porque Meta pide sus direcciones para publicar la app
  ([WA-21]); desde la fase 7, con los textos de Ajustes › Privacidad ([CUM-08]).
- **Áreas:** Cumplimiento, WhatsApp (Meta pide estas URLs para publicar la app).

### Darme de baja · `/baja/[token]` · fase 14

- **Se ve:** el nombre del negocio, «¿No quieres recibir más novedades ni publicidad de … por correo?» y el botón
  «Darme de baja»; después, «Listo: ya no recibirás novedades ni publicidad … Los avisos de tus citas seguirán
  llegando». Un enlace que no es de la app dice solo que no es válido ([ENV-11]).
- **Acciones:** «Darme de baja» (abrir la página no cambia nada: así un programa de correo que revisa los enlaces no da
  de baja a nadie). Gmail y Yahoo usan además la baja en un clic, `POST /api/baja/[token]`, sin abrir la página.
- **Áreas:** Envíos, Cumplimiento (límite de intentos por IP).

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
