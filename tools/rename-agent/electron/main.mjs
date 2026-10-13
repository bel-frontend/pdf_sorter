import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} from "electron";
import { z } from "zod";
import { ProviderModels } from "../src/llm.mjs";
import { expandInputPaths } from "../src/desktop/input-files.mjs";
import {
  analyzeOrganize,
  analyzeRename,
  normalizeCategories,
} from "../src/desktop/analysis.mjs";
import {
  applyOperations,
  buildPreparedOperations,
  sanitizeCategory,
  validateOperations,
} from "../src/desktop/plan.mjs";
import {
  readLastOperation,
  undoLastOperation,
  writeLastOperation,
} from "../src/desktop/history.mjs";
import { readWorkspace, saveWorkspace } from '../src/desktop/workspace.mjs';
import { createReport, updateReport, writeReport, readReport, reportFromJournal, reportCsv } from '../src/desktop/report.mjs';
import { extractContent } from '../src/extractors.mjs';
import { createSearchService } from '../src/desktop/search/service.mjs';
import { DEFAULT_EMBEDDING_MODEL } from '../src/desktop/search/models.mjs';
import { createAnalysisCache, classificationContext } from '../src/desktop/analysis-cache.mjs';
import {
  uploadSortedOperations,
} from "../src/desktop/google-drive.mjs";

