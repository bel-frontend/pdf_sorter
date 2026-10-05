import fs from 'node:fs/promises';
import path from 'node:path';
import { isAppleDouble } from './file-safety.mjs';
import { readLastOperation, writeLastOperation } from './history.mjs';

export async function restoreMetadata(historyPath, { dryRun = false } = {}) {
  const journal = await readLastOperation(historyPath);
  if (!journal?.operations) throw new Error('Operation journal is missing');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${historyPath}.before-metadata-recovery-${stamp}.json`;
  const reportPath = `${historyPath}.metadata-recovery-${stamp}.json`;
  const report = { backupPath, restored: [], candidates: [], skipped: [] };
  if (!dryRun) await fs.copyFile(historyPath, backupPath, fs.constants.COPYFILE_EXCL);
  for (const operation of [...journal.operations]) {
    if (!path.basename(operation.from).startsWith('._')) continue;
    try {
      const stat = await fs.lstat(operation.to);
      if (!stat.isFile() || !(await isAppleDouble(operation.to))) {
        report.skipped.push({ ...operation, reason: 'not_appledouble' });
        continue;
      }
      try {
        await fs.lstat(operation.from);
        report.skipped.push({ ...operation, reason: 'original_path_occupied' });
        continue;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      report.candidates.push(operation);
      if (dryRun) continue;
      // Exclusive copy also works on exFAT volumes and never overwrites a path.
      await fs.copyFile(operation.to, operation.from, fs.constants.COPYFILE_EXCL);
      await fs.unlink(operation.to);
      report.restored.push(operation);
      journal.operations = journal.operations.filter(item => item.id !== operation.id);
      await writeLastOperation(historyPath, journal);
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    } catch (error) {
      report.skipped.push({ ...operation, reason: error.code || error.message });
    }
  }
  if (!dryRun) await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  return { ...report, reportPath };
}
