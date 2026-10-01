import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import mammoth from "mammoth";

const execFileAsync = promisify(execFile);
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_READER_SCRIPT = path.resolve(
  MODULE_DIR,
  "../../read_document.py",
);

const textExt = new Set([".xml", ".txt", ".csv", ".json", ".md"]);
const pdfAndImageExt = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".tiff",
  ".tif",
  ".bmp",
  ".webp",
  ".gif",
]);

async function readTextSafe(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.slice(0, 12000);
  } catch {
    return "";
  }
}

async function readDocxSafe(filePath) {
  try {
    const out = await mammoth.extractRawText({ path: filePath });
    return String(out.value || "").slice(0, 12000);
  } catch {
    return "";
  }
}

async function readDocSafe(filePath) {
  try {
    const { stdout } = await execFileAsync(
      "textutil",
      ["-convert", "txt", "-stdout", filePath],
      {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 60_000,
      },
    );
    return String(stdout || "").slice(0, 12000);
  } catch {
    return "";
  }
}

async function readPdfOrImageSafe(filePath) {
  const workspaceRoot = path.resolve(MODULE_DIR, "../../..");
  const venvPython = path.join(workspaceRoot, ".venv", "bin", "python");
  const configuredPython = process.env.READER_PYTHON;
  const readerScript = process.env.READER_SCRIPT_PATH || DEFAULT_READER_SCRIPT;
  const ocrLang = process.env.OCR_LANG || "en,ru,be,uk";

  const pythonCandidates = [
    ...new Set([configuredPython, venvPython, "python3"].filter(Boolean)),
  ];
  const errors = [];

  for (const python of pythonCandidates) {
    try {
      const { stdout, stderr } = await execFileAsync(
        python,
        [
          readerScript,
          filePath,
          "--mode",
          "auto",
          "--lang",
          ocrLang,
          "--smart-pages",
        ],
        {
          maxBuffer: 20 * 1024 * 1024,
          timeout: 120_000,
        },
      );

      if (stderr) {
        console.error(`[reader] ${path.basename(filePath)}: ${stderr.trim()}`);
      }

      const text = String(stdout || "").trim();
      if (text.length > 0) {
        return text.slice(0, 12000);
      }
    } catch (err) {
      errors.push(`${python}: ${err.message || err}`);
      console.error(
        `[reader] ${path.basename(filePath)}: ${python} failed — ${err.message || err}`,
      );
      // try next python candidate
    }
  }

  throw new Error(
    `Document reader unavailable for ${path.basename(filePath)}. ${errors.join(" | ")}`,
  );
}

export async function extractContent(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (textExt.has(ext)) {
    return readTextSafe(filePath);
  }

  if (ext === ".docx") {
    return readDocxSafe(filePath);
  }

  if (ext === ".doc") {
    return readDocSafe(filePath);
  }

  if (pdfAndImageExt.has(ext)) {
    return readPdfOrImageSafe(filePath);
  }

  return "";
}
