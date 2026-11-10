// Puts the eval's fixtures in the plans bucket (TKO-15, DEC-040). Each goes
// under eval/<fixture>/: its plan PDFs from the git-ignored
// docs/tag-roofing-requests/, beside its request, hand-measured reference and,
// where it has one, the operator's answer to its numbered roof areas (TKO-30)
// from eval/roof-takeoff/. The eval and the service's nightly run read them
// there. An upload replaces what is there. Prints names and sizes only.
//
//   node --env-file=.env.local scripts/upload-eval-fixtures.mjs

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

// The same fixtures as scripts/eval-roof-takeoff.mts.
const FIXTURES = [
  { name: 'grange', plans: 'docs/tag-roofing-requests/grange' },
  { name: 'whittaker', plans: 'docs/tag-roofing-requests/whittaker' },
]
const bucket = process.env.TAKEOFF_STORAGE_BUCKET?.trim() || 'plan-pdfs'
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

for (const { name, plans } of FIXTURES) {
  const files = [
    ...['request.json', 'takeoff.json', 'operator.json']
      .map((file) => ({ file, path: join('eval', 'roof-takeoff', name, file), type: 'application/json' }))
      .filter(({ path }) => existsSync(path)),
    ...readdirSync(plans).filter((file) => /\.pdf$/i.test(file)).sort().map((file) => ({ file, path: join(plans, file), type: 'application/pdf' })),
  ]
  for (const { file, path, type } of files) {
    const body = readFileSync(path)
    const { error } = await db.storage.from(bucket).upload(`eval/${name}/${file}`, body, { contentType: type, upsert: true })
    if (error) throw new Error(`${name}/${file}: ${error.message}`)
    console.log(`${name}/${file}: ${body.length} bytes`)
  }
  // Then what this upload didn't write goes, such as a plan renamed since,
  // which the eval would otherwise read twice. New first, so the eval never
  // finds the folder empty.
  const { data: there, error: listed } = await db.storage.from(bucket).list(`eval/${name}`, { limit: 1000 })
  if (listed) throw new Error(`${name}: ${listed.message}`)
  const kept = new Set(files.map(({ file }) => file))
  const stale = (there ?? []).filter((o) => o.id !== null && !kept.has(o.name)).map((o) => `eval/${name}/${o.name}`)
  if (stale.length) {
    const { error } = await db.storage.from(bucket).remove(stale)
    if (error) throw new Error(`${name}: ${error.message}`)
    console.log(`${name}: removed ${stale.length} file(s) the upload replaced`)
  }
}
