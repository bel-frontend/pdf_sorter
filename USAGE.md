[Belarusian version / Беларуская версія](USAGE.be.md)

# File Rename Agent -- Documentation

A tool for intelligent renaming and organization of PDF files, document photos, and other files using AI (LLM).

The agent reads the content of each file (text or OCR), sends it to a language model, and receives a suggested new name in the format `<category>_<subject>_<date>.pdf`.

---

## Table of Contents

1. [Requirements](#requirements)
2. [Installation and Setup](#installation-and-setup)
3. [Configuration (.env)](#configuration-env)
4. [Running the Renamer](#running-the-renamer)
5. [Running with Different Folders](#running-with-different-folders)
6. [Sorting Files by Category](#sorting-files-by-category)
7. [Reading Documents (OCR)](#reading-documents-ocr)
8. [All Command-Line Parameters](#all-command-line-parameters)
9. [Naming Rules](#naming-rules)
10. [Output Files](#output-files)
11. [Ignore List and Resuming Work](#ignore-list-and-resuming-work)
12. [Usage Examples](#usage-examples)
13. [Questions and Troubleshooting](#questions-and-troubleshooting)

---

## Requirements

### System Dependencies

| Dependency | Purpose | Installation (macOS) |
|---|---|---|
| **Node.js** (>=18) | Main agent runtime | `brew install node` |
| **Python 3.10+** | OCR and PDF reading | `brew install python` |
| **Tesseract OCR** | Text recognition from images | `brew install tesseract` |
| **Poppler** | Converting PDF to images for OCR | `brew install poppler` |

### Tesseract Language Packs

For working with English, Polish, and Russian documents:

```bash
brew install tesseract-lang
```

### API Keys (at least one)

- **OpenAI** -- key from https://platform.openai.com
- **Google Gemini** -- key from https://aistudio.google.com
- **Ollama** -- local model, no key required

---

## Installation and Setup

### Quick Start (3 steps)

```bash
git clone <repository-url>
cd file_rename
./setup.sh
```

The `setup.sh` script automatically:
1. Creates a Python venv and installs all pip dependencies
2. Installs Node.js dependencies
3. Creates `.env` from a template and sets the correct `READER_PYTHON`

After that, add your API key:

```bash
nano tools/rename-agent/.env
```

Done. You can now run:

```bash
npm run apply -- --dry-run --target-dir ~/Desktop/documents
```

### Manual Installation (step by step)

If you want to do everything yourself:

**1. Clone:**

```bash
git clone <repository-url>
cd file_rename
```

**2. Python venv (for OCR):**

```bash
python3 -m venv .venv
.venv/bin/pip install pdfplumber pytesseract Pillow pdf2image PyMuPDF
```

Activation (`source .venv/bin/activate`) is **not required** -- all commands use the path to the venv Python directly.

**3. Node.js dependencies:**

```bash
cd tools/rename-agent
npm install
cd ../..
```

**4. Configuration:**

```bash
cp tools/rename-agent/.env.example tools/rename-agent/.env
```

Edit `.env` -- add your API key and set the absolute path to the venv Python in `READER_PYTHON`.

**5. Verification:**

```bash
.venv/bin/python tools/read_document.py --help
npm run apply -- --dry-run --limit 1 --target-dir ~/Desktop
```

---

## Configuration (.env)

File: `tools/rename-agent/.env`

```env
# --- LLM Provider ---
LLM_PROVIDER=openai          # openai | ollama | google | auto

# --- OpenAI ---
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini    # or gpt-5-mini, gpt-4o, etc.

# --- Ollama (local model) ---
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gpt-oss:20b

# --- Google Gemini ---
GOOGLE_GEMINI_API_KEY=...
GOOGLE_MODEL=gemini-2.5-pro

# --- General Settings ---
TARGET_DIR=                   # empty = must pass --target-dir
DRY_RUN=true                 # true = preview only, false = actual renaming
IGNORE_LIST_PATH=             # empty = automatically in TARGET_DIR
UPDATE_IGNORE_LIST=true

# --- Naming Language ---
NAMING_LANG=en                # en | pl | be | ru

# --- OCR ---
READER_PYTHON=               # setup.sh fills this automatically
OCR_LANG=pol+eng+rus          # Tesseract languages
```

`setup.sh` automatically sets `READER_PYTHON` when creating `.env`. If you installed manually, set the absolute path to `.venv/bin/python` in your project.

---

## Running the Renamer

All commands are run from the project root.

### Basic Command

```bash
# Preview -- what will be renamed (no changes made)
npm run apply -- --dry-run --target-dir ~/Desktop/documents

# Actual renaming
npm run apply -- --target-dir ~/Desktop/documents
```

Note: `npm run apply` already includes the `--apply` flag, so files will be renamed. Add `--dry-run` to only see the plan.

### Choosing an LLM Provider

```bash
# OpenAI (default)
npm run apply -- --target-dir ~/docs --provider openai --model gpt-4.1-mini

# Google Gemini
npm run apply -- --target-dir ~/docs --provider google --model gemini-2.5-pro

# Local Ollama model (offline)
npm run apply -- --target-dir ~/docs --provider ollama --model gpt-oss:20b
```

### Naming Language

By default, names are generated in English. You can change this with `--lang`:

```bash
# English (default, no flag needed)
npm run apply -- --target-dir ~/docs

# Polish
npm run apply -- --target-dir ~/docs --lang pl

# Belarusian (transliteration)
npm run apply -- --target-dir ~/docs --lang be

# Russian (transliteration)
npm run apply -- --target-dir ~/docs --lang ru
```

Or set it in `.env` so you do not have to pass it every time:

```env
NAMING_LANG=en
```

### Limiting the Number of Files

```bash
# Process only the first 10 files (good for testing)
npm run apply -- --target-dir ~/docs --limit 10
```

### Filtering by File Type

Quick commands for specific types:

```bash
# PDF only
npm run apply:pdf -- --target-dir ~/docs

# Photos only (jpg, png, tiff, bmp, webp, gif)
npm run apply:photos -- --target-dir ~/docs

# Word/XML documents only (doc, docx, xml)
npm run apply:docs -- --target-dir ~/docs
```

Or via the `--include` parameter with a preset or custom glob:

```bash
# Preset
npm run apply -- --target-dir ~/docs --include pdf
npm run apply -- --target-dir ~/docs --include photos

# Multiple presets together
npm run apply -- --target-dir ~/docs --include pdf,photos

# Custom glob
npm run apply -- --target-dir ~/docs --include "**/*.{pdf,png}"
```

Available presets:

| Preset | Formats |
|---|---|
| `all` | pdf, jpg, jpeg, png, tiff, tif, bmp, webp, gif, doc, docx, xml (default) |
| `pdf` | pdf |
| `photos` | jpg, jpeg, png, tiff, tif, bmp, webp, gif |
| `docs` | doc, docx, xml |

---

## Running with Different Folders

### The `--target-dir` Parameter

Pass the path to any folder:

```bash
npm run apply -- --target-dir ~/Desktop/scans
npm run apply -- --target-dir ~/Documents/invoices
npm run apply -- --target-dir /Volumes/USB/documents
```

### Setting `TARGET_DIR` in `.env`

Edit `tools/rename-agent/.env`:

```env
TARGET_DIR=~/Documents/my-docs
```

Then simply run:

```bash
npm run apply
```

### Shell Alias (for frequent use)

Add to `~/.zshrc` or `~/.bashrc`:

```bash
alias rename-docs='npm --prefix /path/to/project/tools/rename-agent run apply --'
```

After that, from any directory:

```bash
rename-docs --target-dir ~/Desktop/scans
rename-docs --target-dir ~/docs --dry-run --limit 5
```

---

## Sorting Files by Category

After renaming, you can automatically sort files into category folders.

### Categories

| Folder | Document Types |
|---|---|
| `real_estate` | Real estate documents |
| `telecom` | Telecom bills, phone contracts |
| `business_plans` | Business plans |
| `business_registration` | Business registration documents |
| `reports` | Reports |
| `confirmations` | Confirmations, receipts |
| `bank_statements` | Bank statements, account extracts |
| `surveys` | Surveys, questionnaires |
| `invoices` | Invoices, bills |
| `contracts` | Contracts, agreements |
| `applications_and_decisions` | Applications, decisions, permits, residence |
| `powers_of_attorney` | Powers of attorney |
| `certificates` | Certificates, attestations |
| `taxes_and_social` | Tax returns, social insurance, VAT |
| `identity_documents` | Passports, ID cards |
| `photos_of_people` | Photos of people (not documents) -- only in `--smart` mode |
| `scans_and_photos` | Scans, document photos |
| `other` | Everything else |

### Standard Sorting (by file name)

```bash
# Preview sorting plan (no files moved)
npm run organize -- --target-dir ~/Desktop/documents --dry-run

# Execute sorting
npm run organize -- --target-dir ~/Desktop/documents --apply
```

### Smart Sorting (with content analysis)

The `--smart` mode reads the content of each file (text or OCR) and asks the LLM which category it belongs to. This allows:
- Correctly classifying scans and document photos by their content
- Distinguishing photos of people from photos of documents
- Accurately determining the type even when the file name is uninformative (e.g. `IMG_001.jpg`)

```bash
# Preview (no files moved)
npm run organize:smart -- --target-dir ~/Desktop/documents --dry-run

# Execute sorting
npm run organize:smart -- --target-dir ~/Desktop/documents --apply

# With a specific provider
npm run organize:smart -- --target-dir ~/docs --apply --provider openai --model gpt-4.1-mini
```

### Additional organize Parameters

```bash
# Set a different output folder name
npm run organize -- --target-dir ~/docs --apply --out-dir my_sorted_docs

# Limit the number of files
npm run organize -- --target-dir ~/docs --dry-run --limit 50
```

The result is a structure like:

```
sorted_documents/
├── invoices/
│   ├── invoice_orange_2024-03.pdf
│   └── invoice_electric_company_2024-05.pdf
├── taxes_and_social/
│   ├── tax_return_2023.pdf
│   └── social_insurance_2024-01.pdf
├── contracts/
│   └── lease_agreement_apartment_2024-02.pdf
└── other/
    └── unreadable_scan.jpg
```

---

## Reading Documents (OCR)

The utility `tools/read_document.py` is used by the agent automatically, but you can also use it directly.

### Running

```bash
# Read a PDF with text
.venv/bin/python tools/read_document.py document.pdf

# Recognize a scan (OCR)
.venv/bin/python tools/read_document.py scan.jpg

# Force OCR for a PDF
.venv/bin/python tools/read_document.py document.pdf --mode ocr

# Set OCR languages
.venv/bin/python tools/read_document.py scan.png --lang pol+eng

# Select specific pages
.venv/bin/python tools/read_document.py big.pdf --pages 1-3,5

# Save result to a file
.venv/bin/python tools/read_document.py scan.pdf --output result.txt
```

Alternatively, use the wrapper `tools/read_doc.sh`, which finds the venv automatically:

```bash
./tools/read_doc.sh document.pdf
./tools/read_doc.sh scan.jpg --mode ocr --lang pol+eng
```

### Operating Modes

| Mode | Description |
|---|---|
| `auto` | Automatic: if the PDF contains text, extracts it; otherwise uses OCR. For images, always uses OCR |
| `text` | Text extraction from PDF only (no OCR) |
| `ocr` | Forced recognition via Tesseract |

### Supported Formats

PDF, JPG/JPEG, PNG, TIFF/TIF, BMP, WebP, GIF, DOC, DOCX, XML

---

## All Command-Line Parameters

### `npm run apply` (renaming)

| Parameter | Description | Default |
|---|---|---|
| `--target-dir <path>` | Folder with files to process | from `.env` |
| `--dry-run` | Preview only, no renaming | |
| `--apply` | Execute renaming | |
| `--provider <name>` | LLM provider: `openai`, `ollama`, `google`, `auto` | `openai` |
| `--model <name>` | LLM model | `gpt-4.1-mini` |
| `--ollama-base-url <url>` | Ollama server URL | `http://localhost:11434` |
| `--include <preset\|glob>` | File type filter: `pdf`, `photos`, `docs`, `all`, or glob | `all` |
| `--lang <code>` | Naming language: `en`, `pl`, `be`, `ru` | `en` |
| `--limit <N>` | Process only the first N files | `0` (all) |
| `--ignore-list <path>` | Path to the ignore list | `<TARGET_DIR>/.rename-agent-ignore.txt` |
| `--no-update-ignore-list` | Do not update the ignore list | update |

### `npm run organize` (sorting)

| Parameter | Description | Default |
|---|---|---|
| `--target-dir <path>` | Folder with files | from `.env` |
| `--dry-run` | Preview only | |
| `--apply` | Execute file moves | |
| `--out-dir <name>` | Output folder name for sorting | `sorted_documents` |
| `--smart` | Smart sorting: content analysis via LLM | disabled |
| `--provider <name>` | LLM provider (for `--smart`) | `openai` |
| `--model <name>` | LLM model (for `--smart`) | `gpt-4.1-mini` |
| `--limit <N>` | Limit the number of files | `0` (all) |

### `.venv/bin/python tools/read_document.py` (reading)

| Parameter | Description | Default |
|---|---|---|
| `file` | Path to the file | (required) |
| `--mode` | `text`, `ocr`, `auto` | `auto` |
| `--lang` | OCR languages | `pol+eng+rus` |
| `--pages` | Page range (e.g. `1-3,5`) | all |
| `--dpi` | DPI for rendering | `300` |
| `--output` / `-o` | Save to file | stdout |

---

## Naming Rules

The agent generates names according to rules from the file `tools/rename-agent/rules.prompt.txt`:

- Language: **English**, Latin alphabet
- Format: `<category>_<subject>_<date>` in **snake_case**
- Example categories: `invoice`, `tax_return`, `bank_statement`, `contract`, `certificate`, `residence_permit`, `passport`, `application`, `scan`, `report`
- Date (if known): `YYYY-MM` or `YYYY-MM-DD`
- If the document contains a person (passport, permit) -- the surname is added to the name
- Unreadable scans: `unreadable_scan`
- The file extension is not changed

### Renaming Examples

| Before | After |
|---|---|
| `IMG_20240315_001.jpg` | `invoice_orange_2024-03.jpg` |
| `scan0042.pdf` | `certificate_social_insurance_smith_2024-01.pdf` |
| `Document (3).pdf` | `lease_agreement_apartment_2024-02.pdf` |
| `photo_2024.png` | `residence_permit_card_ivanov_2024-05.png` |
| `file.pdf` (unreadable) | `unreadable_scan.pdf` |

---

## Output Files

After running, the agent creates files in `tools/rename-agent/outputs/`:

| File | Description |
|---|---|
| `rename-plan.json` | Full renaming plan with metadata |
| `rename-plan.csv` | CSV version of the plan (for Excel / Google Sheets) |
| `pending-files.txt` | List of files awaiting processing |
| `organize-plan.json` | Sorting plan by folders |
| `organize-plan.csv` | CSV version of the sorting plan |

Additionally, in the target folder:

- **`DOCUMENT_CATALOG.md`** -- automatically updated catalog of all files
- **`.rename-agent-ignore.txt`** -- list of already processed files

---

## Ignore List and Resuming Work

The agent records every processed file in `.rename-agent-ignore.txt`. This means:

1. **You can safely stop and resume** -- on the next run, the agent will skip already processed files
2. **New files are picked up automatically** -- just run the agent again
3. **To reprocess everything** -- delete `.rename-agent-ignore.txt` from the target folder

```bash
# Resume from where you left off
npm run apply -- --target-dir ~/docs

# Force reprocessing of all files
rm ~/docs/.rename-agent-ignore.txt
npm run apply -- --target-dir ~/docs

# Do not update the ignore list (one-time run)
npm run apply -- --target-dir ~/docs --no-update-ignore-list
```

---

## Usage Examples

### Example 1: First Run -- Preview

Always start by looking at what the agent suggests:

```bash
npm run apply -- --dry-run --target-dir ~/Desktop/documents
```

The output will show the suggested name, type, date, and confidence level for each file. No actual files will be changed.

### Example 2: Rename All Documents

```bash
npm run apply -- --target-dir ~/Desktop/documents
```

### Example 3: Test on a Small Sample

```bash
npm run apply -- --target-dir ~/Desktop/documents --limit 5 --dry-run
```

### Example 4: Using a Local Model (offline)

```bash
# First, start Ollama:
ollama serve

# Then:
npm run apply -- --target-dir ~/docs --provider ollama --model llama3.3
```

### Example 5: Full Cycle -- Rename + Sort

```bash
# Step 1: Rename
npm run apply -- --target-dir ~/Desktop/my-docs

# Step 2: Preview the sorting plan
npm run organize -- --target-dir ~/Desktop/my-docs --dry-run

# Step 3: Sort
npm run organize -- --target-dir ~/Desktop/my-docs --apply
```

### Example 6: Processing an External Drive

```bash
npm run apply -- --target-dir /Volumes/MyUSB/scans --provider openai --model gpt-4.1-mini
```

### Example 7: Read a Single Document Manually

```bash
.venv/bin/python tools/read_document.py ~/Desktop/scan.pdf

# Or via the wrapper (it finds the venv automatically):
./tools/read_doc.sh ~/Desktop/scan.pdf
```

### Example 8: Repeated Processing of New Files

```bash
# First run -- processes all files
npm run apply -- --target-dir ~/docs

# Later, new files are added to ~/docs -- run again
# The agent will process only the new ones (thanks to the ignore list)
npm run apply -- --target-dir ~/docs
```

---

## Questions and Troubleshooting

### "unreadable_scan" appears for many files

OCR could not recognize the text. Possible causes:
- Tesseract is not installed or is missing the required language packs
- Low quality scans
- The document is in a language not included in `OCR_LANG`

Solution: run `brew install tesseract-lang` and check `OCR_LANG` in `.env`.

### The agent does not see the files

Check that:
- `--target-dir` points to the correct folder
- Files have a supported extension (pdf, jpg, png, tiff, doc, docx, xml)
- Files are not listed in `.rename-agent-ignore.txt`

### LLM provider error

- **OpenAI**: check `OPENAI_API_KEY` in `.env`
- **Ollama**: make sure `ollama serve` is running
- **Google**: check `GOOGLE_GEMINI_API_KEY`

### Python not found

The agent looks for Python in the following order:

1. `READER_PYTHON` from `.env` (`setup.sh` sets this automatically)
2. `.venv/bin/python` in the project root (found automatically)
3. System `python3` (fallback, may not have the required libraries)

To verify that the venv works:

```bash
.venv/bin/python -c "import pdfplumber, pytesseract, fitz; print('OK')"
```

If something is not installed, add it:

```bash
.venv/bin/pip install pdfplumber pytesseract Pillow pdf2image PyMuPDF
```
