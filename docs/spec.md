# Especificación

Qué se construye. Sirve para comprobar, sin saber programar, que lo construido hace lo que tiene que hacer.

**Estado:** aprobada (2026-09-26, encargo del propietario del proyecto)

## Qué problema resuelve y para quién

DominIA Agentes es una plataforma de atención al cliente con agentes de IA que se instala una vez por negocio
(una peluquería, una clínica dental, un restaurante…), cada una con su propia base de datos. El negocio atiende
en un solo sitio lo que le llega por WhatsApp, por correo y por el chat de su web: los agentes de IA contestan,
dan información fiable sacada de sus documentos, reservan citas en su agenda y pasan la conversación a una
persona del equipo cuando hace falta. La usan el dueño y su equipo, cada uno con su rol, y todo se configura
desde la pantalla, sin tocar código. Quien clona el repositorio puede probarlo todo con una demo, sin configurar
nada.

## Qué hace

Cada línea es una regla que se puede comprobar: «Cuando pasa esto, la app hace esto otro».

Cada regla lleva delante un código entre corchetes que no cambia y que citan las pruebas (`docs/testing.md`); si
una regla se quita, su código no se reutiliza. En estas reglas, «persona» es alguien del equipo del negocio y
«cliente» es quien escribe al negocio. Los detalles técnicos de cada servicio externo (direcciones, campos,
límites y sus fuentes) están en `docs/integracion-whatsapp.md`, `docs/integracion-whatsapp-mensajes.md`,
`docs/integracion-openrouter.md`, `docs/integracion-correo.md`, `docs/integracion-mistral-ocr.md`,
`docs/integracion-telegram.md`, `docs/notificaciones-push.md`, `docs/busqueda-hibrida.md` y
`docs/plataforma-despliegue.md`. Las tablas donde se guarda cada cosa están en `docs/modelo-de-datos.md`.

### Arranque y demo

- [ARR-01] Cuando alguien clona el repositorio y ejecuta `pnpm install && pnpm dev` sin configurar nada, la app
  arranca en local con la demo cargada y se entra con los usuarios de prueba del README.
- [ARR-02] Cuando `pnpm dev` no encuentra `.env.local` o la base de datos, antes de arrancar prepara la
  instalación: crea `.env.local` con secretos aleatorios (clave de cifrado, secreto de sesiones y secreto del
  cron) y la demo activada, crea `data/local.db`, la pone al día (migraciones) y carga la demo.
- [ARR-03] Cuando esa preparación se repite (`pnpm dev` otra vez o `pnpm run setup`) y ya estaba hecha, no
  cambia nada: no regenera secretos, no duplica datos y no borra nada. Se lanza con `run` porque `pnpm setup`
  es una orden de pnpm que cambia el PATH del ordenador.
- [ARR-04] `.env.example` explica cada variable, sin valores secretos, y sus valores de ejemplo para local
  funcionan tal cual.
- [ARR-05] Cuando la demo está activa, todas las pantallas del panel muestran el aviso «Modo demo».
- [ARR-06] La demo es una peluquería con horario, servicios, profesionales, contactos, agentes ya asignados a
  canales, un chat web real y un WhatsApp y un correo de demo.
- [ARR-07] Las citas de la demo se colocan en fechas relativas al día en que se carga (días pasados, hoy y los
  próximos), así que la agenda nunca aparece vacía ni caducada.
- [ARR-08] Las conversaciones de la demo son realistas: incluyen un audio con su transcripción, imágenes, al
  menos un traspaso a persona y citas creadas por la IA.
- [ARR-09] Los usuarios de prueba cubren los cinco roles, con email y contraseña conocidos, y aparecen en una
  tabla del README (email, contraseña y rol).
- [ARR-10] `pnpm seed --sector=<sector>` carga la demo de ese sector en vez de la peluquería. Los sectores son
  `peluqueria`, `clinica-dental`, `fisioterapia`, `restaurante`, `taller`, `academia`, `inmobiliaria`, `tienda` y
  `otro`; con uno que no existe, el comando falla, lista los válidos y no toca la base de datos.
- [ARR-11] Los canales de WhatsApp y correo de la demo están marcados «Demo»: nunca llaman a Meta, Google,
  Microsoft ni a un servidor de correo; lo que reciben llega por el simulador y lo que «envían» solo se guarda.
- [ARR-12] La base de conocimiento de la demo viene ya procesada, con los embeddings (la versión en números de
  cada fragmento, que permite buscar por significado) guardados en el repositorio: al poner la clave de
  OpenRouter, la búsqueda por significado funciona al momento, sin volver a procesar nada. Sin clave va solo
  por texto ([ARR-14]): los embeddings guardados evitan procesar los documentos, pero cada búsqueda necesita
  calcular el embedding de la pregunta, y eso pide la clave. Corrige a propósito la frase del encargo según la
  cual la búsqueda vectorial de la demo funcionaba sin clave.
- [ARR-13] `pnpm seed:embeddings` vuelve a calcular esos embeddings con el modelo por defecto (necesita clave) y
  actualiza el archivo del repositorio.
- [ARR-14] Sin clave de OpenRouter todo funciona salvo la IA: se ve el aviso «Añade tu clave de OpenRouter» con
  enlace a Ajustes > IA, los agentes no responden (los mensajes esperan en la bandeja a una persona), los audios
  no se transcriben y la búsqueda de conocimiento es solo por texto.
- [ARR-15] Cuando se pone la clave en Ajustes > IA, la IA se activa al momento; si se pone en `.env.local`, al
  reiniciar la app. Si hay clave en los dos sitios, se usa la de Ajustes.
- [ARR-16] `pnpm db:reset` borra todo y deja la demo como recién instalada.
- [ARR-17] `pnpm db:fresh` borra todo y deja una instalación vacía, sin demo ni usuarios: al abrir la app
  aparece el asistente de arranque.
- [ARR-18] La demo solo se carga en local al preparar la instalación o con una orden expresa (`pnpm seed`,
  `pnpm db:reset`); nunca al arrancar una app publicada.
- [ARR-19] Cuando `pnpm seed` se lanza contra la base de datos de un negocio real (una instalación sin demo), se
  niega y no toca nada.
- [ARR-20] Los usuarios de prueba se pueden borrar desde Ajustes > Usuarios, como cualquier otro.
- [ARR-21] `/api/health` responde si la app y la base de datos funcionan, sin mostrar datos privados.
- [ARR-22] El README está en español y explica: qué es y requisitos (versiones de Node y pnpm), arranque rápido,
  usuarios de prueba, cómo poner la clave de OpenRouter, el recorrido de la demo (simulador, `/widget-demo`,
  bandeja y traspaso, asignar agentes, agenda y conocimiento), comandos y variables de entorno, cómo conectar
  WhatsApp, Gmail, Outlook e IMAP reales (resumen y enlace a `docs/`), la publicación en Vercel (Turso, Blob y
  cron), el paso a un negocio real con `pnpm db:fresh` y la solución de problemas. Se pone al día en cada fase.
- [ARR-23] Las guías de `docs/` están en español, con huecos para capturas, enlazadas desde el README y visibles
  en la app ([AJU-17]). Cada una cubre al menos:
  - Publicación (`docs/guia-despliegue.md`): Vercel con Turso, Blob y cron; más adelante, el VPS.
  - WhatsApp (`docs/guia-whatsapp.md`): el negocio crea su portfolio de Meta y da acceso de administrador a
    quien lo implanta; la app de Meta va en ese portfolio; el número deja de funcionar en la app del móvil;
    los límites sin verificar la empresa y cuándo conviene verificarla; la tarjeta (método de pago) y la
    publicación de la app; el tope de 15 apps por persona, por el que conviene que el negocio administre su
    propia app y verifique su empresa cuando pueda; la prueba con el número de prueba de Meta; y los problemas
    frecuentes.
  - Correo (`docs/guia-correo.md`): Google Cloud y Microsoft Entra paso a paso (incluida la caducidad del
    secreto de cliente de Microsoft) y los datos de un servidor IMAP/SMTP.
  - Agentes y conocimiento: crear un agente, cargar documentos, webs y preguntas frecuentes, y no subir datos
    de clientes.
  - Agenda: servicios, recursos, horarios, ausencias y recordatorios.
  - Lista de puesta en marcha: de `pnpm db:fresh` a la primera conversación, incluida la privacidad de la
    cuenta de OpenRouter ([CUM-10]).
  - Plantilla de contrato de encargo del tratamiento ([CUM-09]).
- [ARR-24] El proyecto trae estas skills, en `.agents/skills/` con su puente en `.claude/skills/`:
  - `nuevo-negocio`: datos del negocio, sector, `pnpm db:fresh`, despliegue, arranque y lista de puesta en
    marcha.
  - `conectar-whatsapp`: Meta paso a paso (portfolio del negocio, app en ese portfolio, número, usuario del
    sistema, token, App Secret, publicar la app y método de pago); usa el servidor MCP oficial de Meta
    «WhatsApp Business Tools» si está disponible.
  - `conectar-correo`: Google Cloud, Microsoft Entra o IMAP.
  - `crear-agente`: un agente a partir de la web o de los documentos del negocio.
  - `desplegar`: publicar la instalación siguiendo la guía de publicación.
  - `actualizar`: pasar a una versión nueva, siempre con una copia de seguridad antes.
  - `diagnostico`: averiguar por qué algo no funciona, a partir de Ajustes > Diagnóstico y los documentos de
    integración.

### Inicio de sesión, usuarios e invitaciones

- [USU-01] Cuando alguien entra con email y contraseña correctos, llega a la bandeja; si alguno es incorrecto, ve
  «Email o contraseña incorrectos», sin saber cuál de los dos falla.
- [USU-02] Cuando alguien abre una página privada sin haber entrado, la app le lleva al inicio de sesión y, al
  entrar, le devuelve a esa página.
- [USU-03] No hay registro público: las cuentas solo se crean en el asistente de arranque (el primer
  propietario), aceptando una invitación o con la demo. Un intento de registro directo se rechaza.
- [USU-04] Fuera de la demo, tras el primer arranque solo se entra por invitación.
- [USU-05] Cuando el propietario o un administrador invita a alguien (email, rol y, si es Agente, sus canales),
  la app le envía un email con un enlace de un solo uso que caduca a los 7 días.
- [USU-06] Si el correo del sistema no está configurado, la invitación se crea igual y la app muestra el enlace
  para copiarlo y enviarlo por otro medio.
- [USU-07] Cuando el invitado abre el enlace, pone su nombre y su contraseña y entra con el rol de la invitación.
- [USU-08] Cuando el enlace ya se usó, caducó o se revocó, la app lo dice y no crea la cuenta.
- [USU-09] No se puede invitar a un email que ya tiene cuenta. Las invitaciones pendientes se pueden reenviar o
  revocar.
- [USU-10] Cuando alguien pide recuperar su contraseña, la app responde lo mismo exista o no el email; si existe,
  le envía un enlace de un solo uso que caduca. Al cambiar la contraseña se cierran sus otras sesiones.
- [USU-11] Cada usuario puede activar la verificación en dos pasos con una app de códigos (TOTP), que le da
  códigos de recuperación; desde entonces, al entrar se le pide también el código.
- [USU-12] Cuando en Ajustes > Usuarios se activa «Exigir verificación en dos pasos a propietario y
  administradores» (desactivado por defecto), esos usuarios no pueden usar la app hasta configurarla.
- [USU-13] Tras varios intentos fallidos seguidos desde la misma IP o para el mismo email, la app frena los
  intentos durante un rato, con el mismo mensaje genérico.
- [USU-14] Cuando se cambia el rol de alguien, se desactiva o se borra, vale desde su siguiente acción: un
  usuario desactivado o borrado pierde el acceso al momento.
- [USU-15] Los mensajes, notas y citas de un usuario borrado conservan su nombre como autor.
- [USU-16] Siempre hay exactamente un propietario. Solo él puede traspasar la propiedad a otro usuario,
  confirmando con su contraseña: el otro pasa a propietario y él, a administrador.
