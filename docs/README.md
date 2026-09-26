# Documentación del proyecto

Esta carpeta es la memoria del proyecto: quien llegue nuevo, persona o agente, tiene que poder entenderlo
leyendo solo esto.

## Qué hay

| Documento | Qué contiene | Cuándo se actualiza |
|---|---|---|
| `docs/spec.md` | Qué hace la app y con qué reglas, quién puede hacer qué, qué queda fuera, las fases y su estado | En la entrevista, al cerrar cada fase y cuando se pide algo nuevo o un cambio |
| `docs/interview.md` | Cómo se me entrevista para escribir o cambiar la especificación, y las opciones de tecnología con lo que supone cada una | Cuando cambia la forma de entrevistar o las opciones |
| `docs/design.md` | Cómo se decide el aspecto de la app, cómo se encarga un diseño fuera y cómo se aplica | Cuando cambia la forma de diseñar o los componentes |
| `DESIGN.md`, en la raíz y solo si hay diseño | Las reglas del diseño: colores, tipografía, espaciado, bordes y componentes | Cuando cambia el diseño |
| `docs/pantallas.md` | Qué pantallas tiene la app, para quién, qué se ve y se hace en cada una y cómo se pasa de una a otra | Cuando se añade o cambia una pantalla |
| `docs/architecture.md` | Cómo está hecho el sistema y cómo encajan sus piezas | Con la primera versión y cuando cambia cómo está hecho |
| `docs/modelo-de-datos.md` | Qué tablas guarda la app, sus campos clave y estados, qué no se puede repetir, qué se cifra y a qué reglas de la especificación sirve cada una; también cómo se evitan las dobles reservas, ahora y en Postgres | Cuando se añade o cambia una tabla o un campo importante |
| `docs/security.md` | Cómo se cumple la seguridad, qué se revisa al publicar y después, y las excepciones aprobadas | Cuando cambia una tecnología o se aprueba una excepción |
| `docs/conventions.md` | Cómo se crea el proyecto, cómo se consulta la documentación de las librerías y cómo se escribe y se organiza el código | Cuando cambia una tecnología o la organización del código |
| `docs/testing.md` | Qué se prueba y cómo | Cuando cambia una herramienta de pruebas |
| `docs/review.md` | Quién revisa cada fase, qué comprueba y qué devuelve | Cuando cambia la forma de revisar |
| `docs/deployment.md`, desde la primera publicación | Cómo se publica, cómo llegan a producción los cambios de la base de datos y cómo se vuelve atrás | Cuando cambia la forma de publicar |
| `docs/integracion-whatsapp.md` | Conexión y gestión de un número de WhatsApp con la API oficial de Meta: token, App Secret, registro, suscripciones, panel del número y límites | Cuando cambia la API de Meta o la forma de conectar |
| `docs/integracion-whatsapp-mensajes.md` | Cómo llegan los mensajes y los estados de WhatsApp, cómo se descargan los medios, cómo se envía y qué límites y precios hay | Cuando cambia la API de Meta o su forma de cobrar |
| `docs/integracion-openrouter.md` | Todo lo que la app usa de OpenRouter: clave, modelos, chat con herramientas, audio, PDF, embeddings, rerank, errores y privacidad | Cuando cambia la API de OpenRouter o los modelos recomendados |
| `docs/integracion-correo.md` | Los conectores de correo (Gmail, Outlook / Microsoft 365 e IMAP/SMTP): acceso, recepción, envío en el mismo hilo y filtros | Cuando cambian las API de Google o Microsoft o los servidores de correo |
| `docs/busqueda-hibrida.md` | La búsqueda del conocimiento: vectores y FTS5 en libSQL, fusión de resultados, troceado, embeddings de la demo y su paso a Supabase | Cuando cambia la búsqueda o la base de datos |
| `docs/integracion-mistral-ocr.md` | El OCR de Mistral para los PDF escaneados del conocimiento: petición, límites y precio | Cuando cambia la API de Mistral |
| `docs/plataforma-despliegue.md` | Dónde corre la app y con qué límites: Vercel, Vercel Blob, Turso, el cron externo y el futuro VPS con Dokploy | Cuando cambia la plataforma o sus límites |
| `docs/notificaciones-push.md` | Los avisos push de la app instalada (PWA) con Web Push y claves VAPID, también en iPhone | Cuando cambia la forma de avisar |
| `docs/integracion-telegram.md` | El canal opcional de Telegram: bot, avisos con secreto, archivos y límites | Cuando cambia la Bot API o se construye el canal |
| `docs/guia-despliegue.md` (fase 0) | Guía paso a paso para publicar una instalación: Vercel con Turso, Blob y cron, y más adelante el VPS | Cuando cambia la forma de publicar |
| `docs/guia-whatsapp.md` (fase 3) | Guía para que el negocio conecte su número: portfolio y acceso de administrador para quien implanta, app de Meta, número, token, publicación, pago, límites y cuándo verificar la empresa, tope de 15 apps, prueba con el número de Meta y problemas frecuentes (contenido mínimo en [ARR-23]) | Cuando cambia el asistente de WhatsApp o Meta |
| `docs/guia-correo.md` (fase 6) | Guía para conectar Gmail (Google Cloud), Outlook (Microsoft Entra) u otro servidor IMAP/SMTP, paso a paso | Cuando cambia el asistente de correo, Google o Microsoft |
| `docs/guia-agentes-y-conocimiento.md` (fase 1, completa en la 4) | Guía para crear, ajustar y probar agentes y cargar el conocimiento del negocio (la parte de agentes ya está; la de conocimiento llega con su fase) | Cuando cambian los agentes o el conocimiento |
| `docs/guia-agenda.md` (fase 7) | Guía para configurar la agenda: servicios, recursos, horarios y recordatorios | Cuando cambia la agenda |
| `docs/checklist-puesta-en-marcha.md` (fase 7) | Lista para poner en marcha un negocio real, de `pnpm db:fresh` a la primera conversación | Cuando cambia algún paso de la puesta en marcha |
| `docs/contrato-encargo-tratamiento.md` (fase 7) | Plantilla de contrato de encargo del tratamiento de datos personales, marcada «revisar con un abogado» | Cuando cambia la ley o los servicios que tratan datos |
| `docs/decisions/` | Por qué el proyecto es como es: una decisión técnica por archivo | Cada vez que se toma una |

