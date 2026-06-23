# Files Tab — Spec

## Objective
Finish the in-progress **Files tab** so every tenant (tradie) has a single,
per-tenant repository of every document the platform generates — quotes and
invoices — where they can list, preview, download, search ("ask your documents"),
and now **comment** on each document in a two-party thread with QuoteMate staff.
Most of the archive is built; this spec formalizes what exists, **closes the
auto-archive coverage gap** so *every* generator populates the tab, **turns the
feature on**, and adds the **commenting** capability (table + role-aware API +
tradie and admin UIs).

This is a "finish what's there" spec — option (a). The archive, list, viewer,
download, and AI-chat already exist and are documented here as the baseline to
preserve and verify; the net-new work is commenting + coverage + enablement.

## Context / background

Established facts from the existing codebase (treat as ground truth; do not
re-architect):

- **Table `tenant_file_documents`** (created in `sql/migrations/134_tenant_file_store.sql`):
  `id, tenant_id, source_kind ('quote'|'invoice'), source_id, trade, display_name,
  storage_path, kb_document_id, state ('pending'|'active'|'failed'|'skipped'),
  skip_reason, bytes, error, attempts, content_hash, created_at, updated_at`,
  `unique (tenant_id, display_name)`. RLS enabled, no positive policy
  (app-layer `tenant_id` enforcement; service-role key bypasses RLS).
- **`tenants.file_store_id`** holds the tenant's Gemini File Search store id.
- **Storage:** private Supabase bucket **`quote-pdfs`** holds the full, unredacted
  documents (`storage_path` is the source of truth). Path patterns:
  `quotes/<id>.pdf`, `roofs/<token>.pdf`, `solar/<token>.pdf`, `paint/<token>.pdf`,
  `invoices/<tenant_id>/<file>`. The KB (Gemini) only ever stores **PII-minimized
  markdown**, never the PDF.
