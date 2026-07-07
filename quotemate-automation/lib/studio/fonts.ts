// Font buffers for next/og ImageResponse (satori). next/font/google only emits
// CSS, so we bundle static woff weights (fetched from Fontsource) and hand the
// raw buffers to ImageResponse. woff is satori-supported; woff2 is not.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type OgFont = { name: string; data: Buffer; weight: 400 | 500 | 700 | 800; style: 'normal' }

let cache: OgFont[] | null = null

export function studioFonts(): OgFont[] {
  if (cache) return cache
  const dir = join(process.cwd(), 'lib', 'studio', 'fonts')
  const f = (file: string) => readFileSync(join(dir, file))
  cache = [
    { name: 'Manrope', data: f('Manrope-400.woff'), weight: 400, style: 'normal' },
    { name: 'Manrope', data: f('Manrope-500.woff'), weight: 500, style: 'normal' },
    { name: 'Manrope', data: f('Manrope-700.woff'), weight: 700, style: 'normal' },
    { name: 'Manrope', data: f('Manrope-800.woff'), weight: 800, style: 'normal' },
    { name: 'JetBrains Mono', data: f('JetBrainsMono-500.woff'), weight: 500, style: 'normal' },
    { name: 'JetBrains Mono', data: f('JetBrainsMono-700.woff'), weight: 700, style: 'normal' },
  ]
  return cache
}