## Normas

- Tantos documentos cortos como hagan falta, uno por tema. Si uno empieza a tratar dos cosas, se parte en
  dos.
- Una parte del sistema que necesita explicación propia (una integración, un flujo, un módulo) tiene su
  `docs/<nombre-de-la-parte>.md`.
- Nombres en minúsculas, con guiones y sin tildes ni espacios: `integracion-pagos.md`.
- Cada documento nuevo se añade a la tabla de arriba, con una línea sobre qué contiene. Las decisiones no:
  basta con su fila.
- Se documenta el porqué y lo que el código no cuenta. No se copia código ni se listan carpetas.
- Las guías (`docs/guia-*.md` y la lista de puesta en marcha) también se ven dentro de la app, en Ayuda
  ([AJU-17]): se escriben para el negocio y no llevan secretos ni detalles internos.
- No hay documento de estado: el estado son las fases de `docs/spec.md`.
- Si el código y un documento se contradicen, se avisa antes de cambiar ninguno de los dos.
- Todo en UTF-8.

## Decisiones

- Un archivo por decisión en `docs/decisions/`, con la estructura de `docs/decisions/plantilla.md`. Nombre:
  número de cuatro cifras, el siguiente al último, y título con guiones: `0003-hosting.md`.
- Merece archivo lo que costaría rehacer si cambia: el framework, la base de datos, el inicio de sesión, el
  hosting, cómo se guardan los datos o cómo se conecta con otro servicio. No lo merecen los colores, los
  textos ni lo que se cambia en un minuto.
- Se guarda como «propuesta» y pasa a «aceptada» o «rechazada» cuando se decide. No se borra ni se
  reescribe: si cambia, se crea una nueva y en la antigua solo cambia el estado, a «sustituida por NNNN».
