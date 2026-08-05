"""Turn a stack-of-resumes PDF into per-candidate assets plus a manifest.

    python -m pipeline.ingest --pdf resumes.pdf --out assets
    python -m pipeline.ingest --pdf resumes.pdf --roster roster.xlsx --out assets

Writes assets/<stem>.pdf, assets/<stem>-pN.webp, and assets/manifest.json.
Nothing here touches the network or a database — run it, read the report, and
only then load it. If the report looks wrong, no damage has been done.
"""
import argparse
import json
import sys
from pathlib import Path

import fitz

from pipeline import strategies
from pipeline.extract import find_email, find_phone, resume_text
from pipeline.render import DEFAULT_DPI, render_pages, slice_pdf, slug


def ingest(pdf_path, out_dir, roster_path=None, sheet=None, strategy=None,
           dpi=DEFAULT_DPI, limit=None, skip_images=False):
    pdf_path, out_dir = Path(pdf_path), Path(out_dir)
    if not pdf_path.exists():
        raise SystemExit(f"No such PDF: {pdf_path}")

    doc = fitz.open(pdf_path)
    roster_rows = None
    if roster_path:
        roster_rows = strategies.read_roster_rows(roster_path, sheet)
        print(f"roster: {len(roster_rows)} rows from {Path(roster_path).name}")

    name, people = strategies.choose(doc, roster_rows, strategy)
    print(f"strategy: {name}  ({doc.page_count} pages -> {len(people)} candidates)")

    if roster_rows and name != "roster":
        filled = strategies.enrich_from_roster(people, roster_rows)
        print(f"enriched {filled} candidates with roster metadata")

    if limit:
        people = people[:limit]

    manifest, no_phone = [], 0
    for i, c in enumerate(people):
        if "bad-range" in c.flags or c.pages < 1:
            print(f"  ! skipping {c.name}: bad page range {c.start}-{c.end}")
            continue
        stem = slug(c.name, c.email, c.external_id, i)
        text = resume_text(doc, c.start, c.end)
        email = c.email or find_email(text)
        phone = find_phone(text)
        if not phone:
            no_phone += 1

        image_keys = []
        if not skip_images:
            slice_pdf(doc, c.start, c.end, out_dir / f"{stem}.pdf")
            image_keys = render_pages(doc, c.start, c.end, out_dir, stem, dpi)

        manifest.append({
            "external_id": c.external_id, "name": c.name, "email": email,
            "school": c.school, "school_year": c.school_year, "majors": c.majors,
            "grad_date": c.grad_date, "phone": phone,
            "page_count": c.pages, "pdf_key": f"{stem}.pdf",
            "image_keys": image_keys, "flags": c.flags,
            "sort_key": c.external_id or f"{i:06d}",
        })
        if (i + 1) % 100 == 0:
            print(f"  {i + 1}/{len(people)}", flush=True)

    doc.close()
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1))

    flagged = [m for m in manifest if m["flags"]]
    no_email = [m for m in manifest if not m["email"]]
    print(f"\nwritten {len(manifest)} candidates, "
          f"{sum(len(m['image_keys']) for m in manifest)} page images")
    print(f"missing phone: {no_phone} | missing email: {len(no_email)}")
    print(f"flagged for review: {len(flagged)}")
    for m in flagged[:20]:
        print(f"  {m['name'][:38]:<38} {','.join(m['flags'])}")
    if len(flagged) > 20:
        print(f"  ... and {len(flagged) - 20} more (see manifest.json)")

    if name == "heuristic":
        print("\n!! The PDF had no bookmarks, no roster and no recognised roster table,")
        print("!! so boundaries were GUESSED from page layout. Check assets/manifest.json")
        print("!! before loading. See README 'Label the resumes first'.")
    return manifest


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdf", required=True, help="the PDF holding every resume")
    ap.add_argument("--out", default="assets", help="output directory")
    ap.add_argument("--roster", help="optional .xlsx/.csv of candidate metadata")
    ap.add_argument("--sheet", help="worksheet name, if the roster has several")
    ap.add_argument("--strategy", choices=["bookmarks", "roster", "handshake", "heuristic"],
                    help="override auto-detection")
    ap.add_argument("--dpi", type=int, default=DEFAULT_DPI)
    ap.add_argument("--limit", type=int, help="only the first N, for a smoke test")
    ap.add_argument("--skip-images", action="store_true",
                    help="manifest only; useful to check boundaries fast")
    a = ap.parse_args(argv)
    ingest(a.pdf, a.out, a.roster, a.sheet, a.strategy, a.dpi, a.limit, a.skip_images)
    return 0


if __name__ == "__main__":
    sys.exit(main())
