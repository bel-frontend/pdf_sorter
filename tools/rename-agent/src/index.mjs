import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "./config.mjs";
import { collectFiles } from "./files.mjs";
import { extractContent } from "./extractors.mjs";
import { buildChatModel } from "./llm.mjs";
import { suggestName } from "./naming-agent.mjs";
import { applyRenameRow, resolveRenameTarget } from "./rename.mjs";
import { appendIgnoreEntries, readIgnoreList } from "./ignore-list.mjs";

function makeCatalogAutoSection({ generatedAt, files }) {
  const lines = [
    "## 🔄 Актуальны спіс файлаў (аўта)",
    "",
    `Абноўлена: ${generatedAt}`,
    `Колькасць файлаў: ${files.length}`,
    "",
  ];

  const sorted = [...files].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath),
  );
  for (const file of sorted) {
    const encoded = file.relativePath
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    lines.push(`- [${file.relativePath}](${encoded})`);
  }
  lines.push("");
  return lines.join("\n");
}

async function upsertCatalogSection({ targetDir, files }) {
  const catalogPath = path.join(targetDir, "КАТАЛОГ_ДАКУМЕНТАЎ.md");
  const startMarker = "<!-- AUTO_FILE_INDEX:START -->";
  const endMarker = "<!-- AUTO_FILE_INDEX:END -->";
  const sectionBody = makeCatalogAutoSection({
    generatedAt: new Date().toISOString(),
    files,
  });
  const block = `${startMarker}\n${sectionBody}\n${endMarker}\n`;

  let current = "";
  try {
    current = await fs.readFile(catalogPath, "utf8");
  } catch {
    current = "# Каталог дакументаў\n\n";
  }

  if (current.includes(startMarker) && current.includes(endMarker)) {
    const pattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}\\n?`, "m");
    current = current.replace(pattern, block);
  } else {
    if (!current.endsWith("\n")) current += "\n";
    current += `\n---\n\n${block}`;
  }

  await fs.writeFile(catalogPath, current, "utf8");
  return catalogPath;
}

async function cleanupLegacyOutputs(outDir) {
  const entries = await fs.readdir(outDir, { withFileTypes: true });
  const legacy = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => {
      return (
        /^pending-files-.*\.txt$/i.test(name) ||
        /^rename-plan-.*\.json$/i.test(name) ||
        /^rename-plan-.*\.csv$/i.test(name) ||
        /^files-map-.*\.md$/i.test(name) ||
        /^files-map\.md$/i.test(name)
      );
    });

  await Promise.all(
    legacy.map((name) => fs.rm(path.join(outDir, name), { force: true })),
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
  const config = parseArgs(process.argv.slice(2));
  const llm = buildChatModel(config);

  const rulesPath = path.join(process.cwd(), "rules.prompt.txt");
  let rules = "";
  try {
    rules = await fs.readFile(rulesPath, "utf8");
  } catch {
    rules = [
      "Use Belarusian-friendly transliterated concise names.",
      "Pattern: <type>_<topic>_<date-if-known>",
      "Keep extension unchanged.",
      "Do not include random ids unless they are official document numbers.",
    ].join("\n");
  }

  const ignoredPaths = await readIgnoreList(config.ignoreListPath);
  const files = await collectFiles({ ...config, ignoredPaths });
  if (files.length === 0) {
    console.log(
      "No files found by include patterns (after ignore list filtering).",
    );
    return;
  }

  const outDir = path.join(process.cwd(), "outputs");
  await fs.mkdir(outDir, { recursive: true });
  await cleanupLegacyOutputs(outDir);
  await cleanupTechnicalTempDirs(process.cwd());

  const pendingPath = path.join(outDir, "pending-files.txt");
  await fs.writeFile(
    pendingPath,
    files.map((f) => f.relativePath).join("\n"),
    "utf8",
  );

  console.log(
    `Ignore list: ${config.ignoreListPath} (${ignoredPaths.size} entries)`,
  );
  console.log(
    `Found ${files.length} pending files. Provider=${config.provider}, model=${config.model}.`,
  );
  console.log(`Pending list saved: ${pendingPath}`);

  const usedTargets = new Set();
  const rows = [];
  const failures = [];

  for (const file of files) {
    try {
      const content = await extractContent(file.absolutePath);
      const suggestion = await suggestName({
        llm,
        file,
        content,
        rules,
        lang: config.lang,
      });
      const target = await resolveRenameTarget({
        targetDir: config.targetDir,
        relativePath: file.relativePath,
        proposedFileName: suggestion.proposedFileName,
        usedTargets,
      });

      const row = {
        ...target,
        summary: suggestion.summary,
        type: suggestion.type,
        confidence: suggestion.confidence,
        date: suggestion.date || "",
      };
      rows.push(row);

      console.log(`Analyzed: ${file.relativePath} -> ${target.to}`);

      if (!config.dryRun) {
        await applyRenameRow({ targetDir: config.targetDir, row });

        if (config.updateIgnoreList) {
          const processedPath = row.changed ? row.to : row.from;
          await appendIgnoreEntries(config.ignoreListPath, [processedPath]);
        }
      }
    } catch (error) {
      const message = String(error?.message || error);
      failures.push({
        file: file.relativePath,
        error: message,
      });
      console.error(`Failed: ${file.relativePath} -> ${message}`);
    }
  }

  const planPath = path.join(outDir, "rename-plan.json");
  await fs.writeFile(
    planPath,
    JSON.stringify(
      { config, pendingCount: files.length, rows, failures },
      null,
      2,
    ),
    "utf8",
  );

  const csvLines = [
    "from,to,changed,type,date,confidence,summary",
    ...rows.map((r) => {
      const esc = (v) => `\"${String(v ?? "").replaceAll('"', '""')}\"`;
      return [r.from, r.to, r.changed, r.type, r.date, r.confidence, r.summary]
        .map(esc)
        .join(",");
    }),
  ];
  const csvPath = path.join(outDir, "rename-plan.csv");
  await fs.writeFile(csvPath, csvLines.join("\n"), "utf8");

  const changed = rows.filter((x) => x.changed).length;
  console.log(`Plan saved: ${planPath}`);
  console.log(`CSV saved: ${csvPath}`);
  console.log(`Would rename: ${changed}/${rows.length}`);
  console.log(`Failures: ${failures.length}`);

  const allFiles = await collectFiles({
    ...config,
    ignoredPaths: new Set(),
    limit: 0,
  });
  const catalogPath = await upsertCatalogSection({
    targetDir: config.targetDir,
    files: allFiles,
  });
  console.log(`Catalog updated: ${catalogPath}`);

  if (config.dryRun) {
    console.log("Dry run mode. No files renamed and ignore list unchanged.");
  } else {
    console.log("Sequential rename apply completed.");
    if (config.updateIgnoreList) {
      console.log("Ignore list was updated per file during processing.");
    } else {
      console.log("Ignore list update disabled by config.");
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
