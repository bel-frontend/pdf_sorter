import fs from "node:fs/promises";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import mammoth from "mammoth";
const execute = promisify(execFile);
export const isPageDocument = (file) =>
  [
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".tiff",
    ".tif",
    ".bmp",
    ".gif",
    ".webp",
  ].includes(path.extname(file).toLowerCase());
export async function readPages(
  file,
  {
    python = "python3",
    script = fileURLToPath(
      new URL("../../../../read_document.py", import.meta.url),
    ),
    lang = "en,ru,be,uk",
    smart = false,
    skip = [],
    signal,
    onPage = () => {},
    onInfo = () => {},
  } = {},
) {
  if (!isPageDocument(file)) {
    if (skip.includes(1)) {
      onInfo(1);
      return;
    }
    let text;
    const ext = path.extname(file).toLowerCase();
    if (ext === ".docx")
      text = (await mammoth.extractRawText({ path: file })).value;
    else if (ext === ".doc")
      text = (
        await execute("textutil", ["-convert", "txt", "-stdout", file], {
          signal,
          maxBuffer: 100 * 1024 * 1024,
        })
      ).stdout;
    else text = await fs.readFile(file, "utf8");
    onInfo(1);
    onPage({ number: 1, total: 1, text, method: "text", error: "" });
    return;
  }
  signal?.throwIfAborted();
  await new Promise((resolve, reject) => {
    const args = [
      script,
      file,
      "--json-lines",
      "--lang",
      lang,
      ...(smart ? ["--smart-pages"] : []),
      ...(skip.length ? ["--skip-pages", skip.join(",")] : []),
    ];
    const child = spawn(python, args, {
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buffer = "",
      stderr = "",
      failure = null;
    let timer = setTimeout(() => {
      failure = new Error("Чытанне старонкі заняло больш за 300 секунд");
      child.kill();
    }, 300000);
    const emit = (line) => {
      if (!line.trim()) return;
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        throw new Error("Чытач не вярнуў правільны JSON старонкі");
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        failure = new Error("Чытанне старонкі заняло больш за 300 секунд");
        child.kill();
      }, 300000);
      if (data.type === "info") onInfo(data.total);
      else if (data.type === "page") onPage(data);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (signal?.aborted) return;
      buffer += chunk;
      let end;
      try {
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          emit(line);
        }
      } catch (error) {
        failure = error;
        child.kill();
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-3000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      if (failure) {
        reject(failure);
        return;
      }
      try {
        if (buffer.trim()) emit(buffer);
        clearTimeout(timer);
      } catch (error) {
        reject(error);
        return;
      }
      code === 0
        ? resolve()
        : reject(
            new Error(
              `Чытач дакумента не працуе: ${stderr.trim() || "exit " + code}`,
            ),
          );
    });
  });
}
