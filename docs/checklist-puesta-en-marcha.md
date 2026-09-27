# Lista de puesta en marcha

Esta lista lleva a un negocio real de cero a sus primeras conversaciones con clientes. Ve en orden y marca cada punto
al terminarlo. Cada apartado dice qué guía lo explica paso a paso.

Las guías están en **Ayuda** (en el menú de tu usuario) y, en el repositorio, en la carpeta `docs/`:

- «Publicar la app en Vercel» (`guia-despliegue.md`).
- «Crear agentes y darles el conocimiento del negocio» (`guia-agentes-y-conocimiento.md`).
- «La agenda: citas, servicios, recursos y recordatorios» (`guia-agenda.md`).
- «Conectar WhatsApp» (`guia-whatsapp.md`).
- «Conectar el correo» (`guia-correo.md`).

Si trabajas con un agente de código, la skill `nuevo-negocio` recorre esta lista contigo.

## Antes de empezar

- **Quién hace qué.** El negocio es el dueño de todo: de sus cuentas (Meta, Google o Microsoft, OpenRouter), de sus
  datos y de sus textos legales. Quien lo implanta publica la app, la configura y tiene acceso de administrador
  mientras la mantiene.
- **Dónde va a funcionar.** En un ordenador (en local) sirve para preparar y probar, pero no recibe WhatsApp ni
  correos reales. Vercel Hobby, solo para pruebas. Un negocio real con clientes: Vercel Pro o, más adelante, un
  servidor propio.
- **Nunca con `pnpm dev`.** `pnpm dev` es el modo de desarrollo, para construir y probar la demo: es más lento y
  más permisivo (por ejemplo, deja a las herramientas HTTP llamar a la red local). Un negocio real usa la app
  publicada o, si se instala en un ordenador, la versión compilada con `pnpm build && pnpm start`.
- **Las claves van en un gestor de contraseñas**, nunca en un chat, un documento ni un correo.
- **Nunca subas datos de clientes** al conocimiento ni a las instrucciones de los agentes.

## 1. Las cuentas

- [ ] Un gestor de contraseñas para todas las claves de esta lista.
- [ ] **OpenRouter**, a nombre del negocio y con saldo. Crea la clave en https://openrouter.ai/settings/keys con un
  **límite de gasto**, mejor si se reinicia cada mes.
- [ ] **La privacidad de OpenRouter**, en https://openrouter.ai/settings/privacy: deja apagados el registro de lo que
  envías y la cesión de datos a cambio de descuento, y no permitas proveedores que guarden los datos o entrenen con
  ellos. La app, además, lo prohíbe en cada petición.
- [ ] **Turso**, con un plan que incluya contrato de encargo del tratamiento si va a haber datos reales (el gratuito no
  lo tiene).
- [ ] **Vercel**: Pro para un negocio real; Hobby, solo para pruebas.
- [ ] **GitHub**, si vas a publicar desde un repositorio, que será privado.
- [ ] **cron-job.org**, para el trabajo en segundo plano de cada minuto.
- [ ] **Meta**, si vas a usar WhatsApp: el portfolio empresarial del negocio, con acceso de administrador para quien lo
  implanta, y una tarjeta para el método de pago.
- [ ] **Google Cloud** (para Gmail) o **Microsoft Entra** (para Outlook o Microsoft 365), con una cuenta del negocio,
  si vas a conectar un buzón de esos servicios. Para otro proveedor, los datos IMAP y SMTP de su buzón.
- [ ] Un **servidor de correo (SMTP)** para los correos de la app: invitaciones, recuperación de contraseña, avisos y
  recordatorios.
- [ ] Verificación en dos pasos en todas estas cuentas.

Cómo: guía «Publicar la app en Vercel», apartado «Antes de empezar»; guía «Conectar WhatsApp», apartado «Portfolio»;
guía «Conectar el correo», apartado «Antes de empezar».

## 2. Publicar la app

- [ ] Base de datos en Turso: libSQL (nunca con `--tursodb`) y en una región de la UE.
- [ ] Migraciones aplicadas con `pnpm db:migrate`.
- [ ] Proyecto en Vercel con sus variables solo en Production, las secretas como Sensitive, y `APP_URL` y
  `BETTER_AUTH_URL` con la dirección de producción.
- [ ] Almacén de Vercel Blob **privado**, en la UE y conectado a Production.
- [ ] App desplegada, y `/api/health` responde `"status":"ok"`.
- [ ] Cron cada minuto en cron-job.org, que responde 202.
- [ ] Dominio propio, si lo vas a usar, puesto antes de conectar los canales.
- [ ] `APP_ENCRYPTION_KEY`, `SETUP_TOKEN` y el token de Turso, en el gestor de contraseñas.

Cómo: guía «Publicar la app en Vercel», apartados 1 a 8.