- [USU-17] En Ajustes > Usuarios se eligen los canales de cada usuario con rol Agente.
- [USU-18] En «Mi cuenta» cada usuario cambia su nombre, su contraseña, su verificación en dos pasos y sus
  avisos, y cierra sesión.

### Asistente de arranque

- [ASI-01] Cuando la instalación está vacía (sin usuarios), cualquier página lleva al asistente; cuando ya se
  terminó, el asistente no se puede abrir.
- [ASI-02] Paso 1: crear el propietario (nombre, email y contraseña). Solo funciona mientras no existe ningún
  usuario: si dos personas lo intentan a la vez, solo una lo consigue. En una instalación publicada pide además el
  código de instalación (`SETUP_TOKEN`), que solo conoce quien la publica; sin ese código configurado, nadie puede
  crear el propietario. En local (`pnpm dev`) no se pide.
- [ASI-03] Paso 2: datos del negocio y sector: Peluquería/Estética, Clínica dental, Clínica/Fisioterapia,
  Restaurante, Taller, Academia/Clases, Inmobiliaria, Tienda u Otro.
- [ASI-04] Al elegir sector se cargan datos que luego se pueden editar: terminología, servicios, recursos, modo de
  agenda, plantilla de agente y preguntas frecuentes. Inmobiliaria y Tienda usan la agenda de «Otro».
- [ASI-05] Si el sector es Clínica dental o Clínica/Fisioterapia, el asistente avisa de que habrá datos de salud
  ([CUM-12]).
- [ASI-06] Paso 3: horario semanal (varios tramos por día), festivos y cierres, y zona horaria (Europe/Madrid por
  defecto).
- [ASI-07] Paso 4: clave de OpenRouter con «Probar clave», que pregunta a OpenRouter y dice si es válida, y
  elección del modelo. Se puede saltar: la app funciona sin IA ([ARR-14]).
- [ASI-08] Paso 5: primer agente desde la plantilla del sector. Con «Generar desde la web del negocio» y una
  dirección, la IA lee la web y propone instrucciones y preguntas frecuentes editables; si la web no se puede leer
  o no hay clave, lo dice y deja la plantilla.
- [ASI-09] Paso 6: crea un chat web con ese agente activo y permite probarlo ahí mismo.
- [ASI-10] Paso 7: enlaces a los asistentes para conectar WhatsApp y correo. Al terminar, guarda la fecha de
  finalización y lleva a la bandeja.
- [ASI-11] Si se deja a medias, al volver a entrar como propietario sigue en el primer paso pendiente, con lo ya
  guardado. Solo el propietario puede continuar el asistente.

### Ajustes

- [AJU-01] Negocio: nombre, datos de contacto, dirección, sector, zona horaria, logo y color principal (azul
  `#3d6df2` por defecto). El nombre, el logo y el color se ven en el panel, la app instalada, el chat web, las
  páginas legales y los correos del sistema.
- [AJU-02] Usuarios: lista, invitaciones, roles, canales de cada Agente, desactivar y borrar, y la exigencia de
  verificación en dos pasos ([USU-12]).
- [AJU-03] Horario: horario semanal con varios tramos por día, festivos y cierres. Decide qué es «dentro» y
  «fuera de horario» y limita la agenda ([AGD-05]).
- [AJU-04] IA: clave de OpenRouter (con «Probar clave»), clave de Mistral OCR (opcional, para PDF escaneados),
  modelos por defecto de chat, transcripción, embeddings y descripción de imágenes, lista de recomendados, «Sin
  retención de datos» (ZDR) opcional y «Reordenar resultados» ([CON-16]):
  - «Reordenar resultados» vale para toda la instalación, está desactivado por defecto y tiene su modelo (por
    defecto `cohere/rerank-v3.5`). Con ZDR activado solo se ofrecen modelos de reordenación con proveedores
    sin retención (hoy, solo `qwen/qwen3-reranker-8b`); si el elegido no lo es, la app lo avisa y no reordena.
  - Si el modelo de transcripción elegido tiene algún proveedor que no está en la lista sin retención de
    OpenRouter, la app lo avisa junto al campo ([CUM-10]).
- [AJU-05] Cuando se cambia el modelo de embeddings, la app avisa de que hay que volver a procesar todas las
  bases de conocimiento y, al confirmar, lo hace ([CON-13]).
- [AJU-06] Correo del sistema (SMTP), para invitaciones, recuperación de contraseña, avisos y recordatorios:
  servidor, puerto, seguridad, usuario, contraseña y remitente, con «Enviar correo de prueba». Sin él, la app avisa
  de que esos correos no salen.
- [AJU-07] Privacidad y legal: textos de privacidad, términos y eliminación de datos, aviso de IA por defecto y
  plazos de conservación ([CUM-05]).
- [AJU-08] Notificaciones: qué sucesos avisan (traspaso, conversación asignada, canal con error, calidad de
  WhatsApp, modelo que se retira) y a quién por defecto.
- [AJU-09] Tarifas de WhatsApp: precio por mensaje de cada mercado y categoría; se editan aquí y nunca están
  escritas en el código. Las de la demo van marcadas «ejemplo». Los mensajes gratis no se configuran: una nota
  explica que Meta marca en cada estado si el mensaje fue gratis ([WA-47]).
- [AJU-10] Registro de actividad: lo que hacen las personas y la IA, con filtros. Nadie lo puede editar ni borrar
  a mano.
- [AJU-11] Diagnóstico: estado de la base de datos y de la cola de trabajo (pendientes, fallidos, última ronda),
  último aviso recibido por canal, errores recientes, pruebas de conexión y simulador de canales.
- [AJU-12] Cuando se usa el simulador (canal, contacto y tipo de mensaje: texto, audio, imagen o documento), el
  mensaje entra por el mismo camino que uno real, aparece en la bandeja y la IA responde como lo haría.
- [AJU-13] Los mensajes del simulador quedan marcados como simulados y sus respuestas nunca salen a Meta, Google,
  Microsoft ni a un servidor de correo, aunque el canal sea real.
- [AJU-14] Acerca de: versión de la app y enlaces a las guías de Ayuda ([AJU-17]).
- [AJU-15] Cuando un ajuste tiene un valor incorrecto, no se guarda y el error se explica junto al campo.
- [AJU-16] Un campo secreto ya guardado se muestra como «••••1234»; dejarlo vacío al guardar conserva el valor y
  escribir uno nuevo lo sustituye. Si cambia a dónde se envía (servidor, puerto, seguridad o usuario), hay que
  volver a escribirlo, y una contraseña nunca se envía sin cifrar.
- [AJU-17] Ayuda: las guías de [ARR-23] (`docs/guia-*.md` y la lista de puesta en marcha) se ven dentro de la
  app, con sesión y para cualquier rol, en `/ayuda/<guía>`; van incluidas al compilar, así que no dependen del
  repositorio. En los asistentes de
  WhatsApp y de correo, cada «¿Dónde lo encuentro?» muestra ahí mismo un texto corto con dónde está el dato
  (el de `docs/integracion-whatsapp.md` §2.4 en WhatsApp) y «Ver la guía», que abre su apartado.

### Canales (común)

- [CAN-01] Canales muestra cada canal con su tipo, nombre, estado (borrador, conectando, conectado, error o
  desactivado), agente activo, IA encendida o apagada, marca «Demo» si lo es y hora del último mensaje recibido.
- [CAN-02] Puede haber varios canales de cada tipo: WhatsApp, Gmail, Outlook, correo IMAP/SMTP, chat web y
  Telegram.
- [CAN-03] Cada canal tiene como máximo un agente activo. Sin agente activo, o con la IA del canal apagada, la IA
  no contesta y los mensajes esperan en la bandeja a una persona.
- [CAN-04] Desde la tarjeta del canal se elige el «Agente activo» y se enciende o apaga la IA.
- [CAN-05] Cambiar el agente activo afecta solo a los mensajes que llegan después; cada mensaje guarda qué agente
  lo respondió.
- [CAN-06] Modo pruebas «solo a estos contactos» (números, emails o identificadores): mientras está activo, la IA
  solo contesta a los de la lista y los demás mensajes esperan a una persona. Se compara solo lo que da el canal
  (el identificador del visitante, el email del remitente, el BSUID o el número que da WhatsApp), nunca lo que
  alguien escribe, como el email o el teléfono del formulario del chat web.
- [CAN-07] Modo de respuesta: «Automático» (la IA envía) o «Borrador para revisar» (la IA deja un borrador que una
  persona aprueba, edita o descarta). Por defecto, automático en WhatsApp, chat web y Telegram, y borrador en
  correo.
- [CAN-08] Fuera de horario: «Responder igual» (por defecto) o «No responder fuera de horario» (los mensajes
  esperan a una persona). Un agente propio para fuera de horario queda preparado, pero no se ofrece.
- [CAN-09] Cuando llega un aviso de un canal, la app lo procesa en este orden: comprueba la firma, guarda el aviso
  en bruto, lo pasa a un formato común, busca o crea el contacto y su identidad, guarda el mensaje ignorando
  duplicados, avisa a la pantalla y programa la respuesta. Contesta enseguida al servicio que avisa: la prueba
  mide el objetivo de Meta, una mediana de 250 ms o menos y menos del 1 % de respuestas por encima de 1
  segundo. Un aviso para un número que no es de ningún canal también recibe 200 ([WA-34]).
- [CAN-10] La app nunca espera a la IA para contestar a un aviso: la IA trabaja después, en segundo plano.
- [CAN-11] Cuando llega dos veces el mismo mensaje (mismo canal y mismo identificador), se guarda una sola vez y
  se responde una sola vez.
- [CAN-12] En WhatsApp, chat web y Telegram hay una sola conversación por canal y contacto: si estaba resuelta, se
  reabre con el siguiente mensaje. En correo hay una conversación por hilo.
- [CAN-13] Cuando escribe alguien desconocido, se crea el contacto con su identidad en ese canal; si la identidad
  ya existe, el mensaje va a ese contacto. El teléfono nunca sirve para identificar a nadie.
- [CAN-14] Lo que ofrece la bandeja en cada conversación depende de lo que admite su canal (audio, imágenes,
  documentos, plantillas, ventana de 24 h, «escribiendo…», leídos, HTML y borradores): por ejemplo, las
  plantillas solo aparecen en WhatsApp.
- [CAN-15] La app revisa cada canal conectado al conectarlo y cada cierto tiempo; si falla, lo pone en «error»
  con la explicación en español y avisa al propietario y a los administradores.
- [CAN-16] Un canal desactivado no contesta ni envía, y conserva su historial. Solo se puede borrar un canal que
  no tiene conversaciones; los demás se desconectan o se desactivan.
- [CAN-17] Las credenciales de cada canal se guardan cifradas, aparte de su configuración no secreta.

### WhatsApp

Solo la API oficial de Meta (Cloud API), con la app de Meta del propio negocio y un token permanente de usuario
del sistema. Detalles en `docs/integracion-whatsapp.md` (conexión) y `docs/integracion-whatsapp-mensajes.md`
(recepción y envío).

- [WA-01] Canales > Añadir > WhatsApp abre un asistente; cada campo tiene «¿Dónde lo encuentro?», con el texto
  corto y el enlace a su apartado de la guía de WhatsApp dentro de la app ([AJU-17]).
- [WA-02] Paso 0: aviso de que el número dejará de funcionar en la app WhatsApp del móvil (usar uno nuevo o uno
  que el negocio acepte sacar; sugerencia: el principal se queda en el móvil y el agente usa otro). Sin marcar la
  casilla de que se ha entendido no se puede seguir.
- [WA-03] Paso 0, opción «Número de prueba de Meta»: se salta el registro, y el panel recuerda que solo reciben
  mensajes los destinatarios verificados en Meta.
- [WA-04] Paso 1: nombre, token permanente, App Secret y Phone Number ID; en «Avanzado», PIN de 6 dígitos (si el
  número ya tenía verificación en dos pasos) y versión de la API de Meta (por defecto v26.0). Un PIN que no sea
  de 6 cifras se rechaza.
