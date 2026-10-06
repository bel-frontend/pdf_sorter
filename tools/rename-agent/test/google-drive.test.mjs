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
  let uploadedBytes = '';
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
    if (options.method === 'PUT') {
      const chunks = [];
      for await (const chunk of options.body) chunks.push(chunk);
      uploadedBytes = Buffer.concat(chunks).toString('utf8');
    }
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
  assert.deepEqual(progress.map(event => event.status), ["processing", "completed"]);
  assert.equal(progress[0].filePath, filePath);
  assert.equal(calls.at(-1).url, "https://upload.test/session");
  assert.equal(calls.at(-1).options.method, "PUT");
  assert.equal(calls.at(-1).options.headers['Content-Type'], 'application/pdf');
  assert.equal(uploadedBytes, '%PDF-1.4\npdf payload');
  assert.equal(await fs.readFile(filePath, 'utf8'), uploadedBytes);
});

test('an existing Drive filename is skipped and the local file remains untouched', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fg-drive-duplicate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'invoice.pdf');
  await fs.writeFile(file, '%PDF-1.4\nlocal invoice');
  const originalFetch = globalThis.fetch;
  const replies = [
    { files: [{ id: 'root-id' }] }, { files: [{ id: 'category-id' }] },
    { files: [{ id: 'existing-file', name: 'invoice.pdf' }] },
  ];
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push(options.method || 'GET');
    return new Response(JSON.stringify(replies.shift()));
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await uploadSortedOperations({ operations: [{ id: 'one', from: '/old/invoice.pdf', to: file }], getAccessToken: async () => 'test-token' });
  assert.equal(result.completed[0].driveFile.skipped, true);
  assert.equal(result.failures.length, 0);
  assert.deepEqual(requests, ['GET', 'GET', 'GET']);
  assert.equal(await fs.readFile(file, 'utf8'), '%PDF-1.4\nlocal invoice');
});

test('a failed Drive upload is reported while the next file is copied successfully', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fg-drive-failure-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = ['a.pdf', 'b.pdf'].map(name => path.join(root, name));
  for (const file of files) await fs.writeFile(file, '%PDF-1.4\npayload');
  const originalFetch = globalThis.fetch;
  const replies = [
    new Response(JSON.stringify({ files: [{ id: 'root-id' }] })),
    new Response(JSON.stringify({ files: [{ id: 'category-id' }] })),
    new Response(JSON.stringify({ files: [] })),
    new Response('quota exceeded', { status: 403 }),
    new Response(JSON.stringify({ files: [] })),
    new Response(null, { headers: { location: 'https://upload.test/session' } }),
    new Response(JSON.stringify({ id: 'uploaded-b' })),
  ];
  globalThis.fetch = async (_url, options = {}) => {
    if (options.body?.[Symbol.asyncIterator]) for await (const _chunk of options.body) { /* consume upload */ }
    return replies.shift();
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await uploadSortedOperations({ operations: files.map((file, i) => ({ id: String(i), from: '/old/file.pdf', to: file })), getAccessToken: async () => 'test-token' });
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].error, /403/);
  assert.equal(result.completed.length, 1);
  assert.equal(result.completed[0].to, files[1]);
  assert.equal(replies.length, 0);
  for (const file of files) assert.equal(await fs.readFile(file, 'utf8'), '%PDF-1.4\npayload');
});
