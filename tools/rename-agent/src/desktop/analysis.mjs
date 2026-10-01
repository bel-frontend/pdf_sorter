import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { extractContent } from "../extractors.mjs";
import { buildChatModel } from "../llm.mjs";
import {
  formatName,
  reserveUniquePath,
  sanitizeCategory,
  sanitizeNamePart,
} from "./plan.mjs";

const IMAGE_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".bmp": "image/bmp",
};

const renameSchema = z.object({
  category: z.string().min(1).max(80),
  topic: z.string().min(1).max(120),
  person: z.string().optional().default(""),
  date: z.string().optional().default(""),
  summary: z.string().min(1).max(1000),
  confidence: z.coerce.number().min(0).max(1).catch(0.35),
});

const categorySchema = z.object({
  category: z.string().min(1),
  reason: z.string().optional().default(""),
  confidence: z.coerce.number().min(0).max(1).catch(0.35),
});

const LANGUAGE_NAMES = {
  en: "English",
  pl: "Polish",
  be: "Belarusian written with Latin characters",
  ru: "Russian written with Latin characters",
};

function responseText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .join("\n");
  }
  return String(content?.text || content || "");
}

function parseJson(content) {
  const raw = responseText(content).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Мадэль не вярнула JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

function isFatalModelError(error) {
  const message = String(error?.message || error || "");
  return /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|401|403|unauthorized|forbidden|API.?key|model.+not found|document reader unavailable/i.test(
    message,
  );
}

function fatalAnalysisMessage(error) {
  const message = String(error?.message || error);
  return /document reader unavailable/i.test(message)
    ? `Не працуе чытанне дакумента: ${message}`
    : `Злучэнне з мадэллю перарвана: ${message}`;
}

function modelConfig(options) {
  return {
    provider: options.provider,
    model: options.model,
    ollamaBaseUrl: options.ollamaBaseUrl,
  };
}

async function invoke(llm, input, signal) {
  return llm.invoke(input, signal ? { signal } : undefined);
}

function renamePrompt(filePath, options, content) {
  const language = LANGUAGE_NAMES[options.language] || LANGUAGE_NAMES.en;
  return [
    "You create structured metadata for a safe file name.",
    'Return ONLY JSON: {"category":"...","topic":"...","person":"...","date":"...","summary":"...","confidence":0.0}.',
    `Use ${language} for category and topic, transliterated to ASCII-compatible Latin letters.`,
    "category and topic must be concise lowercase snake_case fragments.",
    "person is a surname or surname_name when clearly present, otherwise empty.",
    "date is YYYY, YYYY-MM, or YYYY-MM-DD when known, otherwise empty.",
    "Do not invent facts.",
    options.instructions ? `User instructions: ${options.instructions}` : "",
    `Original file: ${path.basename(filePath)}`,
    "Extracted content:",
    content?.trim() ? content.slice(0, 8000) : "[NO_TEXT_EXTRACTED]",
  ]
    .filter(Boolean)
    .join("\n");
}

async function suggestRename(llm, visionLlm, filePath, options, signal) {
  const extension = path.extname(filePath).toLowerCase();
  let response;
  if (IMAGE_MIME[extension]) {
    const bytes = await fs.readFile(filePath);
    const imageInput = [
      new HumanMessage({
        content: [
          { type: "text", text: renamePrompt(filePath, options, "") },
          {
            type: "image_url",
            image_url: {
              url: `data:${IMAGE_MIME[extension]};base64,${bytes.toString("base64")}`,
            },
          },
        ],
      }),
    ];
    try {
      response = await invoke(visionLlm, imageInput, signal);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      try {
        if (visionLlm === llm) throw error;
        response = await invoke(llm, imageInput, signal);
      } catch (mainVisionError) {
        if (mainVisionError?.name === "AbortError") throw mainVisionError;
        const content = await extractContent(filePath, { imageOcr: false });
        response = await invoke(llm, renamePrompt(filePath, options, content), signal);
      }
    }
  } else {
    const content = await extractContent(filePath);
    response = await invoke(llm, renamePrompt(filePath, options, content), signal);
  }
  return renameSchema.parse(parseJson(response?.content));
}

function categoryPrompt(filePath, categories, instructions, content) {
  return [
    "Classify this file into exactly one allowed category.",
    `Allowed categories: ${categories.join(", ")}`,
    'Return ONLY JSON: {"category":"allowed_category","reason":"short explanation","confidence":0.0}.',
    "Never return a category outside the allowed list. Use other when uncertain.",
    instructions ? `User instructions: ${instructions}` : "",
    `Original file: ${path.basename(filePath)}`,
    content === undefined ? "" : `Extracted content:\n${content || "[NO_TEXT_EXTRACTED]"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function classifyFile(llm, visionLlm, filePath, options, signal) {
  const extension = path.extname(filePath).toLowerCase();
  let response;

  if (IMAGE_MIME[extension]) {
    const bytes = await fs.readFile(filePath);
    const imageInput = [
      new HumanMessage({
        content: [
          {
            type: "text",
            text: categoryPrompt(
              filePath,
              options.categories,
              options.instructions,
            ),
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${IMAGE_MIME[extension]};base64,${bytes.toString("base64")}`,
            },
          },
        ],
      }),
    ];
    try {
      response = await invoke(visionLlm, imageInput, signal);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      try {
        if (visionLlm === llm) throw error;
        response = await invoke(llm, imageInput, signal);
      } catch (mainVisionError) {
        if (mainVisionError?.name === "AbortError") throw mainVisionError;
        const content = await extractContent(filePath, { imageOcr: false });
        response = await invoke(
          llm,
          categoryPrompt(
            filePath,
            options.categories,
            options.instructions,
            content.slice(0, 5000),
          ),
          signal,
        );
      }
    }
  } else {
    const content = await extractContent(filePath);
    response = await invoke(
      llm,
      categoryPrompt(
        filePath,
        options.categories,
        options.instructions,
        content.slice(0, 5000),
      ),
      signal,
    );
  }

  const parsed = categorySchema.parse(parseJson(response?.content));
  const normalized = sanitizeCategory(parsed.category);
  return {
    ...parsed,
    category: options.categories.includes(normalized) ? normalized : "other",
  };
}

