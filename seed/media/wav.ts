// A voice-note-like sound made in code, so the inbox player has something to play: the demo's voice note ([ARR-08],
// its transcript is stored text) and the simulator's sample note ([AJU-12]). It is a soft murmur (a low voice-like
// hum in syllables and pauses), not speech: nothing can be transcribed from it. 8 kHz, 8-bit mono WAV, about 8 KB
// per second. Pure: the same options give the same bytes.

export const VOICE_NOTE_SAMPLE_RATE = 8_000;
const HEADER_BYTES = 44;
const SYLLABLES_PER_SECOND = 4.2;

/** Deterministic pseudo-random numbers (mulberry32), so the demo file never changes between loads. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A WAV file of `seconds` seconds (RIFF, PCM, 8 kHz, 8-bit, mono). */
export function voiceNoteWav({ seconds, seed = 1 }: { seconds: number; seed?: number }): Uint8Array {
  const samples = Math.round(seconds * VOICE_NOTE_SAMPLE_RATE);
  const bytes = new Uint8Array(HEADER_BYTES + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, VOICE_NOTE_SAMPLE_RATE, true);
  view.setUint32(28, VOICE_NOTE_SAMPLE_RATE, true); // byte rate
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples, true);

  const next = random(seed);
  const syllableSamples = Math.round(VOICE_NOTE_SAMPLE_RATE / SYLLABLES_PER_SECOND);
  let phase = 0;
  let pitch = 150;
  let loudness = 0;
  for (let index = 0; index < samples; index++) {
    const inSyllable = index % syllableSamples;
    if (inSyllable === 0) {
      // A new syllable: a slightly different pitch and loudness, and now and then a pause between words.
      pitch = 125 + next() * 70;
      loudness = next() < 0.18 ? 0 : 0.45 + next() * 0.4;
    }
    const envelope = Math.sin((Math.PI * inSyllable) / syllableSamples) ** 2 * loudness;
    const fade = Math.min(1, index / 800, (samples - index) / 800);
    phase += (2 * Math.PI * pitch) / VOICE_NOTE_SAMPLE_RATE;
    // A few harmonics give the hum its voice-like colour; a little noise softens it.
    const voice = 0.6 * Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase) + 0.05 * (next() - 0.5);
    const value = 128 + Math.round(voice * envelope * fade * 90);
    bytes[HEADER_BYTES + index] = Math.min(255, Math.max(0, value));
  }
  return bytes;
}

/** Length in seconds of a WAV made by voiceNoteWav (from its header). */
export function wavDurationSeconds(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(40, true) / view.getUint32(28, true);
}
