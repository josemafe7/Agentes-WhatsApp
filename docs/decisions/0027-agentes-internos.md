# 0027 · Agentes internos: un tipo de agente y un tipo de base, con sus conversaciones aparte

- **Estado:** aceptada (encargo del propietario del 2026-10-09: «agentes propios» para el equipo, con «una base de
  conocimiento propia de la empresa», dentro del mismo sistema)
- **Fecha:** 2026-10-09

## Contexto y problema

La app solo tenía agentes que atienden a clientes. El encargo pide además agentes que usen «los empleados que
tuvieran permiso» para consultar la documentación de la empresa. Casi todo lo necesario ya existía (el editor de
agentes, las bases de conocimiento, la búsqueda, el registro de costes): había que decidir cómo encajarlo sin que un
documento interno pueda acabar en una respuesta a un cliente, y sin romper las reglas del producto («nunca agentes
de propósito general», una instalación por negocio).

El propietario decidió en la entrevista:

- Los usa el equipo que ya tiene cuenta: no se añade un rol solo para esto.
- En cada agente interno se elige quién puede usarlo: todo el equipo o personas concretas.
- Lo que cada persona pregunta solo lo ve ella. Propietario y administradores ven el uso y el coste, no el
  contenido.

## Opciones consideradas

- **Una instalación aparte para el equipo**, con sus propios agentes y bases: no mezcla nada, pero duplica usuarios,
  clave de IA y mantenimiento, y contradice «dentro del mismo sistema».
- **Un canal «interno»** (como el chat web) con sus conversaciones en la bandeja: reutiliza el motor de respuesta,
  pero mete las preguntas del equipo en la bandeja, los informes y la conservación pensados para clientes, y las
  vería todo el que ve la bandeja.
- **Una marca en el agente y en la base** («para clientes» o «interno»), con las conversaciones del equipo en tablas
  propias.
- Para separar el conocimiento: **confiar en qué bases se asignan a cada agente** (lo que ya había) o **marcar la
  base** y comprobar la marca al asignar y al buscar.

## Decisión

- El agente y la base de conocimiento llevan su público (`audience`: `customers` o `team`), que se elige al crearlos
  y **no se cambia**: así no existe el camino «esta base era interna y ahora la usa un agente de clientes».
- Una base interna solo se asigna a un agente interno, y se comprueba dos veces: al guardar las bases del agente y
  en cada búsqueda, donde un agente de clientes solo lee bases para clientes aunque en la tabla hubiera otra cosa.
- Un agente interno nunca responde a clientes: no se activa en un canal ni se elige para una conversación.
- El acceso es por agente (`team_access`: `everyone` o `selected`, con la tabla `agent_members`). Propietario y
  administradores usan todos, porque ya pueden ver sus documentos.
- Las conversaciones del equipo van en tablas propias (`assistant_chats`, `assistant_messages`), nunca en
  `conversations`: no entran en la bandeja, los informes de atención, la conservación ni la exportación de
  contactos, y cada una pertenece a un usuario. No hay función ni pantalla para leer las de otro.
- El agente interno tiene sus propias reglas de plataforma (solo temas del negocio, responder con el conocimiento y
  citar la fuente, decir que no lo sabe) y una sola herramienta, `buscar_conocimiento`. La IA se llama dentro de la
  petición de la persona, como en «Probar agente»: no hay aviso de canal ni cola.
- Los agentes internos y las bases internas solo los ven y gestionan propietario y administradores: una base interna
  puede tener documentos que el resto del equipo solo debe conocer a través del agente al que se le da acceso.
- Un agente interno nuevo no es de nadie más hasta que se elige su acceso, y «Asistentes» solo está en el menú de
  quien tiene alguno: una instalación que no los usa no ve nada nuevo.
- Cada llamada a la IA lleva para quién se gastó (`ai_runs.audience`). Informes cuenta lo interno por esa marca y no
  por el agente, así que sus cifras no cambian cuando un agente interno se borra; las preguntas son las llamadas de
  chat que tuvieron respuesta.

## Consecuencias

- Gana: los agentes internos reutilizan el editor, las versiones, el conocimiento y el coste por IA sin tocar nada
  de la atención al cliente; la separación entre lo interno y lo de clientes no depende de que alguien configure
  bien un agente.
- Acepta: el tipo no se puede cambiar. Quien se equivoque crea otro agente u otra base.
- Acepta: sin un rol propio, quien usa un agente interno es alguien que ya ve la bandeja de sus canales. Un rol
  «solo asistentes» queda fuera y se puede añadir después sin cambiar esto.
- Acepta: nadie puede revisar lo que pregunta el equipo para mejorar los documentos; solo se ve cuánto se usa.
- Acepta: las conversaciones internas no se borran solas por antigüedad. Las borra quien las escribió, o se van con
  su usuario o con el agente.
- La migración 0004 solo añade: cuatro columnas con valor por defecto y tres tablas.
