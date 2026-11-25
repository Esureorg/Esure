/**
 * Serializers and artifact writers extracted from cli.ts (issues #3, #4).
 *
 * Responsibilities:
 *  - escapeXml: XML special-character escaping used in JUnit output.
 *  - generateJunitXml: produce a JUnit XML string from run results.
 *  - writeArtifactFile: atomic, overwrite-guarded file write for reports
 *    and JUnit files. Writes to a sibling temp file then renames, so a
 *    partial write never leaves a corrupt artifact.
 */

import { rename, writeFile, access } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import type { LedgerExecution } from "@esure/backend/src/domain.js";

// ─────────────────────────────────────────────────────────────────────────────
// XML escaping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escape the five XML special characters so the value is safe to embed in
 * an attribute or text node.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─────────────────────────────────────────────────────────────────────────────
// JUnit XML generation
// ─────────────────────────────────────────────────────────────────────────────

export interface JunitRunInput {
  scenarioId: string;
  /** Populated when the scenario executed (even if it failed). */
  execution?: {
    scenarioId: string;
    scenarioVersion: number;
    steps: LedgerExecution["steps"];
    assertions: LedgerExecution["assertions"];
  };
  /** Populated when execution did not start at all (gateway/validation error). */
  error?: { message: string };
}

/**
 * Generate a JUnit XML document from one or more run results.
 *
 * Each scenario maps to one `<testsuite>`. Each step and assertion maps to
 * one `<testcase>`. An execution-level error (no steps/assertions available)
 * produces a single `<testcase name="execution">` with an `<error>` child.
 *
 * Byte-level escaping is applied to all user-visible strings via `escapeXml`.
 */
export function generateJunitXml(runs: JunitRunInput[]): string {
  let totalTests = 0;
  let totalFailures = 0;
  let totalErrors = 0;
  const suites: string[] = [];

  for (const run of runs) {
    if (run.execution) {
      const { steps, assertions } = run.execution;
      const cases: string[] = [];
      let suiteFailures = 0;

      for (const step of steps) {
        const name = escapeXml(`step ${step.id}: ${step.message}`);
        if (step.status === "failed") {
          suiteFailures += 1;
          const msg = escapeXml(step.message);
          cases.push(
            `    <testcase classname="${escapeXml(run.scenarioId)}" name="${name}" time="0">\n` +
            `      <failure message="${msg}" type="${escapeXml(step.type)}">${msg}</failure>\n` +
            `    </testcase>`,
          );
        } else {
          cases.push(
            `    <testcase classname="${escapeXml(run.scenarioId)}" name="${name}" time="0"/>`,
          );
        }
      }

      for (const assertion of assertions) {
        const name = escapeXml(`assertion ${assertion.type}: ${assertion.message}`);
        if (assertion.status === "failed") {
          suiteFailures += 1;
          const msg = escapeXml(assertion.message);
          cases.push(
            `    <testcase classname="${escapeXml(run.scenarioId)}" name="${name}" time="0">\n` +
            `      <failure message="${msg}" type="${escapeXml(assertion.type)}">${msg}</failure>\n` +
            `    </testcase>`,
          );
        } else {
          cases.push(
            `    <testcase classname="${escapeXml(run.scenarioId)}" name="${name}" time="0"/>`,
          );
        }
      }

      const suiteTests = steps.length + assertions.length;
      totalTests += suiteTests;
      totalFailures += suiteFailures;
      suites.push(
        `  <testsuite name="${escapeXml(run.scenarioId)}" tests="${suiteTests}" failures="${suiteFailures}" errors="0">\n` +
        cases.join("\n") + (cases.length ? "\n" : "") +
        `  </testsuite>`,
      );
    } else {
      // Execution-level error: one synthetic test case with <error>.
      const msg = escapeXml(run.error?.message ?? "Unknown error");
      totalTests += 1;
      totalErrors += 1;
      suites.push(
        `  <testsuite name="${escapeXml(run.scenarioId)}" tests="1" failures="0" errors="1">\n` +
        `    <testcase classname="${escapeXml(run.scenarioId)}" name="execution" time="0">\n` +
        `      <error message="${msg}" type="ExecutionError">${msg}</error>\n` +
        `    </testcase>\n` +
        `  </testsuite>`,
      );
    }
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuites name="esure" tests="${totalTests}" failures="${totalFailures}" errors="${totalErrors}">\n` +
    suites.join("\n") + (suites.length ? "\n" : "") +
    `</testsuites>\n`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Atomic artifact file writer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write `content` to `filePath` atomically.
 *
 * Uses a sibling temp file (`.basename.tmp`) and a rename so a partial write
 * never leaves a corrupt artifact. Rejects if the file already exists and
 * `overwrite` is false. The `label` is used only in human-readable error
 * messages (e.g. "report" or "JUnit").
 */
export async function writeArtifactFile(
  filePath: string,
  content: string,
  overwrite: boolean,
  label: string,
): Promise<void> {
  if (!overwrite) {
    const exists = await access(filePath).then(() => true, () => false);
    if (exists) {
      throw new Error(
        `${label.charAt(0).toUpperCase() + label.slice(1)} file "${filePath}" already exists. Use --overwrite to replace it.`,
      );
    }
  }

  const dir = dirname(filePath);
  const tmp = join(dir, `.${basename(filePath)}.tmp`);
  try {
    await writeFile(tmp, content, { encoding: "utf-8" });
    await rename(tmp, filePath);
  } catch (err) {
    // Clean up the temp file if the rename failed.
    await access(tmp).then(() => writeFile(tmp, "").catch(() => {}), () => {});
    throw err;
  }
}
