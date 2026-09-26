---
version: alpha
name: DominIA Agentes
description: Panel de atención al cliente con agentes de IA para un negocio (single-tenant). Sobrio, profesional y denso en datos; claro por defecto y con modo oscuro; el color y el logo son los del negocio.
colors:
  brand-default: "#3d6df2"
  primary: "#3c6cf1"
  primary-foreground: "#ffffff"
  primary-text: "#3462e6"
  primary-soft: "#eaf1ff"
  background: "#ffffff"
  foreground: "#09090b"
  card: "#ffffff"
  muted: "#f4f4f5"
  muted-foreground: "#65656f"
  border: "#e4e4e7"
  input: "#8b8b96"
  sidebar: "#fafafa"
  sidebar-accent: "#f4f4f5"
  destructive: "#e7000b"
  destructive-text: "#c10007"
  destructive-soft: "#fef2f2"
  success: "#007a55"
  success-soft: "#ecfdf5"
  warning: "#bb4d00"
  warning-soft: "#fffbeb"
  info: "#0069a8"
  info-soft: "#f0f9ff"
  ai: "#7008e7"
  ai-soft: "#f5f3ff"
  channel-whatsapp: "#008236"
  channel-email: "#ca3500"
  channel-web: "#65656f"
  channel-telegram: "#0069a8"
  primary-dark: "#3c6cf1"
  primary-foreground-dark: "#ffffff"
  primary-text-dark: "#5a89fe"
  primary-soft-dark: "#131b31"
  background-dark: "#09090b"
  foreground-dark: "#fafafa"
  card-dark: "#18181b"
  muted-dark: "#27272a"
  muted-foreground-dark: "#9f9fa9"
  border-dark: "#ffffff1a"
  input-dark: "#73737e"
  sidebar-dark: "#18181b"
  sidebar-accent-dark: "#27272a"
  destructive-dark: "#ff6467"
  destructive-text-dark: "#ff6467"
  destructive-soft-dark: "#460809"
  success-dark: "#00d492"
  success-soft-dark: "#002c22"
  warning-dark: "#ffb900"
  warning-soft-dark: "#461901"
  info-dark: "#00bcff"
  info-soft-dark: "#052f4a"
  ai-dark: "#a684ff"
  ai-soft-dark: "#2f0d68"
  channel-whatsapp-dark: "#05df72"
  channel-email-dark: "#ff8904"
  channel-web-dark: "#9f9fa9"
  channel-telegram-dark: "#00bcff"
typography:
  page-title:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: -0.015em
  section-title:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: 600
    lineHeight: 28px
  card-title:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: 600
    lineHeight: 24px
  body:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  body-mobile:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
  label:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
  caption:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
  kpi:
    fontFamily: Geist
    fontSize: 30px
    fontWeight: 600
    lineHeight: 36px
    fontFeature: '"tnum"'
  mono:
    fontFamily: Geist Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
rounded:
  sm: 0.3rem
  md: 0.4rem
  lg: 0.5rem
  xl: 0.7rem
  2xl: 0.9rem
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
  page-x: 24px
  page-x-mobile: 16px
  row: 40px
  row-touch: 48px
  touch-target: 44px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 0 16px
  button-primary-touch:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: 44px
    padding: 0 20px
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 0 16px
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 0 16px
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 0 12px
  input-touch:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-mobile}"
    rounded: "{rounded.md}"
    height: 44px
    padding: 0 12px
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: 24px
  sidebar:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.foreground}"
    width: 256px
  sidebar-item-active:
    backgroundColor: "{colors.sidebar-accent}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: 36px
  bottom-nav:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.caption}"
    height: 56px
  table-row:
    height: 40px
    typography: "{typography.body}"
  table-row-touch:
    height: 48px
    typography: "{typography.body}"
  badge-status:
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 2px 8px
    height: 22px
  bubble-contact:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.2xl}"
    padding: 8px 12px
  bubble-ai:
    backgroundColor: "{colors.ai-soft}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.2xl}"
    padding: 8px 12px
  bubble-human:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.2xl}"
    padding: 8px 12px
  note-internal:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 8px 12px
  banner-demo:
    backgroundColor: "{colors.info-soft}"
    textColor: "{colors.info}"
    typography: "{typography.caption}"
    height: 32px
  banner-openrouter:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 12px 16px
  widget-launcher:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.full}"
    size: 56px
  widget-panel:
    backgroundColor: "#ffffff"
    textColor: "{colors.foreground}"
    rounded: 16px
    width: 380px
    height: 640px
---

# DESIGN.md · DominIA Agentes

Reglas visuales de la app. Camino 2 de `docs/design.md` («las diseñas tú»), a partir de las respuestas del
2026-09-26. Las pantallas y su contenido están en `docs/pantallas.md`; lo que hace cada una lo manda la
especificación. El tema se aplica una sola vez (variables de shadcn/ui en los estilos globales, expuestas a
Tailwind con `@theme inline`) y todas las pantallas lo usan.

Los valores del bloque YAML de arriba son los del tema claro con el color por defecto; los que acaban en
`-dark` son los del tema oscuro. Los colores de `primary*` se calculan en tiempo de ejecución a partir del color
del negocio (ver «Colors › Color del negocio»); los que aparecen aquí son el resultado para `#3d6df2`.

## Overview

- **Qué es:** el panel interno de un negocio pequeño o mediano (peluquería, clínica, restaurante…) para
  atender a sus clientes por WhatsApp, correo y chat web con agentes de IA y personas.
- **Qué debe transmitir:** serio, cercano y moderno. Serio porque maneja datos de clientes, claves y dinero;
  cercano porque lo usa personal no técnico; moderno sin modas (nada de degradados, cristal ni sombras de
  colores).
- **Dónde se usa:** propietario, administrador y supervisor, en ordenador. Los agentes (personas del equipo),
  en ordenador y en el móvil como app instalada (PWA), sobre todo la bandeja.
