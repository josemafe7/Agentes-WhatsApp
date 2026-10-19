# 0030 · El permiso «Avisos de sus citas» se da por hecho

- **Estado:** aceptada (pedida por el propietario el 2026-10-18)
- **Fecha:** 2026-10-18

## Contexto y problema

Con la decisión 0028, un recordatorio por WhatsApp o Telegram (y una plantilla de utilidad desde la bandeja) solo salía
a quien tenía el permiso «Avisos de sus citas»: lo marcaba el equipo, venía al importar o lo anotaba la IA cuando el
cliente decía que sí a su pregunta al reservar por WhatsApp o Telegram. En la práctica casi nadie lo tenía: quien
reserva por el chat de la web o con el equipo nunca recibe la pregunta, y el primer recordatorio de prueba del
propietario no salió por eso («Sin permiso de avisos»). El propietario pide que quien reserva lo tenga ya, y que solo
se le quite si dice que no lo quiere; para la publicidad, el permiso sigue siendo necesario.

Lo comprobado el 2026-10-18 en las fuentes oficiales:

- **Meta** pide que la persona haya dado su número y haya aceptado recibir mensajes del negocio, con el nombre del
  negocio, sin que haga falta nombrar WhatsApp; deja que cada negocio decida cómo conseguirlo y obliga a respetar
  cualquier petición de no recibir más, dentro o fuera de WhatsApp
  (<https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in/>,
  <https://whatsappbusiness.com/es-la/policy/>). No dice que reservar una cita cuente como ese permiso.
- **La ley** no lo pide para esto: un recordatorio de su cita no es publicidad (la LSSI solo exige el permiso para las
  comunicaciones comerciales, decisión 0028) y la política de privacidad de la app ya lo basa en el interés de que el
  cliente no pierda su cita, con cómo dejar de recibirlos.

## Opciones consideradas

- **Dejarlo como estaba**: solo a quien lo acepta; la IA lo pregunta al reservar por WhatsApp o Telegram.
- **Por defecto y avisándolo**: todos lo tienen salvo que digan que no, y la IA, en vez de preguntarlo, dice al
  confirmar la cita que le avisarán antes y cómo decir que no; así la reserva cuenta como el sí que pide Meta.
- **Por defecto, sin decir nada**: todos lo tienen salvo que digan que no, y la IA deja de preguntarlo.

## Decisión

Por defecto, sin decir nada (la que eligió el propietario):

- «Avisos de sus citas» lo tiene todo contacto mientras no haya un registro que lo retire. La ficha lo enseña como
  «Sí, por defecto».
- Se retira en la ficha («Quitar permiso»), al importar con un «no» en su columna, o lo
  anota la IA cuando el cliente dice con sus palabras que no quiere avisos (`anotar_permiso_avisos` con
  acepta = false), guardando lo que se dijo; si después dice que vuelve a quererlos, la IA lo anota de nuevo.
- La IA ya no pregunta al reservar.
- Vale para los recordatorios por WhatsApp y Telegram y para las plantillas de utilidad desde la bandeja. Las bajas de
  canal («BAJA», «no me mandéis más mensajes») siguen parando todo lo de ese canal.
- «Novedades y publicidad» no cambia: nunca se da por hecho.

## Consecuencias

- Los recordatorios llegan a todos los clientes con cita sin que el equipo marque nada, también a los que reservan
  por la web o en persona.
- Acepta un riesgo con Meta: su norma pide que la persona haya aceptado recibir mensajes del negocio, y aquí no se le
  dice nada al reservar. Si muchos clientes marcan los recordatorios como spam o bloquean el número, baja su calidad y
  Meta puede limitarlo. Para reducirlo, la app respeta cualquier «no» al momento.
- Un «no» a los avisos no para los recordatorios por correo: el correo no depende de ese permiso ([AGD-24]); para
  pararlos hace falta la baja del correo.
- Sustituye en parte a la 0028: solo en lo que dice del permiso «Avisos de sus citas» y de la pregunta de la IA.
