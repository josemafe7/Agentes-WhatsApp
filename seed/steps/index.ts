// Steps of the demo seed, in order. Later phases add theirs here (channels, agents, contacts and conversations,
// knowledge, bookings…): a step reads what earlier steps created from `ctx.refs`.
import type { SeedStep } from "../types";
import { agendaStep } from "./agenda";
import { businessStep } from "./business";
import { hoursStep } from "./hours";
import { usersStep } from "./users";

export const SEED_STEPS: readonly SeedStep[] = [businessStep, usersStep, hoursStep, agendaStep];
