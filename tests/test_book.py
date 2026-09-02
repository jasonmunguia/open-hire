"""scripts/book.py guarantees. Sends nothing: print channel, dry runs, temp ledgers."""
import importlib.util
import json
import os
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOK = os.path.join(ROOT, "scripts", "book.py")
MESSAGE = os.path.join(ROOT, "scripts", "booking-message.txt")

spec = importlib.util.spec_from_file_location("book", BOOK)
book = importlib.util.module_from_spec(spec)
spec.loader.exec_module(book)

PEOPLE = [
    {"name": "Priya Raghavan", "phone": "(617) 555-0148", "email": "priya@example.test"},
    {"name": "Marcus Delgado", "phone": "4045550133", "email": "Marcus@Example.test"},
    {"name": "Wei Chen", "phone": None, "email": "wei@example.test"},
]
ENV = {"BOOKING_URL": "https://cal.com/test/interview", "SENDER_NAME": "Test Sender"}


def run(args, tmp, env=ENV):
    e = {**os.environ, **env, "HOME": str(tmp)}   # HOME -> no real chat.db, no real .env.local
    return subprocess.run([sys.executable, BOOK, *args], capture_output=True, text=True, env=e, cwd=str(tmp))


def test_normalize_phone():
    assert book.normalize_phone("2025550142") == "+12025550142"
    assert book.normalize_phone("+1 (202) 555-0143") == "+12025550143"
    assert book.normalize_phone("12025550144") == "+12025550144"
    assert book.normalize_phone("") == ""


def test_render_fills_every_placeholder():
    text = book.render(open(MESSAGE).read(), PEOPLE[0], "Robotics Engineer", ENV["BOOKING_URL"], ENV["SENDER_NAME"])
    assert "Priya" in text and "Robotics Engineer" in text and ENV["BOOKING_URL"] in text and ENV["SENDER_NAME"] in text
    assert "{" not in text


def test_contact_key_by_channel():
    assert book.contact_key("imessage", PEOPLE[0]) == "6175550148"
    assert book.contact_key("email", PEOPLE[1]) == "marcus@example.test"
    assert book.contact_key("imessage", PEOPLE[2]) == ""


