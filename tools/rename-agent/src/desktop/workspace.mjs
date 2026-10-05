import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const workspaceSchema = z.object({
  version: z.literal(1).default(1),
  mode: z.enum(['rename', 'organize']),
  planId: z.union([z.string().uuid(), z.literal('')]),
  destination: z.string().default(''),
  categories: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
  rows: z.array(z.object({
    id: z.string().uuid(), sourcePath: z.string().min(1),
    targetPath: z.string().optional(), proposedName: z.string().optional(),
    category: z.string().optional(), summary: z.string().default(''),
    confidence: z.number().default(0), selected: z.boolean().default(true),
    status: z.string().default('ready'),
    reuseSource: z.string().optional(),
  })),
  failures: z.array(z.object({ sourcePath: z.string(), error: z.string() })).default([]),
});

let pending = Promise.resolve();
export function saveWorkspace(filePath, raw) {
  const snapshot = workspaceSchema.parse(raw);
  const operation = pending.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
    await fs.rename(temporary, filePath);
    return snapshot;
  });
  pending = operation;
  return operation;
}

export async function readWorkspace(filePath) {
  try { return workspaceSchema.parse(JSON.parse(await fs.readFile(filePath, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