- **Personalidad visual:** base neutra (gris zinc) que no compite con la marca del negocio; el color del
  negocio solo en la acción principal, la selección y el foco; el color semántico solo para estados. Mucha
  información por pantalla, ordenada con espacio y tipografía, no con cajas y colores.
- **Marca:** logo y color principal configurables en Ajustes › Negocio. Por defecto, azul DominIA `#3d6df2`
  y el nombre «DominIA Agentes».
- **Temas:** claro por defecto; oscuro opcional (Claro / Oscuro / Sistema en el menú de usuario), recordado
  por dispositivo. Con next-themes (`attribute="class"`, `defaultTheme="light"`) y la variante `dark` de
  shadcn/ui.
- **Base técnica:** shadcn/ui sobre Tailwind v4, color base zinc, iconos lucide. Desde julio de 2026
  shadcn/ui usa Base UI por defecto (Radix sigue soportado): da igual cuál elija la fase 0, estas reglas son
  las mismas.

## Colors

### Base neutra (zinc)

Parte del color base zinc de shadcn/ui, con **dos cambios por accesibilidad** (WCAG 2.2 AA):

| Token | Claro | Oscuro | Uso | Por qué |
|---|---|---|---|---|
| `--background` | `#ffffff` | `#09090b` | Fondo de página | |
| `--foreground` | `#09090b` | `#fafafa` | Texto principal (19,9:1 / 19,1:1) | |
| `--card`, `--popover` | `#ffffff` | `#18181b` | Tarjetas, menús, diálogos | |
| `--muted`, `--secondary`, `--accent` | `#f4f4f5` | `#27272a` | Superficies secundarias, hover, fila seleccionada neutra | |
| `--muted-foreground` | `#65656f` (oklch 0.51 0.016 286) | `#9f9fa9` | Texto secundario | **Cambio:** el zinc-500 de serie da 4,39:1 sobre `--muted`; este da ≥5,07:1 en todas las superficies claras |
| `--border` | `#e4e4e7` | blanco 10 % | Separadores y bordes de tarjeta (decorativos) | |
| `--input` | `#8b8b96` (oklch 0.64 0.016 286) | `#73737e` (oklch 0.56 0.016 286) | Borde de campos, casillas, interruptores apagados | **Cambio:** el borde de un campo debe tener 3:1 (WCAG 1.4.11); el de serie da 1,27:1. Este da ≥3,07:1 claro y ≥3,18:1 oscuro |
| `--sidebar` / `--sidebar-accent` | `#fafafa` / `#f4f4f5` | `#18181b` / `#27272a` | Menú lateral / elemento activo | |

### Color del negocio (`--primary`)

Se guarda uno solo (`business_settings`, `#rrggbb`). Si falta o no es válido se usa `#3d6df2`. En el
servidor, una función pura (con pruebas) calcula para cada tema:

1. **`--primary`**: el color tal cual si tiene 3:1 con la superficie menos favorable del tema (`--muted`).
   Si no, se oscurece (claro) o aclara (oscuro) en OKLCH, manteniendo el tono, lo mínimo para llegar.
2. **`--primary-foreground`**: blanco si da 4,5:1. Si no, se prueba a oscurecer `--primary` como mucho 0,06
   de luminosidad OKLCH (no se nota) para que el blanco llegue sin romper el paso 1. Si tampoco, negro (que
   entonces siempre pasa de 4,5:1, porque el producto de ambos contrastes es 21).
3. **`--primary-text`** (enlaces, texto e iconos de acento): `--primary` ajustado hasta 4,5:1 con `--muted` y
   con `--primary-soft`.
4. **`--primary-soft`**: mezcla de `--primary` con el fondo (`color-mix` en oklab), 10 % en claro
   (`#eaf1ff`) y 20 % en oscuro (`#131b31`). Fondo de fila seleccionada y de chips de filtro activos.
5. `--ring`, `--sidebar-primary` y `--chart-1` son `--primary`.

Se inyecta como `<style>` (`:root{…}` y `.dark{…}`) en el layout raíz y se recalcula al guardar el ajuste.
El mismo cálculo sirve para el color de cada chat web (widget).

Resultados verificados con la fórmula WCAG:

| Color de entrada | Claro: fondo / texto encima | Oscuro: fondo / texto encima | `--primary-text` claro / oscuro |
|---|---|---|---|
| `#3d6df2` (por defecto) | `#3c6cf1` / blanco 4,56:1 | `#3c6cf1` / blanco 4,56:1 | `#3462e6` / `#5a89fe` |
| `#ffd400` (amarillo) | `#a88b09` / negro 6,36:1 | `#ffd400` / negro 14,67:1 | `#846d01` / `#ffd400` |
| `#1e2a4a` (marino) | `#1e2a4a` / blanco 14,14:1 | `#617095` / blanco 4,93:1 | `#1e2a4a` / `#7e8eb4` |

El azul DominIA con texto blanco da 4,499:1: se queda a una milésima del mínimo. Por eso el paso 2 lo lleva a
`#3c6cf1`, que a la vista es el mismo color.

En Ajustes › Negocio, el selector de color enseña una vista previa (botón, enlace, elemento de menú activo)
y el resultado en palabras: «Texto blanco · contraste 4,56:1 · cumple» o «Hemos oscurecido un poco tu color
en el tema claro para que se lea bien».

### Colores semánticos

Fijos, no dependen de la marca. Cada uno tiene color (texto e icono) y fondo suave. Valores de la paleta de
Tailwind v4 (claro 700 sobre 50; oscuro 400 sobre 950). Todos los pares de texto dan al menos 4,5:1.

