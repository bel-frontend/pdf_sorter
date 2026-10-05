import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyOperations } from '../src/desktop/plan.mjs';
import { createReport, updateReport, writeReport, readReport, reportCounts, reportCsv, reportFromJournal } from '../src/desktop/report.mjs';

test('reports retain every result and announce source and destination before a move', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fg-report-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'invoice.pdf');
  const target = path.join(root, 'sorted', 'invoice.pdf');
  await fs.writeFile(source, '%PDF-1.4\ninvoice');
  const same = path.join(root, 'unchanged.pdf');
  await fs.writeFile(same, '%PDF-1.4\nunchanged');
  const operations = [{ id: 'move', from: source, to: target },
    { id: 'missing', from: path.join(root, 'missing.pdf'), to: path.join(root, 'missing-target.pdf') },
    { id: 'skip', from: same, to: same }];
  const report = createReport({ mode: 'organize', destination: path.dirname(target), operations });
  await writeReport(root, report);
  assert.deepEqual(reportCounts(await readReport(root)), { total: 3, completed: 0, failed: 0, skipped: 0, pending: 3 });
  const events = [];
  const result = await applyOperations(operations, async progress => {
    events.push(progress);
    assert.equal(progress.from, operations.find(op => op.id === progress.id).from);
    assert.equal(progress.to, operations.find(op => op.id === progress.id).to);
    if (progress.id === 'move' && progress.status === 'processing') {
      assert.equal(await fs.readFile(source, 'utf8'), '%PDF-1.4\ninvoice');
      await assert.rejects(fs.access(target), { code: 'ENOENT' });
    }
    updateReport(report, progress);
    await writeReport(root, report);
  });
  assert.equal(result.completed.length, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(events.length, 6);
  const loaded = await readReport(root);
  assert.deepEqual(reportCounts(loaded), { total: 3, completed: 1, failed: 1, skipped: 1, pending: 0 });
  assert.ok(loaded.entries[1].error);
  assert.equal(loaded.status, 'running');
  report.status = 'completed-with-errors';
  report.finishedAt = new Date().toISOString();
  await writeReport(root, report);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'reports', `${report.id}.json`), 'utf8')), report);
  const next = createReport({ mode: 'rename', operations: [] });
  await writeReport(root, next);
  assert.equal((await readReport(root)).id, next.id);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'reports', `${report.id}.json`), 'utf8')).entries.length, 3);
});

test('CSV escapes full paths, Unicode, errors, quotes and spreadsheet formulas', () => {
  const csv = reportCsv({ entries: [{ status: 'failed', from: '/ВНЖ/a,"b.pdf', to: '/new/a.pdf', error: '=unsafe\nsecond line' }] });
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"/ВНЖ/a,""b.pdf"'));
  assert.ok(csv.includes('"\'=unsafe\nsecond line"'));
  const legacy = reportFromJournal({ mode: 'organize', createdAt: '2026-10-05', operations: [{ id: 'one', from: '/old/a.pdf', to: '/new/a.pdf' }] });
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.entries[0].status, 'completed');
  assert.equal(legacy.startedAt, '2026-10-05');
  assert.equal(reportFromJournal(null), null);
});
