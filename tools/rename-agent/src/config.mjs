import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const moduleFile = fileURLToPath(import.meta.url);
const moduleDir = path.dirname(moduleFile);
const projectRoot = path.resolve(moduleDir, "../../..");
dotenv.config({ path: path.join(projectRoot, ".env") });

const INCLUDE_PRESETS = {
  all: "**/*.{pdf,jpg,jpeg,png,tiff,tif,bmp,webp,gif,doc,docx,xml}",
  pdf: "**/*.pdf",
  photos: "**/*.{jpg,jpeg,png,tiff,tif,bmp,webp,gif}",
  docs: "**/*.{doc,docx,xml}",
};

export function parseArgs(argv) {
  const defaultTargetDir = process.env.TARGET_DIR || "";
  const args = {
    targetDir: defaultTargetDir,
    dryRun: String(process.env.DRY_RUN || "true").toLowerCase() !== "false",
    model: "",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    include: [INCLUDE_PRESETS.all],
    exclude: [
      "**/.git/**",
      "**/.venv/**",
      "**/node_modules/**",
      "**/outputs/**",
    ],
    lang: (process.env.NAMING_LANG || "en").toLowerCase(),
    limit: 0,
    ignoreListPath: process.env.IGNORE_LIST_PATH || "",
    updateIgnoreList:
      String(process.env.UPDATE_IGNORE_LIST || "true").toLowerCase() !==
      "false",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--apply") args.dryRun = false;
    if (token === "--dry-run") args.dryRun = true;
    if (token === "--target-dir") args.targetDir = argv[i + 1];
    if (token === "--model") args.model = argv[i + 1];
    if (token === "--ollama-base-url") args.ollamaBaseUrl = argv[i + 1];
    if (token === "--limit") args.limit = Number(argv[i + 1] || 0);
    if (token === "--ignore-list") args.ignoreListPath = argv[i + 1];
    if (token === "--no-update-ignore-list") args.updateIgnoreList = false;
    if (token === "--lang")
      args.lang = String(argv[i + 1] || "en").toLowerCase();
    if (token === "--include") {
      const val = argv[i + 1] || "";
      // Прасэт (pdf, photos, docs, all) або кастомны glob
      const parts = val
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      args.include = parts.map((p) => INCLUDE_PRESETS[p] || p);
    }
  }

  if (!args.ignoreListPath) {
    args.ignoreListPath = path.join(args.targetDir, ".rename-agent-ignore.txt");
  } else if (!path.isAbsolute(args.ignoreListPath)) {
    args.ignoreListPath = path.resolve(process.cwd(), args.ignoreListPath);
  }

  if (!args.model) {
    args.model =
      process.env.LLM_MODEL ||
      process.env.OPENAI_MODEL ||
      process.env.OLLAMA_MODEL ||
      process.env.GOOGLE_MODEL ||
      "gpt-4o-mini";
  }

  return args;
}
