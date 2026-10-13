import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Catalog } from "../src/desktop/search/catalog.mjs";
import { splitChunks } from "../src/desktop/search/chunks.mjs";
import { OllamaEmbeddings } from "../src/desktop/search/embeddings.mjs";
const stat = { size: 100, mtimeMs: 1 };
function document(catalog, hash, file, text, category = "contracts") {
  catalog.track(hash, file, stat);
  catalog.page(hash, { number: 1, text, method: "text" });
  catalog.coverage(hash, 1);
  catalog.metadata(hash, {
    rename: {
      summary: "Accounting agreement",
      topic: "accounting",
      sortingCategory: category,
      person: category === "medical_records" ? "Smith" : "Kowalski",
      date: "2024-01-02",
    },
  });
}
const vector = (n) => Array.from({ length: 1024 }, (_, i) => (i === n ? 1 : 0));

test("chunks preserve overlap, offsets and context across page boundaries", () => {
  const pages = [
    { number: 1, text: "a".repeat(1700) + " payroll agreement " },
    { number: 2, text: "tax contributions ".repeat(180) },
  ];
  const chunks = splitChunks(pages);
  assert.ok(chunks.length > 2);
  for (let i = 1; i < chunks.length; i++) {
    assert.equal(chunks[i - 1].text.slice(-400), chunks[i].text.slice(0, 400));
    assert.equal(chunks[i].start, chunks[i - 1].end - 400);
    assert.ok(chunks[i].text.length <= 2000);
  }
  assert.ok(
    chunks.some((chunk) => chunk.pageStart === 1 && chunk.pageEnd === 2),
  );
  assert.throws(() => splitChunks(pages, { size: 1000, overlap: 1000 }));
});

test("native vectors rank documents, group chunks and apply source/category/date filters", () => {
  const c = new Catalog(":memory:");
  try {
    document(
      c,
      "a",
      "/files/accounting.pdf",
      "Payroll accounting agreement ".repeat(300),
    );
    document(
      c,
      "b",
      "/files/invoice.pdf",
      "Invoice medical hospital",
      "medical_records",
    );
    c.track("a", "/work/drive.pdf", stat, {
      driveId: "remote",
      account: "test@example.com",
    });
    const a = c.pendingVectors("a", "profile"),
      b = c.pendingVectors("b", "profile");
    c.putVectors(
      "profile",
      a,
      a.map(() => vector(0)),
    );
    c.putVectors(
      "profile",
      b,
      b.map(() => vector(1)),
    );
    const hits = c.search({
      query: "бухгалтар",
      vector: vector(0),
      profile: "profile",
    });
    assert.equal(hits.length, 2);
    assert.equal(hits[0].id, "a");
    assert.equal(hits[0].locations.length, 2);
    assert.ok(hits[0].matches.length <= 3);
    assert.equal(
      c.search({
        query: "x",
        vector: vector(0),
        profile: "profile",
        filters: {
          category: "contracts",
          source: "drive",
          dateFrom: "2024-01-01",
          dateTo: "2024-12-31",
        },
      }).length,
      1,
    );
    assert.equal(
      c.search({ query: "x", vector: vector(0), profile: "other-profile" })
        .length,
      0,
    );
    assert.equal(c.search({ query: "Kowalski", mode: "exact" })[0].id, "a");
  } finally {
    c.close();
  }
});

test("rename, move and undo retain vectors and searchable current filenames", () => {
  const c = new Catalog(":memory:");
  try {
    document(c, "a", "/files/old.pdf", "Text");
    const chunks = c.pendingVectors("a", "p");
    c.putVectors(
      "p",
      chunks,
      chunks.map(() => vector(0)),
    );
    c.move("/files/old.pdf", "/sorted/new.pdf");
    assert.equal(
      c.search({ mode: "exact", query: "new" })[0].locations[0].path,
      "/sorted/new.pdf",
    );
    assert.equal(c.search({ mode: "exact", query: "old" }).length, 0);
    assert.equal(c.pendingVectors("a", "p").length, 0);
    c.move("/sorted/new.pdf", "/files/old.pdf");
    assert.equal(c.pendingVectors("a", "p").length, 0);
    c.missing("/files/old.pdf");
    assert.equal(
      c.search({ query: "x", vector: vector(0), profile: "p" }).length,
      0,
    );
  } finally {
    c.close();
  }
});

test("catalog survives restart, marks partial coverage and reuses unchanged chunks", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fg-catalog-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "catalog.sqlite");
  let c = new Catalog(file);
  document(c, "a", "/file.pdf", "Page 1");
  c.page("a", { number: 2, text: "", method: "ocr", error: "OCR failed" });
  assert.equal(c.coverage("a", 2), "partial");
  const chunks = c.pendingVectors("a", "p");
  c.putVectors(
    "p",
    chunks,
    chunks.map(() => vector(0)),
  );
  c.close();
  c = new Catalog(file);
  try {
    assert.equal(c.document("a").coverage, "partial");
    assert.equal(c.document("a").pages[1].error, "OCR failed");
    c.rebuild("a");
    assert.equal(c.pendingVectors("a", "p").length, 0);
    c.track("changed", "/file.pdf", { size: 200, mtimeMs: 2 });
    assert.equal(
      c.search({ query: "x", vector: vector(0), profile: "p" }).length,
      0,
    );
  } finally {
    c.close();
  }
});

