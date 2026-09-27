// Demo agents ([ARR-06], [AGE-02], [AGE-04], [AGE-09], [AGE-12]), built for any sector from its preset:
// - reception: the sector template itself (what the setup wizard offers), edited once afterwards;
// - email: the same business knowledge, written as emails (for the demo email channel);
// - off-hours: prepared for when the business is closed, not active in any channel (spec: «queda preparado»).
// Models are the defaults of Settings › IA with a fallback of another provider ([MOD-05]); each agent has one or two
// saved versions with their author and date. Later steps (channels, knowledge) find them in ctx.refs.agentIds by key.
// Every demo agent searches the demo knowledge base in «Automático» ([AGE-07], [HER-01]): the knowledge step gives
// them the base, and here they get buscar_conocimiento on top of the tools of a new agent.
import type { AgentConfig } from "@/data/agents";
import { loadIntegrationSettings } from "@/data/settings";
import { agents, agentVersions, type AgentHandoffConfig, type DefaultModels } from "@/db/schema";
import { agentCreateSchema } from "@/lib/agent-input";
import { DEFAULT_SYSTEM_TOOLS, type SystemToolName } from "@/lib/agent-tools";
import type { Role } from "@/lib/enums";
import { DEFAULT_MODELS, defaultFallbackFor } from "@/lib/openrouter/default-models";
import { TERMINOLOGY_OPTIONS, type SectorPreset } from "@/lib/sectors";
import { NEVER_INVENT, NO_SENSITIVE_DATA } from "@/lib/sectors/common";
import type { DemoBusiness } from "../businesses";
import type { SeedStep } from "../types";
import { DEMO_USERS } from "../users";

export const DEMO_AGENT_KEYS = ["recepcion", "correo", "fuera-de-horario"] as const;
export type DemoAgentKey = (typeof DEMO_AGENT_KEYS)[number];

type Author = Extract<Role, "owner" | "admin">;
export type DemoAgentVersion = { config: AgentConfig; author: Author; daysAgo: number };
export type DemoAgentPlan = { key: DemoAgentKey; versions: DemoAgentVersion[] };

