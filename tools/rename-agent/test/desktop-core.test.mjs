import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { expandInputPaths } from "../src/desktop/input-files.mjs";
import {
  applyOperations,
  buildEffectiveOperations,
  formatName,
  moveFile,
  reserveUniquePath,
  validateOperations,
} from "../src/desktop/plan.mjs";
import {
  readLastOperation,
  undoLastOperation,
  writeLastOperation,
} from "../src/desktop/history.mjs";

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "file-garden-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("expands folders recursively, filters formats, and removes duplicates", async (t) => {
  const root = await temporaryDirectory(t);
  await fs.mkdir(path.join(root, "nested"));
  await fs.writeFile(path.join(root, "invoice.pdf"), "pdf");
  await fs.writeFile(path.join(root, "nested", "photo.JPG"), "image");
  await fs.writeFile(path.join(root, "notes.txt"), "ignored");

  const result = await expandInputPaths([root, path.join(root, "invoice.pdf")]);
  assert.deepEqual(
    result.files.map((item) => path.relative(root, item)),
    ["invoice.pdf", path.join("nested", "photo.JPG")],
  );
  assert.equal(result.rejected.length, 0);
});

test("formats structured names and removes empty placeholders", () => {
  assert.equal(
    formatName("{category}_{topic}_{person}_{date}", {
      category: "Bank statement",
      topic: "Main account",
      person: "",
      date: "2026-10",
    }),
    "bank_statement_main_account_2026_10",
  );
});

test("reserves unique names without overwriting existing files", async (t) => {
  const root = await temporaryDirectory(t);
  const desired = path.join(root, "invoice.pdf");
  await fs.writeFile(desired, "existing");
  const reserved = new Set();
  assert.equal(await reserveUniquePath(desired, reserved), path.join(root, "invoice__2.pdf"));
  assert.equal(await reserveUniquePath(desired, reserved), path.join(root, "invoice__3.pdf"));
});

test("validates edited plans and rejects changed extensions", async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, "scan.pdf");
  await fs.writeFile(source, "data");
  const stored = {
    mode: "rename",
    rows: [{ id: "row-1", sourcePath: source }],
  };
  const built = buildEffectiveOperations(stored, [
    { id: "row-1", selected: true, proposedName: "scan.jpg" },
  ]);
  const validation = await validateOperations(built.operations, built.errors);
  assert.equal(validation.valid, false);
  assert.match(validation.errors[0].message, /пашырэнне/);
});

test("rejects duplicate targets created by manual edits", async (t) => {
  const root = await temporaryDirectory(t);
  const first = path.join(root, "first.pdf");
  const second = path.join(root, "second.pdf");
  await fs.writeFile(first, "one");
  await fs.writeFile(second, "two");
  const stored = {
    mode: "rename",
    rows: [
      { id: "first", sourcePath: first },
      { id: "second", sourcePath: second },
    ],
  };
  const built = buildEffectiveOperations(stored, [
    { id: "first", selected: true, proposedName: "same.pdf" },
    { id: "second", selected: true, proposedName: "same.pdf" },
  ]);
  const validation = await validateOperations(built.operations, built.errors);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.filter((item) => /ужо выбраны/.test(item.message)).length, 2);
});

test("uses copy and unlink when rename reports EXDEV", async (t) => {
  const root = await temporaryDirectory(t);
  const from = path.join(root, "from.pdf");
  const to = path.join(root, "to", "to.pdf");
  await fs.writeFile(from, "payload");
  const fsApi = {
    mkdir: fs.mkdir,
    copyFile: fs.copyFile,
    unlink: fs.unlink,
    rename: async () => {
      const error = new Error("cross-device");
      error.code = "EXDEV";
      throw error;
    },
  };
  assert.equal(await moveFile(from, to, fsApi), "copy");
  assert.equal(await fs.readFile(to, "utf8"), "payload");
  await assert.rejects(fs.access(from));
});

test("applies a batch and undoes the last successful operation", async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, "old.pdf");
  const target = path.join(root, "sorted", "new.pdf");
  const history = path.join(root, "state", "last-operation.json");
  await fs.writeFile(source, "payload");

  const applied = await applyOperations([{ id: "one", from: source, to: target }]);
  assert.equal(applied.completed.length, 1);
  await writeLastOperation(history, { operations: applied.completed });
  assert.equal((await readLastOperation(history)).operations.length, 1);

  const undone = await undoLastOperation(history);
  assert.equal(undone.failures.length, 0);
  assert.equal(await fs.readFile(source, "utf8"), "payload");
  assert.equal(await readLastOperation(history), null);
});

test("undo stops before changing anything when an original path is occupied", async (t) => {
  const root = await temporaryDirectory(t);
  const original = path.join(root, "original.pdf");
  const moved = path.join(root, "moved.pdf");
  const history = path.join(root, "last-operation.json");
  await fs.writeFile(moved, "moved payload");
  await fs.writeFile(original, "new conflicting file");
  await writeLastOperation(history, {
    operations: [{ id: "one", from: original, to: moved }],
  });

  const result = await undoLastOperation(history);
  assert.match(result.error, /шлях заняты/);
  assert.equal(await fs.readFile(moved, "utf8"), "moved payload");
});
