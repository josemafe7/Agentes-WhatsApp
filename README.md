# DominIA Agentes

Plataforma de agentes IA de atención al cliente (WhatsApp, correo y chat web) que se instala una vez por
negocio y se configura sin tocar código. Cada instalación es de un solo negocio, con su propia base de datos y
sus propias claves.

**Estado: fases 0 (base), 1 (agentes y OpenRouter), 2 (bandeja, chat web y motor), 3 (WhatsApp) y 4 (conocimiento)
construidas, solo en local.** Ya funcionan el arranque con la demo, el inicio de sesión con roles e invitaciones, el
asistente de arranque, los ajustes, el cifrado de claves, los agentes de IA (plantillas, versiones, modelos y «Probar
agente»), el chat web para pegar en la web del negocio, la bandeja con traspaso a una persona, los contactos, los
canales con su agente activo, el motor que responde en segundo plano, el simulador de canales, WhatsApp con la API
oficial de Meta (asistente de conexión, avisos firmados, archivos y notas de voz, estados, ventana de 24 h y
plantillas, varios números, panel con semáforos, tarifas y las páginas legales que pide Meta) y el conocimiento del
negocio (archivos de contexto de cada agente, bases con documentos, webs y preguntas frecuentes, búsqueda por
significado y por palabras, la herramienta de búsqueda del agente y las fuentes de cada respuesta en la bandeja). El
correo real y la agenda llegan en las fases siguientes (`docs/spec.md`, «Fases»). La app todavía no está publicada en
internet: por eso WhatsApp real aún no se ha probado con Meta (ver «Conectar WhatsApp real»).

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
  siempre activa, y «Buscar en el conocimiento»; las de la agenda llegan con su fase), Traspaso, Canales, Probar y
  Versiones. Cada guardado crea una versión que se puede restaurar. Desde la tarjeta se duplica o se borra.
- **Probar agente** (pestaña Probar de un agente): un chat con el agente, sin canales reales, con «Simular
  canal» (WhatsApp, correo o chat web) y, en cada respuesta, los tokens, el coste en US$, el tiempo y «Ver
  detalles» (herramientas usadas y fragmentos de conocimiento con su puntuación y su fuente). Necesita la clave de
  OpenRouter (ver arriba); sin ella verás el aviso y no se puede enviar. El supervisor también puede probar; «Solo
  lectura» ve los agentes sin cambiar nada y el rol Agente no entra.
- **Ayuda** (menú de tu usuario, o Ajustes › Acerca de): las guías paso a paso dentro de la app: crear y probar
  agentes y darles el conocimiento del negocio, conectar WhatsApp y publicar en Vercel. Las demás llegan con sus
  fases.
- **Ajustes › Horario, IA, Correo del sistema, Privacidad y legal y Notificaciones:** horario con varios tramos
  por día y festivos; la clave de OpenRouter, los modelos por defecto (chat, respaldo de otro proveedor,
  transcripción, embeddings y descripción de imágenes) elegidos de la lista con precios, la lista de
  recomendados y «Sin retención de datos», con aviso si un modelo en uso se retira o si el de transcripción tiene
  proveedores que pueden guardar los audios, «Reordenar resultados» del conocimiento con su modelo (desactivado por
  defecto; con «Sin retención de datos» solo se ofrece el que no guarda nada y, si el elegido sí guarda, lo avisa y
  no reordena), y la clave de Mistral OCR para los PDF escaneados; el servidor SMTP de los correos de la app; textos legales, aviso de IA y plazos de conservación; y quién recibe cada aviso.
- **Ajustes › Registro de actividad y Diagnóstico:** quién hizo qué, con filtros; y el estado de la base de
  datos, de la cola de trabajos (con «Reintentar»), los errores recientes de la IA (si una respuesta falla también
  al reintentarla, la conversación pasa a una persona y el error aparece aquí) y los correos que ha enviado la app,
  que en local puedes abrir desde ahí.