| Token | Claro | Oscuro | Significa |
|---|---|---|---|
| `--success` / `-soft` | `#007a55` / `#ecfdf5` | `#00d492` / `#002c22` | Correcto, conectado, resuelta, confirmada |
| `--warning` / `-soft` | `#bb4d00` / `#fffbeb` | `#ffb900` / `#461901` | Requiere atención, pendiente, aviso |
| `--destructive` | `#e7000b` | `#ff6467` | Botones de borrar (claro: blanco encima, 4,77:1; oscuro: fondo al 60 % sobre el fondo, blanco encima, 6,47:1) |
| `--destructive-text` / `-soft` | `#c10007` / `#fef2f2` | `#ff6467` / `#460809` | Error, fallido, no presentado |
| `--info` / `-soft` | `#0069a8` / `#f0f9ff` | `#00bcff` / `#052f4a` | Información, abierta, leído, «Modo demo» |
| `--ai` / `-soft` | `#7008e7` / `#f5f3ff` | `#a684ff` / `#2f0d68` | Todo lo que hace la IA |

Se exponen a Tailwind con `@theme inline` (`bg-success-soft`, `text-warning`…). El color nunca va solo:
siempre con icono y texto (WCAG 1.4.1).

### Autores de los mensajes

| Autor | Lado | Burbuja | Marca visible |
|---|---|---|---|
| Cliente | izquierda | `--muted`, texto `--foreground` | Nombre del contacto solo en correo y al cambiar de autor |
| IA | derecha | `--ai-soft` con borde 1 px `--ai` al 25 % | Icono `bot` + «IA · {nombre del agente}» en `--ai` |
| Persona del equipo | derecha | `--primary` sólido, texto `--primary-foreground` | Icono `headset` + nombre de la persona |
| Sistema | centro, sin burbuja | Texto `caption` en `--muted-foreground` | Icono `info` (traspasos, pausas, citas creadas, bajas) |
| Nota interna | ancho completo | `--warning-soft`, borde discontinuo `--warning` | Icono `sticky-note` + «Nota interna · solo la ve el equipo» |
| Borrador (correo) | derecha | `--card`, borde discontinuo `--warning` | Icono `pencil` + «Borrador de la IA · pendiente de revisar» |

### Estados de conversación y modo de IA

| Estado | Token | Icono | Texto |
|---|---|---|---|
| Abierta | `info` | `circle-dot` | Abierta (en la lista no se muestra: es lo normal) |
| Pendiente de humano | `warning` | `hand` | Pendiente de humano (siempre visible en la lista) |
| Resuelta | `success` | `circle-check` | Resuelta |
| IA respondiendo | `ai` | `bot` | IA |
| La atiende una persona | neutro | `headset` | Persona |
| IA en pausa | neutro | `circle-pause` | IA en pausa hasta 18:40 |

### Estados de entrega (mensajes salientes)

Icono más palabra en la línea de datos del mensaje («10:42 · Leído»), nunca solo color.

| Estado | Icono | Color | Texto |
|---|---|---|---|
| queued | `clock` | `--muted-foreground` | En cola |
| sent | `check` | `--muted-foreground` | Enviado |
| delivered | `check-check` | `--muted-foreground` | Entregado |
| read | `check-check` | `--info` | Leído |
| played | `circle-play` | `--info` | Reproducido (solo notas de voz de WhatsApp enviadas por el negocio) |
| failed | `circle-x` | `--destructive-text` | No enviado · Reintentar (con el error en español) |
| draft | `pencil` | `--warning` | Borrador |

### Estados de cita

| Estado | Token | Icono | En el calendario |
|---|---|---|---|
| Pendiente | `warning` | `clock` | Borde discontinuo |
| Confirmada | `success` | `calendar-check` | Borde continuo |
| Cancelada | neutro | `calendar-x` | Oculta por defecto; si se muestran, tachada y al 50 % |
| Completada | neutro | `circle-check-big` | Color del recurso apagado |
| No presentado | `destructive-text` | `user-x` | Etiqueta «No presentado» |

Origen de la cita (icono pequeño): IA `bot` en `--ai`, persona `user-round`, web `globe`.

### Identidad de canal

Lucide no tiene logotipos de marcas (los quitó en su versión 1), así que cada canal se reconoce por un icono
genérico, su nombre y un color propio. Se usa con moderación: icono de 16 px en listas, cuadro de icono de
40 px en las tarjetas de canal, chips de filtro y series de gráficos. Nunca como fondo de áreas grandes ni para
indicar estados.

| Canal | Icono | Claro | Oscuro |
|---|---|---|---|
| WhatsApp | `message-circle` | `#008236` | `#05df72` |
| Correo (Gmail, Outlook, IMAP) | `mail` | `#ca3500` | `#ff8904` |
| Chat web | `globe` | `--muted-foreground` | `--muted-foreground` |
| Telegram (después de la v1) | `send` | `#0069a8` | `#00bcff` |

Todos dan al menos 3:1 con su fondo (objeto no textual). El nombre del canal («WhatsApp · Recepción») va
siempre en texto `--foreground`.

### Colores de recurso (agenda)

El recurso (profesional, sala, mesa) elige entre 8 colores con nombre, no un selector libre: azul, violeta,
rosa, naranja, ámbar, esmeralda, verde azulado y gris (tonos 600 de Tailwind en claro, 400 en oscuro). El
bloque de la cita usa ese color al 14 % sobre `--card` de fondo, una franja izquierda de 3 px con el color
entero y texto `--foreground`, así que el texto se lee igual sea cual sea el color. El nombre del recurso
siempre aparece (columna o texto).

### Gráficos

`--chart-1` = `--primary`, `--chart-2` = `--ai`, `--chart-3` = `--warning`, `--chart-4` = `--success`,
`--chart-5` = `--info`. Por significado: IA frente a personas usa `--ai` y `--primary`; «por canal» usa los
colores de canal; traspasos, `--warning`; costes de IA, `--primary`; coste estimado de WhatsApp, el color de
WhatsApp con trama o menor opacidad y la palabra «estimado».

## Typography

