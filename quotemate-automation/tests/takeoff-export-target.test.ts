import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// TKO-04: the plan takeoff's export target. qm-roofing-takeoff is not an SMS
// receptionist: its repo owns its main.ts, modules, health, Dockerfile and
// release, so its candidate is the monorepo closure plus the generic service
// files, which the service vault's Runbooks/Export and overlay.md overlays.
const exporter = (...args: string[]) =>
  execFileSync(process.execPath, ['scripts/export-receptionist.mjs', ...args], { encoding: 'utf8' })

describe('export-receptionist roofing-takeoff (TKO-04)', () => {
  const root = mkdtempSync(join(tmpdir(), 'takeoff-export-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('exports the takeoff closure and the generic service files, and none of the SMS scaffolding', () => {
    exporter('roofing-takeoff', `--out-root=${root}`)
    const out = join(root, 'qm-roofing-takeoff')
    const has = (file: string) => existsSync(join(out, file))
    for (const file of [
      'src/lib/roofing/plan-takeoff/index.ts', 'src/services/roofing-takeoff/process.route.ts',
      'src/lib/sms/durable-work.ts', 'src/lib/tenant/from-request.ts', 'src/lib/supabase/admin.ts', 'src/lib/agents/cron.ts',
      'src/runtime/web-request.ts', 'src/config/required-env.ts', 'railway.json', '.dockerignore', '.nvmrc', '.env.example',
    ]) expect(has(file), file).toBe(true)
    for (const file of [
      'src/main.ts', 'src/app.module.ts', 'src/receptionist/inbound.route.ts', 'src/lib/sms/service-dialog.ts',
      'src/runtime/after.ts', 'src/health/health.controller.ts', 'src/web/content.ts',
      'Dockerfile', 'README.md', 'release-manifest.json', 'scripts/receptionist-build.mjs',
    ]) expect(has(file), file).toBe(false)
    // DEC-003: the service's library is the monorepo's, byte for byte.
    expect(readFileSync(join(out, 'src/lib/roofing/plan-takeoff/index.ts'), 'utf8'))
      .toBe(readFileSync('lib/roofing/plan-takeoff/index.ts', 'utf8'))
    const pkg = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('qm-roofing-takeoff')
    expect(Object.keys(pkg.dependencies)).toEqual(expect.arrayContaining(['@clerk/backend', '@supabase/supabase-js']))
  }, 120_000)

  it('is never part of a run with no target, which stays the five receptionists', () => {
    expect(exporter('--dry').match(/^── \S+/gm)).toEqual(['── electrical', '── plumbing', '── roofing', '── painting', '── solar'])
  }, 120_000)
})
