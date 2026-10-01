#!/usr/bin/env python3
"""
Утыліта для чытання PDF і выяў (з OCR).

Выкарыстанне:
    python tools/read_document.py <шлях_да_файла> [опцыі]

Опцыі:
    --mode text       Выцягнуць тэкст з PDF (па змаўчанні для PDF)
    --mode ocr        Распазнаць тэкст праз OCR (па змаўчанні для выяў)
    --mode auto       Аўтаматычна выбраць рэжым (па змаўчанні)
    --lang en,ru      Мовы OCR (па змаўчанні: en,ru,be,uk,pl)
    --pages 1-3       Дыяпазон старонак (толькі для PDF)
    --dpi 300         DPI для рэндэрынгу PDF у выяву (па змаўчанні: 300)
    --output file.txt Захаваць вынік у файл

Прыклады:
    python tools/read_document.py document.pdf
    python tools/read_document.py scan.pdf --mode ocr --lang ru,en
    python tools/read_document.py photo.jpg
    python tools/read_document.py invoice.png --lang pl,en
    python tools/read_document.py doc.pdf --pages 1-5

OCR engine: EasyOCR (pure pip, no system dependencies).
"""

import argparse
import importlib.util
import os
import sys
import warnings
from pathlib import Path

# Suppress noisy PyTorch MPS pin_memory warning on Apple Silicon
warnings.filterwarnings("ignore", message=".*pin_memory.*")

# EasyOCR language codes (different from Tesseract)
# EasyOCR: Cyrillic langs are only compatible with English.
# Polish uses Latin script — covered by "en" recognition.
DEFAULT_OCR_LANGS = ["en", "ru", "be", "uk"]

# EasyOCR: cyrillic languages can only be combined with English.
# Languages using Latin script (pl, fr, de, es, etc.) cannot mix with cyrillic.
CYRILLIC_LANGS = {"ru", "rs_cyrillic", "be", "bg", "uk", "mn"}

# Cached EasyOCR readers keyed by frozenset of langs
_ocr_readers: dict[frozenset, object] = {}


def _split_lang_groups(langs: list[str]) -> list[list[str]]:
    """Split languages into EasyOCR-compatible groups.

    Cyrillic langs can only be combined with 'en'.
    Latin-script langs (pl, fr, de, ...) go into a separate group with 'en'.
    """
    cyrillic = [l for l in langs if l in CYRILLIC_LANGS]
    latin = [l for l in langs if l not in CYRILLIC_LANGS and l != "en"]
    groups = []
    if cyrillic:
        groups.append(["en"] + cyrillic if "en" not in cyrillic else cyrillic)
    if latin:
        groups.append(["en"] + latin if "en" not in latin else latin)
    if not groups:
        groups.append(["en"])
    return groups


def _get_ocr_reader(langs: list[str]):
    """Get or create a cached EasyOCR reader instance for the given langs."""
    import easyocr

    key = frozenset(langs)
    if key not in _ocr_readers:
        _ocr_readers[key] = easyocr.Reader(langs, gpu=False, verbose=False)
    return _ocr_readers[key]


def extract_text_pdfplumber(pdf_path: str, pages: list[int] | None = None) -> str:
    """Выцягнуць тэкст з PDF праз pdfplumber."""
    import pdfplumber

    texts = []
    with pdfplumber.open(pdf_path) as pdf:
        total = len(pdf.pages)
        target_pages = pages if pages else range(total)
        for i in target_pages:
            if i >= total:
                continue
            page = pdf.pages[i]
            text = page.extract_text()
            if text:
                texts.append(f"--- Старонка {i + 1}/{total} ---\n{text}")
            else:
                texts.append(f"--- Старонка {i + 1}/{total} --- (тэкст не знойдзены)")

    return "\n\n".join(texts)


def extract_text_pymupdf(pdf_path: str, pages: list[int] | None = None) -> str:
    """Выцягнуць тэкст з PDF праз PyMuPDF (fitz)."""
    import fitz  # PyMuPDF

    texts = []
    doc = fitz.open(pdf_path)
    total = len(doc)
    target_pages = pages if pages else range(total)
    for i in target_pages:
        if i >= total:
            continue
        page = doc[i]
        text = page.get_text()
        if text.strip():
            texts.append(f"--- Старонка {i + 1}/{total} ---\n{text}")
        else:
            texts.append(f"--- Старонка {i + 1}/{total} --- (тэкст не знойдзены)")
    doc.close()

    return "\n\n".join(texts)


def ocr_image(image_path: str, langs: list[str] | None = None) -> str:
    """Распазнаць тэкст з выявы праз EasyOCR.

    If langs mix cyrillic and latin-script languages, runs multiple passes
    and merges results (EasyOCR doesn't allow mixing them).
    """
    if langs is None:
        langs = DEFAULT_OCR_LANGS
    # Read file to bytes to avoid OpenCV imread bugs with Unicode paths on Windows
    with open(image_path, "rb") as f:
        img_bytes = f.read()

    groups = _split_lang_groups(langs)
    all_lines: list[str] = []
    for group in groups:
        reader = _get_ocr_reader(group)
        result = reader.readtext(img_bytes)
        lines = [text for (_, text, _) in result]
        all_lines.extend(lines)

    return "\n".join(all_lines).strip()


