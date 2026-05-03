import { describe, expect, it, vi, beforeEach } from "vitest";
import { PatchGenerator } from "../quality/patcher.js";
import type { GeneratedPatch, PatchGoal, AgentMemory } from "../quality/patcher.js";
import { createWorkspace, addFile, getFile, listFiles } from "./workspace.js";
import { MultiFilePatchGenerator, applyMultiFilePatches } from "./multi-file-patcher.js";
import type { MultiFilePatch } from "./multi-file-patcher.js";

function patch(
  overrides: Partial<MultiFilePatch> & { filePath: string; kind: MultiFilePatch["kind"] }
): MultiFilePatch {
  return {
    explanation: "test",
    expectedScoreImpact: 1,
    riskLevel: 0.1,
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────
//  applyMultiFilePatches (pure function)
// ────────────────────────────────────────────────────────────

describe("applyMultiFilePatches", () => {
  it("modify: updates an existing file's content", () => {
    let ws = createWorkspace("index.js");
    ws = addFile(ws, "index.js", "export const x = 1;", "Entry point", "threejs");

    const result = applyMultiFilePatches(ws, [
      patch({ filePath: "index.js", kind: "modify", patchedCode: "export const x = 2;" }),
    ]);

    expect(getFile(result, "index.js")?.content).toBe("export const x = 2;");
  });

  it("modify: silently ignores non-existent file paths", () => {
    const ws = createWorkspace();

    expect(() =>
      applyMultiFilePatches(ws, [
        patch({ filePath: "nowhere.js", kind: "modify", patchedCode: "code" }),
      ])
    ).not.toThrow();

    const result = applyMultiFilePatches(ws, [
      patch({ filePath: "nowhere.js", kind: "modify", patchedCode: "code" }),
    ]);
    expect(listFiles(result)).toHaveLength(0);
  });

  it("add: inserts a new file with purpose and skill", () => {
    const ws = createWorkspace("index.js");

    const result = applyMultiFilePatches(ws, [
      patch({
        filePath: "ui.js",
        kind: "add",
        patchedCode: "export const ui = true;",
        purpose: "UI components",
        skill: "threejs",
      }),
    ]);

    const entry = getFile(result, "ui.js");
    expect(entry).toBeDefined();
    expect(entry?.content).toBe("export const ui = true;");
    expect(entry?.purpose).toBe("UI components");
    expect(entry?.skill).toBe("threejs");
  });

  it("add: silently ignores empty file additions", () => {
    const ws = createWorkspace();

    expect(() =>
      applyMultiFilePatches(ws, [
        patch({ filePath: "empty.js", kind: "add", patchedCode: "" }),
      ])
    ).not.toThrow();

    const result = applyMultiFilePatches(ws, [
      patch({ filePath: "empty.js", kind: "add", patchedCode: "" }),
    ]);
    expect(getFile(result, "empty.js")).toBeUndefined();
    expect(listFiles(result)).toHaveLength(0);
  });

  it("remove: deletes a non-entry-point file", () => {
    let ws = createWorkspace("index.js");
    ws = addFile(ws, "index.js", "import './helpers.js';", "Entry", "threejs");
    ws = addFile(ws, "helpers.js", "export const h = 1;", "Helpers", "threejs");

    const result = applyMultiFilePatches(ws, [
      patch({ filePath: "helpers.js", kind: "remove" }),
    ]);

    expect(getFile(result, "helpers.js")).toBeUndefined();
    expect(getFile(result, "index.js")).toBeDefined();
    expect(listFiles(result)).toHaveLength(1);
  });

  it("remove: silently ignores removing non-existent file", () => {
    const ws = createWorkspace();

    expect(() =>
      applyMultiFilePatches(ws, [
        patch({ filePath: "ghost.js", kind: "remove" }),
      ])
    ).not.toThrow();
  });

  it("remove: silently ignores attempt to remove entry point", () => {
    let ws = createWorkspace("index.js");
    ws = addFile(ws, "index.js", "export const x = 1;", "Entry", "threejs");

    expect(() =>
      applyMultiFilePatches(ws, [
        patch({ filePath: "index.js", kind: "remove" }),
      ])
    ).not.toThrow();

    const result = applyMultiFilePatches(ws, [
      patch({ filePath: "index.js", kind: "remove" }),
    ]);
    expect(getFile(result, "index.js")).toBeDefined();
  });

  it("rename: renames a file and rewrites imports in all referencing files", () => {
    let ws = createWorkspace("index.js");
    ws = addFile(ws, "index.js", `import { fn } from './utils.js';\nimport { other } from './other.js';\nfn();`, "Entry", "threejs");
    ws = addFile(ws, "other.js", `import { fn } from './utils.js';\nexport const other = fn;`, "Other", "threejs");
    ws = addFile(ws, "utils.js", "export const fn = () => 1;", "Utilities", "threejs");

    const result = applyMultiFilePatches(ws, [
      patch({
        filePath: "utils.js",
        kind: "rename",
        newPath: "helpers.js",
        patchedCode: "export const fn = () => 42;",
      }),
    ]);

    expect(getFile(result, "utils.js")).toBeUndefined();
    expect(getFile(result, "helpers.js")).toBeDefined();
    expect(getFile(result, "helpers.js")?.content).toBe("export const fn = () => 42;");

    const indexContent = getFile(result, "index.js")?.content ?? "";
    expect(indexContent).toContain("from './helpers'");
    expect(indexContent).not.toContain("'./utils'");

    const otherContent = getFile(result, "other.js")?.content ?? "";
    expect(otherContent).toContain("from './helpers'");
    expect(otherContent).not.toContain("'./utils'");
  });

  it("rename: preserves content when patchedCode is not provided", () => {
    let ws = createWorkspace("index.js");
    ws = addFile(ws, "index.js", `import { fn } from './utils.js';`, "Entry", "threejs");
    ws = addFile(ws, "utils.js", "export const fn = () => 1;", "Utilities", "threejs");

    const result = applyMultiFilePatches(ws, [
      patch({
        filePath: "utils.js",
        kind: "rename",
        newPath: "helpers.js",
      }),
    ]);

    expect(getFile(result, "helpers.js")?.content).toBe("export const fn = () => 1;");
  });

  it("rename: silently ignores rename when file doesn't exist", () => {
    const ws = createWorkspace();

    expect(() =>
      applyMultiFilePatches(ws, [
        patch({ filePath: "ghost.js", kind: "rename", newPath: "alive.js" }),
      ])
    ).not.toThrow();

    const result = applyMultiFilePatches(ws, [
      patch({ filePath: "ghost.js", kind: "rename", newPath: "alive.js" }),
    ]);
    expect(getFile(result, "alive.js")).toBeUndefined();
  });

  it("processes multiple kinds of patches in a single call", () => {
    let ws = createWorkspace("index.js");
    ws = addFile(ws, "index.js", `import { x } from './lib.js';`, "Entry", "threejs");
    ws = addFile(ws, "lib.js", "export const x = 1;\nexport const stale = 2;", "Library", "threejs");
    ws = addFile(ws, "dead.js", "export const gone = 0;", "Dead code", "threejs");

    const result = applyMultiFilePatches(ws, [
      patch({ filePath: "index.js", kind: "modify", patchedCode: `import { x } from './core.js';` }),
      patch({ filePath: "new.js", kind: "add", patchedCode: "export const fresh = 99;", purpose: "New module", skill: "threejs" }),
      patch({ filePath: "dead.js", kind: "remove" }),
      patch({ filePath: "lib.js", kind: "rename", newPath: "core.js", patchedCode: "export const x = 99;" }),
    ]);

    expect(getFile(result, "index.js")?.content).toBe(`import { x } from './core.js';`);
    expect(getFile(result, "new.js")?.content).toBe("export const fresh = 99;");
    expect(getFile(result, "dead.js")).toBeUndefined();
    expect(getFile(result, "lib.js")).toBeUndefined();
    expect(getFile(result, "core.js")?.content).toBe("export const x = 99;");
    expect(listFiles(result)).toHaveLength(3); // index, new, core
  });

  it("does not mutate the original workspace", () => {
    let ws = createWorkspace("index.js");
    ws = addFile(ws, "index.js", "import { x } from './lib.js';", "Entry", "threejs");
    ws = addFile(ws, "lib.js", "export const x = 1;", "Library", "threejs");

    const indexBefore = getFile(ws, "index.js")?.content;
    const libBefore = getFile(ws, "lib.js")?.content;
    const fileCountBefore = listFiles(ws).length;

    applyMultiFilePatches(ws, [
      patch({ filePath: "index.js", kind: "modify", patchedCode: "import { x } from './lib.js';\n// changed" }),
      patch({ filePath: "lib.js", kind: "rename", newPath: "core.js" }),
      patch({ filePath: "extra.js", kind: "add", patchedCode: "export const e = 1;" }),
      patch({ filePath: "index.js", kind: "remove" }),
    ]);

    expect(getFile(ws, "index.js")?.content).toBe(indexBefore);
    expect(getFile(ws, "lib.js")?.content).toBe(libBefore);
    expect(getFile(ws, "core.js")).toBeUndefined();
    expect(getFile(ws, "extra.js")).toBeUndefined();
    expect(listFiles(ws)).toHaveLength(fileCountBefore);
  });
});

// ────────────────────────────────────────────────────────────
//  MultiFilePatchGenerator (mocked PatchGenerator)
// ────────────────────────────────────────────────────────────

describe("MultiFilePatchGenerator", () => {
  let mockLLM: { generate: ReturnType<typeof vi.fn> };
  let patchGen: PatchGenerator;
  let generator: MultiFilePatchGenerator;

  beforeEach(() => {
    mockLLM = { generate: vi.fn() };
    patchGen = new PatchGenerator(mockLLM);
    generator = new MultiFilePatchGenerator(patchGen);
  });

  it("generatePatches delegates to PatchGenerator.generatePatches with correct arguments", async () => {
    const generateSpy = vi.spyOn(patchGen, "generatePatches").mockResolvedValue([]);

    let ws = createWorkspace("index.js");
    ws = addFile(ws, "index.js", "import { x } from './a.js';", "Entry", "threejs");
    ws = addFile(ws, "a.js", "export const x = 1;", "Module A", "threejs");

    const goal: PatchGoal = { category: "performance", issue: "slow", suggestion: "optimize" };
    const mem: AgentMemory = { previousAttempts: [{ successful: true, description: "test" }] };
    const ctx = { currentScore: 70, skill: "threejs" };

    await generator.generatePatches(ws, [goal], mem, ctx);

    expect(generateSpy).toHaveBeenCalledTimes(1);
    expect(generateSpy).toHaveBeenCalledWith(
      "import { x } from './a.js';",
      expect.objectContaining({ entryPoint: "index.js" }),
      expect.arrayContaining([
        expect.objectContaining({ category: "performance", affectedFile: "index.js" }),
      ]),
      mem,
      ctx
    );
  });

  it("maps PatchGenerator's GeneratedPatch[] to MultiFilePatch[] with proper kind/properties", async () => {
    const generated: GeneratedPatch = {
      filePath: "index.js",
      originalCode: "const a = 1;",
      patchedCode: "const a = 2;",
      explanation: "Doubled the value",
      expectedScoreImpact: 10,
      riskLevel: 0.3,
    };
    vi.spyOn(patchGen, "generatePatches").mockResolvedValue([generated]);

    let ws = createWorkspace("index.js");
    ws = addFile(ws, "index.js", "const a = 1;", "Entry", "threejs");

    const result = await generator.generatePatches(ws, [{ category: "bug", issue: "wrong value" }]);

    expect(result.patches).toHaveLength(1);
    expect(result.patches[0]).toEqual({
      filePath: "index.js",
      kind: "modify",
      originalCode: "const a = 1;",
      patchedCode: "const a = 2;",
      explanation: "Doubled the value",
      expectedScoreImpact: 10,
      riskLevel: 0.3,
    });
  });

  it("maps multiple GeneratedPatches to MultiFilePatches preserving order", async () => {
    const patches: GeneratedPatch[] = [
      { filePath: "a.js", originalCode: "1", patchedCode: "2", explanation: "A", expectedScoreImpact: 1, riskLevel: 0 },
      { filePath: "b.js", originalCode: "3", patchedCode: "4", explanation: "B", expectedScoreImpact: 2, riskLevel: 0 },
    ];
    vi.spyOn(patchGen, "generatePatches").mockResolvedValue(patches);

    let ws = createWorkspace("index.js");
    ws = addFile(ws, "index.js", "code", "Entry", "threejs");

    const result = await generator.generatePatches(ws, [{ category: "test" }]);

    expect(result.patches).toHaveLength(2);
    expect(result.patches[0]!.filePath).toBe("a.js");
    expect(result.patches[1]!.filePath).toBe("b.js");
  });

  it("returns a workspace with patches already applied in the result", async () => {
    const generated: GeneratedPatch = {
      filePath: "index.js",
      originalCode: "const old = 1;",
      patchedCode: "const updated = 42;",
      explanation: "Updated",
      expectedScoreImpact: 5,
      riskLevel: 0.2,
    };
    vi.spyOn(patchGen, "generatePatches").mockResolvedValue([generated]);

    let ws = createWorkspace("index.js");
    ws = addFile(ws, "index.js", "const old = 1;", "Entry", "threejs");

    const result = await generator.generatePatches(ws, [{ category: "quality" }]);

    expect(getFile(result.workspace, "index.js")?.content).toBe("const updated = 42;");
    expect(result.summary).toEqual([
      expect.objectContaining({
        file: "index.js",
        change: "Updated",
        impact: expect.stringContaining("5"),
      }),
    ]);
  });

  it("passes agentMemory and context to the underlying PatchGenerator", async () => {
    const generateSpy = vi.spyOn(patchGen, "generatePatches").mockResolvedValue([]);

    let ws = createWorkspace("index.js");
    ws = addFile(ws, "index.js", "code", "Entry", "threejs");

    const mem: AgentMemory = { previousAttempts: [{ successful: false, description: "prior failure" }] };
    const ctx = { currentScore: 85, skill: "p5js" };

    await generator.generatePatches(ws, [{ category: "performance" }], mem, ctx);

    expect(generateSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.any(Array),
      mem,
      ctx
    );
  });

  it("returns empty result when no patches are generated", async () => {
    vi.spyOn(patchGen, "generatePatches").mockResolvedValue([]);

    let ws = createWorkspace("index.js");
    ws = addFile(ws, "index.js", "const x = 1;", "Entry", "threejs");

    const result = await generator.generatePatches(ws, [{ category: "style" }]);

    expect(result.patches).toEqual([]);
    expect(result.summary).toEqual([]);
    expect(getFile(result.workspace, "index.js")?.content).toBe("const x = 1;");
    expect(getFile(result.workspace, "index.js")?.content).toBe("const x = 1;");
  });

  it("summary includes risk level classification", async () => {
    const patches: GeneratedPatch[] = [
      { filePath: "low.js", originalCode: "1", patchedCode: "2", explanation: "low risk", expectedScoreImpact: 1, riskLevel: 0.1 },
      { filePath: "mid.js", originalCode: "3", patchedCode: "4", explanation: "med risk", expectedScoreImpact: 2, riskLevel: 0.5 },
      { filePath: "high.js", originalCode: "5", patchedCode: "6", explanation: "high risk", expectedScoreImpact: 3, riskLevel: 0.9 },
    ];
    vi.spyOn(patchGen, "generatePatches").mockResolvedValue(patches);

    let ws = createWorkspace("index.js");
    ws = addFile(ws, "index.js", "code", "Entry", "threejs");

    const result = await generator.generatePatches(ws, [{ category: "test" }]);

    expect(result.summary).toHaveLength(3);
    expect(result.summary[0]!.risk).toBe("LOW");
    expect(result.summary[1]!.risk).toBe("MEDIUM");
    expect(result.summary[2]!.risk).toBe("HIGH");
  });

  it("summary reflects negative score impact with minus sign", async () => {
    const generated: GeneratedPatch = {
      filePath: "index.js", originalCode: "a", patchedCode: "b",
      explanation: "downgrade", expectedScoreImpact: -4, riskLevel: 0.1,
    };
    vi.spyOn(patchGen, "generatePatches").mockResolvedValue([generated]);

    let ws = createWorkspace("index.js");
    ws = addFile(ws, "index.js", "a", "Entry", "threejs");

    const result = await generator.generatePatches(ws, [{ category: "test" }]);

    expect(result.summary[0]!.impact).toBe("-4 pts");
  });

  it("defaults affectedFile to entryPoint when goal has no affectedFile", async () => {
    const generateSpy = vi.spyOn(patchGen, "generatePatches").mockResolvedValue([]);

    let ws = createWorkspace("app/main.js");
    ws = addFile(ws, "app/main.js", "code", "Entry", "threejs");

    await generator.generatePatches(ws, [{ category: "visual", issue: "bad color" }]);

    const forwardedGoals = generateSpy.mock.calls[0]![2] as PatchGoal[];
    expect(forwardedGoals[0]!.affectedFile).toBe("app/main.js");
  });
});