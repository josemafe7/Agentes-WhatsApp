# 0023 · Cómo se cuentan las cifras de los informes

- **Estado:** aceptada (encargo de acabado de la fase 7, 2026-09-27)
- **Fecha:** 2026-09-27

## Contexto y problema

Las reglas de Informes ([INF-01]–[INF-08], [CUM-11]) dicen qué se mide, pero no cómo se cuenta cada cifra cuando una
conversación dura meses, cuando un traspaso todavía espera o cuando hay pocos datos. Sin escribirlo, dos personas
leerían el mismo número de formas distintas, y las pruebas no tendrían una definición contra la que comprobarlo.

## Opciones consideradas

- **Contar por la fecha de creación de cada cosa** (la conversación, el traspaso, la cita): sencillo, pero una
  conversación de WhatsApp o del chat web, que es una sola por cliente y canal y se reabre ([CAN-12]), solo contaría
  en el mes en que se creó, aunque el cliente vuelva a escribir cada mes.
- **Contar por la actividad del cliente en el periodo**, que es lo que el negocio entiende por «conversaciones del
  mes», y guardar un historial de estados para saber cómo estaba cada una en cada momento.
- **Contar por la actividad del cliente en el periodo, con el estado actual** (sin historial de estados).

## Decisión

La tercera, con estas definiciones, escritas también al principio de `src/data/reports.ts` y en la pantalla:

- **Periodo ([INF-01]):** el mes actual por defecto, o un mes o unas fechas (como mucho un año), siempre en la zona
  horaria del negocio: el primer día desde las 00:00 y el último hasta las 24:00 de esa zona.
- **Conversaciones ([INF-02]):** las que tienen algún mensaje del cliente en el periodo. Una conversación larga cuenta
  en cada periodo en el que el cliente escribió. Las de «Probar agente» nunca cuentan ([INF-08]).
- **Resueltas por la IA ([INF-03]):** de esas, las que están resueltas ahora y que, durante el periodo, no tuvieron un
  traspaso esperando ni atendido ni ningún mensaje de una persona. No hay historial de estados: el estado es el actual,
  así que una conversación resuelta después del periodo también cuenta como resuelta en él.
- **Traspasos ([INF-04]):** los pedidos en el periodo, con su motivo (los 10 más frecuentes uno a uno y el resto
  sumado) y quién los lanzó: la IA con su herramienta, una regla del agente (palabras clave, tema sensible o varios
  «no lo sé»), un fallo de la IA o de un envío, o una persona.
- **Tiempo hasta la primera respuesta humana ([INF-05]):** de cada traspaso del periodo que ya tiene respuesta, desde
  que se pidió hasta el primer mensaje de una persona en la conversación. Se da la mediana y el percentil 90 por el
  método del rango más cercano (el valor más pequeño que el 90 % de los tiempos no supera). Un traspaso cerrado sin
  respuesta (la conversación se resolvió o se reactivó la IA, [TRA-06]) no tiene tiempo.
- **Atendidos en menos de 3 minutos ([CUM-11]):** sobre todos los traspasos del periodo salvo los que siguen esperando
  desde hace menos de 3 minutos, que todavía pueden atenderse a tiempo. Uno que espera desde hace más de 3 minutos, o
  que se cerró sin respuesta, cuenta como no atendido a tiempo.
- **Citas de la IA ([INF-06]):** las que la IA creó en el periodo, pase lo que pase después con ellas; nunca las de
  «Probar agente».
- **Coste de IA ([INF-07]):** lo que OpenRouter dijo que costó cada llamada del periodo ([MOT-11]); lo de «Probar
  agente» se suma aparte. Con un canal elegido, solo las llamadas de sus conversaciones.
- **Coste estimado de WhatsApp ([INF-07], [WA-47]):** la suma de los costes estimados de los mensajes enviados en el
  periodo; los que Meta cobra pero no tienen tarifa para su mercado se cuentan aparte como «sin tarifa».

## Consecuencias

- Las cifras de un mes pasado pueden cambiar un poco si una conversación de ese mes se resuelve más tarde: se acepta
  a cambio de no guardar un historial de estados. Si algún día hace falta, se añade una tabla de cambios de estado
  (migración aditiva) y solo cambia `src/data/reports.ts`.
- «Menos de 3 minutos» no castiga los traspasos que todavía pueden atenderse a tiempo, pero sí los que se abandonan.
- Las pruebas de `src/data/reports.test.ts` comprueban cada definición.
