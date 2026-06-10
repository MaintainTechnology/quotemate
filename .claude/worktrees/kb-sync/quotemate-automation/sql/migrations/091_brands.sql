-- Migration 091 · Brands — make the compliance platform brand-agnostic
--
-- Until now the engine hardcoded F45 (vision persona, shot list, "studio",
-- "F45 HQ"). This table makes a brand a first-class, configured entity so
-- the SAME engine audits any franchise — F45, Gelatissimo, McDonald's, …
-- The org already carries `brand_slug`; signage_rules are already keyed by
-- `brand_slug`. This adds the per-brand CONFIG the engine reads.
--
-- A brand owns:
--   location_noun     — what a site is called ("studio" | "restaurant" | "store")
--   hq_name           — who approves ("F45 HQ" | "McDonald's Corporate")
--   vision_persona    — how the AI is framed ("F45 fitness studios")
--   shots             — the guided photo list [{slot,label,instruction}]
--
-- Additive + idempotent.

create table if not exists public.brands (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,
  name                  text not null,
  location_noun         text not null default 'location',
  location_noun_plural  text not null default 'locations',
  hq_name               text not null default 'HQ',
  vision_persona        text not null,                     -- "F45 fitness studios"
  shots                 jsonb not null default '[]'::jsonb, -- [{slot,label,instruction}]
  active                boolean not null default true,
  created_at            timestamptz not null default now()
);

create index if not exists brands_slug_idx on public.brands (slug) where active;

alter table public.brands enable row level security;

notify pgrst, 'reload schema';

do $$
declare n int;
begin
  select count(*) into n from information_schema.tables
   where table_schema='public' and table_name='brands';
  raise notice 'Migration 091: brands table present = %', n;
end $$;
