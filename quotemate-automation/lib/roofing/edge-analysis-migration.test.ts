import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const migrationPath = resolve(root, 'sql', 'migrations', '172_roofing_semantic_edge_analysis.sql')
const runnerPath = resolve(root, 'scripts', 'run-migration-172.mjs')

describe('172 roofing semantic edge analysis migration', () => {
  it('creates the source-approval and evidence tables behind RLS', () => {
    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, 'utf8')

    for (const table of [
      'roof_topology_source_approvals',
      'roof_edge_analyses',
      'roof_edge_decisions',
      'roofing_quote_revisions',
    ]) {
      expect(sql).toMatch(new RegExp('create table if not exists public\\.' + table, 'i'))
      expect(sql).toMatch(new RegExp('alter table public\\.' + table + ' enable row level security', 'i'))
    }
    expect(sql).toMatch(/tenant_id\s+uuid\s+not null/i)
    expect(sql).toMatch(/retention_expires_at/i)
    expect(sql).toMatch(/retained_asset_keys/i)
    expect(sql).toMatch(/candidate_payload/i)
    expect(sql).toMatch(/rate_card_snapshot/i)
    expect(sql).toMatch(/source_approval_id\s+uuid\s+not null/i)
    expect(sql).toMatch(/written_approval_document_key/i)
    expect(sql).toMatch(/foreign key \(measurement_id, tenant_id\)/i)
    expect(sql).toMatch(/foreign key \(analysis_id, tenant_id\)/i)
    expect(sql).toMatch(/foreign key \(analysis_id, tenant_id, measurement_id\)/i)
    expect(sql).toMatch(/requires a matching tenant-scoped source approval/i)
    expect(sql).toMatch(/allows_derived_geometry/i)
    expect(sql).toMatch(/retention_expires_at <= now\(\)/i)
    expect(sql).toMatch(/retention must not outlast source approval validity/i)
    expect(sql).toMatch(/create trigger roof_topology_source_approvals_immutable/i)
    expect(sql).toMatch(/create trigger roofing_quote_revisions_parentage_guard/i)
    expect(sql).toMatch(/jsonb_path_exists/i)
    expect(sql).toMatch(/roof_topology_metadata_is_safe\(source_metadata\)/i)
    expect(sql).toMatch(/create index if not exists roof_edge_analyses_expiry_idx/i)
    expect(sql).toMatch(/create trigger roof_edge_analyses_payload_immutable/i)
    expect(sql).toMatch(/candidate_payload is immutable outside a completed purge/i)
    expect(sql).toMatch(/create trigger roof_edge_decisions_append_only/i)
    expect(sql).toMatch(/geometry_origin\s+text\s+not null\s+default 'none'/i)
    expect(sql).toMatch(/geometry is null and geometry_origin = 'none'/i)
    expect(sql).toMatch(/note text check \(note is null or public\.roof_topology_value_is_safe\(note\)\)/i)
    expect(sql).toMatch(/purge_error text check \(purge_error is null or public\.roof_topology_value_is_safe\(purge_error\)\)/i)
    expect(sql).toMatch(/create trigger roof_edge_tenant_consistency/i)
    expect(sql).toMatch(/before update\s+on public\.roof_edge_analyses/i)
    expect(sql).toMatch(/topology and price snapshots may only clear after a completed purge/i)
    expect(sql).toMatch(/retention_mode = 'none'/i)
    expect(sql).toMatch(/topology_measurement is null/i)
    expect(sql).not.toMatch(/create policy/i)
  })

  it('provides an opt-in runner that verifies tables and RLS after applying', () => {
    expect(existsSync(runnerPath)).toBe(true)
    const runner = readFileSync(runnerPath, 'utf8')

    expect(runner).toMatch(/APPLY_ROOF_EDGE_ANALYSIS_MIGRATION/)
    expect(runner).toMatch(/SUPABASE_DB_URL/)
    expect(runner).toMatch(/relrowsecurity/)
    expect(runner).toMatch(/pg_policies/)
    expect(runner).toMatch(/roof_topology_source_approvals/)
    expect(runner).toMatch(/roof_edge_analyses_expiry_idx/)
    expect(runner.indexOf("await client.query('commit')")).toBeGreaterThan(
      runner.indexOf('Migration verification failed'),
    )
  })
})
