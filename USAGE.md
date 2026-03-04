# File Rename Agent — Дакументацыя

Інструмент для асэнсаванага перайменавання і арганізацыі PDF-файлаў, фатаграфій дакументаў і іншых файлаў з дапамогай AI (LLM).

Агент чытае змесціва кожнага файла (тэкст або OCR), адпраўляе яго ў моўную мадэль і атрымлівае прапанову новай назвы ў фармаце `<катэгорыя>_<тэма>_<дата>.pdf`.

---

## Змест

1. [Патрабаванні](#патрабаванні)
2. [Устаноўка і разгортванне](#устаноўка-і-разгортванне)
3. [Канфігурацыя (.env)](#канфігурацыя-env)
4. [Запуск перайменавання](#запуск-перайменавання)
5. [Запуск з рознымі папкамі](#запуск-з-рознымі-папкамі)
6. [Сартыроўка файлаў па катэгорыях](#сартыроўка-файлаў-па-катэгорыях)
7. [Чытанне дакументаў (OCR)](#чытанне-дакументаў-ocr)
8. [Усе параметры каманднага радка](#усе-параметры-каманднага-радка)
9. [Правілы наймення](#правілы-наймення)
10. [Вынікі працы](#вынікі-працы)
11. [Ignore-ліст і працяг працы](#ignore-ліст-і-працяг-працы)
12. [Прыклады выкарыстання](#прыклады-выкарыстання)
13. [Пытанні і праблемы](#пытанні-і-праблемы)

---

## Патрабаванні

### Сістэмныя залежнасці

| Залежнасць | Навошта | Устаноўка (macOS) |
|---|---|---|
| **Node.js** (>=18) | Асноўны рантайм агента | `brew install node` |
| **Python 3.10+** | OCR і чытанне PDF | `brew install python` |
| **Tesseract OCR** | Распазнаванне тэксту з выяў | `brew install tesseract` |
| **Poppler** | Канвертацыя PDF у выявы для OCR | `brew install poppler` |

### Моўныя пакеты Tesseract

Для працы з польскімі, англійскімі і рускімі дакументамі:

```bash
brew install tesseract-lang
```

### API-ключы (хаця б адзін)

- **OpenAI** — ключ з https://platform.openai.com
- **Google Gemini** — ключ з https://aistudio.google.com
- **Ollama** — лакальная мадэль, ключ не патрэбен

---

## Устаноўка і разгортванне

### Хуткі старт (2 каманды)

```bash
git clone <url-рэпазіторыя> file_rename
cd file_rename
./setup.sh
```

Скрыпт `setup.sh` аўтаматычна:
1. Стварае Python venv і ўсталёўвае ўсе pip-залежнасці
2. Усталёўвае Node.js-залежнасці (`npm install`)
3. Стварае `.env` з шаблону і прапісвае правільны `READER_PYTHON`

Пасля гэтага дадайце API-ключ у `tools/rename-agent/.env`:

```bash
# Адкрыйце .env і ўпішыце свой ключ:
nano tools/rename-agent/.env
```

Гатова. Можна запускаць:

```bash
cd tools/rename-agent
npm run apply -- --dry-run --target-dir /шлях/да/вашых/дакументаў
```

### Ручная ўстаноўка (пакрокава)

Калі хочаце зрабіць усё самастойна:

**1. Кланаванне:**

```bash
git clone <url-рэпазіторыя> file_rename
cd file_rename
```

Далей у дакументацыі `<PROJECT_ROOT>` = каранёвая папка праекта (дзе вы зрабілі `cd file_rename`).

**2. Python venv (для OCR):**

```bash
python3 -m venv .venv
.venv/bin/pip install pdfplumber pytesseract Pillow pdf2image PyMuPDF
```

Актывацыя (`source .venv/bin/activate`) **не патрэбна** — усе каманды выкарыстоўваюць шлях да Python з venv напрамую.

**3. Node.js-залежнасці:**

```bash
cd tools/rename-agent
npm install
```

**4. Канфігурацыя:**

```bash
cp .env.example .env
```

Адрэдагуйце `.env` — дадайце API-ключ і пропішыце шлях да Python з venv:

```env
READER_PYTHON=<PROJECT_ROOT>/.venv/bin/python
```

**5. Праверка:**

```bash
# З кораня праекта:
.venv/bin/python tools/read_document.py --help

# Тэставы запуск агента:
cd tools/rename-agent
npm run apply -- --dry-run --limit 1 --target-dir /шлях/да/тэставай/папкі
```

---

## Канфігурацыя (.env)

Файл: `tools/rename-agent/.env`

```env
# --- Правайдар LLM ---
LLM_PROVIDER=openai          # openai | ollama | google | auto

# --- OpenAI ---
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini    # або gpt-5-mini, gpt-4o і інш.

# --- Ollama (лакальная мадэль) ---
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gpt-oss:20b

# --- Google Gemini ---
GOOGLE_GEMINI_API_KEY=...
GOOGLE_MODEL=gemini-2.5-pro

# --- Агульныя налады ---
TARGET_DIR=/шлях/да/вашых/дакументаў
DRY_RUN=true                 # true = толькі прагляд, false = рэальнае перайменаванне
IGNORE_LIST_PATH=             # пуста = аўтаматычна ў TARGET_DIR
UPDATE_IGNORE_LIST=true

# --- OCR ---
READER_PYTHON=<PROJECT_ROOT>/.venv/bin/python
OCR_LANG=pol+eng+rus          # мовы Tesseract
```

**Важна:** замяніце `<PROJECT_ROOT>` на рэальны абсалютны шлях да кораня праекта.

**Важна:** `DRY_RUN=true` па змаўчанні — агент не будзе перайменоўваць файлы, пакуль вы яўна не перадасце `--apply`.

---

## Запуск перайменавання

Усе каманды `npm run ...` запускаюцца з папкі `tools/rename-agent`.

### Базавая каманда

```bash
cd tools/rename-agent

# Прагляд — што будзе перайменавана (без зменаў)
npm run apply -- --dry-run --target-dir /шлях/да/папкі

# Рэальнае перайменаванне
npm run apply -- --target-dir /шлях/да/папкі
```

Нагадванне: `npm run apply` ужо ўключае сцяг `--apply`, таму файлы будуць перайменаваны. Дадайце `--dry-run`, каб толькі пабачыць план.

### Выбар LLM-правайдара

```bash
# OpenAI (па змаўчанні)
npm run apply -- --target-dir ./docs --provider openai --model gpt-4.1-mini

# Google Gemini
npm run apply -- --target-dir ./docs --provider google --model gemini-2.5-pro

# Лакальная мадэль Ollama (без інтэрнэту)
npm run apply -- --target-dir ./docs --provider ollama --model gpt-oss:20b
```

### Абмежаванне колькасці файлаў

```bash
# Апрацаваць толькі першыя 10 файлаў (добра для тэсту)
npm run apply -- --target-dir ./docs --limit 10
```

---

## Запуск з рознымі папкамі

Ёсць некалькі спосабаў запускаць агент для розных папак з дакументамі.

### Спосаб 1: Параметр `--target-dir`

Самы просты — перадаць шлях да папкі як аргумент:

```bash
cd tools/rename-agent

# Любая папка на дыску
npm run apply -- --target-dir /шлях/да/маіх/дакументаў

# Папка на працоўным стале
npm run apply -- --target-dir ~/Desktop/scans

# Папка на знешнім дыску
npm run apply -- --target-dir /Volumes/USB/documents
```

### Спосаб 2: `npm --prefix` (запуск з любога месца)

Не хочаце кожны раз рабіць `cd`? Выкарыстоўвайце `--prefix`:

```bash
# З любога месца ў сістэме:
npm --prefix <PROJECT_ROOT>/tools/rename-agent \
    run apply -- --target-dir ~/Desktop/scans

# Dry-run для іншай папкі:
npm --prefix <PROJECT_ROOT>/tools/rename-agent \
    run apply -- --dry-run --target-dir /Volumes/USB/documents
```

### Спосаб 3: Змяненне `TARGET_DIR` у `.env`

Адрэдагуйце `tools/rename-agent/.env`:

```env
TARGET_DIR=/шлях/да/маіх/дакументаў
```

Тады дастаткова проста:

```bash
npm run apply
```

### Спосаб 4: Shell-аліас (для частага выкарыстання)

Дадайце ў `~/.zshrc` або `~/.bashrc`:

```bash
alias rename-docs='npm --prefix <PROJECT_ROOT>/tools/rename-agent run apply --'
```

Пасля гэтага:

```bash
rename-docs --target-dir ~/Desktop/scans
rename-docs --target-dir /tmp/test --dry-run --limit 5
```

---

## Сартыроўка файлаў па катэгорыях

Пасля перайменавання можна аўтаматычна рассартаваць файлы па папках-катэгорыях.

### Катэгорыі

| Папка | Тыпы дакументаў |
|---|---|
| `faktury` | Рахункі, фактуры |
| `umowy` | Дамовы, кантракты |
| `bankowe_wyciagi` | Банкаўскія выпіскі |
| `podatki_i_zus` | PIT, VAT, ZUS, падаткі |
| `wnioski_i_decyzje` | Заявы, рашэнні, дазволы, побыт |
| `zaswiadczenia` | Даведкі |
| `dokumenty_tozsamosci` | Пашпарты, даверанасці |
| `nieruchomosc` | Нерухомасць |
| `skany_i_zdjecia` | Сканы, фатаграфіі |
| `inne` | Усё астатняе |

### Каманды

```bash
cd tools/rename-agent

# Прагляд плана сартыроўкі (без перамяшчэння)
npm run organize -- --target-dir /шлях/да/папкі --dry-run

# Выканаць сартыроўку
npm run organize -- --target-dir /шлях/да/папкі --apply

# З іншага месца
npm --prefix <PROJECT_ROOT>/tools/rename-agent \
    run organize -- --target-dir ~/Desktop/scans --apply

# Задаць іншую назву выходной папкі
npm run organize -- --target-dir ./docs --apply --out-dir sorted_documents

# Абмежаваць колькасць файлаў
npm run organize -- --target-dir ./docs --dry-run --limit 50
```

Вынік — структура тыпу:

```
dokumenty_posortowane/
├── faktury/
│   ├── faktura_orange_2024-03.pdf
│   └── faktura_pge_2024-05.pdf
├── podatki_i_zus/
│   ├── pit_37_2023.pdf
│   └── zus_rca_2024-01.pdf
├── umowy/
│   └── umowa_najmu_warszawa_2024-02.pdf
└── inne/
    └── skan_nieczytelny.jpg
```

---

## Чытанне дакументаў (OCR)

Утыліта `tools/read_document.py` выкарыстоўваецца агентам аўтаматычна, але можна карыстацца ёю і напрамую.

### Запуск

Усе каманды запускаюцца з кораня праекта.
Выкарыстоўвайце `.venv/bin/python` напрамую — актывацыя venv не патрэбна.

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

Альтэрнатыўна можна выкарыстоўваць абалонку `tools/read_doc.sh`, якая аўтаматычна знаходзіць venv:

```bash
./tools/read_doc.sh document.pdf
./tools/read_doc.sh scan.jpg --mode ocr --lang pol+eng
```

### Рэжымы працы

| Рэжым | Апісанне |
|---|---|
| `auto` | Аўтаматычна: калі ў PDF ёсць тэкст — бярэ яго, інакш — OCR. Для выяў заўсёды OCR |
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
| `--dry-run` | Толькі прагляд, без перайменавання | `true` (пры `npm run apply` — `false`) |
| `--apply` | Выканаць перайменаванне | |
| `--provider <назва>` | LLM-правайдар: `openai`, `ollama`, `google`, `auto` | `openai` |
| `--model <назва>` | Мадэль LLM | `gpt-4.1-mini` |
| `--ollama-base-url <url>` | URL сервера Ollama | `http://localhost:11434` |
| `--limit <N>` | Апрацаваць толькі першыя N файлаў | `0` (усе) |
| `--ignore-list <шлях>` | Шлях да ignore-ліста | `<TARGET_DIR>/.rename-agent-ignore.txt` |
| `--no-update-ignore-list` | Не абнаўляць ignore-ліст | абнаўляць |

### `npm run organize` (сартыроўка)

| Параметр | Апісанне | Змаўчанне |
|---|---|---|
| `--target-dir <шлях>` | Папка з файламі | з `.env` |
| `--dry-run` | Толькі прагляд | |
| `--apply` | Выканаць перамяшчэнне | |
| `--out-dir <назва>` | Назва папкі для сартыроўкі | `dokumenty_posortowane` |
| `--limit <N>` | Абмежаваць колькасць файлаў | `0` (усе) |

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

- Мова: **польская**, лацінскі алфавіт без дыякрытычных знакаў
- Фармат: `<катэгорыя>_<тэма>_<дата>` ў **snake_case**
- Прыклады катэгорый: `faktura`, `pit`, `vat`, `zus`, `wyciag_bankowy`, `pobyt`, `umowa`, `zaswiadczenie`, `pelnomocnictwo`, `wniosek`, `skan`, `raport`
- Дата (калі вядомая): `YYYY-MM` або `YYYY-MM-DD`
- Калі ў дакуменце ёсць асоба (пашпарт, дазвол) — прозвішча дадаецца ў назву
- Нечытэльныя сканы: `skan_nieczytelny`
- Пашырэнне файла не змяняецца

### Прыклады перайменавання

| Было | Стала |
|---|---|
| `IMG_20240315_001.jpg` | `faktura_orange_2024-03.jpg` |
| `scan0042.pdf` | `zaswiadczenie_zus_kowalski_2024-01.pdf` |
| `Document (3).pdf` | `umowa_najmu_warszawa_2024-02.pdf` |
| `photo_2024.png` | `pobyt_karta_ivanov_2024-05.png` |
| `file.pdf` (нечытэльны) | `skan_nieczytelny.pdf` |

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

Дадаткова ў мэтавай папцы:

- **`КАТАЛОГ_ДАКУМЕНТАЎ.md`** — аўтаматычна абнаўляемы каталог усіх файлаў
- **`.rename-agent-ignore.txt`** — спіс ужо апрацаваных файлаў

---

## Ignore-ліст і працяг працы

Агент запісвае кожны апрацаваны файл у `.rename-agent-ignore.txt`. Гэта значыць:

1. **Можна бяспечна спыніць і працягнуць** — пры паўторным запуску агент прапусціць ужо апрацаваныя файлы
2. **Новыя файлы аўтаматычна падхопяцца** — дастаткова запусціць агент зноў
3. **Каб пераапрацаваць усё** — выдаліце `.rename-agent-ignore.txt` з мэтавай папкі

```bash
# Працягнуць з месца спынення
npm run apply -- --target-dir ~/docs

# Прымусіць пераапрацоўку ўсіх файлаў
rm ~/docs/.rename-agent-ignore.txt
npm run apply -- --target-dir ~/docs

# Не абнаўляць ignore-ліст (разавы прагон)
npm run apply -- --target-dir ~/docs --no-update-ignore-list
```

---

## Прыклады выкарыстання

### Прыклад 1: Першы запуск — прагляд

Спачатку заўсёды глядзім, што агент прапануе:

```bash
cd tools/rename-agent
npm run apply -- --dry-run --target-dir ~/Desktop/documents
```

Вывад пакажа для кожнага файла прапанаваную назву, тып, дату і ўзровень упэўненасці. Рэальныя файлы не будуць зменены.

### Прыклад 2: Перайменаваць усе дакументы

```bash
npm run apply -- --target-dir ~/Desktop/documents
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
npm run apply -- --target-dir ~/docs --provider ollama --model llama3.3
```

### Прыклад 5: Поўны цыкл — перайменаванне + сартыроўка

```bash
# Крок 1: Перайменаваць
npm run apply -- --target-dir ~/Desktop/my-docs

# Крок 2: Пабачыць план сартыроўкі
npm run organize -- --target-dir ~/Desktop/my-docs --dry-run

# Крок 3: Рассартаваць
npm run organize -- --target-dir ~/Desktop/my-docs --apply
```

### Прыклад 6: Апрацоўка знешняга дыска

```bash
npm --prefix <PROJECT_ROOT>/tools/rename-agent \
    run apply -- --target-dir /Volumes/MyUSB/scans --provider openai --model gpt-4.1-mini
```

### Прыклад 7: Прачытаць адзін дакумент уручную

```bash
# З кораня праекта:
.venv/bin/python tools/read_document.py ~/Desktop/scan.pdf

# Або праз абалонку (яна сама знойдзе venv):
./tools/read_doc.sh ~/Desktop/scan.pdf
```

### Прыклад 8: Шматразовая апрацоўка новых файлаў

```bash
# Першы запуск — апрацуе ўсе файлы
npm run apply -- --target-dir ~/docs

# Пазней дадалі новыя файлы ў ~/docs — запускаем зноў
# Агент апрацуе толькі новыя (дзякуючы ignore-лісту)
npm run apply -- --target-dir ~/docs
```

---

## Пытанні і праблемы

### «skan_nieczytelny» у многіх файлах

OCR не змог распазнаць тэкст. Магчымыя прычыны:
- Tesseract не ўсталяваны або не мае патрэбных моўных пакетаў
- Нізкая якасць сканаў
- Дакумент на мове, якая не ўключана ў `OCR_LANG`

Рашэнне: `brew install tesseract-lang` і праверце `OCR_LANG` у `.env`.

### Агент не бачыць файлы

Праверце, што:
- `--target-dir` паказвае на правільную папку
- Файлы маюць падтрымліваемае пашырэнне (pdf, jpg, png, tiff, doc, docx, xml)
- Файлы не ў `.rename-agent-ignore.txt`

### Памылка правайдара LLM

- **OpenAI**: праверце `OPENAI_API_KEY` у `.env`
- **Ollama**: пераканайцеся, што `ollama serve` запушчаны
- **Google**: праверце `GOOGLE_GEMINI_API_KEY`

### Python не знойдзены

Агент шукае Python у наступным парадку:

1. `READER_PYTHON` з `.env` (рэкамендуецца: абсалютны шлях да `.venv/bin/python`)
2. `.venv/bin/python` у корані праекта (знаходзіць аўтаматычна)
3. сістэмны `python3` (фолбэк, можа не мець патрэбных бібліятэк)

Каб гарантаваць працу, пропішыце ў `.env`:

```env
READER_PYTHON=<PROJECT_ROOT>/.venv/bin/python
```

Праверыць, што venv працуе (з кораня праекта):

```bash
.venv/bin/python -c "import pdfplumber, pytesseract, fitz; print('OK')"
```

Калі нешта не ўсталявана — даўсталюйце:

```bash
.venv/bin/pip install pdfplumber pytesseract Pillow pdf2image PyMuPDF
```
