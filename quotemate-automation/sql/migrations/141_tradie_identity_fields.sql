-- ════════════════════════════════════════════════════════════════════
-- Migration 141 — tradie identity fields for the customer quote letterhead.
--
-- Adds the business-identity fields a quote's tenant needs so a QuoteMax
-- quote mirrors a real tradie quote (e.g. Roo Roofing's letterhead): a
-- contact-person name, website, business address, and the public URL of an
-- uploaded logo. Business name / phone / email already live on tenants
-- (business_name, owner_mobile, owner_email); licence + GST live on
-- pricing_book. The storage object path reuses the existing tenants.logo_path
-- column; logo_url holds the public URL served on the quote.
--
-- Also provisions the public 'tenant-logos' storage bucket the onboarding
-- logo upload writes to (2 MB cap; png/jpeg/webp/svg). Public so the quote
-- page can render the logo via a plain getPublicUrl() <img src>.
--
-- Idempotent: add-column-if-not-exists + on-conflict bucket upsert.
-- Apply with: node --env-file=.env.local scripts/run-migration-141.mjs
-- ════════════════════════════════════════════════════════════════════

alter table tenants add column if not exists contact_name      text;
alter table tenants add column if not exists website_url       text;
alter table tenants add column if not exists business_address  text;
alter table tenants add column if not exists logo_url          text;

-- Public storage bucket for tenant logos. file_size_limit is bytes (2 MB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tenant-logos',
  'tenant-logos',
  true,
  2097152,
  array['image/png','image/jpeg','image/webp','image/svg+xml']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
