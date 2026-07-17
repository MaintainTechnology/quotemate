// Scratch diag: why is the anatomy panel stale for this measurement?
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const token = process.argv[2]

const { data: row, error: rowErr } = await supabase
  .from('roofing_measurements')
  .select('id, address, model3d_status, model3d_anatomy, model3d_glb_path')
  .eq('measure_token', token)
  .maybeSingle()
console.log('ROW:', JSON.stringify(row, null, 1), 'ERR:', rowErr?.message ?? null)
if (!row) process.exit(1)

const key = row.address
  .normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ').trim().replace(/\s+/g, '-').slice(0, 120)

for (const prefix of [`enhanced/v2/${key}`, `enhanced/v3/${key}`, `anatomy/v2/${key}`, `anatomy/v3/${key}`, `roofing/${row.id}`]) {
  const { data: files, error } = await supabase.storage.from('roof-models').list(prefix, { limit: 20 })
  console.log(prefix, '→', error ? `ERR ${error.message}` : (files ?? []).map((f) => `${f.name} (updated ${f.updated_at ?? f.created_at})`))
}
