// What the customers and the AI say in each sector's demo conversations ([ARR-08]), in Spanish and with the
// business's own data (services, prices, people, hours). The conversations step turns these lines into contacts,
// conversations and messages dated relative to the day the demo is loaded. Customers never use the words that make
// the agent hand the conversation over before answering (keywords and sensitive topics of the sector template);
// the pending and the resolved hand-offs are the AI's own decision (transferir_a_humano), as they would be live.
import type { Sector } from "@/lib/enums";
import type { WeeklyRange } from "@/lib/sectors";
import type { DemoBusiness } from "../businesses";

/** What each sector's booking conversation asks for: a service of the preset and the resource that does it. */
export type BookingChoice = {
  service: string;
  resource: string;
  /** Book in the day's last range (dinner in a restaurant) instead of the first one. */
  lastRange?: boolean;
};

export const SECTOR_BOOKINGS: Readonly<Record<Sector, BookingChoice>> = {
  peluqueria: { service: "corte-mujer", resource: "estilista-1" },
  "clinica-dental": { service: "limpieza", resource: "higienista" },
  fisioterapia: { service: "sesion-fisioterapia", resource: "fisio-1" },
  restaurante: { service: "reserva-mesa", resource: "terraza", lastRange: true },
  taller: { service: "cambio-aceite", resource: "box-1" },
  academia: { service: "clase-prueba", resource: "aula-1" },
  inmobiliaria: { service: "cita-60", resource: "profesional-1" },
  tienda: { service: "cita-30", resource: "profesional-1" },
  otro: { service: "cita-30", resource: "profesional-1" },
};

export type ScriptVars = {
  business: DemoBusiness;
  /** «el jueves 1 de octubre». */
  day: string;
  /** «11:00». */
  time: string;
  /** Who or where the booking is with (a person's first name, a room). */
  resource: string;
  /** Example price of a service of the demo business, «22 €». */
  price: (serviceKey: string) => string;
  /** Display name of another resource of the preset, by key. */
  person: (resourceKey: string) => string;
  /** «de martes a viernes, de 10:00 a 14:00 y de 16:00 a 20:00, y los sábados, de 9:00 a 14:00». */
  hours: string;
};

export type SectorScript = {
  /** AI-answered booking inquiry (WhatsApp). */
  booking: { ask: string; offer: string; choose: string; confirm: string };
  /** A voice note (WhatsApp) with its transcript, answered by the AI. */
  voice: { transcript: string; reply: string };
  /** An image with its description (web chat), answered by the AI. */
  image: { caption: string; description: string; reply: string };
  /** An urgent matter the AI hands to a person; still waiting for one (WhatsApp). */
  urgent: { problem: string; reason: string; summary: string; after: string };
  /** A formal email thread: a reply approved and sent, and a new draft waiting for review. */
  email: { subject: string; first: string; reply: string; followUp: string; draft: string };
};

