import fs from "node:fs/promises";
import path from "node:path";

import { inspectFile, isMacMetadataPath } from "./file-safety.mjs";

export const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".tiff",
  ".tif",
  ".bmp",
  ".webp",
  ".gif",
  ".doc",
  ".docx",
  ".xml",
]);

export function isSupportedFile(filePath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function walk(directory, out, rejected) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    if (isMacMetadataPath(entry.name)) {
      rejected.push({ path: path.join(directory, entry.name), reason: "mac_metadata" });
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walk(absolutePath, out, rejected);
    } else if (entry.isFile() && isSupportedFile(absolutePath)) {
      const issue = await inspectFile(absolutePath).catch(error => ({ reason: "unreadable", message: error.message }));
      if (issue) rejected.push({ path: absolutePath, ...issue });
      else out.push(path.resolve(absolutePath));
    }
  }
}

export async function expandInputPaths(inputPaths) {
  const collected = [];
  const rejected = [];

  for (const rawPath of inputPaths || []) {
    const absolutePath = path.resolve(String(rawPath || ""));
    try {
      const stat = await fs.lstat(absolutePath);
      if (isMacMetadataPath(absolutePath)) {
        rejected.push({ path: absolutePath, reason: "mac_metadata" });
      } else if (stat.isSymbolicLink()) {
        rejected.push({ path: absolutePath, reason: "symbolic_link" });
      } else if (stat.isDirectory()) {
        await walk(absolutePath, collected, rejected);
      } else if (stat.isFile() && isSupportedFile(absolutePath)) {
        const issue = await inspectFile(absolutePath);
        if (issue) rejected.push({ path: absolutePath, ...issue });
        else collected.push(absolutePath);
      } else {
        rejected.push({ path: absolutePath, reason: "unsupported" });
      }
    } catch (error) {
      rejected.push({
        path: absolutePath,
        reason: "unreadable",
        error: String(error?.message || error),
      });
    }
  }

  const unique = [...new Map(collected.map((item) => [item, item])).values()];
  unique.sort((a, b) => a.localeCompare(b));
  return { files: unique, rejected };
}
