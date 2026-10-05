import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';

export function isMacMetadataPath(filePath) {
  return filePath.split(/[\\/]/).some(part => part.startsWith('._') || part === '.DS_Store' || part === '__MACOSX');
}

export async function isAppleDouble(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const bytes = Buffer.alloc(4);
    const { bytesRead } = await handle.read(bytes, 0, 4, 0);
    return bytesRead === 4 && bytes.readUInt32BE(0) === 0x00051607;
  } finally { await handle.close(); }
}

export async function inspectFile(filePath) {
  if (isMacMetadataPath(filePath)) return { reason: 'mac_metadata', message: 'Службовы файл macOS' };
  if (await isAppleDouble(filePath)) return { reason: 'mac_metadata', message: 'Службовы файл AppleDouble, не дакумент' };
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.pdf') {
    const handle = await fs.open(filePath, 'r');
    try {
      const bytes = Buffer.alloc(1024);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (!bytes.subarray(0, bytesRead).includes(Buffer.from('%PDF-'))) {
        return { reason: 'invalid_document', message: 'Змесціва файла не адпавядае PDF' };
      }
    } finally { await handle.close(); }
  }
  if (extension === '.docx') {
    try { await mammoth.extractRawText({ path: filePath }); }
    catch { return { reason: 'invalid_document', message: 'Няправільная структура DOCX' }; }
  }
  return null;
}

export async function assertSafeDocument(filePath) {
  const issue = await inspectFile(filePath);
  if (issue) throw new Error(issue.message);
}

export function assertReadableContent(content) {
  if (!String(content || '').trim() || /\[UNREADABLE:|\[NO_TEXT_EXTRACTED\]|ПАМЫЛКА:|тэкст не знойдзены/i.test(content)) {
    throw new Error('Не атрымалася прачытаць змесціва; аўтаматычная прапанова адключана');
  }
}