## 3. Instalación vacía y asistente de arranque

- [ ] **Si has publicado con una base nueva,** ya está vacía: no hace falta `pnpm db:fresh`.
- [ ] **Si lo instalas en un ordenador que tenía la demo:** para la app (`pnpm dev`) y ejecuta `pnpm db:fresh`. Te pide
  confirmación, borra todo (la demo y sus usuarios) y deja la instalación vacía. Nunca lo hagas donde ya hay datos
  reales. Después, en `.env.local`, cambia `DEMO_MODE=true` por `DEMO_MODE=false` y pon en `SETUP_TOKEN` un código
  largo al azar (se crea como dice la guía «Publicar la app en Vercel», apartado «4. Las variables de entorno»).
  Arranca la versión compilada con `pnpm build && pnpm start` y, en otra terminal, `pnpm worker`, que hace el trabajo
  en segundo plano (respuestas de la IA, correo y recordatorios). Nunca `pnpm dev` con un negocio real.
- [ ] Abre la app: aparece el asistente de arranque.
- [ ] Paso 1: tu cuenta de propietario y, en una app publicada, el código de instalación (`SETUP_TOKEN`).
- [ ] Pasos 2 a 7: negocio y sector, horario, clave de OpenRouter, primer agente, chat web de prueba y canales. Al
  terminar llegas a la Bandeja.
- [ ] No aparece la franja «Modo demo».

Cómo: guía «Publicar la app en Vercel», apartado «7. Poner en marcha el negocio».

[Captura: el asistente de arranque en su primer paso, con los pasos a la vista]

## 4. Los datos del negocio

- [ ] **Ajustes › Negocio:** nombre, datos de contacto, dirección, sector, zona horaria, logo y color. Salen en la app,
  en el chat web, en las páginas legales y en los correos.
- [ ] **Ajustes › Correo del sistema:** servidor, puerto (465 o 587), seguridad, usuario, contraseña y remitente.
  Pulsa «Enviar correo de prueba».
- [ ] Si el sector es Clínica dental o Clínica/Fisioterapia, la app avisa de que habrá datos de salud: son datos
  especialmente protegidos (apartado 6).

## 5. El horario y los festivos

- [ ] **Ajustes › Horario:** el horario de cada día (puede tener varios tramos) y los festivos y cierres del año.
- [ ] En cada canal, decide qué hace la IA fuera de horario: «Responder igual» o «No responder fuera de horario».

Cómo: guía «La agenda: citas, servicios, recursos y recordatorios», apartado «5. Horario del negocio y festivos»; guía
«Crear agentes y darles el conocimiento del negocio», apartado «5. Ponerlo a responder en un canal».

## 6. Textos legales y privacidad

- [ ] **Ajustes › Privacidad y legal:** política de privacidad, términos del servicio y eliminación de datos. Si los
  dejas vacíos, se usa un texto por defecto con los datos del negocio. Son orientativos: revísalos con un asesor.
- [ ] Las tres páginas se abren sin iniciar sesión: `/legal/privacidad`, `/legal/terminos` y
  `/legal/eliminacion-datos`. Meta y Google piden sus direcciones.
- [ ] **Aviso de IA:** el texto que va en el primer mensaje de cada conversación (lo exige el Reglamento europeo de IA).
  Cada canal puede tener el suyo.
- [ ] **Conservación de los datos:** por defecto, conversaciones 12 meses, notas de voz 30 días tras transcribirlas,
  adjuntos 90 días y avisos en bruto de los canales 14 días. Elige si las conversaciones caducadas se borran o se
  anonimizan.
- [ ] **Con datos de salud:** plazos más cortos, «Sin retención de datos» activado en Ajustes › IA y ningún diagnóstico
  por chat.
- [ ] **Contrato de encargo del tratamiento** firmado entre el negocio y quien implanta o aloja la app. Hay una
  plantilla en el repositorio (`docs/contrato-encargo-tratamiento.md`): revísala con un abogado.
- [ ] Los contratos de encargo de los servicios que tratan datos, aceptados en cada uno: Turso, Vercel, OpenRouter y,
  si los usas, Meta, Google o Microsoft.

[Captura: Ajustes › Privacidad y legal, con los textos legales, el aviso de IA y los plazos de conservación]

## 7. La IA

- [ ] **Ajustes › IA:** pega la clave de OpenRouter y pulsa «Probar clave».
- [ ] Revisa los modelos por defecto (chat, transcripción, embeddings y descripción de imágenes). Los recomendados valen
  para empezar.
- [ ] «Sin retención de datos»: opcional, y muy recomendable con datos de salud.
- [ ] La clave de Mistral OCR, solo si vas a subir PDF escaneados.
- [ ] «Reordenar resultados», opcional: mejora las respuestas del conocimiento y cuesta un poco más.

