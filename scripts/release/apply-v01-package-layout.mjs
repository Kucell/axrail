import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = process.cwd();
const version = "0.1.0-rc.1";

const packages = {
  approval: { description: "Approval contracts and evidence-bound approval runtime for Axrail.", deps: {} },
  artifacts: { description: "Portable engineering artifact contracts and provider registry for Axrail.", deps: {} },
  events: { description: "EventStore, session lifecycle, replay, and audit primitives for Axrail.", deps: {} },
  policy: { description: "Policy contracts and deny-overrides policy engine for Axrail.", deps: {} },
  tools: { description: "Governed Tool contracts, registry, invocation evidence, and runtime for Axrail.", deps: {} },
  validation: { description: "Composable validation contracts and pipeline for Axrail.", deps: {} },
  changesets: { description: "Serializable engineering ChangeSet contracts and evidence helpers for Axrail.", deps: { "@axrail/artifacts": "workspace:*" } },
  agent: { description: "Model-agnostic in-process Agent loop for Axrail.", deps: { "@axrail/tools": "workspace:*" } },
  mcp: { description: "Governed MCP client and Tool bridge integration for Axrail.", deps: { "@axrail/tools": "workspace:*", "@modelcontextprotocol/client": "^2.0.0" } },
  "model-openai-compatible": { description: "OpenAI-compatible Responses API model provider for Axrail.", deps: { "@axrail/agent": "workspace:*" } },
  cli: { description: "Read-only diagnostics and evidence CLI for Axrail.", deps: { "@axrail/changesets": "workspace:*", "@axrail/events": "workspace:*" }, bin: { axrail: "./dist/bin.js" } },
  transactions: { description: "Governed engineering transaction runtime for Axrail.", deps: { "@axrail/approval": "workspace:*", "@axrail/artifacts": "workspace:*", "@axrail/changesets": "workspace:*", "@axrail/policy": "workspace:*", "@axrail/validation": "workspace:*" } },
  "adapter-sdk": { description: "Vendor-neutral engineering-system Adapter SDK for Axrail.", deps: { "@axrail/approval": "workspace:*", "@axrail/artifacts": "workspace:*", "@axrail/policy": "workspace:*", "@axrail/tools": "workspace:*", "@axrail/transactions": "workspace:*", "@axrail/validation": "workspace:*" } },
  "hmi-adapter-kit": { description: "Vendor-neutral HMI domain Adapter kit for Axrail.", deps: { "@axrail/adapter-sdk": "workspace:*", "@axrail/artifacts": "workspace:*", "@axrail/tools": "workspace:*" } },
  harness: { description: "Primary embeddable governed execution Harness for Axrail.", deps: { "@axrail/adapter-sdk": "workspace:*", "@axrail/agent": "workspace:*", "@axrail/approval": "workspace:*", "@axrail/events": "workspace:*", "@axrail/policy": "workspace:*", "@axrail/tools": "workspace:*", "@axrail/transactions": "workspace:*" } },
};

const references = {
  approval: [], artifacts: [], events: [], policy: [], tools: [], validation: [],
  changesets: ["artifacts"],
  agent: ["tools"],
  mcp: ["tools"],
  "model-openai-compatible": ["agent"],
  cli: ["changesets", "events"],
  transactions: ["approval", "artifacts", "changesets", "policy", "validation"],
  "adapter-sdk": ["approval", "artifacts", "policy", "tools", "transactions", "validation"],
  "hmi-adapter-kit": ["adapter-sdk", "artifacts", "tools"],
  harness: ["adapter-sdk", "agent", "approval", "events", "policy", "tools", "transactions"],
};

const sourcePaths = Object.fromEntries([
  ...Object.keys(packages).map((name) => [`@axrail/${name}`, [`packages/${name}/src/index.ts`]]),
  ["@axrail/core", ["packages/core/src/index.ts"]],
]);

await writeJson("package.json", {
  name: "axrail",
  private: true,
  version,
  description: "Transactional AI execution for industrial and engineering software.",
  license: "Apache-2.0",
  packageManager: "pnpm@10.6.5",
  engines: { node: ">=20" },
  scripts: {
    axrail: "tsx packages/cli/src/bin.ts",
    check: "tsc --noEmit",
    build: "tsc -b tsconfig.build.json",
    clean: "tsc -b tsconfig.build.json --clean",
    "test:unit": "tsx --test tests/*.test.ts",
    test: "pnpm build && pnpm test:unit",
    "pack:smoke": "node scripts/release/pack-smoke.mjs",
    "release:dry-run": "pnpm check && pnpm test && pnpm pack:smoke"
  },
  devDependencies: {
    "@types/node": "^22.10.0",
    tsx: "^4.19.2",
    typescript: "^5.7.3"
  }
});

await writeJson("tsconfig.json", {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    skipLibCheck: true,
    baseUrl: ".",
    paths: sourcePaths
  },
  include: ["packages/*/src/**/*.ts", "examples/*/src/**/*.ts"]
});

