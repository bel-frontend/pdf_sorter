import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { contentFingerprint } from "../analysis-cache.mjs";

export function storageRoot(file, platform = process.platform) {
  if (platform === "win32") return path.win32.parse(file).root;
  const patterns =
    platform === "darwin"
      ? [/^\/Volumes\/[^/]+/]
      : [
          /^\/run\/media\/[^/]+\/[^/]+/,
          /^\/media\/[^/]+\/[^/]+/,
          /^\/mnt\/[^/]+/,
        ];
  return (
    patterns.map((pattern) => file.match(pattern)?.[0]).find(Boolean) || null
  );
}

export async function inspectLocation(
  file,
  {
    platform = process.platform,
    stat = fs.stat,
    lstat = fs.lstat,
    readlink = fs.readlink,
    access = fs.access,
    depth = 0,
  } = {},
) {
  try {
    const info = await stat(file);
    return info.isFile()
      ? { kind: "available", stat: info }
      : { kind: "missing" };
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(error.code))
      return { kind: "unavailable", error: error.message };
  }
  // A local symlink may point to a temporarily disconnected volume.
  for (
    let current = file;
    current !== path.dirname(current);
    current = path.dirname(current)
  ) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        if (depth >= 8)
          return {
            kind: "unavailable",
            error: "Не ўдалося праверыць сімвалічную спасылку",
          };
        const target = path.resolve(
          path.dirname(current),
          await readlink(current),
          path.relative(current, file),
        );
        return inspectLocation(target, {
          platform,
          stat,
          lstat,
          readlink,
          access,
          depth: depth + 1,
        });
      }
      if (info.isDirectory()) {
        await access(current, constants.R_OK | constants.X_OK);
        break;
      }
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code))
        return { kind: "unavailable", error: error.message };
    }
  }
  const root = storageRoot(file, platform);
  if (root) {
    try {
      const mounted = await stat(root);
      await access(root, constants.R_OK | constants.X_OK);
      if (
        !mounted.isDirectory() ||
        (platform !== "win32" &&
          mounted.dev === (await stat(path.dirname(root))).dev)
      )
        return { kind: "unavailable", error: "Дыск не падключаны" };
    } catch {
      return { kind: "unavailable", error: "Дыск недаступны" };
    }
  }
  return { kind: "missing" };
}

export async function resyncCatalog(
  catalog,
  {
    signal,
    inspect = inspectLocation,
    fingerprint = contentFingerprint,
    onProgress = () => {},
    quick = false,
  } = {},
) {
  const locations = catalog.db.prepare("SELECT * FROM locations").all();
  const verified = [];
  for (const location of locations) {
    signal?.throwIfAborted();
    onProgress({
      current: verified.length,
      total: locations.length,
      filePath: location.path,
      phase: "verify",
    });
    let result = await inspect(location.path);
    // Startup checks trust unchanged size and mtime; a manual resync rehashes everything.
    if (
      quick &&
      result.kind === "available" &&
      !location.missing &&
      result.stat.size === location.size &&
      result.stat.mtimeMs === location.mtime
    )
      result = { ...result, actualHash: location.hash };
    else if (result.kind === "available") {
      try {
        const hash = await fingerprint(location.path, signal);
        const after = await inspect(location.path);
        if (
          after.kind !== "available" ||
          after.stat.size !== result.stat.size ||
          after.stat.mtimeMs !== result.stat.mtimeMs
        )
          result = {
            kind: "unavailable",
            error: "Файл змяніўся падчас праверкі",
          };
        else
          result = {
            kind: hash === location.hash ? "available" : "changed",
            stat: after.stat,
            actualHash: hash,
          };
      } catch (error) {
        signal?.throwIfAborted();
        result = { kind: "unavailable", error: error.message };
      }
    }
    verified.push({
      ...location,
      ...result,
      origin: JSON.parse(location.origin),
    });
  }
  // Recheck deletion candidates immediately before the atomic cleanup.
  for (const item of verified.filter((row) => row.kind === "missing")) {
    signal?.throwIfAborted();
    const latest = await inspect(item.path);
    if (latest.kind !== "missing")
      Object.assign(item, {
        kind: "unavailable",
        error: "Шлях змяніўся падчас праверкі; паўтары рэсінк",
      });
  }
  signal?.throwIfAborted();
  const result = catalog.applyResync(verified);
  onProgress({
    current: locations.length,
    total: locations.length,
    phase: "cleanup",
  });
  return result;
}

export async function flushAnalysisCleanup(catalog, directory) {
  const remaining = [],
    errors = [];
  for (const hash of catalog.state("cacheCleanup") || []) {
    if (!/^[a-f0-9]{64}$/.test(hash)) continue;
    try {
      await fs.rm(path.join(directory, hash + ".json"), { force: true });
      await fs.rm(path.join(directory, hash + ".json.tmp"), { force: true });
    } catch (error) {
      remaining.push(hash);
      errors.push({ hash, error: error.message });
    }
  }
  catalog.state("cacheCleanup", remaining);
  return errors;
}
