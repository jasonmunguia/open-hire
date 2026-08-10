# Instructions for a coding agent

You are setting up Open Hire for someone who wants to screen a stack of resumes.
Work through the phases in order. **Do every automatable step yourself, then stop
and hand the user a numbered list of what only they can do.**

This file is the contract. If something here conflicts with your instincts about
how to be helpful, follow this file.

## Hard rules

1. **Never commit candidate data.** Resumes, rosters and `assets/` are real
   people's names, emails and phone numbers. `.gitignore` already blocks
   `*.pdf`, `*.xlsx`, `*.csv` and `assets/`. Do not weaken it, and never use
   `git add -f` on those paths.
2. **Never invent a page number.** If you cannot determine where a resume starts,
   say so and flag it. A wrong boundary makes a reviewer judge someone by a
   stranger's resume, and nothing downstream will catch it.
3. **Never claim a step worked without running it.** Quote the command and its
   real output. If you could not run it, say "unverified" and name the check the
   user has to perform.
4. **Stop at account creation.** You cannot sign up for Supabase or Vercel. Do
   not pretend to, and do not ask the user for passwords. Ask only for the
   connection string and let the CLI handle Vercel auth.
5. **Do not redesign the UI.** `app/page.tsx` and `lib/rounds.ts` are working,
   tested code. Change them only if the user asks. One edit they may ask for:
   the header chips near the top of `app/page.tsx` (`FDE`, `Role 2`, `Role 3`)
   are hard-coded display placeholders — renaming the first to their role
   label is a one-line change and within scope if requested.

---

## Phase 1 — Get it running (no accounts needed)

Check versions first — the failure modes are confusing otherwise:

```bash
node --version     # needs 20.9+ (Next.js 16 requirement; see "engines" in package.json)
python3 --version  # needs 3.10+ (the pipeline uses `str | None` annotations)
```

If either is too old, install from https://nodejs.org or
https://www.python.org/downloads/ before continuing. Then:

```bash
git clone https://github.com/jasonmunguia/open-hire.git
cd open-hire
npm install
python3 -m pip install -r requirements.txt
npx vitest run
python3 -m pytest tests -q
```

If the pip step fails with `externally-managed-environment`, create a venv and
use it for every Python command afterwards:
`python3 -m venv .venv && source .venv/bin/activate`, then re-run the install.

Expect **12 passing** round-logic tests and **21 passing** pipeline tests.

If either suite fails, fix that before going further — a broken baseline makes
every later failure ambiguous. Report the actual counts you saw.

---

## Phase 2 — Understand the user's PDF before processing it

Ask for the PDF path if you do not have it. Then inspect it — do not guess:

```bash
python3 -c "
import fitz, sys
d = fitz.open(sys.argv[1])
print('pages:', d.page_count)
print('bookmarks:', len(d.get_toc()))
for t in d.get_toc()[:5]: print('  ', t)
print('first page starts:', repr(d[0].get_text()[:200]))
" "<path to pdf>"
```

Decide which strategy applies:

| What you see | Strategy | Confidence |
|---|---|---|
| A roster spreadsheet with a start-page column | `roster` | Exact |
| Bookmarks, roughly one per candidate | `bookmarks` | Exact |
| `Job applicants as of` on page 1 | `handshake` | ~98%, rest flagged |
| None of the above | `heuristic` | **Low — must be reviewed** |

**If it lands on `heuristic`, stop and tell the user before processing.** Show
them the "Before anything else: label the resumes" section of the README and
offer the ChatGPT prompt that produces a roster CSV. Ingesting a heuristic guess wastes their time
and produces a database they will not trust.

Sanity-check the arithmetic out loud: pages ÷ candidates should land near 1–2
pages per resume. If the PDF has 1,600 pages and you found 40 candidates,
the boundary detection is wrong.

---

## Phase 3 — Ingest

Boundaries first, no images. This is fast and reversible:

```bash
python3 -m pipeline.ingest --pdf "<pdf>" [--roster "<roster>"] \
  --out assets --skip-images
```

Read the report back to the user: strategy chosen, candidate count, how many
flagged, how many missing an email. **An email is required to load a candidate**,
because it is the merge key — if many are missing, a roster file fixes it.

Only when the numbers look sane, render for real:

```bash
python3 -m pipeline.ingest --pdf "<pdf>" [--roster "<roster>"] --out assets
```

Confirm on disk:

```bash
ls assets/*.webp | wc -l
python3 -c "import json; m=json.load(open('assets/manifest.json')); print(len(m), 'candidates')"
```

---

## Phase 4 — Hand off the account work

**This is the phase people get stuck in. Be specific, give real links, and wait.**

Tell the user, as a numbered list:

