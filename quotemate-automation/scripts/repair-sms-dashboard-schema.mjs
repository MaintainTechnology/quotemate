// Restore the delivery/recovery dashboard contracts without enabling quote release.
// Default is read-only; --apply installs canonical198/199 and only201's task table.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import pg from 'pg'

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hash = text => createHash('sha256').update(text).digest('hex')
const tables = ['sms_work_jobs', 'sms_outbox', 'sms_human_tasks']
const signatureTypes = {
  enqueue_sms_work: 'text,text,text,uuid,jsonb,uuid,text', claim_sms_work: 'text[],uuid,integer,text',
  renew_sms_work: 'uuid,uuid,integer', assert_sms_work_owner: 'uuid,uuid', checkpoint_sms_work: 'uuid,uuid,text,jsonb',
  finish_sms_work: 'uuid,uuid,jsonb,text', guard_sms_work_write: '', classify_sms_outbound: '',
  sms_outbox_enqueue: 'text,jsonb,text', sms_outbox_claim: 'uuid,uuid', sms_outbox_publish: 'uuid',
  sms_outbox_finish: 'uuid,uuid,text,jsonb,text', sms_outbox_receipt: 'uuid,uuid,text,text,text',
  sms_plan_request: 'uuid,text,text,text,text,uuid,uuid', sms_outbox_retry: 'uuid,uuid',
}
const triggers = [
  ...['sms_conversations', 'sms_messages', 'intakes', 'quotes'].map(table => [table, 'guard_sms_work_write', 'guard_sms_work_write']),
  ['sms_outbox', 'sms_outbox_work_fence', 'guard_sms_work_write'],
  ['sms_messages', 'sms_messages_delivery_evidence', 'classify_sms_outbound'],
  ['sms_human_tasks', 'sms_work_guard', 'guard_sms_work_write'],
]
const addedColumns = [
  ...['sms_conversations', 'sms_messages', 'intakes', 'quotes'].flatMap(table => ['sms_work_id', 'sms_work_owner'].map(column => [table, column])),
  ...['processing_owner', 'quote_stage', 'quote_id', 'last_processed_work_sequence'].map(column => ['sms_conversations', column]),
  ['intakes', 'sms_source_key'], ['quotes', 'estimate_request_key'],
  ...['outbox_id', 'turn_id', 'delivery_status'].map(column => ['sms_messages', column]),
]
export const dashboardSchema = [
  { table: 'sms_outbox', select: 'id,tenant_id,delivery_key,status,body,to_number,audience,provider_sid,provider_status,provider_error,requires_attention,attempts,created_at,updated_at' },
  { table: 'sms_work_jobs', select: 'id,tenant_id,kind,service_key,status,attempts,created_at,updated_at,last_error,available_at,owner_token,lease_until' },
  { table: 'sms_human_tasks', select: 'id,tenant_id,trade,reason,resource_type,resource_id,status,customer_phone,notification_error,created_at,updated_at' },
]

export function loadSmsRepairAssets(appDirectory = directory) {
  const read = name => readFileSync(join(appDirectory, 'sql/migrations', name), 'utf8')
  const work = read('198_sms_durable_work.sql')
  const outbox = read('199_sms_delivery_outbox.sql')
  const trade = read('201_sms_trade_quote_contract.sql')
  const start = trade.indexOf('create table if not exists public.sms_human_tasks (')
  const end = trade.indexOf('-- Phone equivalence', start)
  if (start < 0 || end < start) throw new Error('Canonical 201 task block boundaries changed')
  const humanTasks = trade.slice(start, end).trim()
  if (!humanTasks.endsWith('for each row execute function public.guard_sms_work_write();') ||
      /create\s+(?:or\s+replace\s+)?function|sms_release_quote_resource|sms_save_solar_estimate/i.test(humanTasks)) {
    throw new Error('Canonical 201 task block includes unexpected statements')
  }
  // These canonical files have no top-level transaction. Function BEGINs have
  // no semicolon; reject any transaction statements that could commit mid-repair.
  if ([work, outbox, humanTasks].some(sql => /^\s*(?:begin|commit|rollback|start\s+transaction)\s*;/im.test(sql))) {
    throw new Error('Unexpected transaction boundary in SMS repair sources')
  }
  const functions = [...`${work}\n${outbox}`.matchAll(/create or replace function public\.([a-z_]+)\([\s\S]*?\)\s*returns[\s\S]*?as \$\$([\s\S]*?)\$\$;/g)]
    .map(match => ({ name: match[1], signature: `public.${match[1]}(${signatureTypes[match[1]]})`, body: match[2].replace(/\r\n/g, '\n') }))
  if (functions.length !== Object.keys(signatureTypes).length || functions.some(fn => !(fn.name in signatureTypes)) || new Set(functions.map(fn => fn.name)).size !== functions.length) {
    throw new Error('Canonical SMS function inventory changed')
  }
  return { work, outbox, humanTasks, functions, hashes: {
    migration198: hash(work), migration199: hash(outbox), migration201: hash(trade), humanTaskBlock: hash(humanTasks),
  } }
}