- [WA-05] «Validar con Meta» comprueba el número y obtiene su cuenta de WhatsApp Business, la app y el portfolio;
  si Meta no devuelve la app, pide su App ID.
- [WA-06] «Validar con Meta» comprueba también que el token es válido, de la misma app, de un usuario del sistema
  y con los permisos de mensajes y de gestión de WhatsApp; si falta algo, dice qué y no deja seguir.
- [WA-07] Si el token caduca, la app avisa de que dejará de funcionar y recomienda uno permanente.
- [WA-08] Con todo correcto, muestra «Negocio · Número · Estado» (nombre verificado, número, calidad y estado del
  nombre y de la verificación) para confirmarlo.
- [WA-09] Los errores de Meta se muestran en español con qué hacer: token inválido o caducado (190), permisos o
  app de otro portfolio (200), dato incorrecto (100), demasiados intentos de registro (133016), falta método de
  pago (131042), fuera de la ventana de 24 h (131047), mensaje no entregable (131026), bloqueo por política (368)
  y el resto de la tabla oficial. Un código desconocido muestra un mensaje genérico con el código.
- [WA-10] Si otro número de la instalación usa la misma app de Meta, se reutilizan los datos de esa app.
- [WA-11] No se puede conectar dos veces el mismo número en la instalación.
- [WA-12] Paso 2: hay una sola dirección de avisos por instalación, `https://{dominio}/api/webhooks/whatsapp`,
  siempre en el dominio de producción (nunca el de una vista previa), y un token de verificación propio de la
  instalación que se genera solo.
- [WA-13] El asistente intenta suscribir la app a esa dirección automáticamente. Si no puede, muestra la dirección
  y el token con botón de copiar y los pasos en el panel de la app de Meta («Verificar y guardar», suscribir
  `messages` y los recomendados), y avisa en directo cuando llega la verificación de Meta. Cada app de Meta
  tiene una sola dirección de avisos: si ya tiene otra (por ejemplo, la de un n8n del negocio), el asistente
  avisa de que la sustituiría para toda la app y pide confirmación; sin confirmar, sigue por el camino manual.
- [WA-14] Siempre suscribe la app a la cuenta de WhatsApp Business del número (repetirlo no hace daño) y comprueba
  que ha quedado; si no, lo dice y el canal no pasa a conectado, porque sin eso no llegan mensajes.
- [WA-15] Nunca cambia la dirección de avisos por cuenta o por número (`override_callback_uri`).
- [WA-16] Cuando la app no tiene una dirección pública con HTTPS (por ejemplo, en local), el asistente lo avisa:
  se pueden validar los datos, pero no llegarán mensajes reales.
- [WA-17] Paso 3: si el número no está registrado, la app lo registra con un PIN de 6 cifras (el que ya tenía o,
  si no tenía, uno nuevo, que pasa a ser su PIN) y lo guarda cifrado; no hace falta fijar el PIN antes. Si Meta
  dice que el PIN es incorrecto (133005), ofrece cambiarlo por uno nuevo y registrar con él. Desde el
  23-09-2026 Meta retira el PIN en los números que va eligiendo, pero el registro sigue pidiendo uno de 6
  cifras.
- [WA-18] Cuando Meta responde que se han agotado los intentos de registro (10 cada 72 h), la app lo explica y
  pide confirmación antes de cada nuevo intento.
- [WA-19] Si el número no está verificado, la app pide el código por SMS o llamada, en español, y deja
  escribirlo.
- [WA-20] Cuando Meta aprueba un cambio de nombre, el panel recuerda volver a registrar el número en 14 días como
  máximo, con un botón para hacerlo.
- [WA-21] Lista de comprobación, con los pasos de cada punto:
  - «App publicada (Live)»: sin esto no llegan mensajes reales. Meta pide, entre otras cosas, la dirección de
    las condiciones del servicio, y conviene dar también la de privacidad y la de eliminación de datos: la app
    sirve las tres páginas legales, en su versión básica, desde esta misma fase ([CUM-08]).
  - «Método de pago en WhatsApp Manager»: la API no permite comprobarlo, así que es un aviso que no deja
    terminar hasta que la persona confirma a mano que lo ha añadido, con enlace al Centro de facturación
    (Billing Hub) de Meta. Desde el 1-10-2026, sin método de pago Meta deja de entregar los mensajes de
    servicio cuando se acaban los 1.000 gratis del mes. Con el número de prueba de Meta no se pide.
- [WA-22] «Sincronizar plantillas» trae las plantillas del número con su estado, categoría, idioma y variables;
  cuando Meta avisa de un cambio de estado, se actualizan solas.
- [WA-23] Paso 4: muestra «Escribe "hola" a {número}», el mensaje aparece al llegar y «Enviar respuesta de prueba»
  le contesta.
- [WA-24] Si en 2 minutos no llega nada, abre un diagnóstico guiado (app sin publicar, `messages` sin suscribir,
  app sin suscribir a la cuenta, dirección o token incorrectos, HTTPS o firma) y marca lo que la app puede
  comprobar por sí misma.
- [WA-25] Paso 5: agente activo, IA encendida o apagada y modo pruebas «solo a estos números», activado por
  defecto.
- [WA-26] Cada número tiene un panel con semáforos (verde, ámbar o rojo, con explicación): token, registro,
  suscripción, avisos, último mensaje, calidad, nombre, límite de mensajes y versión de la API.
- [WA-27] Botones del panel: Revalidar, Cambiar token (el nuevo solo sustituye al anterior si se valida), Pausar
  IA y Desconectar.
- [WA-28] «Desconectar» borra las credenciales y, si se confirma, también quita la suscripción de la app y da de
  baja el número en Meta.
- [WA-29] La app revisa cada número cada 6 horas y con los avisos de cuenta, calidad y nombre que envía Meta; si
  algo empeora, lo muestra en el panel y avisa al propietario y a los administradores.
- [WA-30] El panel y la guía muestran los límites de Meta:
  - El límite de mensajes es del portfolio del negocio, compartido entre todos sus números: cuenta los
    destinatarios distintos a los que el negocio escribe fuera de la ventana de atención en 24 h (responder
    dentro de la ventana no cuenta). Empieza en 250 y sube a 2.000 (al verificar la empresa o al llegar a 2.000
    con buena calidad), 10.000, 100.000 e ilimitado.
  - Sin verificar la empresa, 2 números por portfolio como máximo (20 al verificarla o al llegar a 2.000), y
    el nombre solo en el perfil, no en la cabecera del chat, hasta que se aprueba.
  - 15 apps de Meta como máximo por persona sin empresa verificada.
  - Desde el 15-01-2026, prohibidos los asistentes de IA de propósito general.
- [WA-31] Cuando Meta verifica la dirección de avisos con el token correcto, la app le devuelve el código que
  pide; con un token incorrecto, la rechaza.
- [WA-32] Cuando llega un aviso de WhatsApp con la firma incorrecta o sin firma, la app lo rechaza (401) y no
  guarda nada. La firma se comprueba con el App Secret del canal al que va el aviso.
- [WA-33] El canal de cada aviso se reconoce por el número de destino; los avisos de cuenta y de plantillas, por
  la cuenta de WhatsApp Business.
- [WA-34] Un aviso para un número que no es de ningún canal se contesta como recibido y no se guarda su contenido;
  Diagnóstico anota solo la hora y el número.
- [WA-35] Con la firma correcta, la app guarda el aviso, descarta los mensajes repetidos (Meta reintenta durante
  días y a veces duplica) y contesta al momento. Acepta avisos de hasta 3 MB.
- [WA-36] Se muestran en la bandeja: texto, audio y notas de voz, imagen, documento, vídeo, sticker, ubicación,
  contactos, respuestas a botones y listas, y reacciones. Cualquier otro tipo aparece como mensaje del sistema
  «Tipo de mensaje no admitido».
- [WA-37] Una reacción se muestra sobre el mensaje al que reacciona y no genera respuesta de la IA. Si llega una
  reacción sin emoji, el cliente la ha quitado: deja de verse en ese mensaje.
- [WA-38] Los avisos de estado (enviado, entregado, leído, reproducido y fallido) actualizan el mensaje.
  «Reproducido» es la primera escucha de una nota de voz enviada por el negocio (Meta lo envía desde el
  17-03-2026). Los estados solo avanzan: el orden de llegada no está garantizado, «entregado» puede no llegar
  y uno anterior que llega tarde (un «entregado» después de «leído») no cambia nada; «fallido» solo sustituye a
  «en cola» o «enviado». Un fallo muestra su error en español. Del primer `pricing` que llega se guardan su
  tipo (`type`: si se cobra o es gratis) y su categoría (`category`); `billable` no se usa porque Meta lo va a
  retirar.
- [WA-39] El cliente se reconoce por su identificador de WhatsApp para el negocio (BSUID, que llega desde abril de
  2026) y por su `wa_id` si llega; el teléfono puede faltar. Un contacto que solo tiene BSUID se crea y se le
  puede responder. Quien ha activado su nombre de usuario de WhatsApp puede llegar sin teléfono ni `wa_id`: se
  le responde por su BSUID.
- [WA-40] Cuando un mensaje trae BSUID y `wa_id` de un contacto que ya existía con uno de los dos, se añade el
  otro al mismo contacto, sin duplicarlo.
- [WA-41] Los archivos (audio, imagen, documento, vídeo) se descargan de Meta en cuanto llegan, porque su enlace
  dura minutos, y se guardan en privado; los audios pasan a transcripción. Si la descarga falla, se reintenta; si
  no se consigue, el mensaje dice «No se pudo descargar el archivo».
- [WA-42] Se envían texto, imágenes, documentos, audio y plantillas; los mensajes interactivos (botones y
  listas) son opcionales.
- [WA-43] La ventana de 24 h se cuenta desde el último mensaje del cliente. Fuera de ella la IA no escribe y la
  bandeja solo deja enviar una plantilla aprobada, con sus variables.
- [WA-44] La IA envía una sola respuesta por turno del cliente, nunca varios mensajes seguidos: desde el
  1-10-2026 Meta cobra cada mensaje de servicio a la tarifa de utilidad del país.
- [WA-45] Mientras la IA prepara la respuesta, el cliente ve «escribiendo…» y su mensaje como leído, si la API lo
  permite.
- [WA-46] Si un envío falla por un error pasajero, se reintenta con esperas crecientes; si el error es permanente,
  el mensaje queda como fallido, se avisa al equipo y, si el canal lo tiene activado, la conversación pasa a una
  persona.
- [WA-47] Coste estimado de cada mensaje enviado, con el `pricing` del estado ([WA-38]): si su tipo es `regular`
  (se cobra), la tarifa de Ajustes para el mercado del destinatario y esa categoría ([AJU-09]); si es gratuito
  (cualquier tipo que empieza por `free_`, como los 1.000 mensajes de servicio al mes por número), 0. La app no
  cuenta los mensajes gratis: Meta ya lo indica en cada estado, y descontarlos aparte los restaría dos veces. El
  mercado sale del prefijo del teléfono o, sin teléfono, del país del BSUID. Sin tarifa para ese mercado, no se
  estima y el informe lo señala. Desde el 1-10-2026 las plantillas de utilidad enviadas dentro de la ventana de
  24 h también se cobran, sin tramo gratuito ([AGD-24]).
- [WA-48] Con varios números, cada uno es un canal con su agente, su modo pruebas y su panel, y todos usan la
  misma dirección de avisos. Los números de un mismo portfolio comparten el límite de mensajes, y el panel de
  cada uno lo dice ([WA-30]).
- [WA-49] Todas las llamadas a Meta de un canal usan la versión de la API guardada en él; cambiarla obliga a
  revalidar.
- [WA-50] Cuando llega un aviso de cambio de identidad (el cliente cambió de número, `user_changed_number`, o
  solo cambió su BSUID, `user_changed_user_id`), la app busca la identidad por el BSUID anterior
  (`previous_user_id`) y la cambia al nuevo, y al `wa_id` nuevo si llega, en el mismo contacto. No crea un
  contacto nuevo, deja una nota del sistema en la conversación y la IA no responde.
