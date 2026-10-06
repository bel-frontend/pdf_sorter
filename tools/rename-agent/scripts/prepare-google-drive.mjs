import fs from 'node:fs/promises';
import { parseDriveClient } from '../src/desktop/google-drive-auth.mjs';
const source = new URL('../config/google-drive-client.json', import.meta.url);
let client = null;
try { client = parseDriveClient(JSON.parse(await fs.readFile(source, 'utf8'))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!client && process.argv.includes('--require-configured')) throw new Error('Developer: configure config/google-drive-client.json before releasing Google Drive support');
await fs.writeFile(new URL('../electron/google-drive-client.json', import.meta.url), JSON.stringify(client || {}));
console.log(client ? 'Google Drive app client bundled' : 'Google Drive unavailable: developer app client is not configured');
