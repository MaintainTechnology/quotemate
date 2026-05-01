// Generic retry-with-exponential-backoff helper.
// Used to wrap Anthropic SDK calls (Sonnet for intake, Opus for estimation)
// because Vercel function timeouts + occasional Anthropic latency spikes
// produce visible failures otherwise.
//
// Defaults: 3 attempts, 2s/4s backoff, retry on any thrown error.

export type RetryOpts = {
  /** total attempts including the first one. Default 3. */
  maxAttempts?: number
  /** base delay in ms; doubles each retry. Default 2000 (→ 2s, 4s). */
  baseDelayMs?: number
  /** decide if a given error should trigger a retry. Default: always retry. */
  shouldRetry?: (err: unknown, attempt: number) => boolean
  /** fired before each retry sleep — useful for pipeline logs. */
  onAttemptFailed?: (err: unknown, attempt: number, willRetry: boolean) => void
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const max = opts.maxAttempts ?? 3
  const baseDelay = opts.baseDelayMs ?? 2000
  const shouldRetry = opts.shouldRetry ?? (() => true)

  let lastError: unknown
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      const willRetry = attempt < max && shouldRetry(err, attempt)
      opts.onAttemptFailed?.(err, attempt, willRetry)
      if (!willRetry) break
      await sleep(baseDelay * Math.pow(2, attempt - 1))
    }
  }
  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
