import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucketName = process.env.SUPABASE_STORAGE_BUCKET || "product-images";

if (!url || !key) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: existing, error: listErr } = await supabase.storage.listBuckets();
if (listErr) {
  console.error("Failed to list buckets:", listErr);
  process.exit(1);
}

const found = existing.find((b) => b.name === bucketName);
if (found) {
  console.log(`Bucket '${bucketName}' already exists (public: ${found.public}).`);
  if (!found.public) {
    const { error: updateErr } = await supabase.storage.updateBucket(bucketName, { public: true });
    if (updateErr) {
      console.warn(`Could not make bucket public: ${updateErr.message}`);
    } else {
      console.log("Bucket switched to public.");
    }
  }
} else {
  const { error: createErr } = await supabase.storage.createBucket(bucketName, {
    public: true,
    fileSizeLimit: 1024 * 1024 * 20,
  });
  if (createErr) {
    console.error("Failed to create bucket:", createErr.message);
    process.exit(1);
  }
  console.log(`Bucket '${bucketName}' created (public).`);
}
