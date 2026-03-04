import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

const include = ["**/*.{pdf,jpg,jpeg,png,tiff,tif,bmp,webp,gif,doc,docx,xml}"];
const defaultIgnore = [
  "**/.git/**",
  "**/.venv/**",
  "**/node_modules/**",
  "**/.DS_Store",
  "**/tools/rename-agent/**",
  "**/dokumenty_posortowane/**",
];

function parseArgs(argv) {
  const args = {
    targetDir: process.env.TARGET_DIR || process.cwd(),
    outDirName: "dokumenty_posortowane",
    dryRun: true,
    limit: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--target-dir") args.targetDir = argv[i + 1];
    if (token === "--out-dir") args.outDirName = argv[i + 1];
    if (token === "--apply") args.dryRun = false;
    if (token === "--dry-run") args.dryRun = true;
    if (token === "--limit") args.limit = Number(argv[i + 1] || 0);
  }

  return args;
}

function detectCategory(relativePath) {
  const rel = relativePath.toLowerCase();
  const base = path.basename(rel);

  const byKeywords = [
    { category: "nieruchomosc", keys: ["nieruchom", "ksiega_wieczyst", "ksiegi_wieczyst", "wieczyst", "mieszkan", "lokal", "najem", "akt_notarial", "sprzedazy_mieszkania"] },
    { category: "upc", keys: ["upc", "play_telewizja", "play_internet", "abonencka_upc", "kanalow_upc", "cennik_uslug_upc"] },
    { category: "biznesplany", keys: ["biznesplan", "businessplan", "plan_biznes", "poradnik_biznesplan", "plan_dzialalnosci"] },
    { category: "rejestracja_jdg", keys: ["ceidg", "jdg", "wpis", "rejestracj", "dzialalnosci_gospodarczej"] },
    { category: "raporty", keys: ["raport", "sprawozdanie", "opis_dzialalnosci"] },
    { category: "potwierdzenia", keys: ["wydruki_potwierdzenia", "potwierdzenie_oplaty", "potwierdzenie_wysylki", "przejazd_granica"] },
    { category: "bankowe_wyciagi", keys: ["wyciag", "bank", "pko", "historia_rachunku", "platnosc", "trans_details"] },
    { category: "ankiety", keys: ["ankieta"] },
    { category: "faktury", keys: ["faktura", "invoice", "factur"] },
    { category: "umowy", keys: ["umowa", "aneks", "contract"] },
    { category: "wnioski_i_decyzje", keys: ["wniosek", "decyzja", "zezwolenie", "proceedingsdocument", "wezwanie", "pobyt", "cudzoziemca"] },
    { category: "pelnomocnictwa", keys: ["pelnomocnictwo", "upl", "pelnomoc"] },
    { category: "zaswiadczenia", keys: ["zaswiadczenie", "oswiadczenie", "certificate", "zgoda", "rodo"] },
    { category: "podatki_i_zus", keys: ["pit", "vat", "jpk", "jinp", "deklaracja", "zaliczka", "ewidencja", "zus", "dra", "upo", "upp", "zcna", "zza"] },
    { category: "dokumenty_tozsamosci", keys: ["paszport", "paspport", "passport", "dowod", "karta", "wiza", "pesel"] },
    { category: "skany_i_zdjecia", keys: ["skan", "zdjecie", "img_", "photo", "camphoto", "scan"] },
  ];

  for (const rule of byKeywords) {
    if (rule.keys.some((key) => rel.includes(key) || base.includes(key))) {
      return rule.category;
    }
  }

  return "inne";
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

async function resolveUniqueDestination(absDestination, reservedDestinations = new Set()) {
  if (!reservedDestinations.has(absDestination) && !(await exists(absDestination))) return absDestination;

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

  await Promise.all(legacy.map((name) => fs.rm(path.join(outputsDir, name), { force: true })));
}

async function cleanupTechnicalTempDirs(projectDir) {
  const names = ["tmp-apply-test", "tmp-person-test"];
  await Promise.all(
    names.map((name) => fs.rm(path.join(projectDir, name), { recursive: true, force: true })),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetDir = path.resolve(args.targetDir);
  const outRootAbs = path.join(targetDir, args.outDirName);

  const all = await fg(include, {
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

  const operations = [];
  const reservedDestinations = new Set();

  for (const item of selected) {
    const category = detectCategory(item.relPath);
    const destDirAbs = path.join(outRootAbs, category);
    const desiredAbs = path.join(destDirAbs, path.basename(item.absPath));
    const finalAbs = await resolveUniqueDestination(desiredAbs, reservedDestinations);
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