def _render_pdf_page_to_png(doc, page_index: int, dpi: int = 300) -> bytes | None:
    """Render a single PDF page to PNG bytes using PyMuPDF.

    Returns None if the page cannot be rendered (e.g. corrupt dimensions).
    """
    page = doc[page_index]
    try:
        pix = page.get_pixmap(dpi=dpi)
        return pix.tobytes("png")
    except Exception:
        # Some pages have invalid dimensions at high DPI — try lower
        try:
            pix = page.get_pixmap(dpi=150)
            return pix.tobytes("png")
        except Exception:
            return None


def ocr_pdf(
    pdf_path: str,
    langs: list[str] | None = None,
    dpi: int = 300,
    pages: list[int] | None = None,
) -> str:
    """Распазнаць тэкст у адсканаваным PDF праз EasyOCR + PyMuPDF rendering."""
    import fitz

    if langs is None:
        langs = DEFAULT_OCR_LANGS
    groups = _split_lang_groups(langs)
    doc = fitz.open(pdf_path)
    total = len(doc)
    target_pages = pages if pages else list(range(total))

    texts = []
    for i in target_pages:
        if i >= total:
            continue
        page_num = i + 1
        img_bytes = _render_pdf_page_to_png(doc, i, dpi=dpi)
        if img_bytes is None:
            texts.append(
                f"--- Старонка {page_num}/{total} --- (не ўдалося адрэндэрыць)"
            )
            continue
        page_lines: list[str] = []
        for group in groups:
            reader = _get_ocr_reader(group)
            result = reader.readtext(img_bytes)
            page_lines.extend(text for (_, text, _) in result)
        page_text = "\n".join(page_lines).strip()
        if page_text:
            texts.append(f"--- Старонка {page_num}/{total} ---\n{page_text}")
        else:
            texts.append(f"--- Старонка {page_num}/{total} --- (тэкст не распазнаны)")

    doc.close()
    return "\n\n".join(texts)


def has_meaningful_text(pdf_path: str, sample_pages: int = 3) -> bool:
    """Праверыць, ці ёсць у PDF рэальны тэкст (не сканы)."""
    try:
        import re

        import fitz

        doc = fitz.open(pdf_path)
        total = min(len(doc), sample_pages)
        total_words = 0
        total_short_lines = 0
        total_lines = 0
        for i in range(total):
            text = doc[i].get_text()
            words = re.findall(r"[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻа-яА-ЯёЁіІўЎ]{4,}", text)
            total_words += len(words)
            lines = [ln for ln in text.split("\n") if ln.strip()]
            total_lines += len(lines)
            total_short_lines += sum(1 for ln in lines if len(ln.strip()) <= 2)
        doc.close()

        words_per_page = total_words / max(total, 1)
        if total_lines > 0 and total_short_lines / total_lines > 0.4:
            return False
        return words_per_page >= 3
    except Exception:
        return False


def detect_mode(file_path: str) -> str:
    """Аўтаматычна вызначыць рэжым: text ці ocr."""
    ext = Path(file_path).suffix.lower()
    image_exts = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp", ".gif"}

    if ext in image_exts:
        return "ocr"
    elif ext == ".pdf":
        if has_meaningful_text(file_path):
            return "text"
        else:
            return "ocr"
    else:
        return "text"


def parse_pages(pages_str: str) -> list[int]:
    """Разабраць радок з дыяпазонам старонак: '1-3,5,7-9' -> [0,1,2,4,6,7,8]."""
    pages = []
    for part in pages_str.split(","):
        part = part.strip()
        if "-" in part:
            start, end = part.split("-", 1)
            pages.extend(range(int(start) - 1, int(end)))
        else:
            pages.append(int(part) - 1)
    return sorted(set(pages))


def _parse_langs(lang_str: str) -> list[str]:
    """Parse language string into list. Supports both comma and + separators."""
    # Support both "en,ru,be" and legacy "pol+eng+rus" formats
    LEGACY_MAP = {
        "pol": "pl",
        "eng": "en",
        "rus": "ru",
        "bel": "be",
        "ukr": "uk",
    }
    sep = "+" if "+" in lang_str else ","
    langs = [l.strip() for l in lang_str.split(sep) if l.strip()]
    return [LEGACY_MAP.get(l, l) for l in langs]


def _get_pdf_page_count(pdf_path: str) -> int:
    """Get total page count of a PDF."""
    try:
        import fitz

        doc = fitz.open(pdf_path)
        count = len(doc)
        doc.close()
        return count
    except Exception:
        return 0


