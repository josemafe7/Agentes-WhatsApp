# Crear agentes y darles el conocimiento del negocio

Esta guía explica cómo crear un agente de IA que atienda a tus clientes, cómo ajustarlo, cómo probarlo, cómo
ponerlo a responder en un canal, cómo darle el conocimiento del negocio (documentos, páginas web y preguntas
frecuentes) para que responda con tus datos y diga de dónde los saca, y cómo conectarlo con otros programas.

## Antes de empezar

- **Necesitas la clave de OpenRouter.** Sin ella puedes crear y editar agentes, pero no responden: verás el
  aviso «Añade tu clave de OpenRouter». La pone el propietario o un administrador en **Ajustes › IA** (pega la
  clave, pulsa «Probar clave» y guarda). Se guarda cifrada y solo se ve como `••••1234`.
- **Revisa la privacidad de tu cuenta de OpenRouter** antes de usar datos reales: que los proveedores no
  guarden ni entrenen con lo que se les envía. La app, además, lo pide en cada mensaje.
- **Quién puede hacer qué:** el propietario y los administradores crean, editan, borran y prueban agentes; el
  supervisor los ve y los prueba; «Solo lectura» solo los ve; el rol Agente no entra en esta sección. En
  **Conocimiento**, el propietario, los administradores y el supervisor crean bases, añaden y borran documentos y
  usan «Probar búsqueda»; «Solo lectura» lo ve sin cambiar nada; el rol Agente no entra.

[Captura: la lista de Agentes con la tarjeta de cada agente, su modelo y sus canales]

## 1. Crear un agente

1. Entra en **Agentes** y pulsa **«Nuevo agente»**.
2. Elige cómo empezar:
   - **Plantilla de tu sector** (recomendada): trae instrucciones, estilo y reglas para pasar a una persona
     pensadas para tu tipo de negocio.
   - **Plantilla de otro sector**: si el agente atiende algo distinto de lo habitual.
   - **En blanco**: sin instrucciones, para escribirlas desde cero.
   - **Generar borrador con IA**: escribe la dirección de tu web o una descripción del negocio y la IA propone
     las instrucciones. Es solo una propuesta: la revisas y cambias lo que quieras antes de crear el agente.
     Si la web no se puede leer, la app lo dice y puedes usar una descripción.
3. Ponle un **nombre** (por ejemplo, «Recepción») y pulsa **«Crear agente»**. Se abre su editor.

El agente nace con los modelos de IA por defecto de Ajustes › IA: uno principal y otro de respaldo, de otro
proveedor, que responde si el principal falla.

[Captura: la pantalla «Nuevo agente» con las cuatro formas de empezar]

## 2. El editor del agente

Cada pestaña guarda por separado. Mientras tengas cambios sin guardar verás la barra **«Cambios sin guardar»**
con «Descartar» y «Guardar cambios»; si intentas salir, la app te pregunta antes. Si algo está mal (por
ejemplo, el nombre vacío), no se guarda y el error aparece junto al campo.

- **General:** nombre, descripción, avatar (PNG, JPG o WebP de hasta 512 KB), idioma y tono.
- **Instrucciones:** lo que el agente tiene que saber y cómo debe comportarse, en campos guiados: rol,
  información del negocio, qué puede hacer, qué no puede hacer, estilo y cuándo pasar a una persona, más
  «Otras instrucciones». Desde aquí también puedes **«Generar borrador con IA»** (rellena los campos, pero no
  guarda nada hasta que pulses «Guardar cambios») y abrir la **«Vista previa del prompt»**, que enseña el texto
  completo que recibe el modelo.
- **Modelo:** el modelo principal y el de respaldo, elegidos de la lista de OpenRouter. Solo aparecen modelos
  que admiten herramientas, con su precio por millón de tokens en dólares, su contexto y si aceptan imagen, PDF
  o audio. El de respaldo tiene que ser de otro proveedor. También puedes ajustar la temperatura (si el modelo lo
  permite), el razonamiento (bajo por defecto, para que responda rápido) y la longitud máxima de la respuesta.
