import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const classificationSchema = z.object({ category: z.string().min(1), reason: z.string().default(''), confidence: z.number().min(0).max(1) });
const metadataSchema = z.object({
  version: z.literal(1), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  extractedText: z.string().max(8000).optional(),
  rename: z.object({ category: z.string(), topic: z.string(), person: z.string().default(''), date: z.string().default(''),
    summary: z.string().min(1).max(1000), confidence: z.number().min(0).max(1), sortingCategory: z.string().optional() }).optional(),
  renameContext: z.string().optional(),
  classifications: z.record(classificationSchema).default({}),
});

export async function contentFingerprint(filePath, signal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath, { signal })) hash.update(chunk);
  return hash.digest('hex');
}

export function classificationContext(categories, instructions = '') {
  return createHash('sha256').update(JSON.stringify({ categories: [...categories].sort(), instructions: instructions.trim() })).digest('hex');
}

export function renameContext(options) {
  return createHash('sha256').update(JSON.stringify({ language: options.language || 'en', instructions: (options.instructions || '').trim() })).digest('hex');
}

export function createAnalysisCache(directory) {
  let pending = Promise.resolve();
  return {
    async get(filePath, signal) {
      const fingerprint = await contentFingerprint(filePath, signal);
      try {
        const metadata = metadataSchema.parse(JSON.parse(await fs.readFile(path.join(directory, `${fingerprint}.json`), 'utf8')));
        if (metadata.fingerprint !== fingerprint) return { fingerprint, metadata: null };
        return { fingerprint, metadata };
      } catch (error) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError || error instanceof z.ZodError) return { fingerprint, metadata: null };
        throw error;
      }
    },
    async put(filePath, fingerprint, raw, signal) {
      if (await contentFingerprint(filePath, signal) !== fingerprint) throw new Error('Змесціва файла змянілася падчас аналізу; паўтары аналіз');
      const metadata = metadataSchema.parse({ ...raw, version: 1, fingerprint });
      const write = pending.catch(() => {}).then(async () => {
        await fs.mkdir(directory, { recursive: true });
        const file = path.join(directory, `${fingerprint}.json`);
        await fs.writeFile(`${file}.tmp`, JSON.stringify(metadata), { mode: 0o600 });
        await fs.rename(`${file}.tmp`, file);
      });
      pending = write;
      await write;
      return metadata;
    },
  };
}
