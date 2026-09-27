// Campos personalizados of a contact ([CTO-02]): the form edits them as rows (name and value) and saves them as one
// object. Checked here to explain each row; the server validates again (contactInputSchema in src/data/contacts.ts).

/** Same limits as contactInputSchema (src/data/contacts.ts); the actions test checks they match. */
export const CUSTOM_FIELD_NAME_MAX = 40;
export const CUSTOM_FIELD_VALUE_MAX = 500;

export type CustomFieldRow = { key: string; value: string };

export type CustomFieldsResult = { ok: true; fields: Record<string, string> } | { ok: false; errors: Record<number, string> };

export function rowsFromCustomFields(fields: Record<string, string>): CustomFieldRow[] {
  return Object.entries(fields).map(([key, value]) => ({ key, value }));
}

/** Rows → saved fields: trimmed, empty rows skipped; a row without a name or with a repeated name is explained. */
export function customFieldsFromRows(rows: CustomFieldRow[]): CustomFieldsResult {
  const fields: Record<string, string> = {};
  const errors: Record<number, string> = {};
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const key = row.key.trim();
    const value = row.value.trim();
    if (!key && !value) return;
    if (!key) errors[index] = "Escribe el nombre del campo.";
    else if (key.length > CUSTOM_FIELD_NAME_MAX) errors[index] = `El nombre puede tener como mucho ${CUSTOM_FIELD_NAME_MAX} caracteres.`;
    else if (value.length > CUSTOM_FIELD_VALUE_MAX) errors[index] = `El valor puede tener como mucho ${CUSTOM_FIELD_VALUE_MAX} caracteres.`;
    else if (seen.has(key.toLocaleLowerCase("es"))) errors[index] = "Ya hay un campo con este nombre.";
    else {
      seen.add(key.toLocaleLowerCase("es"));
      fields[key] = value;
    }
  });
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, fields };
}
