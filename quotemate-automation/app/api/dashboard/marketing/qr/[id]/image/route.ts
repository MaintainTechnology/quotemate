// GET /api/dashboard/marketing/qr/[id]/image?format=png|svg
//
// Returns the QR image encoding the public /s/<short_code> link. No auth:
// the image only encodes an already-public redirect URL, the id is an
// unguessable uuid, and <img>/download links can't send Bearer headers.

import { createClient } from '@supabase/supabase-js'
import { renderQrSvg, renderQrPngBuffer } from '@/lib/marketing/qr'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

function appOrigin(req: Request): string {
  return process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const format = new URL(req.url).searchParams.get('format') === 'svg' ? 'svg' : 'png'

  const { data: qr } = await supabase
    .from('marketing_qrs')
    .select('short_code, label')
    .eq('id', id)
    .maybeSingle()
  if (!qr) return new Response('Not found', { status: 404 })

  const target = `${appOrigin(req)}/s/${qr.short_code}`
  const filename = `qr-${qr.short_code}.${format}`

  if (format === 'svg') {
    const svg = await renderQrSvg(target)
    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=3600',
      },
    })
  }
  const png = await renderQrPngBuffer(target)
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
