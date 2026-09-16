#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { runCli } from "./cli.js";

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as { version?: string };

const exitCode = await runCli(process.argv.slice(2), {
  writeStdout(text) {
    process.stdout.write(text);
  },
  writeStderr(text) {
    process.stderr.write(text);
  },
}, {
  version: manifest.version,
});

process.exitCode = exitCode;