- **Conocimiento:** sus archivos de contexto, las bases de conocimiento que usa y cuándo busca en ellas:
  «Automático» (busca cuando lo necesita) o «Buscar siempre» (busca antes de cada respuesta). Ver el apartado 7.
- **Herramientas:** «Pasar a una persona», siempre activa; «Buscar en el conocimiento»; y las de la agenda y los datos
  del cliente (consultar huecos, crear, cambiar y cancelar citas, guardar sus datos), que explica
  la guía de la agenda (en Ayuda). Un agente nuevo las trae apagadas: se encienden aquí. También las herramientas
  HTTP, que conectan el agente con otros programas (ver el apartado 8).
- **Traspaso:** cuándo pasa la conversación a una persona (palabras clave, temas sensibles y número de «no lo
  sé»), el mensaje que recibe el cliente dentro y fuera de horario, y a quién avisar.
- **Canales:** en qué canales responde este agente, con el interruptor «Activo aquí». Si el canal ya tenía otro
  agente, la app te pregunta antes de sustituirlo. Un agente puede estar activo en varios canales.
- **Probar:** un chat con el agente (ver el apartado 4).
- **Versiones:** el historial de cambios (ver el apartado 6).

[Captura: la pestaña Instrucciones con los campos guiados y la barra «Cambios sin guardar»]

## 3. Cómo escribir buenas instrucciones

- **Sé concreto:** «Atiendes las dudas de la peluquería y ayudas a reservar cita» es mejor que «Eres un
  asistente útil».
- **No repitas lo que la app ya le da:** el nombre, los datos de contacto, el horario, los cierres y los
  servicios con sus precios salen de Ajustes y le llegan solos. Si cambias el horario en Ajustes, el agente lo
  sabe al momento.
- **Di qué no debe hacer:** por ejemplo, dar diagnósticos, prometer descuentos o hablar de temas ajenos al
  negocio.
- **Deja claro cuándo pasar a una persona:** quejas, casos especiales o cuando el cliente lo pide.
- **Las reglas de la plataforma van siempre primero** y tus instrucciones no las pueden quitar: solo temas del
  negocio, no inventar precios ni horarios, avisar de que es una IA, no pedir tarjetas ni contraseñas y pasar a
  una persona si el cliente lo pide. Las ves arriba del todo en la «Vista previa del prompt».

[Captura: la «Vista previa del prompt» con las reglas de la plataforma primero]

## 4. Probar el agente

En la pestaña **Probar** escribes como si fueras un cliente y el agente responde con su configuración guardada.
Nada sale por los canales reales y estas conversaciones no aparecen en la Bandeja ni en los informes.

- **«Simular canal»** cambia entre WhatsApp, Correo y Chat web: el agente escribe con el estilo de cada uno
  (breve en WhatsApp y en el chat web, con saludo y firma en el correo).
- Debajo de cada respuesta ves los **tokens, el coste en dólares y el tiempo**. **«Ver detalles»** enseña el
  modelo que respondió (y si fue el de respaldo), los tokens por tipo, las herramientas que usó con sus datos y
  su resultado, y los **fragmentos de conocimiento** que leyó: su número, título, sección y página, su puntuación
  y la base de la que salen.
- Si pides «hablar con una persona», verás el **traspaso simulado** con el mensaje que recibiría el cliente.
- **«Empezar de nuevo»** borra la conversación de prueba.
- Sin clave de OpenRouter no se puede enviar: el aviso explica cómo añadirla.

Guarda los cambios antes de probar: el chat usa siempre la última versión guardada.

[Captura: la pestaña Probar con una respuesta, su coste y el panel «Detalles de la respuesta»]

## 5. Ponerlo a responder en un canal

Cada canal (un chat web, un número de WhatsApp, un buzón de correo) tiene como mucho **un agente activo**, que es
quien contesta lo que llega por ahí. Un mismo agente puede estar activo en varios canales. Lo cambian el
propietario y los administradores.