- **Familias:** Geist Sans para toda la interfaz y Geist Mono para identificadores, claves enmascaradas
  (`••••1234`), URLs de webhook, fragmentos de código y recuentos de tokens. Se cargan con `next/font/google`
  como en la plantilla de create-next-app (variables `--font-geist-sans` y `--font-geist-mono`, subconjunto
  latin, que incluye ñ y tildes). El widget no las carga: usa la fuente del sistema.
- **Escala** (tamaños de Tailwind):

| Uso | Tamaño / interlínea | Peso | Clase |
|---|---|---|---|
| Título de página (H1) | 24 / 32 | 600, `tracking-tight` | `text-2xl` |
| Título de sección | 18 / 28 | 600 | `text-lg` |
| Título de tarjeta o diálogo | 16 / 24 | 600 | `text-base` |
| Cuerpo, tablas, formularios (escritorio) | 14 / 20 | 400 | `text-sm` |
| Etiquetas y botones | 14 / 20 | 500 | `text-sm font-medium` |
| Cuerpo en móvil (mensajes, campos) | 16 / 24 | 400 | `text-base` |
| Datos secundarios, hora, ayuda | 12 / 16 | 400 | `text-xs` |
| Cifra de indicador (KPI) | 30 / 36 | 600, cifras tabulares | `text-3xl tabular-nums` |

- Mínimo 12 px. En móvil, los campos de texto van a 16 px (evita el zoom automático de iOS; el `Input` de
  shadcn ya hace `text-base md:text-sm`).
- Solo pesos 400, 500 y 600. Nada de mayúsculas sostenidas ni cursivas para dar énfasis.
- Cifras tabulares (`tabular-nums`) en tablas, horas de la agenda, indicadores, costes y contadores.
- Textos largos (páginas legales, vista previa del prompt, documentos) con un ancho máximo de unos 70
  caracteres (`max-w-prose`).
- **Formato español** (date-fns con locale `es` y la zona horaria del negocio): «12 oct 2026, 10:42»,
  «lunes, 12 de octubre», «hace 5 min», «ayer»; 24 horas; números «12.345» (con cuatro cifras no se agrupa:
  «1234»), «87,3 %»; importes en dólares «12,34 US$». Siempre «estimado» junto al coste de WhatsApp.
- Tono de los textos: español de España, de tú, frases cortas, verbos concretos en botones («Guardar
  cambios», «Conectar con Google», «Desconectar número»), nunca «Aceptar» ni «OK» sueltos.

## Layout

- **Puntos de corte** (los de Tailwind): menos de 768 px es móvil; de 768 a 1279, portátil; desde 1280,
  escritorio.
- **Armazón de la app:**
  1. Franja «Modo demo» arriba del todo, a todo el ancho, cuando `DEMO_MODE` está activo.
  2. Menú lateral (Sidebar de shadcn) de 256 px, plegable a iconos (`collapsible="icon"`, atajo Ctrl/Cmd+B);
     en móvil se abre como panel deslizante. Arriba, logo y nombre del negocio; en medio, la navegación;
     abajo, el menú de usuario (Mi cuenta, Ayuda, Tema, Cerrar sesión).
  3. Barra superior fija de 56 px: botón del menú (móvil), migas de pan, campana de notificaciones.
  4. Aviso «Añade tu clave de OpenRouter» (si toca), dentro del área de contenido y encima de la cabecera.
  5. Contenido con 24 px de margen lateral (16 px en móvil).
- **Navegación:** Bandeja, Contactos, Agenda | Agentes, Conocimiento, Canales | Informes, Ajustes, con un
  separador entre los tres grupos y sin títulos de grupo. Iconos: `inbox`, `users`, `calendar-days`, `bot`,
  `book-open`, `radio-tower`, `chart-column`, `settings`. Bandeja lleva el contador de no leídos. Cada rol ve
  solo lo que puede usar (el servidor lo impide igualmente).
- **Móvil y PWA (sobre todo agentes):** menos de 768 px, el menú lateral se sustituye por una barra inferior
  de 56 px más la zona segura (`env(safe-area-inset-bottom)`, con `viewportFit: 'cover'` en el `viewport` de
  Next): Bandeja, Agenda, Contactos y Más (abre un panel con el resto de secciones permitidas y el perfil).
  Icono de 20 px y etiqueta de 12 px; el activo en `--primary-text`. Dentro de una conversación la barra se
  oculta: la conversación ocupa toda la pantalla con su botón «Atrás». Con la app instalada
  (`display-mode: standalone`) se ve igual; la barra de estado usa `themeColor` claro y oscuro.
- **Cabecera de página:** migas (solo desde el segundo nivel), H1, una línea de descripción en
  `--muted-foreground` y, a la derecha, una acción principal como máximo, hasta dos secundarias y un menú
  `ellipsis` con el resto. Debajo, pestañas subrayadas si la página tiene subsecciones (editor de agente,
  panel de canal, base de conocimiento). En móvil las acciones pasan a un botón principal y un menú.
- **Barra de guardado:** en los editores largos (agente, canal, ajustes), al haber cambios aparece abajo una
  barra fija «Cambios sin guardar · Descartar · Guardar». Salir con cambios pide confirmación.
- **Bandeja:** desde 1280 px, tres columnas: lista 360 px | conversación (mínimo 480 px) | ficha del contacto
  320 px (se puede ocultar). De 768 a 1279: lista 320 px | conversación, y la ficha como panel lateral. En
  móvil: la lista es una pantalla y la conversación otra (`/bandeja/[id]`).
- **Ajustes:** subnavegación a la izquierda (220 px) y contenido de hasta 720 px. En móvil, la subnavegación
  es una lista que lleva a cada página.
- **Formularios:** una columna, hasta 640 px. Solo campos muy cortos y relacionados van en dos columnas
  (puerto y seguridad; desde y hasta).
- **Listados de tarjetas** (canales, agentes, bases): rejilla de columnas de al menos 280 px, separación de
  16 px.
