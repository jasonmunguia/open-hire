#!/usr/bin/env python3
"""Invite the shortlist to book an interview. The last step: review to hire.

    python3 scripts/book.py --url https://your-app.vercel.app [--dry-run]
    python3 scripts/book.py --from-json finalists.json --channel email

Reads the shortlist from the deployed app's /api/finalists (refused with the
reason while screening is still open), renders scripts/booking-message.txt for
each person, and sends it over one channel:

  imessage  (default) macOS only. Messages.app via AppleScript. Every send is
            verified by finding the booking link in ~/Library/Messages/chat.db
            before it is recorded, so the terminal needs Full Disk Access; the
            run refuses to start if chat.db cannot be read.
  email     Any OS. SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM in
            .env.local. The login is tested before anyone is contacted; a
            message is recorded once the server accepts it.
  print     Any OS. Writes what would be sent to stdout. Never contacts anyone.

Nobody is contacted twice. data/booking-ledger.jsonl records every verified
send; a person in it is skipped. For iMessage there is also a heal pass: if
their thread already contains the booking link (a past run, a timed-out
verification, you texting them by hand), they are recorded and skipped without
a send. Unverified sends are NOT recorded and exit nonzero, so re-running
retries only the failures. A corrupt ledger aborts the run instead of guessing.

Environment (.env.local or the shell):
  BOOKING_URL   required. Your scheduling link (Cal.com, Calendly, ...).
  SENDER_NAME   required. Who the message is from.
"""
import argparse
import json
import os
import platform
import re
import smtplib
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.request
from datetime import datetime
from email.message import EmailMessage

try:                      # Unix
    import fcntl
except ImportError:       # Windows
    fcntl = None
    import msvcrt

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_LEDGER = os.path.join(ROOT, "data", "booking-ledger.jsonl")
DEFAULT_MESSAGE = os.path.join(HERE, "booking-message.txt")
CHAT_DB = os.path.expanduser("~/Library/Messages/chat.db")

APPLESCRIPT = '''
on run {targetPhone, msgText}
    tell application "Messages"
        set svc to 1st account whose service type = iMessage
        send msgText to participant targetPhone of svc
    end tell
end run
'''
APPLESCRIPT_LEGACY = '''
on run {targetPhone, msgText}
    tell application "Messages"
        set svc to 1st service whose service type = iMessage
        send msgText to buddy targetPhone of svc
    end tell
end run
'''


