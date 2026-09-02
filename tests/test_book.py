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
    text = book.render(open(MESSAGE).read(), PEOPLE[0], "Robotics Engineer", ENV["BOOKING_URL"], "Jason")
    assert "Priya" in text and "Robotics Engineer" in text and ENV["BOOKING_URL"] in text and "Jason" in text
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