1. **Desde Canales:** en la tarjeta del canal, abre **«Agente activo»** y elige el agente. Si el canal ya tenía
   otro, la app te pregunta antes («… sustituirá a …») y lo cambias con **«Sustituir»**. Con «Sin agente» la IA
   deja de contestar en ese canal.
2. **Desde el agente:** en su pestaña **Canales**, el interruptor **«Activo aquí»** hace lo mismo, canal a canal.
3. **El interruptor de IA del canal** (en la misma tarjeta) apaga o enciende la IA sin quitar el agente: apagada,
   los mensajes esperan en la bandeja a una persona.

El cambio vale para los mensajes que llegan **después**: las respuestas anteriores conservan el nombre del agente
que las escribió, y en la bandeja cada una aparece como «IA · nombre del agente».

**Solo para una conversación:** en la cabecera de la conversación, en la bandeja, «Agente» deja elegir otro agente
solo para ella (el propietario, los administradores y el supervisor); «El del canal» la devuelve al agente activo
del canal.

**Pruébalo:** con un chat web, abre `/widget-demo` (el enlace «Probar» del canal te lleva con ese chat ya elegido) y
escribe como un cliente. Para WhatsApp o correo de la demo, usa **Ajustes › Diagnóstico › Simulador**. La respuesta
llega a los pocos segundos: la app espera de 4 a 8 por si el cliente escribe algo más y contesta todo junto.

**Cómo responde el canal** (panel del canal › Configuración):

- **Modo de respuesta:** «Automático» (la IA envía la respuesta) o «Borrador para revisar» (la IA deja un borrador
  en la bandeja y una persona lo **aprueba y envía**, lo **edita** antes de enviarlo o lo **descarta**; el cliente no
  recibe nada hasta entonces). Por defecto, automático en el chat web y WhatsApp, y borrador en el correo.
- **Fuera de horario:** «Responder igual» o «No responder fuera de horario» (los mensajes esperan a una persona).
- **Modo pruebas:** la IA solo contesta a los contactos de una lista (números, emails o identificadores); a los
  demás no, y sus mensajes esperan a una persona. Útil para probar un canal real antes de abrirlo a todos.
- **Aviso de IA:** el texto que va delante del primer mensaje de la IA en cada conversación (sin rellenar, el de
  Ajustes › Privacidad y legal).

**Cuándo el agente no contesta** (y el mensaje espera en la bandeja a una persona): sin clave de OpenRouter, sin
agente activo o con la IA del canal apagada, si una persona de tu equipo ha contestado hace poco (la IA de esa
conversación se pausa 12 horas por defecto, que se cambian en Ajustes › Notificaciones, y se ve «IA en pausa hasta …»), si la conversación está «Pendiente de
humano» tras un traspaso, en modo pruebas con un contacto que no está en la lista, fuera de horario con «No
responder» o si el cliente se ha dado de baja.

[Captura: la tarjeta de un canal con «Agente activo» y el interruptor de la IA]

## 6. Versiones, duplicar y borrar

- **Cada vez que guardas se crea una versión** con la fecha y quién la guardó. En **Versiones**, «Ver» enseña
  qué cambiaría si la restauras, y **«Restaurar esta versión»** la recupera como una versión nueva: el historial
  nunca se pierde.
- **Duplicar** (menú «…» de la tarjeta en Agentes) crea una copia con la misma configuración, útil para probar
  cambios grandes sin tocar el agente que está respondiendo.
- **Borrar** pide confirmación escribiendo el nombre del agente. Si está activo en algún canal, la app lo avisa:
  esos canales se quedan sin agente y la IA deja de responder ahí hasta que elijas otro. Los mensajes antiguos
  conservan el nombre del agente.

[Captura: la pestaña Versiones con «Si la restauras, cambia:»]

## 7. El conocimiento del negocio

