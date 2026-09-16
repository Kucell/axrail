import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const packageNames = ["approval","artifacts","events","policy","tools","validation","changesets","agent","mcp","model-openai-compatible","cli","transactions","adapter-sdk","hmi-adapter-kit","harness"];
const packageImports = packageNames.map((name) => `@axrail/${name}`);
const advancedImports = [
  "@axrail/adapter-sdk/host",
  "@axrail/adapter-sdk/registry",
  "@axrail/adapter-sdk/context-registry",
];
const publicImports = [...packageImports, ...advancedImports];
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
  await auditDependencyClosure();

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

  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...archives,
      "typescript@^5.7.3",
      "@types/node@^22.10.0",
    ],
    {
      cwd: consumer,
      stdio: "inherit",
    },
  );

  const smokeSource = `const packages = ${JSON.stringify(publicImports)};\nfor (const name of packages) {\n  const value = await import(name);\n  if (!value || typeof value !== "object") throw new Error(\`Package import failed: \${name}\`);\n  console.log(\`import ok: \${name}\`);\n}\n`;
  await writeFile(join(consumer, "smoke.mjs"), smokeSource);
  execFileSync(process.execPath, ["smoke.mjs"], { cwd: consumer, stdio: "inherit" });

  await writeTypeConsumer(publicImports);
  const consumerTsc = join(consumer, "node_modules", "typescript", "bin", "tsc");
  execFileSync(process.execPath, [consumerTsc, "-p", "tsconfig.json"], {
    cwd: consumer,
    stdio: "inherit",
  });

  const cliBin = process.platform === "win32"
    ? join(consumer, "node_modules", ".bin", "axrail.cmd")
    : join(consumer, "node_modules", ".bin", "axrail");
  execFileSync(cliBin, ["--version"], { cwd: consumer, stdio: "inherit" });

  console.log(`Axrail package smoke passed for ${packageNames.length} packages and ${advancedImports.length} advanced subpaths, including TypeScript declarations and dependency closure.`);
  if (retainedTarballDir) {
    console.log(`Retained package tarballs at ${retainedTarballDir}`);
  }
} finally {
  await rm(work, { recursive: true, force: true });
}

async function writeTypeConsumer(imports) {
  const lines = imports.map(
    (specifier, index) => `type Package${index} = typeof import(${JSON.stringify(specifier)});`,
  );
  lines.push(
    "export type AxrailPublicPackageSmoke = [" +
      imports.map((_, index) => `Package${index}`).join(", ") +
      "];",
  );
  await writeFile(join(consumer, "type-smoke.ts"), `${lines.join("\n")}\n`);
  await writeFile(
    join(consumer, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          types: ["node"],
        },
        include: ["type-smoke.ts"],
      },
      null,
      2,
    ) + "\n",
  );
}

async function auditDependencyClosure() {
  const failures = [];

  for (const name of packageNames) {
    const packageDir = join(root, "packages", name);
    const manifest = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]);
    const files = await walk(join(packageDir, "dist"));
    const referenced = new Set();

    for (const path of files) {
      if (!path.endsWith(".js") && !path.endsWith(".d.ts")) continue;
      const source = await readFile(path, "utf8");
      for (const specifier of moduleSpecifiers(source)) {
        const dependency = packageNameFromSpecifier(specifier);
        if (!dependency || dependency === manifest.name) continue;
        referenced.add(dependency);
      }
    }

    for (const dependency of referenced) {
      if (!declared.has(dependency)) {
        failures.push(`${manifest.name} emits a reference to undeclared dependency ${dependency}`);
      }
    }
  }

  if (failures.length) {
    throw new Error(`Package dependency closure failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }

  console.log("Package dependency closure audit passed.");
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function moduleSpecifiers(source) {
  const values = new Set();
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s+["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) values.add(match[1]);
  }
  return values;
}

function packageNameFromSpecifier(specifier) {
  if (
    !specifier ||
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:")
  ) {
    return undefined;
  }
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}
