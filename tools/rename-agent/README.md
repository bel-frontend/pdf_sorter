# Rename Agent (Node.js + LangChain)

Агент для:
- асэнсаванага перайменавання файлаў (`apply`),
- сартыроўкі па катэгорыях (`organize` / `organize:smart`).

Акрамя CLI праект мае desktop GUI **File Garden** для macOS і Linux. У ім
можна выбіраць асобныя файлы і папкі, задаваць правілы сваімі словамі,
рэдагаваць план перад ужываннем і адмяняць апошні запуск.

## Desktop GUI

```bash
# Рэжым распрацоўкі з hot reload
npm --prefix tools/rename-agent run gui:dev

# Звычайны лакальны запуск
npm --prefix tools/rename-agent run gui

# Лакальная macOS .app
npm --prefix tools/rename-agent run gui:dist:mac

# Linux x64 AppImage (запускаць у Linux)
npm --prefix tools/rename-agent run gui:dist:linux
```

Гатовыя зборкі з'яўляюцца ў `tools/rename-agent/release/`. GitHub workflow
`Desktop builds` таксама збірае macOS `.app` і Linux AppImage пры ручным
запуску або для тэгаў `desktop-v*`.

Desktop GUI не патрабуе `.env`: правайдар, мадэлі, API-ключы, Ollama URL,
Python і мовы OCR задаюцца ў блоку «Мадэль». API-ключы захоўваюцца асобна ад
астатніх налад і шыфруюцца праз сістэмнае бяспечнае сховішча Electron
(macOS Keychain або Linux secret storage). Канфіг `.env` ніжэй патрэбны толькі
для CLI-каманд.

## CLI: падтрымліваемыя мадэлі

У CLI мадэль выбіраецца толькі па імені (`--model` або `.env`).
Калі мадэль не ў whitelist, агент спыняецца з памылкай `Unsupported model`.

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

## Устаноўка

Каманды ніжэй выконвай з кораня праекта `file_rename`.

```bash
npm --prefix tools/rename-agent install
cp .env.example .env
```

## Канфіг `.env` (у корані праекта)

```env
# Default model priority:
# 1) LLM_MODEL
# 2) OPENAI_MODEL (only with OPENAI_API_KEY)
# 3) OLLAMA_MODEL
# 4) GOOGLE_MODEL (only with GOOGLE_GEMINI_API_KEY)
# Fallback: gpt-oss:20b
LLM_MODEL=gpt-4o-mini

# OpenAI
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
OPENAI_TIMEOUT_MS=90000
OPENAI_MAX_RETRIES=2

# Ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gpt-oss:20b

# Google
GOOGLE_GEMINI_API_KEY=
GOOGLE_MODEL=gemini-2.5-pro

# Runtime
TARGET_DIR=
DRY_RUN=true
# rename-flow ignore list (apply)
RENAME_IGNORE_LIST_PATH=
# backward-compatible alias for rename-flow ignore list
IGNORE_LIST_PATH=
UPDATE_IGNORE_LIST=true
# organize-flow ignore list (organize / organize:smart)
ORGANIZE_IGNORE_LIST_PATH=
ORGANIZE_UPDATE_IGNORE_LIST=true
NAMING_LANG=en

# OCR
READER_PYTHON=python3
OCR_LANG=pol+eng+rus

# Smart organize vision model (optional)
VISION_MODEL=gpt-4o
# Example for local Ollama vision:
# VISION_MODEL=gemma3:4b
```

## Скрыпты

- `npm run apply` — перайменаванне (dry-run па змаўчанні)
- `npm run apply:pdf` — толькі pdf
- `npm run apply:photos` — толькі выявы
- `npm run apply:docs` — толькі doc/docx/xml
- `npm run organize` — сартыроўка па ключавых словах
- `npm run organize:smart` — LLM-класіфікацыя (тэкст + vision)

## Хуткая табліца флагаў (аднолькава для рэжымаў)

