import fs from "node:fs/promises";
import path from "node:path";
import { moveFile, pathExists } from "./plan.mjs";

export async function readLastOperation(historyPath) {
  try {
    return JSON.parse(await fs.readFile(historyPath, "utf8"));
  } catch {
    return null;
  }
}

export async function writeLastOperation(historyPath, value) {
  await fs.mkdir(path.dirname(historyPath), { recursive: true });
  const temporary = `${historyPath}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(temporary, historyPath);
}

export async function undoLastOperation(historyPath, onProgress = () => {}) {
  const journal = await readLastOperation(historyPath);
  if (!journal?.operations?.length) {
    return { completed: [], failures: [], error: "Няма аперацыі для адмены" };
  }

  const reversed = [...journal.operations]
    .reverse()
    .map((item) => ({ from: item.to, to: item.from, id: item.id }));

  for (const operation of reversed) {
    if (!(await pathExists(operation.from))) {
      return {
        completed: [],
        failures: [],
        error: `Немагчыма адмяніць: файл адсутнічае — ${operation.from}`,
      };
    }
    if (await pathExists(operation.to)) {
      return {
        completed: [],
        failures: [],
        error: `Немагчыма адмяніць: шлях заняты — ${operation.to}`,
      };
    }
  }

  const completed = [];
  const failures = [];
  for (const [index, operation] of reversed.entries()) {
    await onProgress({ current: index, total: reversed.length,
      ...operation, status: 'processing' });
    try {
      await moveFile(operation.from, operation.to);
      completed.push(operation);
      await onProgress({ current: index + 1, total: reversed.length,
        ...operation, status: 'completed' });
    } catch (error) {
      failures.push({ ...operation, error: String(error?.message || error) });
      break;
    }
  }

  if (failures.length === 0) {
    await fs.rm(historyPath, { force: true });
  } else {
    const undoneIds = new Set(completed.map((item) => item.id));
    await writeLastOperation(historyPath, {
      ...journal,
      operations: journal.operations.filter((item) => !undoneIds.has(item.id)),
    });
  }
  return { completed, failures };
}