export function normalizeCategories(values) {
  const categories = (values || []).map(sanitizeCategory).filter(Boolean);
  if (!categories.includes("other")) categories.push("other");
  return [...new Set(categories)];
}

export async function analyzeRename(files, options, hooks = {}) {
  const llm = buildChatModel(modelConfig(options));
  let visionLlm = llm;
  try {
    visionLlm = buildChatModel({
      provider: options.visionProvider,
      model: options.visionModel,
      ollamaBaseUrl: options.ollamaBaseUrl,
    });
  } catch {
    // Filename/text analysis remains available if a vision model cannot initialize.
  }
  const reserved = new Set();
  const rows = [];
  const failures = [];
  let cancelled = false;

  for (const [index, filePath] of files.entries()) {
    if (hooks.signal?.aborted) {
      cancelled = true;
      break;
    }
    hooks.onProgress?.({
      phase: "analysis",
      current: index,
      total: files.length,
      filePath,
    });
    try {
      const suggestion = await suggestRename(
        llm,
        visionLlm,
        filePath,
        options,
        hooks.signal,
      );
      const extension = path.extname(filePath).toLowerCase();
      const fields = {
        category: sanitizeNamePart(suggestion.category, "document"),
        topic: sanitizeNamePart(suggestion.topic, "file"),
        person: sanitizeNamePart(suggestion.person, ""),
        date: sanitizeNamePart(suggestion.date, ""),
      };
      const desired = path.join(
        path.dirname(filePath),
        `${formatName(options.pattern, fields)}${extension}`,
      );
      const targetPath =
        path.resolve(desired).toLowerCase() === path.resolve(filePath).toLowerCase()
          ? desired
          : await reserveUniquePath(desired, reserved);
      rows.push({
        id: randomUUID(),
        sourcePath: filePath,
        proposedName: path.basename(targetPath),
        targetPath,
        summary: suggestion.summary.slice(0, 240),
        confidence: suggestion.confidence,
      });
    } catch (error) {
      if (error?.name === "AbortError" || hooks.signal?.aborted) {
        cancelled = true;
        break;
      }
      if (isFatalModelError(error)) {
        throw new Error(fatalAnalysisMessage(error));
      }
      failures.push({
        sourcePath: filePath,
        error: String(error?.message || error),
      });
    }
  }
  hooks.onProgress?.({
    phase: "analysis",
    current: rows.length + failures.length,
    total: files.length,
  });
  return { rows, failures, cancelled };
}

export async function analyzeOrganize(files, options, hooks = {}) {
  const categories = normalizeCategories(options.categories);
  const llm = buildChatModel(modelConfig(options));
  let visionLlm = llm;
  try {
    visionLlm = buildChatModel({
      provider: options.visionProvider,
      model: options.visionModel,
      ollamaBaseUrl: options.ollamaBaseUrl,
    });
  } catch {
    // Text/OCR classification remains available when the vision model is not.
  }
  const reserved = new Set();
  const rows = [];
  const failures = [];
  let cancelled = false;

  for (const [index, filePath] of files.entries()) {
    if (hooks.signal?.aborted) {
      cancelled = true;
      break;
    }
    hooks.onProgress?.({
      phase: "analysis",
      current: index,
      total: files.length,
      filePath,
    });
    try {
      const result = await classifyFile(
        llm,
        visionLlm,
        filePath,
        { ...options, categories },
        hooks.signal,
      );
      const desired = path.join(
        options.destination,
        result.category,
        path.basename(filePath),
      );
      const targetPath = await reserveUniquePath(desired, reserved);
      rows.push({
        id: randomUUID(),
        sourcePath: filePath,
        category: result.category,
        targetPath,
        summary: result.reason.slice(0, 240),
        confidence: result.confidence,
      });
    } catch (error) {
      if (error?.name === "AbortError" || hooks.signal?.aborted) {
        cancelled = true;
        break;
      }
      if (isFatalModelError(error)) {
        throw new Error(fatalAnalysisMessage(error));
      }
      failures.push({
        sourcePath: filePath,
        error: String(error?.message || error),
      });
    }
  }
  hooks.onProgress?.({
    phase: "analysis",
    current: rows.length + failures.length,
    total: files.length,
  });
  return { rows, failures, categories, cancelled };
}
