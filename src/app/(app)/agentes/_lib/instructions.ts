// Guided instructions as the forms edit them ([AGE-04]): every field present, empty when missing. Pure (usable from
// server pages and client forms).
import { INSTRUCTION_FIELDS, type InstructionFieldKey } from "./labels";

export type InstructionValues = Record<InstructionFieldKey, string>;

/** Stored or generated instructions → the form. */
export function instructionValues(stored: Partial<Record<InstructionFieldKey, string | null>> | null | undefined): InstructionValues {
  return Object.fromEntries(INSTRUCTION_FIELDS.map((field) => [field.key, stored?.[field.key] ?? ""])) as InstructionValues;
}
