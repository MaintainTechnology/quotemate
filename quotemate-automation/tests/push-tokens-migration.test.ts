import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'sql', 'migrations', '191_push_tokens.sql'), 'utf8')

describe('191 push token migration', () => {
  it('creates a fresh seat-scoped token table and validates its exact unique key', () => {
    expect(sql).toMatch(/create table if not exists public\.push_tokens[\s\S]*user_id\s+text\s+not null/i)
    expect(sql).toMatch(/unique\s*\(tenant_id,\s*user_id,\s*token\)/i)
    expect(sql).toMatch(/migration 191 failed: push_tokens unique key/i)
  })

  it('upgrades a pre-existing token table without inventing authenticated ownership', () => {
    expect(sql).toMatch(/alter table public\.push_tokens\s+add column if not exists user_id text/i)
    expect(sql).toMatch(/delete from public\.push_tokens\s+where user_id is null or btrim\(user_id\) = ''/i)
    expect(sql).toMatch(/delete from public\.push_tokens duplicate\s+using public\.push_tokens keeper/i)
    expect(sql).toMatch(/duplicate\.tenant_id = keeper\.tenant_id[\s\S]*duplicate\.user_id = keeper\.user_id[\s\S]*duplicate\.token = keeper\.token/i)
    expect(sql).toMatch(/alter table public\.push_tokens\s+alter column user_id set not null/i)
    expect(sql).toMatch(/drop constraint[\s\S]*unique \(tenant_id, token\)/i)
    expect(sql).toMatch(/add constraint push_tokens_tenant_user_token_key\s+unique \(tenant_id, user_id, token\)/i)
  })

  it('creates a unique durable push-event outbox with lease-based delivery claims', () => {
    expect(sql).toMatch(/create table if not exists public\.push_events/i)
    expect(sql).toMatch(/event_key\s+text\s+not null\s+unique/i)
    expect(sql).toMatch(/create or replace function public\.claim_push_event/i)
    expect(sql).toMatch(/create or replace function public\.complete_push_event/i)
    expect(sql).toMatch(/create or replace function public\.release_push_event/i)
    expect(sql).toMatch(/alter table public\.push_events enable row level security/i)
    expect(sql).toMatch(/grant execute[\s\S]*to service_role/i)
  })
})