- [WA-51] Si un número empieza a tener envíos fallidos con el error de método de pago (131042), o le fallan los
  mensajes de servicio después de haber entregado ese mes los 1.000 gratis (según el tipo de precio que marca
  Meta), el panel avisa «Puede que falte el método de pago en Meta», con enlace al Centro de facturación, y
  avisa al propietario y a los administradores. Esa cuenta de mensajes gratis solo sirve para este aviso,
  nunca para el coste ([WA-47]).

### Correo

Detalles en `docs/integracion-correo.md`.

- [COR-01] Canales > Añadir > Correo ofrece Gmail, Outlook / Microsoft 365 u Otro (IMAP/SMTP).
- [COR-02] Gmail: pantalla con la dirección de redirección para copiar, Client ID, Client Secret y «Conectar con
  Google». La guía explica el proyecto de Google Cloud del negocio: «Internal» si tiene Workspace; con @gmail.com,
  «External» publicado «En producción» sin verificar (Google avisa «Google no ha verificado esta app»; máximo 100
  usuarios). Nunca «Testing», porque el acceso caduca a los 7 días.
- [COR-03] Al volver de Google, la app comprueba los permisos concedidos (leer y modificar el correo, y el email
  de la cuenta); si falta alguno, lo dice y no conecta.
- [COR-04] Gmail tiene el enlace «¿Prefieres contraseña de aplicación? Usa Otro».
- [COR-05] Gmail, recepción: en cada ronda de trabajo en segundo plano, la app pide los cambios desde la última
  vez; si Gmail responde que ese punto ya no existe, sincroniza todo de nuevo sin duplicar.
- [COR-06] Gmail, envío: la respuesta sale en el mismo hilo, con el mismo asunto y las cabeceras de respuesta, y
  el correo contestado recibe la etiqueta «IA/Respondido».
- [COR-07] Outlook: pantalla con Client ID, Client Secret, fecha de caducidad del Client Secret (Microsoft lo
  hace durar 24 meses como máximo), Tenant ID (`common` o el del negocio), dirección de redirección y «Conectar
  con Microsoft», que pide los permisos Mail.ReadWrite, Mail.Send, offline_access y User.Read. Si Microsoft exige
  el consentimiento de un administrador, la app muestra el enlace para darlo.
- [COR-08] Outlook: en cada ronda, la app pide los cambios de la bandeja de entrada; responde al mensaje (en modo
  borrador, crea el borrador de respuesta) y sigue el hilo por la conversación de Outlook.
- [COR-09] Outlook solo se conecta por la API de Microsoft: si en «Otro» se pone un correo de Outlook o Microsoft
  365, la app avisa y propone la opción Outlook (Microsoft ya no admite IMAP/POP con contraseña y desactiva por
  defecto el envío SMTP con contraseña a finales de 2026).
- [COR-10] Otro: email, usuario, contraseña (o de aplicación) y servidores IMAP y SMTP con puerto y seguridad, que
  se rellenan solos según el dominio (Gmail, Yahoo, iCloud, Zoho de pago, IONOS, Hostinger, OVH, cPanel…) y se
  pueden cambiar.
- [COR-11] «Probar conexión» comprueba la entrada (IMAP) y el envío (SMTP) y dice en español qué falla; si falla,
  el canal no queda conectado.
- [COR-12] Otro, recepción: en cada ronda la app trae los correos nuevos; si el servidor renumera la carpeta,
  vuelve a sincronizar sin duplicar.
- [COR-13] Otro, envío: lo enviado se guarda en «Enviados» si el servidor no lo hace solo (Gmail sí lo hace); las
  carpetas se reconocen por su función, no por su nombre.
- [COR-14] En «Borrador para revisar» (por defecto), la respuesta de la IA aparece como borrador en la bandeja y
  en la carpeta de borradores del buzón; una persona la aprueba, la edita o la descarta. En «Automático», sale
  directamente.
- [COR-15] Cuando una persona aprueba un borrador, sale en el mismo hilo y el borrador del buzón desaparece.
- [COR-16] Se ignoran (no crean conversación ni respuesta, y Diagnóstico los cuenta con su motivo): respuestas
  automáticas, envíos masivos o de listas, boletines con enlace de baja, remitentes «noreply» o «mailer-daemon»,
  rebotes, los enviados por el propio buzón, spam y promociones. Las promociones solo se filtran en Gmail (su
  categoría «Promociones»): Outlook no tiene esa categoría y su clasificación «Otros» mide relevancia, así que
  nunca es el único filtro. En Outlook e IMAP se ignoran el correo no deseado y lo que marcan las cabeceras.
- [COR-17] Tope diario de respuestas de la IA por hilo y por remitente (5 y 10 por defecto, editables); al
  llegar, la IA deja de contestar ese día y la conversación espera a una persona.
- [COR-18] En modo «Automático», lo que envía la IA lleva la marca de respuesta automática
  (`Auto-Submitted: auto-replied`) en Gmail e IMAP; en Outlook, solo si se comprueba que la vía MIME la
  conserva, porque Microsoft Graph solo deja añadir cabeceras propias que empiezan por `x-`. Un borrador que una
  persona aprueba o edita no la lleva: la norma de respuestas automáticas (RFC 3834) la prohíbe en mensajes que
  envía una persona. Todo lo que sale de la app lleva una cabecera propia (`X-DominIA-…`), y los correos que
  llegan con ella se ignoran siempre, para evitar bucles. El asunto nunca lleva el prefijo «Auto:», porque
  Gmail necesita el mismo asunto para mantener el hilo.
- [COR-19] Antes de pasar un correo a la IA, la app lo convierte de HTML a texto, quita las citas y firmas
  anteriores y respeta su juego de caracteres; los PDF e imágenes adjuntos van al modelo y los audios a
  transcripción. Los adjuntos por encima del límite de tamaño se guardan pero no van a la IA, y se indica.
- [COR-20] Cuando una persona responde al hilo desde su propio programa de correo, la IA se pausa en esa
  conversación ([BAN-11]).
- [COR-21] Los correos de la IA llevan saludo y una firma con el aviso de IA.
- [COR-22] Cuando el acceso caduca, se revoca o la contraseña cambia, el canal pasa a «Requiere reconexión», avisa
  al propietario y a los administradores y ofrece reconectar sin perder nada. En Outlook, la app avisa 30 días
  antes de la fecha de caducidad del Client Secret ([COR-07]); cuando caduca, Microsoft rechaza el acceso
  (`AADSTS7000222`) y el canal pasa a «Requiere reconexión» hasta que se pone uno nuevo.
- [COR-23] Cuando la vuelta de Google o Microsoft no corresponde a una conexión iniciada desde la app, o trae un
  error, no se guarda nada y se muestra el motivo.
- [COR-24] Las apps de Google y Microsoft son del propio negocio; nunca se comparten entre negocios.

### Chat web

- [WEB-01] Cada chat web da su código para pegar en la web del negocio,
  `<script src="https://{dominio}/widget.js" data-channel="{id}" async></script>`, con botón de copiar.
- [WEB-02] Se configuran color, logo, mensaje de bienvenida, posición (izquierda o derecha) y textos legales, con
  vista previa.
- [WEB-03] El chat se usa con teclado y lector de pantalla, y se adapta al móvil.
- [WEB-04] El visitante es anónimo: su navegador guarda un identificador y, si vuelve con el mismo navegador, ve su
  conversación. Si borra los datos del navegador, empieza una nueva.
- [WEB-05] Los datos personales (nombre, teléfono o email) solo se piden cuando hacen falta, por ejemplo para
  reservar, y se guardan en su contacto.
- [WEB-06] Las respuestas aparecen sin recargar, en pocos segundos.
- [WEB-07] Las notas de voz (que se transcriben) y las imágenes son opcionales en cada chat: si están
  desactivadas, sus botones no aparecen y la app rechaza esos archivos.
- [WEB-08] Hay límite de mensajes por IP y por visitante: al pasarlo, el chat dice «Demasiados mensajes, espera
  un momento» y no guarda el mensaje.
- [WEB-09] Los textos y archivos que superan el tamaño máximo se rechazan con un aviso.
- [WEB-10] El chat solo funciona en los dominios permitidos de la lista; con la lista vacía, solo en la propia
  app (`/widget-demo`).
- [WEB-11] Un visitante solo puede leer su propia conversación; con el identificador de otro, la app no devuelve
  nada.
- [WEB-12] `/widget-demo` muestra una web de ejemplo del negocio con el chat web de la demo funcionando.
- [WEB-13] Si el canal está desactivado, el chat dice que no está disponible.

### Telegram (opcional)

Se construye después de la fase 7 (ver «Fases»); sus reglas quedan escritas para entonces. Detalles en
`docs/integracion-telegram.md`.

- [TG-01] Canales > Añadir > Telegram pide el token del bot, lo valida y configura sola la dirección de avisos con
  un secreto.
- [TG-02] Un aviso de Telegram sin el secreto correcto se rechaza y no se guarda nada.
- [TG-03] Recibe texto, notas de voz (que se transcriben) e imágenes, y responde con texto.
- [TG-04] «Desconectar» quita la dirección de avisos en Telegram y borra el token.

### Agentes

- [AGE-01] Agentes muestra cada agente con su nombre, avatar, modelo y los canales donde está activo.
- [AGE-02] Un agente se crea desde la plantilla de un sector o en blanco; hay plantilla para cada sector.
- [AGE-03] El editor tiene: General (nombre, descripción, avatar, idioma y tono), Instrucciones, Modelo,
  Conocimiento, Herramientas, Traspaso, Canales, Probar y Versiones.
- [AGE-04] Las instrucciones son guiadas: rol, información del negocio, qué puede y qué no, estilo y cuándo pasar a
  una persona.
- [AGE-05] «Generar borrador con IA» propone instrucciones a partir de la web del negocio o de una descripción; el
  borrador se puede editar y no se guarda hasta pulsar Guardar.
- [AGE-06] «Vista previa del prompt» enseña el texto completo que recibirá el modelo, en el orden de [MOT-07].
- [AGE-07] Conocimiento: archivos de contexto, bases de conocimiento y modo «Automático» (busca cuando lo
  necesita) o «Buscar siempre» (busca antes de cada respuesta).
- [AGE-08] Herramientas: se activan o desactivan las del sistema y las HTTP personalizadas ([HER-11]).
- [AGE-09] Traspaso: palabras clave, número de «no lo sé» antes de pasar a una persona, temas sensibles, mensajes
  al cliente dentro y fuera de horario, y a quién avisar.
- [AGE-10] Canales: lista de canales con el interruptor «Activo aquí»; si el canal ya tiene otro agente activo,
  pide confirmación («Sustituirá a …»).
- [AGE-11] Un agente puede estar activo en varios canales a la vez.
- [AGE-12] Cada vez que se guarda un agente se crea una versión (quién y cuándo); desde Versiones se recupera una
  anterior, que se guarda como versión nueva.
- [AGE-13] Cuando se borra un agente activo en algún canal, la app pide confirmación y esos canales se quedan sin
  agente; los mensajes antiguos conservan su nombre.
- [AGE-14] En una conversación se puede elegir otro agente solo para ella; desde entonces responde ese.
- [AGE-15] Un agente sin nombre o con datos incorrectos no se guarda y se explica el error.
- [AGE-16] Un agente se puede duplicar: la copia sale con todos sus ajustes, sin canales asignados y con su propia
  primera versión.
- [AGE-17] Además de las instrucciones guiadas, un apartado «Otras instrucciones» admite texto libre que va al
  agente junto con el resto.

### Modelos de IA

Detalles en `docs/integracion-openrouter.md`.

- [MOD-01] La lista de modelos sale de OpenRouter con la clave del negocio, respetando su configuración de
  privacidad (si falla, se usa la lista general). Se guarda 12 horas y tiene botón «Actualizar».
