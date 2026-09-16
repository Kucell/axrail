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
  harness: { description: "Primary embeddable governed execution Harness for Axrail.", deps: { "@axrail/adapter-sdk": "workspace:*", "@axrail/agent": "workspace:*", "@axrail/approval": "workspace:*", "@axrail/events": "workspace:*", "@axrail/policy": "workspace:*", "@axrail/tools": "workspace:*", "@axrail/transactions": "workspace:*" } }
};

const references = {
  approval: [], artifacts: [], events: [], policy: [], tools: [], validation: [],
  changesets: ["artifacts"], agent: ["tools"], mcp: ["tools"],
  "model-openai-compatible": ["agent"], cli: ["changesets", "events"],
  transactions: ["approval", "artifacts", "changesets", "policy", "validation"],
  "adapter-sdk": ["approval", "artifacts", "policy", "tools", "transactions", "validation"],
  "hmi-adapter-kit": ["adapter-sdk", "artifacts", "tools"],
  harness: ["adapter-sdk", "agent", "approval", "events", "policy", "tools", "transactions"]
};

const sourcePaths = Object.fromEntries([
  ...Object.keys(packages).map((name) => [`@axrail/${name}`, [`packages/${name}/src/index.ts`]]),
  ["@axrail/core", ["packages/core/src/index.ts"]]
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
  await writeJson(`packages/${name}/package.json`, {
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
  });

  await writeJson(`packages/${name}/tsconfig.build.json`, {
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
  });
}

const ignore = await readFile(join(root, ".gitignore"), "utf8");
if (!ignore.includes(".tsbuild/")) {
  await writeText(".gitignore", `${ignore.trimEnd()}\n.tsbuild/\n`);
}

async function writeJson(path, value) {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path, content) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}