const SECTOR_SCRIPTS: Readonly<Record<Sector, (v: ScriptVars) => SectorScript>> = {
  peluqueria: (v) => ({
    booking: {
      ask: "¡Hola! Quería pedir cita para cortarme el pelo. ¿Tenéis hueco esta semana?",
      offer: `¡Hola, Laura! Sí: para un corte de mujer tengo hueco ${v.day} a las ${v.time} con ${v.resource}. ¿Te viene bien?`,
      choose: "Sí, perfecto. Apúntame, porfa.",
      confirm: `¡Listo! Te he reservado un corte de mujer ${v.day} a las ${v.time} con ${v.resource}. El precio orientativo es de ${v.price("corte-mujer")}. Si necesitas cambiar la cita, escríbeme por aquí.`,
    },
    voice: {
      transcript:
        "Hola, buenas. Quería saber cuánto cuestan las mechas y cuánto se tarda más o menos, que tengo el pelo bastante largo. Gracias.",
      reply: `¡Hola, Antonio! Las mechas cuestan desde ${v.price("mechas")} y se tarda unas dos horas; con el pelo largo puede ser algo más. Si quieres, te busco hueco: dime qué días te vienen mejor.`,
    },
    image: {
      caption: "Hola, ¿me podríais hacer este color? Lo he visto en internet y me encanta.",
      description: "Mechón de pelo largo teñido de un cobrizo intenso, con reflejos más claros.",
      reply: `¡Es un cobrizo precioso! Se consigue con un tinte y unos reflejos más claros. Para decirte el tiempo y el precio exactos, conviene que ${v.person("estilista-1")} o ${v.person("estilista-2")} vean antes tu pelo en una cita. ¿Te busco hueco?`,
    },
    urgent: {
      problem: "Hola. El sábado me hicisteis un tinte y desde ayer me pica muchísimo el cuero cabelludo y lo tengo muy rojo. ¿Qué hago?",
      reason: "Picor fuerte y rojez en el cuero cabelludo después de un tinte",
      summary: "Beatriz se hizo un tinte el sábado y desde ayer tiene picor fuerte y rojez en el cuero cabelludo. Pregunta qué hacer: conviene llamarla hoy.",
      after: "Vale, gracias. Estoy un poco preocupada.",
    },
    email: {
      subject: "Peinados para cinco personas el sábado",
      first:
        "Buenos días:\n\nMe gustaría saber si podrían atender a cinco personas el próximo sábado por la mañana para lavado y peinado. Tenemos una graduación a mediodía.\n\n¿Qué disponibilidad y qué precio tendrían?\n\nUn saludo,\nIsabel Prieto",
      reply: `Hola, Isabel:\n\nGracias por escribirnos. Sí, podemos atenderos a las cinco el sábado por la mañana: empezaríamos a las 9:00 con dos estilistas a la vez, para que a las 11:30 estéis todas listas.\n\nEl lavado y peinado tiene un precio orientativo de ${v.price("lavado-peinado")} por persona.\n\nSi te parece bien, confírmanos los nombres y lo dejamos reservado.`,
      followUp:
        "Hola:\n\nPerfecto, gracias. Somos Isabel Prieto, Marina Lozano, Julia Serrano, Noa Castillo y Elsa Ferrer. ¿Se puede pagar con tarjeta?\n\nUn saludo,\nIsabel",
      draft:
        "Hola, Isabel:\n\nGracias, ya tenemos los cinco nombres y el sábado queda reservado para vosotras desde las 9:00. Sí, se puede pagar con tarjeta o en efectivo.\n\nSi alguna no puede venir, avísanos con un día de antelación, por favor.",
    },
  }),

  "clinica-dental": (v) => ({
    booking: {
      ask: "Hola, buenos días. Quería pedir cita para una limpieza dental. ¿Qué huecos tenéis?",
      offer: `¡Hola, Laura! Tengo hueco para la limpieza dental ${v.day} a las ${v.time} con ${v.resource}, nuestra higienista. ¿Te viene bien?`,
      choose: "Sí, me viene bien. Gracias.",
      confirm: `Perfecto. Te he reservado la limpieza dental ${v.day} a las ${v.time} con ${v.resource}. Dura unos 45 minutos y el precio orientativo es de ${v.price("limpieza")}. Si necesitas cambiar la cita, escríbeme por aquí.`,
    },
    voice: {
      transcript:
        "Hola, buenas tardes. Quería preguntar si hacéis blanqueamiento dental y cuánto cuesta, y si hace falta hacer una revisión antes. Gracias.",
      reply: `¡Hola, Antonio! Sí, hacemos blanqueamiento dental. Tiene un precio orientativo de ${v.price("blanqueamiento")} y antes hace falta una primera visita de revisión (${v.price("primera-visita")}) para comprobar que todo está bien. ¿Te busco hueco para la revisión?`,
    },
    image: {
      caption: "Buenas. ¿Con el blanqueamiento podría llegar a este tono? Es el que me marcaron en otra clínica.",
      description: "Guía de colores dentales con seis muestras, de blanco a amarillento; la tercera está rodeada con un círculo rojo.",
      reply:
        "Gracias por la foto. Es una guía de colores dentales y el tono marcado es de los más claros. El resultado depende de cada boca, así que en la primera visita el odontólogo te dirá hasta dónde se puede llegar. ¿Te busco hueco?",
    },
    urgent: {
      problem: "Hola. Ayer me hicieron un empaste y esta noche no he podido dormir: me duele mucho la muela y tengo la cara algo hinchada.",
      reason: "Dolor e hinchazón después de un empaste",
      summary: "Beatriz se hizo un empaste ayer; esta noche no ha podido dormir por el dolor y tiene la cara algo hinchada. Hay que llamarla hoy para valorarlo.",
      after: "De acuerdo, estoy pendiente del teléfono.",
    },
    email: {
      subject: "Revisiones dentales para el equipo de una empresa",
      first:
        "Buenos días:\n\nEscribo en nombre de Gestoría Prieto. Somos ocho personas y nos gustaría hacer una revisión dental a todo el equipo este otoño, a ser posible dos o tres personas por día.\n\n¿Sería posible organizarlo?\n\nUn saludo,\nIsabel Prieto",
      reply: `Hola, Isabel:\n\nGracias por pensar en nosotros. Sí, podemos organizarlo: la primera visita y revisión dura unos 30 minutos y tiene un precio orientativo de ${v.price("primera-visita")} por persona.\n\nPodemos reservaros tres huecos seguidos por la mañana en varios días. Dinos qué días os vienen mejor y os proponemos horarios.`,
      followUp: "Hola:\n\nGracias. Nos vendrían bien los martes y los jueves a primera hora. ¿Hay que traer algo el día de la revisión?\n\nUn saludo,\nIsabel",
      draft:
        "Hola, Isabel:\n\nPerfecto, los martes y los jueves a primera hora nos van bien. Os propondremos los horarios concretos en este mismo hilo.\n\nEl día de la revisión no hace falta traer nada; si alguien tiene radiografías recientes, puede traerlas.",
    },
  }),

  fisioterapia: (v) => ({
    booking: {
      ask: "Hola, quería pedir cita para una sesión de fisio. Tengo la espalda muy cargada de estar sentada todo el día.",
      offer: `¡Hola, Laura! Tengo hueco para una sesión de fisioterapia ${v.day} a las ${v.time} con ${v.resource}. ¿Te viene bien?`,
      choose: "Sí, genial. Resérvamela.",
      confirm: `¡Hecho! Te he reservado una sesión de fisioterapia ${v.day} a las ${v.time} con ${v.resource}. Dura unos 45 minutos y el precio orientativo es de ${v.price("sesion-fisioterapia")}. Ven con ropa cómoda. Si necesitas cambiar la cita, escríbeme por aquí.`,
    },
    voice: {
      transcript:
        "Hola, buenas. Quería preguntar si hacéis punción seca y cuánto cuesta la sesión. Tengo una contractura en el hombro desde hace un par de semanas.",
      reply: `¡Hola, Antonio! Sí, hacemos punción seca: la sesión dura unos 30 minutos y tiene un precio orientativo de ${v.price("puncion-seca")}. Si es tu primera vez con nosotros, te recomendamos empezar con una primera valoración (${v.price("primera-valoracion")}). ¿Te busco hueco?`,
    },
    image: {
      caption: "Hola, me duele justo aquí desde hace unos días. ¿Esto lo tratáis?",
      description: "Dibujo de una persona de espaldas con una zona marcada en rojo en la parte baja de la espalda, a la derecha.",
      reply:
        "Gracias por la imagen. Marcas la zona lumbar, a la derecha. Sí, tratamos el dolor lumbar: en la primera valoración el fisioterapeuta te explorará y te propondrá el tratamiento. ¿Te busco hueco para la valoración?",
    },
    urgent: {
      problem: "Hola. Esta mañana en la sesión me hicieron ejercicios de rodilla y ahora se me ha hinchado bastante y casi no puedo apoyar el pie.",
      reason: "Rodilla hinchada después de la sesión; casi no puede apoyar el pie",
      summary: "Beatriz hizo ejercicios de rodilla esta mañana; ahora tiene la rodilla bastante hinchada y casi no puede apoyar el pie. Conviene llamarla cuanto antes.",
      after: "Vale, gracias. Me pongo hielo mientras tanto.",
    },
    email: {
      subject: "Fisioterapia para un equipo de pádel",
      first:
        "Buenos días:\n\nSoy la coordinadora del club de pádel Las Encinas. Nos interesaría que algunos jugadores del equipo hicieran sesiones de fisioterapia deportiva durante la temporada.\n\n¿Cómo podríamos organizarlo?\n\nUn saludo,\nIsabel Prieto",
      reply: `Hola, Isabel:\n\nGracias por escribirnos. Hacemos fisioterapia deportiva en sesiones de una hora, con un precio orientativo de ${v.price("fisioterapia-deportiva")} por sesión. Cada jugador puede reservar su cita por aquí, por WhatsApp o por el chat de la web.\n\nSi preferís reservar varias sesiones seguidas para el equipo, dinos qué días os vienen mejor y os proponemos horarios.`,
      followUp: "Hola:\n\nGracias. Nos vendrían bien los lunes por la tarde. ¿Atendéis también después de las 19:00?\n\nUn saludo,\nIsabel",
      draft: `Hola, Isabel:\n\nSí: abrimos ${v.hours}, así que los lunes después de las 19:00 podemos atender a los jugadores. Os propondremos los horarios en este mismo hilo.`,
    },
  }),

  restaurante: (v) => ({
    booking: {
      ask: "¡Hola! ¿Tenéis mesa para cuatro personas para cenar esta semana? Si puede ser, en la terraza.",
      offer: `¡Hola, Laura! Sí, tengo mesa para cuatro en la terraza ${v.day} a las ${v.time}. ¿Os viene bien?`,
      choose: "Genial, reservadla a mi nombre.",
      confirm: `¡Hecho! Mesa para cuatro en la terraza ${v.day} a las ${v.time}, a nombre de Laura. Si alguien tiene alguna alergia o necesitáis trona, dímelo y lo anoto. ¡Os esperamos!`,
    },
    voice: {
      transcript:
        "Hola, buenas. Quería preguntaros si tenéis menú del día entre semana y si tenéis platos sin gluten, que mi pareja es celíaca. Gracias.",
      reply:
        "¡Hola, Antonio! Sí, de martes a viernes tenemos menú del día a mediodía, y en la carta van marcados los platos sin gluten. Al reservar, dinos que tu pareja es celíaca y recuérdalo también al llegar, para que cocina lo tenga en cuenta. ¿Te reservo mesa?",
    },
    image: {
      caption: "Hola. El viernes celebramos los 60 de mi madre en vuestro restaurante. ¿Podemos llevar esta tarta para el postre?",
      description: "Tarta rosa de dos pisos con cinco velas encendidas, sobre un plato blanco.",
      reply:
        "¡Qué tarta tan bonita! Sí, podéis traerla: la guardamos en la cámara y la sacamos con las velas encendidas a la hora del postre. Dime a nombre de quién está la reserva y lo dejo anotado.",
    },
    urgent: {
      problem: "Hola. Anoche cenamos ahí y hoy mi hijo tiene el estómago fatal: ha vomitado dos veces. Creemos que fue el pescado.",
      reason: "Posible problema de salud tras una cena en el restaurante",
      summary: "Beatriz cenó anoche con su familia; hoy su hijo ha vomitado dos veces y creen que fue el pescado. Hay que llamarla hoy.",
      after: "Gracias. Esperamos vuestra llamada.",
    },
    email: {
      subject: "Comida de Navidad de empresa",
      first:
        "Buenos días:\n\nNos gustaría celebrar la comida de Navidad de nuestra empresa en su restaurante. Seríamos unas 15 personas, un viernes de diciembre a mediodía.\n\n¿Podrían indicarme disponibilidad y qué opciones tienen?\n\nUn saludo,\nIsabel Prieto",
      reply:
        "Hola, Isabel:\n\nGracias por pensar en nosotros. Para grupos de 9 a 20 personas reservamos el comedor, y la reserva la confirma el equipo, que os propondrá un menú cerrado.\n\nDinos qué viernes de diciembre preferís y la hora aproximada, y te respondemos con la disponibilidad y las opciones.",
      followUp:
        "Hola:\n\nPreferimos el segundo viernes de diciembre, a las 14:00. Seremos 15. ¿Podríais prepararnos también una opción vegetariana?\n\nUn saludo,\nIsabel",
      draft:
        "Hola, Isabel:\n\nGracias. Anotamos 15 personas el segundo viernes de diciembre a las 14:00 en el comedor, con opción vegetariana. El equipo revisará la disponibilidad y te enviará en este hilo la propuesta de menú para confirmar la reserva.",
    },
  }),

  taller: (v) => ({
    booking: {
      ask: "Buenas. Quería llevar el coche a cambiarle el aceite y los filtros. ¿Cuándo podría ser?",
      offer: `¡Hola, Laura! Puedes traerlo ${v.day} a las ${v.time}. El cambio de aceite y filtros lleva alrededor de una hora. ¿Te viene bien?`,
      choose: "Vale, perfecto. ¿Tengo que dejarlo toda la mañana?",
      confirm: `Te he reservado el cambio de aceite y filtros ${v.day} a las ${v.time}. Suele estar listo en una hora, así que puedes esperar aquí o volver a por él. El precio orientativo es de ${v.price("cambio-aceite")}. Si necesitas cambiar la cita, escríbeme por aquí.`,
    },
    voice: {
      transcript:
        "Hola, buenas. Tengo que pasar la ITV el mes que viene y quería saber si hacéis la revisión antes y cuánto cuesta. Es un Seat León de 2016.",
      reply: `¡Hola, Antonio! Sí, hacemos la revisión pre-ITV: revisamos luces, frenos, neumáticos, emisiones y lo demás que mira la ITV. Tiene un precio orientativo de ${v.price("revision-pre-itv")} y dura alrededor de una hora. ¿Te busco hueco antes de tu cita de la ITV?`,
    },
    image: {
      caption: "Hola, esta mañana se me ha encendido esta luz en el cuadro. El coche va bien, ¿es grave?",
      description: "Cuadro de mandos de un coche con un testigo de color ámbar encendido entre los dos relojes.",
      reply: `Gracias por la foto. Un testigo ámbar avisa de un fallo que conviene revisar pronto. Para saber qué es, hacemos una diagnosis electrónica (${v.price("diagnosis")}, unos 45 minutos). Si notas ruidos raros o pérdida de potencia, no lo uses y avísanos. ¿Te busco hueco?`,
    },
    urgent: {
      problem: "Hola. Me lo arreglasteis ayer y hoy al frenar noto que el pedal va muy blando y el coche tarda en parar.",
      reason: "Pedal de freno blando al día siguiente de la reparación",
      summary: "Beatriz recogió ayer el coche; hoy nota el pedal del freno muy blando y que tarda en parar. Hay que llamarla ya y decirle que no lo use.",
      after: "Vale, lo dejo aparcado y espero vuestra llamada.",
    },
    email: {
      subject: "Mantenimiento de tres furgonetas de reparto",
      first:
        "Buenos días:\n\nTenemos una pequeña empresa de reparto con tres furgonetas y buscamos un taller para su mantenimiento. Ahora mismo necesitaríamos el cambio de aceite y la revisión de frenos de las tres.\n\n¿Podrían darnos cita y precio aproximado?\n\nUn saludo,\nIsabel Prieto",
      reply: `Hola, Isabel:\n\nGracias por escribirnos. Podemos encargarnos del mantenimiento de las tres furgonetas. El cambio de aceite y filtros tiene un precio orientativo de ${v.price("cambio-aceite")} y la revisión de frenos, de ${v.price("frenos")}, por vehículo; el precio final depende del modelo.\n\nPara no dejaros sin furgonetas, podemos atender una por día. Dinos qué días os vienen mejor y os reservamos.`,
      followUp:
        "Hola:\n\nGenial. Os las podríamos llevar el lunes, el martes y el miércoles de la semana que viene a primera hora. ¿Os sirve?\n\nUn saludo,\nIsabel",
      draft:
        "Hola, Isabel:\n\nSí, nos sirve. Os esperamos el lunes, el martes y el miércoles a las 8:30, una furgoneta cada día. Cada una estará lista a mediodía y os avisaremos por aquí cuando podáis recogerla.",
    },
  }),

  academia: (v) => ({
    booking: {
      ask: "Hola, mi hijo quiere empezar inglés. ¿Se puede hacer una clase de prueba?",
      offer: `¡Hola, Laura! Claro, la clase de prueba es gratuita. Tengo plaza ${v.day} a las ${v.time} en el ${v.resource}. ¿Os viene bien?`,
      choose: "Sí, perfecto. Tiene 12 años.",
      confirm: `¡Genial! Os he reservado la clase de prueba ${v.day} a las ${v.time} en el ${v.resource}. Al terminar, el profesor os dirá qué grupo le recomienda para su edad y su nivel. Si necesitáis cambiar la reserva, escríbeme por aquí.`,
    },
    voice: {
      transcript:
        "Hola, buenas. Quería información sobre la preparación del examen oficial de inglés, el B2. ¿Cuándo empiezan los grupos y cuánto cuesta? Gracias.",
      reply: `¡Hola, Antonio! Tenemos grupos de preparación del B2 con sesiones de hora y media, con un precio orientativo de ${v.price("preparacion-examen")} por sesión. Empiezan cada trimestre y antes se hace una clase de prueba gratuita para ver el nivel. ¿Quieres que te la reserve?`,
    },
    image: {
      caption: "Hola, estas son las notas de mi hija este trimestre. La barra roja es inglés. ¿Podéis ayudarla?",
      description: "Gráfico de barras con las notas de cinco asignaturas; la cuarta barra, en rojo, es la más baja: un 4.",
      reply:
        "Gracias por enseñárnoslo. Sí, podemos ayudarla: tenemos refuerzo escolar en grupo y clases particulares de inglés. Lo mejor es empezar con una clase de prueba gratuita para ver su nivel. ¿Te la reservo?",
    },
    urgent: {
      problem: "Hola. Mi hija sale hoy de clase a las 19:00 y no voy a poder recogerla hasta las 20:00. ¿Alguien podría quedarse con ella? Es muy importante.",
      reason: "No puede recoger hoy a su hija a la salida de clase",
      summary: "Beatriz no puede recoger hoy a su hija a las 19:00 y llegará a las 20:00; pregunta si alguien puede quedarse con ella. Hay que contestarle antes de las 19:00.",
      after: "Gracias, quedo a la espera.",
    },
    email: {
      subject: "Clases de inglés para el equipo de una empresa",
      first:
        "Buenos días:\n\nEn nuestra empresa queremos ofrecer clases de inglés a seis personas del equipo, con niveles parecidos (B1). Nos vendrían bien dos tardes por semana.\n\n¿Podrían enviarnos información?\n\nUn saludo,\nIsabel Prieto",
      reply: `Hola, Isabel:\n\nGracias por escribirnos. Podemos formar un grupo de inglés para vuestro equipo: las clases en grupo son de una hora, con un precio orientativo de ${v.price("ingles-grupo")} por persona y clase.\n\nAntes de empezar, cada persona hace una clase de prueba gratuita para confirmar su nivel. ¿Qué tardes os vendrían mejor?`,
      followUp: "Hola:\n\nNos vendrían bien los martes y los jueves de 18:00 a 19:00. ¿Cuándo podrían hacer la prueba de nivel?\n\nUn saludo,\nIsabel",
      draft:
        "Hola, Isabel:\n\nLos martes y los jueves de 18:00 a 19:00 nos van bien. Las clases de prueba se pueden hacer cualquier tarde de lunes a jueves a partir de las 16:00: dinos cuándo prefiere venir cada persona y se las reservamos.",
    },
  }),

  inmobiliaria: (v) => ({
    booking: {
      ask: "Hola, quiero vender mi piso y me gustaría saber cuánto podría valer. ¿Hacéis valoraciones?",
      offer: `¡Hola, Laura! Sí, hacemos valoraciones sin compromiso. ${v.resource} puede ir a verlo ${v.day} a las ${v.time}. ¿Te viene bien?`,
      choose: "Sí, perfecto. Es un tercero en el barrio de Chamberí.",
      confirm: `¡Anotado! ${v.resource} irá a ver tu piso ${v.day} a las ${v.time} para la valoración. Si necesitas cambiar la cita, escríbeme por aquí.`,
    },
    voice: {
      transcript: "Hola, buenas. Estoy buscando un piso de alquiler de dos habitaciones por la zona, hasta unos 1.100 euros al mes. ¿Tenéis algo?",
      reply: `¡Hola, Antonio! Gracias por el mensaje. Para enseñarte los pisos de dos habitaciones que tenemos en alquiler, lo mejor es una cita con ${v.person("profesional-2")}, que te propondrá visitas. ¿Qué día te viene bien?`,
    },
    image: {
      caption: "Hola, he visto esta casa en vuestro escaparate. ¿Sigue disponible? ¿Se puede ver?",
      description: "Casa de dos plantas con fachada blanca, tejado rojo y jardín delantero.",
      reply:
        "Gracias por la foto. Es una casa de dos plantas con jardín. Para confirmarte si sigue disponible necesito la referencia, que viene en la ficha del escaparate. Si me la pasas, te propongo día para verla con uno de nuestros agentes.",
    },
    urgent: {
      problem: "Hola. Soy la inquilina del piso de la calle Arenal. Esta mañana ha reventado una tubería en la cocina y está saliendo mucha agua.",
      reason: "Fuga de agua importante en un piso alquilado",
      summary: "Beatriz, inquilina de un piso que gestiona la agencia, dice que ha reventado una tubería en la cocina y sale mucha agua. Hay que llamarla ya y avisar al propietario.",
      after: "He cerrado la llave de paso. Espero vuestra llamada.",
    },
    email: {
      subject: "Busco local para una cafetería",
      first:
        "Buenos días:\n\nEstoy buscando un local en alquiler de unos 80 m² para abrir una cafetería, a ser posible con salida de humos y en una calle con paso de gente.\n\n¿Tienen algo que se ajuste?\n\nUn saludo,\nIsabel Prieto",
      reply:
        "Hola, Isabel:\n\nGracias por escribirnos. Trabajamos con locales en alquiler y podemos buscarte uno que encaje. Para afinar la búsqueda, ¿nos dices qué zonas te interesan y hasta qué renta mensual quieres llegar?\n\nCon eso, uno de nuestros agentes te propondrá visitas.",
      followUp: "Hola:\n\nMe interesan el centro y la zona de Argüelles, hasta unos 1.800 € al mes. Podría hacer visitas por las mañanas.\n\nUn saludo,\nIsabel",
      draft:
        "Hola, Isabel:\n\nGracias por los datos. Buscaremos locales en el centro y en Argüelles hasta 1.800 € al mes, con salida de humos. En cuanto tengamos opciones, un agente te escribirá en este hilo para proponerte visitas por la mañana.",
    },
  }),

  tienda: (v) => ({
    booking: {
      ask: "¡Hola! Quería ir a la tienda para que me ayudéis a elegir un regalo. ¿Se puede pedir cita?",
      offer: `¡Hola, Laura! Claro, así te atendemos con calma. ${v.resource} tiene hueco ${v.day} a las ${v.time}. ¿Te viene bien?`,
      choose: "Sí, perfecto. Es un regalo para mi hermana.",
      confirm: `¡Genial! Te he reservado una cita ${v.day} a las ${v.time} con ${v.resource}. Si me cuentas qué le gusta a tu hermana, se lo digo para que te tenga ideas preparadas. Si necesitas cambiar la cita, escríbeme por aquí.`,
    },
    voice: {
      transcript: "Hola, buenas. Quería saber si hacéis envíos a domicilio y cuánto tarda en llegar un pedido. Gracias.",
      reply: "¡Hola, Antonio! Sí, hacemos envíos a domicilio. El plazo y el coste dependen de la zona: dime tu código postal y te digo cuánto tardaría.",
    },
    image: {
      caption: "Hola, ¿tenéis esta camiseta en talla M?",
      description: "Camiseta de algodón de manga corta, de color verde oliva, sobre fondo claro.",
      reply:
        "¡Buena elección! Es la camiseta de algodón en verde oliva. Le pregunto al equipo si queda en talla M y te contestamos por aquí; si quieres, te la apartamos para que vengas a probártela.",
    },
    urgent: {
      problem: "Hola. Me acaba de llegar el pedido y la lámpara viene con el cristal hecho añicos. Era un regalo para mañana.",
      reason: "Pedido recibido con la lámpara rota; es un regalo para mañana",
      summary: "Beatriz ha recibido su pedido con el cristal de la lámpara destrozado y la necesita para un regalo mañana. Hay que ofrecerle una solución hoy.",
      after: "Os mando foto si hace falta.",
    },
    email: {
      subject: "Cestas de regalo para clientes de empresa",
      first:
        "Buenos días:\n\nNos gustaría encargar 20 cestas de regalo para los clientes de nuestra empresa, para entregar la primera semana de diciembre.\n\n¿Podrían prepararlas y enviarnos precio?\n\nUn saludo,\nIsabel Prieto",
      reply:
        "Hola, Isabel:\n\nGracias por pensar en nosotros. Sí, preparamos cestas de regalo para empresas. Para darte un precio, ¿nos dices cuánto queréis gastar aproximadamente por cesta y si queréis incluir una tarjeta con vuestro logo?\n\nCon eso te enviamos una propuesta.",
      followUp: "Hola:\n\nPensábamos en unos 40 € por cesta, con una tarjeta con nuestro logo. ¿Las entregáis vosotros?\n\nUn saludo,\nIsabel",
      draft:
        "Hola, Isabel:\n\nPerfecto: 20 cestas de unos 40 € cada una, con vuestra tarjeta. Te prepararemos una propuesta con dos opciones de contenido y te la enviaremos en este hilo. Sobre la entrega, el equipo te confirmará si podemos llevarlas nosotros según la dirección.",
    },
  }),

  otro: (v) => ({
    booking: {
      ask: "Hola, me gustaría pedir una cita para contaros un proyecto. ¿Qué disponibilidad tenéis?",
      offer: `¡Hola, Laura! Claro. ${v.resource} tiene hueco ${v.day} a las ${v.time} para una primera cita de 30 minutos. ¿Te viene bien?`,
      choose: "Sí, me viene genial.",
      confirm: `¡Perfecto! Te he reservado la cita ${v.day} a las ${v.time} con ${v.resource}. Si quieres, trae la información que tengas del proyecto. Si necesitas cambiar la cita, escríbeme por aquí.`,
    },
    voice: {
      transcript: "Hola, buenas. Quería saber qué horario tenéis y si se puede ir sin cita o hay que pedirla antes. Gracias.",
      reply: `¡Hola, Antonio! Atendemos ${v.hours}. Para que no tengas que esperar, es mejor pedir cita: te la puedo reservar ahora mismo. ¿Qué día te viene bien?`,
    },
    image: {
      caption: "Hola, os mando el croquis del local. ¿Me podéis ayudar a reorganizarlo?",
      description: "Croquis sencillo de un local con tres espacios y la puerta de entrada marcada en azul.",
      reply: `Gracias por el croquis: se ven tres espacios y la entrada. Para ver cómo podemos ayudarte, lo mejor es una cita con ${v.person("profesional-1")} o ${v.person("profesional-2")}, que revisarán el plano contigo. ¿Te busco hueco?`,
    },
    urgent: {
      problem: "Hola. Tenía cita esta mañana y nadie me ha atendido: he estado esperando media hora en la puerta.",
      reason: "Tenía cita y nadie le atendió",
      summary: "Beatriz tenía cita esta mañana y ha esperado media hora en la puerta sin que nadie la atendiera. Hay que pedirle disculpas y darle una cita nueva hoy.",
      after: "Espero que me lo solucionéis.",
    },
    email: {
      subject: "Solicitud de información",
      first: "Buenos días:\n\nMe gustaría recibir información sobre sus servicios y saber si trabajan también con empresas.\n\nUn saludo,\nIsabel Prieto",
      reply:
        "Hola, Isabel:\n\nGracias por escribirnos. Sí, trabajamos con particulares y con empresas, con citas de 30 minutos o de una hora según lo que necesites. ¿Nos cuentas un poco qué buscas? Así te decimos cómo podemos ayudarte y te proponemos una cita.",
      followUp: "Hola:\n\nSomos una empresa de diez personas y queremos reorganizar la oficina. ¿Podríais venir a verla?\n\nUn saludo,\nIsabel",
      draft:
        "Hola, Isabel:\n\nGracias por los detalles. Para ver la oficina lo mejor es una cita de una hora con uno de nuestros profesionales. ¿Qué días de la semana que viene os vendrían bien? Te proponemos hora en este mismo hilo.",
    },
  }),
};