import { authorizeDrive, exchangeGoogleToken, parseDriveClient } from '../src/desktop/google-drive-auth.mjs';
let driveClient = null;
try { driveClient = parseDriveClient(JSON.parse(await fs.readFile(new URL('./google-drive-client.json', import.meta.url), 'utf8'))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
let driveAuthController = null;

import { listDriveFiles, downloadDriveFiles, readDriveImports, DRIVE_READ_SCOPE, DRIVE_WRITE_SCOPE } from '../src/desktop/drive-import.mjs';
let driveDownloadController = null;

let searchService = null;
let searchStatus = null;
const searchCall = (method, args) => searchService ? searchService.call(method, args) : Promise.reject(new Error('Каталог яшчэ не гатовы'));
const catalogWarning = error => sendProgress('catalog:status', { ...searchStatus, error: error.message });

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CATEGORIES = [
  "invoices",
  "contracts",
  "bank_statements",
  "identity_documents",
  "taxes_and_social",
  "applications_and_decisions",
  "certificates",
  "medical_records",
  "photos_people",
  "unreadable_scans",
  "other",
];
const MANAGED_ENV_KEYS = [
  "LLM_PROVIDER",
  "LLM_MODEL",
  "OLLAMA_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_TIMEOUT_MS",
  "OPENAI_MAX_RETRIES",
  "GOOGLE_GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "READER_PYTHON",
  "OCR_LANG",
  "VISION_PROVIDER",
  "VISION_MODEL",
];

const analyzeSchema = z.object({
  mode: z.enum(["rename", "organize"]),
  files: z.array(z.string().min(1)).min(1),
  destination: z.string().optional().default(""),
  provider: z.enum(["openai", "ollama", "google", "openrouter"]),
  model: z.string().min(1),
  visionProvider: z.enum(["openai", "ollama", "google", "openrouter"]),
  visionModel: z.string().min(1),
  ollamaBaseUrl: z.string().optional().default("http://localhost:11434"),
  language: z.enum(["en", "pl", "be", "ru"]).default("en"),
  pattern: z.string().min(1).max(200).default("{category}_{topic}_{date}"),
  categories: z.array(z.string()).default(DEFAULT_CATEGORIES),
  instructions: z.string().max(5000).default(""),
  sortingInstructions: z.string().max(5000).default(''),
  reuseAnalysis: z.boolean().default(true),
});

const editSchema = z.object({
  planId: z.string().uuid(),
  rows: z.array(
    z.object({
      id: z.string().uuid(),
      selected: z.boolean().default(true),
      proposedName: z.string().optional(),
      category: z.string().optional(),
    }),
  ),
});

let mainWindow;
let activeController = null;
let activeFileOperation = false;
const plans = new Map();

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function secretsPath() {
  return path.join(app.getPath("userData"), "secrets.json");
}

function historyPath() {
  return path.join(app.getPath("userData"), "last-operation.json");
}

function workspacePath() {
  return path.join(app.getPath('userData'), 'workspace.json');
}

function registerWorkspace(snapshot) {
  if (snapshot?.planId) plans.set(snapshot.planId, {
    mode: snapshot.mode, destination: snapshot.destination,
    categories: snapshot.categories, rows: snapshot.rows,
  });
  return snapshot;
}

ipcMain.handle('workspace:get', async () => registerWorkspace(await readWorkspace(workspacePath())));
ipcMain.handle('workspace:save', async (_event, raw) => {
  const snapshot = await saveWorkspace(workspacePath(), raw);
  return registerWorkspace(snapshot);
});

async function latestReport() {
  return await readReport(app.getPath('userData')) || reportFromJournal(await readLastOperation(historyPath()));
}

ipcMain.handle('report:get', latestReport);
ipcMain.handle('report:export', async (_event, raw) => {
  const format = z.enum(['csv', 'json']).parse(raw);
  const report = await latestReport();
  if (!report) throw new Error('Няма справаздачы для захавання');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Захаваць справаздачу',
    defaultPath: `file-garden-${report.id}.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, format === 'csv' ? reportCsv(report) : JSON.stringify(report, null, 2), { mode: 0o600 });
  return { filePath };
});

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findProjectPython() {
  const starts = [
    path.dirname(app.getPath("exe")),
    process.cwd(),
    path.resolve(MODULE_DIR, "../../.."),
  ];
  const visited = new Set();
  for (const start of starts) {
    let current = path.resolve(start);
    for (let depth = 0; depth < 12; depth += 1) {
      if (visited.has(current)) break;
      visited.add(current);
      for (const relative of [
        path.join(".venv", "bin", "python"),
        path.join(".venv", "Scripts", "python.exe"),
      ]) {
        const candidate = path.join(current, relative);
        if (await exists(candidate)) return candidate;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return "";
}

async function readSettings() {
  let stored = {};
  try {
    stored = JSON.parse(await fs.readFile(settingsPath(), "utf8"));
  } catch {
    // First run.
  }
  const detectedPython = await findProjectPython();
  const storedPython = stored.readerPython || "";
  const storedPythonExists = storedPython ? await exists(storedPython) : false;
  const readerPython =
    storedPython && storedPython !== "python3" && storedPythonExists
      ? storedPython
      : detectedPython || "python3";
  return {
    provider: stored.provider || "ollama",
    model: stored.model || "gpt-oss:20b",
    visionProvider: stored.visionProvider || "ollama",
    visionModel: stored.visionModel || "gemma3:4b",
    ollamaBaseUrl: stored.ollamaBaseUrl || "http://localhost:11434",
    readerPython,
    ocrLang: stored.ocrLang || "en,ru,be,uk",
    openaiTimeoutMs: stored.openaiTimeoutMs || 90000,
    openaiMaxRetries: stored.openaiMaxRetries ?? 2,
    language: stored.language || "en",
    pattern: stored.pattern || "{category}_{topic}_{date}",
    categories: normalizeCategories(stored.categories || DEFAULT_CATEGORIES),
    renameInstructions: stored.renameInstructions || stored.instructions || "",
    organizeInstructions:
      stored.organizeInstructions || stored.instructions || "",
    lastDestination: stored.lastDestination || "",
    searchModel: stored.searchModel || DEFAULT_EMBEDDING_MODEL,
    searchBaseUrl: stored.searchBaseUrl || "http://localhost:11434",
    searchChunkSize: stored.searchChunkSize || 2000,
    searchOverlap: stored.searchOverlap ?? 400,
    googleDriveAccount: stored.googleDriveAccount || null,
    googleDriveRootName: stored.googleDriveRootName || "File Garden",
    googleDriveRootId: stored.googleDriveRootId || "",
  };
}

async function readSecrets() {
  try {
    const stored = JSON.parse(await fs.readFile(secretsPath(), "utf8"));
    const result = {};
    for (const [provider, encrypted] of Object.entries(stored)) {
      if (!encrypted) continue;
      result[provider] = safeStorage.decryptString(
        Buffer.from(encrypted, "base64"),
      );
    }
    return result;
  } catch {
    return {};
  }
}

async function saveSecrets({ values = {}, clear = [] }) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "Сістэмнае шыфраванне недаступнае. Правер сховішча ключоў аперацыйнай сістэмы.",
    );
  }
  const current = await readSecrets();
  for (const provider of clear) delete current[provider];
  for (const [provider, value] of Object.entries(values)) {
    const trimmed = String(value || "").trim();
    if (trimmed) current[provider] = trimmed;
  }
  const encrypted = Object.fromEntries(
    Object.entries(current).map(([provider, value]) => [
      provider,
      safeStorage.encryptString(value).toString("base64"),
    ]),
  );
  await fs.mkdir(path.dirname(secretsPath()), { recursive: true });
  await fs.writeFile(secretsPath(), JSON.stringify(encrypted, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  return secretStatus(current);
}

function secretStatus(secrets) {
  return {
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    providers: {
      ollama: true,
      openai: Boolean(secrets.openai),
      google: Boolean(secrets.google),
      openrouter: Boolean(secrets.openrouter),
    },
    googleDriveConnected: Boolean(driveClient && secrets.googleDriveRefreshToken && secrets.googleDriveOAuthClientId === driveClient.clientId),
    googleDriveCanBrowse: Boolean(driveClient && secrets.googleDriveRefreshToken && secrets.googleDriveOAuthClientId === driveClient.clientId && String(secrets.googleDriveScopes || "").split(" ").includes(DRIVE_READ_SCOPE)),
  };
}

async function saveSettings(patch) {
  const current = await readSettings();
  const next = { ...current, ...patch };
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

async function applyDesktopSettings() {
  const settings = await readSettings();
  const secrets = await readSecrets();
  for (const key of MANAGED_ENV_KEYS) delete process.env[key];
  process.env.LLM_PROVIDER = settings.provider;
  process.env.LLM_MODEL = settings.model;
  process.env.VISION_PROVIDER = settings.visionProvider;
  process.env.VISION_MODEL = settings.visionModel;
  process.env.OLLAMA_BASE_URL = settings.ollamaBaseUrl;
  process.env.READER_PYTHON = settings.readerPython;
  process.env.OCR_LANG = settings.ocrLang;
  process.env.OPENAI_TIMEOUT_MS = String(settings.openaiTimeoutMs);
  process.env.OPENAI_MAX_RETRIES = String(settings.openaiMaxRetries);
  if (secrets.openai) process.env.OPENAI_API_KEY = secrets.openai;
  if (secrets.google) process.env.GOOGLE_GEMINI_API_KEY = secrets.google;
  if (secrets.openrouter) process.env.OPENROUTER_API_KEY = secrets.openrouter;
  if (app.isPackaged) {
    const reader = path.join(process.resourcesPath, "read_document.py");
    if (await exists(reader)) process.env.READER_SCRIPT_PATH = reader;
  }
  return { settings, secrets };
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 600,
    minHeight: 480,
    backgroundColor: "#f4f1ea",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 18, y: 22 } }
      : {}),
    webPreferences: {
      preload: path.join(MODULE_DIR, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(MODULE_DIR, "../dist/index.html"));
  }
}

function sendProgress(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function ensureProviderReady(options) {
  if (options.provider !== "ollama") {
    const secrets = await readSecrets();
    if (!secrets[options.provider]) {
      throw new Error(
        `Для ${options.provider} не захаваны API-ключ. Адкрый старонку «Налады».`,
      );
    }
    return;
  }

  const baseUrl = String(options.ollamaBaseUrl || "http://localhost:11434").replace(
    /\/$/,
    "",
  );
  let response;
  try {
    response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new Error(
      `Ollama не адказвае на ${baseUrl}. Запусці Ollama або выберы іншага правайдара ў «Наладах».`,
    );
  }
  if (!response.ok) {
    throw new Error(`Ollama вярнуў памылку HTTP ${response.status}.`);
  }
  const data = await response.json();
  const installed = (data.models || []).map((item) => item.name);
  const wanted = options.model;
  const modelFound = installed.some(
    (name) => name === wanted || name === `${wanted}:latest` || `${name}:latest` === wanted,
  );
  if (!modelFound) {
    throw new Error(
      `Мадэль ${wanted} не ўсталяваная ў Ollama. Даступныя: ${installed.join(", ") || "няма"}.`,
    );
  }
}

async function getGoogleDriveAccessToken() {
  const secrets = await readSecrets();
  if (!secretStatus(secrets).googleDriveConnected) throw new Error('Спачатку падключы Google Drive у «Наладах»');
  const token = await exchangeGoogleToken(driveClient, { refresh_token: secrets.googleDriveRefreshToken, grant_type: 'refresh_token' });
  return token.access_token;
}

async function authorizeGoogleDrive({ browse = false } = {}) {
  if (driveAuthController) throw new Error('Уваход у Google ужо адкрыты');
  const controller = new AbortController();
  driveAuthController = controller;
  try {
    const previous = await readSecrets();
    const scopes = [DRIVE_WRITE_SCOPE, ...((browse || secretStatus(previous).googleDriveCanBrowse) ? [DRIVE_READ_SCOPE] : [])];
    const token = await authorizeDrive(driveClient, { openExternal: url => shell.openExternal(url), signal: controller.signal, scopes });
    const grantedScopes = (token.scope || scopes.join(' ')).split(' ');
    if (scopes.some(scope => !grantedScopes.includes(scope))) throw new Error('Google не даў усе патрэбныя дазволы. Пры падключэнні дазволь выбраныя дзеянні з файламі.');
    const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)', { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
    if (!response.ok) throw new Error(`Google Drive: HTTP ${response.status}`);
    const { user: account } = await response.json();
    controller.signal.throwIfAborted();
    await saveSecrets({ values: { googleDriveRefreshToken: token.refresh_token, googleDriveOAuthClientId: driveClient.clientId, googleDriveScopes: token.scope || scopes.join(" ") } });
    const settings = await saveSettings({ googleDriveRootId: '', googleDriveAccount: account });
    return { account, settings, status: secretStatus(await readSecrets()) };
  } finally { driveAuthController = null; }
}

ipcMain.handle("app:get-config", async () => {
  const { settings, secrets } = await applyDesktopSettings();
  const lastOperation = await readLastOperation(historyPath());
  return {
    settings,
    modelOptions: ProviderModels,
    googleDrive: { available: Boolean(driveClient) },
    secretStatus: secretStatus(secrets),
    canUndo: Boolean((await readLastOperation(historyPath()))?.operations?.length),
    canUploadToDrive: Boolean(
      lastOperation?.mode === "organize" && lastOperation.operations?.length,
    ),
  };
});

ipcMain.handle("app:save-settings", async (_event, patch) => {
  const safePatch = z
    .object({
      provider: z.string().optional(),
      model: z.string().optional(),
      visionProvider: z.string().optional(),
      visionModel: z.string().optional(),
      ollamaBaseUrl: z.string().optional(),
      readerPython: z.string().optional(),
      ocrLang: z.string().optional(),
      openaiTimeoutMs: z.number().int().min(1000).max(600000).optional(),
      openaiMaxRetries: z.number().int().min(0).max(10).optional(),
      language: z.string().optional(),
      pattern: z.string().optional(),
      categories: z.array(z.string()).optional(),
      renameInstructions: z.string().optional(),
      organizeInstructions: z.string().optional(),
      lastDestination: z.string().optional(),
      searchModel: z.string().min(1).max(120).optional(),
      searchBaseUrl: z.string().url().optional(),
      searchChunkSize: z.number().int().min(500).max(8000).optional(),
      searchOverlap: z.number().int().min(0).max(2000).optional(),
      googleDriveRootName: z.string().min(1).max(120).optional(),
      googleDriveRootId: z.string().optional(),
    })
    .parse(patch);
  const previousSettings = await readSettings();
  const nextSettings = { ...previousSettings, ...safePatch };
  if (nextSettings.searchOverlap >= nextSettings.searchChunkSize) throw new Error('Overlap павінен быць меншым за памер фрагмента');
  const settings = await saveSettings(safePatch);
  if (JSON.stringify(searchConfiguration(previousSettings)) !== JSON.stringify(searchConfiguration(settings))) await searchCall('configure', searchConfiguration(settings)).catch(catalogWarning);
  return settings;
});

ipcMain.handle("secrets:save", async (_event, payload) => {
  const safePayload = z
    .object({
      values: z
        .object({
          openai: z.string().optional(),
          google: z.string().optional(),
          openrouter: z.string().optional(),
        })
        .default({}),
      clear: z
        .array(z.enum(["openai", "google", "openrouter"]))
        .default([]),
    })
    .parse(payload);
  const status = await saveSecrets(safePayload);
  await applyDesktopSettings();
  return status;
});

ipcMain.handle("google-drive:connect", async (_event, raw = {}) => authorizeGoogleDrive(z.object({ browse: z.boolean().default(false) }).parse(raw)));

ipcMain.handle("google-drive:cancel", () => { driveAuthController?.abort(); });

ipcMain.handle("google-drive:disconnect", async () => {
  driveAuthController?.abort();
  driveDownloadController?.abort();
  const secrets = await readSecrets();
  if (secrets.googleDriveRefreshToken) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: secrets.googleDriveRefreshToken }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      // Local disconnect must still work if Google is temporarily unavailable.
    }
  }
  await saveSecrets({ clear: ["googleDriveRefreshToken", "googleDriveOAuthClientId", "googleDriveScopes"] });
  const settings = await saveSettings({ googleDriveRootId: "", googleDriveAccount: null });
  return { settings, status: secretStatus(await readSecrets()) };
});

async function requireDriveBrowse() {
  if (!secretStatus(await readSecrets()).googleDriveCanBrowse) throw new Error('Для прагляду дыску падключы Google Drive з дазволам на чытанне');
  return getGoogleDriveAccessToken();
}

ipcMain.handle('google-drive:list', async (_event, raw) => {
  const options = z.object({ parentId: z.string().default('root'), search: z.string().max(200).default(''), pageToken: z.string().max(2000).default('') }).parse(raw || {});
  return listDriveFiles(await requireDriveBrowse(), options);
});

ipcMain.handle('google-drive:download', async (_event, raw) => {
  const { ids } = z.object({ ids: z.array(z.string()).min(1).max(2000) }).parse(raw);
  if (driveDownloadController) throw new Error('Спампоўванне ўжо запушчана');
  const controller = new AbortController();
  driveDownloadController = controller;
  try {
    const settings = await readSettings();
    const result = await downloadDriveFiles({ ids, token: await requireDriveBrowse(), cacheRoot: path.join(app.getPath('userData'), 'drive-imports'), account: settings.googleDriveAccount?.emailAddress, signal: controller.signal, onProgress: progress => sendProgress('drive:progress', progress) });
    await searchCall('track', { files: result.files.map(file => file.localPath), origins: Object.fromEntries(result.files.map(file => [file.localPath, { ...file, account: settings.googleDriveAccount?.emailAddress }])) }).catch(catalogWarning);
    return result;
  } finally { driveDownloadController = null; }
});

ipcMain.handle('google-drive:imports', async () => readDriveImports(path.join(app.getPath('userData'), 'drive-imports'), (await readSettings()).googleDriveAccount?.emailAddress));

ipcMain.handle('google-drive:cancel-download', () => { driveDownloadController?.abort(); });

ipcMain.handle('google-drive:upload-files', async () => {
  const picked = await dialog.showOpenDialog(mainWindow, { title: 'Выберы файлы для капіравання ў Google Drive', properties: ['openFile', 'multiSelections'] });
  if (picked.canceled) return { canceled: true };
  const { files, rejected } = await expandInputPaths(picked.filePaths);
  if (!files.length) throw new Error('Няма падтрымліваемых файлаў для капіравання');
  const settings = await readSettings();
  const confirmation = await dialog.showMessageBox(mainWindow, { type: 'question', title: 'Капіраванне ў Google Drive', message: `Скапіраваць ${files.length} файлаў у Google Drive?`, detail: `Акаўнт: ${settings.googleDriveAccount?.emailAddress || 'Google'}\nМой дыск / ${settings.googleDriveRootName}\nЛакальныя файлы застануцца на месцы. Аднолькавыя назвы ў Drive прапускаюцца. Непадтрымліваемых файлаў: ${rejected.length}`, buttons: ['Скапіраваць', 'Скасаваць'], cancelId: 1 });
  if (confirmation.response !== 0) return { canceled: true };
  return uploadSortedOperations({ operations: files.map(file => ({ id: randomUUID(), to: file })), rootName: settings.googleDriveRootName, categorize: false, getAccessToken: getGoogleDriveAccessToken, onProgress: progress => sendProgress('drive:progress', progress) });
});

ipcMain.handle("dialog:pick-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Выберы файлы",
    properties: ["openFile", "multiSelections"],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("dialog:pick-folders", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Выберы папкі",
    properties: ["openDirectory", "multiSelections"],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("dialog:pick-destination", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Выберы папку выніку",
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? "" : result.filePaths[0] || "";
});

ipcMain.handle("dialog:pick-python", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Выберы Python executable",
    properties: ["openFile", "showHiddenFiles"],
  });
  return result.canceled ? "" : result.filePaths[0] || "";
});

ipcMain.handle("inputs:expand", async (_event, inputPaths) => {
  const result = await expandInputPaths(z.array(z.string()).parse(inputPaths));
  // Hashing large folders must not delay the file list.
  searchCall("track", { files: result.files }).catch(catalogWarning);
  return result;
});

ipcMain.handle("destination:categories", async (_event, destination) => {
  const safeDestination = z.string().min(1).parse(destination);
  try {
    const entries = await fs.readdir(safeDestination, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => sanitizeCategory(entry.name));
  } catch {
    return [];
  }
});

ipcMain.handle("analysis:start", async (_event, rawOptions) => {
  if (activeFileOperation) throw new Error('Дачакайся заканчэння пераносу файлаў');
  const options = analyzeSchema.parse(rawOptions);
  if (options.mode === "organize" && !options.destination) {
    throw new Error("Выберы папку выніку");
  }
  await saveSettings({
    provider: options.provider,
    model: options.model,
    visionProvider: options.visionProvider,
    visionModel: options.visionModel,
    ollamaBaseUrl: options.ollamaBaseUrl,
  });
  await applyDesktopSettings();
  await ensureProviderReady(options);
  activeController?.abort();
  activeController = new AbortController();
  const onProgress = (progress) => sendProgress("analysis:progress", progress);
  const planId = randomUUID();
  await searchCall('suspend', true).catch(catalogWarning);
  const cache = createAnalysisCache(path.join(app.getPath('userData'), 'analysis-cache'), { onWrite: (file, hash, metadata) => { const context = classificationContext(normalizeCategories(options.categories), options.mode === 'rename' ? options.sortingInstructions : options.instructions); return searchCall('update', { file, hash, metadata: { ...metadata, catalogCategory: metadata.classifications?.[context]?.category || metadata.rename?.sortingCategory } }).catch(catalogWarning); } });
  const onCheckpoint = async ({ rows, failures }) => {
    await saveWorkspace(workspacePath(), {
      version: 1, planId, mode: options.mode, files: options.files,
      destination: options.destination, categories: options.categories,
      rows, failures,
    });
  };

  try {
    const result =
      options.mode === "rename"
        ? await analyzeRename(options.files, options, {
            signal: activeController.signal,
            onProgress,
            onCheckpoint,
            cache,
            extractContent: async file => { if (searchStatus?.unavailable) return extractContent(file, { signal: activeController?.signal }); return searchCall("sample", file); },
          })
        : await analyzeOrganize(options.files, options, {
            signal: activeController.signal,
            onProgress,
            onCheckpoint,
            cache,
            extractContent: async file => { if (searchStatus?.unavailable) return extractContent(file, { signal: activeController?.signal }); return searchCall("sample", file); },
          });
    const categories = normalizeCategories(result.categories || options.categories);
    plans.set(planId, {
      mode: options.mode,
      rows: result.rows,
      destination: options.destination,
      categories,
    });
    await saveWorkspace(workspacePath(), {
      version: 1, planId, mode: options.mode, files: options.files,
      destination: options.destination, categories,
      rows: result.rows, failures: result.failures,
    });
    await saveSettings({
      provider: options.provider,
      model: options.model,
      visionProvider: options.visionProvider,
      visionModel: options.visionModel,
      ollamaBaseUrl: options.ollamaBaseUrl,
      language: options.language,
      pattern: options.pattern,
      categories,
      ...(options.mode === "rename"
        ? { renameInstructions: options.instructions }
        : {
            organizeInstructions: options.instructions,
            lastDestination: options.destination,
          }),
    });
    return { planId, ...result, categories };
  } finally {
    activeController = null;
    await searchCall("suspend", false).catch(catalogWarning);
  }
});

ipcMain.handle("analysis:cancel", () => {
  activeController?.abort();
  searchCall("cancelSample").catch(catalogWarning);
  return true;
});

async function effectivePlan(raw) {
  const payload = editSchema.parse(raw);
  const storedPlan = plans.get(payload.planId);
  if (!storedPlan) throw new Error("План састарэў. Запусці аналіз яшчэ раз.");
  const built = await buildPreparedOperations(storedPlan, payload.rows);
  const validation = await validateOperations(built.operations, built.errors);
  return validation;
}

ipcMain.handle("plan:validate", async (_event, raw) => effectivePlan(raw));

ipcMain.handle("file:open", async (_event, raw) => {
  const payload = z
    .object({ planId: z.string().uuid(), rowId: z.string().uuid() })
    .parse(raw);
  const storedPlan = plans.get(payload.planId);
  const row = storedPlan?.rows.find((item) => item.id === payload.rowId);
  if (!row) throw new Error("Файл не ўваходзіць у бягучы план");
  if (!(await exists(row.sourcePath))) {
    throw new Error("Зыходны файл больш не існуе");
  }
  const errorMessage = await shell.openPath(row.sourcePath);
  if (errorMessage) throw new Error(errorMessage);
  return true;
});

async function withCatalogFileOperation(action) {
  if (activeFileOperation || activeController) throw new Error('Дачакайся заканчэння бягучай аперацыі');
  activeFileOperation = true;
  try {
    await searchCall('suspend', true).catch(catalogWarning);
    return await action();
  } finally {
    await searchCall('suspend', false).catch(catalogWarning);
    activeFileOperation = false;
  }
}

ipcMain.handle("plan:apply", (_event, raw) => withCatalogFileOperation(async () => {
  const validation = await effectivePlan(raw);
  if (!validation.valid) return validation;
  const storedPlan = plans.get(raw.planId);
  const previous = await readLastOperation(historyPath());
  const journal = previous?.planId === raw.planId ? previous : {
    planId: raw.planId, createdAt: new Date().toISOString(),
    mode: storedPlan.mode, operations: [],
  };
  const snapshot = await readWorkspace(workspacePath());
  const report = createReport({ mode: storedPlan.mode, destination: storedPlan.destination,
    operations: validation.operations });
  await writeReport(app.getPath('userData'), report);
  const result = await applyOperations(validation.operations, async (progress) => {
    sendProgress('apply:progress', progress);
    if (progress.status === 'completed') {
      const operation = validation.operations.find(item => item.id === progress.id);
      journal.operations.push(operation);
      await searchCall("move", { from: operation.from, to: operation.to, category: storedPlan.mode === "organize" ? path.basename(path.dirname(operation.to)) : undefined }).catch(catalogWarning);
      await writeLastOperation(historyPath(), journal);
      storedPlan.rows = storedPlan.rows.map(row => row.id === operation.id
        ? { ...row, sourcePath: operation.to, selected: false, status: 'completed' } : row);
      if (snapshot?.planId === raw.planId) {
        snapshot.rows = storedPlan.rows;
        snapshot.files = snapshot.files.map(file => file === operation.from ? operation.to : file);
        await saveWorkspace(workspacePath(), snapshot);
      }
    }
    updateReport(report, progress);
    await writeReport(app.getPath('userData'), report);
  });
  report.status = result.failures.length ? 'completed-with-errors' : 'completed';
  report.finishedAt = new Date().toISOString();
  await writeReport(app.getPath('userData'), report);
  return { valid: true, ...result, report };
}));

ipcMain.handle("google-drive:upload-last", async () => {
  const journal = await readLastOperation(historyPath());
  if (journal?.mode !== "organize" || !journal.operations?.length) {
    throw new Error("Няма вынікаў апошняй сартыроўкі для загрузкі");
  }
  const settings = await readSettings();
  if (!secretStatus(await readSecrets()).googleDriveConnected) throw new Error('Спачатку падключы Google Drive');
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'question', title: 'Капіраванне ў Google Drive',
    message: `Скапіраваць ${journal.operations.length} файлаў апошняй сартыроўкі?`,
    detail: `Акаўнт: ${settings.googleDriveAccount?.emailAddress || 'Google'}\nПапка: Мой дыск / ${settings.googleDriveRootName}\nЛакальныя файлы застануцца на месцы. Файлы з аднолькавымі назвамі ў Drive будуць прапушчаныя.`,
    buttons: ['Скапіраваць', 'Скасаваць'], defaultId: 0, cancelId: 1,
  });
  if (confirmation.response !== 0) return { canceled: true };

  const result = await uploadSortedOperations({
    operations: journal.operations,
    rootName: settings.googleDriveRootName || "File Garden",
    getAccessToken: getGoogleDriveAccessToken,
    onProgress: (progress) => sendProgress("drive:progress", progress),
  });
  if (settings.googleDriveRootId !== result.root.id) {
    await saveSettings({ googleDriveRootId: result.root.id });
  }
  return result;
});

ipcMain.handle("plan:undo", () => withCatalogFileOperation(() =>
  undoLastOperation(historyPath(), async progress => {
    sendProgress("undo:progress", progress);
    if (progress.status === "completed") await searchCall("move", { from: progress.from, to: progress.to }).catch(catalogWarning);
  })
));

function searchConfiguration(settings) {
  return { model: settings.searchModel, baseUrl: settings.searchBaseUrl, size: settings.searchChunkSize, overlap: settings.searchOverlap, python: settings.readerPython, lang: settings.ocrLang, vectorLibrary: app.isPackaged ? path.join(process.resourcesPath, 'vector-runtime', `${process.platform}-${process.arch}`, `vec0.${process.platform === 'darwin' ? 'dylib' : process.platform === 'win32' ? 'dll' : 'so'}`) : undefined, script: app.isPackaged ? path.join(process.resourcesPath, 'read_document.py') : path.resolve(MODULE_DIR, '../../read_document.py') };
}
async function migrateCatalog() {
  const files = new Set(), origins = {};
  const workspace = await readWorkspace(workspacePath());
  for (const file of workspace?.files || []) files.add(file);
  const journal = await readLastOperation(historyPath());
  for (const operation of journal?.operations || []) { files.add(operation.from); files.add(operation.to); }
  for (const entry of await fs.readdir(path.join(app.getPath('userData'), 'reports')).catch(() => [])) {
    if (!entry.endsWith('.json')) continue;
    try { const report = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'reports', entry), 'utf8')); for (const row of report.entries || []) { if(row.from)files.add(row.from); if(row.to)files.add(row.to); } } catch {}
  }
  for (const session of await readDriveImports(path.join(app.getPath('userData'), 'drive-imports'))) for (const file of session.files) { files.add(file.localPath); origins[file.localPath] = file; }
  return searchCall('migrate', { files: [...files], origins });
}
ipcMain.handle('catalog:status', () => searchCall('status'));
ipcMain.handle('catalog:search', (_event, raw) => searchCall('search', z.object({ query: z.string().max(2000).default(''), mode: z.enum(['semantic','exact']).default('semantic'), limit: z.number().int().min(1).max(100).default(20), filters: z.object({ source: z.enum(['','local','drive']).optional(), category: z.string().max(80).optional(), dateFrom: z.string().max(10).optional(), dateTo: z.string().max(10).optional() }).default({}) }).parse(raw)));
ipcMain.handle('catalog:pause', (_event, value) => searchCall('pause', z.boolean().parse(value)));
ipcMain.handle('catalog:index', () => searchCall('index'));
ipcMain.handle('catalog:retry', () => searchCall('retry'));
ipcMain.handle('catalog:resync', () => {
  if (activeController || activeFileOperation) throw new Error('Дачакайся заканчэння аналізу або пераносу файлаў');
  return searchCall('resync');
});
ipcMain.handle('catalog:cancel-resync', () => searchCall('cancelResync'));
ipcMain.handle('catalog:pull-model', () => searchCall('pull'));
ipcMain.handle('catalog:cancel-pull', () => searchCall('cancelPull'));
ipcMain.handle('catalog:file', async (_event, raw) => {
  const payload = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), location: z.union([z.number().int().min(0), z.string().min(1)]).default(0), action: z.enum(['open','reveal','add']).default('open') }).parse(raw);
  const file = await searchCall('lookup', payload);
  if(payload.action==='add')return file;
  if(payload.action==='reveal'){shell.showItemInFolder(file);return true;}
  const error = await shell.openPath(file);if(error)throw new Error(error);return true;
});
let closingCatalog = false;
app.on('before-quit', event => {
  if (searchService && !closingCatalog) { event.preventDefault(); closingCatalog = true; activeController?.abort(); searchService.close().finally(() => app.quit()); }
});

app.whenReady().then(async () => {
  const { settings } = await applyDesktopSettings();
  searchService = createSearchService(path.join(app.getPath("userData"), "catalog"), searchConfiguration(settings), (event, data) => {
    if (event === "status") searchStatus = data;
    sendProgress(event === "pull" ? "catalog:model-progress" : "catalog:status", data);
  });
  await createWindow();
  migrateCatalog().catch(catalogWarning);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
