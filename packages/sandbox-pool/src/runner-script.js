import { createContext, Script } from "node:vm";
import fs from "node:fs";

function isoNow() { return new Date().toISOString(); }

function formatLogArgs(args) {
  return args.map((value) => {
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }).join(" ");
}

function createDocumentStub() {
  const nodes = [];
  const listeners = {};

  function createCanvasContext2D() {
    return {
      fillRect() {}, clearRect() {}, strokeRect() {},
      beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
      arc() {}, fill() {}, stroke() {},
      fillText() {}, strokeText() {},
      drawImage() {}, putImageData() {},
      createImageData() { return { data: new Uint8ClampedArray(4), width: 1, height: 1 }; },
      getImageData() { return { data: new Uint8ClampedArray(4), width: 1, height: 1 }; },
      save() {}, restore() {},
      scale() {}, rotate() {}, translate() {}, transform() {}, setTransform() {},
      measureText() { return { width: 0 }; },
      set fillStyle(_v) {}, set strokeStyle(_v) {}, set lineWidth(_v) {},
      set font(_v) {}, set textAlign(_v) {}, set globalAlpha(_v) {},
      canvas: { width: 1280, height: 720 }
    };
  }

  function createCanvasContextWebGL() {
    // Minimal no-op WebGL context — prevents "getContext is not a function" crashes
    const noop = () => {};
    const noopRet0 = () => 0;
    const noopRetNull = () => null;
    return new Proxy({}, { get(_t, prop) {
      if (prop === 'canvas') return { width: 1280, height: 720 };
      if (typeof prop === 'string') return noop;
      return undefined;
    }});
  }

  function createNode(tagName = "div") {
    const node = {
      nodeName: String(tagName).toUpperCase(),
      tagName: String(tagName).toUpperCase(),
      style: {},
      children: [],
      dataset: {},
      className: "",
      id: "",
      textContent: "",
      width: 1280,
      height: 720,
      appendChild(child) {
        if (child) this.children.push(child);
        return child;
      },
      removeChild(child) {
        this.children = this.children.filter((node) => node !== child);
      },
      setAttribute(name, value) {
        this[name] = value;
      },
      getAttribute(name) {
        return this[name];
      },
      addEventListener() {},
      removeEventListener() {},
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      }
    };

    // Canvas-specific: getContext stub
    if (String(tagName).toLowerCase() === 'canvas') {
      node.getContext = (type) => {
        if (type === '2d') return createCanvasContext2D();
        return createCanvasContextWebGL();
      };
    }

    return node;
  }

  const body = createNode("body");
  body.appendChild = (child) => {
    if (child) {
      nodes.push(child);
    }
    return child;
  };
  body.removeChild = (child) => {
    const index = nodes.indexOf(child);
    if (index >= 0) {
      nodes.splice(index, 1);
    }
  };

  return {
    body,
    createElement(tagName) {
      return createNode(tagName);
    },
    getElementById(id) {
      return nodes.find((node) => node.id === id) ?? null;
    },
    querySelector(selector) {
      if (selector === "body") {
        return body;
      }

      if (selector.startsWith("#")) {
        return nodes.find((node) => node.id === selector.slice(1)) ?? null;
      }

      return nodes[0] ?? null;
    },
    querySelectorAll(selector) {
      const node = this.querySelector(selector);
      return node ? [node] : [];
    },
    addEventListener(type, listener) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(listener);
    },
    removeEventListener(type, listener) {
      if (listeners[type]) listeners[type] = listeners[type].filter(l => l !== listener);
    }
  };
}
function createConsoleShim(logs) { return { log: (...args) => logs.push({ level: "log", message: formatLogArgs(args), timestamp: isoNow() }), warn: (...args) => logs.push({ level: "warn", message: formatLogArgs(args), timestamp: isoNow() }), error: (...args) => logs.push({ level: "error", message: formatLogArgs(args), timestamp: isoNow() }), info: (...args) => logs.push({ level: "info", message: formatLogArgs(args), timestamp: isoNow() }) }; }

function summarizeScene(scene) {
  if (!scene || !Array.isArray(scene.children)) return { childCount: 0, types: [] };
  return { childCount: scene.children.length, types: scene.children.slice(0, 8).map((child) => child?.type ?? child?.constructor?.name ?? "unknown") };
}