- **lib/filestore/**: `ingest-quote.ts` → `archiveAndIngestQuote(args)` (idempotent
  upsert on `(tenant_id, display_name)`, best-effort, never throws, no-op when the
  flag is off); `reconcile.ts` → `reconcileTenantFileDocs()` (cron: pending→active,
  retry failed, retention prune); `minimize.ts` (PII-minimize markdown);
  `provision.ts` / `tenant-provision.ts` (lazy-create Gemini stores); `source-doc.ts`
  (resolve a source quote/invoice → storage path); plus `chat-request.ts`,
  `session-store.ts`, `store-name.ts`, `tenant-store-name.ts`.
- **Feature flag `TENANT_FILESTORE_ENABLED`** — when not `'true'`, archiving is a
  no-op (the tab stays empty). Currently off. Related: `TENANT_FILESTORE_MAX_RETRIES`,
  a per-tenant retention cap.
- **Existing tenant API (Bearer-auth; tenant resolved server-side via
  `supabase.auth.getUser(token)` → `tenants.owner_user_id`; no ids sent from client):**
  - `GET /api/tenant/files` — list this tenant's documents
    (`id, display_name, source_kind, trade, state, created_at, bytes`).
  - `GET /api/tenant/files/[id]/download` — stream bytes from `quote-pdfs` after
    asserting `tenant_id` match (404 on mismatch, to avoid leaking existence).
  - `POST /api/tenant/files/chat` — Gemini File Search over the tenant's store;
    returns `{ answer, citations: [{ title, snippet, documentId }] }` with
    `documentId` resolved server-side, scoped to the tenant.
- **UI `app/dashboard/_components/FilesTab.tsx`** (dashboard tab key `'files'`,
  rendered in `app/dashboard/page.tsx`): document list with state badges
  (Indexed/Indexing/Failed/Skipped), inline PDF/image viewer modal, download, and
  the "ask your documents" chat with citations. No comment UI yet. No upload UI.
- **Auto-archive is already wired** into 8 finalizers (each calls
  `archiveAndIngestQuote` post-ack): `/api/estimate/draft`, `/api/quote/[id]/approve`,
  `/api/quote/[id]/edit`, `/api/sms/inbound`, `/api/solar/confirm/[token]`,
  `/api/solar/[tenantSlug]/estimate`, `/api/tenant/calibration/upload`,
  `/api/tenant/commercial-painting/save-quote`.
- **Admin surface** exists under `app/admin/*` (e.g. `app/admin/agents/tradie-edits/page.tsx`).
- Next.js **16** App Router, React 19, service-role key in API routes.

The two gaps this spec closes: (1) the customer-facing PDF routes that lazy-serve
but don't archive; (2) commenting, which has zero implementation.

## Requirements

### A. Enablement & auto-archive coverage
1. `TENANT_FILESTORE_ENABLED` is honored everywhere archiving happens, and is set
   to `true` for the dev (`.env.local`) and production environments so the tab is
   live. (Do not commit `.env.local` or paste secrets.)
2. Every document-generating path archives into `tenant_file_documents` so the
   document appears in the owning tenant's Files tab. In addition to the 8
   already-wired finalizers, wire these currently-unarchived generators:
   - `GET /api/q/[token]/pdf` (electrical/plumbing customer PDF)
   - `GET /api/q/roof/[token]/pdf` (roofing)
   - `GET /api/q/solar/[token]/pdf` (solar)
   - `GET /api/q/paint/[token]/pdf` (painting)
   - `GET /api/aircon/pdf` (air-conditioning)
3. Archiving on these PDF routes runs **after** the response is sent
   (`next/server` `after()`), reusing `archiveAndIngestQuote` and the existing
   `source-doc` / `minimize` helpers — it must never delay or break the PDF
   download, and must never throw into the request path.
4. Archiving is **idempotent**: repeated downloads of the same document produce at
   most one `tenant_file_documents` row (relying on the existing
   `(tenant_id, display_name)` upsert) and do not create duplicate KB docs.
5. The owning `tenant_id` for a token-based PDF route is resolved from the quote
   the token maps to. If no tenant can be resolved (legacy orphan with
   `tenant_id IS NULL`), the route skips archiving silently (no row, no error).

### B. Commenting — data
6. A new table `tenant_file_comments` stores a flat (non-threaded) comment thread
   per document, with columns at least:
   `id uuid pk, file_document_id uuid not null references tenant_file_documents(id)
   on delete cascade, tenant_id uuid not null references tenants(id) on delete
   cascade, author_role text not null check (author_role in ('tenant','admin')),
   author_user_id uuid not null, body text not null, created_at timestamptz not
   null default now(), updated_at timestamptz, deleted_at timestamptz`. Indexed by
   `file_document_id`. RLS enabled, no positive policy (app-layer enforcement),
   matching the existing `tenant_file_documents` pattern.
7. Per-document **resolved** state lives on `tenant_file_documents` via new columns
   `comments_resolved_at timestamptz` and `comments_resolved_by text` (the role
   that resolved it). Null `comments_resolved_at` = unresolved/open.
8. The schema change is delivered as a new `sql/migrations/NNN_tenant_file_comments.sql`
   plus a `scripts/run-migration-NNN.mjs`, applied to the prod Supabase, with
   `sql/init.sql` kept representative. `NNN` = next free migration number.

### C. Commenting — behavior & API (shared, role-aware)
9. **Tenant (tradie) endpoints** (Bearer-auth, `author_role = 'tenant'`, all scoped
   to the resolved tenant; any document not owned by the tenant → 404):
   - `GET  /api/tenant/files/[id]/comments` — list non-deleted comments for the
     document, oldest-first, each with `id, author_role, author_label, body,
     created_at, updated_at, is_own` plus the document's resolved state.
   - `POST /api/tenant/files/[id]/comments` — add a comment (`{ body }`).
   - `PATCH /api/tenant/files/[id]/comments/[commentId]` — edit body; allowed only
     for the caller's **own** comment (same role + `author_user_id`), else 403.
   - `DELETE /api/tenant/files/[id]/comments/[commentId]` — soft-delete (set
     `deleted_at`) own comment only, else 403; deleted comments are excluded from
     listings.
   - `POST /api/tenant/files/[id]/resolve` — toggle the document's resolved state
     (`{ resolved: boolean }`), stamping `comments_resolved_at`/`comments_resolved_by`.
10. **Admin (QuoteMate staff) endpoints** (admin-auth via the codebase's existing
    admin guard, `author_role = 'admin'`), covering any tenant's documents:
    - `GET  /api/admin/files?tenantId=…` — list a tenant's documents (id, display_name,
      source_kind, trade, state, created_at, comment_count, resolved).
    - `GET  /api/admin/files/[id]/comments`, `POST` (add as admin), `PATCH`/`DELETE`
      (own admin comment only), and `POST /api/admin/files/[id]/resolve` — same
      semantics as the tenant endpoints but admin-scoped (can reach any tenant).
11. **Author labels:** a comment shows `author_label = "You"` to its own author;
    otherwise tenant-authored comments show the tenant's business name and
    admin-authored comments show `"QuoteMate"`.
12. **Reopen on reply:** posting a new comment (tenant or admin) to a **resolved**
    document clears its resolved state (`comments_resolved_at = null`).
13. **Validation:** `body` is trimmed; empty/whitespace-only → 400; body longer than
    5000 chars → 400.
14. **Comments are never sent to the KB / Gemini store** and never expose
    `storage_path` or `kb_document_id` to any client — they live only in Postgres
    and are returned only through the role-scoped endpoints above.

### D. Commenting — UI
15. **Tradie Files tab** (`FilesTab.tsx`): each document exposes a comment thread
    (e.g. in the viewer modal or a per-document drawer) showing the chronological
    thread with author labels + timestamps, a resolved/open indicator, an "add
    comment" box, edit/delete affordances on the caller's own comments, and a
    resolve/reopen toggle. New comments, edits, deletes, and resolve actions reflect
    immediately. Existing list/badges/viewer/download/chat behavior is preserved.
16. **Admin view** (new page under `app/admin/`, e.g. `app/admin/files/`): staff pick
    a tenant, see that tenant's documents, open a document's thread, and post/edit
    (own)/delete (own)/resolve comments as `admin`. Uses the admin endpoints in C.10.

## Non-goals
- **Customer-facing comments** — the end customer cannot comment (two-party only:
  tenant + QuoteMate staff).
- **Notifications** — no SMS/email/push when a new comment is posted. Deferred.
- **Threaded/nested replies, reactions, mentions, attachments on comments** — flat
  thread only.
- **Manual file upload UI** for tradies — documents are auto-generated only (the
  existing calibration-invoice upload is unrelated and unchanged).
- **Re-architecting** the archive/ingest/reconcile pipeline, the storage layout, or
  the chat/citation feature — preserve them.
- **RLS positive policies** (tenant-scoped) — out of scope; isolation stays
  app-layer like the rest of `/api/*`.

## Constraints
- **Next.js 16 App Router / React 19.** Before writing any Next.js code, read
  `quotemate-automation/AGENTS.md` and the relevant `node_modules/next/dist/docs/`
  guide — Next 16 has breaking changes vs. training knowledge (params are async,
  `after()` semantics, route handler signatures).
- API routes use the **service-role** Supabase key; tenant isolation is enforced in
  app code by filtering/asserting `tenant_id`. New table gets RLS enabled with no
  positive policy, matching `tenant_file_documents`.
- **Money/PII discipline:** full docs stay in the private `quote-pdfs` bucket; the KB
  holds only PII-minimized markdown; never leak `storage_path`/`kb_document_id`;
  comments never enter the KB.
- **Heavy work off the request path:** PDF-route archiving runs in `after()`;
  fast-ack preserved; respect existing `maxDuration` settings.
- **DB change protocol:** new `sql/migrations/NNN_*.sql` + `scripts/run-migration-NNN.mjs`,
  applied to prod Supabase, `sql/init.sql` kept representative. Never commit
  `.env.local` or paste its secrets.
- Build must typecheck and `next build` must succeed; existing vitest/playwright
  tests must still pass.

## Edge cases to handle
- Token PDF route with `tenant_id IS NULL` (orphan) → skip archiving silently; PDF
  still downloads.
- Same document downloaded/finalized twice → one row (idempotent upsert), no
  duplicate KB doc.
- `TENANT_FILESTORE_ENABLED` off → all archiving is a no-op; comment endpoints still
  function on whatever documents exist (typically none) without erroring.
- Tenant A requests tenant B's document, its download, its comments, or posts a
  comment on it → 404 (no existence leak).
- Editing/deleting a comment the caller did not author (incl. admin editing a
  tenant's comment, or vice-versa) → 403.
- Empty/whitespace-only comment body → 400; body > 5000 chars → 400.
- Posting a comment to a **resolved** document → comment is added and the document
  is reopened (`comments_resolved_at = null`).
- Resolving an already-resolved (or reopening an already-open) document → idempotent,
  returns the current state.
- A document is retention-pruned/deleted by the reconcile cron → its comments are
  removed via `on delete cascade`.
- Document in `pending`/`indexing` state → comments and download still work; only
  chat may not yet find it.
- Comment thread on a document with zero comments → endpoints return an empty list
  + open state, no error.

## Definition of done
- [ ] `TENANT_FILESTORE_ENABLED=true` is set for dev and production; with it on, all
      generators archive and the Files tab shows documents.
- [ ] Each of the 5 newly-wired routes (`/api/q/[token]/pdf`, `/api/q/roof/[token]/pdf`,
      `/api/q/solar/[token]/pdf`, `/api/q/paint/[token]/pdf`, `/api/aircon/pdf`)
      results in exactly one `tenant_file_documents` row for the owning tenant after
      a download, idempotent across repeats, and never breaks/delays the PDF response.
- [ ] Orphan (`tenant_id IS NULL`) PDF download archives nothing and still serves the
      PDF.
- [ ] Migration `NNN_tenant_file_comments.sql` + `run-migration-NNN.mjs` applied;
      `tenant_file_comments` table and the `comments_resolved_at`/`comments_resolved_by`
      columns exist in prod; `sql/init.sql` updated to stay representative.
- [ ] A tradie can, from the Files tab: view a document's thread, add a comment, edit
      their own comment, soft-delete their own comment, and toggle resolved/open — all
      reflected immediately.
- [ ] A staff user can, from the new `/admin` files view: pick a tenant, open a
      document's thread, and add/edit-own/delete-own/resolve comments as `admin`.
- [ ] A tenant-authored comment is labeled with the business name to staff and "You"
      to the tradie; an admin-authored comment is labeled "QuoteMate" to the tradie
      and "You" to staff.
- [ ] Posting a comment to a resolved document reopens it.
- [ ] Isolation holds: tenant A cannot list/read/download/comment-on tenant B's
      documents (404); a non-author edit/delete returns 403.
- [ ] No client response from any files/comments endpoint contains `storage_path` or
      `kb_document_id`; no comment text is sent to the Gemini store.
- [ ] Existing Files-tab behavior (list, state badges, viewer, download, ask-your-
      documents chat) still works (no regression).
- [ ] `next build` / typecheck passes and the existing test suite passes.

## Open questions
- The exact admin authentication guard for the new `/api/admin/files*` routes and
  `/admin/files` page — reuse whatever the existing `app/admin/*` pages use; confirm
  the mechanism while building rather than inventing a new one.
- Whether "edit/delete own" should be time-boxed (e.g. only within N minutes) — spec
  assumes no time limit; revisit if product wants one.
