// Migration 196 — the SMS receptionist's five EV questions.
// Spec specs/ev-charger-location-photo.md R5 / R20.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import { EV_CHARGER_FALLBACK_QUESTIONS } from '../lib/sms/quote-readiness'

const root = process.cwd()
const upSql = readFileSync(
  resolve(root, 'sql', 'migrations', '196_ev_charger_clarifying_questions.sql'),
  'utf8',
)
const downSql = readFileSync(resolve(root, 'sql', 'migrations', '196_down.sql'), 'utf8')
const runner = readFileSync(resolve(root, 'scripts', 'run-migration-196.mjs'), 'utf8')

const databases: PGlite[] = []

/** The shared_assemblies row as migrations 021/033/037 leave it. */
async function databaseWithEvRow(questions: string[]): Promise<PGlite> {
  const db = new PGlite()
  databases.push(db)
  await db.exec(`
    create table public.shared_assemblies (
      id uuid primary key default gen_random_uuid(),
      trade text not null,
      name text not null,
      category text,
      always_inspection boolean not null default false,
      default_enabled boolean not null default false,
      clarifying_questions jsonb
    );
  `)
  await db.query(
    `insert into public.shared_assemblies (trade, name, category, clarifying_questions)
     values ('electrical', 'Install EV charger', 'ev_charger', $1::jsonb)`,
    [JSON.stringify(questions)],
  )
  return db
}

const THREE = [
  'Is the charger on-site, and which model is it?',
  'Roughly how far is the parking spot from the switchboard?',
  'Single or three-phase supply, and any idea of spare switchboard capacity?',
]

async function questions(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ q: string[] }>(
    `select clarifying_questions as q from public.shared_assemblies where name = 'Install EV charger'`,
  )
  return rows[0]?.q ?? []
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()))
})

describe('196 EV clarifying questions migration', () => {
  it('applies twice and leaves exactly five questions', async () => {
    const db = await databaseWithEvRow(THREE)
    await db.exec(upSql)
    await db.exec(upSql)
    expect(await questions(db)).toHaveLength(5)
  })

  it('writes the same five the code-side floor uses', async () => {
    // R10's fallback and the DB row must not drift: a tenant with the service
    // enabled and one without would otherwise be asked different things.
    const db = await databaseWithEvRow(THREE)
    await db.exec(upSql)
    expect(await questions(db)).toEqual([...EV_CHARGER_FALLBACK_QUESTIONS])
  })

  it('leaves a hand-edited script alone', async () => {
    // Guarded on the migration-033 three, so an operator who tailored the
    // questions keeps their version rather than being silently overwritten.
    const tailored = ['Which level is the carpark on?']
    const db = await databaseWithEvRow(tailored)
    await db.exec(upSql)
    expect(await questions(db)).toEqual(tailored)
  })

  it('rolls back to the original three', async () => {
    const db = await databaseWithEvRow(THREE)
    await db.exec(upSql)
    await db.exec(downSql)
    expect(await questions(db)).toEqual(THREE)
  })

  it('stays within the prompt render cap', () => {
    // dialog.ts MAX_MUSTASK_PER_SERVICE = 6 truncates the PROMPT while the gate
    // iterates ALL questions — a sixth would be enforced but never shown to the
    // model, which would keep trying to finish and burn the clarify cap. The
    // photo is the sixth required step and is gated in code for this reason.
    expect(EV_CHARGER_FALLBACK_QUESTIONS.length).toBeLessThanOrEqual(6)
  })

  it('gives every question a scoreable topic word', () => {
    // serviceKeywords drops words under 4 characters, so a question with no
    // long topic noun could never be marked answered and would loop forever.
    const stop = new Set(['install', 'replace', 'repair', 'supply', 'and', 'the', 'new', 'single'])
    for (const q of EV_CHARGER_FALLBACK_QUESTIONS) {
      const words = q
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !stop.has(w))
      expect(words.length, q).toBeGreaterThan(0)
    }
  })

  it('keeps the runner safe by default and asserts the gate preconditions', () => {
    expect(runner).toContain('--apply')
    expect(runner).toContain('DRY RUN')
    expect(runner).toContain("await client.query('begin')")
    expect(runner).toContain("await client.query('rollback')")
    expect(runner).toContain('196_down.sql')
    // findMatchedService keys off category, and skips always_inspection rows.
    expect(runner).toContain('ev_charger')
    expect(runner).toContain('always_inspection')
  })
})