def _smart_page_selection(total_pages: int, max_pages: int = 5) -> list[int] | None:
    """Select pages to read for content identification.

    For short PDFs (≤ max_pages) — read all (return None).
    For longer PDFs — read first 3 + middle + last page.
    """
    if total_pages <= max_pages:
        return None

    pages = [0, 1, 2]
    mid = total_pages // 2
    if mid not in pages:
        pages.append(mid)
    last = total_pages - 1
    if last not in pages:
        pages.append(last)
    return sorted(pages)


def process_file(
    file_path: str,
    mode: str = "auto",
    langs: list[str] | None = None,
    pages: list[int] | None = None,
    dpi: int = 300,
    smart_pages: bool = False,
) -> str:
    """Апрацаваць файл і вярнуць тэкст."""
    file_path = os.path.abspath(file_path)

    if not os.path.exists(file_path):
        return f"ПАМЫЛКА: Файл не знойдзены: {file_path}"

    ext = Path(file_path).suffix.lower()
    image_exts = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp", ".gif"}

    if ext == ".pdf" and importlib.util.find_spec("fitz") is None:
        raise RuntimeError(
            "PyMuPDF (fitz) is not installed for this Python interpreter"
        )
    if ext in image_exts and importlib.util.find_spec("easyocr") is None:
        raise RuntimeError(
            "EasyOCR is not installed for this Python interpreter"
        )

    # Smart page selection for PDFs when no explicit pages given
    if ext == ".pdf" and pages is None and smart_pages:
        total = _get_pdf_page_count(file_path)
        if total > 0:
            pages = _smart_page_selection(total)
            if pages is not None:
                print(
                    f"[Smart pages: reading {len(pages)} of {total} pages: {[p + 1 for p in pages]}]",
                    file=sys.stderr,
                )

    # Вызначыць рэжым
    if mode == "auto":
        mode = detect_mode(file_path)
        print(f"[Аўта-рэжым: {mode}]", file=sys.stderr)

    # Апрацоўка
    if ext in image_exts:
        return ocr_image(file_path, langs=langs)
    elif ext == ".pdf":
        if mode == "ocr":
            try:
                return ocr_pdf(file_path, langs=langs, dpi=dpi, pages=pages)
            except Exception as e:
                print(f"[OCR failed: {e}]", file=sys.stderr)
                try:
                    text = extract_text_pymupdf(file_path, pages=pages)
                    if text and "тэкст не знойдзены" not in text:
                        return text
                except Exception:
                    pass
                return f"[UNREADABLE: OCR and text extraction both failed for {Path(file_path).name}]"
        else:
            # Спачатку пробуем PyMuPDF, потым pdfplumber
            try:
                text = extract_text_pymupdf(file_path, pages=pages)
                if text and "тэкст не знойдзены" not in text:
                    return text
            except Exception:
                pass
            try:
                text = extract_text_pdfplumber(file_path, pages=pages)
                if text and "тэкст не знойдзены" not in text:
                    return text
            except Exception:
                pass
            # Text extraction returned nothing useful — fall back to OCR
            print("[Text extraction empty, falling back to OCR]", file=sys.stderr)
            try:
                return ocr_pdf(file_path, langs=langs, dpi=dpi, pages=pages)
            except Exception as e:
                return f"[UNREADABLE: all extraction methods failed for {Path(file_path).name}]"
    else:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            return f"ПАМЫЛКА: Не атрымалася прачытаць файл: {file_path}"


def main():
    # Fix for Windows console encoding issues (UnicodeEncodeError)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")

    parser = argparse.ArgumentParser(
        description="Чытанне PDF і выяў з OCR (EasyOCR)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("file", help="Шлях да файла (PDF, JPG, PNG, ...)")
    parser.add_argument(
        "--mode",
        choices=["text", "ocr", "auto"],
        default="auto",
        help="Рэжым: text (тэкст з PDF), ocr (распазнаванне), auto (аўта)",
    )
    parser.add_argument(
        "--lang",
        default="en,ru,be,uk",
        help="Мовы OCR (па змаўчанні: en,ru,be,uk). Коды EasyOCR або legacy Tesseract.",
    )
    parser.add_argument(
        "--pages", default=None, help="Дыяпазон старонак, напр. 1-3,5,7-9"
    )
    parser.add_argument(
        "--dpi",
        type=int,
        default=300,
        help="DPI для рэндэрынгу PDF (па змаўчанні: 300)",
    )
    parser.add_argument("--output", "-o", default=None, help="Захаваць вынік у файл")
    parser.add_argument(
        "--smart-pages",
        action="store_true",
        default=False,
        help="Аўтаматычна выбіраць старонкі для доўгіх PDF",
    )

    args = parser.parse_args()

    pages = parse_pages(args.pages) if args.pages else None
    langs = _parse_langs(args.lang)

    result = process_file(
        file_path=args.file,
        mode=args.mode,
        langs=langs,
        pages=pages,
        dpi=args.dpi,
        smart_pages=args.smart_pages,
    )

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(result)
        print(f"Вынік захаваны ў: {args.output}", file=sys.stderr)
    else:
        print(result)


if __name__ == "__main__":
    main()
