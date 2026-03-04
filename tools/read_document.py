#!/usr/bin/env python3
"""
Утыліта для чытання PDF і выяў (з OCR).

Выкарыстанне:
    python tools/read_document.py <шлях_да_файла> [опцыі]

Опцыі:
    --mode text       Выцягнуць тэкст з PDF (па змаўчанні для PDF)
    --mode ocr        Распазнаць тэкст праз OCR (па змаўчанні для выяў)
    --mode auto       Аўтаматычна выбраць рэжым (па змаўчанні)
    --lang pol+eng    Мовы OCR (па змаўчанні: pol+eng+rus)
    --pages 1-3       Дыяпазон старонак (толькі для PDF)
    --dpi 300         DPI для рэндэрынгу PDF у выяву (па змаўчанні: 300)
    --output file.txt Захаваць вынік у файл

Прыклады:
    python tools/read_document.py document.pdf
    python tools/read_document.py scan.pdf --mode ocr --lang pol
    python tools/read_document.py photo.jpg
    python tools/read_document.py invoice.png --lang pol+eng
    python tools/read_document.py doc.pdf --pages 1-5
"""

import argparse
import os
import sys
from pathlib import Path


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


def ocr_image(image_path: str, lang: str = "pol+eng+rus") -> str:
    """Распазнаць тэкст з выявы праз Tesseract OCR."""
    import pytesseract
    from PIL import Image

    img = Image.open(image_path)
    text = pytesseract.image_to_string(img, lang=lang)
    return text.strip()


def ocr_pdf(pdf_path: str, lang: str = "pol+eng+rus", dpi: int = 300,
            pages: list[int] | None = None) -> str:
    """Распазнаць тэкст у адсканаваным PDF праз OCR."""
    import pytesseract
    from pdf2image import convert_from_path

    kwargs = {"dpi": dpi}
    if pages is not None:
        # pdf2image выкарыстоўвае 1-based нумарацыю
        kwargs["first_page"] = min(pages) + 1
        kwargs["last_page"] = max(pages) + 1

    images = convert_from_path(pdf_path, **kwargs)

    texts = []
    total = len(images)
    for i, img in enumerate(images):
        page_num = (pages[i] + 1) if pages and i < len(pages) else (i + 1)
        text = pytesseract.image_to_string(img, lang=lang)
        if text.strip():
            texts.append(f"--- Старонка {page_num}/{total} ---\n{text.strip()}")
        else:
            texts.append(f"--- Старонка {page_num}/{total} --- (тэкст не распазнаны)")

    return "\n\n".join(texts)


def has_meaningful_text(pdf_path: str, sample_pages: int = 3) -> bool:
    """Праверыць, ці ёсць у PDF рэальны тэкст (не сканы)."""
    try:
        import fitz
        doc = fitz.open(pdf_path)
        total = min(len(doc), sample_pages)
        char_count = 0
        for i in range(total):
            text = doc[i].get_text()
            char_count += len(text.strip())
        doc.close()
        # Калі менш за 50 сімвалаў на старонку — верагодна скан
        return (char_count / max(total, 1)) > 50
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


def process_file(file_path: str, mode: str = "auto", lang: str = "pol+eng+rus",
                 pages: list[int] | None = None, dpi: int = 300) -> str:
    """Апрацаваць файл і вярнуць тэкст."""
    file_path = os.path.abspath(file_path)

    if not os.path.exists(file_path):
        return f"ПАМЫЛКА: Файл не знойдзены: {file_path}"

    ext = Path(file_path).suffix.lower()
    image_exts = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp", ".gif"}

    # Вызначыць рэжым
    if mode == "auto":
        mode = detect_mode(file_path)
        print(f"[Аўта-рэжым: {mode}]", file=sys.stderr)

    # Апрацоўка
    if ext in image_exts:
        return ocr_image(file_path, lang=lang)
    elif ext == ".pdf":
        if mode == "ocr":
            return ocr_pdf(file_path, lang=lang, dpi=dpi, pages=pages)
        else:
            # Спачатку пробуем PyMuPDF, потым pdfplumber
            try:
                text = extract_text_pymupdf(file_path, pages=pages)
                if text and "тэкст не знойдзены" not in text:
                    return text
            except Exception:
                pass
            try:
                return extract_text_pdfplumber(file_path, pages=pages)
            except Exception as e:
                return f"ПАМЫЛКА пры чытанні PDF: {e}"
    else:
        # Паспрабаваць прачытаць як тэкст
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            return f"ПАМЫЛКА: Не атрымалася прачытаць файл: {file_path}"


def main():
    parser = argparse.ArgumentParser(
        description="Чытанне PDF і выяў з OCR",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("file", help="Шлях да файла (PDF, JPG, PNG, ...)")
    parser.add_argument("--mode", choices=["text", "ocr", "auto"], default="auto",
                        help="Рэжым: text (тэкст з PDF), ocr (распазнаванне), auto (аўта)")
    parser.add_argument("--lang", default="pol+eng+rus",
                        help="Мовы OCR (па змаўчанні: pol+eng+rus)")
    parser.add_argument("--pages", default=None,
                        help="Дыяпазон старонак, напр. 1-3,5,7-9")
    parser.add_argument("--dpi", type=int, default=300,
                        help="DPI для рэндэрынгу PDF (па змаўчанні: 300)")
    parser.add_argument("--output", "-o", default=None,
                        help="Захаваць вынік у файл")

    args = parser.parse_args()

    pages = parse_pages(args.pages) if args.pages else None

    result = process_file(
        file_path=args.file,
        mode=args.mode,
        lang=args.lang,
        pages=pages,
        dpi=args.dpi,
    )

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(result)
        print(f"Вынік захаваны ў: {args.output}", file=sys.stderr)
    else:
        print(result)


if __name__ == "__main__":
    main()
