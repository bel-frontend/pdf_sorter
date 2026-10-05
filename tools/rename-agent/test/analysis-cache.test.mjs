import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeRename, analyzeOrganize } from '../src/desktop/analysis.mjs';
import { createAnalysisCache, contentFingerprint } from '../src/desktop/analysis-cache.mjs';
import { applyOperations } from '../src/desktop/plan.mjs';

const options = { provider: 'ollama', model: 'test', visionProvider: 'ollama', visionModel: 'test',
  language: 'en', pattern: '{category}_{topic}', categories: ['invoices', 'contracts', 'other'],
  instructions: '', sortingInstructions: '', reuseAnalysis: true };
const suggestion = { category: 'invoice', topic: 'accounting', person: '', date: '2026',
  summary: 'Invoice for accounting services issued by Example Ltd', confidence: .94, sortingCategory: 'invoices' };

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fg-metadata-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'document.pdf');
  await fs.writeFile(file, '%PDF-1.4\noriginal invoice');
  const calls = { readers: 0, models: 0, invocations: 0, prompts: [] };
  let answer = suggestion;
  const hooks = { cache: createAnalysisCache(path.join(root, 'cache')),
    extractContent: async () => { calls.readers++; return 'Invoice for accounting services issued by Example Ltd'; },
    buildChatModel: () => { calls.models++; return { invoke: async prompt => {
      calls.invocations++; calls.prompts.push(prompt); return { content: JSON.stringify(answer) };
    } }; } };
  return { root, file, calls, hooks, answer: value => { answer = value; } };
}

test('renamed and moved files reuse persistent content metadata with zero OCR or model calls', async t => {
  const { root, file, calls, hooks } = await setup(t);
  const naming = await analyzeRename([file], options, hooks);
  assert.equal(naming.rows.length, 1);
  assert.equal(calls.readers, 1);
  assert.equal(calls.invocations, 1);
  assert.ok(calls.prompts[0].includes('sortingCategory'));
  const renamed = naming.rows[0].targetPath;
  assert.equal((await applyOperations([{ id: naming.rows[0].id, from: file, to: renamed }])).completed.length, 1);
  const afterRename = { ...calls };
  // A fresh cache instance simulates reopening the app, with no credentials/model available.
  const cachedHooks = { cache: createAnalysisCache(path.join(root, 'cache')),
    buildChatModel: () => { throw Error('Unexpected model request'); },
    extractContent: () => { throw Error('Unexpected OCR'); } };
  const sorting = await analyzeOrganize([renamed], { ...options, destination: path.join(root, 'sorted') }, cachedHooks);
  assert.equal(sorting.failures.length, 0);
  assert.equal(sorting.rows[0].category, 'invoices');
  assert.equal(sorting.reused, 1);
  assert.equal(sorting.rows[0].reuseSource, 'category');
  assert.equal(calls.invocations, afterRename.invocations);
  const moved = sorting.rows[0].targetPath;
  await applyOperations([{ id: sorting.rows[0].id, from: renamed, to: moved }]);
  const repeat = await analyzeRename([moved], { ...options, pattern: '{category}_{date}' }, cachedHooks);
  assert.equal(repeat.failures.length, 0);
  assert.equal(repeat.reused, 1);
  assert.equal(repeat.rows[0].proposedName, 'invoice_2026.pdf');
});

test('changed sorting rules classify saved evidence once without rescanning, then reuse the new category', async t => {
  const { root, file, calls, hooks, answer } = await setup(t);
  await analyzeRename([file], options, hooks);
  answer({ category: 'finance', reason: 'Accounting invoice belongs in finance', confidence: .91 });
  const changed = { ...options, destination: path.join(root, 'new'), categories: ['finance', 'other'], instructions: 'Accounting invoices go to finance' };
  const sorted = await analyzeOrganize([file], changed, hooks);
  assert.equal(sorted.rows[0].category, 'finance');
  assert.equal(sorted.rows[0].reuseSource, 'metadata');
  assert.equal(calls.readers, 1);
  assert.equal(calls.invocations, 2);
  assert.ok(calls.prompts[1].includes('Verified content metadata'));
  const repeat = await analyzeOrganize([file], { ...changed, destination: path.join(root, 'elsewhere') }, hooks);
  assert.equal(repeat.rows[0].category, 'finance');
  assert.equal(calls.readers, 1);
  assert.equal(calls.invocations, 2);
});

test('changed content and forced reanalysis never reuse an old classification', async t => {
  const { root, file, calls, hooks, answer } = await setup(t);
  await analyzeRename([file], options, hooks);
  const originalHash = await contentFingerprint(file);
  await fs.writeFile(file, '%PDF-1.4\nnew contract');
  assert.notEqual(await contentFingerprint(file), originalHash);
  answer({ category: 'contracts', reason: 'A service contract', confidence: .9 });
  const fresh = await analyzeOrganize([file], { ...options, destination: path.join(root, 'out') }, hooks);
  assert.equal(fresh.rows[0].category, 'contracts');
  assert.equal(fresh.reused, 0);
  assert.equal(calls.readers, 2);
  await analyzeOrganize([file], { ...options, destination: path.join(root, 'out'), reuseAnalysis: false }, hooks);
  assert.equal(calls.readers, 3);
  assert.equal(calls.invocations, 3);
});

test('bad format, unreadable files and files changed during analysis cannot populate or use the cache', async t => {
  const { root, file, hooks } = await setup(t);
  const destination = path.join(root, 'out');
  await analyzeRename([file], options, hooks);
  await fs.writeFile(file, 'invalid pdf');
  assert.equal((await analyzeOrganize([file], { ...options, destination }, hooks)).failures.length, 1);
  await fs.writeFile(file, '%PDF-1.4\nunreadable');
  hooks.extractContent = async () => '[UNREADABLE: OCR failed]';
  assert.equal((await analyzeRename([file], options, hooks)).failures.length, 1);
  assert.equal((await hooks.cache.get(file)).metadata, null);
  hooks.extractContent = async () => { await fs.writeFile(file, '%PDF-1.4\nmodified while reading'); return 'Invoice'; };
  const changed = await analyzeRename([file], options, hooks);
  assert.equal(changed.rows.length, 0);
  assert.match(changed.failures[0].error, /змянілася/);
  assert.equal((await hooks.cache.get(file)).metadata, null);
});

test('image metadata supports changing taxonomy without a second vision request', async t => {
  const { root, calls, hooks, answer } = await setup(t);
  const image = path.join(root, 'image.png');
  await fs.writeFile(image, Buffer.from('89504e470d0a1a0a', 'hex'));
  const naming = await analyzeRename([image], options, hooks);
  assert.equal(naming.rows.length, 1);
  assert.equal(calls.readers, 0);
  assert.equal(typeof calls.prompts[0], 'object');
  answer({ category: 'finance', reason: 'A photographed invoice', confidence: .9 });
  const sorted = await analyzeOrganize([image], { ...options, destination: path.join(root, 'out'), categories: ['finance', 'other'] }, hooks);
  assert.equal(sorted.rows[0].category, 'finance');
  assert.equal(typeof calls.prompts[1], 'string');
  assert.equal(calls.readers, 0);
});