- [MOD-02] Solo aparecen modelos que admiten herramientas. Se excluyen los gratuitos o marcados «solo pruebas»,
  los de procesamiento por lotes, los alias que cambian de modelo, los que tienen precios negativos y los que
  tienen fecha de retirada.
- [MOD-03] Cada modelo muestra nombre, proveedor, precio de entrada y de salida por millón de tokens en USD,
  tamaño de contexto e iconos de si admite imagen, PDF y audio.
- [MOD-04] Hay buscador y una lista de recomendados que se puede editar.
- [MOD-05] Al guardar un agente se comprueba que su modelo existe y admite herramientas, y se elige un modelo de
  respaldo de otro proveedor; si el principal falla, responde el de respaldo.
- [MOD-06] Cuando un modelo en uso anuncia fecha de retirada o desaparece de la lista, la app lo avisa en el
  agente y al propietario y a los administradores.
- [MOD-07] Por agente se ajustan temperatura, razonamiento (bajo por defecto, porque muchos modelos razonan de
  serie y tardan) y longitud máxima de la respuesta.
- [MOD-08] Sin clave, la lista no se carga y se ve el aviso de [ARR-14].

### Motor de respuesta

- [MOT-01] Cuando llega un mensaje que la IA debe atender, la respuesta se programa para unos segundos después
  (4–8 s); si llegan más mensajes en ese tiempo, espera de nuevo, hasta 20 s desde el primero, y contesta a todos
  con una sola respuesta.
- [MOT-02] Nunca se preparan dos respuestas a la vez para la misma conversación. Si llega un mensaje nuevo antes
  de enviar la respuesta en preparación, esa respuesta se descarta y se prepara otra que lo incluye.
- [MOT-03] Antes de responder, la app comprueba que el canal tiene agente activo y la IA encendida, que la
  conversación está en modo IA y sin pausa, el modo pruebas, la ventana de 24 h de WhatsApp, que el contacto no
  se ha dado de baja, el horario y que hay clave de OpenRouter. Si algo falla, la IA no responde y el mensaje
  espera a una persona.
- [MOT-04] Prepara la entrada: transcribe los audios y describe las imágenes si el modelo no las admite
  ([MED-01], [MED-05]).
- [MOT-05] Reglas de la plataforma, que van antes que cualquier instrucción del agente: solo temas del negocio (lo
  demás se redirige con amabilidad); no inventar precios, horarios, disponibilidad ni políticas, sino usar
  herramientas y conocimiento, y si no se sabe, decirlo y ofrecer una persona; confirmar con el cliente antes de
  crear, cambiar o cancelar una cita; aviso de IA en el primer mensaje; no pedir tarjetas, contraseñas ni
  documentos de identidad; si piden una persona, traspasar; breve en WhatsApp y chat web, con saludo y firma en
  correo.
- [MOT-06] Las instrucciones de un agente no pueden quitar las reglas de la plataforma: siempre van delante en el
  prompt.
- [MOT-07] El prompt se monta de lo estable a lo variable, para aprovechar la caché del modelo: reglas, perfil del
  negocio (datos, horario y servicios), instrucciones, archivos de contexto, datos del momento (fecha y hora en la
  zona del negocio, canal, contacto y resumen) y los últimos mensajes (los audios, como texto).
- [MOT-08] La llamada a OpenRouter va sin respuesta por partes, con la conversación como sesión, prohibiendo a
  los proveedores guardar o usar los datos, con «Sin retención de datos» si está activado y con hasta 6 pasos de
  herramientas.
- [MOT-09] Si tras el sexto paso no hay respuesta final, la app no envía nada a medias: pasa la conversación a una
  persona.
- [MOT-10] Se envía una sola respuesta, nunca troceada en varios mensajes.
- [MOT-11] Cada respuesta queda registrada (modelo pedido y usado, tokens, coste que indica OpenRouter, tiempo,
  herramientas usadas y error si lo hubo) y la pantalla se actualiza.
- [MOT-12] Si la IA falla (tiempo agotado, fallan el modelo principal y el de respaldo, o no queda saldo), se
  reintenta una vez; si vuelve a fallar, el cliente no recibe nada, la conversación queda para una persona con el
  aviso «La IA no ha podido responder» y el error aparece en Diagnóstico.
- [MOT-13] En conversaciones largas, la app mantiene un resumen acumulado que sustituye a los mensajes antiguos.
- [MOT-14] En modo «Borrador para revisar», la respuesta se guarda como borrador en vez de enviarse.
- [MOT-15] El trabajo en segundo plano (respuestas, correo, conocimiento, recordatorios y revisiones) avanza a
  trozos cortos. Se lanza al contestar cada aviso y desde la dirección del cron (que, publicada la app, llama un
  servicio externo cada minuto); en local, `pnpm dev` lo lanza cada unos 15 s sin configurar nada, y `pnpm worker`
  lo ejecuta en bucle.
- [MOT-16] Una tarea que falla se reintenta con esperas crecientes; tras varios intentos queda como fallida y se
  ve en Diagnóstico. Si dos rondas coinciden, cada tarea se hace una sola vez.

### Audio, imágenes y documentos

- [MED-01] Los audios se transcriben con el modelo elegido en Ajustes (por defecto, uno barato y bueno en
  español), en español y con 60 s de espera como máximo; se guarda su coste. La transcripción no admite la
  prohibición de guardar datos en cada petición, así que su privacidad depende del modelo: el de por defecto
  (`openai/whisper-large-v3-turbo`) solo tiene proveedores sin retención de datos ([CUM-10], [AJU-04]).
- [MED-02] Las notas de voz de WhatsApp se envían tal cual; si el modelo las rechaza, se convierten a MP3 y, si aun
  así falla, se prueba el modelo de respaldo, solo si todos sus proveedores están en la lista sin retención de
  datos de OpenRouter ([CUM-10]).
- [MED-03] Si un audio no se puede transcribir o pasa de 25 MB, se indica «No se pudo transcribir» y la IA pide al
  cliente que lo escriba.
- [MED-04] La transcripción se guarda y se ve bajo el reproductor en la bandeja; el agente recibe el texto.
- [MED-05] Las imágenes van al modelo si las admite; si no, un modelo de visión barato las describe y el agente
  recibe la descripción.
- [MED-06] Los PDF van al modelo como texto extraído o como archivo, según lo que admita el modelo.
- [MED-07] Otros archivos (vídeo, sticker, hojas de cálculo…) se guardan y se ven en la bandeja; el agente solo
  sabe que ha llegado un archivo de ese tipo.
- [MED-08] Los archivos solo se abren desde la app, con sesión y permiso sobre esa conversación; un enlace a un
  archivo sin sesión no funciona.

### Herramientas del agente

- [HER-01] Herramientas del sistema: `buscar_conocimiento(consulta)`, `listar_servicios()`,
  `consultar_disponibilidad(servicio, desde, hasta, profesional?, personas?)`, `crear_cita(servicio, inicio,
  profesional?, personas?, nombre, telefono?, email?, notas?)`, `ver_citas_del_cliente()`,
  `cancelar_cita(cita_id, motivo?)`, `reprogramar_cita(cita_id, nuevo_inicio)`, `guardar_datos_contacto(...)` y
  `transferir_a_humano(motivo, resumen, urgencia)`.
- [HER-02] Cada herramienta comprueba sus datos; si son incorrectos, devuelve un error al modelo y no cambia nada.
- [HER-03] Las herramientas devuelven respuestas cortas, y cada uso queda en el registro de actividad.
- [HER-04] Las herramientas solo actúan sobre el contacto de la conversación: no pueden ver, cancelar ni cambiar
  citas de otro contacto.
- [HER-05] `consultar_disponibilidad` devuelve huecos reales del motor de la agenda ([AGD-08]).
- [HER-06] `crear_cita` y `reprogramar_cita` vuelven a comprobar el hueco al guardar; si ya no está libre,
  devuelven el error y otros huecos.
- [HER-07] `guardar_datos_contacto` guarda nombre, teléfono, email y notas en el contacto de la conversación.
- [HER-08] `transferir_a_humano` hace el traspaso de [TRA-01] con su motivo, resumen y urgencia.
- [HER-09] Lo que escriben los clientes, sus archivos y las webs son datos, no órdenes: un mensaje que diga
  «ignora tus instrucciones» no cambia las reglas ni da acceso a otros datos.
- [HER-10] En la fase 1 el agente solo tiene la herramienta de traspaso; las demás llegan con su fase.
- [HER-11] Herramientas HTTP personalizadas (para n8n, un CRM, etc.): se definen en la pantalla con nombre,
  descripción, parámetros, método, dirección, cabeceras secretas y tiempo máximo.
- [HER-12] Las cabeceras secretas se guardan cifradas y nunca se muestran enteras; los errores de la herramienta
  llegan al modelo sin ellas.
- [HER-13] Una herramienta HTTP que pasa de su tiempo máximo se corta y devuelve error; su respuesta se recorta a
  un tamaño compacto.
- [HER-14] Una herramienta HTTP solo puede llamar a direcciones públicas con HTTPS, nunca a la red interna del
  servidor.

### Probar agente

- [PRU-01] «Probar» es un chat con el agente, con su configuración guardada y sin canales reales.
- [PRU-02] En cada respuesta muestra las herramientas usadas (con sus datos y su resultado), los fragmentos de
  conocimiento con su puntuación y su fuente, los tokens, el coste y el tiempo.
- [PRU-03] «Simular canal» cambia entre WhatsApp, correo y web, y el agente responde con el estilo y las reglas de
  ese canal.
- [PRU-04] Las citas creadas al probar quedan marcadas «Prueba» en la agenda y se pueden borrar todas de una vez.
- [PRU-05] Las conversaciones de prueba no aparecen en la bandeja ni cuentan en los informes.
- [PRU-06] «Empezar de nuevo» borra la conversación de prueba.
- [PRU-07] Sin clave, se ve el aviso de [ARR-14] y no se puede enviar.

### Conocimiento

Detalles en `docs/busqueda-hibrida.md` y, para los PDF escaneados, en `docs/integracion-mistral-ocr.md`.

- [CON-01] Nivel 1, archivos de contexto de un agente: se sube un PDF, DOCX, TXT o MD, o se pega texto, y se
  convierte en Markdown editable que va entero en el prompt del agente.
- [CON-02] Cada agente tiene un tope de 30.000 tokens de archivos de contexto: al acercarse, la app avisa del
  coste por mensaje y sugiere pasarlo a una base de conocimiento; por encima del tope, no se guarda.
- [CON-03] Nivel 2, bases de conocimiento: se reutilizan entre agentes y un agente puede usar varias; solo se busca
  en las del agente.
- [CON-04] Las bases admiten archivos PDF, DOCX, XLSX, CSV, TXT y MD, páginas web (con mapa del sitio opcional) y
  preguntas frecuentes escritas en la pantalla. Otro tipo de archivo, o uno demasiado grande, se rechaza con aviso.
- [CON-05] Cada documento muestra su estado: en cola, extrayendo, troceando, embeddings, listo o error (con
  motivo). El trabajo se hace en segundo plano y por pasos.
- [CON-06] El texto se extrae a Markdown conservando las páginas.
- [CON-07] Un PDF escaneado (sin texto) se lee con Mistral OCR si hay clave; si no, queda con el aviso «PDF
  escaneado: añade la clave de Mistral OCR».
- [CON-08] Las hojas de cálculo se parten en bloques de unas 20 filas, con las cabeceras repetidas en cada uno.
- [CON-09] Las páginas web guardan su fecha y una huella del contenido; con el refresco activado, se vuelven a leer
  y, si cambiaron, se reprocesan.
- [CON-10] Los fragmentos se cortan por encabezados, de unos 400 tokens (entre 150 y 600) y 60 de solape, sin
  partir filas de tabla, con título, sección y página, el prefijo «Documento: título > sección» y un resumen del
  documento en 2 frases.
- [CON-11] Los embeddings se calculan por lotes con el modelo de la base (por defecto
  `openai/text-embedding-3-small`, de 1536 dimensiones); si un modelo devuelve otro tamaño, se rechaza con un
  error claro.
