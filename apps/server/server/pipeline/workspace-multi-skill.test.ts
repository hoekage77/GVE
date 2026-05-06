import { describe, expect, it } from "vitest";
import {
  createWorkspace,
  addFile,
  updateFile,
  revertFile,
  toSandboxPayload,
  type Workspace,
} from "./workspace.js";
import {
  generateCompositeHTMLWrapper,
  wrapUserCodeWithImports,
} from "../sandbox/manager.js";

describe("multi-skill workspace pipeline", () => {
  it("creates a workspace with multi-skill files", () => {
    let ws = createWorkspace("src/main.js");
    ws = addFile(ws, "src/main.js", "import * as THREE from 'three';", "Three.js scene setup", "threejs");
    ws = addFile(ws, "src/overlay.js", "import * as d3 from 'd3';", "D3 overlay", ["threejs", "d3js"]);

    expect(Object.keys(ws.files)).toHaveLength(2);
    expect(ws.files["src/main.js"]!.skill).toBe("threejs");
    expect(ws.files["src/overlay.js"]!.skill).toEqual(["threejs", "d3js"]);
  });

  it("toSandboxPayload preserves multi-skill entries", () => {
    let ws = createWorkspace("src/main.js");
    ws = addFile(ws, "src/main.js", "console.log('main');", "main", "threejs");
    ws = addFile(ws, "src/overlay.js", "console.log('overlay');", "overlay", ["threejs", "d3js"]);

    const payload = toSandboxPayload(ws);
    const overlay = payload.files.find((f) => f.path === "src/overlay.js");
    expect(overlay).toBeDefined();
    expect(overlay!.skill).toEqual(["threejs", "d3js"]);
  });

  it("pushes history on update and reverts correctly", () => {
    let ws = createWorkspace("src/index.js");
    ws = addFile(ws, "src/index.js", "v1", "entry", "threejs");
    ws = updateFile(ws, "src/index.js", "v2", "patch");
    ws = updateFile(ws, "src/index.js", "v3", "patch");

    const entry = ws.files["src/index.js"]!;
    expect(entry.history).toHaveLength(2); // MAX_HISTORY is 3, only 2 updates so far
    expect(entry.content).toBe("v3");

    ws = revertFile(ws, "src/index.js", 1);
    expect(ws.files["src/index.js"]!.content).toBe("v1");
    expect(ws.files["src/index.js"]!.history).toHaveLength(3);
  });

  it("throws on revert to missing version", () => {
    let ws = createWorkspace("src/index.js");
    ws = addFile(ws, "src/index.js", "v1", "entry", "threejs");
    expect(() => revertFile(ws, "src/index.js", 99)).toThrow("Version 99 not found");
  });

  it("wraps user code with skill-specific imports", () => {
    const threeCode = wrapUserCodeWithImports("const s = new THREE.Scene();", "threejs");
    expect(threeCode).toContain("import * as THREE from 'three'");
    expect(threeCode).toContain("window.THREE = THREE");

    const d3Code = wrapUserCodeWithImports("const svg = d3.select('body');", "d3js");
    expect(d3Code).toContain("import * as d3 from 'd3'");
    expect(d3Code).toContain("window.d3 = d3");
  });

  it("generates composite HTML with layered containers", () => {
    const html = generateCompositeHTMLWrapper(
      ["threejs", "d3js"],
      { threejs: "index-threejs.js", d3js: "index-d3js.js" }
    );

    expect(html).toContain('id="three-canvas"');
    expect(html).toContain('id="d3-svg"');
    expect(html).toContain('z-index:0');
    expect(html).toContain('z-index:2');
    expect(html).toContain('window.GenVisBus');
    expect(html).toContain("<script type=\"module\" src=\"./index-threejs.js\"></script>");
    expect(html).toContain("<script type=\"module\" src=\"./index-d3js.js\"></script>");
  });

  it("composite HTML includes all skill containers and scripts", () => {
    const html = generateCompositeHTMLWrapper(
      ["threejs", "p5js", "animejs"],
      { threejs: "t.js", p5js: "p.js", animejs: "a.js" }
    );
    expect(html).toContain('id="three-canvas"');
    expect(html).toContain('id="p5-container"');
    expect(html).toContain('id="anime-stage"');
    expect(html).toContain("<script type=\"module\" src=\"./t.js\"></script>");
    expect(html).toContain("<script type=\"module\" src=\"./p.js\"></script>");
    expect(html).toContain("<script type=\"module\" src=\"./a.js\"></script>");
    expect(html).toContain("window.GenVisBus");
  });
});
