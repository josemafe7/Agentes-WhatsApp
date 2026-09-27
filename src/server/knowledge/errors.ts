// Errors of the knowledge pipeline. Every message is Spanish, generic and safe to show next to the document
// ([CON-05]: «error (con motivo)», [SEG-14]).
import "server-only";
import { ConflictError, ValidationError } from "@/server/errors";

export const KNOWLEDGE_MESSAGES = {
  unsupportedFile: "Ese tipo de archivo no se admite. Sube un PDF, DOCX, XLSX, CSV, TXT o MD.",
  unsupportedContextFile: "Ese tipo de archivo no se admite. Sube un PDF, DOCX, TXT o MD, o pega el texto.",
  oldExcel: "Los archivos .xls antiguos no se admiten. Guárdalo como .xlsx o .csv y súbelo de nuevo.",
  fileTooLarge: (maxMb: number) => `El archivo es demasiado grande. El máximo es ${maxMb} MB.`,
  emptyFile: "El archivo está vacío.",
  duplicate: "Este archivo ya está en la base.",
  duplicateUrl: "Esa página web ya está en la base.",
  scannedWithoutKey: "PDF escaneado: añade la clave de Mistral OCR en Ajustes > IA para leerlo.",
  scannedContextFile: "Este PDF es una imagen escaneada y no tiene texto. Pega el texto o súbelo a una base de conocimiento.",
  unreadablePdf: "No se ha podido leer el PDF. Puede estar protegido con contraseña o dañado.",
  tooManyPages: (max: number) => `El PDF tiene más de ${max} páginas y no se puede procesar.`,
  unreadableDocx: "No se ha podido leer el documento de Word. Puede estar dañado.",
  unreadableSpreadsheet: "No se ha podido leer la hoja de cálculo. Puede estar dañada.",
  noText: "No se ha encontrado texto en el documento.",
  missingFile: "No se encuentra el archivo del documento. Bórralo y súbelo de nuevo.",
  wrongDimensions: (model: string, dims: number) =>
    `El modelo de embeddings «${model}» no da vectores de ${dims} dimensiones. Elige otro en Ajustes > IA y vuelve a procesar la base.`,
  unexpected: "No se ha podido procesar el documento. Vuelve a intentarlo más tarde.",
} as const;

/** A document that cannot be processed as it is (retrying will not help): its status becomes «error» with this reason. */
export class KnowledgeProcessingError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "KnowledgeProcessingError";
  }
}

export class UnsupportedFileError extends ValidationError {
  constructor(message: string = KNOWLEDGE_MESSAGES.unsupportedFile) {
    super(message, { file: [message] });
  }
}

export class DuplicateDocumentError extends ConflictError {
  constructor(message: string = KNOWLEDGE_MESSAGES.duplicate) {
    super(message);
  }
}
