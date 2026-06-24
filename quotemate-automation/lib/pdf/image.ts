// ════════════════════════════════════════════════════════════════════
// Best-effort image preparation for Gotenberg-rendered quote PDFs.
//
// Fetches a remote image and, when `sharp` is available, downscales +
// re-encodes it to a compact data: URI so the embedded image keeps the
// output PDF small (spec specs/quote-pdf-branding.md R11 — photos to
// ~1600px longest edge / JPEG ~80; logos capped smaller, alpha kept).
//
// NEVER throws. On any failure (no network, 404, sharp missing) it returns
// null so callers degrade gracefully: omit the image, or fall back to a
// business-name wordmark for a logo (spec R6/R2 edge cases).
// ════════════════════════════════════════════════════════════════════

type PrepareOpts = {
  maxEdge?: number
  quality?: number
  /** 'jpeg' for photos (smaller); 'png' for logos (keeps transparency). */
  format?: 'jpeg' | 'png'
}

/** Fetch + (best-effort) downscale/re-encode an image to a data: URI, or null. */
export async function prepareImage(
  url: string | null | undefined,
  opts: PrepareOpts = {},
): Promise<string | null> {
  if (!url || typeof url !== 'string') return null
  const maxEdge = opts.maxEdge ?? 1600
  const quality = opts.quality ?? 80
  const format = opts.format ?? 'jpeg'
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const input = Buffer.from(await res.arrayBuffer())
    if (input.byteLength === 0) return null
    try {
      // sharp is an OPTIONAL native dep (only used to shrink the embedded
      // image). Resolve the specifier indirectly (typed `string`, not a
      // literal) so neither the TypeScript type-checker nor the bundler
      // hard-requires it — when the binary isn't installed in the
      // deployment, the dynamic import throws at runtime and the catch
      // below embeds the original bytes instead. Keeps `next build` green
      // without pinning a heavy native dependency into the lockfile.
      const sharpModule: string = 'sharp'
      const sharp = (await import(sharpModule)).default
      const pipeline = sharp(input)
        .rotate()
        .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      const out =
        format === 'png'
          ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
          : await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer()
      const mime = format === 'png' ? 'image/png' : 'image/jpeg'
      return `data:${mime};base64,${out.toString('base64')}`
    } catch {
      // sharp unavailable — embed the original bytes; the post-render size
      // guard in lib/quote/pdf.ts still enforces the 5 MB hard cap.
      const ct = res.headers.get('content-type') || 'image/jpeg'
      return `data:${ct};base64,${input.toString('base64')}`
    }
  } catch {
    return null
  }
}

/** Logo convenience: small, PNG (keeps the transparent logo on the cream header). */
export function prepareLogo(url: string | null | undefined): Promise<string | null> {
  return prepareImage(url, { maxEdge: 480, format: 'png' })
}