- **Densidad:** filas de tabla de 40 px (48 px en pantallas táctiles), separación de 16 px dentro de una
  sección y 24–32 px entre secciones. Espaciado en múltiplos de 4 px.
- **Objetivos táctiles:** en pantallas táctiles (`pointer-coarse`) todo lo que se pulsa mide al menos 44 ×
  44 px (más que el mínimo AA de 24 px; es el nivel AAA). En escritorio, al menos 24 × 24 px.

## Elevation & Depth

- Plano. La profundidad se da con superficies (`--background` → `--card` → `--muted`) y bordes de 1 px, no con
  sombras.
- Sombras solo en lo que flota: `shadow-xs` en botones y campos (la que trae shadcn), `shadow-md` en menús,
  selectores y popovers, `shadow-lg` en diálogos, paneles laterales, toasts y el panel del widget. Las
  tarjetas no llevan sombra.
- En oscuro las sombras apenas se ven: lo que flota se distingue por ser `--card` sobre `--background` y por
  su borde.
- Capas, de abajo arriba: contenido, cabeceras fijas y barra inferior, franja de demo, capas flotantes
  (menús, diálogos, toasts). El widget, en la web del cliente, siempre encima de todo.
- Fondo de los diálogos: negro al 50 %. Nada de desenfoques.

## Shapes

- `--radius: 0.5rem` (algo más sobrio que el 0,625 de serie). Escala de shadcn: `sm` 4,8 px (casillas),
  `md` 6,4 px (botones, campos, chips cuadrados), `lg` 8 px (avisos, notas), `xl` 11,2 px (tarjetas,
  diálogos), `2xl` 14,4 px (burbujas de chat y panel del widget, 16 px).
- `full` para avatares, insignias de estado, contadores, el lanzador del widget y los puntos de semáforo.
- Burbujas: esquina del lado del autor más cerrada (`sm`) en el último mensaje de un grupo seguido.
- Bordes de 1 px. Discontinuos solo para: borrador, nota interna, cita pendiente y zona de soltar archivos.
- Iconos lucide con su trazo de serie (2 px) a 16 px en texto y botones, 20 px en navegación y 24 px en
  estados vacíos (dentro de un cuadrado `--muted` de 40 px con radio `lg`).

## Components

Componentes de shadcn/ui tal cual, con el tema de arriba. Solo se crean componentes propios para lo que
shadcn no tiene (burbujas, calendario de la agenda, semáforos, barra inferior) y siguen estas mismas reglas.

### Botones

- Variantes: principal (`default`, color del negocio), `outline` (secundaria), `ghost` (en barras y tablas),
  `destructive` (borrar, desconectar) y `link`. Una sola principal por pantalla o diálogo.
- Tamaños: 36 px de alto; 44 px en pantallas táctiles. Botón de icono solo con `aria-label` y tooltip.
- Cargando: se desactiva, muestra `loader-circle` girando y cambia el texto («Guardando…»). No cambia de ancho.

### Formularios

- Componente Field de shadcn: etiqueta arriba, campo, ayuda debajo (`--muted-foreground`, 12–14 px) y error
  debajo de la ayuda. Los opcionales llevan «(opcional)»; nada de asteriscos.
- **«¿Dónde lo encuentro?»**: enlace pequeño a la derecha de la etiqueta, con `circle-question-mark`, en todos
  los campos que piden un dato de un servicio externo (Meta, Google, Microsoft, OpenRouter, correo). Abre un
  popover con 2–4 pasos cortos y «Abrir la guía completa» (`external-link`, pestaña nueva) a la guía de
  `docs/` correspondiente.
- **Validación:** al salir del campo y al enviar, con los mismos esquemas Zod del servidor. Error en
  `--destructive-text` con icono `circle-alert`, `aria-invalid` y `aria-describedby`. En formularios largos,
  al enviar con errores, un resumen arriba con enlaces a cada campo. Nunca se borra lo escrito.
- **Secretos** (tokens, App Secret, claves, contraseñas): campo de contraseña con botón mostrar/ocultar al
  escribir. Una vez guardado solo se ve `••••1234` en mono con «Cambiar»; nunca se vuelve a mostrar.
- **Datos para copiar** (URL de webhook, token de verificación, URI de redirección, código del widget):
  campo de solo lectura en mono con botón `copy`; al copiar, toast «Copiado».
- Interruptores (IA encendida, modo pruebas) con etiqueta a la izquierda y el efecto en una línea debajo
  («La IA responderá a los mensajes nuevos de este canal»).

### Asistentes (stepper)

- Para: arranque (`/setup`), WhatsApp, correo, chat web.
- Escritorio: pasos numerados en horizontal con su nombre; móvil: «Paso 2 de 5 · Webhook» con barra de
  progreso. Estados del paso: hecho (`check` en `--primary`), actual (borde `--primary`), pendiente
  (`--muted-foreground`), con error (`circle-x` en `--destructive-text`).
- Pie fijo: «Atrás» (ghost) a la izquierda, «Continuar» (principal) a la derecha. El avance se guarda: se
  puede salir y retomar desde la tarjeta del canal («Continuar configuración»).
- Esperas en vivo (verificación del webhook, primer «hola»): panel con `loader-circle`, «Esperando…» y tiempo
  transcurrido; se actualiza solo. A los 2 minutos sin respuesta aparece el diagnóstico guiado como lista de
  comprobaciones con semáforo.
- Acciones con cupo (registro del número: 10 intentos cada 72 h) piden confirmación y dicen cuántos quedan.

### Tablas y listas

- Cabecera fija, texto `caption` en peso 500 y `--muted-foreground`, sin mayúsculas. Números a la derecha;
  fechas en formato corto; textos largos truncados con tooltip.
- Clic en la fila abre el detalle; acciones de fila en un menú `ellipsis-vertical` al final; casillas para
  acciones en bloque (exportar, borrar, fusionar) con una barra de acciones que aparece al seleccionar.
