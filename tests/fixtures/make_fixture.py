"""Build a synthetic resume-stack PDF. No real applicant data, ever.

Used by the test suite so the pipeline can be verified on a machine that has
never seen a real resume.
"""
import fitz

PEOPLE = [
    dict(name="Ada Alvarez", email="ada@example.test", phone="(415) 555-0101", pages=1),
    dict(name="Bo Brennan", email="bo@example.test", phone="415-555-0102", pages=2),
    dict(name="Cyd Castro", email="cyd@example.test", phone="+1 415 555 0103", pages=1),
    dict(name="Dev Dhillon", email="dev@example.test", phone="415.555.0104", pages=1),
    dict(name="Eli Elderberry", email="eli@example.test", phone="", pages=1),
]


def build(path, people=PEOPLE, bookmarks=True):
    doc = fitz.open()
    toc, page_no = [], 1
    for i, p in enumerate(people, start=1):
        for page_index in range(p["pages"]):
            page = doc.new_page(width=612, height=792)
            if page_index == 0:
                page.insert_text((60, 80), p["name"], fontsize=18)
                page.insert_text((60, 104),
                                 f"{p['email']} | {p['phone']} | San Jose, CA",
                                 fontsize=10)
                page.insert_text((60, 150), "EXPERIENCE", fontsize=12)
                page.insert_text((60, 172), "Built things. Shipped them.", fontsize=9)
            else:
                page.insert_text((60, 80), f"{p['name']} - page {page_index + 1}",
                                 fontsize=11)
                page.insert_text((60, 110), "Additional projects.", fontsize=9)
        if bookmarks:
            toc.append([1, f"AG #{i:04d} - {p['name']}", page_no])
        page_no += p["pages"]
    if bookmarks:
        doc.set_toc(toc)
    doc.save(str(path))
    doc.close()
    return path


if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "fixture.pdf"
    build(out)
    print(f"wrote {out}")
