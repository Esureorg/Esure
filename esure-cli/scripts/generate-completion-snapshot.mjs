#!/usr/bin/env node
/**
 * Generates the completion snapshot files for regression testing.
 * Run from the esure-cli directory after a build:
 *   node scripts/generate-completion-snapshot.mjs
 *
 * Writes snapshots/completions-<shell>.txt for each supported shell.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distCli = new URL("../dist/cli.js", import.meta.url);

const { generateCompletions, SUPPORTED_SHELLS } = await import(distCli.href);

const snapshotDir = join(here, "..", "snapshots");
await mkdir(snapshotDir, { recursive: true });

for (const shell of SUPPORTED_SHELLS) {
  const script = generateCompletions(shell);
  const file = join(snapshotDir, `completions-${shell}.txt`);
  await writeFile(file, script, "utf-8");
  console.log(`wrote ${file} (${script.length} bytes)`);
}

console.log("done.");
