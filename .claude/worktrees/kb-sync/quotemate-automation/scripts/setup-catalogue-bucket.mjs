// Idempotent setup for the catalogue-images Supabase Storage bucket.
//
// Unlike intake-photos (private; signed URLs), this bucket is PUBLIC.
// A catalogue product photo is non-sensitive (the tradie WANTS it shown
// to customers) and is rendered as a plain <img> in three places:
//   • the dashboard Catalogue tab
//   • the /q/choose/[token] product-choice page
//   • Gemini WP4 render (resolveProductImage fetches the http(s) URL)
// A permanent public URL "just works" in all three with zero
// path-signing on read. Writes are still gated by service_role.
//
// Run: node --env-file=.env.local scripts/setup-catalogue-bucket.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);
const BUCKET = "catalogue-images";

const { data: existing } = await supabase.storage.getBucket(BUCKET);
if (existing) {
  console.log(
    `✓ bucket ${BUCKET} already exists (id=${existing.id}, public=${existing.public})`,
  );
  if (!existing.public) {
    const { error } = await supabase.storage.updateBucket(BUCKET, {
      public: true,
    });
    if (error) {
      console.error("✗ failed to make bucket public:", error.message);
      process.exit(1);
    }
    console.log(`✓ bucket ${BUCKET} updated → public`);
  }
} else {
  const { data, error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 8 * 1024 * 1024, // 8 MB per file (matches WP4 MAX_BYTES)
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
  if (error) {
    console.error("✗ failed to create bucket:", error.message);
    process.exit(1);
  }
  console.log(`✓ bucket ${BUCKET} created (public)`, data);
}
