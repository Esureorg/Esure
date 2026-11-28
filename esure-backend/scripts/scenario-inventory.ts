/**
 * Pure comparison logic for the bundled scenario inventory (issue #277).
 *
 * The validated scenario IDs come from ScenarioRegistry over the bundled
 * `scenarios/` directory. Documentation must list exactly those IDs in the
 * "Bundled Scenarios" table of esure-docs/SCENARIOS.md, and every document
 * that states a scenario count must state the validated count.
 */

export interface InventoryDocument {
  /** Repository-relative path, used only in finding messages. */
  readonly path: string;
  readonly markdown: string;
}

export interface InventoryCheckInput {
  readonly actualIds: readonly string[];
  /** Document whose "Bundled Scenarios" table must list every ID. */
  readonly inventory: InventoryDocument;
  /** Documents that must state the bundled scenario count. */
  readonly countDocuments: readonly InventoryDocument[];
}

export interface InventoryCheckResult {
  readonly count: number;
  readonly ids: readonly string[];
  readonly findings: readonly string[];
}

const COUNT_PATTERN = /\b(\d+)\s+bundled\s+scenarios\b/gi;
const ROW_PATTERN = /^\|\s*`([^`]+)`\s*\|/;
const SECTION_HEADING = /^##\s+bundled scenarios\s*$/i;

function byCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Returns the lines under the "Bundled Scenarios" heading, or undefined when absent. */
export function bundledSectionLines(markdown: string): string[] | undefined {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => SECTION_HEADING.test(line));
  if (start === -1) return undefined;
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    section.push(line);
  }
  return section;
}

/** IDs in the first column of the inventory table, in document order, duplicates kept. */
export function documentedScenarioIds(markdown: string): string[] | undefined {
  const section = bundledSectionLines(markdown);
  if (!section) return undefined;
  const ids: string[] = [];
  for (const line of section) {
    const match = ROW_PATTERN.exec(line);
    if (match?.[1]) ids.push(match[1]);
  }
  return ids;
}

/** Every "N bundled scenarios" count stated in the document, in order. */
export function declaredScenarioCounts(markdown: string): number[] {
  return [...markdown.matchAll(COUNT_PATTERN)].map((match) => Number(match[1]));
}

export function checkScenarioInventory(input: InventoryCheckInput): InventoryCheckResult {
  const ids = [...input.actualIds].sort(byCodeUnit);
  const count = ids.length;
  const findings: string[] = [];
  const actual = new Set(ids);

  const documented = documentedScenarioIds(input.inventory.markdown);
  if (documented === undefined) {
    findings.push(`${input.inventory.path}: no "Bundled Scenarios" section`);
  } else {
    const seen = new Set<string>();
    for (const id of [...new Set(documented)].sort(byCodeUnit)) {
      if (documented.indexOf(id) !== documented.lastIndexOf(id)) {
        findings.push(`${input.inventory.path}: ${id} is listed more than once`);
      }
      seen.add(id);
    }
    for (const id of ids) {
      if (!seen.has(id)) findings.push(`${input.inventory.path}: ${id} is missing from the table`);
    }
    for (const id of [...seen].sort(byCodeUnit)) {
      if (!actual.has(id)) findings.push(`${input.inventory.path}: ${id} is listed but has no bundled definition`);
    }
  }

  for (const document of [input.inventory, ...input.countDocuments]) {
    const declared = declaredScenarioCounts(document.markdown);
    if (declared.length === 0) {
      findings.push(`${document.path}: no "N bundled scenarios" count`);
    }
    for (const value of declared) {
      if (value !== count) {
        findings.push(`${document.path}: states ${value} bundled scenarios, found ${count}`);
      }
    }
  }

  return { count, ids, findings };
}
