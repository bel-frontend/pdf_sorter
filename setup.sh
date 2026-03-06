#!/bin/bash
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$PROJECT_ROOT/tools/rename-agent"
ENV_FILE="$PROJECT_ROOT/.env"
ENV_TEMPLATE="$PROJECT_ROOT/.env.example"
RENAME_IGNORE_FILE="$PROJECT_ROOT/.rename-agent-ignore-rename.txt"
ORGANIZE_IGNORE_FILE="$PROJECT_ROOT/.rename-agent-ignore-organize.txt"

echo "=== File Rename Agent — setup ==="
echo "Project root: $PROJECT_ROOT"
echo ""

# 1. Python venv
echo "[1/4] Python venv..."
if [ ! -d "$PROJECT_ROOT/.venv" ]; then
    python3 -m venv "$PROJECT_ROOT/.venv"
    echo "  venv created"
else
    echo "  venv already exists"
fi
"$PROJECT_ROOT/.venv/bin/pip" install --quiet pdfplumber pytesseract Pillow pdf2image PyMuPDF
echo "  pip packages installed"

# 2. Node.js dependencies
echo "[2/4] Node.js dependencies..."
cd "$AGENT_DIR"
npm install --silent
echo "  npm packages installed"

# 3. .env
echo "[3/4] Configuration (.env)..."
if [ ! -f "$ENV_FILE" ]; then
    sed "s|READER_PYTHON=python3|READER_PYTHON=$PROJECT_ROOT/.venv/bin/python|" \
        "$ENV_TEMPLATE" > "$ENV_FILE"
    echo "  .env created from template"
    echo ""
    echo ">>> IMPORTANT: add your API key to $ENV_FILE"
    echo "    Edit the file and set OPENAI_API_KEY, GOOGLE_GEMINI_API_KEY, or configure Ollama."
else
    echo "  .env already exists, skipping"
fi

# 4. ignore lists
echo "[4/4] Ignore lists..."
for f in "$RENAME_IGNORE_FILE" "$ORGANIZE_IGNORE_FILE"; do
    if [ ! -f "$f" ]; then
        {
            echo "# Files already processed by rename-agent"
            echo "# One relative path per line"
        } > "$f"
        echo "  created: $f"
    else
        echo "  exists: $f"
    fi
done

echo ""
echo "=== Setup complete ==="
echo ""
echo "Quick start:"
echo "  npm run apply -- --dry-run --target-dir /path/to/your/documents"