- **Asistente de arranque:** con `pnpm db:fresh` (ver «Paso a un negocio real») la app queda vacía y te guía:
  cuenta de propietario, negocio y sector, horario, clave de IA, primer agente (desde la plantilla del sector
  o generado desde la web del negocio si hay clave), un chat web con ese agente que se prueba ahí mismo (y en
  `/widget-demo`) y los canales que faltan.

Próximamente: la agenda con citas (fase 5) y el correo real (fase 6).

## Órdenes

| Orden | Qué hace |
|---|---|
| `pnpm dev` | Arranca la app en local (y la prepara si falta `.env.local` o la base de datos). Lanza el trabajo en segundo plano cada 15 s; además, cada mensaje que llega lo lanza él mismo cuando toca responder, así que las respuestas llegan sin configurar ningún cron. |
| `pnpm run setup` | Solo la preparación. Siempre con `run`: `pnpm setup` es otra orden de pnpm que cambia el PATH del ordenador. Repetirla no cambia nada. |
| `pnpm lint` / `pnpm typecheck` | Revisan el código y los tipos. |
| `pnpm test` | Pruebas de Vitest (cada archivo con su propia base temporal; nunca toca `data/local.db`). |
| `pnpm test:e2e` | Pruebas de Playwright: compila la app, la arranca en los puertos 3100 (demo) y 3102 (instalación vacía) con sus propias bases (`data/e2e.db` y `data/e2e-fresh.db`) y simula los servicios externos en el 3101. La primera vez: `pnpm exec playwright install chromium`. |
| `pnpm build` / `pnpm start` | Compila la app como en producción y la arranca. |
| `pnpm db:migrate` | Pone la base de datos al día (migraciones). |
| `pnpm db:generate` | Genera una migración nueva a partir del esquema (solo para desarrollar). |
| `pnpm seed [--sector=…]` | Carga la demo de un sector en lugar de la que haya: `peluqueria` (por defecto), `clinica-dental`, `fisioterapia`, `restaurante`, `taller`, `academia`, `inmobiliaria`, `tienda` u `otro`. Se niega si la base tiene datos de un negocio real, o si `DEMO_MODE` no es `true` (salvo con `--force-demo`). |
| `pnpm seed:embeddings` | Recalcula los embeddings de la demo de los nueve sectores con el modelo por defecto (`openai/text-embedding-3-small`, 1536 dimensiones) y los guarda en `seed/fixtures/embeddings.json`. Necesita `OPENROUTER_API_KEY` en `.env.local` y gasta céntimos de IA; sin la clave se niega y no cambia nada. No toca la base de datos. |
| `pnpm db:reset [--sector=…]` | Borra todo y deja la demo como recién instalada. Pregunta antes (`--yes` para no preguntar). |
| `pnpm db:fresh` | Borra todo y deja una instalación vacía con el asistente de arranque. Pregunta antes (`--yes`). |
| `pnpm worker` | Ejecuta el trabajo en segundo plano en bucle, para un servidor propio (VPS). |

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
| `APP_URL`, `BETTER_AUTH_URL` | Dirección de la app, para los enlaces de los correos y el inicio de sesión. Con `APP_URL` se hace también la dirección de avisos de WhatsApp (`https://<dominio>/api/webhooks/whatsapp`): publicada, tiene que ser el dominio de producción con HTTPS. |
| `BETTER_AUTH_SECRET` | Firma las sesiones. |
| `APP_ENCRYPTION_KEY` | Cifra las claves que el negocio pone en la app. **Guárdala aparte:** si se pierde, esas claves no se pueden leer. Sin ella la app no arranca. |
| `CRON_SECRET` | Protege la ruta del trabajo en segundo plano (`/api/cron/tick`). |
| `SETUP_TOKEN` | Código de instalación: en una instalación publicada, el primer paso del asistente lo pide para crear el propietario. En local, vacío. |
| `DEMO_MODE` | `true` en local: aviso «Modo demo» y canales de demo que nunca llaman a servicios reales. |
| `OPENROUTER_API_KEY` | Clave de OpenRouter (opcional; mejor en Ajustes › IA). |
| `BLOB_READ_WRITE_TOKEN` | Almacén de archivos de Vercel Blob al publicar; en local los archivos van a `data/uploads/`. |
| `FFMPEG_BIN` | Opcional: otro FFmpeg para convertir notas de voz a MP3. Sin ella se usa el que trae el proyecto. |
| `OPENROUTER_BASE_URL`, `META_GRAPH_BASE_URL` y demás `*_BASE_URL` | Solo para las pruebas, que apuntan a un simulador. No las cambies. |
| `REPLY_DEBOUNCE_MS` | Solo para las pruebas: espera fija antes de que la IA responda (en una instalación real, de 4 a 8 s). |