def acquire_lock(lock_f):
    """One run at a time. fcntl on Unix, msvcrt on Windows. Returns False if another run holds it."""
    try:
        if fcntl:
            fcntl.flock(lock_f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        else:
            msvcrt.locking(lock_f.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        return False
    return True


def platform_problem(channel, system=None):
    """Why this channel cannot run on this OS, or None."""
    system = system or platform.system()
    if channel == "imessage" and system != "Darwin":
        return ("iMessage needs Messages.app, which only exists on macOS. "
                "On " + ("Windows" if system == "Windows" else system) +
                " use --channel email (SMTP_* values in .env.local) or --channel print.")
    return None


def chatdb_problem(path=None):
    """Why chat.db cannot be read, or None. Without it a send cannot be verified,
    and an unverified send is retried next run: that is how people get texted twice."""
    path = path or CHAT_DB
    if not os.path.exists(path):
        return f"{path} does not exist. Is Messages signed in on this Mac?"
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        con.execute("select count(*) from message limit 1").fetchone()
        con.close()
    except sqlite3.Error as e:
        return (f"cannot read {path} ({e}). Grant your terminal Full Disk Access: "
                "System Settings -> Privacy & Security -> Full Disk Access, add the app "
                "you run this from, then open a new terminal window.")
    return None


def smtp_hint(err):
    """Turn a raw smtplib/socket error into the next thing to check."""
    if isinstance(err, smtplib.SMTPAuthenticationError):
        return ("login rejected: wrong SMTP_USER or SMTP_PASS. Gmail needs an app password, "
                "not your account password: https://myaccount.google.com/apppasswords")
    if isinstance(err, socket.gaierror):
        return "SMTP_HOST is not a real hostname (for Gmail: smtp.gmail.com)"
    if isinstance(err, (ConnectionRefusedError, TimeoutError, socket.timeout)):
        return "nothing answered on SMTP_HOST:SMTP_PORT. Check the port (Gmail: 587) and your network"
    if isinstance(err, (smtplib.SMTPServerDisconnected, smtplib.SMTPNotSupportedError, ssl_error_type())):
        return "the server closed the connection at STARTTLS. Wrong port for this server (587 expects STARTTLS; 465 is SSL-only)"
    return str(err)


def ssl_error_type():
    import ssl
    return ssl.SSLError


def smtp_preflight():
    """Log in and log out without sending. Returns None if it works, else a hint."""
    host, port = os.environ.get("SMTP_HOST"), int(os.environ.get("SMTP_PORT", "587"))
    user, pw, sender = os.environ.get("SMTP_USER"), os.environ.get("SMTP_PASS"), os.environ.get("SMTP_FROM")
    if not all([host, user, pw, sender]):
        return "SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM must all be set in .env.local"
    try:
        with smtplib.SMTP(host, port, timeout=20) as s:
            s.starttls()
            s.login(user, pw)
        return None
    except (smtplib.SMTPException, OSError) as e:
        return smtp_hint(e)


def load_env_local(path=os.path.join(ROOT, ".env.local")):
    """Same rule as scripts/upload.mjs: .env.local fills in, the shell wins."""
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        m = re.match(r'^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$', line)
        if m and not os.environ.get(m.group(1)):
            os.environ[m.group(1)] = m.group(2)


def normalize_phone(raw):
    """+1XXXXXXXXXX for 10- and 11-digit North American numbers; else as given."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    return raw if (raw or "").startswith("+") else ("+" + digits if digits else "")


def contact_key(channel, person):
    """What the ledger dedupes on: phone tail for iMessage, lowercase email otherwise."""
    if channel == "imessage":
        return re.sub(r"\D", "", normalize_phone(person.get("phone") or ""))[-10:]
    return (person.get("email") or "").strip().lower()


def render(template, person, job_title, booking_url, sender_name):
    name = (person.get("name") or "").strip()
    first = name.split()[0] if name else "there"
    return template.format(
        name=name or "there", first_name=first, job_title=job_title,
        booking_url=booking_url, sender_name=sender_name,
    ).strip()


def load_ledger_keys(ledger_path):
    """Set of contact keys already handled. Aborts loudly on a malformed line."""
    keys = set()
    if not os.path.exists(ledger_path):
        return keys
    with open(ledger_path) as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                keys.add(json.loads(line)["key"])
            except (json.JSONDecodeError, KeyError) as e:
                sys.exit(f"LEDGER CORRUPT at {ledger_path}:{i} ({e}). "
                         f"Refusing to run. Fix or remove that line first.")
    return keys


def ledger_append(ledger_path, entry):
    os.makedirs(os.path.dirname(ledger_path), exist_ok=True)
    with open(ledger_path, "a") as f:
        f.write(json.dumps(entry) + "\n")
        f.flush()
        os.fsync(f.fileno())


def applescript_send(phone, text):
    r = None
    for script in (APPLESCRIPT, APPLESCRIPT_LEGACY):
        try:
            r = subprocess.run(["osascript", "-e", script, phone, text],
                               capture_output=True, text=True, timeout=30)
        except FileNotFoundError:
            return False, "osascript not found: iMessage sending only works on macOS"
        if r.returncode == 0:
            return True, ""
    return False, (r.stderr.strip() if r else "osascript did not run")


def find_in_chatdb(phone, needle, since_epoch=0, timeout_s=0):
    """ISO timestamp of an outgoing message to `phone` containing `needle` at
    or after `since_epoch`, polling every 2s until timeout_s; else None."""
    if not os.path.exists(CHAT_DB):
        return None
    tail = re.sub(r"\D", "", phone)[-10:]
    deadline = time.time() + timeout_s
    while True:
        con = sqlite3.connect(f"file:{CHAT_DB}?mode=ro", uri=True)
        cur = con.cursor()
        cur.execute(
            """
            SELECT m.text, m.attributedBody,
                   m.date/1000000000 + strftime('%s','2001-01-01'),
                   datetime(m.date/1000000000 + strftime('%s','2001-01-01'),
                            'unixepoch','localtime')
            FROM message m JOIN handle h ON m.handle_id = h.ROWID
            WHERE m.is_from_me = 1
              AND replace(replace(replace(h.id,'-',''),' ',''),'+','') LIKE '%' || ?
            ORDER BY m.date DESC LIMIT 50
            """, (tail,))
        rows = cur.fetchall()
        con.close()
        for text, blob, epoch, ts in rows:
            hay = text or ""
            if not hay and blob:
                hay = blob.decode("utf-8", "ignore")
            if needle in hay and epoch >= since_epoch - 5:
                return ts
        if time.time() >= deadline:
            return None
        time.sleep(2)


def smtp_send(person, subject, text):
    host, port = os.environ.get("SMTP_HOST"), int(os.environ.get("SMTP_PORT", "587"))
    user, pw, sender = os.environ.get("SMTP_USER"), os.environ.get("SMTP_PASS"), os.environ.get("SMTP_FROM")
    if not all([host, user, pw, sender]):
        return False, "SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM not all set in .env.local"
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, person["email"], subject
    msg.set_content(text)
    try:
        with smtplib.SMTP(host, port, timeout=30) as s:
            s.starttls()
            s.login(user, pw)
            refused = s.send_message(msg)
        return (not refused), (f"refused: {refused}" if refused else "")
    except (smtplib.SMTPException, OSError) as e:
        return False, smtp_hint(e)


def fetch_finalists(url):
    req = urllib.request.Request(url.rstrip("/") + "/api/finalists",
                                 headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except Exception:
            return e.code, {"error": str(e)}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--url", help="deployed app, e.g. https://my-hiring-app.vercel.app")
    src.add_argument("--from-json", help="a saved /api/finalists response, or a list of people")
    ap.add_argument("--channel", choices=["imessage", "email", "print"], default="imessage")
    ap.add_argument("--message", default=DEFAULT_MESSAGE)
    ap.add_argument("--ledger", default=DEFAULT_LEDGER)
    ap.add_argument("--dry-run", action="store_true", help="show who would be contacted; send nothing")
    ap.add_argument("--pace", type=float, default=5.0, help="seconds between sends")
    ap.add_argument("--verify-timeout", type=float, default=30.0)
    ap.add_argument("--subject", default="Interview for {job_title}")
    args = ap.parse_args(argv)

    load_env_local()
    booking_url, sender_name = os.environ.get("BOOKING_URL"), os.environ.get("SENDER_NAME")
    if not booking_url or not sender_name:
        sys.exit("BOOKING_URL and SENDER_NAME must be set in .env.local (see .env.example).")
    template = open(args.message, encoding="utf-8").read()

    # Preflight: refuse before contacting anyone if this channel cannot work here.
    # For iMessage that includes being able to READ chat.db, because a send that
    # cannot be verified is not recorded and would be retried next run.
    problem = platform_problem(args.channel)
    if problem:
        sys.exit(problem)
    if args.channel == "imessage":
        problem = chatdb_problem()
        if problem and not args.dry_run:
            sys.exit("Cannot verify iMessage sends: " + problem + " Nobody contacted.")
        if problem:
            print("WARNING: " + problem + " A real run will refuse to start until this is fixed.")
    if args.channel == "email":
        problem = smtp_preflight()
        if problem and not args.dry_run:
            sys.exit("SMTP check failed: " + problem + ". Nobody contacted.")
        print(("WARNING: SMTP check failed: " + problem + ". A real run will refuse to start until this is fixed.")
              if problem else "SMTP login OK")

    if args.url:
        status, body = fetch_finalists(args.url)
        if status == 409:
            sys.exit(f"Screening is not finished: {body.get('blocked')} "
                     f"(round {body.get('round')}, {body.get('undecided')} undecided). Nobody contacted.")
        if status != 200:
            sys.exit(f"/api/finalists returned {status}: {body}")
    else:
        body = json.load(open(args.from_json))
        if isinstance(body, list):
            body = {"finalists": body}
    people = body.get("finalists", [])
    job_title = body.get("jobTitle") or os.environ.get("JOB_TITLE") or "the role"
    if not people:
        print("Shortlist is empty. Nothing to send.")
        return 0

    lock_f = open(args.ledger + ".lock", "w") if os.path.isdir(os.path.dirname(args.ledger)) or not os.path.dirname(args.ledger) else None
    if lock_f is None:
        os.makedirs(os.path.dirname(args.ledger), exist_ok=True)
        lock_f = open(args.ledger + ".lock", "w")
    if not acquire_lock(lock_f):
        sys.exit("Another book.py run holds the ledger lock. Aborting.")

    already = load_ledger_keys(args.ledger)
    run_id = datetime.now().strftime("run-%Y-%m-%d")
    sent, skipped, healed, failed = [], [], [], []
    print(f"shortlist: {len(people)} people  channel: {args.channel}  job: {job_title}")

    for person in people:
        name = person.get("name") or "?"
        key = contact_key(args.channel, person)
        label = normalize_phone(person.get("phone") or "") if args.channel == "imessage" else (person.get("email") or "")
        if not key:
            failed.append(person)
            print(f"FAIL (no {'phone' if args.channel == 'imessage' else 'email'})  {name:35s}")
            continue
        if key in already:
            skipped.append(person)
            print(f"SKIP (in ledger)   {name:35s} {label}")
            continue
        text = render(template, person, job_title, booking_url, sender_name)

        if args.channel == "imessage":
            prior = find_in_chatdb(label, booking_url)
            if prior:
                if args.dry_run:
                    print(f"WOULD-HEAL         {name:35s} {label}  (link already in chat.db {prior})")
                else:
                    ledger_append(args.ledger, {"key": key, "name": name, "contact": label, "channel": "imessage",
                                                "sent_at": prior, "verified": "chat.db-heal", "run": run_id})
                    print(f"HEALED (no send)   {name:35s} {label}  already had it since {prior}")
                already.add(key); healed.append(person)
                continue

        if args.dry_run or args.channel == "print":
            tag = "DRY-RUN would send" if args.dry_run else "PRINT"
            print(f"{tag} {name:35s} {label}")
            if args.channel == "print" and not args.dry_run:
                print("    " + text.replace("\n", "\n    "))
            sent.append(person)
            continue

        t0 = time.time()
        if args.channel == "imessage":
            ok, err = applescript_send(label, text)
            if not ok:
                failed.append(person); print(f"FAIL (osascript)   {name:35s} {label}  {err}"); continue
            ts = find_in_chatdb(label, booking_url, since_epoch=t0, timeout_s=args.verify_timeout)
            if not ts:
                failed.append(person)
                print(f"UNVERIFIED         {name:35s} {label}  (osascript ok, not in chat.db within "
                      f"{int(args.verify_timeout)}s; next run will heal or retry)")
                continue
            verified = "chat.db"
        else:
            ok, err = smtp_send(person, args.subject.format(job_title=job_title), text)
            if not ok:
                failed.append(person); print(f"FAIL (smtp)        {name:35s} {label}  {err}"); continue
            ts, verified = datetime.now().isoformat(timespec="seconds"), "smtp-accepted"

        ledger_append(args.ledger, {"key": key, "name": name, "contact": label, "channel": args.channel,
                                    "sent_at": ts, "verified": verified, "run": run_id})
        already.add(key); sent.append(person)
        print(f"SENT+VERIFIED      {name:35s} {label}  {ts}")
        time.sleep(args.pace)

    print(f"\nsent={len(sent)} skipped={len(skipped)} healed={len(healed)} failed={len(failed)}")
    for p in failed:
        print(f"  contact by hand: {p.get('name')}  {p.get('phone') or ''}  {p.get('email') or ''}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