async function inventory(db, assets) {
  const tableRows = (await db.query('select name,to_regclass($1 || name) is not null as present from unnest($2::text[]) name', ['public.', tables])).rows
  const functionRows = (await db.query(`select signature,p.oid is not null as present,p.prosrc,p.prosecdef from unnest($1::text[]) signature
    left join pg_proc p on p.oid=to_regprocedure(signature)`, [assets.functions.map(fn => fn.signature)])).rows
  const triggerRows = (await db.query(`select x->>0 as table_name,x->>1 as name,t.oid is not null as present,
    t.tgenabled,t.tgfoid=to_regprocedure('public.'||(x->>2)||'()') as correct_function
    from jsonb_array_elements($1::jsonb) x left join pg_trigger t
    on t.tgrelid=to_regclass('public.'||(x->>0)) and t.tgname=x->>1 and not t.tgisinternal`, [JSON.stringify(triggers)])).rows
  const columnRows = (await db.query(`select x->>0 as table_name,x->>1 as name,a.attnum is not null as present
    from jsonb_array_elements($1::jsonb) x left join pg_attribute a
    on a.attrelid=to_regclass('public.'||(x->>0)) and a.attname=x->>1 and not a.attisdropped`, [JSON.stringify(addedColumns)])).rows
  return { tableRows, functionRows, triggerRows, columnRows }
}

export async function verifySmsDashboardSchema(db, assets) {
  const state = await inventory(db, assets)
  if (!Object.values(state).flat().every(row => row.present)) throw new Error('SMS dashboard schema is incomplete')
  for (const fn of assets.functions) {
    const row = state.functionRows.find(row => row.signature === fn.signature)
    if (!row.prosecdef || row.prosrc.replace(/\r\n/g, '\n') !== fn.body) throw new Error(`Unexpected SMS function definition: ${fn.name}`)
  }
  if (state.triggerRows.some(row => !row.correct_function || row.tgenabled !== 'O')) throw new Error('SMS work guards are incomplete')
  const grants = (await db.query(`select name,c.relrowsecurity,
    not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where a.grantee=0 or a.grantee in (select oid from pg_roles where rolname in ('anon','authenticated'))) as private,
    has_table_privilege('service_role',c.oid,'SELECT') and has_table_privilege('service_role',c.oid,'INSERT') and has_table_privilege('service_role',c.oid,'UPDATE') as service_access,
    case when name='sms_human_tasks' then not has_table_privilege('service_role',c.oid,'DELETE')
      and not has_table_privilege('service_role',c.oid,'TRUNCATE') else true end as minimal_tasks
    from unnest($1::text[]) name join pg_class c on c.oid=to_regclass('public.'||name)`, [tables])).rows
  if (grants.some(row => !row.relrowsecurity || !row.private || !row.service_access || !row.minimal_tasks)) throw new Error('SMS table security contract failed')
  const rpcGrants = (await db.query(`select signature,
    has_function_privilege('service_role',signature,'EXECUTE') as service_access,
    not has_function_privilege('anon',signature,'EXECUTE') and not has_function_privilege('authenticated',signature,'EXECUTE') as private
    from unnest($1::text[]) signature`, [assets.functions.map(fn => fn.signature)])).rows
  if (rpcGrants.some(row => !row.private || !row.service_access)) throw new Error('SMS function security contract failed')
  for (const contract of dashboardSchema) await db.query(`select ${contract.select} from public.${contract.table} where false`)
}

