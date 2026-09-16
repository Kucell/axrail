#!/usr/bin/env node

import { runCli } from "./cli.js";

const exitCode = await runCli(process.argv.slice(2), {
  writeStdout(text) {
    process.stdout.write(text);
  },
  writeStderr(text) {
    process.stderr.write(text);
  },
});

process.exitCode = exitCode;
