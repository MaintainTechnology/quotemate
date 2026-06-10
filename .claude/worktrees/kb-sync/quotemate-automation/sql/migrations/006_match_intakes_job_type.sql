-- Extend match_intakes() with an optional job_type_filter parameter.
-- When provided, the function only returns past intakes whose job_type
-- matches — pre-filtering the candidate pool BEFORE pgvector cosine
-- search runs. This:
--   1. Sharpens the candidate pool (a "downlights" query never sees
--      smoke alarm or GPO history).
--   2. Saves Voyage Rerank API calls — fewer cross-trade junk candidates
--      end up in the top-20 that get reranked.
--   3. Behaves as before when filter is null (back-compat).
--
-- Idempotent — drops both the old 2-arg signature and the new 3-arg
-- signature before recreating, so re-running is safe.
--
-- Atomic: drop + create run in one transaction by the pg client driver,
-- so no caller can hit a missing-function window.

drop function if exists match_intakes(vector, int);
drop function if exists match_intakes(vector, int, text);

create or replace function match_intakes(
  query_embedding vector(1536),
  match_count int default 5,
  job_type_filter text default null
)
returns table (id uuid, scope jsonb, similarity float)
language sql stable as $$
  select id, scope, 1 - (embedding <=> query_embedding) as similarity
  from intakes
  where embedding is not null
    and (job_type_filter is null or job_type = job_type_filter)
  order by embedding <=> query_embedding
  limit match_count;
$$;
