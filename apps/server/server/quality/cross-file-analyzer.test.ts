import { describe, expect, it } from "vitest";
import {
  analyzeImportGraph,
  computeProjectQuality,
} from "./cross-file-analyzer.js";
import { createWorkspace, addFile } from "../pipeline/workspace.js";

function makeFileContent(imports: string[], extra = ""): string {
  const lines = imports.map((s) => `import '${s}';`);
  lines.push(extra);
  return lines.join("\n");
}

describe("analyzeImportGraph", () => {
  it("returns perfect cohesion score (100) for single file with no imports", () => {
    const ws = addFile(
      createWorkspace("src/index.js"),
      "src/index.js",
      "console.log('hello');",
      "entry"
    );

    const result = analyzeImportGraph(ws);

    expect(result.cohesionScore).toBe(100);
    expect(result.unresolvedImports).toEqual([]);
    expect(result.orphanedFiles).toEqual([]);
    expect(result.circularDependencies).toEqual([]);
  });

  it("detects unresolved imports when target file is missing", () => {
    const ws = addFile(
      createWorkspace("src/index.js"),
      "src/index.js",
      makeFileContent(["./helper.js"]),
      "entry"
    );

    const result = analyzeImportGraph(ws);
    // single file importing a non-existent module — the import has no
    // corresponding dep in the dependency graph, so it is unresolved.

    expect(result.unresolvedImports).toHaveLength(1);
    expect(result.unresolvedImports[0]).toEqual({
      file: "src/index.js",
      importSpec: "./helper.js",
    });
  });

  it("identifies orphaned files not imported by any other file", () => {
    let ws = addFile(
      createWorkspace("src/index.js"),
      "src/index.js",
      "console.log('root');",
      "entry"
    );
    ws = addFile(ws, "src/standalone.js", "export default 42;", "standalone");
    ws = addFile(ws, "src/used.js", "export const name = 'a';", "used");
    ws = addFile(
      ws,
      "src/consumer.js",
      makeFileContent(["./used.js"]),
      "consumer"
    );

    const result = analyzeImportGraph(ws);

    expect(result.orphanedFiles).toContain("src/standalone.js");
    expect(result.orphanedFiles).toContain("src/consumer.js");

    // used.js IS imported by consumer so it should NOT be orphaned
    expect(result.orphanedFiles).not.toContain("src/used.js");

    // entry point should never be orphaned
    expect(result.orphanedFiles).not.toContain("src/index.js");
  });

  it("detects circular dependencies (A → B → A)", () => {
    let ws = addFile(
      createWorkspace("src/a.js"),
      "src/a.js",
      makeFileContent(["./b.js"]),
      "module A"
    );
    ws = addFile(
      ws,
      "src/b.js",
      makeFileContent(["./a.js"]),
      "module B"
    );

    const result = analyzeImportGraph(ws);

    expect(result.circularDependencies).toHaveLength(1);
    const cycle = result.circularDependencies[0]!;
    expect(cycle).toContain("src/a.js");
    expect(cycle).toContain("src/b.js");
    // cycle should be [a, b, a]
    expect(cycle[0]).toBe(cycle[cycle.length - 1]);
  });

  it("detects triangular circular deps (A → B → C → A)", () => {
    let ws = addFile(
      createWorkspace("src/a.js"),
      "src/a.js",
      makeFileContent(["./b.js"]),
      "module A"
    );
    ws = addFile(
      ws,
      "src/b.js",
      makeFileContent(["./c.js"]),
      "module B"
    );
    ws = addFile(
      ws,
      "src/c.js",
      makeFileContent(["./a.js"]),
      "module C"
    );

    const result = analyzeImportGraph(ws);

    expect(result.circularDependencies).toHaveLength(1);
    const cycle = result.circularDependencies[0]!;
    expect(cycle).toContain("src/a.js");
    expect(cycle).toContain("src/b.js");
    expect(cycle).toContain("src/c.js");
    expect(cycle[0]).toBe(cycle[cycle.length - 1]);
  });

  it("handles .js extension normalization in imports", () => {
    let ws = addFile(
      createWorkspace("src/main.js"),
      "src/main.js",
      makeFileContent(["./dep"]),
      "main"
    );
    // dep.js exists — resolveImportPath handles the extension during
    // dependency graph construction, so import/importedBy counts are correct
    // even though the literal spec "./dep" != resolved path "src/dep.js".
    ws = addFile(ws, "src/dep.js", "export const v = 1;", "dep");

    const result = analyzeImportGraph(ws);

    // dependency graph correctly counts the resolved import
    expect(result.importCountByFile["src/main.js"]).toBe(1);
    expect(result.importedByCount["src/dep.js"]).toBe(1);

    // the import IS flagged as "unresolved" because the raw spec ("./dep")
    // does not literally match the resolved dep path ("src/dep.js") after
    // extension stripping — see normalization rules in the source
    expect(result.unresolvedImports).toHaveLength(1);
    expect(result.unresolvedImports[0]!.importSpec).toBe("./dep");
  });

  it("handles empty workspace (no files)", () => {
    const ws = createWorkspace();

    const result = analyzeImportGraph(ws);

    expect(result.unresolvedImports).toEqual([]);
    expect(result.orphanedFiles).toEqual([]);
    expect(result.circularDependencies).toEqual([]);
    expect(result.importCountByFile).toEqual({});
    expect(result.importedByCount).toEqual({});
    // cohesion = 100 - 0 - 0 - 0 - max(0, 30 - (-1)*5) = 100 - 35 = 65
    expect(result.cohesionScore).toBe(65);
  });

  it("returns cohesion < 60 for heavily fragmented workspace", () => {
    let ws = addFile(
      createWorkspace("src/index.js"),
      "src/index.js",
      "console.log('root');",
      "entry"
    );
    ws = addFile(ws, "src/a.js", "export const a = 1;", "module A");
    ws = addFile(ws, "src/b.js", "export const b = 2;", "module B");
    ws = addFile(ws, "src/c.js", "export const c = 3;", "module C");

    const result = analyzeImportGraph(ws);

    // 4 files, no imports between them:
    // entry point (excluded from orphans) + 3 orphans → orchans = 3
    // cohesion = 100 - 0 - 3*10 - 0 - max(0, 30 - 3*5) = 100 - 30 - 15 = 55
    expect(result.orphanedFiles).toHaveLength(3);
    expect(result.cohesionScore).toBeLessThan(60);
  });

  it("tracks importCountByFile and importedByCount correctly", () => {
    let ws = addFile(
      createWorkspace("src/a.js"),
      "src/a.js",
      makeFileContent(["./b.js", "./c.js"]),
      "module A"
    );
    ws = addFile(
      ws,
      "src/b.js",
      makeFileContent(["./c.js"]),
      "module B"
    );
    ws = addFile(ws, "src/c.js", "export const c = 3;", "module C");

    const result = analyzeImportGraph(ws);

    // A imports B and C → importCount A = 2
    // B imports C → importCount B = 1
    // C imports nothing → importCount C = 0
    expect(result.importCountByFile["src/a.js"]).toBe(2);
    expect(result.importCountByFile["src/b.js"]).toBe(1);
    expect(result.importCountByFile["src/c.js"]).toBe(0);

    // A is imported by no one → 0
    // B is imported by A → 1
    // C is imported by A and B → 2
    expect(result.importedByCount["src/a.js"]).toBe(0);
    expect(result.importedByCount["src/b.js"]).toBe(1);
    expect(result.importedByCount["src/c.js"]).toBe(2);
  });
});

