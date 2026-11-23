import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

type Section = Record<string, string>;

function parseEditorConfig(source: string): { root: boolean; sections: Map<string, Section> } {
  const sections = new Map<string, Section>();
  let current: Section | undefined;
  let root = false;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    const glob = header?.[1];
    if (glob !== undefined) {
      current = {};
      sections.set(glob, current);
      continue;
    }
    const pair = /^([^=]+?)\s*=\s*(.+)$/.exec(line);
    const rawKey = pair?.[1];
    const rawValue = pair?.[2];
    if (rawKey === undefined || rawValue === undefined) throw new Error(`Malformed .editorconfig line: ${line}`);
    const key = rawKey.toLowerCase();
    const value = rawValue.toLowerCase();
    if (current) current[key] = value;
    else if (key === "root") root = value === "true";
  }
  return { root, sections };
}

describe(".editorconfig", () => {
  it("declares the repository-wide text rules and a root file", async () => {
    const { root, sections } = parseEditorConfig(await readFile("../.editorconfig", "utf8"));
    expect(root).toBe(true);
    expect(sections.get("*")).toMatchObject({
      charset: "utf-8",
      end_of_line: "lf",
      insert_final_newline: "true",
      trim_trailing_whitespace: "true",
      indent_style: "space",
      indent_size: "2",
    });
  });

  it("keeps applied migration bytes untouched on editor save", async () => {
    const { sections } = parseEditorConfig(await readFile("../.editorconfig", "utf8"));
    expect(sections.get("esure-backend/migrations/*.sql")).toEqual({
      insert_final_newline: "false",
      trim_trailing_whitespace: "false",
    });
  });
});