export type DemoAgentsInput = {
  preset: SectorPreset;
  business: DemoBusiness;
  models: { model: string; fallbackModel: string };
  /** People the reception agent's hand-off notifies from its second version on ([AGE-09]). */
  notifyUserIds: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The tools of a new agent plus the knowledge search: the demo agents have a base to search ([AGE-07], [HER-01]). */
export const DEMO_AGENT_TOOLS: readonly SystemToolName[] = ["buscar_conocimiento", ...DEFAULT_SYSTEM_TOOLS];

/** The booking tools ([HER-01]): the reception agent books for the customers of its channels; the others do not. */
export const DEMO_BOOKING_TOOLS: readonly SystemToolName[] = [
  "listar_servicios",
  "consultar_disponibilidad",
  "crear_cita",
  "ver_citas_del_cliente",
  "cancelar_cita",
  "reprogramar_cita",
  "guardar_datos_contacto",
];

/** Default models of Settings › IA (or the recommended ones), never two of the same provider ([MOD-05]). */
export function demoAgentModels(defaults: DefaultModels): { model: string; fallbackModel: string } {
  const model = defaults.chat || DEFAULT_MODELS.chat;
  return { model, fallbackModel: defaultFallbackFor(model, defaults.fallback) };
}

function customersOf(preset: SectorPreset): string {
  const { customer } = preset.terminology;
  return TERMINOLOGY_OPTIONS.customer.find((option) => option.singular === customer)?.plural ?? `${customer}s`;
}

/** Plain text fields of an agent over the defaults every demo agent shares. */
function agentConfig(
  fields: Pick<AgentConfig, "name" | "description" | "tone" | "instructions" | "handoff">,
  models: DemoAgentsInput["models"],
): AgentConfig {
  return {
    avatarFileKey: null,
    language: "es",
    temperature: null,
    reasoningEffort: null,
    maxOutputTokens: null,
    knowledgeMode: "auto",
    systemTools: [...DEMO_AGENT_TOOLS],
    ...models,
    ...fields,
  };
}

/** The editor's own validation ([AGE-15]): a demo agent the app could not save is a bug in this file. */
function assertValid(key: DemoAgentKey, config: AgentConfig): void {
  // The avatar is not a field of the editor's form (it is uploaded apart); demo agents have none.
  const input: Record<string, unknown> = { ...config };
  delete input.avatarFileKey;
  const parsed = agentCreateSchema.safeParse(input);
  if (!parsed.success) throw new Error(`El agente de demo «${key}» no es válido: ${parsed.error.message}`);
}

/** The three demo agents with their versions, oldest first. Pure: the same input gives the same agents. */
export function buildDemoAgents({ preset, business, models, notifyUserIds }: DemoAgentsInput): DemoAgentPlan[] {
  const template = preset.agentTemplate;
  const { customer, bookings } = preset.terminology;
  const customers = customersOf(preset);
  const templateHandoff: AgentHandoffConfig = {
    keywords: [...template.handoff.keywords],
    sensitiveTopics: [...template.handoff.sensitiveTopics],
    unknownThreshold: template.handoff.unknownThreshold,
    messageInHours: template.handoff.messageInHours,
    messageOffHours: template.handoff.messageOffHours,
  };

  const reception: AgentConfig = {
    ...agentConfig(
      {
        name: template.name,
        description: template.description,
        tone: template.tone,
        instructions: { ...template.instructions },
        handoff: templateHandoff,
      },
      models,
    ),
    systemTools: [...DEMO_AGENT_TOOLS, ...DEMO_BOOKING_TOOLS],
  };
  const receptionEdited: AgentConfig = {
    ...reception,
    instructions: {
      ...reception.instructions,
      freeText: `En tu primer mensaje preséntate como el asistente de ${business.name}. Si el ${customer} prefiere hablar por teléfono, dale el teléfono del negocio.`,
    },
    handoff: {
      ...reception.handoff,
      messageInHours: `Te paso con una persona del equipo de ${business.name}, que te contestará por aquí en cuanto pueda.`,
      ...(notifyUserIds.length > 0 ? { notifyUserIds: [...notifyUserIds] } : {}),
    },
  };

  const email = agentConfig(
    {
      name: "Asistente de correo",
      description: `Contesta los correos de los ${customers} con la forma y el tono de un email.`,
      tone: "Cordial y profesional",
      instructions: {
        role: `Eres el asistente de correo de ${business.name}. Contestas los correos que escriben los ${customers}: resuelves sus dudas y les ayudas con sus ${bookings}.`,
        businessInfo: template.instructions.businessInfo,
        can: template.instructions.can,
        cannot: template.instructions.cannot,
        style:
          "Escribe como en un correo: saluda (por su nombre si lo sabes), usa párrafos cortos, deja muy claros los datos importantes (día, hora y precio) y despídete con el nombre del negocio. Trata de tú y no uses emojis.",
        handoff: `${template.instructions.handoff} Pasa también a una persona los correos con facturas, reclamaciones formales o asuntos legales.`,
      },
      handoff: {
        ...templateHandoff,
        keywords: [...new Set([...templateHandoff.keywords ?? [], "factura"])],
        messageInHours: "Gracias por tu correo. Se lo paso a una persona del equipo, que te responderá en este mismo hilo lo antes posible.",
        messageOffHours: "Gracias por tu correo. Ahora mismo estamos cerrados: una persona del equipo te responderá en este mismo hilo en cuanto abramos.",
      },
    },
    models,
  );

  const offHours = agentConfig(
    {
      name: "Asistente fuera de horario",
      description: "Preparado para atender cuando el negocio está cerrado. Todavía no está activo en ningún canal.",
      tone: "Tranquilo y servicial",
      instructions: {
        role: `Eres el asistente de ${business.name} fuera del horario de apertura. Atiendes cuando el equipo no está: resuelves dudas sencillas y dejas anotado lo que necesita cada ${customer} para que el equipo le conteste al abrir.`,
        businessInfo: template.instructions.businessInfo,
        can: `Resolver dudas con la información del negocio y las preguntas frecuentes; decir cuándo vuelve a abrir el negocio; anotar qué necesita el ${customer} y cuándo le viene bien que le contesten.`,
        cannot: `No confirmes, cambies ni anules ${bookings} por tu cuenta: di que el equipo lo revisará en cuanto abra. ${NEVER_INVENT} ${NO_SENSITIVE_DATA}`,
        style: template.instructions.style,
        handoff: `Si es urgente, si hay una queja o si el ${customer} pide hablar con una persona, pasa la conversación al equipo y dile cuándo abrimos.`,
      },
      handoff: { ...templateHandoff, unknownThreshold: 1 },
    },
    models,
  );
  const offHoursEdited: AgentConfig = {
    ...offHours,
    instructions: {
      ...offHours.instructions,
      freeText: "Al despedirte, recuerda el horario del próximo día que abrimos.",
    },
  };

  const plans: DemoAgentPlan[] = [
    {
      key: "recepcion",
      versions: [
        { config: reception, author: "owner", daysAgo: 21 },
        { config: receptionEdited, author: "admin", daysAgo: 6 },
      ],
    },
    { key: "correo", versions: [{ config: email, author: "admin", daysAgo: 14 }] },
    {
      key: "fuera-de-horario",
      versions: [
        { config: offHours, author: "owner", daysAgo: 9 },
        { config: offHoursEdited, author: "owner", daysAgo: 2 },
      ],
    },
  ];
  for (const plan of plans) for (const version of plan.versions) assertValid(plan.key, version.config);
  return plans;
}

export const agentsStep: SeedStep = {
  name: "agentes",
  prepare: async (ctx) => async (tx) => {
    // Read inside the transaction: earlier steps of this same load may have (re)created the settings rows.
    const { defaultModels } = await loadIntegrationSettings(tx);
    const person = (role: Role) => {
      const demoUser = DEMO_USERS.find((candidate) => candidate.role === role);
      return { id: demoUser ? (ctx.refs.userIds.get(demoUser.email) ?? null) : null, name: demoUser?.name ?? null };
    };
    const supervisor = person("supervisor");
    const plans = buildDemoAgents({
      preset: ctx.preset,
      business: ctx.business,
      models: demoAgentModels(defaultModels),
      notifyUserIds: supervisor.id ? [supervisor.id] : [],
    });

    const agentIds = new Map<string, string>();
    for (const plan of plans) {
      const first = plan.versions[0];
      const last = plan.versions[plan.versions.length - 1];
      const dateOf = (version: DemoAgentVersion) => new Date(ctx.now.getTime() - version.daysAgo * DAY_MS);
      const agentId = crypto.randomUUID();
      await tx.insert(agents).values({
        id: agentId,
        ...last.config,
        templateSector: ctx.sector,
        currentVersion: plan.versions.length,
        createdBy: person(first.author).id,
        createdAt: dateOf(first),
        updatedAt: dateOf(last),
      });
      await tx.insert(agentVersions).values(
        plan.versions.map((version, index) => {
          const author = person(version.author);
          return {
            agentId,
            version: index + 1,
            snapshot: { ...version.config } as Record<string, unknown>,
            createdBy: author.id,
            createdByName: author.name,
            createdAt: dateOf(version),
            updatedAt: dateOf(version),
          };
        }),
      );
      agentIds.set(plan.key, agentId);
    }
    ctx.refs.agentIds = agentIds;
  },
};
