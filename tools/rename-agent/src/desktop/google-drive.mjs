import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

const MIME_TYPES = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xml": "application/xml",
};

export function driveQueryLiteral(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function mimeTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

async function driveRequest(url, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Drive: HTTP ${response.status}${detail ? ` — ${detail.slice(0, 300)}` : ""}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function findChild(accessToken, parentId, name, mimeType) {
  const clauses = [
    `'${driveQueryLiteral(parentId)}' in parents`,
    `name = '${driveQueryLiteral(name)}'`,
    "trashed = false",
  ];
  if (mimeType) clauses.push(`mimeType = '${driveQueryLiteral(mimeType)}'`);
  const params = new URLSearchParams({
    q: clauses.join(" and "),
    spaces: "drive",
    fields: "files(id,name,mimeType,webViewLink)",
    pageSize: "10",
  });
  const result = await driveRequest(`${DRIVE_API}/files?${params}`, accessToken);
  return result.files?.[0] || null;
}

async function createFolder(accessToken, name, parentId) {
  const metadata = {
    name,
    mimeType: FOLDER_MIME,
    ...(parentId ? { parents: [parentId] } : {}),
  };
  return driveRequest(`${DRIVE_API}/files?fields=id,name,webViewLink`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(metadata),
  });
}

export async function ensureDriveFolder(accessToken, name, parentId = "root") {
  return (
    (await findChild(accessToken, parentId, name, FOLDER_MIME)) ||
    createFolder(accessToken, name, parentId === "root" ? undefined : parentId)
  );
}

export async function uploadFileToDrive(accessToken, filePath, parentId) {
  const name = path.basename(filePath);
  const existing = await findChild(accessToken, parentId, name);
  if (existing) return { ...existing, skipped: true };

  const stat = await fsp.stat(filePath);
  const mimeType = mimeTypeFor(filePath);
  const start = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,webViewLink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(stat.size),
      },
      body: JSON.stringify({ name, parents: [parentId] }),
    },
  );
  if (!start.ok) {
    const detail = await start.text();
    throw new Error(`Google Drive: не пачалася загрузка (${start.status}) ${detail.slice(0, 300)}`);
  }
  const uploadUrl = start.headers.get("location");
  if (!uploadUrl) throw new Error("Google Drive не вярнуў адрас загрузкі");

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(stat.size),
    },
    body: fs.createReadStream(filePath),
    duplex: "half",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Drive: загрузка не ўдалася (${response.status}) ${detail.slice(0, 300)}`);
  }
  return response.json();
}

export async function uploadSortedOperations({
  operations,
  rootName,
  getAccessToken,
  onProgress = () => {},
}) {
  const accessToken = await getAccessToken();
  const root = await ensureDriveFolder(accessToken, rootName || "File Garden");
  const folderCache = new Map();
  const completed = [];
  const failures = [];

  for (const [index, operation] of operations.entries()) {
    try {
      const category = path.basename(path.dirname(operation.to)) || "other";
      let folder = folderCache.get(category);
      if (!folder) {
        folder = await ensureDriveFolder(accessToken, category, root.id);
        folderCache.set(category, folder);
      }
      const uploaded = await uploadFileToDrive(accessToken, operation.to, folder.id);
      completed.push({ ...operation, driveFile: uploaded });
      onProgress({
        current: index + 1,
        total: operations.length,
        id: operation.id,
        status: uploaded.skipped ? "skipped" : "completed",
      });
    } catch (error) {
      const failure = { ...operation, error: String(error?.message || error) };
      failures.push(failure);
      onProgress({
        current: index + 1,
        total: operations.length,
        id: operation.id,
        status: "failed",
        error: failure.error,
      });
    }
  }

  return { root, completed, failures };
}