await writeJson("tsconfig.build.base.json", {
  extends: "./tsconfig.json",
  compilerOptions: {
    composite: true,
    declaration: true,
    declarationMap: true,
    sourceMap: true,
    noEmitOnError: true
  }
});

await writeJson("tsconfig.build.json", {
  files: [],
  references: Object.keys(packages).map((name) => ({ path: `./packages/${name}/tsconfig.build.json` }))
});

for (const [name, config] of Object.entries(packages)) {
  const manifest = {
    name: `@axrail/${name}`,
    version,
    description: config.description,
    license: "Apache-2.0",
    type: "module",
    engines: { node: ">=20" },
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    files: ["dist"],
    publishConfig: { access: "public" },
    repository: {
      type: "git",
      url: "git+https://github.com/Kucell/axrail.git",
      directory: `packages/${name}`
    },
    scripts: {
      build: "tsc -b tsconfig.build.json",
      clean: "tsc -b tsconfig.build.json --clean"
    },
    ...(config.bin ? { bin: config.bin } : {}),
    ...(Object.keys(config.deps).length ? { dependencies: config.deps } : {})
  };
  await writeJson(`packages/${name}/package.json`, manifest);

  const buildConfig = {
    extends: "../../tsconfig.build.base.json",
    compilerOptions: {
      rootDir: "./src",
      outDir: "./dist",
      tsBuildInfoFile: `../../.tsbuild/${name}.tsbuildinfo`
    },
    include: ["src/**/*.ts"],
    ...(references[name].length
      ? { references: references[name].map((dep) => ({ path: `../${dep}/tsconfig.build.json` })) }
      : {})
  };
  await writeJson(`packages/${name}/tsconfig.build.json`, buildConfig);
}

await writeText("scripts/release/pack-smoke.mjs", `import { execFileSync } from "node:child_process";\nimport { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";\nimport { tmpdir } from "node:os";\nimport { join } from "node:path";\nimport { fileURLToPath } from "node:url";\n\nconst root = fileURLToPath(new URL("../../", import.meta.url));\nconst packageNames = ${JSON.stringify(Object.keys(packages))};\nconst work = await mkdtemp(join(tmpdir(), "axrail-pack-smoke-"));\nconst tarballs = join(work, "tarballs");\nconst consumer = join(work, "consumer");\nawait mkdir(tarballs, { recursive: true });\nawait mkdir(consumer, { recursive: true });\n\ntry {\n  for (const name of packageNames) {\n    execFileSync("pnpm", ["pack", "--pack-destination", tarballs], { cwd: join(root, "packages", name), stdio: "inherit" });\n  }\n  const archives = (await readdir(tarballs)).filter((name) => name.endsWith(".tgz")).sort().map((name) => join(tarballs, name));\n  if (archives.length !== packageNames.length) throw new Error(\`Expected \${packageNames.length} package tarballs, found \${archives.length}\`);\n  await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "axrail-release-smoke-consumer", private: true, type: "module" }, null, 2) + "\\n");\n  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...archives], { cwd: consumer, stdio: "inherit" });\n  const imports = packageNames.map((name) => \`@axrail/\${name}\`);\n  await writeFile(join(consumer, "smoke.mjs"), \`const packages = \${JSON.stringify(imports)};\\nfor (const name of packages) { const value = await import(name); if (!value || typeof value !== "object") throw new Error(\\\`Package import failed: \\${name}\\\`); console.log(\\\`import ok: \\${name}\\\`); }\\n\`);\n  execFileSync(process.execPath, ["smoke.mjs"], { cwd: consumer, stdio: "inherit" });\n  const cliBin = process.platform === "win32" ? join(consumer, "node_modules", ".bin", "axrail.cmd") : join(consumer, "node_modules", ".bin", "axrail");\n  execFileSync(cliBin, ["--version"], { cwd: consumer, stdio: "inherit" });\n  console.log(\`Axrail package smoke passed for \${packageNames.length} packages.\`);\n} finally {\n  if (process.env.AXRAIL_KEEP_SMOKE !== "1") await rm(work, { recursive: true, force: true });\n  else console.log(\`Kept smoke workspace at \${work}\`);\n}\n`);

await writeText(".github/workflows/ci.yml", `name: CI\n\non:\n  push:\n  pull_request:\n\njobs:\n  verify:\n    name: verify-node-\${{ matrix.node }}\n    runs-on: ubuntu-latest\n    strategy:\n      fail-fast: false\n      matrix:\n        node: [20, 22, 24]\n    steps:\n      - uses: actions/checkout@v4\n      - uses: pnpm/action-setup@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: \${{ matrix.node }}\n          cache: pnpm\n      - run: pnpm install --frozen-lockfile\n      - run: pnpm check\n      - run: pnpm test\n      - run: pnpm pack:smoke\n`);

const ignore = await readFile(join(root, ".gitignore"), "utf8");
if (!ignore.includes(".tsbuild/")) await writeText(".gitignore", `${ignore.trimEnd()}\n.tsbuild/\n`);

async function writeJson(path, value) {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path, content) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}