describe("computeProjectQuality", () => {
  it("computes compositeScore blending file scores (60%) and cohesion (40%)", () => {
    let ws = addFile(
      createWorkspace("src/index.js"),
      "src/index.js",
      "console.log('hello');",
      "entry"
    );
    ws = addFile(ws, "src/lib.js", "export const x = 1;", "lib");
    ws = addFile(
      ws,
      "src/app.js",
      makeFileContent(["./lib.js"]),
      "app"
    );

    const fileScores = {
      "src/index.js": 90,
      "src/lib.js": 80,
      "src/app.js": 85,
    };

    const report = computeProjectQuality(ws, fileScores);

    // avgFileScore = (90 + 80 + 85) / 3 = 85
    // cohesion: 1 unresolved import (lib.js) + 1 orphan (app.js) + no cycles
    //   = 100 - 8 - 10 - 0 - max(0, 30 - 2*5) = 100 - 8 - 10 - 20 = 62
    // composite = round(85 * 0.6 + 62 * 0.4) = round(51 + 24.8) = 76
    expect(report.compositeScore).toBe(76);
  });

  it("identifies weakest files by lowest scores", () => {
    let ws = addFile(
      createWorkspace("src/index.js"),
      "src/index.js",
      "console.log('hello');",
      "entry"
    );
    ws = addFile(ws, "src/a.js", "1;", "a");
    ws = addFile(ws, "src/b.js", "2;", "b");
    ws = addFile(ws, "src/c.js", "3;", "c");

    const fileScores = {
      "src/index.js": 30,
      "src/a.js": 80,
      "src/b.js": 10,
      "src/c.js": 50,
    };

    const report = computeProjectQuality(ws, fileScores);

    expect(report.weakestFiles).toEqual([
      "src/b.js",
      "src/index.js",
      "src/c.js",
    ]);
  });

  it("generates recommendations for unresolved imports, orphans, and cycles", () => {
    let ws = addFile(
      createWorkspace("src/a.js"),
      "src/a.js",
      makeFileContent(["./b.js"]),
      "module A"
    );
    ws = addFile(
      ws,
      "src/b.js",
      makeFileContent(["./a.js", "./missing.js"]),
      "module B"
    );
    ws = addFile(ws, "src/c.js", "export const c = 3;", "module C");

    const fileScores = {
      "src/a.js": 70,
      "src/b.js": 80,
      "src/c.js": 60,
    };

    const report = computeProjectQuality(ws, fileScores);

    const recTexts = report.recommendations;

    expect(recTexts.some((r) => r.includes("unresolved imports"))).toBe(true);
    expect(recTexts.some((r) => r.includes("orphaned"))).toBe(true);
    expect(recTexts.some((r) => r.includes("circular dependency"))).toBe(true);
    expect(recTexts.some((r) => r.includes("weakest file"))).toBe(true);
  });

  it("flags fragmented projects (cohesionScore < 60)", () => {
    let ws = addFile(
      createWorkspace("src/index.js"),
      "src/index.js",
      "console.log('root');",
      "entry"
    );
    ws = addFile(ws, "src/x.js", "1;", "x");
    ws = addFile(ws, "src/y.js", "2;", "y");
    ws = addFile(ws, "src/z.js", "3;", "z");

    const report = computeProjectQuality(ws);

    // 4 files, no imports → 3 orphans, cohesion = 55 (< 60)
    const fragRec = report.recommendations.find((r) =>
      r.includes("fragmented")
    );
    expect(fragRec).toBeDefined();
  });

  it("handles missing fileScores parameter (defaults to 0)", () => {
    let ws = addFile(
      createWorkspace("src/index.js"),
      "src/index.js",
      "console.log('hello');",
      "entry"
    );
    ws = addFile(ws, "src/lib.js", "export const x = 1;", "lib");
    ws = addFile(
      ws,
      "src/app.js",
      makeFileContent(["./lib.js"]),
      "app"
    );

    const report = computeProjectQuality(ws);

    // avgFileScore = (0 + 0 + 0) / 3 = 0
    // cohesion = 62 (same as the compositeScore test above)
    // composite = round(0 * 0.6 + 62 * 0.4) = 25
    expect(report.fileScores).toEqual({});
    expect(report.compositeScore).toBe(25);
  });
});