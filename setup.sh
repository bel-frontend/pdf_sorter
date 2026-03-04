#!/bin/bash
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$PROJECT_ROOT/tools/rename-agent"
ENV_FILE="$AGENT_DIR/.env"

echo "=== File Rename Agent — setup ==="
echo "Project root: $PROJECT_ROOT"
echo ""

# 1. Python venv
echo "[1/3] Python venv..."
if [ ! -d "$PROJECT_ROOT/.venv" ]; then
    python3 -m venv "$PROJECT_ROOT/.venv"
    echo "  venv created"
else
    echo "  venv already exists"
fi
"$PROJECT_ROOT/.venv/bin/pip" install --quiet pdfplumber pytesseract Pillow pdf2image PyMuPDF
echo "  pip packages installed"

# 2. Node.js dependencies
echo "[2/3] Node.js dependencies..."
cd "$AGENT_DIR"
npm install --silent
echo "  npm packages installed"

# 3. .env
echo "[3/3] Configuration (.env)..."
if [ ! -f "$ENV_FILE" ]; then
    sed "s|READER_PYTHON=python3|READER_PYTHON=$PROJECT_ROOT/.venv/bin/python|" \
        "$AGENT_DIR/.env.example" > "$ENV_FILE"
    echo "  .env created from template"
    echo ""
    echo ">>> IMPORTANT: add your API key to $ENV_FILE"
    echo "    Edit the file and set OPENAI_API_KEY, GOOGLE_GEMINI_API_KEY, or configure Ollama."
else
    echo "  .env already exists, skipping"
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Quick start:"
echo "  cd $AGENT_DIR"
echo "  npm run apply -- --dry-run --target-dir /path/to/your/documents"
echo ""
echo "Or from anywhere:"
echo "  npm --prefix $AGENT_DIR run apply -- --dry-run --target-dir /path/to/your/documents"