export function sectorScript(sector: Sector, vars: ScriptVars): SectorScript {
  return SECTOR_SCRIPTS[sector](vars);
}

// ─── Opening hours in words ─────────────────────────────────────────────────────────────────────────────

const WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const WEEKDAY_PLURALS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábados", "domingos"];

/** «9:00» from minutes after midnight. */
export function clockTime(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

function joinWithY(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/** The weekly hours as a customer would say them. Days with the same ranges in a row go together. */
export function describeOpeningHours(hours: readonly WeeklyRange[]): string {
  const byDay = new Map<number, string>();
  for (let weekday = 1; weekday <= 7; weekday++) {
    const ranges = hours
      .filter((range) => range.weekday === weekday)
      .sort((a, b) => a.startMin - b.startMin)
      .map((range) => `de ${clockTime(range.startMin)} a ${clockTime(range.endMin)}`);
    if (ranges.length > 0) byDay.set(weekday, joinWithY(ranges));
  }
  const groups: { from: number; to: number; ranges: string }[] = [];
  for (const [weekday, ranges] of byDay) {
    const last = groups[groups.length - 1];
    if (last && last.ranges === ranges && last.to === weekday - 1) last.to = weekday;
    else groups.push({ from: weekday, to: weekday, ranges });
  }
  const parts = groups.map(({ from, to, ranges }) => {
    const days =
      from === to
        ? `los ${WEEKDAY_PLURALS[from - 1]}`
        : to === from + 1
          ? `los ${WEEKDAY_PLURALS[from - 1]} y los ${WEEKDAY_PLURALS[to - 1]}`
          : `de ${WEEKDAY_NAMES[from - 1]} a ${WEEKDAY_NAMES[to - 1]}`;
    return `${days}, ${ranges}`;
  });
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join("; ")}, y ${parts[parts.length - 1]}`;
}