El agente ya sabe lo que pones en Ajustes (datos del negocio, horario y servicios). El conocimiento es todo lo
demás que quieres que consulte: tarifas, normas, la carta, preguntas frecuentes, tu web… Hay dos formas de
dárselo:

- **Archivos de contexto** (pestaña Conocimiento del agente): textos cortos que el agente lee **enteros en cada
  mensaje**. Sirven para lo imprescindible y breve, como una hoja de tarifas.
- **Bases de conocimiento** (sección **Conocimiento** del menú): documentos largos o numerosos. El agente no los lee
  enteros: **busca** los trozos que necesita para cada pregunta y cita de dónde salen. Una misma base sirve para
  varios agentes.

**Una norma importante: no subas datos de clientes** (listas de contactos, historiales, facturas…) al conocimiento
ni a las instrucciones. El agente solo necesita información del negocio: servicios, políticas, preguntas
frecuentes y cómo trabajáis.

### Archivos de contexto

En el agente, pestaña **Conocimiento** › «Archivos de contexto»:

1. **«Subir archivo»** (PDF, Word `.docx`, TXT o Markdown, hasta 3,5 MB) o **«Pegar texto»** (un título y el
   texto). La app lo convierte en texto que puedes **editar** después pulsando su título.
2. La barra enseña cuántos **tokens** (trozos de palabra con los que la IA mide el texto) suman los archivos del
   agente. El tope es **30.000**: por encima no se guarda. Desde 20.000 la app avisa de lo que cuesta de más cada
   mensaje, porque todo ese texto va en cada respuesta.
3. Si un archivo es largo, su menú tiene **«Pasar a una base de conocimiento»**: lo mueve a una base (una que ya
   exista o una nueva), hace que el agente use esa base y solo entonces lo quita de los archivos de contexto.

[Captura: la pestaña Conocimiento del agente con la barra de tokens y los archivos de contexto]

### Crear una base y añadirle contenido

1. Entra en **Conocimiento** y pulsa **«Nueva base»**. Ponle un nombre (por ejemplo, «Información del negocio») y,
   si quieres, una descripción que solo ve tu equipo.
2. En la base, pulsa **«Añadir contenido»**:
   - **Archivos:** PDF, Word (`.docx`), Excel (`.xlsx`), CSV, TXT o Markdown, de hasta 25 MB cada uno. Puedes
     elegir o arrastrar varios a la vez y cada uno dice cómo ha ido. Los formatos antiguos `.xls` y `.doc` no se
     admiten: guárdalos como `.xlsx`, `.csv` o `.docx`. Un archivo idéntico a otro que ya está en la base se
     rechaza con «Este archivo ya está en la base».
   - **Página web:** la dirección de una página pública de tu web (se guarda su texto, sin menús ni pies). Marca
     «Añadir también las páginas de su mapa del sitio» para traer hasta 50 páginas de tu web de una vez, y «Volver
     a leerla de vez en cuando» (cada día, semana o mes) si cambia a menudo: si ha cambiado, se procesa de nuevo;
     si no, se deja como está.
   - **Pregunta frecuente:** una pregunta y su respuesta. También están en la pestaña **«Preguntas frecuentes»**,
     donde se editan y se borran.
3. Cada documento pasa por sus pasos en segundo plano y la lista se actualiza sola: **En cola → Extrayendo →
   Troceando → Embeddings → Listo**. Si algo falla verás **Error** con el motivo y el botón **«Reintentar»**.
   - **«Listo (solo texto)»:** ya se encuentra buscando por palabras, pero le falta la búsqueda por significado
     porque no hay clave de OpenRouter. Se completa sola cuando la pones en Ajustes › IA (o, si la pones en
     `.env.local`, al reiniciar la app).
   - **PDF escaneado** (una foto de papel, sin texto): para leerlo hace falta la clave de **Mistral OCR** en Ajustes ›
     IA. Sin ella queda en error con el aviso «PDF escaneado: añade la clave de Mistral OCR…». Con la clave, pulsa
     «Reintentar».
   - Las hojas de cálculo se trocean en bloques de unas 20 filas, cada uno con la fila de cabecera, para que cada
     trozo se entienda solo. Los PDF guardan su número de página, que el agente cita.
