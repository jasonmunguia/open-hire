/**
 * Apply the schema and load the manifest into Postgres.
 *
 * Idempotent and additive: re-running merges by email rather than duplicating,
 * and a later run never blanks a field an earlier one filled. Safe to run again
 * after uploading more images.
 *
 *   node scripts/load.mjs [assetsDir]
 */
import postgres from "postgres";
import { existsSync, readFileSync } from "fs";

const DIR = process.argv[2] ?? "assets";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const dsn = process.env.DATABASE_URL;
if (!dsn) { console.error("DATABASE_URL is not set. See .env.example."); process.exit(1); }

const jobId = process.env.JOB_ID ?? "default";
const jobTitle = process.env.JOB_TITLE ?? "Open Role";
const jobLabel = process.env.JOB_LABEL ?? "ROLE";

const sql = postgres(dsn, { ssl: "require", max: 4, prepare: false });
await sql.unsafe(readFileSync("pipeline/schema.sql", "utf8"));
console.log("schema applied");

const [job] = await sql`
  insert into jobs (external_id, title, label)
  values (${jobId}, ${jobTitle}, ${jobLabel})
  on conflict (external_id) do update set title = excluded.title, label = excluded.label
  returning id`;

const manifest = JSON.parse(readFileSync(`${DIR}/manifest.json`, "utf8"));
const urls = existsSync(`${DIR}/urls.json`)
  ? JSON.parse(readFileSync(`${DIR}/urls.json`, "utf8")) : {};

let loaded = 0, skipped = 0;
for (const c of manifest) {
  if (!c.email) { skipped++; continue; }   // email is the merge key
  const imageUrls = c.image_keys.map((k) => urls[k]).filter(Boolean);
  await sql`
    insert into candidates (job_id, candidate_id, email, name, school, school_year,
                            majors, grad_date, phone, page_count, image_urls,
                            pdf_key, sort_key, flags)
    values (${job.id}, ${c.external_id}, ${c.email.toLowerCase()}, ${c.name},
            ${c.school}, ${c.school_year}, ${c.majors},
            ${c.grad_date || null}, ${c.phone}, ${c.page_count},
            ${imageUrls}, ${c.pdf_key}, ${c.sort_key}, ${c.flags ?? []})
    on conflict (job_id, email) do update set
      name = excluded.name,
      school = coalesce(excluded.school, candidates.school),
      school_year = coalesce(excluded.school_year, candidates.school_year),
      majors = coalesce(excluded.majors, candidates.majors),
      grad_date = coalesce(excluded.grad_date, candidates.grad_date),
      phone = coalesce(excluded.phone, candidates.phone),
      page_count = excluded.page_count,
      image_urls = case when cardinality(excluded.image_urls) > 0
                        then excluded.image_urls else candidates.image_urls end,
      pdf_key = excluded.pdf_key, sort_key = excluded.sort_key, flags = excluded.flags`;
  loaded++;
}

const [{ total }] = await sql`select count(*)::int as total from candidates where job_id = ${job.id}`;
const [{ withimg }] = await sql`
  select count(*)::int as withimg from candidates
  where job_id = ${job.id} and cardinality(image_urls) > 0`;
console.log(`loaded ${loaded} | skipped (no email) ${skipped}`);
console.log(`in database: ${total} | with images: ${withimg}`);
if (withimg < total) {
  console.log("\n! Some candidates have no images. Run scripts/upload.mjs, then this again.");
}
await sql.end();
