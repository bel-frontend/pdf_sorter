import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Catalog } from "../src/desktop/search/catalog.mjs";
import { contentFingerprint } from "../src/desktop/analysis-cache.mjs";
import {
  inspectLocation,
  resyncCatalog,
  flushAnalysisCleanup,
  storageRoot,
} from "../src/desktop/search/resync.mjs";
import { createSearchService } from "../src/desktop/search/service.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fg-resync-"));
  const directory = path.join(root, "catalog"),
    cache = path.join(root, "analysis-cache");
  await fs.mkdir(cache);
  const catalog = new Catalog(path.join(directory, "catalog.sqlite"));
  t.after(async () => {
    try {
      catalog.close();
    } catch {}
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, directory, cache, catalog };
}
async function seed(f, name, content) {
  const file = path.join(f.root, name);
  await fs.writeFile(file, "%PDF-1.4\n" + content);
  const hash = await contentFingerprint(file);
  f.catalog.track(hash, file, await fs.stat(file));
  f.catalog.page(hash, { number: 1, text: content, method: "text" });
  f.catalog.coverage(hash, 1);
  f.catalog.metadata(hash, { rename: { summary: content, topic: "invoice" } });
  for (const [profile, dimensions] of [
    ["small", 1024],
    ["large", 4096],
  ]) {
    const chunks = f.catalog.pendingVectors(hash, profile);
    f.catalog.putVectors(
      profile,
      chunks,
      chunks.map(() =>
        Array.from({ length: dimensions }, (_, i) => (i === 0 ? 1 : 0)),
      ),
    );
  }
  f.catalog.state("legacy:" + hash, true);
  f.catalog.state("move:" + hash + ":destination", { from: file });
  await fs.writeFile(
    path.join(f.cache, hash + ".json"),
    JSON.stringify({ fingerprint: hash, extractedText: content }),
  );
  await fs.writeFile(path.join(f.cache, hash + ".json.tmp"), content);
  return { file, hash };
}

