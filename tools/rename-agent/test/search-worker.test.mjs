import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:http";
import { createSearchService } from "../src/desktop/search/service.mjs";
import { contentFingerprint } from "../src/desktop/analysis-cache.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(action) {
  for (let i = 0; i < 150; i++) {
    const value = await action();
    if (value) return value;
    await sleep(30);
  }
  throw new Error("Timed out waiting for indexing");
}

test("worker checkpoints pages, resumes without rereading, restores vectors and preserves file identity", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fg-search-worker-"));
  const reader = path.join(root, "reader.py"),
    file = path.join(root, "original.pdf");
  await fs.writeFile(file, "%PDF-1.4\nfile");
  await fs.writeFile(
    reader,
    `import json, sys, time\nfile=sys.argv[1]\nskip=set(map(int,sys.argv[sys.argv.index('--skip-pages')+1].split(','))) if '--skip-pages' in sys.argv else set()\nprint(json.dumps({'type':'info','total':12}),flush=True)\nfor page in ([1,2,3,7,12] if '--smart-pages' in sys.argv else range(1,13)):\n if page in skip: continue\n with open(${JSON.stringify(file + ".readlog")},'a') as log: log.write(str(page)+'\\n')\n print(json.dumps({'type':'page','number':page,'total':12,'text':'payroll special ninth-page' if page==9 else 'generic page '+str(page),'method':'text','error':''}),flush=True)\n time.sleep(.03)\n`,
  );
  let embeddingCalls = 0;
  const server = createServer(async (req, res) => {
    let input = "";
    for await (const bytes of req) input += bytes;
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/tags")
      res.end(
        JSON.stringify({
          models: [
            { name: "qwen3-embedding:0.6b", digest: "fixed" },
            { name: "qwen3-embedding:8b", digest: "larger" },
          ],
        }),
      );
    else {
      embeddingCalls++;
      const body = JSON.parse(input);
      res.end(
        JSON.stringify({
          embeddings: body.input.map((text) =>
            Array.from({ length: body.dimensions }, (_, i) =>
              i === (text.includes("payroll") ? 0 : 1) ? 1 : 0,
            ),
          ),
        }),
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let config = {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    model: "qwen3-embedding:0.6b",
    size: 2000,
    overlap: 400,
    python: "python3",
    script: reader,
    lang: "en",
  };
  let service = createSearchService(path.join(root, "catalog"), config),
    pauseRequested = false;
  t.after(async () => {
    await service.close();
    await new Promise((r) => server.close(r));
    await fs.rm(root, { recursive: true, force: true });
  });
  await service.call("suspend", true);
  const sample = await service.call("sample", file);
  assert.equal(sample.includes("ninth-page"), false);
  const hash = await contentFingerprint(file);
  await service.call("update", {
    file,
    hash,
    metadata: {
      rename: {
        summary: "A document",
        topic: "record",
        date: "2024",
        sortingCategory: "contracts",
      },
    },
  });
  await service.call("pause", true);
  await service.call("suspend", false);
  assert.equal((await service.call("status")).partial, 1);
  await service.call("pause", false);
  await waitFor(async () => {
    const state = await service.call("status");
    if (state.current?.phase === "read" && state.current.page >= 4) {
      await service.call("pause", true);
      pauseRequested = true;
      return true;
    }
    return false;
  });
  assert.ok(pauseRequested);
  const before = await fs.readFile(file + ".readlog", "utf8");
  await service.call("pause", false);
  await waitFor(async () => {
    const state = await service.call("status");
    return (
      state.full === 1 &&
      state.vectors > 0 &&
      !state.current &&
      state.jobs.every((job) => job.state === "done")
    );
  });
  const log = (await fs.readFile(file + ".readlog", "utf8")).trim().split("\n");
  assert.equal(log.length, 12);
  assert.equal(new Set(log).size, 12);
  const found = await service.call("search", {
    query: "payroll",
    mode: "semantic",
    filters: {},
    limit: 20,
  });
  assert.equal(found[0].id, hash);
  assert.equal(found[0].coverage, "full");
  const readsBeforeSettingsChange = await fs.readFile(
    file + ".readlog",
    "utf8",
  );
  config = { ...config, size: 1000, overlap: 200 };
  await service.call("configure", config);
  await waitFor(async () => {
    const state = await service.call("status");
    return (
      state.vectors > 0 &&
      !state.current &&
      state.jobs.every((job) => job.state === "done")
    );
  });
  assert.equal(
    await fs.readFile(file + ".readlog", "utf8"),
    readsBeforeSettingsChange,
  );
  await assert.rejects(
    service.call("lookup", { id: hash, location: "/unowned/file.pdf" }),
    /недаступны/,
  );
  const target = path.join(root, "renamed.pdf");
  await fs.rename(file, target);
  await service.call("move", { from: file, to: target });
  assert.equal(await service.call("lookup", { id: hash }), target);
  const calls = embeddingCalls;
  await service.call("sample", target);
  assert.equal(embeddingCalls, calls);
  await service.close();
  service = createSearchService(path.join(root, "catalog"), config);
  const restored = await service.call("search", {
    query: "payroll",
    mode: "semantic",
    filters: {},
    limit: 20,
  });
  assert.equal(restored[0].locations[0].path, target);
  assert.equal(restored[0].coverage, "full");
  await service.close();
  config = { ...config, model: "qwen3-embedding:8b" };
  service = createSearchService(path.join(root, "catalog"), config);
  await waitFor(async () => {
    const status = await service.call("status");
    return (
      status.model === config.model &&
      status.dimensions === 4096 &&
      status.vectors > 0 &&
      status.jobs.every((job) => job.state === "done")
    );
  });
  assert.equal(
    await fs.readFile(file + ".readlog", "utf8"),
    readsBeforeSettingsChange,
  );
  assert.equal(
    (
      await service.call("search", {
        query: "payroll",
        mode: "semantic",
        filters: {},
        limit: 20,
      })
    )[0].id,
    hash,
  );
  await fs.writeFile(target, "%PDF-1.4\nchanged");
  await assert.rejects(service.call("lookup", { id: hash }), /змянілася/);
});

test("reading a snapshot never mixes changed source bytes and preserves unchanged copies", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fg-search-snapshot-"));
  const file = path.join(root, "original.pdf"),
    copy = path.join(root, "copy.pdf");
  const reader = path.join(root, "reader.py"),
    directory = path.join(root, "catalog");
  const original = "%PDF-1.4\noriginal payroll evidence";
  await fs.writeFile(file, original);
  await fs.writeFile(copy, original);
  await fs.mkdir(path.join(directory, ".read-ABC123"), { recursive: true });
  await fs.writeFile(
    path.join(directory, ".read-ABC123", "interrupted.pdf"),
    original,
  );
  await fs.writeFile(
    reader,
    `import json, sys\nwith open(${JSON.stringify(file)},'w') as output: output.write('%PDF-1.4 changed replacement')\nwith open(sys.argv[1]) as snapshot: text=snapshot.read()\nprint(json.dumps({'type':'info','total':1}),flush=True)\nprint(json.dumps({'type':'page','number':1,'total':1,'text':text,'method':'text','error':''}),flush=True)\n`,
  );
  const service = createSearchService(directory, {
    baseUrl: "http://127.0.0.1:1",
    model: "qwen3-embedding:0.6b",
    size: 2000,
    overlap: 400,
    python: "python3",
    script: reader,
  });
  t.after(async () => {
    await service.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await service.call("suspend", true);
  await service.call("track", { files: [file, copy] });
  assert.equal(await service.call("sample", file), original);
  const hash = await contentFingerprint(copy);
  assert.equal(await service.call("lookup", { id: hash }), copy);
  assert.equal(
    (
      await service.call("search", {
        query: "payroll",
        mode: "exact",
        filters: {},
        limit: 20,
      })
    )[0].id,
    hash,
  );
  assert.equal(
    (await fs.readdir(directory)).some((name) => name.startsWith(".read-")),
    false,
  );
});

test("legacy cache migration indexes available text but never starts full OCR until requested", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fg-search-migrate-"));
  await fs.mkdir(path.join(root, "analysis-cache"));
  const file = path.join(root, "old.pdf");
  await fs.writeFile(file, "%PDF-1.4\nold");
  const hash = await contentFingerprint(file);
  await fs.writeFile(
    path.join(root, "analysis-cache", hash + ".json"),
    JSON.stringify({
      fingerprint: hash,
      rename: { summary: "Saved invoice", topic: "invoice" },
      extractedText: "Saved recognized old text",
    }),
  );
  const service = createSearchService(path.join(root, "catalog"), {
    baseUrl: "http://127.0.0.1:1",
    model: "qwen3-embedding:0.6b",
    size: 2000,
    overlap: 400,
    python: "missing-python",
    script: "missing-reader",
  });
  t.after(async () => {
    await service.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await service.call("pause", true);
  await service.call("migrate", { files: [file], origins: {} });
  const status = await service.call("status");
  assert.equal(status.documents, 1);
  assert.equal(status.partial, 1);
  assert.equal(
    status.jobs.some((job) => job.kind === "read"),
    false,
  );
  assert.equal(
    (
      await service.call("search", {
        query: "invoice",
        mode: "exact",
        filters: {},
        limit: 20,
      })
    )[0].id,
    hash,
  );
});