| Рэжым | Каманда | Агульныя флагі |
|---|---|---|
| rename all | `npm run apply -- ...` | `--target-dir`, `--dry-run`, `--apply`, `--model`, `--ollama-base-url`, `--limit`, `--ignore-list`, `--no-update-ignore-list` |
| rename pdf/photos/docs | `npm run apply:pdf -- ...` / `apply:photos` / `apply:docs` | тыя ж, што і вышэй |
| organize | `npm run organize -- ...` | `--target-dir`, `--dry-run`, `--apply`, `--model`, `--ollama-base-url`, `--limit`, `--ignore-list`, `--no-update-ignore-list`, `--out-dir` |
| organize smart | `npm run organize:smart -- ...` | тыя ж, што ў `organize` (`--smart` уключаны скрыптам) |

## Флагі: `apply`

| Флаг | Апісанне | Па змаўчанні |
|---|---|---|
| `--target-dir <path>` | Каранёвая папка для сканавання | `TARGET_DIR` з `.env` |
| `--apply` | Рэальныя змены (не dry-run) | `false` |
| `--dry-run` | Толькі план, без перайменавання | `true` |
| `--model <name>` | Мадэль са спісу вышэй | `LLM_MODEL` або аўта-выбар па ключах/API (`gpt-oss:20b` як fallback) |
| `--ollama-base-url <url>` | URL Ollama | `http://localhost:11434` |
| `--limit <n>` | Апрацаваць толькі першыя `n` файлаў | `0` (без ліміту) |
| `--include <preset|glob>` | Фільтр файлаў (`all,pdf,photos,docs` або glob) | `all` |
| `--ignore-list <path>` | Шлях да ignore-ліста (rename-flow) | `<project-root>/.rename-agent-ignore-rename.txt` |
| `--no-update-ignore-list` | Не абнаўляць ignore-ліст | `false` |
| `--lang <en|pl|be|ru>` | Мова для назваў | `en` |

## Флагі: `organize` / `organize:smart`

| Флаг | Апісанне | Па змаўчанні |
|---|---|---|
| `--target-dir <path>` | Каранёвая папка | `TARGET_DIR` або `cwd` |
| `--out-dir <name>` | Каранёвая папка выніку ў `target-dir` | `sorted_documents` |
| `--apply` | Рэальнае перамяшчэнне | `false` |
| `--dry-run` | Толькі план | `true` |
| `--limit <n>` | Ліміт файлаў | `0` |
| `--smart` | Уключыць LLM-класіфікацыю | `false` (`true` у `organize:smart`) |
| `--model <name>` | Тэкставая мадэль для smart-рэжыму | як у `apply` |
| `--ollama-base-url <url>` | URL Ollama | `http://localhost:11434` |
| `--ignore-list <path>` | Шлях да ignore-ліста (organize-flow) | `<project-root>/.rename-agent-ignore-organize.txt` |
| `--no-update-ignore-list` | Не абнаўляць organize-ignore-ліст | `false` |

## Прыклады

```bash
# Apply dry-run
npm --prefix tools/rename-agent run apply -- --dry-run --target-dir /Users/serj/Downloads --model gpt-4o-mini

# Apply real
npm --prefix tools/rename-agent run apply -- --target-dir /Users/serj/Downloads --model gpt-5-mini --apply

# Organize by keywords
npm --prefix tools/rename-agent run organize -- --target-dir /Users/serj/Downloads --dry-run

# Organize smart with local Ollama model
npm --prefix tools/rename-agent run organize:smart -- --target-dir /Users/serj/Downloads --model gpt-oss:20b --dry-run
```

## Вынікі

У `tools/rename-agent/outputs/`:
- `rename-plan.json`
- `rename-plan.csv`
- `pending-files.txt`
- `organize-plan.json`
- `organize-plan.csv`

## Заўвагі

- `--provider` больш не выкарыстоўваецца.
- Калі паказана непадтрымліваемая мадэль, агент адразу верне памылку са спісам даступных мадэляў.
- Агент чытае канфіг толькі з root-файла `.env` у корані праекта.
