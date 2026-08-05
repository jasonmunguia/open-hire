"""Cut each candidate out of the master PDF and render their pages to images.

Page images rather than embedded PDFs: a PDF in a browser frame drags poorly,
cannot be styled, and puts the browser's own PDF toolbar on top of the UI.
An image is a card you can throw across the screen at 60fps.
"""
import io
import re
from pathlib import Path

import fitz
from PIL import Image

WEBP_QUALITY = 80
DEFAULT_DPI = 132


def slug(name: str, email: str | None, external_id: str | None, index: int) -> str:
    base = (email or name or f"candidate-{index}").lower()
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")
    prefix = re.sub(r"[^a-z0-9]+", "", (external_id or "").lower()) or f"{index:05d}"
    return f"{prefix}-{base}"[:90]


def slice_pdf(doc, start: int, end: int, out_path: Path) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    part = fitz.open()
    part.insert_pdf(doc, from_page=start, to_page=min(end, doc.page_count) - 1)
    part.save(str(out_path))
    part.close()
    return out_path


def render_pages(doc, start: int, end: int, out_dir: Path, stem: str,
                 dpi: int = DEFAULT_DPI) -> list[str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    keys = []
    for offset, page_no in enumerate(range(start, min(end, doc.page_count)), start=1):
        pixmap = doc[page_no].get_pixmap(dpi=dpi)
        image = Image.open(io.BytesIO(pixmap.tobytes("png")))
        key = f"{stem}-p{offset}.webp"
        image.save(out_dir / key, "WEBP", quality=WEBP_QUALITY, method=4)
        keys.append(key)
    return keys
