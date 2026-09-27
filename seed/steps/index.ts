// Steps of the demo seed, in order. Later phases add theirs here (knowledge, bookings…): a step reads what earlier
// steps created from `ctx.refs`.
import type { SeedStep } from "../types";
import { agendaStep } from "./agenda";
import { agentsStep } from "./agents";
import { bookingsStep } from "./bookings";
import { businessStep } from "./business";
import { channelsStep } from "./channels";
import { conversationsStep } from "./conversations";
import { hoursStep } from "./hours";
import { knowledgeStep } from "./knowledge";
import { usersStep } from "./users";
import { whatsappStep } from "./whatsapp";

export const SEED_STEPS: readonly SeedStep[] = [businessStep, usersStep, hoursStep, agendaStep, agentsStep, channelsStep, whatsappStep, conversationsStep, bookingsStep, knowledgeStep];
