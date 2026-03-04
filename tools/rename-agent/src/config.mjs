import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

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
    provider: (process.env.LLM_PROVIDER || "openai").toLowerCase(),
    model: "",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    include: [INCLUDE_PRESETS.all],
    exclude: [
      "**/.git/**",
      "**/.venv/**",
      "**/node_modules/**",
      "**/outputs/**",
    ],
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
    if (token === "--provider")
      args.provider = String(argv[i + 1] || "").toLowerCase();
    if (token === "--model") args.model = argv[i + 1];
    if (token === "--ollama-base-url") args.ollamaBaseUrl = argv[i + 1];
    if (token === "--limit") args.limit = Number(argv[i + 1] || 0);
    if (token === "--ignore-list") args.ignoreListPath = argv[i + 1];
    if (token === "--no-update-ignore-list") args.updateIgnoreList = false;
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

  if (!["openai", "ollama", "google", "auto"].includes(args.provider)) {
    throw new Error(
      `Unsupported provider: ${args.provider}. Use openai, ollama, google or auto.`,
    );
  }

  if (args.provider === "ollama" && !process.env.OLLAMA_MODEL && !args.model) {
    args.model = "gpt-oss:20b";
  }

  if (args.provider === "google" && !process.env.GOOGLE_MODEL && !args.model) {
    args.model = "gemini-2.5-pro";
  }

  if (!args.model) {
    if (args.provider === "ollama") {
      args.model = process.env.OLLAMA_MODEL || "gpt-oss:20b";
    } else if (args.provider === "google") {
      args.model = process.env.GOOGLE_MODEL || "gemini-2.5-pro";
    } else {
      args.model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    }
  }

  return args;
}