function pumpFrameQueue(frameQueue, context, runtimeState, maxFrames, timeoutMs, startedAt) {
  let framesProcessed = 0;
  while (frameQueue.length > 0) {
    if (framesProcessed >= maxFrames) return { timedOut: false, frameBudgetReached: true, framesProcessed };
    if (Date.now() - startedAt > timeoutMs) return { timedOut: true, frameBudgetReached: false, framesProcessed };
    const callback = frameQueue.shift();
    callback(runtimeState.frameCount);
    framesProcessed += 1;
    runtimeState.frameCount += 1;
  }
  return { timedOut: false, frameBudgetReached: false, framesProcessed };
}

export function executePayload(payloadStr) {
  const { skill, code, timeoutMs, maxFrames } = JSON.parse(payloadStr);
  const startedAt = Date.now();
  const logs = [];
  const frameQueue = [];
  const runtimeState = { renderCount: 0, frameCount: 0 };

  const consoleShim = createConsoleShim(logs);
  const document = createDocumentStub();
  const sandbox = {
    console: consoleShim, document, window: null, self: null, globalThis: null,
    requestAnimationFrame(callback) { frameQueue.push(callback); return frameQueue.length; },
    cancelAnimationFrame() { return undefined; },
    setTimeout(callback) { if (typeof callback === "function") { frameQueue.push(callback); } return frameQueue.length; },
    clearTimeout() { return undefined; }, setInterval() { return 1; }, clearInterval() { return undefined; },
    performance: { now: () => Date.now() - startedAt },
    Date, Math, JSON, String, Number, Boolean, Array, Object, RegExp, Promise, Symbol, queueMicrotask,
    // Common globals particle systems and complex scenes rely on
    Map, Set, WeakMap, WeakSet,
    Float32Array, Float64Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array,
    ArrayBuffer, DataView,
    isNaN, isFinite, parseFloat, parseInt, encodeURIComponent, decodeURIComponent,
    // Viewport dimensions (common in resize handlers)
    innerWidth: 1280, innerHeight: 720,
    devicePixelRatio: 1,
    addEventListener(type, listener) { document.addEventListener(type, listener); },
    removeEventListener(type, listener) { document.removeEventListener(type, listener); },
    skillRuntime: { kind: skill.id, adapter: skill.runtime?.adapter },
    __runtimeState: runtimeState
  };

  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;

  // NOTE: JS skills (threejs, p5js, d3js, animejs) are rendered client-side.
  // Backend sandbox is no longer used for JS skills. This generic VM executor
  // remains for any non-JS execution paths that may still use the sandbox pool.

  const context = createContext(sandbox);

  try {
    if (skill.bootstrapScript) {
      new Script(skill.bootstrapScript, { displayErrors: true }).runInContext(context, { timeout: timeoutMs });
    }
    new Script(code, { displayErrors: true }).runInContext(context, { timeout: timeoutMs });
    const pumpResult = pumpFrameQueue(frameQueue, context, runtimeState, Math.max(1, Math.min(maxFrames, skill.runtime?.maxFrames ?? 60)), timeoutMs, startedAt);
    const durationMs = Date.now() - startedAt;

    if (pumpResult.timedOut) {
      return JSON.stringify({ success: false, status: "timeout", skillId: skill.id, durationMs, renderCount: runtimeState.renderCount, frameCount: runtimeState.frameCount, logs, summary: summarizeScene(sandbox.scene), error: "Sandbox execution timed out before all frames completed." });
    }
    return JSON.stringify({ success: true, status: "completed", skillId: skill.id, durationMs, renderCount: runtimeState.renderCount, frameCount: runtimeState.frameCount, logs, summary: summarizeScene(sandbox.scene), frameBudgetReached: pumpResult.frameBudgetReached, error: null });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    return JSON.stringify({ success: false, status: "error", skillId: skill.id, durationMs, renderCount: runtimeState.renderCount, frameCount: runtimeState.frameCount, logs, summary: summarizeScene(sandbox.scene), error: error?.message || String(error) });
  }
}

// Check if running from CLI directly
if (process.argv[2]) {
  try {
    const payloadStr = fs.readFileSync(process.argv[2], "utf-8");
    const result = executePayload(payloadStr);
    console.log(`__DAYTONA_RESULT__${result}__DAYTONA_RESULT_END__`);
    process.exit(0);
  } catch(err) {
    console.log(`__DAYTONA_RESULT__${JSON.stringify({ success: false, error: "Sandbox inner wrapper error: " + err.message })}__DAYTONA_RESULT_END__`);
    process.exit(1);
  }
}
