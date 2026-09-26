// Runs once when a Next.js server starts, before it answers any request (node_modules/next/dist/docs:
// instrumentation.md). [SEG-03]: without a usable APP_ENCRYPTION_KEY the app does not start and says why.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertEncryptionKeyConfigured, EncryptionKeyError } = await import("./server/crypto");
  try {
    assertEncryptionKeyConfigured();
  } catch (error) {
    // Only the explanation: never the value of the key.
    if (error instanceof EncryptionKeyError) console.error(`[arranque] La app no puede arrancar. ${error.message}`);
    throw error;
  }
}
