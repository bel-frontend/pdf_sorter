import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { listDriveFiles, downloadDriveFiles, localDriveName, importableDriveFile, driveFileId, DRIVE_FOLDER } from '../src/desktop/drive-import.mjs';
const pdf = '%PDF-1.4\ncontent';
const checksum = createHash('md5').update(pdf).digest('hex');
const metadata = (id, extra = {}) => ({ id, name: 'document.pdf', mimeType: 'application/pdf', size: String(Buffer.byteLength(pdf)), md5Checksum: checksum, capabilities: { canDownload: true }, ...extra });
async function temporary(t) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fg-drive-import-')); t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory; }
const pdfResponse = () => new Response(pdf);

test('Drive folder listing paginates, escapes searches, exposes supported files and read restrictions', async () => {
  let requested;
  const result = await listDriveFiles('token', { parentId: 'folder', search: "client's\\tax", pageToken: 'page', fetchImpl: async (url, options) => {
    requested = new URL(url); assert.equal(options.headers.Authorization, 'Bearer token');
    return Response.json({ nextPageToken: 'next', files: [metadata('pdf'), metadata('locked', { capabilities: { canDownload: false } }), { id: 'dir', name: 'folder', mimeType: DRIVE_FOLDER }, { id: 'doc', name: 'Native document', mimeType: 'application/vnd.google-apps.document' }, { id: 'zip', name: 'archive.zip', mimeType: 'application/zip' }] });
  } });
  assert.equal(requested.searchParams.get('q'), "'folder' in parents and trashed = false and name contains 'client\\'s\\\\tax'");
  assert.equal(requested.searchParams.get('pageToken'), 'page');
  assert.equal(result.nextPageToken, 'next');
  assert.deepEqual(result.files.map(file => file.downloadable), [true, false, false, true, false]);
  assert.equal(result.files[3].exportPdf, true);
});

test('downloaded same-name files have unique persistent paths, deduplicate IDs and checkpoint origins', async t => {
  const directory = await temporary(t);
  const fetchImpl = async url => url.includes('alt=media') ? pdfResponse() : Response.json(metadata(url.includes('/first?') ? 'first' : 'second'));
  const progress = [];
  const result = await downloadDriveFiles({ ids: ['first', 'second', 'first'], token: 'token', cacheRoot: directory, account: 'test@example.com', fetchImpl, onProgress: event => progress.push(event) });
  assert.equal(result.files.length, 2);
  assert.notEqual(result.files[0].localPath, result.files[1].localPath);
  for (const file of result.files) assert.equal(await fs.readFile(file.localPath, 'utf8'), pdf);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, result.sessionId, 'manifest.json')));
  assert.equal(manifest.account, 'test@example.com');
  assert.equal(manifest.files[0].driveId, 'first');
  assert.equal(manifest.files[0].md5Checksum, checksum);
  assert.ok(manifest.finishedAt);
  assert.equal(progress.at(-1).current, 2);
  assert.equal(progress.at(-1).total, 2);
});

test('native Google documents are exported to PDF and unsafe filenames cannot escape the work directory', async t => {
  const directory = await temporary(t);
  let exportUrl;
  const result = await downloadDriveFiles({ ids: ['native'], token: 'token', cacheRoot: directory, fetchImpl: async url => {
    if (url.includes('/export?')) { exportUrl = url; return pdfResponse(); }
    return Response.json(metadata('native', { name: '../../report', mimeType: 'application/vnd.google-apps.document', size: '900', md5Checksum: 'native-is-not-the-export' }));
  } });
  assert.match(exportUrl, /\/export\?mimeType=application%2Fpdf/);
  assert.equal(result.files[0].exportPdf, true);
  assert.equal(path.extname(result.files[0].localPath), '.pdf');
  assert.ok(result.files[0].localPath.startsWith(directory + path.sep));
  assert.equal(path.basename(result.files[0].localPath).includes('/'), false);
  assert.ok(Buffer.byteLength(localDriveName({ name: 'Ж'.repeat(400) + '.pdf' })) <= 240);
  assert.throws(() => driveFileId('../escape'), /ID/);
  assert.equal(importableDriveFile(metadata('metadata', { name: '._file.pdf' })), false);
});