- [CON-12] Sin clave, los documentos se extraen y se trocean y ya se encuentran por texto; los embeddings quedan
  pendientes y se calculan al poner la clave.
- [CON-13] Cada base guarda su modelo y sus dimensiones; cambiarlos obliga a reprocesarla. Mientras se reprocesa,
  se sigue buscando en el índice anterior hasta que el nuevo está completo.
- [CON-14] Si se sube a una base un archivo idéntico a otro que ya tiene, la app avisa y no lo duplica.
- [CON-15] Borrar un documento borra sus fragmentos y su archivo.
- [CON-16] La búsqueda combina significado y palabras (40 resultados de cada una; basta con que aparezca alguna de
  las palabras), los mezcla y devuelve los 8 mejores (6 si está activada la reordenación de [AJU-04]). Si la
  reordenación falla, devuelve los 8 sin reordenar.
- [CON-17] La búsqueda por palabras no distingue mayúsculas ni tildes: «depilacion» encuentra «depilación».
- [CON-18] Si nada es relevante, la herramienta devuelve «SIN_RESULTADOS»; el agente dice que no lo sabe y ofrece
  una persona.
- [CON-19] La respuesta de la búsqueda ocupa como máximo unos 3.500 tokens, en fragmentos numerados con título,
  página y sección, y nunca incluye los embeddings.
- [CON-20] Se guardan los fragmentos usados en cada respuesta; en la bandeja, «¿Por qué respondió esto?» los
  muestra.
- [CON-21] «Probar búsqueda» busca sin usar el modelo de chat y enseña los fragmentos con su puntuación y su
  fuente.
- [CON-22] «Convertir en FAQ», desde una respuesta de una persona en la bandeja, crea una pregunta frecuente
  (pregunta del cliente y respuesta de la persona) que se puede editar antes de guardarla en la base elegida.
- [CON-23] Un PDF de más de 100 páginas se procesa entero y el agente responde un dato de él citando la fuente.

### Agenda

- [AGD-01] La terminología se configura: Cita o Reserva; Profesional, Mesa, Sala o Box; Cliente, Paciente o
  Comensal. La app y el agente usan esas palabras.
- [AGD-02] Recursos: tipo (persona, sala o box, mesa o zona, equipo), nombre, color, activo, capacidad (1, o N
  para mesas, aforo o clases), servicios que atiende, horario semanal con varios tramos por día y ausencias.
- [AGD-03] Un recurso inactivo no acepta citas nuevas; las que tenía se mantienen.
- [AGD-04] Servicios: nombre, categoría, duración, márgenes antes y después, precio orientativo (opcional),
  descripción para el agente, recursos que lo hacen, personas mínimas y máximas, antelación mínima y máxima y
  «Requiere confirmación manual».
- [AGD-05] El horario del negocio y los festivos limitan todo: no hay huecos fuera de ellos aunque el recurso
  tenga horario.
- [AGD-06] Modos: por recurso individual (capacidad 1: peluquería, clínica, fisioterapia, taller) y por aforo
  (capacidad N: restaurante por mesas, o por aforo total con duración de mesa, por ejemplo 90 min, y tamaño de
  grupo; y clases).
- [AGD-07] Los servicios que necesitan dos recursos a la vez (profesional y sala) quedan preparados, pero no se
  ofrecen.
- [AGD-08] Dado un servicio, un rango de fechas, un recurso (o cualquiera) y el número de personas, la app
  devuelve los huecos libres cada cierto intervalo configurable (por ejemplo, 15 min).
- [AGD-09] Los huecos respetan horarios, ausencias, bloqueos, citas pendientes y confirmadas (las canceladas y los
  no presentados liberan el hueco), márgenes, antelación mínima y máxima y la zona horaria del negocio.
- [AGD-10] Los días de cambio de hora, los huecos y las citas salen a su hora local correcta: ninguna hora se
  pierde ni se duplica.
- [AGD-11] En modo aforo, un hueco está libre mientras la suma de personas no supera la capacidad; un grupo fuera
  del mínimo y el máximo del servicio, o mayor que la capacidad, no tiene huecos.
- [AGD-12] Con «cualquiera», un hueco está libre si lo está algún recurso que hace el servicio, y al reservar se
  asigna uno de ellos.
- [AGD-13] No hay dobles reservas: si dos reservas piden a la vez el último hueco, solo entra una y la otra recibe
  «Ese hueco ya no está libre» con alternativas.
- [AGD-14] Cada cita guarda contacto, servicio, recurso, inicio y fin, personas, estado (pendiente, confirmada,
  cancelada, completada o no presentado), origen (IA con su canal, persona o web), notas y autor.
- [AGD-15] Cada cambio de una cita queda en su historial: quién, qué y cuándo.
- [AGD-16] Vistas de día, semana, mes y por recurso (en columnas), con filtros por recurso, servicio y estado.
- [AGD-17] Las citas se crean, se editan y se mueven arrastrando; si el destino no está libre, la app lo rechaza y
  la cita vuelve a su sitio. Las personas siguen las mismas reglas de disponibilidad que la IA.
- [AGD-18] Se pueden bloquear huecos, que dejan de estar disponibles.
- [AGD-19] La ficha de la cita enlaza a su conversación y a su contacto.
- [AGD-20] Hay pantallas de configuración de servicios, recursos, horarios, ausencias y recordatorios.
- [AGD-21] El agente ofrece 2 o 3 huecos concretos y confirma con el cliente antes de reservar.
- [AGD-22] Si el servicio requiere confirmación manual, la cita se crea pendiente, el agente se lo dice al
  cliente y el equipo recibe un aviso.
- [AGD-23] Cuando la IA crea, cambia o cancela una cita, lo confirma en el momento por el mismo canal.
- [AGD-24] Recordatorio configurable (por ejemplo, 24 h antes), desactivado por defecto: por WhatsApp con una
  plantilla de utilidad aprobada y sus variables asignadas en la configuración, o por email. Esa plantilla se
  cobra: desde el 1-10-2026, también cuando se envía dentro de la ventana de 24 h, y sin tramo gratuito
  ([WA-47]).
- [AGD-25] El recordatorio se envía una sola vez; no se envía si la cita está cancelada ni al contacto dado de
  baja en ese canal; si la cita se mueve, se recalcula.
- [AGD-26] El cliente puede cancelar respondiendo: la IA se lo confirma y cancela; con la IA apagada, la
  conversación espera a una persona.
- [AGD-27] Cada sector trae datos de agenda editables: Peluquería/Estética, Clínica dental, Clínica/Fisioterapia,
  Restaurante, Taller, Academia/Clases y Otro.
- [AGD-28] Las horas se ven y se escriben en la zona horaria del negocio.

### Bandeja

- [BAN-01] La bandeja reúne las conversaciones de todos los canales que el usuario puede ver.
- [BAN-02] Filtros por canal, estado, asignado, IA o persona, sin leer y etiquetas; buscador por contacto y
  texto.
- [BAN-03] Tiene contador de no leídos, y lo nuevo aparece sin recargar en 5 s como máximo.
- [BAN-04] Al abrir una conversación, se marca como leída.
- [BAN-05] Cada mensaje muestra su canal, su autor (cliente, IA con el nombre del agente, persona con su nombre o
  sistema) y su estado de entrega.
- [BAN-06] Los audios tienen reproductor y transcripción; las imágenes y los documentos se ven o se descargan.
- [BAN-07] Las respuestas de la IA muestran sus fuentes; las notas internas se distinguen a simple vista y nunca
  se envían al cliente.
- [BAN-08] En WhatsApp se ve si la ventana de 24 h está abierta y cuánto le queda; cerrada, solo se puede enviar
  una plantilla.
- [BAN-09] En correo se ve el hilo, y los borradores tienen Aprobar, Editar y Descartar.
- [BAN-10] El interruptor de IA de la conversación está siempre a la vista, con el motivo si está en pausa.
- [BAN-11] Cuando una persona escribe al cliente desde la bandeja, la IA se pausa en esa conversación 12 horas
  (editable) y vuelve sola, salvo que alguien la reactive antes. Se ve «IA en pausa hasta …».
- [BAN-12] Estados: abierta, pendiente de humano y resuelta, con persona asignada y etiquetas.
- [BAN-13] Un envío fallido muestra el error y un botón para reintentar.
- [BAN-14] Se pueden adjuntar archivos si el canal lo admite.
- [BAN-15] Se ven el resumen de la conversación y el panel del contacto ([CTO-02]).

### Traspaso

- [TRA-01] El traspaso a una persona lo lanza la IA con su herramienta, una regla del agente (palabras clave,
  varios «no lo sé» o un tema sensible) o una persona a mano.
- [TRA-02] Con el traspaso, la conversación pasa a «Pendiente de humano» y la IA deja de contestar en ella hasta
  que una persona la reactive.
- [TRA-03] El cliente recibe el mensaje de traspaso del agente, distinto dentro y fuera de horario.
- [TRA-04] La conversación se asigna por turnos entre las personas que pueden atender ese canal (nunca Solo
  lectura), o queda sin asignar, según se configure.
- [TRA-05] Se avisa en la app, por push y por email a quien diga la configuración del agente.
- [TRA-06] Se mide el tiempo hasta la primera respuesta de una persona. Si la conversación se resuelve o se
  reactiva la IA antes, el traspaso termina sin respuesta: deja de destacarse y una respuesta posterior no cuenta
  como la suya.
- [TRA-07] El motivo, el resumen y la urgencia se ven en la conversación; las urgentes se destacan en la lista.
- [TRA-08] Cuando una conversación se resuelve, vuelve al modo IA para el siguiente mensaje del cliente.
- [TRA-09] Siempre hay una vía a una persona: si el cliente la pide, se traspasa ([MOT-05], [CUM-02]).

### Contactos

- [CTO-01] Listado con buscador y filtros por etiqueta y canal; los contactos también se crean y editan a mano.
- [CTO-02] Ficha: datos, identidades (canal e identificador), etiquetas, campos personalizados, citas (con «Nueva
  cita»), consentimientos e historial de conversaciones.
- [CTO-03] Una identidad (tipo de canal más identificador) pertenece a un solo contacto.
- [CTO-04] La app señala posibles duplicados (mismo email o teléfono), pero nunca los fusiona sola.
- [CTO-05] Al fusionar dos contactos queda uno con las identidades, conversaciones, citas y consentimientos de
  ambos, y la fusión queda en el registro de actividad.
- [CTO-06] Se exporta el listado de contactos, y también todos los datos de un contacto (datos, conversaciones,
  citas y consentimientos) en un archivo.
- [CTO-07] Borrar un contacto, con confirmación, borra sus datos, mensajes y archivos, y anonimiza sus citas para
  que los informes cuadren; el registro de actividad lo anota sin datos personales.
- [CTO-08] Una baja se ve en la ficha; solo se quita si el cliente lo pide, y queda anotado quién y cuándo.

### Informes

- [INF-01] Los informes se ven por periodo (el mes actual por defecto), en la zona horaria del negocio.
- [INF-02] Conversaciones por canal.
- [INF-03] Porcentaje resuelto por la IA: conversaciones resueltas sin traspaso y sin mensajes de personas.
- [INF-04] Traspasos, con sus motivos.
- [INF-05] Tiempo hasta la primera respuesta humana: desde que el cliente pide una persona o se pasa la
  conversación a una persona (con `transferir_a_humano`, una regla del agente o a mano) hasta el primer mensaje
  de una persona en esa conversación; y porcentaje de traspasos atendidos en menos de 3 minutos ([CUM-11]).
- [INF-06] Citas creadas por la IA.
- [INF-07] Coste de IA por mes (el que indica OpenRouter) y coste estimado de WhatsApp por mes ([WA-47]).
- [INF-08] Las conversaciones de «Probar agente» no cuentan.

### PWA y avisos

Detalles en `docs/notificaciones-push.md`.

- [PWA-01] La app se puede instalar en el móvil o el ordenador del equipo, con el nombre y el logo del negocio, y
  abre en la bandeja.
