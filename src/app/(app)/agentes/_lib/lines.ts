// «One per line» fields of the Traspaso tab ([AGE-09]): keywords and sensitive topics are edited as text and saved as
// lists. Pure, shared by the form and its tests.

/** Text area → list: trimmed lines, no empty ones, no repeats (first spelling wins, case-insensitive). */
export function linesToList(text: string): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const key = line.toLocaleLowerCase("es");
    if (!line || seen.has(key)) continue;
    seen.add(key);
    list.push(line);
  }
  return list;
}

/** List → text area. */
export function listToLines(list: readonly string[] | null | undefined): string {
  return (list ?? []).join("\n");
}
