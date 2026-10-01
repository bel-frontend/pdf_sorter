import fs from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  buildEffectiveOperations,
  sanitizeCategory,
  validateOperations,
} from "../src/desktop/plan.mjs";
import {
  readLastOperation,
  undoLastOperation,
  writeLastOperation,
} from "../src/desktop/history.mjs";
import {
  ensureDriveFolder,
  uploadSortedOperations,
} from "../src/desktop/google-drive.mjs";

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
    googleDriveClientId: stored.googleDriveClientId || "",
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
    googleDriveClientSecret: Boolean(secrets.googleDriveClientSecret),
    googleDriveConnected: Boolean(secrets.googleDriveRefreshToken),
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
    minWidth: 980,
    minHeight: 680,
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

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function exchangeGoogleToken(parameters) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parameters),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Google OAuth: ${data.error_description || data.error || `HTTP ${response.status}`}`,
    );
  }
  return data;
}

async function getGoogleDriveAccessToken() {
  const settings = await readSettings();
  const secrets = await readSecrets();
  if (!settings.googleDriveClientId || !secrets.googleDriveRefreshToken) {
    throw new Error("Спачатку падключы Google Drive у «Наладах»");
  }
  const token = await exchangeGoogleToken({
    client_id: settings.googleDriveClientId,
    ...(secrets.googleDriveClientSecret
      ? { client_secret: secrets.googleDriveClientSecret }
      : {}),
    refresh_token: secrets.googleDriveRefreshToken,
    grant_type: "refresh_token",
  });
  return token.access_token;
}

async function authorizeGoogleDrive() {
  const settings = await readSettings();
  const secrets = await readSecrets();
  if (!settings.googleDriveClientId) {
    throw new Error("Увядзі Google OAuth Client ID і захавай налады");
  }

  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const state = base64Url(randomBytes(24));
  let timeout;
  let settled = false;

  const authorization = await new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      try {
        const url = new URL(request.url || "/", "http://127.0.0.1");
        if (url.pathname !== "/oauth2callback") {
          response.writeHead(404).end();
          return;
        }
        if (url.searchParams.get("state") !== state) {
          throw new Error("Google OAuth вярнуў няправільны state");
        }
        const oauthError = url.searchParams.get("error");
        if (oauthError) throw new Error(`Google OAuth: ${oauthError}`);
        const code = url.searchParams.get("code");
        if (!code) throw new Error("Google OAuth не вярнуў код аўтарызацыі");
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<h2>Google Drive падключаны</h2><p>Можна закрыць гэту старонку і вярнуцца ў File Garden.</p>");
        settled = true;
        clearTimeout(timeout);
        server.close();
        resolve({ code, redirectUri });
      } catch (error) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(String(error?.message || error));
        settled = true;
        clearTimeout(timeout);
        server.close();
        reject(error);
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
      const params = new URLSearchParams({
        client_id: settings.googleDriveClientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/drive.file",
        access_type: "offline",
        prompt: "consent",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
      });
      try {
        await shell.openExternal(
          `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
        );
      } catch (error) {
        server.close();
        reject(error);
      }
    });
    let redirectUri = "";
    timeout = setTimeout(() => {
      if (settled) return;
      server.close();
      reject(new Error("Час чакання аўтарызацыі Google скончыўся"));
    }, 180000);
  });

  const token = await exchangeGoogleToken({
    client_id: settings.googleDriveClientId,
    ...(secrets.googleDriveClientSecret
      ? { client_secret: secrets.googleDriveClientSecret }
      : {}),
    code: authorization.code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: authorization.redirectUri,
  });
  if (!token.refresh_token) {
    throw new Error("Google не вярнуў refresh token. Адкліч доступ і падключыся нанова.");
  }
  await saveSecrets({ values: { googleDriveRefreshToken: token.refresh_token } });
  const root = await ensureDriveFolder(
    token.access_token,
    settings.googleDriveRootName || "File Garden",
  );
  await saveSettings({ googleDriveRootId: root.id });
  return { root, status: secretStatus(await readSecrets()) };
}

