import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { HumanMessage } from "@langchain/core/messages";
import { extractContent } from "./extractors.mjs";
import { buildChatModel } from "./llm.mjs";
import { parseArgs as parseBaseArgs } from "./config.mjs";

const IMAGE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".tiff",
  ".tif",
  ".bmp",
  ".webp",
  ".gif",
]);

const include = ["**/*.{pdf,jpg,jpeg,png,tiff,tif,bmp,webp,gif,doc,docx,xml}"];
const defaultIgnore = [
  "**/.git/**",
  "**/.venv/**",
  "**/node_modules/**",
  "**/.DS_Store",
  "**/tools/rename-agent/**",
  "**/sorted_documents/**",
  "**/dokumenty_posortowane/**",
];

const CATEGORIES = [
  "real_estate",
  "telecom",
  "business_plans",
  "business_registration",
  "reports",
  "confirmations",
  "bank_statements",
  "surveys",
  "invoices",
  "contracts",
  "applications_and_decisions",
  "powers_of_attorney",
  "certificates",
  "taxes_and_social",
  "identity_documents",
  "photos_of_people",
  "scans_and_photos",
  "other",
];

function parseArgs(argv) {
  const baseConfig = parseBaseArgs(argv);
  const args = {
    targetDir: baseConfig.targetDir || process.env.TARGET_DIR || process.cwd(),
    outDirName: "sorted_documents",
    dryRun: true,
    limit: 0,
    smart: false,
    include: baseConfig.include,
    provider: baseConfig.provider,
    model: baseConfig.model,
    ollamaBaseUrl: baseConfig.ollamaBaseUrl,
    lang: baseConfig.lang,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target-dir") args.targetDir = argv[i + 1];
    if (token === "--out-dir") args.outDirName = argv[i + 1];
    if (token === "--apply") args.dryRun = false;
    if (token === "--dry-run") args.dryRun = true;
    if (token === "--limit") args.limit = Number(argv[i + 1] || 0);
    if (token === "--smart") args.smart = true;
  }

  return args;
}

function detectCategory(relativePath) {
  const rel = relativePath.toLowerCase();
  const base = path.basename(rel);

  const byKeywords = [
    {
      category: "real_estate",
      keys: [
        "real_estate",
        "property",
        "mortgage",
        "lease",
        "rental",
        "nieruchom",
        "ksiega_wieczyst",
        "wieczyst",
        "mieszkan",
        "lokal",
        "najem",
        "akt_notarial",
      ],
    },
    {
      category: "telecom",
      keys: [
        "telecom",
        "internet",
        "mobile",
        "subscription",
        "upc",
        "play_telewizja",
        "play_internet",
      ],
    },
    {
      category: "business_plans",
      keys: [
        "business_plan",
        "businessplan",
        "biznesplan",
        "plan_biznes",
        "plan_dzialalnosci",
      ],
    },
    {
      category: "business_registration",
      keys: [
        "registration",
        "ceidg",
        "jdg",
        "wpis",
        "rejestracj",
        "dzialalnosci_gospodarczej",
      ],
    },
    {
      category: "reports",
      keys: ["report", "raport", "sprawozdanie"],
    },
    {
      category: "confirmations",
      keys: [
        "confirmation",
        "receipt",
        "potwierdzenie",
        "potwierdzenie_oplaty",
        "potwierdzenie_wysylki",
      ],
    },
    {
      category: "bank_statements",
      keys: [
        "bank_statement",
        "wyciag",
        "bank",
        "pko",
        "historia_rachunku",
        "platnosc",
        "trans_details",
      ],
    },
    { category: "surveys", keys: ["survey", "ankieta"] },
    { category: "invoices", keys: ["invoice", "faktura", "factur", "bill"] },
    {
      category: "contracts",
      keys: ["contract", "agreement", "umowa", "aneks"],
    },
    {
      category: "applications_and_decisions",
      keys: [
        "application",
        "decision",
        "permit",
        "residence",
        "wniosek",
        "decyzja",
        "zezwolenie",
        "wezwanie",
        "pobyt",
        "cudzoziemca",
      ],
    },
    {
      category: "powers_of_attorney",
      keys: ["power_of_attorney", "pelnomocnictwo", "pelnomoc", "upl"],
    },
    {
      category: "certificates",
      keys: ["certificate", "zaswiadczenie", "oswiadczenie", "zgoda", "rodo"],
    },
    {
      category: "taxes_and_social",
      keys: [
        "tax",
        "pit",
        "vat",
        "jpk",
        "jinp",
        "deklaracja",
        "zaliczka",
        "ewidencja",
        "zus",
        "dra",
        "upo",
        "upp",
        "zcna",
        "zza",
      ],
    },
    {
      category: "identity_documents",
      keys: [
        "passport",
        "paszport",
        "paspport",
        "id_card",
        "dowod",
        "karta",
        "wiza",
        "visa",
        "pesel",
      ],
    },
    {
      category: "scans_and_photos",
      keys: ["scan", "skan", "zdjecie", "img_", "photo", "camphoto"],
    },
  ];

  for (const rule of byKeywords) {
    if (rule.keys.some((key) => rel.includes(key) || base.includes(key))) {
      return rule.category;
    }
  }

  return "other";
}

