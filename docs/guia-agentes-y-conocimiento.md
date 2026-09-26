# Crear agentes y darles el conocimiento del negocio

Esta guía explica cómo crear un agente de IA que atienda a tus clientes, cómo ajustarlo y cómo probarlo antes
de ponerlo a responder en un canal. Es la primera versión: la parte de conocimiento (documentos, webs y
preguntas frecuentes) se completará cuando esa sección de la app esté lista.

## Antes de empezar

- **Necesitas la clave de OpenRouter.** Sin ella puedes crear y editar agentes, pero no responden: verás el
  aviso «Añade tu clave de OpenRouter». La pone el propietario o un administrador en **Ajustes › IA** (pega la
  clave, pulsa «Probar clave» y guarda). Se guarda cifrada y solo se ve como `••••1234`.
- **Revisa la privacidad de tu cuenta de OpenRouter** antes de usar datos reales: que los proveedores no
  guarden ni entrenen con lo que se les envía. La app, además, lo pide en cada mensaje.
- **Quién puede hacer qué:** el propietario y los administradores crean, editan, borran y prueban agentes; el
  supervisor los ve y los prueba; «Solo lectura» solo los ve; el rol Agente no entra en esta sección.

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
- **Conocimiento:** «Automático» (busca en el conocimiento cuando lo necesita) o «Buscar siempre» (busca antes
  de cada respuesta).
- **Herramientas:** de momento el agente solo tiene «Pasar a una persona», siempre activa. Las demás (agenda,
  conocimiento, datos del contacto) aparecen como «Próximamente».
- **Traspaso:** cuándo pasa la conversación a una persona (palabras clave, temas sensibles y número de «no lo
  sé»), el mensaje que recibe el cliente dentro y fuera de horario, y a quién avisar.
- **Canales:** en qué canales responde este agente, con el interruptor «Activo aquí». Si el canal ya tenía otro
  agente, la app te pregunta antes de sustituirlo. Un agente puede estar activo en varios canales.
- **Probar:** un chat con el agente (ver el apartado 4).
- **Versiones:** el historial de cambios (ver el apartado 5).

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
  su resultado, y los fragmentos de conocimiento.
- Si pides «hablar con una persona», verás el **traspaso simulado** con el mensaje que recibiría el cliente.
- **«Empezar de nuevo»** borra la conversación de prueba.
- Sin clave de OpenRouter no se puede enviar: el aviso explica cómo añadirla.

Guarda los cambios antes de probar: el chat usa siempre la última versión guardada.

[Captura: la pestaña Probar con una respuesta, su coste y el panel «Detalles de la respuesta»]

## 5. Versiones, duplicar y borrar

- **Cada vez que guardas se crea una versión** con la fecha y quién la guardó. En **Versiones**, «Ver» enseña
  qué cambiaría si la restauras, y **«Restaurar esta versión»** la recupera como una versión nueva: el historial
  nunca se pierde.
- **Duplicar** (menú «…» de la tarjeta en Agentes) crea una copia con la misma configuración, útil para probar
  cambios grandes sin tocar el agente que está respondiendo.
- **Borrar** pide confirmación escribiendo el nombre del agente. Si está activo en algún canal, la app lo avisa:
  esos canales se quedan sin agente y la IA deja de responder ahí hasta que elijas otro. Los mensajes antiguos
  conservan el nombre del agente.

[Captura: la pestaña Versiones con «Si la restauras, cambia:»]

## 6. El conocimiento del negocio

El conocimiento (documentos, páginas web y preguntas frecuentes que el agente consulta para responder) llega
en una próxima versión de la app, y esta guía se completará entonces con cómo cargarlo.

Desde ya, una norma importante: **no subas datos de clientes** (listas de contactos, historiales, facturas…) al
conocimiento ni a las instrucciones. El agente solo necesita información del negocio: servicios, políticas,
preguntas frecuentes y cómo trabajáis.

## Problemas frecuentes

- **El agente no responde en Probar:** comprueba que hay clave de OpenRouter en Ajustes › IA y que la cuenta
  de OpenRouter tiene saldo. El mensaje de error lo explica en español.
- **No puedo elegir un modelo:** sin clave la lista no se carga. Con clave, pulsa «Actualizar lista» en el
  selector; si un modelo no aparece, es que no admite herramientas o está marcado como gratuito, de pruebas o a
  punto de retirarse.
- **«El modelo de respaldo tiene que ser de otro proveedor»:** elige uno de otra marca (por ejemplo, si el
  principal es de OpenAI, uno de Google o Anthropic).
- **Un aviso dice que un modelo se retira o ya no está en la lista:** cambia el modelo del agente en su pestaña
  Modelo antes de esa fecha.
