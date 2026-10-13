import { parentPort, workerData } from "node:worker_threads";
import fs from "node:fs/promises";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { Catalog } from "./catalog.mjs";
import { OllamaEmbeddings, SqliteVectorStore } from "./embeddings.mjs";
import { digest } from "./chunks.mjs";
import { readPages } from "./extraction.mjs";
import { resyncCatalog, flushAnalysisCleanup } from "./resync.mjs";
import { contentFingerprint } from "../analysis-cache.mjs";
import { assertSafeDocument } from "../file-safety.mjs";
const catalog = new Catalog(
  path.join(workerData.directory, "catalog.sqlite"),
  workerData.config.vectorLibrary,
);
const vectors = new SqliteVectorStore(catalog);
const analysisCacheDirectory = path.join(
  workerData.directory,
  "..",
  "analysis-cache",
);
const cleanupErrors = await flushAnalysisCleanup(
  catalog,
  analysisCacheDirectory,
);
if (catalog.state("lastResync"))
  catalog.state("lastResync", {
    ...catalog.state("lastResync"),
    errors: cleanupErrors,
  });
// Snapshots belong to this worker and may remain after an interrupted process.
for (const entry of await fs.readdir(workerData.directory, {
  withFileTypes: true,
})) {
  if (entry.isDirectory() && /^\.read-[A-Za-z0-9]{6}$/.test(entry.name))
    await fs.rm(path.join(workerData.directory, entry.name), {
      recursive: true,
      force: true,
    });
}
let config = workerData.config,
  provider = new OllamaEmbeddings(config),
  foreground = false,
  paused = catalog.state("paused") === true,
  pumpPromise = null,
  controller = null,
  pullController = null,
  lastError = "",
  current = null,
  profile = catalog.state("profile") || "",
  migration = null,
  nextEmbedAttempt = 0;
catalog.chunkOptions = config;
let sampleController = null;
let resyncTask = null,
  resyncController = null,
  resyncProgress = null,
  needsStartupSync = false;
const configurationKey = () =>
  digest([
    provider.baseUrl,
    provider.model,
    provider.dimensions,
    config.size,
    config.overlap,
    "chunks-v1",
    "query-v1",
  ]);
function reindexSavedText() {
  for (const row of catalog.db
    .prepare(
      "SELECT DISTINCT hash FROM chunks WHERE EXISTS(SELECT 1 FROM locations l WHERE l.hash=chunks.hash AND l.missing=0)",
    )
    .all())
    catalog.enqueue(row.hash, "embed");
}
function configureIndex() {
  const key = configurationKey();
  if (catalog.state("embeddingConfiguration") === key) return;
  catalog.transaction(() => {
    catalog.state("embeddingConfiguration", key);
    catalog.state("profile", "");
    reindexSavedText();
  });
  profile = "";
}
function activateProfile(active) {
  if (profile === active) return;
  catalog.transaction(() => {
    if (profile && profile !== active) reindexSavedText();
    catalog.state("profile", active);
  });
  profile = active;
}
configureIndex();
const status = () => ({
  ...catalog.status(profile),
  paused,
  foreground,
  current,
  error: lastError,
  profile,
  model: provider.model,
  dimensions: provider.dimensions,
  migration,
  pulling: Boolean(pullController),
  resync: resyncProgress,
  lastResync: catalog.state("lastResync"),
});
const publish = () =>
  parentPort.postMessage({ event: "status", data: status() });
