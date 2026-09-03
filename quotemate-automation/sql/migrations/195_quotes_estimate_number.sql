-- ═══════════════════════════════════════════════════════════════════
-- Migration 195 — human-readable estimate number for the EV charger
-- estimate document (spec specs/ev-charger-estimate-template.md R5).
--
-- NUMBERING: the spec calls this migration 194. 194 was already taken by
-- 194_quote_chain.sql (the post-visit money chain) when this landed, so the
-- estimate number took the next free number. Nothing else about R5 changes.
--
-- The source estimates this template reproduces are identified as EST-0534,
-- EST-0541, EST-0565. Nothing in this schema carried such a number: the only
-- customer-visible reference was quotes.id.slice(0,8) rendered on the quote
-- page. This adds one.
--
-- Shape and why:
--   * A single platform-wide sequence, not a per-tenant counter. Each tenant
--     sees gaps where another tenant drew a number — which is exactly how the
--     source documents already read (0534 → 0541 → 0565). A per-tenant run
--     would need a counter table and a lock; open question 1 in the spec asks
--     Jon whether that is wanted before building it.
--   * NULLABLE, with no default. The number is drawn lazily by the EV render
--     path (lib/quote/pdf.ts) the first time a document is produced, so quotes
--     that never render an estimate never consume one, and the draft route —
--     owned by another in-flight change — is not touched.
--   * The lazy assignment is `set estimate_number = nextval(...) where id = $1
--     and estimate_number is null`, which is idempotent under concurrency:
--     the second writer matches no row and the first number stands.
--
-- Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

create sequence if not exists public.quote_estimate_number_seq as bigint start with 1 increment by 1;

alter table public.quotes add column if not exists estimate_number bigint;

comment on column public.quotes.estimate_number is
  'Human-readable estimate number, rendered EST-%04d on the EV charger estimate document. Drawn lazily from quote_estimate_number_seq on first render; null until then. Spec ev-charger-estimate-template R5.';

-- Partial index: the only read is "does this quote already have one", and the
-- only rows worth indexing are the assigned ones.
create index if not exists quotes_estimate_number_idx
  on public.quotes (estimate_number)
  where estimate_number is not null;

-- Assignment must be one atomic statement. PostgREST cannot put a nextval()
-- expression in an UPDATE payload, and a read-then-write from the application
-- would race two concurrent renders of the same quote into two numbers (or,
-- worse, hand one number to two quotes). This function does the guarded update
-- and the read-back together, so the FIRST caller assigns and every later
-- caller — including a retry, a resend and the dashboard preview — gets the
-- same number returned.
create or replace function public.next_quote_estimate_number(p_quote_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number bigint;
begin
  update public.quotes
     set estimate_number = nextval('public.quote_estimate_number_seq')
   where id = p_quote_id
     and estimate_number is null
  returning estimate_number into v_number;

  -- No row matched ⇒ this quote already carries a number (or does not exist).
  if v_number is null then
    select estimate_number into v_number
      from public.quotes
     where id = p_quote_id;
  end if;

  return v_number;
end;
$$;

-- SECURITY DEFINER + PostgreSQL's default PUBLIC EXECUTE grant would make this
-- an UNAUTHENTICATED WRITE against quotes that bypasses RLS: the anon key ships
-- in the browser bundle, so anyone could POST /rest/v1/rpc/next_quote_estimate_number
-- with any quote id, stamp rows across every tenant, and burn sequence values in
-- a loop. Only the server calls this, and it holds the service-role key.
-- PUBLIC is a pseudo-role and always present. The three Supabase roles are not:
-- PGlite (the migration test) and a plain local Postgres have none of them, and
-- an unguarded GRANT there aborts the whole migration. Guarded so this file
-- applies identically on prod and on a bare Postgres.
revoke execute on function public.next_quote_estimate_number(uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.next_quote_estimate_number(uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke execute on function public.next_quote_estimate_number(uuid) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.next_quote_estimate_number(uuid) to service_role';
  end if;
end
$$;

notify pgrst, 'reload schema';