test("embedding adapter validates dimensions, adds retrieval instruction and versions model digest", async () => {
  let last,
    digest = "version-1";
  const provider = new OllamaEmbeddings({
    model: "qwen3-embedding:0.6b",
    fetchImpl: async (url, options) => {
      if (url.endsWith("/api/tags"))
        return Response.json({
          models: [{ name: "qwen3-embedding:0.6b", digest }],
        });
      last = JSON.parse(options.body);
      return Response.json({ embeddings: last.input.map(() => vector(0)) });
    },
  });
  const initial = await provider.ready();
  await provider.embedQuery("знайсці дамову");
  assert.match(last.input[0], /^Instruct:/);
  assert.equal(last.truncate, false);
  await provider.embedDocuments(["raw document"]);
  assert.equal(last.input[0], "raw document");
  digest = "version-2";
  assert.notEqual(await provider.ready(), initial);
  const invalid = new OllamaEmbeddings({
    model: "qwen3-embedding:0.6b",
    fetchImpl: async () => Response.json({ embeddings: [[1, 2]] }),
  });
  await assert.rejects(invalid.embedDocuments(["x"]), /1024/);
});

test("larger Qwen models use their full dimensions and cannot share smaller-model vectors", async () => {
  const catalog = new Catalog(":memory:");
  document(catalog, "a", "/invoice.pdf", "Invoice text");
  const profiles = new Set();
  try {
    for (const [model, dimensions] of [
      ["qwen3-embedding:0.6b", 1024],
      ["qwen3-embedding:4b", 2560],
      ["qwen3-embedding:8b", 4096],
    ]) {
      let body;
      const provider = new OllamaEmbeddings({
        model,
        fetchImpl: async (url, options) => {
          if (url.endsWith("/api/tags"))
            return Response.json({ models: [{ name: model, digest: "test" }] });
          body = JSON.parse(options.body);
          return Response.json({
            embeddings: body.input.map(() =>
              Array.from({ length: dimensions }, (_, i) => (i === 0 ? 1 : 0)),
            ),
          });
        },
      });
      const profile = await provider.ready();
      profiles.add(profile);
      const chunks = catalog.pendingVectors("a", profile);
      catalog.putVectors(
        profile,
        chunks,
        await provider.embedDocuments(chunks.map((c) => c.text)),
      );
      assert.equal(body.dimensions, dimensions);
      const query = await provider.embedQuery("інвойс");
      assert.equal(
        catalog.search({ query: "інвойс", vector: query, profile })[0].id,
        "a",
      );
      assert.equal(catalog.pendingVectors("a", profile).length, 0);
    }
    assert.equal(profiles.size, 3);
    assert.equal(new OllamaEmbeddings().model, "qwen3-embedding:8b");
  } finally {
    catalog.close();
  }
});

test("applied sorting category overrides model metadata and undo restores it without new embeddings", () => {
  const c = new Catalog(":memory:");
  try {
    document(c, "a", "/in/record.pdf", "Contract text");
    const chunks = c.pendingVectors("a", "p");
    c.putVectors(
      "p",
      chunks,
      chunks.map(() => vector(0)),
    );
    c.move("/in/record.pdf", "/sorted/invoices/record.pdf", "invoices");
    assert.equal(
      c.search({
        mode: "exact",
        query: "",
        filters: { category: "invoices" },
      })[0].category,
      "invoices",
    );
    assert.equal(
      c.search({ mode: "exact", query: "", filters: { category: "contracts" } })
        .length,
      0,
    );
    assert.equal(c.pendingVectors("a", "p").length, 0);
    c.move("/sorted/invoices/record.pdf", "/in/record.pdf");
    assert.equal(
      c.search({
        mode: "exact",
        query: "",
        filters: { category: "contracts" },
      })[0].category,
      "contracts",
    );
    assert.equal(c.pendingVectors("a", "p").length, 0);
  } finally {
    c.close();
  }
});

test("coarse dates match overlapping ranges and source filters return the matching copies", () => {
  const c = new Catalog(":memory:");
  try {
    document(c, "a", "/local.pdf", "Document");
    c.metadata("a", {
      rename: {
        summary: "Annual document",
        date: "2024",
        sortingCategory: "contracts",
      },
    });
    c.track("a", "/drive.pdf", stat, { driveId: "drive-copy" });
    c.track("undated", "/undated.pdf", stat);
    assert.equal(
      c.search({ mode: "exact", query: "", filters: { dateTo: "2024-12-31" } })
        .length,
      1,
    );
    const found = c.search({
      mode: "exact",
      query: "",
      filters: {
        source: "drive",
        dateFrom: "2024-11-01",
        dateTo: "2024-11-30",
      },
    });
    assert.equal(found.length, 1);
    assert.equal(found[0].locations.length, 1);
    assert.equal(found[0].locations[0].path, "/drive.pdf");
    assert.equal(
      c.search({
        mode: "exact",
        query: "",
        filters: { dateFrom: "2025-01-01" },
      }).length,
      0,
    );
  } finally {
    c.close();
  }
});