async function track(file, origin = {}, expected) {
  file = path.resolve(file);
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error("Не звычайны файл");
  const known = catalog.locate(file);
  const unchanged =
    known &&
    !known.missing &&
    known.size === stat.size &&
    known.mtime === stat.mtimeMs;
  const hash =
    expected || (unchanged ? known.hash : await contentFingerprint(file));
  catalog.track(hash, file, stat, origin);
  return catalog.document(hash);
}
async function extract(doc, smart, signal) {
  const location = doc.locations.find((l) => !l.missing);
  if (!location) throw new Error("Файл недаступны");
  await assertSafeDocument(location.path);
  if ((await contentFingerprint(location.path, signal)) !== doc.hash) {
    catalog.missing(location.path);
    await track(location.path);
    throw new Error("Змесціва змянілася; паўтары індэксацыю");
  }
  let total = doc.total;
  const temporary = await fs.mkdtemp(path.join(workerData.directory, ".read-"));
  const snapshot = path.join(temporary, path.basename(location.path));
  try {
    try {
      await fs.copyFile(
        location.path,
        snapshot,
        constants.COPYFILE_FICLONE_FORCE,
      );
    } catch (error) {
      if (!["ENOTSUP", "EXDEV", "ENOSYS", "EINVAL"].includes(error.code))
        throw error;
      await pipeline(
        createReadStream(location.path),
        createWriteStream(snapshot, { flags: "w", mode: 0o600 }),
        ...(signal ? [{ signal }] : []),
      );
    }
    if ((await contentFingerprint(snapshot, signal)) !== doc.hash) {
      await validateLocation(location);
      throw new Error(
        "Файл змяніўся падчас стварэння копіі; паўтары індэксацыю",
      );
    }
    await readPages(snapshot, {
      ...config,
      smart,
      signal,
      skip: doc.pages.filter((p) => !p.error).map((p) => p.number),
      onInfo: (value) => {
        total = value;
      },
      onPage: (page) => {
        catalog.page(doc.hash, page);
        current = {
          filePath: location.path,
          phase: "read",
          page: page.number,
          totalPages: page.total,
        };
        publish();
      },
    });
    await validateLocation(location);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
    catalog.coverage(doc.hash, total);
  }
  return catalog.document(doc.hash);
}
async function validateLocation(loc) {
  if (catalog.locate(loc.path)?.hash !== loc.hash) return false;
  try {
    const stat = await fs.stat(loc.path);
    if (stat.size !== loc.size || stat.mtimeMs !== loc.mtime) {
      const doc = await track(loc.path, loc.origin);
      if (doc.hash !== loc.hash) {
        catalog.enqueue(doc.hash, "read");
        kick();
        return false;
      }
    }
    return catalog.locate(loc.path)?.hash === loc.hash;
  } catch (error) {
    if (error.code === "ENOENT") {
      catalog.missing(loc.path);
      return false;
    }
    throw error;
  }
}
async function pump() {
  while (!paused && !foreground) {
    const read = catalog.job("read");
    if (read) {
      catalog.jobState(read.hash, "read", "running");
      controller = new AbortController();
      try {
        let doc = catalog.document(read.hash);
        if (doc.coverage !== "full")
          doc = await extract(doc, false, controller.signal);
        catalog.jobState(
          read.hash,
          "read",
          doc.coverage === "full" ? "done" : "error",
          doc.error || "Чытанне няпоўнае",
        );
      } catch (error) {
        catalog.jobState(
          read.hash,
          "read",
          controller.signal.aborted ? "pending" : "error",
          controller.signal.aborted ? "" : error.message,
        );
      } finally {
        controller = null;
        current = null;
        publish();
      }
      continue;
    }
    const job = catalog.job("embed");
    if (!job || Date.now() < nextEmbedAttempt) break;
    controller = new AbortController();
    try {
      const active = await provider.ready(controller.signal);
      activateProfile(active);
      lastError = "";
      catalog.jobState(job.hash, "embed", "running");
      catalog.rebuild(job.hash, config);
      const chunks = catalog.pendingVectors(job.hash, profile);
      // Large models need shorter requests to keep progress and cancellation responsive.
      const batchSize = provider.dimensions > 1024 ? 4 : 16;
      for (let offset = 0; offset < chunks.length; offset += batchSize) {
        controller.signal.throwIfAborted();
        const batch = chunks.slice(offset, offset + batchSize);
        current = {
          phase: "embed",
          filePath: catalog.document(job.hash).locations.find((l) => !l.missing)
            ?.path,
          current: offset,
          total: chunks.length,
        };
        publish();
        vectors.upsert(
          profile,
          batch,
          await provider.embedDocuments(
            batch.map((c) => c.text),
            controller.signal,
          ),
        );
      }
      catalog.jobState(job.hash, "embed", "done");
    } catch (error) {
      if (controller.signal.aborted)
        catalog.jobState(job.hash, "embed", "pending");
      else {
        lastError = error.message;
        catalog.jobState(job.hash, "embed", "error", error.message);
        nextEmbedAttempt = Date.now() + 30000;
      }
    } finally {
      controller = null;
      current = null;
      publish();
    }
  }
}
function kick() {
  if (!pumpPromise && !paused && !foreground)
    pumpPromise = pump()
      .catch((error) => {
        lastError = error.message;
        publish();
      })
      .finally(() => {
        pumpPromise = null;
      });
}
async function stop() {
  controller?.abort();
  if (pumpPromise) await pumpPromise;
}
function beginResync(quick = false) {
  if (resyncTask) return resyncTask.then(status);
  if (foreground || sampleController)
    throw new Error("Дачакайся заканчэння аналізу або пераносу файлаў");
  foreground = true;
  const syncController = (resyncController = new AbortController());
  resyncProgress = { current: 0, total: 0, phase: "verify" };
  publish();
  resyncTask = (async () => {
    await stop();
    try {
      const result = await resyncCatalog(catalog, {
        quick,
        signal: syncController.signal,
        onProgress: (value) => {
          resyncProgress = value;
          publish();
        },
      });
      result.errors = await flushAnalysisCleanup(
        catalog,
        analysisCacheDirectory,
      );
      catalog.state("lastResync", result);
    } catch (error) {
      if (!syncController.signal.aborted) throw error;
      catalog.state("lastResync", {
        cancelled: true,
        checked: resyncProgress?.current || 0,
        finishedAt: new Date().toISOString(),
        errors: [],
      });
    }
  })().finally(() => {
    foreground = false;
    resyncTask = null;
    resyncController = null;
    resyncProgress = null;
    kick();
    publish();
  });
  return resyncTask.then(status);
}
const handlers = {
  shutdown: async () => {
    foreground = true;
    paused = true;
    sampleController?.abort();
    pullController?.abort();
    resyncController?.abort();
    await resyncTask?.catch(() => {});
    foreground = true;
    await stop();
    return true;
  },
  status: async () => status(),
  resync: async () => {
    if (migration) throw new Error("Дачакайся загрузкі каталога");
    return beginResync();
  },
  cancelResync: async () => {
    resyncController?.abort();
    await resyncTask;
    return status();
  },
  configure: async (next) => {
    const wasForeground = foreground;
    foreground = true;
    await stop();
    config = next;
    catalog.chunkOptions = config;
    provider = new OllamaEmbeddings(config);
    configureIndex();
    nextEmbedAttempt = 0;
    foreground = wasForeground;
    kick();
    publish();
    return status();
  },
  suspend: async (value) => {
    if (value && resyncTask) {
      needsStartupSync = true;
      resyncController?.abort();
      await resyncTask.catch(() => {});
    }
    foreground = value;
    if (value) await stop();
    else if (needsStartupSync) {
      needsStartupSync = false;
      beginResync(true).catch((error) => {
        lastError = error.message;
        publish();
      });
    } else kick();
    publish();
    return status();
  },
  pause: async (value) => {
    paused = value;
    catalog.state("paused", paused);
    if (value) await stop();
    else {
      nextEmbedAttempt = 0;
      kick();
    }
    publish();
    return status();
  },
  retry: async () => {
    catalog.db.exec(
      "UPDATE jobs SET state='pending',error='' WHERE state='error'",
    );
    nextEmbedAttempt = 0;
    lastError = "";
    kick();
    publish();
    return status();
  },
  cancelSample: async () => {
    sampleController?.abort();
    return true;
  },
  sample: async (file) => {
    sampleController = new AbortController();
    try {
      const doc = await track(file);
      catalog.state("legacy:" + doc.hash, false);
      const result =
        doc.coverage === "full"
          ? doc
          : await extract(doc, true, sampleController.signal);
      return result.pages
        .filter((p) => !p.error)
        .map((p) => p.text)
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 8000);
    } finally {
      sampleController = null;
    }
  },
  update: async ({ file, hash, metadata }) => {
    const doc = await track(file, {}, hash);
    catalog.metadata(hash, metadata);
    if (doc.coverage !== "full" && catalog.state("legacy:" + hash) !== true)
      catalog.enqueue(hash, "read");
    kick();
    publish();
    return true;
  },
  track: async ({ files, origins = {} }) => {
    for (const file of files) {
      try {
        await track(file, origins[file] || {});
      } catch (error) {
        lastError = error.message;
      }
    }
    publish();
    return true;
  },
  index: async () => {
    for (const doc of catalog.db
      .prepare("SELECT DISTINCT hash FROM locations WHERE missing=0")
      .all()) {
      if (catalog.document(doc.hash).coverage !== "full")
        catalog.enqueue(doc.hash, "read");
      catalog.enqueue(doc.hash, "embed");
    }
    nextEmbedAttempt = 0;
    kick();
    publish();
    return status();
  },
  move: async ({ from, to, category }) => {
    catalog.move(from, to, category);
    publish();
    return true;
  },
  lookup: async ({ id, location = 0 }) => {
    const doc = catalog.document(id);
    const loc =
      typeof location === "string"
        ? doc?.locations.find((l) => !l.missing && l.path === location)
        : doc?.locations.filter((l) => !l.missing)[location];
    if (!loc) throw new Error("Файл недаступны");
    if (!(await validateLocation(loc))) {
      publish();
      throw new Error(
        "Файл адсутнічае або змянілася яго змесціва; абнаві вынікі. Для змененага файла запушчана пераіндэксацыя.",
      );
    }
    return loc.path;
  },
  search: async (options) => {
    let vector;
    if (options.mode === "semantic" && options.query.trim()) {
      const embedder = provider;
      const active = await embedder.ready();
      if (embedder !== provider)
        throw new Error("Налады пошуку змяніліся; паўтары запыт.");
      if (profile && active !== profile) {
        activateProfile(active);
        kick();
        throw new Error(
          "Мадэль змянілася. Індэкс перабудоўваецца з захаванага тэксту.",
        );
      }
      activateProfile(active);
      vector = await embedder.embedQuery(options.query);
      if (embedder !== provider)
        throw new Error("Налады пошуку змяніліся; паўтары запыт.");
      if (!catalog.status(profile).vectors)
        throw new Error(
          "Вектарны індэкс яшчэ не гатовы. Запусці індэксацыю або выберы дакладны пошук.",
        );
    }
    let results = vectors.search({ ...options, vector, profile });
    let invalid = false;
    for (const result of results)
      for (const location of result.locations)
        if (!(await validateLocation(location))) invalid = true;
    if (invalid) {
      results = vectors.search({ ...options, vector, profile });
      publish();
    }
    return results;
  },
  pull: async () => {
    if (pullController) throw new Error("Спампоўванне мадэлі ўжо запушчана");
    pullController = new AbortController();
    publish();
    try {
      await provider.pull(pullController.signal, (data) =>
        parentPort.postMessage({ event: "pull", data }),
      );
      catalog.db.exec(
        "UPDATE jobs SET state='pending',error='' WHERE kind='embed'",
      );
      nextEmbedAttempt = 0;
      lastError = "";
      kick();
      return status();
    } finally {
      pullController = null;
      publish();
    }
  },
  cancelPull: async () => {
    pullController?.abort();
    return true;
  },
  migrate: async ({ files, origins = {} }) => {
    migration = { current: 0, total: files.length };
    publish();
    for (const file of files) {
      try {
        await assertSafeDocument(file);
        const previous = catalog.locate(file);
        const doc = await track(file, origins[file] || {});
        if (previous && previous.hash !== doc.hash)
          catalog.enqueue(doc.hash, "read");
        // Metadata imported on an earlier launch needs no rebuild.
        const metadata =
          doc.metadata.fingerprint === doc.hash
            ? null
            : JSON.parse(
                await fs.readFile(
                  path.join(analysisCacheDirectory, `${doc.hash}.json`),
                  "utf8",
                ),
              );
        if (metadata?.fingerprint === doc.hash) {
          if (!doc.pages.length) catalog.state("legacy:" + doc.hash, true);
          catalog.metadata(doc.hash, metadata);
          catalog.enqueue(doc.hash, "embed");
        }
      } catch (error) {
        if (error.code !== "ENOENT") lastError = error.message;
      }
      migration.current++;
      if (migration.current % 10 === 0) publish();
    }
    migration = null;
    if (!foreground && !sampleController) return beginResync(true);
    needsStartupSync = true;
    kick();
    publish();
    return status();
  },
};
parentPort.on("message", async ({ id, method, args }) => {
  try {
    if (!handlers[method]) throw new Error("Невядомая каманда каталога");
    if (
      resyncTask &&
      ![
        "status",
        "resync",
        "cancelResync",
        "suspend",
        "pause",
        "cancelSample",
        "shutdown",
      ].includes(method)
    )
      await resyncTask;
    const data = await handlers[method](args);
    parentPort.postMessage({ id, data });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message || String(error) });
  }
});
publish();
kick();
