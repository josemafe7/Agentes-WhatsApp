// Saves in the browser a file the server sent as text. Exports travel through Server Actions, never GET links: each
// one writes the activity log, and actions only take POST from the app itself ([SEG-06]).

/** Long enough for the browser to start the download before the file is released. */
const RELEASE_AFTER_MS = 10_000;
/**
 * The UTF-8 mark a spreadsheet in Spanish needs to read the accents of a CSV. The server writes it, but a Server
 * Action's answer loses a leading one on the way (its text is decoded as a new stream): a CSV gets it back here, once.
 */
const BYTE_ORDER_MARK = "\uFEFF";

export type TextFile = { fileName: string; mimeType: string; content: string };

export function saveTextFile(file: TextFile): void {
  const csv = file.mimeType.startsWith("text/csv");
  const content = csv && !file.content.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK + file.content : file.content;
  const url = URL.createObjectURL(new Blob([content], { type: file.mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), RELEASE_AFTER_MS);
}