- Encima: buscador, filtros en popovers, chips de filtros activos (`--primary-soft`) y «Quitar filtros».
- Paginación en el servidor (25 por página) o «Cargar más» en listas de mensajes y actividad.
- En móvil, las tablas pasan a lista de tarjetas (título, dos datos clave, estado). Sin scroll horizontal
  salvo en tablas técnicas de Diagnóstico.

### Tarjetas

- Borde, radio `xl`, 16–24 px de relleno, sin sombra. Cabecera con título, descripción y acción.
- Si toda la tarjeta es un enlace: fondo `--accent` al pasar el ratón y anillo de foco en toda la tarjeta.
- **Tarjeta de canal:** cuadro de icono del canal, nombre, tipo, chip de estado; número, correo o dominio;
  «Agente activo» (selector) con el interruptor de IA; chips «Modo pruebas» (`flask-conical`, warning) y
  «Demo»; último mensaje («hace 3 min»); pie «Abrir panel».
- **Tarjeta de agente:** avatar (imagen o iniciales sobre `--ai-soft`), nombre, descripción en una línea,
  modelo en mono pequeño y «Activo en:» con chips de canal.
- **Indicadores (KPI):** etiqueta `caption`, cifra `kpi` y, debajo, el dato que la explica en `caption`
  («78 % en menos de 3 min», «estimado»).

### Diálogos y confirmaciones

- Diálogo para tareas cortas y confirmaciones; panel lateral (Sheet) para detalles consultables sin perder
  el contexto (ficha de cita, fuentes de la IA, ficha del contacto en portátil).
- Confirmación destructiva: título en pregunta con el objeto («¿Desconectar el número +34 600 000 000?»),
  consecuencias en una o dos frases, botón con el verbo exacto en `destructive` y «Cancelar» con el foco
  inicial. Si borra muchos datos o no se puede deshacer (desconectar un canal, borrar una base de
  conocimiento, borrar los datos de un contacto), además hay que escribir el nombre.
- `Esc` cierra, el foco queda atrapado dentro y vuelve al elemento que lo abrió.

### Toasts

- Componente de toast de shadcn/ui (el Toast de Base UI o Sonner si se usa Radix): abajo a la derecha en
  escritorio y arriba en móvil, para no tapar la barra inferior ni el compositor.
- Solo para confirmar algo hecho («Cita creada», «Copiado») o errores que se pueden reintentar («No se ha
  podido enviar · Reintentar»). Duran unos 4 s; los de error se quedan hasta cerrarlos. Lo que exige actuar
  va en la propia pantalla, no en un toast.

### Avisos (banners)

- **«Modo demo»:** franja de 32 px a todo el ancho, `--info-soft` con texto `--info` e icono `info`: «Modo
  demo · Datos de ejemplo. Los canales de demo no envían mensajes reales.» No se puede cerrar. En móvil,
  solo «Modo demo».
- **«Añade tu clave de OpenRouter»:** aviso (Alert) `--warning-soft` con `key-round`: título «Añade tu clave
  de OpenRouter», texto «La IA está desactivada: los agentes no responden y la búsqueda de conocimiento va solo
  por texto.» y botón «Añadir clave» (a Ajustes › IA) para propietario y administrador; los demás leen «Pide
  al propietario que la añada». En todas las páginas mientras falte la clave; no se cierra.
- Como máximo dos avisos a la vez. Otros avisos de sistema (canal con error, requiere reconexión) van en su
  tarjeta, en su panel y como notificación, no como franja global.

### Estados de pantalla

Cada pantalla y cada bloque que carga datos tiene los cuatro:

- **Vacío:** componente Empty de shadcn: icono en cuadrado `--muted`, título que dice qué falta, una frase de
  para qué sirve o qué hacer, y la acción principal si el rol la puede hacer. Vacío por filtros: «Nada
  coincide con estos filtros» y «Quitar filtros».
- **Cargando:** esqueletos (Skeleton) con la forma final (filas, tarjetas, burbujas), nunca una rueda a
  pantalla completa. Procesos largos (ingesta de documentos, conexión de canales) muestran su paso actual, no
  una rueda.
- **Error:** aviso `destructive` en el bloque que falló, con mensaje genérico en español («No se ha podido
  cargar la bandeja») y «Reintentar». Nunca detalles técnicos. Mismo aspecto en `error.tsx`.
- **Sin permiso:** en el área de contenido, icono `lock`, «No tienes permiso para ver esta sección», «Tu rol
  ({rol}) no incluye esta sección. Si la necesitas, pídesela al propietario.» y «Ir a la bandeja». Los
  botones de acciones no permitidas no se muestran. Solo lectura: los formularios se ven como listas de datos
  y la cabecera lleva el chip «Solo lectura».

### Insignias y semáforos

- **Insignia de estado:** píldora de 22 px, fondo `-soft`, icono y texto del color del estado. Las etiquetas
  de conversación son insignias `outline` neutras (máximo dos y «+N»).
- **Semáforo** (salud de canales y Diagnóstico): fila con punto o icono de estado, nombre de la comprobación,
  valor, detalle en español y acción («Revalidar», «Ver guía»):
  - verde `success` `circle-check` «Correcto»;
  - ámbar `warning` `triangle-alert` «Aviso» (por ejemplo, token que caduca, calidad media);
  - rojo `destructive-text` `circle-x` «Error» (con el error de Meta traducido y qué hacer);
  - gris `--muted-foreground` `circle-dashed` «Sin comprobar».
  En la tarjeta del canal se resume con el peor estado.
- **Estado del canal:** Borrador (`circle-dashed`, neutro), Conectando (`loader-circle`, info), Conectado
  (`circle-check`, success), Error (`circle-x`, destructive), Desactivado (`circle-pause`, neutro),
  Requiere reconexión (`triangle-alert`, warning).

### Bandeja y conversación

