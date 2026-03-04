import path from "node:path";
import fg from "fast-glob";

function normalizeRelPath(p) {
  return String(p || "").replaceAll("\\", "/").replace(/^\.\//, "").trim();
}

export async function collectFiles({ targetDir, include, exclude, limit, ignoredPaths = new Set() }) {
  const entries = await fg(include, {
    cwd: targetDir,
    ignore: exclude,
    onlyFiles: true,
    dot: false,
    unique: true,
    absolute: true,
  });

  const sorted = entries
    .map((absolutePath) => ({
      absolutePath,
      relativePath: path.relative(targetDir, absolutePath),
    }))
    .filter((entry) => !ignoredPaths.has(normalizeRelPath(entry.relativePath)))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  if (limit && limit > 0) {
    return sorted.slice(0, limit);
  }

  return sorted;
}