def test_print_channel_sends_nothing_and_ledgers_nothing(tmp_path):
    src = tmp_path / "f.json"; src.write_text(json.dumps({"jobTitle": "RLE", "finalists": PEOPLE}))
    ledger = tmp_path / "ledger.jsonl"
    r = run(["--from-json", str(src), "--channel", "print", "--ledger", str(ledger)], tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    assert r.stdout.count("PRINT ") == 3 and "Hey Priya, this is Test Sender" in r.stdout
    assert "sent=3 skipped=0 healed=0 failed=0" in r.stdout
    assert not ledger.exists()


def test_dry_run_reports_counts_without_writing(tmp_path):
    src = tmp_path / "f.json"; src.write_text(json.dumps(PEOPLE))   # bare list form
    ledger = tmp_path / "ledger.jsonl"
    r = run(["--from-json", str(src), "--channel", "email", "--ledger", str(ledger), "--dry-run"], tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    assert r.stdout.strip().endswith("sent=3 skipped=0 healed=0 failed=0")
    assert not ledger.exists()


def test_ledger_skips_people_already_invited(tmp_path):
    src = tmp_path / "f.json"; src.write_text(json.dumps({"finalists": PEOPLE}))
    ledger = tmp_path / "ledger.jsonl"
    ledger.write_text(json.dumps({"key": "6175550148", "name": "Priya Raghavan"}) + "\n")
    r = run(["--from-json", str(src), "--channel", "imessage", "--ledger", str(ledger), "--dry-run"], tmp_path)
    assert "SKIP (in ledger)   Priya Raghavan" in r.stdout
    assert "DRY-RUN would send Marcus Delgado" in r.stdout
    assert "FAIL (no phone)" in r.stdout and "contact by hand: Wei Chen" in r.stdout
    assert "sent=1 skipped=1 healed=0 failed=1" in r.stdout
    assert r.returncode == 1


def test_corrupt_ledger_aborts_before_contacting_anyone(tmp_path):
    src = tmp_path / "f.json"; src.write_text(json.dumps({"finalists": PEOPLE}))
    ledger = tmp_path / "ledger.jsonl"
    ledger.write_text('{"key": "6175550148"}\nnot json\n')
    r = run(["--from-json", str(src), "--channel", "print", "--ledger", str(ledger)], tmp_path)
    assert r.returncode != 0
    assert "LEDGER CORRUPT" in r.stderr and "PRINT" not in r.stdout


def test_missing_env_refuses_to_run(tmp_path):
    src = tmp_path / "f.json"; src.write_text(json.dumps({"finalists": PEOPLE}))
    r = run(["--from-json", str(src), "--channel", "print"], tmp_path, env={"BOOKING_URL": "", "SENDER_NAME": ""})
    assert r.returncode != 0 and "BOOKING_URL" in r.stderr


def test_blocked_shortlist_contacts_nobody(tmp_path):
    """A 409 from /api/finalists must stop the run with the reason."""
    import http.server, threading
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps({"blocked": "the current round is half-finished", "round": 2, "undecided": 7}).encode()
            self.send_response(409); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
        def log_message(self, *a): pass
    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    t = threading.Thread(target=srv.serve_forever, daemon=True); t.start()
    try:
        r = run(["--url", f"http://127.0.0.1:{srv.server_port}", "--channel", "print"], tmp_path)
    finally:
        srv.shutdown()
    assert r.returncode != 0
    assert "half-finished" in r.stderr and "7 undecided" in r.stderr and "Nobody contacted" in r.stderr


def test_skill_references_only_files_that_exist():
    """A cross-reference is a promise: every repo path the skill names must exist."""
    import re
    text = open(os.path.join(ROOT, "skills", "book-interviews", "SKILL.md")).read()
    for rel in set(re.findall(r"`((?:scripts|data|skills)/[A-Za-z0-9_./-]+)`", text)):
        if rel.startswith("data/"):
            continue  # runtime output, git-ignored by design
        assert os.path.exists(os.path.join(ROOT, rel)), f"SKILL.md names {rel}, which is not in the repo"
    assert "book.py" in text and "--dry-run" in text


def test_imessage_refused_off_macos():
    assert book.platform_problem("imessage", "Linux").startswith("iMessage needs Messages.app")
    assert "--channel email" in book.platform_problem("imessage", "Windows")
    assert book.platform_problem("email", "Windows") is None
    assert book.platform_problem("print", "Linux") is None
    assert book.platform_problem("imessage", "Darwin") is None


def test_unreadable_chatdb_is_named_before_any_send(tmp_path):
    """No chat.db means no verification, and an unverified send is retried next run.
    That is the double-text path, so the run must refuse up front."""
    assert "does not exist" in book.chatdb_problem(str(tmp_path / "missing.db"))
    junk = tmp_path / "junk.db"; junk.write_bytes(b"not a database")
    assert "Full Disk Access" in book.chatdb_problem(str(junk))


def test_smtp_errors_become_next_actions():
    import smtplib, socket
    assert "apppasswords" in book.smtp_hint(smtplib.SMTPAuthenticationError(535, b"bad"))
    assert "SMTP_HOST" in book.smtp_hint(socket.gaierror(8, "nodename nor servname"))
    assert "port" in book.smtp_hint(ConnectionRefusedError())
    assert "STARTTLS" in book.smtp_hint(smtplib.SMTPServerDisconnected("closed"))


def test_smtp_preflight_refuses_before_contacting_anyone(tmp_path, monkeypatch):
    for k, v in {"SMTP_HOST": "127.0.0.1", "SMTP_PORT": "9", "SMTP_USER": "u", "SMTP_PASS": "p", "SMTP_FROM": "u@example.test"}.items():
        monkeypatch.setenv(k, v)
    hint = book.smtp_preflight()
    assert hint and "port" in hint
    src = tmp_path / "f.json"; src.write_text(json.dumps({"finalists": PEOPLE}))
    r = run(["--from-json", str(src), "--channel", "email", "--ledger", str(tmp_path / "l.jsonl")], tmp_path,
            env={**ENV, "SMTP_HOST": "127.0.0.1", "SMTP_PORT": "9", "SMTP_USER": "u", "SMTP_PASS": "p", "SMTP_FROM": "u@example.test"})
    assert r.returncode != 0 and "SMTP check failed" in r.stderr and "Nobody contacted" in r.stderr
    assert "SENT" not in r.stdout
