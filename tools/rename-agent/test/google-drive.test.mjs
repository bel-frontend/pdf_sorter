import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  driveQueryLiteral,
  mimeTypeFor,
  uploadSortedOperations,
} from "../src/desktop/google-drive.mjs";

test("escapes Drive queries and detects common file types", () => {
  assert.equal(driveQueryLiteral("client's\\folder"), "client\\'s\\\\folder");
  assert.equal(mimeTypeFor("scan.PDF"), "application/pdf");
  assert.equal(mimeTypeFor("archive.bin"), "application/octet-stream");
});

test("uploads a sorted file into matching Drive folders", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "file-garden-drive-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sortedDirectory = path.join(root, "certificates");
  const filePath = path.join(sortedDirectory, "certificate.pdf");
  await fs.mkdir(sortedDirectory);
  await fs.writeFile(filePath, "%PDF-1.4\npdf payload");

  const originalFetch = globalThis.fetch;
  const calls = [];
  const replies = [
    new Response(JSON.stringify({ files: [] })),
    new Response(JSON.stringify({ id: "root-id", name: "File Garden" })),
    new Response(JSON.stringify({ files: [] })),
    new Response(JSON.stringify({ id: "category-id", name: "certificates" })),
    new Response(JSON.stringify({ files: [] })),
    new Response(null, { status: 200, headers: { location: "https://upload.test/session" } }),
    new Response(JSON.stringify({ id: "file-id", name: "certificate.pdf" })),
  ];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return replies.shift();
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const progress = [];
  const result = await uploadSortedOperations({
    operations: [{ id: "one", from: "before.pdf", to: filePath }],
    rootName: "File Garden",
    getAccessToken: async () => "access-token",
    onProgress: (value) => progress.push(value),
  });

  assert.equal(result.completed.length, 1);
  assert.equal(result.failures.length, 0);
  assert.equal(result.root.id, "root-id");
  assert.equal(progress[0].status, "completed");
  assert.equal(calls.at(-1).url, "https://upload.test/session");
  assert.equal(calls.at(-1).options.method, "PUT");
});