test('corrupt PDFs, truncated copies and checksum mismatches never reach analysis; later downloads continue', async t => {
  const directory = await temporary(t);
  const result = await downloadDriveFiles({ ids: ['invalid', 'truncated', 'checksum', 'valid'], token: 'token', cacheRoot: directory, fetchImpl: async url => {
    const id = url.split('/files/')[1].split('?')[0];
    if (url.includes('alt=media')) return id === 'invalid' ? new Response('not a PDF') : pdfResponse();
    return Response.json(metadata(id, id === 'invalid' ? { size: '9', md5Checksum: undefined } : id === 'truncated' ? { size: '999' } : id === 'checksum' ? { md5Checksum: 'bad' } : {}));
  } });
  assert.equal(result.files.length, 1); assert.equal(result.files[0].driveId, 'valid');
  assert.equal(result.failures.length, 3);
  const entries = await fs.readdir(path.join(directory, result.sessionId));
  assert.equal(entries.filter(entry => entry !== 'manifest.json').length, 1);
});

test('canceling retains completed copies and checkpoints rather than deleting progress', async t => {
  const directory = await temporary(t), controller = new AbortController();
  const result = await downloadDriveFiles({ ids: ['first', 'second'], token: 'token', cacheRoot: directory, signal: controller.signal, fetchImpl: async url => url.includes('alt=media') ? pdfResponse() : Response.json(metadata('first')), onProgress: event => { if (event.status === 'completed') controller.abort(); } });
  assert.equal(result.canceled, true); assert.equal(result.files.length, 1);
  assert.equal(await fs.readFile(result.files[0].localPath, 'utf8'), pdf);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, result.sessionId, 'manifest.json')));
  assert.equal(manifest.canceled, true); assert.equal(manifest.files.length, 1);
});

test('download permission failures skip media fetch; streaming cancellation removes incomplete files', async t => {
  const directory = await temporary(t); let calls = 0;
  const locked = await downloadDriveFiles({ ids: ['locked'], token: 'token', cacheRoot: directory, fetchImpl: async () => { calls++; return Response.json(metadata('locked', { capabilities: { canDownload: false } })); } });
  assert.equal(calls, 1); assert.equal(locked.files.length, 0); assert.match(locked.failures[0].error, /забараніў/);
  const controller = new AbortController();
  const canceled = await downloadDriveFiles({ ids: ['partial'], token: 'token', cacheRoot: directory, signal: controller.signal, fetchImpl: async url => {
    if (!url.includes('alt=media')) return Response.json(metadata('partial'));
    return new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode('%PDF-')); setTimeout(() => controller.abort(), 10); }, cancel() {} }));
  } });
  assert.equal(canceled.canceled, true); assert.equal(canceled.files.length, 0);
  assert.deepEqual(await fs.readdir(path.join(directory, canceled.sessionId)), ['manifest.json']);
});

test('completed copies can be recovered after restart and are scoped to their account', async t => {
  const { readDriveImports } = await import('../src/desktop/drive-import.mjs');
  const directory = await temporary(t);
  const result = await downloadDriveFiles({ ids: ['copy'], token: 'token', cacheRoot: directory, account: 'owner@example.com', fetchImpl: async url => url.includes('alt=media') ? pdfResponse() : Response.json(metadata('copy')) });
  const recovered = await readDriveImports(directory, 'owner@example.com');
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].files[0].localPath, result.files[0].localPath);
  assert.equal((await readDriveImports(directory, 'other@example.com')).length, 0);
  await fs.rename(result.files[0].localPath, result.files[0].localPath + '.moved');
  assert.equal((await readDriveImports(directory, 'owner@example.com')).length, 0);
});

test('slow but active downloads continue, stalled downloads fail with the idle timeout', async t => {
  const directory = await temporary(t);
  // Like fetch, an aborted request errors its response body.
  const body = (delays, signal) => new ReadableStream({ async start(controller) {
    signal.addEventListener('abort', () => controller.error(signal.reason));
    for (const [index, delay] of delays.entries()) { await new Promise(resolve => setTimeout(resolve, delay)); if (signal.aborted) return; controller.enqueue(new TextEncoder().encode(index ? 'x' : '%PDF-1.4\n')); }
    controller.close();
  } });
  const download = delays => downloadDriveFiles({ ids: ['slow'], token: 'token', cacheRoot: directory, timeoutMs: 80, fetchImpl: async (url, options) => {
    if (!url.includes('alt=media')) return Response.json(metadata('slow', { size: undefined, md5Checksum: undefined }));
    return new Response(body(delays, options.signal));
  } });
  const slow = await download([30, 30, 30, 30, 30, 30]);
  assert.equal(slow.files.length, 1);
  const stalled = await download([10, 300]);
  assert.equal(stalled.files.length, 0);
  assert.match(stalled.failures[0].error, /не адказвае/);
});