> I've got everything ready locally. Three things need you, because they involve
> signing up for services:
>
> **1. Database (2 min)** — Sign in at https://supabase.com/dashboard/sign-in,
> then create a project at https://supabase.com/dashboard/new. Save the database
> password. Then go to Project Settings → Database → Connection string → pick
> **Transaction pooler**, and paste it to me with `[YOUR-PASSWORD]` replaced.
> If your password contains `#`, write it as `%23`.
>
> **2. Hosting (2 min)** — Sign up at https://vercel.com/signup, then run
> `npm i -g vercel && vercel login` and tell me when you're logged in.
>
> **3. Pick a URL name** — what should the site be called? It becomes
> `<name>.vercel.app`.

Wait for all three. Do not proceed with placeholders.

---

## Phase 5 — Wire it up

```bash
vercel link --yes --project "<name they chose>"
vercel blob create-store resumes --access public --yes   # writes the token to .env.local
```

Write `.env.local` with their `DATABASE_URL`, a `JOB_ID`, and — if they told
you the role name — a `JOB_TITLE`, which becomes the browser-tab title and the
job's name in the database. Keep the blob token Vercel already added; if
`BLOB_READ_WRITE_TOKEN` did not appear in `.env.local`, run
`vercel env pull .env.local`. **Never print the connection string back in
full** — it contains their password.

Verify the database is actually reachable before loading anything:

```bash
node -e "
import('postgres').then(async ({default: p}) => {
  const fs = await import('fs');
  for (const l of fs.readFileSync('.env.local','utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*\"?([^\"\n]*)\"?\s*\$/);
    if (m) process.env[m[1]] = m[2];
  }
  const sql = p(process.env.DATABASE_URL, {ssl:'require', prepare:false, max:1});
  console.log('connected:', (await sql\`select 1 as ok\`)[0].ok === 1);
  await sql.end();
}).catch(e => { console.error('FAILED:', e.code || e.message); process.exit(1); });
"
```

If this fails with `ENOTFOUND`, they gave you the direct connection string
instead of the pooler one. Ask again for the pooler string.

Then:

```bash
node scripts/upload.mjs
node scripts/load.mjs
```

`load.mjs` prints how many landed and how many have images. If images are 0,
upload did not finish — run it again, then load again.

---

## Phase 6 — Deploy and verify

```bash
vercel env add DATABASE_URL production
vercel env add JOB_ID production
vercel env add JOB_TITLE production   # only if it is set in .env.local
vercel --prod --yes
```

**Verify the live site rather than assuming.** Fetch the API and check it returns
a real candidate:

```bash
curl -s https://<name>.vercel.app/api/candidates | head -c 400
```

You should see `"round":1`, a total matching your candidate count, and a
candidate with a populated `imageUrls`. If you get HTML or a login page instead,
Deployment Protection is on — see Phase 7.

Also confirm an image URL actually loads:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "<one of the imageUrls>"
```

Anything other than `200` means the upload did not complete.

---

## Phase 7 — The last manual step

Tell the user:

> One toggle left, and the site won't be usable by anyone else until it's off:
>
> **Vercel dashboard → your project → Settings → Deployment Protection →
> Vercel Authentication → Disabled → Save.**
>
> Without this, anyone opening your link is asked to log into Vercel.

Then give them the URL and a one-paragraph summary of how screening works
(rounds, the three buttons, notes only saved on advance). The app has a
**How it works** button that explains it in the UI as well.

---

## Reporting rules

When you finish, report against what the user asked for, not what you did.
Mark each item **done**, **partial**, **not done**, or **needs you**. Include:

- the actual test counts you saw
- how many candidates were ingested and how many were flagged
- the live URL and the fact that you fetched it successfully
- anything you could not verify, named explicitly

Never round "probably fine" up to "done."

---

## Common failures

| Symptom | Cause |
|---|---|
| `ENOTFOUND db.*.supabase.co` | Direct connection string; use the pooler |
| Auth fails, password looks right | `#` or `@` in password needs URL-encoding |
| `No module named fitz` | `python3 -m pip install -r requirements.txt` (PyMuPDF imports as `fitz`) |
| `externally-managed-environment` from pip | System Python blocks global installs; use a venv (`python3 -m venv .venv && source .venv/bin/activate`) |
| `BLOB_READ_WRITE_TOKEN` missing after create-store | `vercel env pull .env.local` |
| Build or install fails with an engine/syntax error | Node < 20.9 or Python < 3.10; check versions (Phase 1) |
| Candidate count far too low | Boundary strategy misread the PDF; get a roster CSV |
| `load.mjs` skips many candidates | Those rows have no email; email is the merge key |
| Images 404 | `upload.mjs` did not finish; re-run it, then `load.mjs` |
| Blob operation limit hit | Uploads are metered on free plans, reads are not |
| Prepared-statement errors | A pooler needs `prepare: false` — already set in `lib/db.ts` |