4. Pulsa el título de un documento para ver su resumen y sus **fragmentos** (los trozos en que se ha partido, con
   su sección y su página). Desde su menú puedes **Reprocesar** un archivo, **Refrescar** una página web o
   **Borrar** el documento (se borran su archivo y sus fragmentos).

[Captura: una base con documentos en distintos estados y el diálogo «Añadir contenido»]

### Probar la búsqueda

En la base, la pestaña **«Probar búsqueda»** busca como lo hará el agente, sin gastar en el modelo de chat:
escribe una pregunta y verás los fragmentos numerados que encontraría (título, sección y página), con su
puntuación, o **«Nada relevante»** si no hay nada que responda a eso (entonces el agente diría que no lo sabe). No
distingue mayúsculas ni tildes: «depilacion» encuentra «depilación». Si la búsqueda ha ido solo por palabras (sin
clave, o con documentos sin embeddings todavía), lo dice.

[Captura: «Probar búsqueda» con los resultados numerados y sus puntuaciones]

### Que un agente use la base

1. En el agente, pestaña **Conocimiento** › «Bases de conocimiento», enciende **«Usar»** en cada base que deba
   consultar. Solo busca en las que tenga encendidas.
2. En «Cuándo busca en el conocimiento» elige:
   - **Automático:** el agente busca cuando lo necesita. Para eso tiene que tener encendida **«Buscar en el
     conocimiento»** en la pestaña **Herramientas**; si no, la pestaña Conocimiento te avisa con un enlace.
   - **Buscar siempre:** busca antes de cada respuesta con lo que ha escrito el cliente. Gasta un poco más, pero
     nunca se le olvida mirar.
3. Guarda y pruébalo en **Probar**: en «Ver detalles» verás qué fragmentos leyó.

Cuando responde con algo del conocimiento, el agente dice de dónde lo ha sacado (el documento y, si la tiene, la
página). **Si la respuesta no está en sus bases, dice que no lo sabe y ofrece pasar con una persona**; esas
respuestas cuentan para el número de «no lo sé» de la pestaña Traspaso.

Los agentes de la demo ya usan la base «Información del negocio» en modo «Automático».

### En la bandeja: de dónde sale cada respuesta

- **«Ver fuentes»**, bajo una respuesta de la IA, abre **«¿Por qué respondió esto?»**: los fragmentos que usó, del
  más al menos relevante, con su puntuación, sección, página y base, «Abrir el documento» y las herramientas que
  usó. Lo ven todos los que pueden ver esa conversación.
- **«Convertir en FAQ»**, bajo una respuesta de una persona de tu equipo, crea una pregunta frecuente con la
  pregunta del cliente y esa respuesta. Puedes editar las dos (quita cualquier dato personal) y elegir la base
  antes de pulsar «Guardar FAQ». Lo pueden hacer el propietario, los administradores y el supervisor.

[Captura: el panel «¿Por qué respondió esto?» con sus fragmentos]

### Modelo de embeddings y reindexar

Un **embedding** es la versión en números de un trozo de texto que permite buscar por significado y no solo por
palabras. Cada base guarda el modelo con que los calculó (por defecto `openai/text-embedding-3-small`).

- En la pestaña **Ajustes** de una base puedes cambiar su nombre y descripción, **cambiar el modelo** (la app lo
  prueba antes: tiene que dar vectores de 1536 números), **«Reindexar»** (volver a procesarla entera) y **«Borrar
  base»** escribiendo su nombre.
- En **Ajustes › IA**, cambiar el modelo de embeddings por defecto pide confirmación y, al guardar, **todas las
  bases se vuelven a procesar** con el nuevo.