test("resync removes all metadata and vector versions for lost documents but preserves surviving and offline copies", async (t) => {
  const f = await fixture(t);
  const keep = await seed(f, "keep.pdf", "retained invoice"),
    gone = await seed(f, "gone.pdf", "discarded secret"),
    offline = await seed(f, "offline-source.pdf", "offline evidence");
  const copy = path.join(f.root, "copy.pdf");
  await fs.copyFile(keep.file, copy);
  f.catalog.track(keep.hash, copy, await fs.stat(copy));
  const disconnected =
    "/Volumes/FileGardenAbsent-" + path.basename(f.root) + "/offline.pdf";
  f.catalog.track(offline.hash, disconnected, await fs.stat(offline.file));
  await fs.unlink(offline.file);
  await fs.unlink(keep.file);
  await fs.unlink(gone.file);
  const removedVectors = f.catalog.db
    .prepare(
      "SELECT count(*) n FROM vectors JOIN chunks ON chunks.id=vectors.chunk WHERE hash=?",
    )
    .get(gone.hash).n;
  const result = await resyncCatalog(f.catalog);
  assert.equal(result.documentsRemoved, 1);
  assert.equal(result.pathsRemoved, 3);
  assert.equal(result.vectorsRemoved, removedVectors);
  assert.equal(result.unavailable, 1);
  assert.equal(f.catalog.document(gone.hash), undefined);
  for (const table of ["pages", "chunks", "jobs", "catalog_fts"])
    assert.equal(
      f.catalog.db
        .prepare(`SELECT count(*) n FROM ${table} WHERE hash=?`)
        .get(gone.hash).n,
      0,
    );
  assert.equal(f.catalog.state("legacy:" + gone.hash), null);
  assert.equal(f.catalog.state("move:" + gone.hash + ":destination"), null);
  assert.equal(f.catalog.document(keep.hash).locations[0].path, copy);
  assert.equal(f.catalog.document(offline.hash).locations[0].missing, 1);
  assert.equal(
    f.catalog.document(offline.hash).pages[0].text,
    "offline evidence",
  );
  assert.deepEqual(await flushAnalysisCleanup(f.catalog, f.cache), []);
  for (const suffix of [".json", ".json.tmp"])
    await assert.rejects(fs.stat(path.join(f.cache, gone.hash + suffix)), {
      code: "ENOENT",
    });
  assert.ok(await fs.stat(path.join(f.cache, keep.hash + ".json")));
  assert.ok(await fs.stat(path.join(f.cache, offline.hash + ".json")));
  assert.equal(f.catalog.status("large").documents, 2);
  assert.deepEqual(f.catalog.db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("mounts, stale mount directories, symlinks and access failures distinguish deletion from unavailable storage", async (t) => {
  const f = await fixture(t);
  const error = (code) => Object.assign(new Error(code), { code });
  const dir = (dev) => ({
    dev,
    isDirectory: () => true,
    isFile: () => false,
    isSymbolicLink: () => false,
  });
  const file = "/Volumes/Drive/deleted.pdf";
  for (const [mounted, expected] of [
    [10, "missing"],
    [1, "unavailable"],
    [null, "unavailable"],
  ]) {
    const stat = async (p) => {
      if (p === "/Volumes") return dir(1);
      if (p === "/Volumes/Drive" && mounted !== null) return dir(mounted);
      throw error("ENOENT");
    };
    assert.equal(
      (
        await inspectLocation(file, {
          platform: "darwin",
          stat,
          lstat: stat,
          access: async () => {},
        })
      ).kind,
      expected,
    );
  }
  assert.equal(
    (
      await inspectLocation(file, {
        stat: async () => {
          throw error("EACCES");
        },
      })
    ).kind,
    "unavailable",
  );
  const link = path.join(f.root, "disconnected.pdf");
  await fs.symlink(
    "/Volumes/FileGardenAbsent-" + path.basename(f.root) + "/file.pdf",
    link,
  );
  assert.equal((await inspectLocation(link)).kind, "unavailable");
  assert.equal(storageRoot("C:\\folder\\file.pdf", "win32"), "C:\\");
  assert.equal(
    storageRoot("\\\\server\\share\\file.pdf", "win32"),
    "\\\\server\\share\\",
  );
  assert.equal(
    storageRoot("/media/user/drive/file.pdf", "linux"),
    "/media/user/drive",
  );
});

test("cancelled or raced deletion checks preserve the complete index and restore aliases without new vectors", async (t) => {
  const f = await fixture(t),
    item = await seed(f, "race.pdf", "saved invoice");
  await fs.unlink(item.file);
  const controller = new AbortController();
  await assert.rejects(
    resyncCatalog(f.catalog, {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }),
    { name: "AbortError" },
  );
  assert.ok(f.catalog.document(item.hash));
  assert.ok(await fs.stat(path.join(f.cache, item.hash + ".json")));
  let calls = 0;
  const result = await resyncCatalog(f.catalog, {
    inspect: async (file) => {
      if (++calls === 1) return { kind: "missing" };
      await fs.writeFile(file, "%PDF-1.4\nsaved invoice");
      return inspectLocation(file);
    },
  });
  assert.equal(result.documentsRemoved, 0);
  assert.equal(f.catalog.document(item.hash).locations[0].missing, 1);
  const vectors = f.catalog.status("large").vectors;
  const restored = await resyncCatalog(f.catalog);
  assert.equal(restored.restored, 1);
  assert.equal(f.catalog.document(item.hash).locations[0].missing, 0);
  assert.equal(f.catalog.status("large").vectors, vectors);
});

test("same-size changed contents discard the old version and enqueue reading of the new content", async (t) => {
  const f = await fixture(t),
    item = await seed(f, "changed.pdf", "old invoice");
  const before = await fs.stat(item.file);
  await fs.writeFile(item.file, "%PDF-1.4\nnew invoice");
  await fs.utimes(item.file, before.atime, before.mtime);
  const result = await resyncCatalog(f.catalog);
  assert.equal(result.changed, 1);
  assert.equal(result.documentsRemoved, 1);
  assert.equal(f.catalog.document(item.hash), undefined);
  const next = await contentFingerprint(item.file);
  assert.equal(f.catalog.locate(item.file).hash, next);
  assert.equal(f.catalog.job("read").hash, next);
  assert.equal(f.catalog.document(next).pages.length, 0);
});

test("cache cleanup failures remain durable and replay after restart", async (t) => {
  const f = await fixture(t),
    hash = "a".repeat(64);
  const blocked = path.join(f.cache, hash + ".json");
  await fs.mkdir(blocked);
  f.catalog.state("cacheCleanup", [hash]);
  assert.equal((await flushAnalysisCleanup(f.catalog, f.cache)).length, 1);
  f.catalog.close();
  const reopened = new Catalog(path.join(f.directory, "catalog.sqlite"));
  try {
    assert.deepEqual(reopened.state("cacheCleanup"), [hash]);
    await fs.rename(blocked, blocked + ".unrelated-directory");
    assert.deepEqual(await flushAnalysisCleanup(reopened, f.cache), []);
    assert.deepEqual(reopened.state("cacheCleanup"), []);
    assert.ok(await fs.stat(blocked + ".unrelated-directory"));
  } finally {
    reopened.close();
  }
});

test("startup migration and explicit worker resync prune deleted files without OCR or embedding requests", async (t) => {
  const f = await fixture(t),
    gone = await seed(f, "lost.pdf", "lost invoice"),
    keep = await seed(f, "kept.pdf", "kept invoice");
  f.catalog.state("paused", true);
  f.catalog.close();
  await fs.unlink(gone.file);
  const service = createSearchService(f.directory, {
    model: "qwen3-embedding:0.6b",
    baseUrl: "http://127.0.0.1:1",
    python: "must-not-run",
    script: "must-not-run",
    size: 2000,
    overlap: 400,
  });
  try {
    const state = await service.call("migrate", {
      files: [gone.file],
      origins: {},
    });
    assert.equal(state.documents, 1);
    assert.equal(state.lastResync.documentsRemoved, 1);
    assert.equal(state.resync, null);
    assert.equal(state.foreground, false);
    await assert.rejects(fs.stat(path.join(f.cache, gone.hash + ".json")), {
      code: "ENOENT",
    });
    assert.equal(
      (
        await service.call("search", {
          query: "kept",
          mode: "exact",
          filters: {},
          limit: 20,
        })
      )[0].id,
      keep.hash,
    );
    await fs.unlink(keep.file);
    const cleaned = await service.call("resync");
    assert.equal(cleaned.documents, 0);
    assert.equal(cleaned.jobs.length, 0);
    assert.equal(cleaned.lastResync.documentsRemoved, 1);
    assert.equal(cleaned.resync, null);
    assert.equal(cleaned.paused, true);
  } finally {
    await service.close();
  }
});

test("foreground file operations preempt resync and its retry preserves a renamed document", async (t) => {
  const f = await fixture(t),
    file = path.join(f.root, "large.pdf"),
    target = path.join(f.root, "renamed.pdf");
  const data = Buffer.alloc(16 * 1024 * 1024, 65);
  data.write("%PDF-1.4\n");
  await fs.writeFile(file, data);
  const hash = await contentFingerprint(file);
  f.catalog.track(hash, file, await fs.stat(file));
  f.catalog.page(hash, {
    number: 1,
    text: "Retained large document",
    method: "text",
  });
  f.catalog.coverage(hash, 1);
  f.catalog.state("paused", true);
  f.catalog.close();
  let service,
    suspend,
    requested = false;
  service = createSearchService(
    f.directory,
    {
      model: "qwen3-embedding:0.6b",
      baseUrl: "http://127.0.0.1:1",
      python: "must-not-run",
      script: "must-not-run",
      size: 2000,
      overlap: 400,
    },
    (event, value) => {
      if (
        event === "status" &&
        value.resync?.phase === "verify" &&
        !requested
      ) {
        requested = true;
        suspend = service.call("suspend", true);
      }
    },
  );
  try {
    const result = await service.call("resync");
    await suspend;
    assert.equal(result.lastResync.cancelled, true);
    assert.equal((await service.call("status")).documents, 1);
    await fs.rename(file, target);
    await service.call("move", { from: file, to: target });
    await service.call("suspend", false);
    let state;
    for (let i = 0; i < 150; i++) {
      state = await service.call("status");
      if (!state.resync && !state.lastResync.cancelled) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(state.lastResync.documentsRemoved, 0);
    assert.equal(state.lastResync.cancelled, undefined);
    assert.equal(await service.call("lookup", { id: hash }), target);
    assert.equal(
      await service.call("sample", target),
      "Retained large document",
    );
  } finally {
    await service.close();
  }
});

test("quick resync trusts unchanged size and mtime but rehashes modified files", async (t) => {
  const f = await fixture(t);
  const same = await seed(f, "same.pdf", "unchanged invoice"),
    edited = await seed(f, "edited.pdf", "original text");
  await fs.writeFile(edited.file, "%PDF-1.4\nreplaced text, longer");
  const hashed = [];
  const result = await resyncCatalog(f.catalog, {
    quick: true,
    fingerprint: async (file, signal) => {
      hashed.push(file);
      return contentFingerprint(file, signal);
    },
  });
  assert.deepEqual(hashed, [edited.file]);
  assert.equal(result.changed, 1);
  assert.equal(f.catalog.locate(same.file).hash, same.hash);
});
