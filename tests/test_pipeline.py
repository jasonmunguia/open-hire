"""Pipeline tests. Everything runs against a synthetic PDF built in-repo, so
these pass on a machine that has never seen a real resume.
"""
import csv
import sys
from itertools import pairwise
from pathlib import Path

import fitz
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).parent / "fixtures"))

from make_fixture import PEOPLE, build
from pipeline import strategies
from pipeline.extract import find_phone, resume_text
from pipeline.ingest import ingest


@pytest.fixture(scope="module")
def bookmarked(tmp_path_factory):
    return build(tmp_path_factory.mktemp("pdf") / "bookmarked.pdf")


@pytest.fixture(scope="module")
def plain(tmp_path_factory):
    return build(tmp_path_factory.mktemp("pdf") / "plain.pdf", bookmarks=False)


# ── strategy selection ──────────────────────────────────────────────────────

def test_picks_bookmarks_when_the_pdf_has_them(bookmarked):
    doc = fitz.open(bookmarked)
    name, people = strategies.choose(doc, None)
    assert name == "bookmarks"
    assert len(people) == len(PEOPLE)


def test_falls_back_to_heuristic_without_structure(plain):
    doc = fitz.open(plain)
    name, people = strategies.choose(doc, None)
    assert name == "heuristic"
    # A guess must announce itself so nobody trusts it by accident.
    assert all("heuristic" in c.flags for c in people)


def test_roster_wins_over_bookmarks_when_both_exist(bookmarked, tmp_path):
    rows = [{"name": p["name"], "email": p["email"], "start": str(i), "pages": "1"}
            for i, p in enumerate(PEOPLE, start=1)]
    doc = fitz.open(bookmarked)
    name, _ = strategies.choose(doc, rows)
    assert name == "roster"


def test_unknown_forced_strategy_is_a_clear_error(bookmarked):
    doc = fitz.open(bookmarked)
    with pytest.raises(ValueError, match="Unknown strategy"):
        strategies.choose(doc, None, "telepathy")


# ── boundaries ──────────────────────────────────────────────────────────────

def test_bookmark_ranges_are_contiguous_and_cover_the_document(bookmarked):
    doc = fitz.open(bookmarked)
    _, people = strategies.choose(doc, None)
    assert people[0].start == 0
    for a, b in pairwise(people):
        assert a.end == b.start
    assert people[-1].end == doc.page_count


def test_multi_page_resume_keeps_all_its_pages(bookmarked):
    doc = fitz.open(bookmarked)
    _, people = strategies.choose(doc, None)
    bo = next(c for c in people if "Brennan" in c.name)
    assert bo.pages == 2
    text = resume_text(doc, bo.start, bo.end)
    assert "page 2" in text
    assert "Cyd Castro" not in text          # must not bleed into the next person


def test_bookmark_prefix_becomes_an_id_not_part_of_the_name(bookmarked):
    doc = fitz.open(bookmarked)
    _, people = strategies.choose(doc, None)
    assert people[0].name == "Ada Alvarez"
    assert people[0].external_id == "AG #0001"


# ── roster parsing ──────────────────────────────────────────────────────────

def test_reads_a_csv_roster_with_differently_worded_headers(tmp_path):
    path = tmp_path / "roster.csv"
    with open(path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["Applicant ID", "Full Name", "E-Mail", "University", "Class Year"])
        w.writerow(["7", "Ada Alvarez", "ada@example.test", "Test University", "Masters"])
    rows = strategies.read_roster_rows(str(path))
    assert rows[0]["name"] == "Ada Alvarez"
    assert rows[0]["email"] == "ada@example.test"
    assert rows[0]["school"] == "Test University"
    assert rows[0]["school_year"] == "Masters"


def test_roster_without_a_name_column_fails_loudly(tmp_path):
    path = tmp_path / "bad.csv"
    path.write_text("colour,size\nred,large\n")
    with pytest.raises(ValueError, match="No header row"):
        strategies.read_roster_rows(str(path))


def test_roster_metadata_enriches_bookmark_boundaries(bookmarked):
    """The common real case: exact pages from bookmarks, details from a sheet."""
    doc = fitz.open(bookmarked)
    _, people = strategies.choose(doc, None)
    rows = [{"name": p["name"], "email": p["email"], "school": "Test University",
             "school_year": "Masters", "majors": "CS"} for p in PEOPLE]
    filled = strategies.enrich_from_roster(people, rows)
    assert filled == len(PEOPLE)
    assert all(c.school == "Test University" for c in people)


# ── extraction ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,expected", [
    ("call (415) 555-0101 anytime", "+14155550101"),
    ("415-555-0102", "+14155550102"),
    ("+1 415 555 0103", "+14155550103"),
    ("415.555.0104", "+14155550104"),
])
def test_finds_phones_in_common_formats(text, expected):
    assert find_phone(text) == expected


@pytest.mark.parametrize("text", [
    "no digits here at all",
    "Boston, MA 02115",              # zip code
    "2023 - 2025",                   # year range
])
def test_returns_none_rather_than_a_wrong_number(text):
    assert find_phone(text) is None


# ── end to end ──────────────────────────────────────────────────────────────

def test_ingest_writes_a_manifest_and_assets(bookmarked, tmp_path):
    manifest = ingest(bookmarked, tmp_path)
    assert len(manifest) == len(PEOPLE)
    assert {m["name"] for m in manifest} == {p["name"] for p in PEOPLE}
    assert sum(len(m["image_keys"]) for m in manifest) == sum(p["pages"] for p in PEOPLE)
    assert len(list(Path(tmp_path).glob("*.webp"))) == sum(p["pages"] for p in PEOPLE)
    assert (Path(tmp_path) / "manifest.json").exists()


def test_ingest_recovers_email_from_resume_text(bookmarked, tmp_path):
    """Bookmarks carry a name but never an email; it has to come from the page."""
    manifest = ingest(bookmarked, tmp_path)
    assert all(m["email"] for m in manifest)
    assert next(m for m in manifest if m["name"] == "Ada Alvarez")["email"] == "ada@example.test"


def test_missing_phone_is_blank_not_wrong(bookmarked, tmp_path):
    manifest = ingest(bookmarked, tmp_path)
    eli = next(m for m in manifest if "Elderberry" in m["name"])
    assert eli["phone"] is None


def test_skip_images_is_fast_and_writes_no_files(bookmarked, tmp_path):
    manifest = ingest(bookmarked, tmp_path, skip_images=True)
    assert len(manifest) == len(PEOPLE)
    assert list(Path(tmp_path).glob("*.webp")) == []
