# Guía de los agentes internos

Cómo crear un agente que responda a tu equipo con los documentos de la empresa: manuales, procedimientos, tarifas,
normas. Tu equipo le pregunta desde el apartado «Asistentes» y él contesta diciendo de qué documento saca cada dato.

## Qué es un agente interno

Hay dos tipos de agente, y se elige al crearlo:

- **Para clientes:** atiende a tus clientes por WhatsApp, correo, chat web o Telegram.
- **Interno:** responde a tu equipo, dentro de la app. Nunca habla con un cliente: no se puede poner en un canal.

Un agente interno solo trata temas de tu negocio y solo responde con lo que encuentra en sus documentos. Si no lo
encuentra, lo dice; no se lo inventa. No es un asistente para cualquier cosa.

Lo crean y lo configuran el propietario y los administradores. Lo usan las personas a las que se lo des.

## Antes de empezar

- Hace falta la clave de OpenRouter en Ajustes › IA, igual que para los agentes de clientes. Sin ella, el agente no
  responde.
- Reúne los documentos que quieras que conozca. Sirven PDF, Word (`.docx`), Excel (`.xlsx`), CSV, texto y
  Markdown, además de páginas web y preguntas frecuentes escritas a mano.

## Crear la base interna

Una base interna es una base de conocimiento que **solo pueden usar los agentes internos**. Un agente que atiende
clientes no puede leerla, ni por error: la app no deja asignársela.

1. Ve a Conocimiento y pulsa «Nueva base».
2. Ponle un nombre, por ejemplo «Manual interno».
3. En «Uso», elige **«Interna»**. No se puede cambiar después: si te equivocas, crea otra base.
4. Dentro de la base, pulsa «Añadir contenido» y sube tus documentos. Cada uno pasa por «en cola», «extrayendo»,
   «troceando» y «embeddings» hasta quedar «listo».

Las bases internas solo las ven el propietario y los administradores.

**No subas datos personales si no hace falta** (nóminas, documentos de identidad, fichas de clientes). El agente
contestará con lo que haya en sus documentos a cualquiera que tenga acceso a él.

## Documentos grandes

- Cada archivo puede tener hasta 1.000 páginas y 25 MB. Un PDF de 1.000 páginas se procesa en alrededor de un
  minuto.
- **Si la app está publicada en Vercel, el máximo es 4 MB por archivo**, porque allí no cabe más en una subida. La
  pantalla te dice el máximo antes de subir. Si tu documento pesa más, divídelo en varios archivos (por capítulos,
  por ejemplo) o guárdalo sin imágenes. Ponles nombres que los distingan («manual-parte-1», «manual-parte-2»): si
  todas las partes traen el mismo título dentro, la segunda y las siguientes se quedan con su nombre de archivo, y
  así la respuesta dice de qué parte es cada página.
- **Si un PDF mezcla páginas con texto y páginas escaneadas**, la app solo lee las que tienen texto. Lo avisa al
  abrir el documento («12 páginas no tienen texto»). Para que lea las escaneadas, súbelas en un PDF aparte, que se
  leerá entero con Mistral OCR.
- Un PDF escaneado (fotos de páginas, sin texto que se pueda seleccionar) necesita la clave de Mistral OCR, que se
  pone en Ajustes › IA.
- En un PDF con el texto a dos columnas, la app puede mezclar las dos columnas. Si puedes elegir, sube el Word
  original.
- En Word y Markdown la app reconoce los títulos de cada apartado, y la respuesta puede decir el apartado. En un PDF
  dice el documento y la página. Si subiste documentos antes de la versión del 2026-10-09, pulsa «Reindexar» en los
  Ajustes de la base: desde esa versión la página que se cita es más exacta cuando un dato está al final de una
  página.
- El agente lee los trozos más parecidos a cada pregunta, no el documento entero. Va muy bien para un dato concreto
  («¿cuántos días de vacaciones tengo?») y mal para un resumen de todo («resúmeme el manual»).
- Si tienes muchos documentos, activa «Reordenar resultados» en Ajustes › IA: afina qué trozos lee el agente.

## Crear el agente interno

1. Ve a Agentes y pulsa «Nuevo agente».
2. En «¿Para quién es?», elige **«Interno, para tu equipo»**. Tampoco se puede cambiar después.
3. Ponle un nombre, por ejemplo «Asistente del equipo», y pulsa «Crear agente».
4. En **Instrucciones**, cuéntale quién es y cómo quieres que responda. Con una o dos frases en «Rol» y en «Estilo»
   basta para empezar.
