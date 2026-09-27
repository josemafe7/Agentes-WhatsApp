// What the media processing leaves in `messages.metadata` ([MED-03]–[MED-05]). The transcript itself goes in
// `messages.transcript`. Pure, so the inbox can read it: `transcriptionFailed` shows «No se pudo transcribir».
import "server-only";

export type MediaProcessingMetadata = {
  /** The audio could not be transcribed (too big, rejected by every model, or unreadable) ([MED-03]). */
  transcriptionFailed: boolean;
  /** Description by the cheap vision model, for agents whose model does not see images ([MED-05]). */
  imageDescription: string | null;
  /** The vision model could not describe it: not asked again on every turn. */
  imageDescriptionFailed: boolean;
};

export function mediaMetadataOf(metadata: Record<string, unknown> | null | undefined): MediaProcessingMetadata {
  const description = metadata?.imageDescription;
  return {
    transcriptionFailed: metadata?.transcriptionFailed === true,
    imageDescription: typeof description === "string" && description.trim() ? description : null,
    imageDescriptionFailed: metadata?.imageDescriptionFailed === true,
  };
}

/** The keys this module writes; anything else in the metadata is left as it was. */
export type MediaMetadataPatch = Partial<{ transcriptionFailed: true; imageDescription: string; imageDescriptionFailed: true; transcribedAt: string }>;

/**
 * When the voice note was transcribed (ISO date saved with its transcript): its file is kept some days from then
 * ([CUM-05]). Null for transcripts saved before this was recorded, or a value that is not a date.
 */
export function transcribedAtOf(metadata: Record<string, unknown> | null | undefined): Date | null {
  const value = metadata?.transcribedAt;
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}
