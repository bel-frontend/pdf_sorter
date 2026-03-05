import path from "node:path";
import { z } from "zod";

const schema = z.object({
  title: z.string().min(3).max(120),
  type: z.string().min(2).max(60),
  summary: z.string().min(3).max(1000),
  date: z.string().optional().default(""),
  person: z.string().optional().default(""),
  confidence: z.any().optional(),
});

const TOKEN_MAPS = {
  pl: {
    invoice: "faktura",
    application: "wniosek",
    certificate: "zaswiadczenie",
    contract: "umowa",
    report: "raport",
    passport: "paszport",
    statement: "wyciag",
    bank: "bankowy",
    payment: "platnosc",
    declaration: "deklaracja",
    residence: "pobyt",
    power: "pelnomocnictwo",
    attorney: "pelnomocnictwo",
    scan: "skan",
    unreadable: "nieczytelny",
    photo: "zdjecie",
  },
};

let _activeTokenMap = {};

function normalizeConfidence(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0.35;
  if (numberValue < 0) return 0;
  if (numberValue > 1) return 1;
  return numberValue;
}

function responseToText(content) {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string")
          return part.text;
        return "";
      })
      .join("\n")
      .trim();
  }

  if (
    content &&
    typeof content === "object" &&
    typeof content.text === "string"
  ) {
    return content.text;
  }

  return String(content ?? "");
}

function sanitizeBaseName(name) {
  const basic = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

  const replaced = basic
    .split("_")
    .map((token) => _activeTokenMap[token] || token)
    .join("_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return replaced.slice(0, 120);
}

function tokenizeName(name) {
  return sanitizeBaseName(name)
    .split("_")
    .map((t) => t.trim())
    .filter(Boolean);
}

function uniqueTokens(tokens) {
  const seen = new Set();
  const out = [];
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function normalizeDateToken(dateValue) {
  const raw = String(dateValue || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!match) return "";
  if (match[3]) return `${match[1]}-${match[2]}-${match[3]}`;
  if (match[2]) return `${match[1]}-${match[2]}`;
  return match[1];
}

function appendTokenIfMissing(baseName, token) {
  const chunks = tokenizeName(baseName);
  const tokenParts = tokenizeName(token);
  if (tokenParts.length === 0) return baseName;

  const merged = [...chunks];
  for (const part of tokenParts) {
    if (!merged.includes(part)) merged.push(part);
  }

  return sanitizeBaseName(merged.join("_"));
}

function ensurePersonAndDate(baseName, person, date) {
  const maxLength = 110;
  const personTokens = tokenizeName(person);
  const dateTokens = tokenizeName(normalizeDateToken(date));

  let baseTokens = tokenizeName(baseName).filter(
    (token) => !personTokens.includes(token) && !dateTokens.includes(token),
  );

  baseTokens = uniqueTokens(baseTokens);
  const fixedTail = uniqueTokens([...personTokens, ...dateTokens]);

  let finalTokens = uniqueTokens([...baseTokens, ...fixedTail]);

  while (
    sanitizeBaseName(finalTokens.join("_")).length > maxLength &&
    baseTokens.length > 1
  ) {
    baseTokens = baseTokens.slice(0, -1);
    finalTokens = uniqueTokens([...baseTokens, ...fixedTail]);
  }

  const finalName = sanitizeBaseName(finalTokens.join("_"));
  return finalName.length > maxLength
    ? finalName.slice(0, maxLength)
    : finalName;
}

const LANG_PROMPTS = {
  pl: {
    titleLang: "Polish language",
    summaryLang: "Polish",
    noEnglish:
      "Do not use English in title unless it is an official proper noun.",
  },
  en: {
    titleLang: "English language",
    summaryLang: "English",
    noEnglish: "",
  },
  be: {
    titleLang: "Belarusian language transliterated to Latin alphabet",
    summaryLang: "Belarusian",
    noEnglish:
      "Do not use English in title unless it is an official proper noun.",
  },
  ru: {
    titleLang: "Russian language transliterated to Latin alphabet",
    summaryLang: "Russian",
    noEnglish:
      "Do not use English in title unless it is an official proper noun.",
  },
};

export async function suggestName({ llm, file, content, rules, lang = "en" }) {
  _activeTokenMap = TOKEN_MAPS[lang] || {};
  const ext = path.extname(file.relativePath).toLowerCase();
  const lp = LANG_PROMPTS[lang] || LANG_PROMPTS.en;
  const prompt = [
    "You are a file naming assistant.",
    "Return ONLY strict JSON with keys: title,type,summary,date,person,confidence.",
    `title must be in ${lp.titleLang}, lowercase snake_case, filesystem-safe words (without extension).`,
    "Use one consistent naming style for all files.",
    lp.noEnglish,
    "date format if known: YYYY or YYYY-MM or YYYY-MM-DD, else empty string.",
    "If the document contains a person surname/name (e.g. passport, ID, permit), set person as surname or surname_name in Latin letters and include it in title.",
    `summary in ${lp.summaryLang}, concise.`,
    "Do not invent facts. Use low confidence when uncertain.",
    "General naming rules:",
    rules || "Use semantic names by document meaning and type.",
    `Original path: ${file.relativePath}`,
    `Extension: ${ext}`,
    "Extracted content (possibly partial):",
    content && content.trim().length > 0
      ? content.slice(0, 8000)
      : "[NO_TEXT_EXTRACTED]",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await llm.invoke(prompt);
  const raw = responseToText(res?.content).trim();

  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error(`Model response is not JSON for ${file.relativePath}`);
  }

  const parsedRaw = schema.parse(JSON.parse(raw.slice(jsonStart, jsonEnd + 1)));
  const parsed = {
    ...parsedRaw,
    summary: String(parsedRaw.summary || "").slice(0, 240),
    confidence: normalizeConfidence(parsedRaw.confidence),
  };
  const baseTitle = sanitizeBaseName(parsed.title) || "document";
  const safeTitle = ensurePersonAndDate(baseTitle, parsed.person, parsed.date);

  return {
    ...parsed,
    safeTitle,
    proposedFileName: `${safeTitle}${ext}`,
  };
}