- Mientras una base se reprocesa, los agentes siguen buscando con el índice anterior hasta que el nuevo está
  completo: no hay un momento en que se queden sin conocimiento. Si editas un documento mientras tanto, el índice
  nuevo ya lleva el texto nuevo.
- **«Reordenar resultados»** (Ajustes › IA, desactivado por defecto): un modelo más revisa los fragmentos que
  encuentra la búsqueda y se queda con los 6 más útiles. Mejora las respuestas y cada búsqueda cuesta un poco más.
  Con «Sin retención de datos» solo se puede usar `qwen/qwen3-reranker-8b`; con otro modelo, la pantalla lo avisa y
  no se reordena.
- **La orden `pnpm seed:embeddings`** es solo para quien mantiene el proyecto: vuelve a calcular los embeddings de la
  demo, que se guardan en el repositorio para que su búsqueda por significado funcione nada más poner la clave.
  Necesita la clave de OpenRouter en `.env.local` y gasta un poco de IA. Un negocio real no la necesita: la app
  calcula sola los embeddings de tus bases cuando hay clave.

## 8. Herramientas HTTP: conectar con otros programas

Una herramienta HTTP deja que el agente consulte o envíe datos a otro programa a través de una dirección web: por
ejemplo, un flujo de n8n que mira el estado de un pedido, o tu CRM (el programa donde guardas tus clientes) para
apuntar a alguien interesado. HTTP es la forma en que los programas se hablan por internet.

Las crean y las cambian el propietario y los administradores. Cada herramienta se define una vez: en **Agentes**, pulsa
**Herramientas HTTP** (`/agentes/herramientas`) y **Nueva herramienta**. Esa pantalla también dice qué agentes usa
cada una. Después se enciende en cada agente que la necesite.

### Crear una herramienta

- **Nombre:** corto y sin espacios, por ejemplo `consultar_pedido`. Es como la ve el agente.
- **Descripción para la IA:** qué hace y cuándo usarla. El agente decide por ella, así que sé concreto: «Consulta el estado de un
  pedido de la tienda online con su número. Úsala cuando el cliente pregunte por su pedido».
- **Datos que envía la IA** (los parámetros): los datos que el agente tiene que enviar, cada uno con su nombre, su tipo
  y una explicación (por ejemplo, `numero_pedido`: «el número de pedido que da el cliente»). Pide solo los
  imprescindibles. Se pueden meter en la dirección entre llaves: `https://tu-crm.com/api/pedidos/{numero_pedido}`.
- **Método:** GET, POST, PUT, PATCH o DELETE, según lo que espere el otro programa. Por defecto, POST.
- **Dirección (URL):** una dirección pública que empiece por `https://`. La app no llama a direcciones sin HTTPS ni a
  las de una red interna (como `localhost` o las que empiezan por `192.168.`), ni sigue redirecciones. Solo mientras
  pruebas la app en tu ordenador con `pnpm dev` deja llamar a un n8n de pruebas de tu red.
- **Cabeceras secretas:** la contraseña o el token que pide el otro programa, por ejemplo en la cabecera
  `Authorization`. Se guardan cifradas y después solo se ven como `••••1234`. Nunca llegan al agente ni a los
  registros, tampoco cuando la herramienta da un error.
- **Tiempo máximo:** cuánto se espera la respuesta (10 segundos por defecto). Si tarda más, se corta y el agente
  recibe un error.

Pruébala con **Probar** y valores de ejemplo antes de dársela a un agente. La respuesta del otro programa se recorta a un tamaño
corto: haz que devuelva solo lo que el agente necesita, unas líneas de texto o un JSON pequeño. Lo que responda son
datos para el agente, nunca órdenes: no cambia sus reglas.

### Dársela a un agente

1. En el agente, pestaña **Herramientas**, apartado «Herramientas HTTP», enciende la herramienta: se guarda al momento
   y vale desde su siguiente mensaje. «Gestionar herramientas HTTP» lleva a la lista.
