import fs from "node:fs/promises";
import path from "node:path";

function normalizeRelPath(p) {
  return String(p || "").replaceAll("\\", "/").replace(/^\.\//, "").trim();
}

export async function readIgnoreList(ignoreListPath) {
  try {
    const raw = await fs.readFile(ignoreListPath, "utf8");
    const rows = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map(normalizeRelPath);
    return new Set(rows);
  } catch {
    return new Set();
  }
}

export async function appendIgnoreEntries(ignoreListPath, entries) {
  const normalized = entries.map(normalizeRelPath).filter(Boolean);
  if (normalized.length === 0) return;

  const existing = await readIgnoreList(ignoreListPath);
  const toAdd = normalized.filter((item) => !existing.has(item));
  if (toAdd.length === 0) return;

  await fs.mkdir(path.dirname(ignoreListPath), { recursive: true });

  const fileExists = await fs
    .access(ignoreListPath)
    .then(() => true)
    .catch(() => false);

  const header = fileExists
    ? ""
    : [
        "# Files already processed by rename-agent",
        "# One relative path per line",
      ].join("\n") + "\n";

  await fs.appendFile(ignoreListPath, `${header}${toAdd.join("\n")}\n`, "utf8");
}
