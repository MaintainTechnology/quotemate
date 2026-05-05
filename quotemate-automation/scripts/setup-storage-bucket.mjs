// Idempotent setup for the intake-photos Supabase Storage bucket.
// Bucket is private (no public read). Reads happen via signed URLs we
// generate server-side. Writes are gated by service_role (RLS bypass).

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);
const BUCKET = "intake-photos";

const { data: existing } = await supabase.storage.getBucket(BUCKET);
if (existing) {
  console.log(`✓ bucket ${BUCKET} already exists (id=${existing.id}, public=${existing.public})`);
} else {
  const { data, error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 5 * 1024 * 1024, // 5 MB per file
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
  if (error) {
    console.error("✗ failed to create bucket:", error.message);
    process.exit(1);
  }
  console.log(`✓ bucket ${BUCKET} created`, data);
}
