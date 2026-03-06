[English version](README.md)

# File Rename Agent -- Dakumentacyja

Інструмент для асэнсаванага перайменавання і арганізацыі PDF-файлаў, фатаграфій дакументаў і іншых файлаў з дапамогай AI (LLM).

Агент чытае змесціва кожнага файла (тэкст або OCR), адпраўляе яго ў моўную мадэль і атрымлівае прапанову новай назвы ў фармаце `<category>_<topic>_<date>.pdf`.

## Хуткія флагі па рэжымах

Цяпер усе рэжымы выкарыстоўваюць аднолькавыя флагі запуску:
- `--dry-run` для прагляду (па змаўчанні)
- `--apply` для рэальных змен

| Рэжым | Каманда | Тыповыя дадатковыя флагі |
|---|---|---|
| rename all | `npm run apply -- ...` | `--include`, `--lang`, `--model`, `--limit` |
| rename па тыпе | `npm run apply:pdf -- ...`, `npm run apply:photos -- ...`, `npm run apply:docs -- ...` | `--model`, `--limit` |
| organize | `npm run organize -- ...` | `--out-dir`, `--limit` |
| organize smart | `npm run organize:smart -- ...` | `--model`, `--out-dir`, `--limit` |

Прыклады:
```bash
npm run apply -- --target-dir ~/docs --dry-run
npm run apply:pdf -- --target-dir ~/docs --apply
npm run organize -- --target-dir ~/docs --dry-run
npm run organize:smart -- --target-dir ~/docs --apply --model gpt-5-mini
```

---

## Змест