5. En **Conocimiento**, activa las bases que debe usar. Puede usar bases internas y también las de clientes.
6. En **Modelo** puedes dejar el que viene.

Un agente interno no tiene las pestañas Herramientas, Traspaso ni Canales: no reserva citas, no pasa
conversaciones a nadie y no está en ningún canal.

## Acceso

En la pestaña **Acceso** decides quién puede usarlo:

- **Todo el equipo:** cualquier persona con cuenta, menos quien tiene el rol «Solo lectura».
- **Personas concretas:** solo las que marques. Aparecen los supervisores y los agentes.

El propietario y los administradores pueden usarlo siempre. Un agente recién creado no lo ve nadie más hasta que
eliges su acceso.

Si quieres documentos que solo deba consultar una parte del equipo, crea un agente para ellos con su propia base y
dale acceso solo a esas personas.

## Probarlo

Antes de darlo al equipo, abre la pestaña **Probar** y hazle las preguntas que le harían. La respuesta se ve igual
que la verá tu equipo. A la derecha ves de qué trozos de qué documentos ha sacado cada respuesta, y cuánto ha
costado. Lo que pruebas ahí no se guarda.

En Agentes, la tarjeta de cada agente interno dice quién tiene acceso: «todo el equipo», cuántas personas, o «solo
propietario y administradores» si todavía no se lo has dado a nadie.

## Usarlo

Quien tiene acceso ve **Asistentes** en el menú.

1. Abre el asistente y escribe tu pregunta. En el ordenador, Intro la envía y Mayús + Intro añade una línea; en el
   móvil, Intro añade una línea y se envía con el botón.
2. La respuesta dice de qué documento y página sale cada dato. Debajo, «Ver la fuente» enseña lo que el asistente
   consultó para responder, de lo más a lo menos relevante: el documento, el apartado, la página y su base.
3. Puedes seguir preguntando en la misma conversación, empezar otra con «Nueva conversación» o volver a una
   anterior desde «Tus conversaciones». Si tienes muchas, «Cargar más» trae las más antiguas.
4. Para borrar una conversación, pulsa la papelera que tiene al lado.

Mientras el asistente responde puedes abrir otra conversación o ir a otra parte de la app: la respuesta se guarda
igual y la encuentras al volver.

En el móvil, «Asistentes» está en «Más».

## Privacidad

- **Lo que cada persona pregunta solo lo ve ella.** Ni el propietario ni los administradores pueden leer las
  conversaciones de otra persona.
- El propietario y los administradores sí ven cuánto se usan los agentes internos y cuánto cuestan, en Informes.
  El resto del equipo ve el coste total de la IA, sin esa parte.
- Las preguntas y los trozos de documento que el agente necesita van a OpenRouter para que el modelo responda, con
  la orden de no guardarlos ni usarlos, como el resto de la IA de la app.
- Las conversaciones se borran cuando su dueño las borra, cuando se borra su usuario o cuando se borra el agente.

## Coste y límites

- En Informes, el coste de IA dice al propietario y a los administradores cuánto de él han gastado los agentes
  internos y cuántas preguntas han respondido.
- Cada persona puede hacer hasta 20 preguntas por minuto y 200 al día. Al pasarse, la app se lo dice y no envía la
  pregunta.

## Problemas frecuentes

- **No veo «Asistentes» en el menú.** No tienes acceso a ningún agente interno. Pídeselo a un administrador.
- **«Falta la clave de OpenRouter».** El propietario o un administrador tiene que ponerla en Ajustes › IA.
- **«El asistente no puede responder ahora mismo. Avisa a un administrador».** Hay algo que arreglar en la
  configuración de la IA (la clave, su saldo o el modelo del agente). El propietario y los administradores ven el
  motivo exacto si hacen ellos la pregunta, o en la pestaña Probar del agente.
- **La página que cita no es la del dato.** Abre el documento en Conocimiento y mira sus fragmentos: cada uno dice
  su página, y «[pág. N]» dentro del texto marca dónde empieza otra. Si el documento se subió hace tiempo, pulsa
  «Reindexar» en los Ajustes de la base.
- **Dice que no lo encuentra en la documentación.** Comprueba en la pestaña Conocimiento del agente que la base
  está activada y que el documento está «listo». Prueba la misma pregunta en «Probar búsqueda», dentro de la base.
- **No puedo activar una base interna en un agente.** Ese agente atiende clientes: una base interna solo la usan
  los agentes internos.
- **Quiero convertir un agente de clientes en interno, o al revés.** No se puede. Crea uno nuevo del tipo que
  necesitas.
