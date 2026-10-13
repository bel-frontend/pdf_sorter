import fs from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { SUPPORTED_EXTENSIONS } from './input-files.mjs';
import { assertSafeDocument, isMacMetadataPath } from './file-safety.mjs';
import { driveQueryLiteral } from './google-drive.mjs';

export const DRIVE_FOLDER = 'application/vnd.google-apps.folder';
export const DRIVE_READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const DRIVE_WRITE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const EXPORT_PDF = new Set(['application/vnd.google-apps.document', 'application/vnd.google-apps.spreadsheet', 'application/vnd.google-apps.presentation']);
const FIELDS = 'id,name,mimeType,size,modifiedTime,version,md5Checksum,capabilities(canDownload)';
export function driveFileId(value) {
  if (!/^[\w-]{1,200}$/.test(String(value))) throw new Error('Няправільны ID файла Google Drive');
  return String(value);
}
export function importableDriveFile(file) {
  return !isMacMetadataPath(file.name || '') && file.capabilities?.canDownload !== false && (EXPORT_PDF.has(file.mimeType) || SUPPORTED_EXTENSIONS.has(path.extname(file.name || '').toLowerCase()));
}
export function localDriveName(file) {
  let name = String(file.name || 'document').replace(/[\\/\x00-\x1f<>:"|?*]/g, '_').replace(/^\.+/, '_');
  if (EXPORT_PDF.has(file.mimeType)) name = name.replace(/\.pdf$/i, '') + '.pdf';
  const ext = path.extname(name);
  // Limit bytes, including Unicode, to a portable filename length.
  let stem = name.slice(0, name.length - ext.length);
  while (Buffer.byteLength(stem + ext) > 240) stem = stem.slice(0, -1);
  return (stem || 'document') + ext;
}
// The timeout restarts on every received chunk, so slow but active downloads are not interrupted.
async function request(url, token, { fetchImpl = fetch, signal, timeoutMs = 300000, consume = response => response.json() } = {}) {
  const idle = new AbortController();
  let timer;
  const touch = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(new Error('Google Drive не адказвае; паўтары спампоўванне')), timeoutMs); };
  touch();
  try {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: signal ? AbortSignal.any([signal, idle.signal]) : idle.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(`Google Drive (${response.status}): ${body.error?.message || 'Не атрымалася выканаць запыт'}`);
    }
    return await consume(response, touch);
  } finally { clearTimeout(timer); }
}
export async function listDriveFiles(token, { parentId = 'root', search = '', pageToken = '', fetchImpl, signal } = {}) {
  driveFileId(parentId);
  const clauses = [`'${driveQueryLiteral(parentId)}' in parents`, 'trashed = false'];
  if (search.trim()) clauses.push(`name contains '${driveQueryLiteral(search.trim())}'`);
  const query = new URLSearchParams({ q: clauses.join(' and '), fields: `nextPageToken,files(${FIELDS})`, pageSize: '100', orderBy: 'folder,name_natural', spaces: 'drive', ...(pageToken ? { pageToken } : {}) });
  const data = await request(`${API}/files?${query}`, token, { fetchImpl, signal });
  return { files: (data.files || []).map(file => ({ ...file, downloadable: importableDriveFile(file), exportPdf: EXPORT_PDF.has(file.mimeType) })), nextPageToken: data.nextPageToken || '' };
}
async function writeManifest(directory, manifest) {
  const temporary = path.join(directory, 'manifest.json.tmp');
  await fs.writeFile(temporary, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  await fs.rename(temporary, path.join(directory, 'manifest.json'));
}

export async function downloadDriveFiles({ ids, token, cacheRoot, account, signal, onProgress = () => {}, fetchImpl = fetch, timeoutMs }) {
  const uniqueIds = [...new Set(ids.map(driveFileId))];
  if (!uniqueIds.length) throw new Error('Выберы файлы для спампоўвання');
  signal?.throwIfAborted();
  const sessionId = randomUUID();
  const directory = path.join(cacheRoot, sessionId);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const manifest = { version: 1, sessionId, createdAt: new Date().toISOString(), account, files: [], failures: [], canceled: false };
  await writeManifest(directory, manifest);
  for (const [index, id] of uniqueIds.entries()) {
    if (signal?.aborted) { manifest.canceled = true; break; }
    let file, temporary, itemDirectory;
    onProgress({ current: index, total: uniqueIds.length, filePath: id, status: 'processing' });
    try {
      file = await request(`${API}/files/${id}?fields=${FIELDS}`, token, { fetchImpl, signal, timeoutMs });
      if (!importableDriveFile(file)) throw new Error(file.capabilities?.canDownload === false ? 'Уладальнік забараніў спампоўванне' : 'Фармат файла не падтрымліваецца');
      itemDirectory = path.join(directory, randomUUID());
      await fs.mkdir(itemDirectory, { mode: 0o700 });
      const localPath = path.join(itemDirectory, localDriveName(file));
      temporary = `${localPath}.part`;
      const exportPdf = EXPORT_PDF.has(file.mimeType);
      const url = exportPdf ? `${API}/files/${id}/export?mimeType=application%2Fpdf` : `${API}/files/${id}?alt=media`;
      onProgress({ current: index, total: uniqueIds.length, filePath: file.name, status: 'processing' });
      await request(url, token, { fetchImpl, signal, timeoutMs, consume: async (response, touch) => {
        if (!response.body) throw new Error('Google Drive не вярнуў змесціва');
        await pipeline(Readable.fromWeb(response.body), async function* (source) { for await (const chunk of source) { touch(); yield chunk; } }, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), ...(signal ? [{ signal }] : []));
      } });
      const size = (await fs.stat(temporary)).size;
      if (!size) throw new Error('Спампаваны файл пусты');
      if (!exportPdf && file.size !== undefined && size !== Number(file.size)) throw new Error('Файл спампаваўся не цалкам; памер не супадае');
      if (!exportPdf && file.md5Checksum) {
        const hash = createHash('md5');
        for await (const chunk of createReadStream(temporary)) { signal?.throwIfAborted(); hash.update(chunk); }
        if (hash.digest('hex') !== file.md5Checksum.toLowerCase()) throw new Error('Пашкоджана спампаваная копія; checksum не супадае');
      }
      // Validate using the intended extension, before handing a file to OCR or AI.
      await fs.rename(temporary, localPath);
      temporary = localPath;
      await assertSafeDocument(localPath);
      signal?.throwIfAborted();
      manifest.files.push({ driveId: id, originalName: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime, version: file.version, md5Checksum: file.md5Checksum, localPath, exportPdf });
      temporary = null;
      onProgress({ current: index + 1, total: uniqueIds.length, filePath: file.name, status: 'completed' });
    } catch (error) {
      if (temporary) await fs.rm(temporary, { force: true });
      if (itemDirectory) await fs.rm(itemDirectory, { recursive: true, force: true });
      if (signal?.aborted) { manifest.canceled = true; break; }
      const failure = { driveId: id, name: file?.name || id, error: error.message || String(error) };
      manifest.failures.push(failure);
      onProgress({ current: index + 1, total: uniqueIds.length, filePath: failure.name, status: 'failed', error: failure.error });
    }
    await writeManifest(directory, manifest);
  }
  manifest.finishedAt = new Date().toISOString();
  await writeManifest(directory, manifest);
  return { sessionId, files: manifest.files, failures: manifest.failures, canceled: manifest.canceled };
}

export async function readDriveImports(cacheRoot, account) {
  let directories;
  try { directories = await fs.readdir(cacheRoot, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const imports = [];
  for (const entry of directories) {
    if (!entry.isDirectory()) continue;
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(path.join(cacheRoot, entry.name, 'manifest.json'), 'utf8')); }
    catch { continue; }
    if (account && manifest.account !== account) continue;
    const files = [];
    for (const file of manifest.files || []) {
      if (typeof file.localPath !== 'string' || !path.resolve(file.localPath).startsWith(path.resolve(cacheRoot) + path.sep)) continue;
      try { if ((await fs.stat(file.localPath)).isFile()) files.push(file); } catch {}
    }
    if (files.length) imports.push({ sessionId: manifest.sessionId, createdAt: manifest.createdAt, files, canceled: manifest.canceled, failures: manifest.failures || [] });
  }
  return imports.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