export async function planSmsDashboardRepair(db, assets) {
  const state = await inventory(db, assets)
  const flags = Object.values(state).flat()
  const present = flags.filter(row => row.present).length
  if (present && present !== flags.length) throw new Error('Partial SMS dashboard schema detected; inspect before applying canonical migrations')
  if (present) await verifySmsDashboardSchema(db, assets)
  const queued = []
  for (const table of tables) {
    queued.push({ table, counts: present ? (await db.query(`select status,count(*)::int as count from public.${table} group by status order by status`)).rows : null })
  }
  const deliveryExists = state.columnRows.some(row => row.table_name === 'sms_messages' && row.name === 'delivery_status' && row.present)
  const legacy = (await db.query(`select count(*) filter(where nullif(twilio_message_sid,'') is not null)::int as provider_accepted,
    count(*) filter(where nullif(twilio_message_sid,'') is null)::int as unknown
    from public.sms_messages where direction='outbound'${deliveryExists ? ' and delivery_status is null' : ''}`)).rows[0]
  return { install: !present, queued, legacyClassification: present ? { provider_accepted: 0, unknown: 0 } : legacy }
}

const hardeningSql = `revoke all on public.sms_work_jobs,public.sms_outbox,public.sms_human_tasks from public,anon,authenticated;
  revoke all on sequence public.sms_work_jobs_sequence_seq from public,anon,authenticated;
  revoke all on public.sms_human_tasks from service_role;
  grant select,insert,update on public.sms_human_tasks to service_role;`

export async function repairSmsDashboardSchema(db, { apply = false, assets = loadSmsRepairAssets() } = {}) {
  await db.query(apply ? 'begin' : 'begin read only')
  try {
    await db.query("set local lock_timeout='5s'")
    await db.query("set local statement_timeout='30s'")
    if (apply && !(await db.query("select pg_try_advisory_xact_lock(hashtextextended('repair-sms-dashboard-schema',0)) as locked")).rows[0].locked) {
      throw new Error('Another SMS dashboard schema repair is running')
    }
    const plan = await planSmsDashboardRepair(db, assets)
    if (apply && plan.install) {
      for (const sql of [assets.work, assets.outbox, assets.humanTasks, hardeningSql]) await db.query(sql)
      for (const fn of assets.functions) {
        await db.query(`revoke all on function ${fn.signature} from public,anon,authenticated`)
        await db.query(`grant execute on function ${fn.signature} to service_role`)
      }
    }
    if (apply) {
      await verifySmsDashboardSchema(db, assets)
      // Canonical sources create no work or sends. Verify this inside the same
      // transaction before any other session can see or enqueue into new tables.
      if (plan.install) {
        for (const table of tables) {
          if ((await db.query(`select count(*)::int as count from public.${table}`)).rows[0].count !== 0) throw new Error('Repair unexpectedly created durable work')
        }
      }
      await db.query("notify pgrst,'reload schema'")
      await db.query('commit')
    } else await db.query('rollback')
    return { mode: apply ? 'applied' : 'dry-run', installRequired: plan.install,
      sourceHashes: assets.hashes, existingQueues: plan.queued, legacyClassification: plan.legacyClassification,
      newJobsOrSendsCreated: false, quoteReleaseFunctionsInstalled: false }
  } catch (error) { await db.query('rollback'); throw error }
}

async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Only --apply is supported; default is read-only')
  if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL missing')
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 })
  await client.connect()
  try { console.log(JSON.stringify(await repairSmsDashboardSchema(client, { apply: process.argv.includes('--apply') }), null, 2)) }
  finally { await client.end() }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`SMS dashboard repair failed: ${error.message}`); process.exitCode = 1 })
}
