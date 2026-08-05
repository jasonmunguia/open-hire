"""Pull plain text and a contact phone number out of a page range.

The phone pattern is deliberately strict. A missing phone must read as blank,
never as a wrong number — an assistant calling the wrong person is worse than
an assistant having to look one up.
"""
import re

PHONE_RE = re.compile(
    r"(?:\+?1[\s.\-]?)?"        # optional country code
    r"\(?([2-9]\d{2})\)?"       # area code, never starts 0 or 1
    r"[\s.\-]?\s?([2-9]\d{2})"  # exchange
    r"[\s.\-]\s?(\d{4})"        # line number; a separator is required, which
)                               # stops zip codes and year ranges matching


def resume_text(doc, start: int, end: int) -> str:
    return "".join(doc[i].get_text() for i in range(start, min(end, doc.page_count)))


def find_phone(text: str) -> str | None:
    m = PHONE_RE.search(text)
    return "+1" + "".join(m.groups()) if m else None


EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")


def find_email(text: str) -> str | None:
    m = EMAIL_RE.search(text)
    return m.group(0).lower() if m else None
