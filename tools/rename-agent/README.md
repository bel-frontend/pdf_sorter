# Rename Agent (Node.js + LangChain)

Агент чытае кантэнт файлаў і прапануе/прымяняе новыя асэнсаваныя назвы.

## Tryb pracy (krok po kroku)

- Przy starcie agent tworzy listę `pending` plików, których nie ma w ignore-liście.
- Dalej przetwarza **plik po pliku**: analiza → propozycja nazwy → rename (w `apply`) → dopisanie do ignore-listy.
- Dzięki temu po awarii można wznowić proces bez ponownego skanowania już przetworzonych plików.
- Jeśli w treści dokumentu występuje osoba (np. paszport/dowód), agent dodaje nazwisko (i jeśli możliwe datę) do nazwy pliku.
- Nazwy są dodatkowo normalizowane: usuwanie duplikatów tokenów i limit długości, żeby nie tworzyć zbyt długich nazw.

## Падтрымка мадэляў

- `openai` (праз `@langchain/openai`)
- `ollama` (праз `@langchain/ollama`)
- `google` (праз `@langchain/google-genai`)

## Устаноўка

```bash
cd tools/rename-agent
npm install
cp .env.example .env
```

Важна: каманды `npm run ...` трэба запускаць з папкі `tools/rename-agent`.
Калі запускаеш з іншага месца, выкарыстоўвай `npm --prefix /Users/serj/projects/poland/tools/rename-agent ...`.

## Канфіг `.env`

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5-mini

# або
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gpt-oss:20b

# або
LLM_PROVIDER=google
GOOGLE_GEMINI_API_KEY=...
GOOGLE_MODEL=gemini-2.5-pro
```

## Запуск

Па змаўчанні (калі не перадаваць `--target-dir`) агент бярэ файлы з:
`/Users/serj/projects/poland/src`

### Прымяніць перайменаванне (асноўная каманда)

```bash
cd tools/rename-agent
npm run apply -- --target-dir /Users/serj/projects/poland --provider openai --model gpt-5-mini
```

### Запуск з любой папкі (без `cd`)

```bash
npm --prefix /Users/serj/projects/poland/tools/rename-agent run apply -- --target-dir /Users/serj/projects/poland --provider openai --model gpt-5-mini
```

## Сартыроўка файлаў па папках (толькі тып)

Скрыпт арганізуе файлы ў структуру:

`dokumenty_posortowane/<kategoria>/plik`

Прыклад: `bankowe_wyciagi/...`, `wnioski_i_decyzje/...`

### Папярэдні прагляд (без перамяшчэння)

```bash
npm --prefix /Users/serj/projects/poland/tools/rename-agent run organize -- --target-dir /Users/serj/projects/poland --dry-run
```

### Рэальнае перамяшчэнне

```bash
npm --prefix /Users/serj/projects/poland/tools/rename-agent run organize -- --target-dir /Users/serj/projects/poland --apply
```

Дадаткова:

- `--out-dir dokumenty_posortowane` — назва каранёвай папкі для сартыроўкі
- `--limit 100` — пратэст на першых N файлах

Вынікі плана:

- `outputs/organize-plan.json`
- `outputs/organize-plan.csv`

## Вынікі

Пасля запуску ствараюцца (заўсёды адзін актуальны файл, без дублікатаў):
- `outputs/rename-plan.json`
- `outputs/rename-plan.csv`
- `outputs/pending-files.txt`

І дадаткова абнаўляецца каталог:
- `КАТАЛОГ_ДАКУМЕНТАЎ.md` (аўта-секцыя са спісам усіх файлаў)

Пры кожным запуску агент таксама аўтаматычна:
- выдаляе старыя timestamp-файлы ў `outputs`
- прыбірае тэхнічныя тэставыя папкі `tmp-apply-test` і `tmp-person-test`

## Ignore-ліст (не сканаваць ужо апрацаваныя)

- Па змаўчанні: `.rename-agent-ignore.txt` у `TARGET_DIR`.
- Пасля кожнага запуску агент дадае апрацаваныя файлы ў ignore-ліст.
- Каб адключыць аўта-абнаўленне: `--no-update-ignore-list`.
- Каб задаць іншы файл: `--ignore-list /path/to/list.txt`.

У `apply` ignore-ліст абнаўляецца пакрокава (пасля кожнага апрацаванага файла), таму працэс можна бяспечна працягваць пасля перапынення.

## Чытанне PDF/выяў (OCR)

- Для `pdf/jpg/png/...` агент выкарыстоўвае `tools/read_document.py`.
- Для `docx` — `mammoth`, для `doc` — `textutil` (macOS).
- Налады: `READER_PYTHON`, `READER_SCRIPT_PATH`, `OCR_LANG`.

Калі ў назвах шмат `scan_unreadable`, звычайна гэта азначае, што OCR не атрымаў чытэльны тэкст з файла.

## Налады правіл назваў

Файл `rules.prompt.txt` — твае агульныя правілы наймення.

## Хуткі працоўны сцэнар

1. запусціць `apply`
2. пры неабходнасці перапыніць
3. запусціць `apply` зноў — агент працягне па ignore-лісце
