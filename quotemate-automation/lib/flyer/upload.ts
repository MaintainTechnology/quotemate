// Flyer Designer — uploaded-image validation (pure).
//
// Mirrors the dashboard logo-upload constraints but allows raster photos a
// little more room (5 MB) and excludes SVG, which Konva cannot rasterise
// reliably for PNG/PDF export.

export const FLYER_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const
export type FlyerImageMime = (typeof FLYER_IMAGE_MIME)[number]

export const FLYER_IMAGE_ACCEPT = FLYER_IMAGE_MIME.join(',')
export const FLYER_IMAGE_MAX_BYTES = 5 * 1024 * 1024 // 5 MB

const EXT_BY_MIME: Record<FlyerImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export function extForMime(mime: string): string | null {
  return (EXT_BY_MIME as Record<string, string>)[mime] ?? null
}

export type FlyerImageVerdict =
  | { ok: true; ext: string }
  | { ok: false; error: string; message: string }

export function validateFlyerImage(input: { mime: string; size: number }): FlyerImageVerdict {
  const ext = extForMime(input.mime)
  if (!ext) {
    return { ok: false, error: 'bad_type', message: 'Use a PNG, JPG or WEBP image.' }
  }
  if (input.size <= 0) {
    return { ok: false, error: 'empty', message: 'That file looks empty.' }
  }
  if (input.size > FLYER_IMAGE_MAX_BYTES) {
    return { ok: false, error: 'too_large', message: 'Images must be 5 MB or smaller.' }
  }
  return { ok: true, ext }
}