- **Fila de la lista:** avatar con iniciales y el icono del canal en su esquina; nombre (en negrita si hay no
  leídos); última línea del mensaje en `--muted-foreground`; hora relativa; contador de no leídos
  (`--primary`); insignia «Pendiente de humano» si toca; modo (IA / Persona / IA en pausa); avatar pequeño de
  la persona asignada. Seleccionada: `--primary-soft` y franja izquierda de 2 px `--primary`.
- **Cabecera de la conversación:** nombre, canal («WhatsApp · Recepción»), selector de estado, asignar,
  interruptor de IA con motivo y, si está en pausa, «IA en pausa hasta 18:40 · Reactivar».
- **Mensajes:** agrupados por autor seguido; separadores de día («Hoy», «Ayer», «lunes, 21 de septiembre»);
  línea de datos con autor, hora y estado de entrega. Audio: reproductor y, debajo, «Transcripción» con el
  texto (plegable si es largo). Imágenes: miniatura de hasta 240 px que se amplía en un diálogo. Documentos:
  tarjeta con `file-text`, nombre, tamaño y descargar. Mensajes de la IA con fuentes: «Ver fuentes» abre un
  panel «¿Por qué respondió esto?» con los fragmentos numerados (título, sección, página y puntuación).
- **Correo:** cada mensaje es una tarjeta con asunto, de y para, cuerpo como texto y la cita anterior
  plegada. El borrador lleva «Aprobar y enviar», «Editar» y «Descartar».
- **Compositor:** texto que crece, adjuntar, cambiar a «Nota interna» (el compositor se tiñe de
  `--warning-soft`), enviar. Debajo, en `caption`: «Al enviar, la IA se pausa en esta conversación hasta
  mañana a las 06:40». WhatsApp: chip «Ventana abierta · quedan 3 h 12 min» (info) o, si está cerrada, el
  compositor se sustituye por «La ventana de 24 h está cerrada: solo puedes enviar una plantilla aprobada» y
  «Elegir plantilla».
- **Tiempo real:** los mensajes nuevos entran sin mover lo que se está leyendo; si no estás al final,
  aparece «Nuevos mensajes ↓». «Escribiendo…» con tres puntos (estáticos si se reduce el movimiento).

### Agenda (calendario)

- Vistas Día, Semana, Mes y Recursos (una columna por recurso para un día). Barra: «Hoy», anterior y
  siguiente, fecha en texto («Semana del 21 al 27 de septiembre»), selector de vista, filtros de recurso y
  servicio, «Nueva cita» (principal) y «Bloquear hueco».
- Rejilla: horas a la izquierda en `caption` tabular; línea por hora en `--border` y por media hora más
  tenue. Fuera de horario y festivos: fondo `--muted` con «Cerrado». Ausencias del recurso: rayado diagonal
  `--muted` con «Ausencia». Huecos bloqueados: rayado con el motivo. Línea de «ahora» de 2 px en `--primary`.
- Cita: color del recurso (ver «Colores de recurso»), hora, contacto en 500 y servicio en
  `--muted-foreground`; icono de origen arriba a la derecha; estilo según su estado. Si es corta, una línea.
- Aforo (restaurante, clases): en la vista Recursos, ocupación por franja («6/8») y el número de personas en
  cada reserva («4 pers.»).
- Mes: hasta tres citas por día y «+N más».
- Arrastrar para mover o cambiar la duración, con ajuste al intervalo; zonas no válidas con el motivo
  («Fuera de horario», «Ocupado»). Todo lo que se hace arrastrando se puede hacer también desde la ficha de
  la cita (WCAG 2.5.7).
- Ficha de la cita en panel lateral: estado, servicio, recurso, inicio y fin, personas, contacto (enlace),
  conversación (enlace), origen, notas e historial.

### Informes (gráficos)

- Componente Chart de shadcn (Recharts) con `accessibilityLayer`. Fila de indicadores arriba y, debajo,
  gráficos de barras y líneas. Sin tartas, 3D ni dobles ejes.
- Ejes y etiquetas en `caption` `--muted-foreground`; solo líneas de rejilla horizontales en `--border`;
  leyenda visible si hay más de una serie; tooltip con el valor exacto en formato español.
- Primera respuesta humana: línea de referencia discontinua en 3 min con su etiqueta.
- Cada gráfico tiene «Ver datos», que muestra la misma información como tabla.
- Sin datos del periodo: «Todavía no hay datos de este periodo» dentro del marco del gráfico.

### Chat web (widget)

- Usa el color, el logo, la bienvenida, la posición (abajo a la derecha o a la izquierda) y los textos
  legales configurados en su canal. El color pasa por el mismo cálculo que `--primary`. Siempre en tema claro
  en la v1. Fuente del sistema. Estilos aislados de la web donde se inserta (ni hereda ni rompe los suyos).
- **Lanzador:** círculo de 56 px a 20 px de los bordes (más la zona segura) con `message-circle` o el logo,
  `aria-label` «Abrir el chat de {negocio}» y un punto si hay respuesta sin leer.
- **Panel:** 380 × 640 px como máximo (sin pasar del alto de la ventana), radio 16 px, `shadow-lg`, borde.
  Cabecera con logo, nombre del negocio, «Te responde un asistente con IA · Puedes pedir hablar con una
  persona» y cerrar. Mensajes: el visitante a la derecha en el color del canal; el negocio a la izquierda en
  `--muted`, con «Asistente IA» o el nombre de la persona. Primer mensaje con el aviso de IA; texto legal
  pequeño con enlace a la política de privacidad. Si hace falta, los datos del visitante se piden con un
  formulario dentro de la conversación, no en una ventana aparte.
- Estados: conectando, sin conexión («Reintentando…»), límite de mensajes («Espera un momento antes de
  enviar más»), error al enviar («No se ha enviado · Reintentar»), «Una persona te atenderá pronto» tras un
  traspaso (y el mensaje de fuera de horario si toca).