Los secretos van solo en `.env.local`, que nunca se sube a Git.

## Conectar canales reales

- **Chat web (ya disponible):** en Canales › Añadir canal › Chat web, añade el dominio de tu web (por ejemplo
  `www.tunegocio.es`) en «Dominios permitidos» y pega el código de «Apariencia y código» en tu web. El chat solo
  funciona en esos dominios y en la propia app. Hasta publicar la app, tu web no puede llegar a `localhost`:
  pruébalo en `/widget-demo`.
- **WhatsApp:** ver «Conectar WhatsApp real», justo debajo.
- **Correo** (Gmail, Outlook e IMAP/SMTP): llega con su fase. Lo comprobado de cada servicio está en
  `docs/integracion-correo.md`; la guía, `docs/guia-correo.md`, llegará con ella.
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

## Despliegue

La app todavía no está publicada: de momento funciona solo en local. Cuando toque, la guía paso a paso es
[`docs/guia-despliegue.md`](docs/guia-despliegue.md) (también dentro de la app, en Ayuda): Vercel con Turso (base
de datos), Vercel Blob privado (archivos), el código de instalación (`SETUP_TOKEN`) y un cron externo cada minuto,
porque el plan gratuito de Vercel solo admite uno al día. `vercel.json` ya trae ese cron diario a `/api/cron/tick`
y la región de las funciones en la UE. Los datos técnicos de cada servicio están en
`docs/plataforma-despliegue.md`.

## Paso a un negocio real

1. Para la app y ejecuta `pnpm db:fresh`: borra la demo y deja la instalación vacía.
2. En `.env.local`, cambia `DEMO_MODE=true` por `DEMO_MODE=false` y arranca con `pnpm dev`.
3. Abre la app: el asistente de arranque te pide la cuenta de propietario, el negocio y su sector, el horario y
   la clave de OpenRouter.
4. Guarda `APP_ENCRYPTION_KEY` en un gestor de contraseñas.

A partir de aquí `pnpm seed` se niega a cargar la demo en esa base, para no mezclarla con datos reales.

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
- **«Demasiados intentos. Espera unos minutos.»:** tras 5 contraseñas mal seguidas, espera 15 minutos.
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
- **La lista de modelos no sale o le falta alguno:** sin clave no se carga. Solo aparecen modelos que admiten
  herramientas, con precio y sin fecha de retirada; «Actualizar lista» la vuelve a pedir a OpenRouter (se guarda
  12 horas).
- **El agente no usa el conocimiento:** en su pestaña Conocimiento, la base tiene que tener «Usar» encendido y, en
  «Automático», el agente necesita «Buscar en el conocimiento» encendida en Herramientas (la pestaña lo avisa).
  Comprueba con «Probar búsqueda» de la base que encuentra la respuesta.
- **Los documentos se quedan en «Listo (solo texto)»:** faltan los embeddings porque no había clave. Al guardar la
  clave en Ajustes › IA se calculan solos; si la pusiste en `.env.local`, pulsa «Reindexar» en los ajustes de la
  base.
- **Un documento acaba en «Error»:** el motivo sale en la lista. Un PDF escaneado necesita la clave de Mistral OCR
  en Ajustes › IA; después, «Reintentar».
- **«Este archivo ya está en la base»:** ese mismo archivo ya se subió a esa base. Si ha cambiado, borra el antiguo.
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
- [Conectar WhatsApp](docs/guia-whatsapp.md): portfolio, app, token, publicación, método de pago, la prueba con
  el número de prueba de Meta y los problemas frecuentes.
- [Publicar la app en Vercel](docs/guia-despliegue.md).
