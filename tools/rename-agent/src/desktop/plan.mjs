import fs from "node:fs/promises";
import path from "node:path";

import { assertSafeDocument } from "./file-safety.mjs";

function normalizeKey(value) {
  return path.resolve(value).toLocaleLowerCase();
}

export function sanitizeNamePart(value, fallback = "document") {
  const cleaned = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return (cleaned || fallback).slice(0, 110);
}

export function sanitizeCategory(value) {
  return sanitizeNamePart(value, "other").slice(0, 60);
}

export function formatName(pattern, fields) {
  const allowed = new Set(["category", "topic", "person", "date"]);
  let result = String(pattern || "{category}_{topic}_{date}").replace(
    /\{([^}]+)\}/g,
    (_, token) => (allowed.has(token) ? String(fields[token] || "") : ""),
  );
  result = result
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitizeNamePart(result);
}

export async function reserveUniquePath(desiredPath, reserved = new Set()) {
  const extension = path.extname(desiredPath);
  const base = path.basename(desiredPath, extension);
  const directory = path.dirname(desiredPath);
  let candidate = desiredPath;
  let index = 2;

  while (reserved.has(normalizeKey(candidate)) || (await pathExists(candidate))) {
    candidate = path.join(directory, `${base}__${index}${extension}`);
    index += 1;
  }
  reserved.add(normalizeKey(candidate));
  return candidate;
}

export async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function buildEffectiveOperations(storedPlan, edits) {
  const editsById = new Map((edits || []).map((item) => [item.id, item]));
  const operations = [];
  const errors = [];

  for (const row of storedPlan.rows) {
    const edit = editsById.get(row.id);
    if (!edit || edit.selected === false) continue;

    let targetPath;
    if (storedPlan.mode === "rename") {
      const sourceExtension = path.extname(row.sourcePath).toLowerCase();
      const requested = path.basename(String(edit.proposedName || ""));
      if (!requested || requested !== String(edit.proposedName || "")) {
        errors.push({ id: row.id, message: "Назва файла няправільная" });
        continue;
      }
      if (path.extname(requested).toLowerCase() !== sourceExtension) {
        errors.push({ id: row.id, message: "Нельга змяняць пашырэнне файла" });
        continue;
      }
      targetPath = path.join(path.dirname(row.sourcePath), requested);
    } else {
      const category = sanitizeCategory(edit.category);
      if (!storedPlan.categories.includes(category)) {
        errors.push({ id: row.id, message: "Катэгорыя не ўваходзіць у актыўны спіс" });
        continue;
      }
      targetPath = path.join(
        storedPlan.destination,
        category,
        path.basename(row.category === category && row.targetPath ? row.targetPath : row.sourcePath),
      );
    }

    operations.push({
      id: row.id,
      from: path.resolve(row.sourcePath),
      to: path.resolve(targetPath),
    });
  }

  const targetOwners = new Map();
  for (const operation of operations) {
    const key = normalizeKey(operation.to);
    if (targetOwners.has(key) && normalizeKey(operation.from) !== key) {
      errors.push({ id: operation.id, message: "Такі выніковы шлях ужо выбраны" });
      errors.push({
        id: targetOwners.get(key),
        message: "Такі выніковы шлях ужо выбраны",
      });
    } else {
      targetOwners.set(key, operation.id);
    }
  }

  return { operations, errors };
}

// Resolve collisions again before applying: files may have appeared since analysis,
// or a category may have been edited. Never overwrite another document.
export async function buildPreparedOperations(storedPlan, edits) {
  const built = buildEffectiveOperations(storedPlan, edits);
  if (storedPlan.mode !== 'organize') return built;
  const reserved = new Set();
  built.errors = built.errors.filter(error => error.message !== 'Такі выніковы шлях ужо выбраны');
  for (const operation of built.operations) {
    if (normalizeKey(operation.from) === normalizeKey(operation.to)) continue;
    operation.to = await reserveUniquePath(operation.to, reserved);
  }
  return built;
}

export async function validateOperations(operations, initialErrors = []) {
  const errors = [...initialErrors];
  for (const operation of operations) {
    if (!(await pathExists(operation.from))) {
      errors.push({ id: operation.id, message: "Зыходны файл больш не існуе" });
      continue;
    }
    try {
      await assertSafeDocument(operation.from);
    } catch (error) {
      errors.push({ id: operation.id, message: error.message });
      continue;
    }
    if (
      normalizeKey(operation.from) !== normalizeKey(operation.to) &&
      (await pathExists(operation.to))
    ) {
      errors.push({ id: operation.id, message: "Выніковы файл ужо існуе" });
    }
  }
  return { valid: errors.length === 0, errors, operations };
}

export async function moveFile(from, to, fsApi = fs) {
  if (normalizeKey(from) === normalizeKey(to)) return "skip";
  await fsApi.mkdir(path.dirname(to), { recursive: true });
  try {
    await fsApi.rename(from, to);
    return "rename";
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    await fsApi.copyFile(from, to);
    await fsApi.unlink(from);
    return "copy";
  }
}

export async function applyOperations(operations, onProgress = () => {}) {
  const completed = [];
  const failures = [];
  for (const [index, operation] of operations.entries()) {
    await onProgress({ current: index, total: operations.length,
      ...operation, status: 'processing' });
    try {
      await assertSafeDocument(operation.from);
      const method = await moveFile(operation.from, operation.to);
      if (method !== "skip") completed.push(operation);
      await onProgress({
        current: index + 1,
        total: operations.length,
        id: operation.id,
        from: operation.from,
        to: operation.to,
        status: method === "skip" ? "skipped" : "completed",
      });
    } catch (error) {
      const failure = {
        ...operation,
        error: String(error?.message || error),
      };
      failures.push(failure);
      await onProgress({
        current: index + 1,
        total: operations.length,
        id: operation.id,
        from: operation.from,
        to: operation.to,
        status: "failed",
        error: failure.error,
      });
    }
  }
  return { completed, failures };
}
