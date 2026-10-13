const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);
module.exports = async (context) => {
  const appDir = context.appDir || context.packager.info.appDir;
  const version = require(
    path.join(appDir, "node_modules", "sqlite-vec", "package.json"),
  ).version;
  const platform = context.electronPlatformName;
  const arch =
    typeof context.arch === "number"
      ? ["ia32", "x64", "armv7l", "arm64", "universal"][context.arch]
      : context.arch;
  if (
    !["darwin", "linux", "win32"].includes(platform) ||
    !["arm64", "x64"].includes(arch)
  )
    throw new Error(`Unsupported vector-runtime target: ${platform}/${arch}`);
  const suffix =
    platform === "darwin" ? "dylib" : platform === "win32" ? "dll" : "so";
  const pkg = `sqlite-vec-${platform === "win32" ? "windows" : platform}-${arch}`;
  const output = path.join(appDir, ".vector-runtime", `${platform}-${arch}`);
  await fs.mkdir(output, { recursive: true });
  let source = path.join(appDir, "node_modules", pkg, `vec0.${suffix}`),
    temporary;
  try {
    try {
      await fs.access(source);
    } catch {
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), "fg-vector-build-"));
      const { stdout } = await execute(
        "npm",
        [
          "pack",
          `${pkg}@${version}`,
          "--ignore-scripts",
          "--json",
          "--pack-destination",
          temporary,
        ],
        { maxBuffer: 1024 * 1024 },
      );
      const [{ filename }] = JSON.parse(stdout);
      await execute("tar", [
        "-xzf",
        path.join(temporary, filename),
        "-C",
        temporary,
      ]);
      source = path.join(temporary, "package", `vec0.${suffix}`);
    }
    await fs.copyFile(source, path.join(output, `vec0.${suffix}`));
  } finally {
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  }
};