- [PWA-02] La bandeja se usa con comodidad en el móvil.
- [PWA-03] Cada persona activa los avisos push en cada dispositivo y puede desactivarlos. Las claves para los
  avisos push se generan solas en la instalación.
- [PWA-04] Un aviso push dice qué pasa y con qué contacto (por ejemplo, «Traspaso: Ana»), sin el texto del
  mensaje.
- [PWA-05] Una suscripción push caducada o rechazada se borra sola.
- [PWA-06] La app tiene una lista de avisos con contador de no leídos.
- [PWA-07] Los avisos también llegan por email cuando el correo del sistema está configurado.
- [PWA-08] Las personas con rol Agente solo reciben avisos de sus canales.

### Cumplimiento

- [CUM-01] Aviso de IA en el primer mensaje de cada conversación (texto configurable por canal) y firma con aviso
  de IA en los correos. Lo exige el art. 50 del Reglamento europeo de IA desde el 2-08-2026.
- [CUM-02] Siempre hay una vía a una persona, en cualquier momento de la conversación ([TRA-09]). Lo exige la
  política de WhatsApp y, en España, la Ley 10/2025, de servicios de atención a la clientela: prohíbe atender
  solo con contestadores o medios automáticos (art. 8.1) y, si el cliente la pide por teléfono o por un medio
  electrónico, obliga a darle atención personalizada; los bots conversacionales tienen que ofrecerla en
  cualquier momento desde el inicio (art. 8.2). Se aplica a las empresas de servicios básicos (agua, gas y
  electricidad, transporte de viajeros, servicios postales, comunicaciones electrónicas y servicios
  financieros) y a las que tienen al menos
  250 trabajadores, más de 50 millones de euros de volumen de negocio anual o más de 43 millones de balance
  (art. 2); la mayoría de los negocios pequeños quedan fuera, pero la app lo cumple igual. Fuente:
  https://www.boe.es/buscar/act.php?id=BOE-A-2025-26698 (consultada el 2026-09-26).
- [CUM-03] Cuando un cliente escribe solo «BAJA» o «STOP» (sin distinguir mayúsculas ni tildes), queda dado de
  baja en ese canal: recibe una confirmación, la IA deja de contestarle y no recibe recordatorios ni plantillas por
  ese canal. Queda anotado en sus consentimientos.
- [CUM-04] Si un cliente dado de baja vuelve a escribir, su mensaje llega a la bandeja para una persona.
- [CUM-05] La conservación se configura, con borrado o anonimización cada día. Por defecto: conversaciones 12
  meses, audios 30 días después de transcribirlos, adjuntos 90 días y avisos en bruto de los canales 14 días
  (entre 7 y 30).
- [CUM-06] La limpieza diaria queda en el registro de actividad, con cuánto se borró o anonimizó.
- [CUM-07] Se pueden exportar y borrar los datos de un contacto ([CTO-06], [CTO-07]).
- [CUM-08] Las páginas legales públicas `/legal/privacidad`, `/legal/terminos` y `/legal/eliminacion-datos` se
  generan desde Ajustes con los datos del negocio y se ven sin iniciar sesión. Existen en versión básica (datos
  del negocio y textos por defecto) desde la fase 3, porque Meta pide sus direcciones para publicar la app
  ([WA-21]); en la fase 7 sus textos se editan en Ajustes > Privacidad y legal ([AJU-07]).
- [CUM-09] `docs/` incluye una plantilla de contrato de encargo del tratamiento marcada «revisar con un abogado».
- [CUM-10] En el chat, los embeddings y la reordenación, cada petición a OpenRouter prohíbe a los proveedores
  guardar o usar los datos (`data_collection: "deny"`); no se puede desactivar. La transcripción no admite esa
  opción por petición: su privacidad sale del modelo elegido. El de por defecto,
  `openai/whisper-large-v3-turbo`, solo tiene proveedores sin retención de datos, y Ajustes > IA avisa si el
  elegido tiene alguno que no lo es ([AJU-04]). La guía pide además al negocio activar la privacidad en su
  cuenta de OpenRouter ([ARR-23]). Detalles en `docs/integracion-openrouter.md` §9.
- [CUM-11] Los informes miden el tiempo de [INF-05] y el porcentaje de traspasos atendidos por una persona en
  menos de 3 minutos. La Ley 10/2025 exige a las empresas de su ámbito ([CUM-02]) que el 95 % de las
  solicitudes de atención personalizada, por teléfono o por medios electrónicos como el chat (art. 8.2), y el
  95 % de las llamadas (art. 10.3) se atiendan, de media, en menos de 3 minutos. Tienen 12 meses para
  adaptarse desde su entrada en vigor el 28-12-2025, así que se exige desde el 28-12-2026. La app no tiene
  teléfono: mide lo que llega por sus canales. Fuente: la de [CUM-02].
- [CUM-12] En sectores con datos de salud (Clínica dental y Clínica/Fisioterapia), el asistente y Ajustes avisan
  de que son datos especialmente protegidos y recomiendan activar «Sin retención de datos», acortar la
  conservación, firmar el contrato de encargo y no pedir diagnósticos por chat.
- [CUM-13] Los consentimientos (aceptación de los textos legales en el chat web, bajas y altas) se guardan con
  fecha y canal.

### Seguridad

- [SEG-01] Se guardan cifrados: tokens de Meta, App Secret y PIN; claves de OpenRouter y Mistral; credenciales
  IMAP y SMTP; accesos de Google, Microsoft y Telegram; y cabeceras de las herramientas HTTP.
- [SEG-02] Los secretos nunca llegan al navegador (como mucho, «••••1234») ni aparecen en los registros.
- [SEG-03] Si falta la clave de cifrado, la app no arranca y dice por qué; si se perdió o cambió, los secretos
  guardados se marcan como ilegibles y sus canales piden reconexión, sin romper el resto.
- [SEG-04] Cada página, acción y ruta comprueba en el servidor quién es el usuario y si puede hacerlo; una llamada
  directa sin permiso recibe un error y no cambia nada. Ocultar un botón no es la protección.
- [SEG-05] Todo lo que llega (formularios, direcciones, cabeceras, archivos y avisos) se valida en el servidor; lo
  que no es válido no se guarda.
- [SEG-06] Una acción enviada desde otra web (CSRF) se rechaza.
- [SEG-07] Hay límite de peticiones en el inicio de sesión, la recuperación de contraseña, las invitaciones, los
  avisos de los canales, el chat web y todo lo que gasta IA.
- [SEG-08] Las firmas y los secretos de WhatsApp, Telegram y el cron se comparan en tiempo constante.
- [SEG-09] La dirección del cron sin el secreto correcto responde 401 y no hace nada.
- [SEG-10] El registro de actividad anota lo que hacen las personas y la IA: entradas, cambios de rol y de
  ajustes, conexiones y desconexiones de canales, exportaciones, borrados y usos de herramientas.
- [SEG-11] Cabeceras de seguridad, cookies seguras y dependencias al día: `pnpm audit` sin fallos graves.
- [SEG-12] El HTML de los correos se limpia antes de mostrarlo y nunca ejecuta código.
- [SEG-13] Los archivos subidos se comprueban por tipo y tamaño.
- [SEG-14] El usuario solo ve mensajes de error genéricos, y los registros no guardan claves ni datos personales.

## Quién puede hacer qué

Lo que no aparece aquí no está permitido.

- [PER-01] Cada permiso se comprueba en el servidor y tiene su prueba ([SEG-04]).
- [PER-02] «Sus canales»: un usuario con rol Agente solo ve y atiende las conversaciones de los canales que tiene
  asignados, y los contactos con alguna conversación en ellos (y solo esas conversaciones). Si no tiene ningún
  canal asignado, ve todos.
- [PER-03] Solo lectura ve pero nunca cambia nada: cualquier intento se rechaza. No ve ningún secreto, ni siquiera
  enmascarado, ni el registro de actividad, ni Ajustes salvo «Mi cuenta» y «Acerca de».
- [PER-04] Supervisor no entra en Canales (solo ve el nombre de los canales en la bandeja) ni en los ajustes de
  claves, IA, usuarios o correo del sistema.
- [PER-05] Administrador no puede borrar, desactivar ni cambiar el rol o los datos del propietario, ni hacer
  propietario a nadie.
- [PER-06] Solo el propietario traspasa la propiedad ([USU-16]). Nadie cambia su propio rol, y el propietario no
  puede borrarse ni desactivarse.
- [PER-07] Solo propietario y administrador ven un secreto enmascarado («••••1234»); nadie lo ve entero.
- [PER-08] Los agentes de IA no son usuarios: solo actúan con sus herramientas y sobre el contacto de su
  conversación ([HER-04]).
- [PER-09] Sin iniciar sesión solo se puede: usar el chat web (la propia conversación), ver las páginas legales,
  abrir una invitación, recuperar la contraseña, consultar `/api/health`, usar el asistente mientras la
  instalación está vacía y enviar avisos firmados de los canales.

«Sus canales» sigue la regla [PER-02]; «Ver» es solo mirar.

| Área y acción | Propietario | Administrador | Supervisor | Agente | Solo lectura |
|---|---|---|---|---|---|
| Bandeja: ver conversaciones, mensajes, fuentes y notas | Sí | Sí | Sí | Sus canales | Ver |
| Bandeja: responder, enviar plantillas y adjuntos | Sí | Sí | Sí | Sus canales | No |
| Bandeja: aprobar, editar o descartar borradores | Sí | Sí | Sí | Sus canales | No |
| Bandeja: escribir notas internas | Sí | Sí | Sí | Sus canales | No |
| Bandeja: pausar o reanudar la IA de una conversación | Sí | Sí | Sí | Sus canales | No |
| Bandeja: traspasar a mano, cambiar estado y etiquetas | Sí | Sí | Sí | Sus canales | No |
| Bandeja: asignar a cualquier persona | Sí | Sí | Sí | No; solo tomar para sí una sin asignar de sus canales | No |
| Bandeja: elegir otro agente para una conversación | Sí | Sí | Sí | No | No |
| Bandeja: convertir una respuesta en FAQ | Sí | Sí | Sí | No | No |
| Contactos: ver fichas | Sí | Sí | Sí | Sus canales | Ver |
| Contactos: crear y editar datos, etiquetas y campos | Sí | Sí | Sí | Sus canales | No |
| Contactos: fusionar duplicados y quitar una baja | Sí | Sí | Sí | No | No |
| Contactos: exportar y borrar datos | Sí | Sí | No | No | No |
| Agenda: ver citas y disponibilidad | Sí | Sí | Sí | Sí | Ver |
| Agenda: crear, editar, mover y cancelar citas | Sí | Sí | Sí | Sí | No |
| Agenda: bloquear huecos y poner ausencias | Sí | Sí | Sí | No | No |
| Agenda: configurar servicios, recursos, horarios, terminología y recordatorios | Sí | Sí | No | No | No |
| Agenda: borrar las citas de prueba | Sí | Sí | Sí | No | No |
| Agentes: ver configuración y versiones | Sí | Sí | Ver | No | Ver |
| Agentes: crear, editar, borrar, recuperar versiones y archivos de contexto | Sí | Sí | No | No | No |
| Agentes: probar agente | Sí | Sí | Sí | No | No |
| Agentes: herramientas HTTP personalizadas | Sí | Sí | No | No | No |
| Conocimiento: ver bases y documentos | Sí | Sí | Sí | No | Ver |
| Conocimiento: crear, editar, borrar y reprocesar bases, documentos, webs y FAQ | Sí | Sí | Sí | No | No |
| Conocimiento: probar búsqueda | Sí | Sí | Sí | No | No |
| Canales: ver lista, estado y panel, sin credenciales | Sí | Sí | No | No | Ver |
| Canales: crear, conectar, configurar, desconectar y borrar; agente activo e IA del canal | Sí | Sí | No | No | No |
| Informes | Sí | Sí | Sí | No | Ver |
| Ajustes: Negocio, Horario, Privacidad y legal, Notificaciones y Tarifas | Sí | Sí | No | No | No |
| Ajustes: IA (claves y modelos) y Correo del sistema | Sí | Sí | No | No | No |
| Ajustes: Usuarios (invitar, roles, canales, desactivar, borrar y exigir 2FA) | Sí | Sí, salvo sobre el propietario | No | No | No |
| Ajustes: traspasar la propiedad | Sí | No | No | No | No |
| Ajustes: Registro de actividad | Sí | Sí | No | No | No |
| Ajustes: Diagnóstico y simulador | Sí | Sí | No | No | No |
| Mi cuenta, Acerca de y Ayuda | Sí | Sí | Sí | Sí | Sí |