1. [Падтрымліваемыя мадэлі (хутка)](#падтрымліваемыя-мадэлі-хутка)
2. [Патрабаванні](#патрабаванні)
3. [Пакрокавы сцэнар (рэкамендаваны)](#пакрокавы-сцэнар-рэкамендаваны)
4. [Устаноўка і разгортванне](#устаноўка-і-разгортванне)
5. [Канфігурацыя (.env)](#канфігурацыя-env)
6. [Запуск перайменавання](#запуск-перайменавання)
7. [Запуск з рознымі папкамі](#запуск-з-рознымі-папкамі)
8. [Сартыроўка файлаў па катэгорыях](#сартыроўка-файлаў-па-катэгорыях)
9. [Чытанне дакументаў (OCR)](#чытанне-дакументаў-ocr)
10. [Усе параметры каманднага радка](#усе-параметры-каманднага-радка)
11. [Правілы наймення](#правілы-наймення)
12. [Вынікі працы](#вынікі-працы)
13. [Ignore-ліст і працяг працы](#ignore-ліст-і-працяг-працы)
14. [Прыклады выкарыстання](#прыклады-выкарыстання)
15. [Пытанні і праблемы](#пытанні-і-праблемы)

---

## Падтрымліваемыя мадэлі (хутка)

OpenAI:
- `gpt-4o`
- `gpt-4o-mini`
- `gpt-4.1-2025-04-14`
- `gpt-4.1-nano`
- `gpt-5`
- `gpt-5.1`
- `gpt-5-mini`
- `gpt-5-nano`

Google:
- `gemini-2.5-pro`

Ollama:
- `llama3.2`
- `mistral-small3.1`
- `llama3.3:latest`
- `gemma3:4b`
- `gemma3:12b`
- `gpt-oss:20b`

---

## Патрабаванні

### Сістэмныя залежнасці

| Залежнасць | Навошта | macOS | Linux (Ubuntu/Debian) | Windows |
|---|---|---|---|---|
| **Node.js** (>=18) | Асноўны рантайм агента | `brew install node` | `sudo apt update && sudo apt install -y nodejs npm` | Усталюйце Node.js LTS з https://nodejs.org |
| **Python 3.10+** | OCR і чытанне PDF | `brew install python` | `sudo apt install -y python3 python3-venv python3-pip` | Усталюйце Python 3.10+ з https://python.org (адзначце "Add Python to PATH") |
| **Tesseract OCR** | Распазнаванне тэксту з выяў | `brew install tesseract` | `sudo apt install -y tesseract-ocr` | Усталюйце праз `winget install UB-Mannheim.TesseractOCR` |
| **Poppler** | Канвертацыя PDF у выявы для OCR | `brew install poppler` | `sudo apt install -y poppler-utils` | Усталюйце праз `winget install oschwartz10612.Poppler` або дадайце `poppler/bin` у PATH уручную |

### Моўныя пакеты Tesseract

Для працы з польскімі, англійскімі і рускімі дакументамі:

```bash
# macOS
brew install tesseract-lang

# Linux (Ubuntu/Debian)
sudo apt install -y tesseract-ocr-eng tesseract-ocr-pol tesseract-ocr-rus
```

На Windows дадайце патрэбныя моўныя файлы ў ўстаноўку Tesseract і праверце `OCR_LANG` у `.env` (прыклад: `pol+eng+rus`).

### API-ключы (хаця б адзін)

- **OpenAI** -- ключ з https://platform.openai.com
- **Google Gemini** -- ключ з https://aistudio.google.com
- **Ollama** -- лакальная мадэль, ключ не патрэбен

---

## Пакрокавы сцэнар (рэкамендаваны)

Выкарыстоўвайце гэты парадак для першага запуску:

1. Усталюйце сістэмныя залежнасці з раздзела [Патрабаванні](#патрабаванні) для вашай АС.
2. Выканайце [Устаноўка і разгортванне](#устаноўка-і-разгортванне) (хуткі або ручны сцэнар).
3. Запоўніце API-настройкі ў [Канфігурацыя (.env)](#канфігурацыя-env).
4. Зрабіце бяспечны preview-запуск з [Запуск перайменавання](#запуск-перайменавання) з `--dry-run`.
5. Запусціце без `--dry-run`, каб прымяніць перайменаванне.
6. Пры патрэбе зрабіце [Сартыроўка файлаў па катэгорыях](#сартыроўка-файлаў-па-катэгорыях).
7. Калі ёсць праблемы з OCR/мадэллю, перайдзіце ў [Пытанні і праблемы](#пытанні-і-праблемы).

---

## Устаноўка і разгортванне

### Хуткі старт (macOS/Linux)

```bash
git clone <url-рэпазіторыя>
cd file_rename
./setup.sh
```

Скрыпт `setup.sh` аўтаматычна:
1. Стварае Python venv і ўсталёўвае ўсе pip-залежнасці
2. Усталёўвае Node.js-залежнасці
3. Стварае `.env` з шаблону і прапісвае правільны `READER_PYTHON`

Пасля гэтага дадайце API-ключ:

```bash
nano .env
```

Гатова. Можна запускаць:

```bash
npm run apply -- --dry-run --target-dir ~/Desktop/documents
```

### Хуткі старт (Windows, PowerShell)

`setup.sh` гэта Unix shell-скрыпт, таму на Windows лепш зрабіць ручную ўстаноўку ў PowerShell:

```powershell
git clone <url-рэпазіторыя>
cd file_rename

py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install pdfplumber pytesseract Pillow pdf2image PyMuPDF

npm --prefix tools/rename-agent install
Copy-Item .env.example .env
```

Потым адрэдагуйце `.env`:
- задайце `READER_PYTHON` як абсалютны шлях, напрыклад `C:\path\to\file_rename\.venv\Scripts\python.exe`
- дадайце адзін API-ключ (`OPENAI_API_KEY` або `GOOGLE_GEMINI_API_KEY`) або наладзьце Ollama

Першы запуск (preview):

```powershell
npm run apply -- --dry-run --target-dir "C:\Users\<you>\Documents\documents"
```

### Ручная ўстаноўка (пакрокава)

Калі хочаце зрабіць усё самастойна:

**1. Кланаванне:**

```bash
git clone <url-рэпазіторыя>
cd file_rename
```

**2. Python venv (для OCR):**

```bash
python3 -m venv .venv
.venv/bin/pip install pdfplumber pytesseract Pillow pdf2image PyMuPDF
```

Актывацыя (`source .venv/bin/activate`) **не патрэбна** -- каманды можна запускаць праз шлях да Python з venv.
На Windows выкарыстоўвайце `.\.venv\Scripts\python.exe` замест `.venv/bin/python`.

**3. Node.js-залежнасці:**

```bash
npm --prefix tools/rename-agent install
```

**4. Канфігурацыя:**

```bash
cp .env.example .env
```

Для Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Адрэдагуйце `.env` -- дадайце API-ключ і задайце `READER_PYTHON`:
- прыклад macOS/Linux: `/absolute/path/to/file_rename/.venv/bin/python`
- прыклад Windows: `C:\absolute\path\to\file_rename\.venv\Scripts\python.exe`

**5. Праверка:**

```bash
.venv/bin/python tools/read_document.py --help
npm run apply -- --dry-run --limit 1 --target-dir ~/Desktop
```

Эквівалент для Windows:

```powershell
.\.venv\Scripts\python.exe tools/read_document.py --help
npm run apply -- --dry-run --limit 1 --target-dir "C:\Users\<you>\Desktop"
```

---

## Канфігурацыя (.env)

Файл: `.env` (корань праекта)

```env
# --- Выбар мадэлі ---
LLM_MODEL=gpt-4o-mini        # опцыянальны агульны default

# --- OpenAI ---
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
OPENAI_TIMEOUT_MS=90000
OPENAI_MAX_RETRIES=2

# --- Ollama (лакальная мадэль) ---
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gpt-oss:20b

# --- Google Gemini ---
GOOGLE_GEMINI_API_KEY=...
GOOGLE_MODEL=gemini-2.5-pro

# --- Агульныя налады ---
TARGET_DIR=                   # пуста = абавязкова перадаваць --target-dir
DRY_RUN=true                 # true = толькі прагляд, false = рэальнае перайменаванне
# rename-flow ignore list (apply)
RENAME_IGNORE_LIST_PATH=
# backward-compatible alias for rename-flow ignore list
IGNORE_LIST_PATH=
UPDATE_IGNORE_LIST=true
# organize-flow ignore list (organize / organize:smart)
ORGANIZE_IGNORE_LIST_PATH=
ORGANIZE_UPDATE_IGNORE_LIST=true

# --- Мова назваў ---
NAMING_LANG=en                # en | pl | be | ru

# --- OCR ---
READER_PYTHON=               # setup.sh запоўніць аўтаматычна
OCR_LANG=pol+eng+rus          # мовы Tesseract

# --- Smart organize vision model (опцыянальна) ---
VISION_MODEL=gpt-4o
# Прыклад для лакальнай Ollama vision-мадэлі:
# VISION_MODEL=gemma3:4b
```

`setup.sh` аўтаматычна прапісвае `READER_PYTHON` пры стварэнні `.env` (macOS/Linux). Калі ўсталёўвалі ўручную, задайце абсалютны шлях:
- macOS/Linux: `<project>/.venv/bin/python`
- Windows: `<project>\.venv\Scripts\python.exe`

---

## Запуск перайменавання

Усе каманды запускаюцца з кораня праекта.

### Базавая каманда

```bash
# Прагляд -- што будзе перайменавана (без зменаў)
npm run apply -- --dry-run --target-dir ~/Desktop/documents

# Рэальнае перайменаванне
npm run apply -- --target-dir ~/Desktop/documents --apply
```

Нагадванне: `npm run apply` па змаўчанні працуе ў `--dry-run`. Для рэальнага перайменавання дадайце `--apply`.

### Выбар мадэлі

```bash
# OpenAI
npm run apply -- --target-dir ~/docs --model gpt-4o-mini --apply

# Google Gemini
npm run apply -- --target-dir ~/docs --model gemini-2.5-pro --apply

# Лакальная мадэль Ollama (без інтэрнэту)
npm run apply -- --target-dir ~/docs --model gpt-oss:20b --apply
```

### Мова назваў

Па змаўчанні назвы генеруюцца на англійскай мове. Можна змяніць праз `--lang`:

```bash
# Англійская (па змаўчанні)
npm run apply -- --target-dir ~/docs --lang en --apply

# Польская
npm run apply -- --target-dir ~/docs --lang pl --apply

# Беларуская (транслітарацыя)
npm run apply -- --target-dir ~/docs --lang be --apply

# Руская (транслітарацыя)
npm run apply -- --target-dir ~/docs --lang ru --apply
```

Або задаць у `.env` каб не перадаваць кожны раз:

```env
NAMING_LANG=en
```

### Абмежаванне колькасці файлаў

```bash
# Апрацаваць толькі першыя 10 файлаў (добра для тэсту)
npm run apply -- --target-dir ~/docs --limit 10 --apply
```

### Фільтрацыя па тыпе файлаў

Хуткія каманды для пэўных тыпаў:

```bash
# Толькі PDF
npm run apply:pdf -- --target-dir ~/docs

# Толькі фатаграфіі (jpg, png, tiff, bmp, webp, gif)
npm run apply:photos -- --target-dir ~/docs

# Толькі дакументы Word/XML (doc, docx, xml)
npm run apply:docs -- --target-dir ~/docs
```

Або праз параметр `--include` з прасэтам ці кастомным glob:

```bash
# Прасэт
npm run apply -- --target-dir ~/docs --include pdf --apply
npm run apply -- --target-dir ~/docs --include photos --apply

# Некалькі прасэтаў разам
npm run apply -- --target-dir ~/docs --include pdf,photos --apply

# Кастомны glob
npm run apply -- --target-dir ~/docs --include "**/*.{pdf,png}" --apply
```

Даступныя прасэты:

| Прасэт | Фарматы |
|---|---|
| `all` | pdf, jpg, jpeg, png, tiff, tif, bmp, webp, gif, doc, docx, xml (па змаўчанні) |
| `pdf` | pdf |
| `photos` | jpg, jpeg, png, tiff, tif, bmp, webp, gif |
| `docs` | doc, docx, xml |

---

## Запуск з рознымі папкамі

### Параметр `--target-dir`

Перадайце шлях да любой папкі:

```bash
npm run apply -- --target-dir ~/Desktop/scans --apply
npm run apply -- --target-dir ~/Documents/invoices --apply
npm run apply -- --target-dir /Volumes/USB/documents --apply
```

Прыклад для Windows:

```powershell
npm run apply -- --target-dir "C:\Users\<you>\Documents\scans" --apply
```

### Змяненне `TARGET_DIR` у `.env`

Адрэдагуйце `.env`:

```env
TARGET_DIR=~/Documents/my-docs
```

Прыклад для Windows:

```env
TARGET_DIR=C:\Users\<you>\Documents\my-docs
```

Тады дастаткова проста:

```bash
npm run apply
```

### Shell-аліас (для частага выкарыстання)

Гэта зручнасць для Unix shell (`zsh`/`bash`). На Windows зрабіце аналаг праз функцыю/аліас у профілі PowerShell.

Дадайце ў `~/.zshrc` або `~/.bashrc`:

```bash
alias rename-docs='npm --prefix /шлях/да/праекта/tools/rename-agent run apply --'
```

Пасля гэтага з любой папкі:

```bash
rename-docs --target-dir ~/Desktop/scans
rename-docs --target-dir ~/docs --dry-run --limit 5
```

---

## Сартыроўка файлаў па катэгорыях

Пасля перайменавання можна аўтаматычна рассартаваць файлы па папках-катэгорыях.
Файлы аўтаматычна разбіваюцца па папках-катэгорыях.

### Звычайная сартыроўка (па назве файла)

```bash
# Прагляд плана сартыроўкі (без перамяшчэння)
npm run organize -- --target-dir ~/Desktop/documents --dry-run

# Выканаць сартыроўку
npm run organize -- --target-dir ~/Desktop/documents --apply
```

### Разумная сартыроўка (з аналізам кантэнту)

Рэжым `--smart` чытае змесціва кожнага файла (тэкст або OCR) і пытае LLM, у якую катэгорыю яго аднесці. Гэта дазваляе:
- Правільна класіфікаваць сканы і фатаграфіі дакументаў па іх змесціву
- Адрозніваць фота людзей ад фота дакументаў
- Дакладна вызначаць тып, нават калі назва файла неінфарматыўная (напр. `IMG_001.jpg`)

```bash
# Прагляд (без перамяшчэння)
npm run organize:smart -- --target-dir ~/Desktop/documents --dry-run

# Выканаць сартыроўку
npm run organize:smart -- --target-dir ~/Desktop/documents --apply

# З выбарам мадэлі
npm run organize:smart -- --target-dir ~/docs --apply --model gpt-4o-mini
```

### Дадатковыя параметры organize

```bash
# Задаць іншую назву выходной папкі
npm run organize -- --target-dir ~/docs --apply --out-dir my_sorted

# Абмежаваць колькасць файлаў
npm run organize -- --target-dir ~/docs --dry-run --limit 50
```

Вынік -- структура тыпу:

```
sorted_documents/
├── invoices/
│   ├── invoice_orange_2024-03.pdf
│   └── invoice_pge_2024-05.pdf
├── taxes_and_social/
│   ├── tax_return_pit37_2023.pdf
│   └── social_insurance_rca_2024-01.pdf
├── contracts/
│   └── contract_lease_warsaw_2024-02.pdf
└── other/
    └── unreadable_scan.jpg
```

---

## Чытанне дакументаў (OCR)

Утыліта `tools/read_document.py` выкарыстоўваецца агентам аўтаматычна, але можна карыстацца ёю і напрамую.

### Запуск

```bash
# Прачытаць PDF з тэкстам
.venv/bin/python tools/read_document.py document.pdf

# Распазнаць скан (OCR)
.venv/bin/python tools/read_document.py scan.jpg

# Прымусовы OCR для PDF
.venv/bin/python tools/read_document.py document.pdf --mode ocr

# Задаць мовы OCR
.venv/bin/python tools/read_document.py scan.png --lang pol+eng

# Выбраць старонкі
.venv/bin/python tools/read_document.py big.pdf --pages 1-3,5

# Захаваць вынік у файл
.venv/bin/python tools/read_document.py scan.pdf --output result.txt
```

Альтэрнатыўна -- абалонка `tools/read_doc.sh`, якая сама знаходзіць venv:

```bash
./tools/read_doc.sh document.pdf
./tools/read_doc.sh scan.jpg --mode ocr --lang pol+eng
```

### Рэжымы працы

| Рэжым | Апісанне |
|---|---|
| `auto` | Аўтаматычна: калі ў PDF ёсць тэкст -- бярэ яго, інакш -- OCR. Для выяў заўсёды OCR |
| `text` | Толькі выманне тэксту з PDF (без OCR) |
| `ocr` | Прымусовае распазнаванне праз Tesseract |

### Падтрымліваемыя фарматы

PDF, JPG/JPEG, PNG, TIFF/TIF, BMP, WebP, GIF, DOC, DOCX, XML

---

## Усе параметры каманднага радка

### `npm run apply` (перайменаванне)

| Параметр | Апісанне | Змаўчанне |
|---|---|---|
| `--target-dir <шлях>` | Папка з файламі для апрацоўкі | з `.env` |
| `--dry-run` | Толькі прагляд, без перайменавання | |
| `--apply` | Выканаць перайменаванне | |
| `--model <назва>` | Мадэль LLM з whitelist | `LLM_MODEL`/`OPENAI_MODEL`/`OLLAMA_MODEL`/`GOOGLE_MODEL`/`gpt-4o-mini` |
| `--ollama-base-url <url>` | URL сервера Ollama | `http://localhost:11434` |
| `--include <прасэт\|glob>` | Фільтр тыпаў файлаў: `pdf`, `photos`, `docs`, `all` або glob | `all` |
| `--lang <код>` | Мова назваў: `en`, `pl`, `be`, `ru` | `en` |
| `--limit <N>` | Апрацаваць толькі першыя N файлаў | `0` (усе) |
| `--ignore-list <шлях>` | Шлях да rename ignore-ліста | `<project-root>/.rename-agent-ignore-rename.txt` |
| `--no-update-ignore-list` | Не абнаўляць ignore-ліст | абнаўляць |

### `npm run organize` (сартыроўка)

| Параметр | Апісанне | Змаўчанне |
|---|---|---|
| `--target-dir <шлях>` | Папка з файламі | з `.env` |
| `--dry-run` | Толькі прагляд | |
| `--apply` | Выканаць перамяшчэнне | |
| `--out-dir <назва>` | Назва папкі для сартыроўкі | `sorted_documents` |
| `--smart` | Разумная сартыроўка: аналіз кантэнту праз LLM | выключана |
| `--model <назва>` | Мадэль LLM (для `--smart`) | тыя ж default, што і для `apply` |
| `--limit <N>` | Абмежаваць колькасць файлаў | `0` (усе) |
| `--ignore-list <шлях>` | Шлях да organize ignore-ліста | `<project-root>/.rename-agent-ignore-organize.txt` |
| `--no-update-ignore-list` | Не абнаўляць organize ignore-ліст | абнаўляць |

### `.venv/bin/python tools/read_document.py` (чытанне)

| Параметр | Апісанне | Змаўчанне |
|---|---|---|
| `file` | Шлях да файла | (абавязковы) |
| `--mode` | `text`, `ocr`, `auto` | `auto` |
| `--lang` | Мовы OCR | `pol+eng+rus` |
| `--pages` | Дыяпазон старонак (напр. `1-3,5`) | усе |
| `--dpi` | DPI для рэндэрынгу | `300` |
| `--output` / `-o` | Захаваць у файл | stdout |

---

## Правілы наймення

Агент генеруе назвы паводле правілаў з файла `tools/rename-agent/rules.prompt.txt`:

- Мова: **англійская**, лацінскі алфавіт, snake_case
- Фармат: `<category>_<topic>_<date>` у **snake_case**
- Прыклады катэгорый: `invoice`, `tax_return`, `vat`, `social_insurance`, `bank_statement`, `residence_permit`, `contract`, `certificate`, `power_of_attorney`, `application`, `photo`, `scan`, `report`
- Дата (калі вядомая): `YYYY-MM` або `YYYY-MM-DD`
- Калі ў дакуменце ёсць асоба (пашпарт, дазвол) -- прозвішча дадаецца ў назву
- Нечытэльныя сканы: `unreadable_scan`
- Пашырэнне файла не змяняецца

### Прыклады перайменавання

| Было | Стала |
|---|---|
| `IMG_20240315_001.jpg` | `invoice_orange_2024-03.jpg` |
| `scan0042.pdf` | `certificate_social_insurance_kowalski_2024-01.pdf` |
| `Document (3).pdf` | `contract_lease_warsaw_2024-02.pdf` |
| `photo_2024.png` | `residence_permit_card_ivanov_2024-05.png` |
| `file.pdf` (нечытэльны) | `unreadable_scan.pdf` |

---

## Вынікі працы

Пасля запуску агент стварае файлы ў `tools/rename-agent/outputs/`:

| Файл | Апісанне |
|---|---|
| `rename-plan.json` | Поўны план перайменавання з метаданымі |
| `rename-plan.csv` | CSV-версія плана (для Excel / Google Sheets) |
| `pending-files.txt` | Спіс файлаў, якія чакаюць апрацоўкі |
| `organize-plan.json` | План сартыроўкі па папках |
| `organize-plan.csv` | CSV-версія плана сартыроўкі |

Дадаткова:

- У мэтавай папцы: **`DOCUMENT_CATALOG.md`** -- аўтаматычна абнаўляемы каталог усіх файлаў
- У корані праекта: **`.rename-agent-ignore-rename.txt`** -- спіс ужо перайменаваных файлаў
- У корані праекта: **`.rename-agent-ignore-organize.txt`** -- спіс ужо адсартыраваных файлаў

---

## Ignore-ліст і працяг працы

Агент выкарыстоўвае два ignore-лісты ў корані праекта:

- `.rename-agent-ignore-rename.txt` для патоку перайменавання (`apply`)
- `.rename-agent-ignore-organize.txt` для патоку сартыроўкі (`organize`, `organize:smart`)

Гэта значыць:

1. **Можна бяспечна спыніць і працягнуць** -- пры паўторным запуску агент прапусціць ужо апрацаваныя файлы
2. **Новыя файлы аўтаматычна падхопяцца** -- дастаткова запусціць агент зноў
3. **Каб пераапрацаваць усё** -- выдаліце адзін або абодва ignore-файлы з кораня праекта

```bash
# Працягнуць з месца спынення
npm run apply -- --target-dir ~/docs --apply

# Прымусіць пераапрацоўку ўсіх файлаў
rm ./.rename-agent-ignore-rename.txt
rm ./.rename-agent-ignore-organize.txt
npm run apply -- --target-dir ~/docs --apply

# Не абнаўляць ignore-ліст (разавы прагон)
npm run apply -- --target-dir ~/docs --no-update-ignore-list --apply
```

---

## Прыклады выкарыстання

### Прыклад 1: Першы запуск -- прагляд

Спачатку заўсёды глядзім, што агент прапануе:

```bash
npm run apply -- --dry-run --target-dir ~/Desktop/documents
```

Вывад пакажа для кожнага файла прапанаваную назву, тып, дату і ўзровень упэўненасці. Рэальныя файлы не будуць зменены.

### Прыклад 2: Перайменаваць усе дакументы

```bash
npm run apply -- --target-dir ~/Desktop/documents --apply
```

### Прыклад 3: Тэст на невялікай выбарцы

```bash
npm run apply -- --target-dir ~/Desktop/documents --limit 5 --dry-run
```

### Прыклад 4: Выкарыстанне лакальнай мадэлі (без інтэрнэту)

```bash
# Спачатку запусціце Ollama:
ollama serve

# Потым:
npm run apply -- --target-dir ~/docs --model llama3.3:latest --apply
```

### Прыклад 5: Поўны цыкл -- перайменаванне + сартыроўка

```bash
# Крок 1: Перайменаваць
npm run apply -- --target-dir ~/Desktop/my-docs --apply

# Крок 2: Пабачыць план сартыроўкі
npm run organize -- --target-dir ~/Desktop/my-docs --dry-run

# Крок 3: Рассартаваць
npm run organize -- --target-dir ~/Desktop/my-docs --apply
```

### Прыклад 6: Апрацоўка знешняга дыска

```bash
npm run apply -- --target-dir /Volumes/MyUSB/scans --model gpt-4o-mini --apply
```

### Прыклад 7: Прачытаць адзін дакумент уручную

```bash
.venv/bin/python tools/read_document.py ~/Desktop/scan.pdf

# Або праз абалонку (яна сама знойдзе venv):
./tools/read_doc.sh ~/Desktop/scan.pdf
```

### Прыклад 8: Шматразовая апрацоўка новых файлаў

```bash
# Першы запуск -- апрацуе ўсе файлы
npm run apply -- --target-dir ~/docs --apply

# Пазней дадалі новыя файлы ў ~/docs -- запускаем зноў
# Агент апрацуе толькі новыя (дзякуючы ignore-лісту)
npm run apply -- --target-dir ~/docs --apply
```

---

## Пытанні і праблемы

### «unreadable_scan» у многіх файлах

OCR не змог распазнаць тэкст. Магчымыя прычыны:
- Tesseract не ўсталяваны або не мае патрэбных моўных пакетаў
- Нізкая якасць сканаў
- Дакумент на мове, якая не ўключана ў `OCR_LANG`

Рашэнне: `brew install tesseract-lang` і праверце `OCR_LANG` у `.env`.
Таксама ўсталюйце моўныя пакеты для вашай АС:
- macOS: `brew install tesseract-lang`
- Linux (Ubuntu/Debian): `sudo apt install -y tesseract-ocr-eng tesseract-ocr-pol tesseract-ocr-rus`
- Windows: дадайце `eng`, `pol`, `rus` файлы даных у тэчку ўстаноўкі Tesseract

### Агент не бачыць файлы

Праверце, што:
- `--target-dir` паказвае на правільную папку
- Файлы маюць падтрымліваемае пашырэнне (pdf, jpg, png, tiff, doc, docx, xml)
- Файлы не ў root ignore-файлах (`.rename-agent-ignore-rename.txt` / `.rename-agent-ignore-organize.txt`)

### Памылка LLM/мадэлі

- **OpenAI**: праверце `OPENAI_API_KEY` у `.env`
- **Ollama**: пераканайцеся, што `ollama serve` запушчаны
- **Google**: праверце `GOOGLE_GEMINI_API_KEY`
- **Unsupported model**: выкарыстоўвайце толькі мадэлі са спісу `Model` у `tools/rename-agent/src/llm.mjs`

### Python не знойдзены

Агент шукае Python у наступным парадку:

1. `READER_PYTHON` з `.env` (`setup.sh` прапісвае аўтаматычна)
2. `.venv/bin/python` у корані праекта (знаходзіць аўтаматычна)
3. сістэмны `python3` (фолбэк, можа не мець патрэбных бібліятэк)

Праверыць, што venv працуе:

```bash
.venv/bin/python -c "import pdfplumber, pytesseract, fitz; print('OK')"
```

Эквівалент для Windows:

```powershell
.\.venv\Scripts\python.exe -c "import pdfplumber, pytesseract, fitz; print('OK')"
```

Калі нешта не ўсталявана -- даўсталюйце:

```bash
.venv/bin/pip install pdfplumber pytesseract Pillow pdf2image PyMuPDF
```

Эквівалент для Windows:

```powershell
.\.venv\Scripts\python.exe -m pip install pdfplumber pytesseract Pillow pdf2image PyMuPDF
```
