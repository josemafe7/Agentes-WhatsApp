// Customers' files being downloaded at once, per process ([WA-41]). FileStorage.put and the Meta client work with
// whole buffers, so instead of streaming, each download reserves the most its kind may weigh (INBOUND_MEDIA_CAPS)
// before it starts, and waits while another reservation would pass the memory budget or the number of downloads at
// once. In order of arrival, so a big file is never overtaken for ever; alone, any file may go. A download that cannot
// get its turn in time fails with MediaBusyError, which the job queue retries later (the media id lasts 7 days).
import "server-only";

/** Downloads at once in one process. */
export const MEDIA_DOWNLOAD_CONCURRENCY = 3;
/** Bytes reserved at once in one process: Meta's biggest document (100 MB) plus a voice note and an image. */
export const MEDIA_DOWNLOAD_MEMORY_BYTES = 128 * 1024 * 1024;
/** How long a download waits for its turn before the job is retried later. */
export const MEDIA_DOWNLOAD_WAIT_MS = 20_000;

export class MediaBusyError extends Error {
  constructor() {
    super("Hay demasiados archivos descargándose a la vez: se reintentará en un momento.");
    this.name = "MediaBusyError";
  }
}

type Waiter = { bytes: number; resolve: (release: () => void) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> | null };

export class MemoryGate {
  private reserved = 0;
  private active = 0;
  private readonly waiting: Waiter[] = [];

  constructor(
    private readonly budgetBytes: number,
    private readonly maxConcurrent: number,
  ) {}

  /** Waits for a place for `bytes`; resolves with the function that gives it back (once), or rejects after `waitMs`. */
  acquire(bytes: number, waitMs: number): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { bytes, resolve, reject, timer: null };
      this.waiting.push(waiter);
      this.admit();
      if (!this.waiting.includes(waiter)) return;
      waiter.timer = setTimeout(() => {
        const index = this.waiting.indexOf(waiter);
        if (index < 0) return;
        this.waiting.splice(index, 1);
        reject(new MediaBusyError());
        // The next in the queue may fit now that this one leaves.
        this.admit();
      }, waitMs);
    });
  }

  usage(): { active: number; reservedBytes: number; waiting: number } {
    return { active: this.active, reservedBytes: this.reserved, waiting: this.waiting.length };
  }

  private fits(bytes: number): boolean {
    return this.active === 0 || (this.active < this.maxConcurrent && this.reserved + bytes <= this.budgetBytes);
  }

  private admit(): void {
    while (this.waiting.length > 0 && this.fits(this.waiting[0].bytes)) {
      const waiter = this.waiting.shift();
      if (!waiter) return;
      if (waiter.timer) clearTimeout(waiter.timer);
      this.active += 1;
      this.reserved += waiter.bytes;
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.active -= 1;
        this.reserved -= waiter.bytes;
        this.admit();
      });
    }
  }
}

const GATE = Symbol.for("dominia.media.inboundGate");
type WithGate = typeof globalThis & { [GATE]?: MemoryGate };

/** The process's gate, shared by every copy of this module (each route bundle has its own copy of the code). */
export function inboundMediaGate(): MemoryGate {
  const holder = globalThis as WithGate;
  holder[GATE] ??= new MemoryGate(MEDIA_DOWNLOAD_MEMORY_BYTES, MEDIA_DOWNLOAD_CONCURRENCY);
  return holder[GATE];
}
