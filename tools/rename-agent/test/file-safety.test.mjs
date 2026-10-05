import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { inspectFile, assertReadableContent } from '../src/desktop/file-safety.mjs';
import { expandInputPaths } from '../src/desktop/input-files.mjs';
import { validateOperations, applyOperations } from '../src/desktop/plan.mjs';
import { restoreMetadata } from '../src/desktop/restore-metadata.mjs';

const require = createRequire(import.meta.url);
const JSZip = createRequire(require.resolve('mammoth'))('jszip');
const sidecar = Buffer.from('00051607000200004d6163204f532058', 'hex');
async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-safety-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('filters metadata paths and AppleDouble renamed as PDF', async t => {
  const root = await temp(t);
  await fs.mkdir(path.join(root, '__MACOSX'));
  for (const name of ['._real.pdf', 'fake.pdf']) await fs.writeFile(path.join(root, name), sidecar);
  await fs.writeFile(path.join(root, 'real.pdf'), '%PDF-1.4\n');
  await fs.writeFile(path.join(root, '__MACOSX', 'nested.pdf'), '%PDF-1.4\n');
  const result = await expandInputPaths([root, path.join(root, '._real.pdf')]);
  assert.deepEqual(result.files, [path.join(root, 'real.pdf')]);
  assert.ok(result.rejected.every(item => item.reason === 'mac_metadata'));
});

test('checks PDF and DOCX contents, not just their extensions', async t => {
  const root = await temp(t);
  const pdf = path.join(root, 'bad.pdf');
  const docx = path.join(root, 'bad.docx');
  await fs.writeFile(pdf, 'not PDF');
  await fs.writeFile(docx, 'not ZIP');
  assert.equal((await inspectFile(pdf)).reason, 'invalid_document');
  assert.equal((await inspectFile(docx)).reason, 'invalid_document');
  const zip = new JSZip();
  zip.file('ordinary.txt', 'This is a ZIP archive, not a DOCX');
  await fs.writeFile(docx, await zip.generateAsync({ type: 'nodebuffer' }));
  assert.equal((await inspectFile(docx)).reason, 'invalid_document');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>');
  await fs.writeFile(docx, await zip.generateAsync({ type: 'nodebuffer' }));
  assert.equal(await inspectFile(docx), null);
});

test('blocks stale operations at validation and execution', async t => {
  const root = await temp(t);
  const from = path.join(root, 'old.pdf');
  const to = path.join(root, 'new.pdf');
  await fs.writeFile(from, sidecar);
  const operations = [{ id: 'one', from, to }];
  assert.equal((await validateOperations(operations)).valid, false);
  assert.equal((await applyOperations(operations)).failures.length, 1);
  assert.equal(await fs.readFile(from).then(bytes => bytes.equals(sidecar)), true);
});

test('unreadable content cannot generate filename-only suggestions', () => {
  for (const content of ['', '[UNREADABLE: OCR failed]', 'ПАМЫЛКА: file missing']) {
    assert.throws(() => assertReadableContent(content));
  }
  assert.doesNotThrow(() => assertReadableContent('Invoice for services'));
});

test('recovers only verified metadata, preserves conflicts and updates undo journal', async t => {
  const root = await temp(t);
  const history = path.join(root, 'history.json');
  const operations = ['good', 'conflict', 'missing', 'real'].map(id => ({ id, from: path.join(root, `._${id}.pdf`), to: path.join(root, `${id}.pdf`) }));
  await fs.writeFile(operations[0].to, sidecar);
  await fs.writeFile(operations[1].to, sidecar);
  await fs.writeFile(operations[1].from, 'existing');
  await fs.writeFile(operations[3].to, '%PDF-1.4\n');
  await fs.writeFile(history, JSON.stringify({ operations }));
  const result = await restoreMetadata(history);
  assert.equal(result.restored.length, 1);
  assert.equal(result.skipped.length, 3);
  assert.equal(JSON.parse(await fs.readFile(history)).operations.length, 3);
  assert.equal(JSON.parse(await fs.readFile(result.backupPath)).operations.length, 4);
  assert.equal(await fs.readFile(operations[1].from, 'utf8'), 'existing');
  assert.equal(await fs.readFile(operations[3].to, 'utf8'), '%PDF-1.4\n');
  assert.equal((await restoreMetadata(history)).restored.length, 0);
});
