/**
 * Upload rendered resume images to Vercel Blob and record their public URLs.
 *
 * Resumable: already-uploaded keys are skipped, so re-running after a network
 * failure costs nothing. Blob write operations are metered on free plans.
 *
 *   node scripts/upload.mjs [assetsDir]
 */
import { put } from "@vercel/blob";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { readFile } from "fs/promises";

const DIR = process.argv[2] ?? "assets";
const CONCURRENCY = 12;

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error("BLOB_READ_WRITE_TOKEN is not set.");
  console.error("Run:  vercel blob create-store resumes --access public --yes");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(`${DIR}/manifest.json`, "utf8"));
const urlsPath = `${DIR}/urls.json`;
const urls = existsSync(urlsPath) ? JSON.parse(readFileSync(urlsPath, "utf8")) : {};

const queue = manifest.flatMap((c) => c.image_keys).filter((k) => !urls[k]);
console.log(`uploading ${queue.length} images (${Object.keys(urls).length} already done)`);

let done = 0, failed = 0;
async function worker() {
  for (;;) {
    const key = queue.pop();
    if (!key) return;
    try {
      const body = await readFile(`${DIR}/${key}`);
      const res = await put(key, body, {
        access: "public", token, addRandomSuffix: false,
        contentType: "image/webp", cacheControlMaxAge: 31536000,
      });
      urls[key] = res.url;
    } catch (e) {
      failed++;
      console.error(`FAIL ${key}: ${String(e.message).slice(0, 90)}`);
    }
    if (++done % 100 === 0) {
      writeFileSync(urlsPath, JSON.stringify(urls));
      console.log(`  ${done} uploaded, ${failed} failed`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeFileSync(urlsPath, JSON.stringify(urls));
console.log(`DONE: ${Object.keys(urls).length} urls mapped, ${failed} failed`);
if (failed) process.exit(1);