- Móvil (menos de 640 px): el panel ocupa toda la pantalla (`100dvh`); campos a 16 px.
- Accesible: el panel es un `dialog` con nombre; al abrir, el foco va al campo de texto; `Esc` cierra y el
  foco vuelve al lanzador; los mensajes nuevos se anuncian con `aria-live="polite"`.

### Iconos

- Solo lucide (`lucide-react`), trazo de serie. Nombres comprobados en lucide.dev el 2026-09-26; al
  construir, se comprueban en la versión instalada (algunos se renombran, como `circle-help`, que ahora es
  `circle-question-mark`).
- Un icono siempre significa lo mismo en toda la app (las tablas de arriba mandan). Si un icono va solo, lleva
  `aria-label` y tooltip; si acompaña a un texto, `aria-hidden`.

### Accesibilidad y movimiento

- Objetivo WCAG 2.2 AA en toda la app y el widget: texto 4,5:1 (3:1 a partir de 18,66 px en negrita o 24 px),
  bordes de campos, iconos de estado y foco 3:1.
- **Foco:** siempre visible. Los campos usan el de shadcn (borde `--ring` más halo). En `buttonVariants` el
  halo semitransparente se cambia una vez por un anillo opaco de 2 px en `--ring` con 2 px de separación, para
  que se vea también sobre botones del color del negocio.
- Todo se usa con teclado, en orden lógico. Enlace «Saltar al contenido» al principio. Atajos solo como
  extra (Ctrl/Cmd+B pliega el menú).
- `lang="es"` en el documento; cada página con su H1 y su `<title>` («Bandeja · {negocio}»).
- **Movimiento:** transiciones de 150 ms (hover, pulsado) a 200 ms (menús, paneles), sin rebotes. Con
  `prefers-reduced-motion` (`motion-reduce:`) se quitan desplazamientos, giros y el latido de los esqueletos.
  Cambiar de tema no anima (`disableTransitionOnChange`).

## Do's and Don'ts

**Sí**

- Usar los tokens (`bg-primary`, `text-muted-foreground`, `bg-warning-soft`…); nunca colores sueltos.
- Acompañar cada color de estado con icono y texto.
- Dejar el color del negocio para la acción principal, la selección, los enlaces y el foco.
- Mostrar quién escribió cada mensaje (cliente, IA con su agente, persona, sistema) y el estado de la IA en
  cada conversación.
- Decir las cosas en español llano y con el siguiente paso («Revalidar», «Ver guía»), también en los errores
  de Meta, Google y Microsoft.
- Probar cada pantalla en claro y oscuro, a 375 px de ancho y solo con teclado.
- Poner «estimado» junto a todo coste de WhatsApp y mostrar los importes en US$.

**No**

- Usar el color del negocio para estados, alertas o texto largo.
- Usar los colores de canal para estados, ni colores de marca o logotipos de terceros.
- Mostrar un secreto completo, una traza de error o datos técnicos al usuario.
- Tapar la conversación con toasts o avisos; lo urgente va en su sitio de la pantalla.
- Ruedas de carga a pantalla completa, sombras de colores, degradados o desenfoques.
- Textos de menos de 12 px, botones sin texto ni `aria-label`, u objetivos de menos de 44 px en el móvil.
- Arrastrar como única forma de hacer algo.
- Mezclar familias de iconos.

## Fuentes (verificadas el 2026-09-26)

- Formato DESIGN.md (versión «alpha», secciones y tokens): https://github.com/google-labs-code/design.md/blob/main/docs/spec.md
- Tema de shadcn/ui para Tailwind v4 (`@theme inline`, `@custom-variant dark`, radio 0,625rem, tokens de
  menú lateral y gráficos): https://ui.shadcn.com/docs/theming y https://ui.shadcn.com/docs/installation/manual
- Valores del color base zinc: https://ui.shadcn.com/r/colors/zinc.json
- Base UI por defecto en shadcn/ui (julio de 2026; Radix sigue soportado): https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default
- Toast de Base UI (julio de 2026): https://ui.shadcn.com/docs/changelog/2026-07-toast
- Componentes Sidebar, Empty, Field, Spinner y Chart: https://ui.shadcn.com/docs/components
- Modo oscuro con next-themes: https://ui.shadcn.com/docs/dark-mode/next
- Paleta de Tailwind v4 (OKLCH): https://tailwindcss.com/docs/colors
- Tamaños de texto de Tailwind: https://tailwindcss.com/docs/font-size
- Variantes `pointer-coarse`, `motion-reduce` y `forced-colors`: https://tailwindcss.com/docs/hover-focus-and-other-states
- Geist en la plantilla de create-next-app (Next.js 16.2): https://github.com/vercel/next.js/blob/canary/packages/create-next-app/templates/app-tw/ts/app/layout.tsx
- `themeColor` y `viewportFit` en `viewport` de Next.js: https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/03-api-reference/04-functions/generate-viewport.mdx
- WCAG 2.2 (12-12-2024): https://www.w3.org/TR/WCAG22/ ; tamaño de objetivos 2.5.8 (24 px, AA) y 2.5.5 (44 px,
  AAA): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html y
  https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html ; arrastre 2.5.7 (AA):
  https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html ; contraste no textual 1.4.11 (bordes
  de campos, foco y estados): https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- Luminancia relativa (umbral 0,04045): https://www.w3.org/WAI/GL/wiki/Relative_luminance
- Lucide sin logotipos de marcas (los quitó en la versión 1): https://lucide.dev/guide/version-1 y
  https://lucide.dev/brand-logo-statement ; nombres de iconos en https://lucide.dev/icons/
- `display-mode` y `env(safe-area-inset-*)`: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/display-mode
  y https://developer.mozilla.org/en-US/docs/Web/CSS/env
- Todos los contrastes de este documento se han calculado con la fórmula WCAG a partir de los valores
  hexadecimales indicados.
