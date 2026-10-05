import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { saveWorkspace, readWorkspace } from '../src/desktop/workspace.mjs';
import { buildPreparedOperations, validateOperations, applyOperations } from '../src/desktop/plan.mjs';

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fg-workspace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('workspace saves preserve edited rows and resume after a fresh read', async t => {
  const root = await temporary(t);
  const file = path.join(root, 'workspace.json');
  const snapshot = { version: 1, planId: randomUUID(), mode: 'organize',
    destination: root, files: ['/input.pdf'], categories: ['invoices'],
    rows: [{ id: randomUUID(), sourcePath: '/input.pdf', category: 'invoices',
      summary: 'Invoice content', confidence: 0.9, selected: false }], failures: [] };
  await saveWorkspace(file, snapshot);
  const loaded = await readWorkspace(file);
  assert.equal(loaded.rows[0].selected, false);
  assert.equal(loaded.rows[0].summary, 'Invoice content');
  await Promise.all([saveWorkspace(file, loaded), saveWorkspace(file, { ...loaded, rows: [] })]);
  assert.equal((await readWorkspace(file)).rows.length, 0);
});

test('sorting preserves reserved names and resolves edited category collisions', async t => {
  const root = await temporary(t);
  for (const directory of ['a', 'b', 'sorted/invoices', 'sorted/other']) await fs.mkdir(path.join(root, directory), { recursive: true });
  for (const directory of ['a', 'b']) await fs.writeFile(path.join(root, directory, 'same.pdf'), '%PDF-1.4\npayload');
  await fs.writeFile(path.join(root, 'sorted/invoices/same.pdf'), '%PDF-1.4\nexisting');
  const stored = { mode: 'organize', destination: path.join(root, 'sorted'), categories: ['invoices', 'other'],
    rows: ['a', 'b'].map((directory, index) => ({ id: directory,
      sourcePath: path.join(root, directory, 'same.pdf'), category: 'invoices',
      targetPath: path.join(root, 'sorted/invoices', `same__${index + 2}.pdf`) })) };
  const edits = stored.rows.map(row => ({ id: row.id, selected: true, category: 'invoices' }));
  const prepared = await buildPreparedOperations(stored, edits);
  assert.deepEqual(prepared.operations.map(item => path.basename(item.to)), ['same__2.pdf', 'same__3.pdf']);
  assert.equal((await validateOperations(prepared.operations, prepared.errors)).valid, true);
  const edited = await buildPreparedOperations(stored, edits.map(row => ({ ...row, category: 'other' })));
  assert.deepEqual(edited.operations.map(item => path.basename(item.to)), ['same.pdf', 'same__2.pdf']);
  let checkpoints = 0;
  const result = await applyOperations(prepared.operations, async () => { await Promise.resolve(); checkpoints++; });
  assert.equal(result.completed.length, 2);
  assert.equal(checkpoints, 4);
  assert.equal(await fs.readFile(path.join(root, 'sorted/invoices/same.pdf'), 'utf8'), '%PDF-1.4\nexisting');
});

test('a saved sorting plan can change destination without losing analysis or overwriting files', async t => {
  const root = await temporary(t);
  const originalDestination = path.join(root, 'old');
  const destination = path.join(root, 'new');
  await fs.mkdir(path.join(destination, 'invoices'), { recursive: true });
  const sourcePath = path.join(root, 'invoice.pdf');
  const content = '%PDF-1.4\noriginal invoice';
  await fs.writeFile(sourcePath, content);
  const occupied = path.join(destination, 'invoices', 'invoice.pdf');
  await fs.writeFile(occupied, '%PDF-1.4\nalready there');
  const row = { id: randomUUID(), sourcePath, category: 'invoices',
    summary: 'Invoice content', confidence: 0.93, selected: true,
    targetPath: path.join(originalDestination, 'invoices', 'invoice.pdf') };
  const snapshot = { version: 1, planId: randomUUID(), mode: 'organize',
    destination, files: [sourcePath], categories: ['invoices'],
    rows: [{ ...row, targetPath: undefined }],
    failures: [{ sourcePath: '/unreadable.pdf', error: 'Unreadable content' }] };
  const file = path.join(root, 'workspace.json');
  await saveWorkspace(file, snapshot);
  const loaded = await readWorkspace(file);
  assert.equal(loaded.planId, snapshot.planId);
  assert.equal(loaded.rows[0].summary, row.summary);
  assert.equal(loaded.rows[0].confidence, row.confidence);
  assert.equal(loaded.rows[0].selected, true);
  assert.deepEqual(loaded.failures, snapshot.failures);
  const prepared = await buildPreparedOperations(loaded, loaded.rows);
  assert.equal(prepared.operations[0].to, path.join(destination, 'invoices', 'invoice__2.pdf'));
  assert.equal((await validateOperations(prepared.operations, prepared.errors)).valid, true);
  assert.equal((await applyOperations(prepared.operations)).completed.length, 1);
  assert.equal(await fs.readFile(prepared.operations[0].to, 'utf8'), content);
  assert.equal(await fs.readFile(occupied, 'utf8'), '%PDF-1.4\nalready there');
  await assert.rejects(fs.access(originalDestination), { code: 'ENOENT' });
});
