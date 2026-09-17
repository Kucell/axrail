import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 8)) {
  console.error(
    `Axrail coverage thresholds require Node >=22.8; current runtime is ${process.version}. ` +
      "Use pnpm test for the Node 20 compatibility suite.",
  );
  process.exit(1);
}

const testFiles = readdirSync("tests")
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => join("tests", name));

if (testFiles.length === 0) {
  console.error("No test files were found under tests/*.test.ts");
  process.exit(1);
}

const args = [
  "--import=tsx",
  "--test",
  "--experimental-test-coverage",
  "--test-coverage-include=packages/*/src/**/*.ts",
  // bin.ts is a side-effect process bootstrap. CLI behavior is covered through
  // the importable runCli surface in packages/cli/src/index.ts.
  "--test-coverage-exclude=packages/cli/src/bin.ts",
  "--test-coverage-lines=95",
  "--test-coverage-functions=95",
  "--test-coverage-branches=95",
  ...testFiles,
];

const result = spawnSync(process.execPath, args, {
  encoding: "utf8",
  env: process.env,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
