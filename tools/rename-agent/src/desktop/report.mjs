import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function createReport({ mode, destination = '', operations }) {
  return { version: 1, id: randomUUID(), mode, destination,
    startedAt: new Date().toISOString(), finishedAt: null, status: 'running',
    entries: operations.map(operation => ({ ...operation, status: 'pending' })) };
}

export function updateReport(report, progress) {
  const entry = report.entries.find(item => item.id === progress.id);
  if (entry) Object.assign(entry, { status: progress.status,
    ...(progress.error ? { error: progress.error } : {}) });
  return report;
}

export function reportCounts(report) {
  const counts = { total: report.entries.length, completed: 0, failed: 0, skipped: 0, pending: 0 };
  for (const entry of report.entries) {
    const key = entry.status === 'processing' ? 'pending' : entry.status;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export async function writeReport(userData, report) {
  const directory = path.join(userData, 'reports');
  await fs.mkdir(directory, { recursive: true });
  const json = JSON.stringify(report, null, 2);
  for (const file of [path.join(directory, `${report.id}.json`), path.join(userData, 'last-report.json')]) {
    await fs.writeFile(`${file}.tmp`, json, { mode: 0o600 });
    await fs.rename(`${file}.tmp`, file);
  }
}

export async function readReport(userData) {
  try { return JSON.parse(await fs.readFile(path.join(userData, 'last-report.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function reportFromJournal(journal) {
  if (!journal?.operations?.length) return null;
  const report = createReport({ mode: journal.mode, operations: journal.operations });
  return { ...report, startedAt: journal.createdAt, status: 'completed', legacy: true,
    entries: report.entries.map(entry => ({ ...entry, status: 'completed' })) };
}

export function reportCsv(report) {
  // Escape both CSV delimiters and spreadsheet formulas from filenames/errors.
  const cell = value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [['status', 'from', 'to', 'error'],
    ...report.entries.map(entry => [entry.status, entry.from, entry.to, entry.error || ''])]
    .map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