ipcMain.handle("app:get-config", async () => {
  const { settings, secrets } = await applyDesktopSettings();
  const lastOperation = await readLastOperation(historyPath());
  return {
    settings,
    modelOptions: ProviderModels,
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
      googleDriveClientId: z.string().optional(),
      googleDriveRootName: z.string().min(1).max(120).optional(),
      googleDriveRootId: z.string().optional(),
    })
    .parse(patch);
  return saveSettings(safePatch);
});

ipcMain.handle("secrets:save", async (_event, payload) => {
  const safePayload = z
    .object({
      values: z
        .object({
          openai: z.string().optional(),
          google: z.string().optional(),
          openrouter: z.string().optional(),
          googleDriveClientSecret: z.string().optional(),
        })
        .default({}),
      clear: z
        .array(z.enum(["openai", "google", "openrouter", "googleDriveClientSecret"]))
        .default([]),
    })
    .parse(payload);
  const status = await saveSecrets(safePayload);
  await applyDesktopSettings();
  return status;
});

ipcMain.handle("google-drive:connect", async () => authorizeGoogleDrive());

ipcMain.handle("google-drive:disconnect", async () => {
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
  await saveSecrets({ clear: ["googleDriveRefreshToken"] });
  const settings = await saveSettings({ googleDriveRootId: "" });
  return { settings, status: secretStatus(await readSecrets()) };
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
  return expandInputPaths(z.array(z.string()).parse(inputPaths));
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

  try {
    const result =
      options.mode === "rename"
        ? await analyzeRename(options.files, options, {
            signal: activeController.signal,
            onProgress,
          })
        : await analyzeOrganize(options.files, options, {
            signal: activeController.signal,
            onProgress,
          });
    const planId = randomUUID();
    const categories = normalizeCategories(result.categories || options.categories);
    plans.set(planId, {
      mode: options.mode,
      rows: result.rows,
      destination: options.destination,
      categories,
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
  }
});

ipcMain.handle("analysis:cancel", () => {
  activeController?.abort();
  return true;
});

async function effectivePlan(raw) {
  const payload = editSchema.parse(raw);
  const storedPlan = plans.get(payload.planId);
  if (!storedPlan) throw new Error("План састарэў. Запусці аналіз яшчэ раз.");
  const built = buildEffectiveOperations(storedPlan, payload.rows);
  return validateOperations(built.operations, built.errors);
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

ipcMain.handle("plan:apply", async (_event, raw) => {
  const validation = await effectivePlan(raw);
  if (!validation.valid) return validation;
  const storedPlan = plans.get(raw.planId);
  const result = await applyOperations(validation.operations, (progress) =>
    sendProgress("apply:progress", progress),
  );
  if (storedPlan && result.completed.length > 0) {
    const completedById = new Map(
      result.completed.map((operation) => [operation.id, operation]),
    );
    storedPlan.rows = storedPlan.rows.map((row) => {
      const operation = completedById.get(row.id);
      return operation ? { ...row, sourcePath: operation.to } : row;
    });
  }
  if (result.completed.length > 0) {
    await writeLastOperation(historyPath(), {
      createdAt: new Date().toISOString(),
      mode: storedPlan?.mode || "rename",
      operations: result.completed,
    });
  }
  return { valid: true, ...result };
});

ipcMain.handle("google-drive:upload-last", async () => {
  const journal = await readLastOperation(historyPath());
  if (journal?.mode !== "organize" || !journal.operations?.length) {
    throw new Error("Няма вынікаў апошняй сартыроўкі для загрузкі");
  }
  const settings = await readSettings();
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

ipcMain.handle("plan:undo", async () => {
  return undoLastOperation(historyPath(), (progress) =>
    sendProgress("undo:progress", progress),
  );
});

app.whenReady().then(async () => {
  await applyDesktopSettings();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
