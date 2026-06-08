// ════════════════════════════════════════════════════════════════════
// Signage Compliance — shared vision-call concurrency limiter.
//
// Both Step 1 (vision-assess) and Step 2 (kb-assess) chunk a shot's rules
// into small parallel vision calls. Without a cap, a full multi-shot AF
// assessment could fire 40+ concurrent Claude calls and hit rate limits.
// Every vision call goes through `runWithVisionLimit`, so callers can fire
// everything in parallel and this semaphore bounds the real concurrency.
//
// Default 16; override with SIGNAGE_VISION_CONCURRENCY.
// ════════════════════════════════════════════════════════════════════

let active = 0
const waiters: Array<() => void> = []

function limit(): number {
  const n = Number(process.env.SIGNAGE_VISION_CONCURRENCY)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 16
}

/** Run `fn` once a concurrency slot is free; release the slot afterward
 *  (even on throw). Order is FIFO. */
export async function runWithVisionLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= limit()) {
    await new Promise<void>((resolve) => waiters.push(resolve))
  }
  active += 1
  try {
    return await fn()
  } finally {
    active -= 1
    const next = waiters.shift()
    if (next) next()
  }
}

/** PURE — split `items` into chunks of at most `size` (>=1). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size))
  const out: T[][] = []
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n))
  return out
}

/** Rules-per-vision-call. Smaller = faster per call + more parallelism, at
 *  the cost of more calls. Override with SIGNAGE_VISION_CHUNK. */
export function visionChunkSize(): number {
  const n = Number(process.env.SIGNAGE_VISION_CHUNK)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 16
}
