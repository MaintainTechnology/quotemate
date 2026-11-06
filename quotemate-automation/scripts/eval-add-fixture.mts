// TKO-00c: promotes a live run a tradie corrected into the eval's corpus
// (DEC-036). The run's plans, its request without the site, and its correction
// without drawing text go to the plans bucket as eval/<name>/, where the
// nightly eval reads them. The fixture is kept as long as the run (D-06), and
// the retention sweep deletes it then. Run it under staging's variables:
//
//   railway run -e staging -s qm-roofing-takeoff -- \
//     node node_modules/tsx/dist/cli.mjs scripts/eval-add-fixture.mts --tenant <id> --run <id> --name <slug>

import { parseArgs } from 'node:util'
import { promoteRun } from '@/lib/roofing/plan-takeoff/eval'
import { getServiceClient } from '@/lib/supabase/admin'

const { values } = parseArgs({ options: { tenant: { type: 'string' }, run: { type: 'string' }, name: { type: 'string' } } })
if (!values.tenant || !values.run || !values.name) {
  console.error('Usage: eval-add-fixture.mts --tenant <tenant id> --run <run id> --name <lower-case-slug>')
  process.exit(2)
}

const REASONS = {
  invalid_name: 'the name must be lower-case letters, digits and hyphens',
  not_found: 'no run of that id for that tenant',
  not_corrected: 'no tradie has corrected the run yet',
  exists: 'a fixture of that name is already in the corpus',
} as const

const outcome = await promoteRun(getServiceClient(), process.env.TAKEOFF_STORAGE_BUCKET?.trim() || 'plan-pdfs', {
  tenantId: values.tenant,
  runId: values.run,
  name: values.name,
})
console.log(outcome.ok
  ? `Promoted as eval/${outcome.name}/ with ${outcome.files} plan files; the nightly eval reads it from tonight.`
  : `Not promoted: ${REASONS[outcome.error]}.`)
process.exitCode = outcome.ok ? 0 : 1
