import fs from "node:fs/promises";
import path from "node:path";

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function withIndex(fileName, index) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  return `${base}__${index}${ext}`;
}

export async function resolveRenameTarget({
  targetDir,
  relativePath,
  proposedFileName,
  usedTargets = new Set(),
}) {
  const dir = path.dirname(relativePath);
  let candidateRel = path.join(dir, proposedFileName);
  let candidateAbs = path.join(targetDir, candidateRel);

  let idx = 1;
  while (
    usedTargets.has(candidateRel.toLowerCase()) ||
    (candidateRel.toLowerCase() !== relativePath.toLowerCase() && (await exists(candidateAbs)))
  ) {
    idx += 1;
    candidateRel = path.join(dir, withIndex(proposedFileName, idx));
    candidateAbs = path.join(targetDir, candidateRel);
  }

  usedTargets.add(candidateRel.toLowerCase());

  return {
    from: relativePath,
    to: candidateRel,
    changed: relativePath !== candidateRel,
  };
}

export async function applyRenameRow({ targetDir, row }) {
  if (!row.changed) return;
  const fromAbs = path.join(targetDir, row.from);
  const toAbs = path.join(targetDir, row.to);
  await fs.rename(fromAbs, toAbs);
}

export async function buildRenamePlan({ targetDir, items }) {
  const used = new Set();
  const plan = [];

  for (const item of items) {
    const target = await resolveRenameTarget({
      targetDir,
      relativePath: item.relativePath,
      proposedFileName: item.proposedFileName,
      usedTargets: used,
    });

    plan.push({
      ...target,
      summary: item.summary,
      type: item.type,
      confidence: item.confidence,
      date: item.date || "",
    });
  }

  return plan;
}

export async function applyRenamePlan({ targetDir, plan }) {
  for (const row of plan) {
    await applyRenameRow({ targetDir, row });
  }
}