2. En **Probar**, haz una pregunta que la necesite. En «Ver detalles» verás la herramienta que usó, los datos que
   envió y lo que le respondieron.
3. Si la herramienta cambia algo en el otro programa (crea un pedido, apunta una baja…), escribe en las instrucciones
   del agente que lo confirme antes con el cliente.

Lo que el agente envía a una herramienta sale de la app: añade ese programa a tu política de privacidad y al contrato
de encargo del tratamiento.

### Con n8n

- Usa un nodo **Webhook** y copia su dirección de producción, no la de pruebas (la que lleva `webhook-test`).
- Protégelo con autenticación por cabecera (Header Auth) y pon esa misma cabecera como cabecera secreta de la
  herramienta.
- Haz que el flujo devuelva el resultado (por ejemplo, con el nodo **Respond to Webhook**) y déjalo activo
  (publicado): si no, la dirección de producción no responde.

[Captura: el formulario de una herramienta HTTP con su dirección y la cabecera secreta enmascarada]

## Problemas frecuentes

- **El agente no responde en Probar:** comprueba que hay clave de OpenRouter en Ajustes › IA y que la cuenta
  de OpenRouter tiene saldo. El mensaje de error lo explica en español.
- **El agente no responde en un canal:** repasa «Cuándo el agente no contesta» del apartado 5. La cabecera de la
  conversación dice si la IA está en pausa, apagada o esperando a una persona, y «Reactivar» la vuelve a encender.
- **Responde otro agente del que esperaba:** mira el «Agente activo» del canal en Canales y, en la conversación, si
  tiene un agente elegido solo para ella.
- **No puedo elegir un modelo:** sin clave la lista no se carga. Con clave, pulsa «Actualizar lista» en el
  selector; si un modelo no aparece, es que no admite herramientas o está marcado como gratuito, de pruebas o a
  punto de retirarse.
- **«El modelo de respaldo tiene que ser de otro proveedor»:** elige uno de otra marca (por ejemplo, si el
  principal es de OpenAI, uno de Google o Anthropic).
- **Un aviso dice que un modelo se retira o ya no está en la lista:** cambia el modelo del agente en su pestaña
  Modelo antes de esa fecha. Si el aviso lleva a Ajustes › IA, el modelo es uno de los modelos por defecto: cámbialo
  ahí. El aviso llega una sola vez por modelo (en la campana y, si así lo tienes en Mi cuenta, por email).
- **El agente no usa el conocimiento:** mira en su pestaña Conocimiento que la base tenga «Usar» encendido y, en modo
  «Automático», que «Buscar en el conocimiento» esté encendida en Herramientas. Comprueba con «Probar búsqueda» que
  la base encuentra la respuesta con las palabras del cliente.
- **Un documento se queda en «Listo (solo texto)»:** falta la clave de OpenRouter; al guardarla en Ajustes › IA se
  calculan los embeddings que faltan. Si la pusiste en `.env.local`, se calculan al reiniciar la app.
- **Un documento acaba en «Error»:** el motivo sale en la lista. Un PDF escaneado necesita la clave de Mistral OCR;
  un archivo protegido con contraseña o dañado hay que volver a guardarlo; después, «Reintentar».
- **«Este archivo ya está en la base»:** ese mismo archivo ya se subió. Si lo has cambiado, bórralo y sube el nuevo.
- **Un archivo de contexto no se guarda:** los archivos de contexto del agente no pueden pasar de 30.000 tokens en
  total. Pasa el más largo a una base de conocimiento.
- **Una herramienta HTTP da error o se agota el tiempo:** comprueba que la dirección es pública y empieza por
  `https://`, que el otro programa responde (en n8n, la dirección de producción y el flujo activo) y que la cabecera
  secreta es la correcta. Si el programa es lento, sube el tiempo máximo. Pruébala con valores de ejemplo.
- **El agente no usa una herramienta HTTP:** tiene que estar encendida en su pestaña Herramientas, y su descripción
  tiene que decir con claridad cuándo usarla.