Cómo: guía «Crear agentes y darles el conocimiento del negocio», apartados «Antes de empezar» y «Modelo de embeddings
y reindexar».

## 8. El primer agente y su conocimiento

- [ ] Agente creado desde la plantilla del sector o con «Generar borrador con IA» a partir de la web del negocio.
- [ ] Instrucciones revisadas: solo temas del negocio, qué no debe hacer y cuándo pasar a una persona.
- [ ] Una base de conocimiento con documentos, páginas de la web y preguntas frecuentes, todos en «Listo».
- [ ] El agente usa la base («Usar» encendido) y busca en ella: «Automático», con «Buscar en el conocimiento»
  encendida, o «Buscar siempre».
- [ ] «Probar búsqueda» con 5 a 10 preguntas reales de clientes: encuentra la respuesta.
- [ ] Traspaso configurado: palabras clave, temas sensibles, cuántos «no lo sé», mensajes al cliente y a quién avisar.
- [ ] Pruebas en «Probar», con «Simular canal»: preguntas frecuentes, algo que no está en el conocimiento (tiene que
  decir que no lo sabe y ofrecer una persona), un tema ajeno al negocio y «quiero hablar con una persona».
- [ ] Si el agente tiene que hablar con otros programas (n8n, tu CRM…), sus herramientas HTTP creadas y probadas.

Cómo: guía «Crear agentes y darles el conocimiento del negocio».

## 9. La agenda, si das citas o reservas

- [ ] **Agenda › Configuración › General:** las palabras (cita o reserva…), el modo (por recurso o por aforo) y el
  intervalo de los huecos.
- [ ] Servicios: duración, márgenes, precio orientativo, descripción para el agente, quién los hace y antelación mínima
  y máxima.
- [ ] Recursos (profesionales, mesas, salas…) con su horario y sus ausencias.
- [ ] Herramientas de la agenda encendidas en el agente: «Consultar huecos libres», «Crear citas» y las demás que
  quieras.
- [ ] Una reserva de prueba en «Probar» y, después, «Borrar citas de prueba».

Cómo: guía «La agenda: citas, servicios, recursos y recordatorios».

## 10. Los canales, primero en pruebas

- [ ] **Chat web:** el del asistente o uno nuevo (Canales › Añadir canal › Chat web). Pruébalo en `/widget-demo`. En
  «Apariencia y código», añade el dominio de tu web, pero todavía no pegues el código en ella.
- [ ] **WhatsApp:** primero con el número de prueba de Meta y después con el real. App de Meta publicada (Live), método
  de pago añadido, plantillas sincronizadas y «Modo pruebas» con tu número.
- [ ] **Correo:** Gmail, Outlook u otro servidor, en «Borrador para revisar» al principio y con «Modo pruebas» con tu
  dirección. Pruébalo escribiendo desde otra dirección.
- [ ] En cada canal: agente activo, IA encendida, modo de respuesta, fuera de horario y aviso de IA.

Cómo: guía «Conectar WhatsApp», apartados «Número de prueba de Meta» y «Prueba»; guía «Conectar el correo», apartado
«Prueba»; guía «Crear agentes y darles el conocimiento del negocio», apartado «5. Ponerlo a responder en un canal».

## 11. Los recordatorios

- [ ] **Ajustes › Recordatorios** (vienen desactivados): cuándo y por dónde. Por WhatsApp, con una plantilla de
  utilidad aprobada por Meta (cada recordatorio se cobra). Por email: si el cliente ya escribió a un buzón conectado
  del negocio, sale por ese buzón en su mismo hilo y su respuesta llega a la Bandeja; si no, sale del correo del
  sistema y las respuestas van al buzón conectado o, si no hay ninguno, al email de contacto de Ajustes › Negocio.
- [ ] Si no conectas ningún buzón, pon en Ajustes › Negocio un email de contacto que alguien lea: ahí llegan las
  respuestas a los recordatorios por email (para cancelar la cita o pedir no recibir más), y las atiende una persona.
- [ ] Una cita de prueba a tu nombre recibe su recordatorio.

Cómo: guía «La agenda: citas, servicios, recursos y recordatorios», apartado «10. Recordatorios».

## 12. El equipo: usuarios, roles y verificación en dos pasos

- [ ] **Ajustes › Usuarios › Invitar:** el email y el rol de cada persona: Administrador, Supervisor, Agente (solo sus
  canales) o Solo lectura. La invitación caduca a los 7 días; sin correo del sistema, la app te da el enlace para que
  lo envíes tú.
- [ ] El propietario y los administradores activan la verificación en dos pasos en **Mi cuenta**, con una app de
  códigos, y guardan sus códigos de recuperación.
- [ ] Después, en Ajustes › Usuarios, activa «Exigir verificación en dos pasos a propietario y administradores».
- [ ] Cada persona tiene su propia cuenta: nadie comparte contraseña.

