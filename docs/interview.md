# Entrevista

Cómo me entrevistas para escribir `docs/spec.md`, y para cambiarla cuando pida algo grande o quiera cambiar
una tecnología. La entrevista es para conseguir la información y ponérmelo fácil: no me abrumes, pero
tampoco te quedes sin un dato importante ni decidas por mí algo que me toca decidir a mí.

## Cómo preguntas

- Poco a poco, de una en una y sin preguntas obvias, salvo las de tecnología, que se hacen siempre. Si ya
  te he contado mi idea, parte de ella.
- Si no sé responder algo, recomiéndame la opción más sencilla y explícame por qué.

## Qué necesitas saber

- Quién lo va a usar y qué puede hacer cada tipo de usuario.
- Cómo debe funcionar y qué pasa en los casos raros.
- Qué datos maneja, de dónde salen y si son personales o delicados.
- Qué queda fuera.
- Al final, las tecnologías: las cuatro preguntas de más abajo, siempre.

## Las tecnologías

Cuatro preguntas que me haces siempre, al final de la entrevista, cuando ya sepas qué hace la app. Una por
una y por este orden, porque cada respuesta condiciona la siguiente. No des ninguna tecnología por elegida
sin preguntármela, aunque la respuesta te parezca evidente: solo te saltas la que yo ya te haya dicho
expresamente. La especificación no se aprueba sin estas respuestas.

En cada pregunta:

- Enséñame todas las opciones de la lista, cada una explicada con palabras normales y con lo que supone
  para mí en coste, mantenimiento y límites, comprobando antes los precios y las condiciones actuales.
- La recomendada va la primera y marcada como «recomendada»: es la que está entre corchetes. Si crees que a
  mi app le va mejor otra, dímelo y explícame por qué.
- Si alguna opción no encaja con mi app o con lo que ya he elegido, no la escondas: enséñamela y dime por
  qué no encaja.
- La última opción es siempre «Otra», para que la escriba yo. Entonces cuéntame en dos o tres frases qué
  gano y qué pierdo, avísame si no encaja y, si la sigo queriendo, úsala. La decisión es mía.
- Si respondo «no lo sé», usa la recomendada y dime en una frase por qué es la adecuada.
- Si tu herramienta tiene preguntas con opciones para elegir, úsalas. Si ya trae su propio campo «Otro», ese
  es la opción «Otra»; si exige más opciones de las que hay, añade alternativas conocidas que encajen.

Lo recomendado está pensado para una aplicación web: si lo que voy a construir es otra cosa (una app de
móvil, una automatización, una extensión, un programa de escritorio), propónme tú las opciones que encajen:
pocas, conocidas y fáciles de mantener.

1. **Dónde se publica.**
   - [Vercel]: se publica sola y no hay servidor que mantener. Su plan gratuito es solo para uso personal no
     comercial: para la app de un negocio hace falta el plan de pago.
   - Un VPS de Hostinger con Dokploy: un servidor propio con un panel para publicar. Coste fijo y sin límites
     de uso comercial, pero el mantenimiento y la seguridad del servidor son míos.
   - Otra.
2. **Dónde se guardan los datos, los usuarios y los archivos.**
   - [Supabase]: base de datos, usuarios y archivos en un servicio externo. Vale con Vercel y con un VPS.
   - LocalStorage: los datos se quedan en el navegador de cada persona, sin usuarios ni datos compartidos.
     Solo para una demo o una primera versión.
   - SQLite + Prisma: los datos en un archivo, sin cuentas externas. Solo si se publica en un VPS, porque en
     Vercel no funciona.
   - PostgreSQL: la base de datos que Supabase usa por dentro, pero sola, en el propio VPS o en un servicio
     de bases de datos. Los usuarios y los archivos hay que resolverlos aparte.
   - Otra.

   Si el proyecto va a ser público o de muestra (un portfolio, una plantilla, código abierto), tenlo en
   cuenta al recomendar y dímelo: solo las opciones que no dependen de un servicio externo permiten
   descargarlo y ejecutarlo sin crear cuentas ni configurar nada.
3. **Con qué framework se construye.**
   - [Next.js]: el más usado para aplicaciones web. La web y el servidor van en un solo proyecto, y es para
     el que está escrita la documentación de este proyecto.
   - Otro.
4. **El resto de las piezas.** En una sola pregunta, no pieza a pieza: enséñame lo que queda de la lista de
   «Tecnologías» de `AGENTS.md` (lenguaje, diseño, IA y pruebas), adaptado al framework elegido y con una
   frase sobre para qué sirve cada pieza, y pregúntame si lo dejo así o quiero cambiar algo. Con un «así
   está bien» o un «no lo sé» basta para seguir con lo recomendado.

Con lo que elija, y antes de pedirme que apruebe la especificación, actualiza los corchetes de «Tecnologías»
de `AGENTS.md` y guarda la decisión en `docs/decisions/`. Si he elegido alguna que no es la recomendada, haz
lo que dice esa sección.

## Cómo escribes la especificación

Cuando tengas todo lo anterior, también las tecnologías, y puedas hacerlo sin inventar nada, rellena
`docs/spec.md`:

- Cada cosa que hace la app va como una regla que yo pueda comprobar sin saber programar («Cuando pasa
  esto, la app hace esto otro»), también los casos raros.
- Las fases son pequeñas y cada una termina en algo que se pueda probar.
- Las decisiones técnicas se guardan en `docs/decisions/`.

Después pídeme que la apruebe y, cuando lo haga, cambia su estado a «aprobada».