## Qué datos maneja

Las tablas, sus campos y qué no se puede repetir están en `docs/modelo-de-datos.md`.

- Del negocio: nombre, datos de contacto, logo, color, sector, horario, festivos, textos legales, tarifas de
  WhatsApp y ajustes. Los escribe el equipo.
- Del equipo: nombre, email, contraseña (solo su huella, nunca en claro), verificación en dos pasos, rol, canales
  asignados, sesiones, dispositivos con avisos push y preferencias. Datos personales.
- De los clientes (contactos): nombre, teléfono, email, identificadores de cada canal (BSUID y `wa_id` de
  WhatsApp, email, visitante del chat web, Telegram), etiquetas, campos personalizados, consentimientos y bajas.
  Llegan con sus mensajes, los guarda la IA cuando el cliente los da o los escribe el equipo. Datos personales.
- Conversaciones: textos, audios y sus transcripciones, imágenes, documentos, notas internas, resúmenes, estados
  de entrega y coste estimado. Datos personales, y pueden contener cualquier cosa que el cliente escriba.
- Citas y su historial. En clínicas dentales y de fisioterapia, las citas y las conversaciones revelan datos de
  salud, que el RGPD protege especialmente: la app lo avisa y recomienda precauciones ([CUM-12]).
- Conocimiento: documentos, webs y preguntas frecuentes del negocio, con sus fragmentos y embeddings. En
  principio no son personales; la guía pide no subir datos de clientes.
- Agentes: configuración, versiones y archivos de contexto.
- Registros de funcionamiento: avisos en bruto de los canales (llevan mensajes y datos personales, por eso se
  borran pronto, [CUM-05]), uso de la IA (modelo, tokens, coste, tiempo y herramientas), fragmentos usados en cada
  respuesta, traspasos, avisos, tareas en segundo plano y registro de actividad.
- Secretos: tokens y claves de Meta, OpenRouter, Mistral, Google, Microsoft, IMAP/SMTP y Telegram, y cabeceras de
  las herramientas HTTP. Van cifrados con la clave de cifrado de la instalación: si esa clave se pierde, no se
  pueden recuperar y hay que volver a ponerlos.
- Dónde se guarda: por ahora, en el ordenador donde corre la app (la base de datos en `data/local.db` y los
  archivos en `data/uploads`). Queda preparado Turso y Vercel Blob para cuando se publique, y Supabase para el
  futuro.
- Qué sale de la app: a OpenRouter y al proveedor del modelo, el contenido que la IA necesita (mensajes,
  transcripciones, imágenes y fragmentos), prohibiendo en cada petición que lo guarden o lo usen; los audios que
  hay que transcribir, al proveedor del modelo de transcripción, que por defecto solo usa proveedores sin
  retención de datos, porque en la transcripción esa prohibición no se puede pedir ([CUM-10]); a Meta, Google,
  Microsoft o el servidor de correo, los mensajes de su canal; a Mistral OCR, los PDF escaneados si hay clave; y
  a cada herramienta HTTP personalizada, los datos que le pasa el agente. Nada más.

## Qué queda fuera

- Tech Provider, BSP y coexistencia con la app WhatsApp del móvil.
- Embedded Signup: solo queda preparado el modo de conexión; se conecta a mano.
- APIs no oficiales de WhatsApp (Baileys, Evolution, Whapi, conexión por QR).
- Instagram y Messenger.
- Multi-cliente: organizaciones, espacios de trabajo o varios negocios en una instalación.
- Supabase, Dokploy y GitHub: son el futuro y el código queda preparado para ellos.
- Respuestas con voz.
- Google Calendar e iCal.
- Evaluación automática de las respuestas y del conocimiento.
- Agente propio para fuera de horario (queda preparado).
- Servicios que usan dos recursos a la vez (quedan preparados).
- Publicar en Vercel, por ahora: la configuración y la guía quedan preparadas.

## Fases

- [x] Fase 0 · Base: estructura, base de datos con migraciones, preparación automática con demo y usuarios de
  prueba, inicio de sesión, roles e invitaciones, asistente de arranque, ajustes, cifrado de secretos, navegación
  (Bandeja, Contactos, Agenda, Agentes, Conocimiento, Canales, Informes y Ajustes), README y `CLAUDE.md`, y la
  configuración y la guía para Vercel con Turso y Blob, sin publicar — se comprueba: un clon limpio arranca con
  `pnpm install && pnpm dev` y se entra con cada usuario del README; pasan las pruebas de permisos de los cinco
  roles; `pnpm db:fresh` lleva al asistente y se completa; pasan lint, tipos, pruebas y compilación.
  Comprobado el 2026-09-26: 978 pruebas de Vitest y 53 de Playwright en verde (inicio de sesión de los cinco roles,
  permisos, invitaciones, recuperación, asistente en instalación vacía); copia limpia con `pnpm install && pnpm dev`
  arranca sola y entran los cinco usuarios; revisión independiente y de seguridad corregidas.
- [x] Fase 1 · Agentes y OpenRouter: clave, lista de modelos, editor de agentes (sin herramientas salvo el
  traspaso), plantillas por sector y «Probar agente» — se comprueba: se conversa con un agente en «Probar» viendo
  coste y tiempo (OpenRouter simulado en las pruebas y una prueba a mano con clave real); sin clave, aparece el
  aviso y el agente no responde.
  Comprobado el 2026-09-26: 1416 pruebas de Vitest y 78 de Playwright en verde, con lint, tipos y compilación
  (en «Probar» el agente responde con OpenRouter simulado mostrando tokens, coste y tiempo; sin clave sale el aviso
  y no se envía nada; modelos, traspaso, asistente y aviso de transcripción sin retención comprobados); revisiones
  corregidas. La prueba a mano con una clave real queda para el propietario.
- [x] Fase 2 · Bandeja, chat web y motor: base común de canales, chat web, bandeja, trabajo en segundo plano (al
  contestar avisos, con el cron y con el lanzador local), agrupación y bloqueo, IA encendida o apagada, pausa y
  traspaso, agente activo por canal y simulador — se comprueba: en `/widget-demo` responde el agente activo; al
  cambiarlo, responde el nuevo; si escribe una persona, la IA se pausa; el traspaso avisa; varios mensajes
  seguidos reciben una sola respuesta.
  Comprobado el 2026-09-27: 1991 pruebas de Vitest y 91 de Playwright en verde, con lint, tipos y compilación (en
  `/widget-demo` responde el agente activo y, al cambiarlo, el nuevo; una persona pausa la IA; el traspaso avisa y
  también se pide con «Hablar con una persona»; tres mensajes seguidos, una sola respuesta; si la IA falla dos
  veces, pasa a una persona y el error sale en Diagnóstico); revisiones de especificación, seguridad y aceptación
  corregidas (lo que queda para decidir, en el informe de cierre).
- [ ] Fase 3 · WhatsApp: asistente, avisos con firma, recepción y envío, archivos y audios, estados, ventana de
  24 h y plantillas, varios números, panel y modo pruebas, y las tres páginas legales en versión básica que
  Meta pide para publicar la app ([CUM-08]) — se comprueba: pruebas con avisos realistas de Meta (texto, audio,
  imagen, estado, contacto solo con BSUID, cambio de BSUID, duplicado y firma inválida) contra Meta simulado; el
  simulador recorre el flujo completo en la demo; las páginas legales se ven sin iniciar sesión; la prueba con
  el número de prueba de Meta queda escrita paso a paso en `docs/guia-whatsapp.md` para hacerla cuando la app se
  publique.
- [ ] Fase 4 · Conocimiento: archivos de contexto y bases, procesado por pasos, búsqueda híbrida, herramienta de
  búsqueda, fuentes en la bandeja y demo con embeddings precalculados — se comprueba: un PDF de más de 100 páginas
  responde un dato citando la fuente; si el dato no está, el agente dice que no lo sabe y ofrece una persona; sin
  clave, la búsqueda de la demo funciona por texto.
- [ ] Fase 5 · Agenda: datos de la agenda, motor de disponibilidad con pruebas exhaustivas (cambios de hora y
  aforo), pantalla, datos por sector, herramientas de citas, confirmaciones y recordatorios — se comprueba: con
  peluquería, el agente ofrece huecos reales y reserva; dos reservas a la vez del último hueco dejan una sola cita;
  con restaurante, respeta el aforo.
- [ ] Fase 6 · Correo: Gmail, Outlook e IMAP/SMTP, filtros, hilos y borradores — se comprueba, con Google,
  Microsoft y servidor de correo simulados: un correo entrante crea un borrador; al aprobarlo, sale en el mismo
  hilo; se ignoran los boletines y las respuestas automáticas.
- [ ] Fase 7 · Cumplimiento y producción: aviso de IA, bajas y conservación, exportar y borrar, páginas legales
  completas con sus textos editables, informes, PWA y push, herramientas HTTP, repaso de seguridad, guías y
  skills — se comprueba: un clon limpio en otra carpeta funciona siguiendo solo el README; siguiendo las guías
  se pone en marcha un negocio real en local
  (`pnpm db:fresh` y asistente); la guía de publicación en Vercel queda lista para comprobarla cuando se publique;
  `pnpm audit` sin fallos graves.

Después: publicación en Vercel (Turso, Blob y cron) con la prueba del número de prueba de Meta; Supabase; Dokploy;
GitHub (versión, migraciones solo aditivas, changelog y aviso de versión nueva); Telegram; respuestas con voz;
Google Calendar e iCal; evaluación; agente de fuera de horario; y servicios con dos recursos.

## Cómo se comprueba que todo funciona

- Cada regla de «Qué hace» y cada fila de «Quién puede hacer qué» tiene su prueba, que cita su código, y pasan
  `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` y `pnpm build`. Las pruebas nunca llaman a servicios
  reales: Meta, OpenRouter, Google, Microsoft, Mistral, Telegram y los servidores de correo están simulados.
- Clon limpio en otra carpeta: `pnpm install && pnpm dev` arranca con la demo; se entra con cada usuario del README
  y cada uno ve y puede hacer solo lo de su rol.
- Demo sin clave: se ve el aviso de la clave; un mensaje del simulador llega a la bandeja y espera a una persona;
  la búsqueda de conocimiento responde por texto; agenda, contactos e informes funcionan.
- Demo con una clave real (a mano y con gasto mínimo): una nota de voz por el simulador de WhatsApp se transcribe y
  el agente activo responde con el aviso de IA; en `/widget-demo` el agente responde una pregunta del negocio
  citando la fuente y reserva una cita que aparece en la agenda; al pedir una persona hay traspaso con aviso, y al
  contestar una persona la IA se pausa; al cambiar el agente activo responde el nuevo; un correo de demo crea un
  borrador que, aprobado, sale en el mismo hilo.
- Cumplimiento: «BAJA» da de baja; se exportan y se borran los datos de un contacto; las páginas legales se ven sin
  iniciar sesión; la limpieza diaria borra lo caducado.
- Seguridad: repaso de `docs/security.md`, `pnpm audit` sin fallos graves y revisión de `docs/review.md`; ninguna
  respuesta al navegador contiene un secreto; un aviso con firma falsa y el cron sin secreto se rechazan.
- Negocio real: con `pnpm db:fresh`, el asistente deja un negocio funcionando con su chat web; conectar WhatsApp y
  correo reales se comprueba cuando la app se publique, siguiendo las guías.
- PWA: en local se instala y recibe avisos en el navegador del ordenador; en el móvil, cuando la app se publique
  con HTTPS.
