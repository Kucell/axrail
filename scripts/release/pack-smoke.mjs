import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const packageNames = ["approval","artifacts","events","policy","tools","validation","changesets","agent","mcp","model-openai-compatible","cli","transactions","adapter-sdk","hmi-adapter-kit","harness"];
const work = await mkdtemp(join(tmpdir(), "axrail-pack-smoke-"));
const retainedTarballDir = process.env.AXRAIL_ARTIFACT_DIR
  ? resolve(root, process.env.AXRAIL_ARTIFACT_DIR)
  : undefined;
const tarballs = retainedTarballDir ?? join(work, "tarballs");
const consumer = join(work, "consumer");

if (retainedTarballDir) {
  await rm(retainedTarballDir, { recursive: true, force: true });
}
await mkdir(tarballs, { recursive: true });
await mkdir(consumer, { recursive: true });

try {
  for (const name of packageNames) {
    execFileSync("pnpm", ["pack", "--pack-destination", tarballs], {
      cwd: join(root, "packages", name),
      stdio: "inherit",
    });
  }

  const archives = (await readdir(tarballs))
    .filter((name) => name.endsWith(".tgz"))
    .sort()
    .map((name) => join(tarballs, name));

  if (archives.length !== packageNames.length) {
    throw new Error(`Expected ${packageNames.length} package tarballs, found ${archives.length}`);
  }

  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ name: "axrail-release-smoke-consumer", private: true, type: "module" }, null, 2) + "\n",
  );

  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...archives], {
    cwd: consumer,
    stdio: "inherit",
  });

  const imports = packageNames.map((name) => `@axrail/${name}`);
  const smokeSource = `const packages = ${JSON.stringify(imports)};\nfor (const name of packages) {\n  const value = await import(name);\n  if (!value || typeof value !== "object") throw new Error(\`Package import failed: \${name}\`);\n  console.log(\`import ok: \${name}\`);\n}\n`;
  await writeFile(join(consumer, "smoke.mjs"), smokeSource);
  execFileSync(process.execPath, ["smoke.mjs"], { cwd: consumer, stdio: "inherit" });

  const cliBin = process.platform === "win32"
    ? join(consumer, "node_modules", ".bin", "axrail.cmd")
    : join(consumer, "node_modules", ".bin", "axrail");
  execFileSync(cliBin, ["--version"], { cwd: consumer, stdio: "inherit" });

  console.log(`Axrail package smoke passed for ${packageNames.length} packages.`);
  if (retainedTarballDir) {
    console.log(`Retained package tarballs at ${retainedTarballDir}`);
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
