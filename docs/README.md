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
| `docs/modelo-de-datos.md` | Qué tablas guarda la app, sus campos clave y estados, qué no se puede repetir, qué se cifra y a qué reglas de la especificación sirve cada una; también cómo se evitan las dobles reservas | Cuando se añade o cambia una tabla o un campo importante |
| `docs/security.md` | Cómo se cumple la seguridad, qué se revisa al publicar y después, y las excepciones aprobadas | Cuando cambia una tecnología o se aprueba una excepción |
| `docs/conventions.md` | Cómo se crea el proyecto, cómo se consulta la documentación de las librerías y cómo se escribe y se organiza el código | Cuando cambia una tecnología o la organización del código |
| `docs/testing.md` | Qué se prueba y cómo | Cuando cambia una herramienta de pruebas |
| `docs/review.md` | Quién revisa cada fase, qué comprueba y qué devuelve | Cuando cambia la forma de revisar |
| `docs/deployment.md`, desde la primera publicación | Cómo se publica, cómo llegan a producción los cambios de la base de datos y cómo se vuelve atrás | Cuando cambia la forma de publicar |
| `docs/integracion-whatsapp.md` | Conexión y gestión de un número de WhatsApp con la API oficial de Meta: token, App Secret, registro, suscripciones, panel del número y límites | Cuando cambia la API de Meta o la forma de conectar |
| `docs/integracion-whatsapp-mensajes.md` | Cómo llegan los mensajes y los estados de WhatsApp, cómo se descargan los medios, cómo se envía y qué límites y precios hay | Cuando cambia la API de Meta o su forma de cobrar |
| `docs/integracion-openrouter.md` | Todo lo que la app usa de OpenRouter: clave, modelos, chat con herramientas, audio, PDF, embeddings, rerank, errores y privacidad | Cuando cambia la API de OpenRouter o los modelos recomendados |
| `docs/integracion-correo.md` | Los conectores de correo (Gmail, Outlook / Microsoft 365 e IMAP/SMTP): acceso, recepción, envío en el mismo hilo y filtros | Cuando cambian las API de Google o Microsoft o los servidores de correo |
| `docs/busqueda-hibrida.md` | La búsqueda del conocimiento en Postgres: vectores con pgvector (`halfvec` y HNSW), texto con `tsvector` y `es_unaccent`, fusión de resultados, troceado y embeddings de la demo | Cuando cambia la búsqueda o la base de datos |
| `docs/integracion-mistral-ocr.md` | El OCR de Mistral para los PDF escaneados del conocimiento: petición, límites y precio | Cuando cambia la API de Mistral |
| `docs/plataforma-despliegue.md` | Dónde corre la app y con qué límites: Vercel, Supabase (base de datos, Storage, Cron, claves y copias), la base integrada de la demo y el futuro VPS con Dokploy | Cuando cambia la plataforma o sus límites |
| `docs/notificaciones-push.md` | Los avisos push de la app instalada (PWA) con Web Push y claves VAPID, también en iPhone | Cuando cambia la forma de avisar |
| `docs/integracion-telegram.md` | El canal opcional de Telegram: bot, avisos con secreto, archivos y límites | Cuando cambia la Bot API o se construye el canal |
| `docs/guia-despliegue.md` (fase 0, rehecha en la fase 8) | Guía paso a paso para publicar una instalación: Vercel con Supabase (base de datos, archivos y cron), y más adelante el VPS | Cuando cambia la forma de publicar |
| `docs/guia-whatsapp.md` (fase 3) | Guía para que el negocio conecte su número: portfolio y acceso de administrador para quien implanta, app de Meta, número, token, publicación, pago, límites y cuándo verificar la empresa, tope de 15 apps, prueba con el número de Meta y problemas frecuentes (contenido mínimo en [ARR-23]) | Cuando cambia el asistente de WhatsApp o Meta |
| `docs/guia-correo.md` (fase 6) | Guía para conectar Gmail (Google Cloud), Outlook (Microsoft Entra) u otro servidor IMAP/SMTP, paso a paso | Cuando cambia el asistente de correo, Google o Microsoft |
| `docs/guia-agentes-y-conocimiento.md` (fases 1 y 4) | Guía para crear, ajustar y probar agentes y darles el conocimiento del negocio: archivos de contexto, bases con documentos, webs y preguntas frecuentes, «Probar búsqueda» y las fuentes de cada respuesta | Cuando cambian los agentes o el conocimiento |
| `docs/guia-agenda.md` (fase 5) | Guía para preparar la agenda: palabras, modo por recurso o por aforo, servicios, recursos, horarios, ausencias y bloqueos, el calendario, qué hace el agente con las citas, las citas de prueba y los recordatorios | Cuando cambia la agenda |
| `docs/checklist-puesta-en-marcha.md` (fase 7) | Lista para poner en marcha un negocio real, de `pnpm db:fresh` a la primera conversación, con la privacidad de OpenRouter y las comprobaciones de cada semana y cada mes (también en la app, en `/ayuda/puesta-en-marcha`) | Cuando cambia algún paso de la puesta en marcha |
| `docs/contrato-encargo-tratamiento.md` (fase 7) | Plantilla de contrato de encargo del tratamiento de datos personales, marcada «revisar con un abogado» ([CUM-09]); se queda en `docs/`, no en Ayuda | Cuando cambia la ley o los servicios que tratan datos |
| `docs/decisions/` | Por qué el proyecto es como es: una decisión técnica por archivo (la lista, abajo en «Decisiones») | Cada vez que se toma una |

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

Las decisiones de hoy:

| Decisión | De qué trata |
|---|---|
| 0001 | Una instalación por negocio (single-tenant) |
| 0002 | Next.js con el runtime de Node en todas las rutas |
| 0003 | Datos en libSQL (archivo local y Turso), Supabase en el futuro (sustituida por 0024) |
| 0004 | Usuarios con Better Auth y roles en una tabla propia |
| 0005 | IA con OpenRouter y un cliente propio, sin AI SDK |
| 0006 | Solo pnpm |
| 0007 | Publicación: solo en local, Vercel para pruebas después y un VPS con Dokploy en el futuro |
| 0008 | Trabajo en segundo plano con la tabla `jobs` y `tick()` |
| 0009 | Tiempo real por sondeo |
| 0010 | Archivos en disco en local y en Vercel Blob privado al publicar (sustituida por 0024) |
| 0011 | WhatsApp con la Cloud API oficial de Meta como desarrollador directo |
| 0012 | Correo con la API de Gmail, Microsoft Graph e IMAP/SMTP, con credenciales de cada negocio |
| 0013 | Embeddings de 1536 dimensiones fijas |
| 0014 | Construcción autónoma por fases, con agentes en paralelo |
| 0015 | Diseño propio, recogido en `DESIGN.md` |
| 0016 | Código de instalación para crear el primer propietario |
| 0017 | Cómo se comprueban los modelos y qué se acota de la IA |
| 0018 | El respaldo de la transcripción, solo si no guarda datos |
| 0019 | WhatsApp solo con un token de usuario del sistema |
| 0020 | Topes de los avisos de WhatsApp antes de comprobar la firma (sustituida en parte por 0022) |
| 0021 | Relevancia del conocimiento, embeddings pendientes al arrancar y modelos de reordenación |
| 0022 | La firma de los avisos de WhatsApp, antes de leer el aviso |
| 0023 | Cómo se cuentan las cifras de los informes |
| 0024 | Datos y archivos en Supabase, con Postgres integrado (PGlite) para la demo y las pruebas |
