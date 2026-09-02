---
name: book-interviews
description: "Invites the settled shortlist from an Open Hire deployment to book an interview, once each, over iMessage (macOS, verified against chat.db), email (SMTP, any OS), or print. Use when the user says the screening is done and wants the finalists invited, 'book the interviews', 'send the interview invites', or 'text the shortlist'. Never runs on a schedule: one request from the user is one run, and nothing is sent before they approve the dry run."
---

# book-interviews

Drives `scripts/book.py` in an [Open Hire](https://github.com/jasonmunguia/open-hire)
checkout. One request from the user is one run. Never schedule it, never run it
because screening *looks* finished, never send before the user has seen the
dry run and said yes.

## Before the run

1. Be inside the Open Hire project folder (it has `scripts/book.py`). If the
   user does not have one, clone `https://github.com/jasonmunguia/open-hire`
   and run `python3 -m pip install -r requirements.txt`; the script has no
   dependencies beyond the standard library, but the checkout is where the
   message template and ledger live.
2. Collect three things from the user and put the first two in `.env.local`:
   - `BOOKING_URL`: their scheduling link (Cal.com, Calendly, Google
     appointment page; anything a candidate can open and pick a slot from).
   - `SENDER_NAME`: who the invite is from.
   - The live app URL, `https://<their-app>.vercel.app`.
3. Pick the channel with them:
   - `imessage` (default): macOS only. Sends through Messages.app and is
     verified by finding the booking link in `~/Library/Messages/chat.db`. The
     terminal needs Full Disk Access (System Settings → Privacy & Security →
     Full Disk Access) or verification cannot read that file.
   - `email`: any OS. Needs `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
     `SMTP_PASS`, `SMTP_FROM` in `.env.local`. For Gmail that is an app
     password, not the account password.
   - `print`: any OS, sends nothing. Use it to show the user the exact text.
4. Offer to edit `scripts/booking-message.txt` with them. Keep the
   placeholders `{first_name}`, `{job_title}`, `{booking_url}`,
   `{sender_name}`; the script fills them per person.

## The run

```bash
python3 scripts/book.py --url https://<their-app>.vercel.app --channel <channel> --dry-run
```

Show the user the list it prints (names, contact, count) and wait for a yes.
If it exits with "Screening is not finished", stop: the app refused because a
round is half-finished or the pool is still above the cap. Tell the user the
reason and the undecided count. Do not edit decisions to get past it.

On yes:

```bash
python3 scripts/book.py --url https://<their-app>.vercel.app --channel <channel>
```

## Report

Paste the per-row output verbatim: `SENT+VERIFIED`, `SKIP (in ledger)`,
`HEALED (no send)`, `FAIL`, `UNVERIFIED`. Give the summary line and the exit
code. Name every FAIL and UNVERIFIED with their contact so the user can reach
them by hand; the script lists them under "contact by hand".

## What the script guarantees, so you do not have to

- Nobody is contacted twice. Verified sends go to `data/booking-ledger.jsonl`
  (git-ignored) and are skipped afterwards. On iMessage, a thread that already
  contains the booking link counts as done even if the ledger never saw it.
- Unverified sends are not recorded and exit nonzero, so re-running retries
  only them. Re-running is always safe.
- A corrupt ledger aborts the run instead of guessing who was contacted. Do
  not delete or hand-edit the ledger to fix it; show the user the offending line.
- Two runs cannot overlap; the second one exits.

## Installing this as a skill

Copy this folder into your agent's skills directory (for Claude Code:
`~/.claude/skills/book-interviews/`). It carries no code of its own; it tells
the agent how to run the script that ships with the repo.
