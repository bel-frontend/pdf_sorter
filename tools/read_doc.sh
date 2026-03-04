#!/bin/bash
# Абалонка для запуску read_document.py з правільным venv
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VENV_PYTHON="$PROJECT_DIR/.venv/bin/python"

if [ ! -f "$VENV_PYTHON" ]; then
    echo "ПАМЫЛКА: venv не знойдзены. Запусціце: python3 -m venv $PROJECT_DIR/.venv && source $PROJECT_DIR/.venv/bin/activate && pip install pdfplumber pytesseract Pillow pdf2image PyMuPDF"
    exit 1
fi

exec "$VENV_PYTHON" "$SCRIPT_DIR/read_document.py" "$@"