function buildClassifySystemPrompt() {
  return [
    "You are a document classifier. Choose exactly ONE category from the list.",
    `Categories: ${CATEGORIES.join(", ")}`,
    "",
    "Rules:",
    "- photos_of_people: photos of people (selfies, portraits, group photos) that are NOT document scans",
    "- scans_and_photos: scanned documents, photos of documents, unreadable scans",
    "- identity_documents: passports, IDs, visas, PESEL",
    "- invoices: invoices, bills",
    "- contracts: contracts, agreements",
    "- bank_statements: bank statements, payment history",
    "- taxes_and_social: PIT, VAT, ZUS, tax declarations",
    "- applications_and_decisions: applications, decisions, permits, residence permits",
    "- other: if nothing else fits",
    "",
    "Reply with ONLY the category name, nothing else.",
  ].join("\n");
}

const MIME_MAP = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".bmp": "image/bmp",
};

async function detectCategorySmart({ llm, visionLlm, absPath, relativePath }) {
  const ext = path.extname(absPath).toLowerCase();
  const isImage = IMAGE_EXTS.has(ext);
  const systemPrompt = buildClassifySystemPrompt();

  let res;

  if (isImage && visionLlm) {
    // Для выяў — адпраўляем саму выяву ў vision-мадэль
    const imageData = await fs.readFile(absPath);
    const base64 = imageData.toString("base64");
    const mimeType = MIME_MAP[ext] || "image/jpeg";

    const message = new HumanMessage({
      content: [
        { type: "text", text: `${systemPrompt}\n\nFile: ${relativePath}` },
        {
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${base64}` },
        },
      ],
    });
    res = await visionLlm.invoke([message]);
  } else {
    // Для дакументаў — тэкставы аналіз
    const content = await extractContent(absPath);
    const prompt = [
      systemPrompt,
      "",
      `File: ${relativePath}`,
      "Content (possibly partial):",
      content && content.trim().length > 0
        ? content.slice(0, 4000)
        : "[NO_TEXT_EXTRACTED — likely a photo or unreadable scan]",
    ].join("\n");
    res = await llm.invoke(prompt);
  }
  // res.content можа быць радком або масівам аб'ектаў з .text (OpenAI reasoning models)
  const resBody = res?.content;
  let rawResponse;
  if (typeof resBody === "string") {
    rawResponse = resBody;
  } else if (Array.isArray(resBody)) {
    rawResponse = resBody
      .map((p) => (typeof p === "string" ? p : p?.text || ""))
      .join(" ");
  } else {
    rawResponse = String(resBody ?? "");
  }
  rawResponse = rawResponse.trim().toLowerCase();

  // Шукаем назву катэгорыі ў адказе LLM
  for (const cat of CATEGORIES) {
    if (rawResponse.includes(cat)) return cat;
  }
  // Фолбэк: прыбіраем усё акрамя літар і _
  const cleaned = rawResponse.replace(/[^a-z_]/g, "");
  return CATEGORIES.includes(cleaned) ? cleaned : "other";
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function withSuffix(fileName, n) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  return `${base}__${n}${ext}`;
}

async function resolveUniqueDestination(
  absDestination,
  reservedDestinations = new Set(),
) {
  if (
    !reservedDestinations.has(absDestination) &&
    !(await exists(absDestination))
  )
    return absDestination;

  const dir = path.dirname(absDestination);
  const fileName = path.basename(absDestination);
  let index = 2;
  while (true) {
    const next = path.join(dir, withSuffix(fileName, index));
    if (!reservedDestinations.has(next) && !(await exists(next))) return next;
    index += 1;
  }
}

function toCsv(rows) {
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  return [
    "from,to,category,action",
    ...rows.map((r) => [r.from, r.to, r.category, r.action].map(esc).join(",")),
  ].join("\n");
}

async function cleanupLegacyOutputs(outputsDir) {
  const entries = await fs.readdir(outputsDir, { withFileTypes: true });
  const legacy = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^organize-plan-.*\.(json|csv)$/i.test(name));

  await Promise.all(
    legacy.map((name) => fs.rm(path.join(outputsDir, name), { force: true })),
  );
}

async function cleanupTechnicalTempDirs(projectDir) {
  const names = ["tmp-apply-test", "tmp-person-test"];
  await Promise.all(
    names.map((name) =>
      fs.rm(path.join(projectDir, name), { recursive: true, force: true }),
    ),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetDir = path.resolve(args.targetDir);
  const outRootAbs = path.join(targetDir, args.outDirName);

  const all = await fg(args.include || include, {
    cwd: targetDir,
    ignore: defaultIgnore,
    onlyFiles: true,
    absolute: true,
    unique: true,
  });

  const files = all
    .map((absPath) => ({ absPath, relPath: path.relative(targetDir, absPath) }))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));

  const selected = args.limit > 0 ? files.slice(0, args.limit) : files;
  const outputsDir = path.join(path.resolve(process.cwd()), "outputs");
  await fs.mkdir(outputsDir, { recursive: true });
  await cleanupLegacyOutputs(outputsDir);
  await cleanupTechnicalTempDirs(path.resolve(process.cwd()));

  let llm = null;
  let visionLlm = null;
  if (args.smart) {
    llm = buildChatModel(args);
    // Vision-мадэль для аналізу выяў (GPT-4o ці Gemini)
    const visionModel = process.env.VISION_MODEL || "gpt-4o";
    try {
      visionLlm = buildChatModel({ ...args, model: visionModel });
      console.log(`Smart mode: text=${args.model}, vision=${visionModel}`);
    } catch {
      console.log(
        `Smart mode: text=${args.model}, vision=disabled (no key for ${visionModel})`,
      );
    }
  }

  const operations = [];
  const reservedDestinations = new Set();

  for (const item of selected) {
    let category;
    if (args.smart) {
      try {
        category = await detectCategorySmart({
          llm,
          visionLlm,
          absPath: item.absPath,
          relativePath: item.relPath,
        });
        console.log(`Classified: ${item.relPath} -> ${category}`);
      } catch (err) {
        console.error(
          `Smart classify failed for ${item.relPath}: ${err.message}`,
        );
        category = detectCategory(item.relPath);
      }
    } else {
      category = detectCategory(item.relPath);
    }
    const destDirAbs = path.join(outRootAbs, category);
    const desiredAbs = path.join(destDirAbs, path.basename(item.absPath));
    const finalAbs = await resolveUniqueDestination(
      desiredAbs,
      reservedDestinations,
    );
    reservedDestinations.add(finalAbs);

    const toRel = path.relative(targetDir, finalAbs);
    const samePath = path.resolve(item.absPath) === path.resolve(finalAbs);

    operations.push({
      from: item.relPath,
      to: toRel,
      category,
      action: samePath ? "skip" : "move",
      fromAbs: item.absPath,
      toAbs: finalAbs,
    });
  }

  const toMove = operations.filter((o) => o.action === "move");

  if (!args.dryRun) {
    for (const op of toMove) {
      await fs.mkdir(path.dirname(op.toAbs), { recursive: true });
      await fs.rename(op.fromAbs, op.toAbs);
    }
  }

  const jsonPath = path.join(outputsDir, "organize-plan.json");
  const csvPath = path.join(outputsDir, "organize-plan.csv");

  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      {
        targetDir,
        outDir: path.relative(targetDir, outRootAbs),
        dryRun: args.dryRun,
        totalScanned: files.length,
        totalSelected: selected.length,
        totalMove: toMove.length,
        operations: operations.map(({ fromAbs, toAbs, ...rest }) => rest),
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    csvPath,
    toCsv(operations.map(({ fromAbs, toAbs, ...rest }) => rest)),
    "utf8",
  );

  console.log(`Scanned: ${files.length}`);
  console.log(`Selected: ${selected.length}`);
  console.log(`Move operations: ${toMove.length}`);
  console.log(`Mode: ${args.dryRun ? "dry-run" : "apply"}`);
  console.log(`Out root: ${outRootAbs}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV: ${csvPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