## 13. Los avisos y la app instalada

- [ ] **Ajustes › Notificaciones:** qué sucesos avisan y a quién (traspaso, conversación asignada, canal con error,
  calidad de WhatsApp, modelo que se retira y cita pendiente de confirmar), y cuántas horas se pausa la IA cuando
  responde una persona (12 por defecto).
- [ ] Cada persona instala la app en su móvil o en su ordenador y activa los avisos en cada dispositivo. En el iPhone,
  primero hay que añadir la app a la pantalla de inicio. Hace falta la app publicada con HTTPS.
- [ ] Los avisos por email necesitan el correo del sistema.

## 14. Conversaciones de prueba

- [ ] **Ajustes › Diagnóstico › Simulador:** un texto, una nota de voz, una imagen y un documento. Llegan a la Bandeja y
  la IA responde.
- [ ] Desde tu móvil y tu correo, con los canales en «Modo pruebas»: una pregunta, una reserva, una nota de voz y
  «quiero hablar con una persona» (tiene que haber traspaso y aviso al equipo).
- [ ] Una persona responde desde la Bandeja: la IA se pausa («IA en pausa hasta …»).
- [ ] Escribe «BAJA»: recibes la confirmación y la IA deja de contestarte por ese canal. Después quita la baja desde tu
  ficha de contacto.
- [ ] «Ver fuentes», bajo una respuesta de la IA, abre «¿Por qué respondió esto?». Prueba también «Convertir en FAQ».
- [ ] **Ajustes › Diagnóstico:** sin trabajos fallidos ni errores de la IA, y con el último aviso de cada canal.
- [ ] **Ajustes › Diagnóstico › Pruebas de conexión:** «Probar clave» de OpenRouter, «Enviar correo de prueba» y la
  prueba de cada canal (revalidar WhatsApp con Meta, el acceso a Gmail u Outlook, «Probar conexión» de otro buzón),
  todas correctas.

[Captura: Ajustes › Diagnóstico, con la «Última ronda» reciente y sin trabajos fallidos]

## 15. Abrir a los clientes

- [ ] Vercel Pro y el plan de Turso con contrato de encargo, si todavía estabas en los gratuitos.
- [ ] Desactiva el «Modo pruebas» de cada canal.
- [ ] Pega el código del chat web en tu web.
- [ ] Hay una copia de seguridad reciente y `APP_ENCRYPTION_KEY` está a salvo.
- [ ] El equipo sabe quién atiende los traspasos, y lo hace cuanto antes. Si tu empresa entra en la Ley 10/2025 de
  atención a la clientela (grandes empresas y servicios básicos), mira en Informes que las peticiones de hablar con
  una persona se atienden en menos de 3 minutos.
- [ ] Los primeros días, mira a menudo la Bandeja, las conversaciones «Pendiente de humano» y Ajustes › Diagnóstico.

## Cada semana

- [ ] **Bandeja:** ninguna conversación «Pendiente de humano» sin respuesta.
- [ ] Revisa unas cuantas respuestas de la IA con «¿Por qué respondió esto?». Si falta algo, añádelo al conocimiento o
  usa «Convertir en FAQ».
- [ ] **Ajustes › Diagnóstico:** trabajos fallidos, errores de la IA, «Última ronda» reciente y último aviso de cada
  canal.
- [ ] **Canales:** los semáforos de cada número de WhatsApp y los buzones que piden reconexión.
- [ ] El gasto de OpenRouter frente al límite de la clave.

## Cada mes

- [ ] **Informes:** conversaciones por canal, lo que resuelve la IA, traspasos y sus motivos, tiempo hasta la primera
  respuesta de una persona, citas de la IA y coste de la IA y de WhatsApp.
- [ ] Las facturas de OpenRouter, Meta, Vercel y Turso. Si Meta cambia sus tarifas, ponlas al día en Ajustes ›
  WhatsApp.
- [ ] Hay copias recientes de la base y, cada pocos meses, pruebas que se pueden restaurar.
- [ ] Las claves que caducan: el Client Secret de Microsoft (la app avisa 30 días antes) y la clave de OpenRouter, si
  tiene fecha.
- [ ] **Ajustes › Usuarios:** quita a quien ya no trabaja con vosotros y revisa los roles.
- [ ] Los avisos «Modelo que se retira» (en la campana y, si lo tienes así en Mi cuenta, por email): cambia el modelo
  del agente, o el de Ajustes › IA, antes de la fecha.
- [ ] Las versiones nuevas y los parches de seguridad se instalan siempre con una copia de seguridad antes (guía
  «Publicar la app en Vercel», apartado «9. Publicar una versión nueva»).
- [ ] Los textos legales y los plazos de conservación siguen siendo correctos.
