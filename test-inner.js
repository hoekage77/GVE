import { createContext, Script } from "node:vm";
import fs from "node:fs";

function isoNow() { return new Date().toISOString(); }

function formatLogArgs(args) {
  return args.map((value) => {
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }).join(" ");
}

function createVector3(initialX = 0, initialY = 0, initialZ = 0) {
  return { x: initialX, y: initialY, z: initialZ, set(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; return this; }, clone() { return createVector3(this.x, this.y, this.z); } };
}

function createObject3D(type) {
  return { type, children: [], position: createVector3(), rotation: createVector3(), scale: createVector3(1, 1, 1), userData: {}, add(...nodes) { for (const node of nodes) { if (node) this.children.push(node); } return this; }, remove(...nodes) { this.children = this.children.filter((child) => !nodes.includes(child)); return this; }, lookAt(x, y, z) { this.lookAtTarget = { x, y, z }; return this; } };
}

function createGeometry(type, args = []) { return { type, args, dispose() { this.disposed = true; } }; }
function createMaterial(type, options = {}) { return { type, options, dispose() { this.disposed = true; } }; }

function createMockRenderer(runtimeState) {
  return { type: "WebGLRenderer", domElement: { nodeName: "CANVAS", style: {} }, pixelRatio: 1, size: { width: 0, height: 0 }, setPixelRatio(value) { this.pixelRatio = value; }, setSize(width, height) { this.size = { width, height }; }, render(scene, camera) { runtimeState.renderCount += 1; this.lastRenderedScene = scene; this.lastRenderedCamera = camera; } };
}

function createThreeNamespace(runtimeState) {
  const Vector3 = class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } clone() { return new Vector3(this.x, this.y, this.z); } copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; } sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; } multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; } length() { return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z); } normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; this.z /= l; return this; } cross(v) { const ax=this.x,ay=this.y,az=this.z; this.x=ay*v.z-az*v.y; this.y=az*v.x-ax*v.z; this.z=ax*v.y-ay*v.x; return this; } dot(v) { return this.x*v.x+this.y*v.y+this.z*v.z; } distanceTo(v) { const dx=this.x-v.x,dy=this.y-v.y,dz=this.z-v.z; return Math.sqrt(dx*dx+dy*dy+dz*dz); } applyMatrix4() { return this; } };
  const Vector2 = class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } };
  const Vector4 = class Vector4 { constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; } };
  const Euler = class Euler { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
  const Quaternion = class Quaternion { constructor(x=0,y=0,z=0,w=1) { this.x=x;this.y=y;this.z=z;this.w=w; } setFromEuler() { return this; } };
  const Matrix4 = class Matrix4 { constructor() { this.elements = new Float32Array(16); this.elements[0]=1;this.elements[5]=1;this.elements[10]=1;this.elements[15]=1; } identity() { return this; } multiply() { return this; } makeRotationFromEuler() { return this; } };
  const Color = class Color { constructor(r = 1, g = 1, b = 1) { if (typeof r === 'number' && g === undefined) { this.r = ((r>>16)&255)/255; this.g = ((r>>8)&255)/255; this.b = (r&255)/255; } else { this.r = r; this.g = g; this.b = b; } } set(value) { this.value = value; return this; } setHSL(h, s, l) { return this; } clone() { return new Color(this.r, this.g, this.b); } getHex() { return 0xffffff; } };
  
  const createObject3DNode = (type) => ({
    type, children: [], position: new Vector3(), rotation: new Euler(), scale: new Vector3(1, 1, 1), quaternion: new Quaternion(), userData: {}, visible: true, castShadow: false, receiveShadow: false, name: "",
    add(...nodes) { nodes.forEach(n => n && this.children.push(n)); return this; },
    remove(...nodes) { this.children = this.children.filter(c => !nodes.includes(c)); return this; },
    lookAt() { return this; },
    traverse(callback) { callback(this); this.children.forEach(c => { if (c && typeof c.traverse === 'function') c.traverse(callback); else callback(c); }); },
    updateMatrix() {},
    updateMatrixWorld() {},
    clone() { return createObject3DNode(type); }
  });

  class Scene extends Object { constructor() { super(); Object.assign(this, createObject3DNode("Scene")); this.background = null; this.fog = null; } }
  class Group extends Object { constructor() { super(); Object.assign(this, createObject3DNode("Group")); } }
  class Object3D extends Object { constructor() { super(); Object.assign(this, createObject3DNode("Object3D")); } }
  class PerspectiveCamera extends Object { constructor() { super(); Object.assign(this, createObject3DNode("PerspectiveCamera")); this.fov = 50; this.aspect = 1; this.near = 0.1; this.far = 2000; this.updateProjectionMatrix = () => {}; } }
  class OrthographicCamera extends Object { constructor() { super(); Object.assign(this, createObject3DNode("OrthographicCamera")); this.updateProjectionMatrix = () => {}; } }
  class Mesh extends Object { constructor(geometry, material) { super(); Object.assign(this, createObject3DNode("Mesh")); this.geometry = geometry; this.material = material; } }
  class Points extends Object { constructor(geometry, material) { super(); Object.assign(this, createObject3DNode("Points")); this.geometry = geometry; this.material = material; } }
  class Line extends Object { constructor(geometry, material) { super(); Object.assign(this, createObject3DNode("Line")); this.geometry = geometry; this.material = material; } }
  class LineSegments extends Object { constructor(geometry, material) { super(); Object.assign(this, createObject3DNode("LineSegments")); this.geometry = geometry; this.material = material; } }
  class LineLoop extends Object { constructor(geometry, material) { super(); Object.assign(this, createObject3DNode("LineLoop")); this.geometry = geometry; this.material = material; } }
  class Sprite extends Object { constructor(material) { super(); Object.assign(this, createObject3DNode("Sprite")); this.material = material; } }
  class InstancedMesh extends Object { constructor(geometry, material, count) { super(); Object.assign(this, createObject3DNode("InstancedMesh")); this.geometry = geometry; this.material = material; this.count = count; this.instanceMatrix = { needsUpdate: false }; this.setMatrixAt = () => {}; this.setColorAt = () => {}; } }
  
  // Buffer classes
  class BufferGeometry { constructor() { this.attributes = {}; this.index = null; this.groups = []; this.boundingBox = null; this.boundingSphere = null; } setAttribute(name, attribute) { this.attributes[name] = attribute; return this; } getAttribute(name) { return this.attributes[name]; } setIndex(index) { this.index = index; return this; } computeVertexNormals() {} computeBoundingBox() {} computeBoundingSphere() {} dispose() {} copy() { return this; } clone() { return new BufferGeometry(); } setFromPoints() { return this; } }
  class BufferAttribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array ? array.length / itemSize : 0; this.needsUpdate = false; } }
  class Float32BufferAttribute extends BufferAttribute {}
  class Uint16BufferAttribute extends BufferAttribute {}
  class Uint32BufferAttribute extends BufferAttribute {}
  class Int8BufferAttribute extends BufferAttribute {}
  class InstancedBufferAttribute extends BufferAttribute {}
  class InterleavedBufferAttribute { constructor() { this.itemSize = 0; } }

  // ── Geometries ──
  const geomClass = (name) => class { constructor(...args) { return createGeometry(name, args); } };
  const BoxGeometry = geomClass("BoxGeometry");
  const SphereGeometry = geomClass("SphereGeometry");
  const PlaneGeometry = geomClass("PlaneGeometry");
  const CylinderGeometry = geomClass("CylinderGeometry");
  const ConeGeometry = geomClass("ConeGeometry");
  const TorusGeometry = geomClass("TorusGeometry");
  const TorusKnotGeometry = geomClass("TorusKnotGeometry");
  const RingGeometry = geomClass("RingGeometry");
  const CircleGeometry = geomClass("CircleGeometry");
  const IcosahedronGeometry = geomClass("IcosahedronGeometry");
  const OctahedronGeometry = geomClass("OctahedronGeometry");
  const DodecahedronGeometry = geomClass("DodecahedronGeometry");
  const TetrahedronGeometry = geomClass("TetrahedronGeometry");
  const CapsuleGeometry = geomClass("CapsuleGeometry");
  const LatheGeometry = geomClass("LatheGeometry");
  const ExtrudeGeometry = geomClass("ExtrudeGeometry");
  const ShapeGeometry = geomClass("ShapeGeometry");
  const TubeGeometry = geomClass("TubeGeometry");
  class EdgesGeometry { constructor(geo) { this.type = "EdgesGeometry"; this.parameters = { geometry: geo }; this.dispose = () => {}; } }
  class WireframeGeometry { constructor(geo) { this.type = "WireframeGeometry"; this.parameters = { geometry: geo }; this.dispose = () => {}; } }

  // ── Materials ──
  const matClass = (name) => class { constructor(options = {}) { return createMaterial(name, options); } };
  const MeshStandardMaterial = matClass("MeshStandardMaterial");
  const MeshBasicMaterial = matClass("MeshBasicMaterial");
  const MeshPhongMaterial = matClass("MeshPhongMaterial");
  const MeshPhysicalMaterial = matClass("MeshPhysicalMaterial");
  const MeshLambertMaterial = matClass("MeshLambertMaterial");
  const MeshNormalMaterial = matClass("MeshNormalMaterial");
  const MeshDepthMaterial = matClass("MeshDepthMaterial");
  const MeshToonMaterial = matClass("MeshToonMaterial");
  const MeshMatcapMaterial = matClass("MeshMatcapMaterial");
  const PointsMaterial = matClass("PointsMaterial");
  const LineBasicMaterial = matClass("LineBasicMaterial");
  const LineDashedMaterial = matClass("LineDashedMaterial");
  const SpriteMaterial = matClass("SpriteMaterial");
  const RawShaderMaterial = matClass("RawShaderMaterial");
  class ShaderMaterial { constructor(options = {}) { Object.assign(this, { type: "ShaderMaterial", uniforms: options.uniforms ?? {}, vertexShader: options.vertexShader ?? "", fragmentShader: options.fragmentShader ?? "", transparent: options.transparent ?? false, side: options.side ?? 0, blending: options.blending ?? 1, depthWrite: options.depthWrite ?? true, ...options, dispose() {} }); } }

  // ── Lights ──
  const lightClass = (name) => class { constructor() { Object.assign(this, createObject3DNode(name)); this.color = new Color(1, 1, 1); this.intensity = 1; this.castShadow = false; this.shadow = { mapSize: { width: 512, height: 512 }, camera: {} }; } };
  const AmbientLight = lightClass("AmbientLight");
  const DirectionalLight = lightClass("DirectionalLight");
  const PointLight = lightClass("PointLight");
  const SpotLight = lightClass("SpotLight");
  const HemisphereLight = lightClass("HemisphereLight");
  const RectAreaLight = lightClass("RectAreaLight");

  // ── Utilities ──
  class TextureLoader { load(url, onLoad) { const tex = { image: null, needsUpdate: false, wrapS: 0, wrapT: 0, repeat: new Vector2(1,1), offset: new Vector2(0,0), dispose() {} }; if (typeof onLoad === 'function') onLoad(tex); return tex; } }
  class CubeTextureLoader { load() { return { dispose() {} }; } }
  class Raycaster { constructor() { this.ray = {}; } set() {} setFromCamera() {} intersectObject() { return []; } intersectObjects() { return []; } }
  class Clock { constructor() { this.startTime = Date.now(); this.elapsedTime = 0; this.running = true; } getElapsedTime() { return (Date.now() - this.startTime) / 1000; } getDelta() { return 0.016; } start() { this.startTime = Date.now(); this.running = true; } stop() { this.running = false; } }
  class Fog { constructor(color, near, far) { this.color = new Color(color ?? 0); this.near = near ?? 1; this.far = far ?? 1000; } }
  class FogExp2 { constructor(color, density) { this.color = new Color(color ?? 0); this.density = density ?? 0.00025; } }
  class Curve { getPoint() { return new Vector3(); } getPoints(n = 50) { return Array.from({ length: n }, () => new Vector3()); } }
  class CurvePath extends Curve { constructor() { super(); this.curves = []; } }
  class Path extends CurvePath { constructor() { super(); } moveTo() { return this; } lineTo() { return this; } quadraticCurveTo() { return this; } bezierCurveTo() { return this; } }
  class Shape extends Path { constructor() { super(); } }
  class LineCurve extends Curve { constructor(v1, v2) { super(); } }
  class EllipseCurve extends Curve { constructor(aX, aY, xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation) { super(); } }
  class SplineCurve extends Curve { constructor(points) { super(); } }
  class CatmullRomCurve3 extends Curve { constructor(points) { super(); this.points = points ?? []; } }
  class QuadraticBezierCurve3 extends Curve {}
  class CubicBezierCurve3 extends Curve {}

  // ── Constants ──
  const DoubleSide = 2;
  const FrontSide = 0;
  const BackSide = 1;
  const AdditiveBlending = 2;
  const SubtractiveBlending = 3;
  const MultiplyBlending = 4;
  const NormalBlending = 1;
  const CustomBlending = 5;
  const NoBlending = 0;
  const RepeatWrapping = 1000;
  const ClampToEdgeWrapping = 1001;
  const MirroredRepeatWrapping = 1002;
  const NearestFilter = 1003;
  const LinearFilter = 1006;
  const SRGBColorSpace = "srgb";
  const LinearSRGBColorSpace = "srgb-linear";
  const PCFSoftShadowMap = 2;
  const BasicShadowMap = 0;
  const VSMShadowMap = 3;

  return {
    // Core
    Scene, Group, Object3D, PerspectiveCamera, OrthographicCamera, Mesh, Points, Line, LineSegments, LineLoop, Sprite, InstancedMesh,
    // Buffer
    BufferGeometry, BufferAttribute, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute, Int8BufferAttribute, InstancedBufferAttribute, InterleavedBufferAttribute,
    // Geometries
    BoxGeometry, SphereGeometry, PlaneGeometry, CylinderGeometry, ConeGeometry, TorusGeometry, TorusKnotGeometry, RingGeometry, CircleGeometry, IcosahedronGeometry, OctahedronGeometry, DodecahedronGeometry, TetrahedronGeometry, CapsuleGeometry, LatheGeometry, ExtrudeGeometry, ShapeGeometry, TubeGeometry, EdgesGeometry, WireframeGeometry,
    // Materials
    MeshStandardMaterial, MeshBasicMaterial, MeshPhongMaterial, MeshPhysicalMaterial, MeshLambertMaterial, MeshNormalMaterial, MeshDepthMaterial, MeshToonMaterial, MeshMatcapMaterial, PointsMaterial, LineBasicMaterial, LineDashedMaterial, SpriteMaterial, ShaderMaterial, RawShaderMaterial,
    // Lights
    AmbientLight, DirectionalLight, PointLight, SpotLight, HemisphereLight, RectAreaLight,
    // Math
    Vector2, Vector3, Vector4, Euler, Quaternion, Matrix4, Color,
    // Utilities
    WebGLRenderer: function(opts) { const r = createMockRenderer(runtimeState); if (opts?.antialias !== undefined) r.antialias = opts.antialias; r.shadowMap = { enabled: false, type: 0 }; r.outputColorSpace = "srgb"; r.toneMapping = 0; r.toneMappingExposure = 1; r.setClearColor = () => {}; return r; },
    TextureLoader, CubeTextureLoader, Raycaster, Clock, Fog, FogExp2,
    Shape, Path, CurvePath, Curve, LineCurve, EllipseCurve, SplineCurve, CatmullRomCurve3, QuadraticBezierCurve3, CubicBezierCurve3,
    MathUtils: { randFloat: (min, max) => min + Math.random() * (max - min), randFloatSpread: (range) => range * (0.5 - Math.random()), degToRad: (deg) => deg * Math.PI / 180, radToDeg: (rad) => rad * 180 / Math.PI, clamp: (val, min, max) => Math.max(min, Math.min(max, val)), lerp: (x, y, t) => (1-t)*x + t*y, mapLinear: (x, a1, a2, b1, b2) => b1 + (x-a1)*(b2-b1)/(a2-a1) },
    // Constants
    DoubleSide, FrontSide, BackSide, AdditiveBlending, SubtractiveBlending, MultiplyBlending, NormalBlending, CustomBlending, NoBlending, RepeatWrapping, ClampToEdgeWrapping, MirroredRepeatWrapping, NearestFilter, LinearFilter, SRGBColorSpace, LinearSRGBColorSpace, PCFSoftShadowMap, BasicShadowMap, VSMShadowMap
  };
}

function createP5Runtime(runtimeState, logs) {
  const state = { width: 0, height: 0, looping: true, frameRateValue: 60, backgroundColor: null, operations: [] };
  const record = (operation, payload = {}) => { state.operations.push({ operation, payload, timestamp: isoNow() }); if (operation === "ellipse" || operation === "rect" || operation === "line") { runtimeState.renderCount += 1; } };
  return { width: 0, height: 0, createCanvas(width, height) { state.width = width; state.height = height; this.width = width; this.height = height; record("createCanvas", { width, height }); return { width, height, nodeName: "CANVAS" }; }, background(...args) { state.backgroundColor = args; record("background", { args }); }, fill(...args) { record("fill", { args }); }, stroke(...args) { record("stroke", { args }); }, noStroke() { record("noStroke"); }, ellipse(...args) { record("ellipse", { args }); }, rect(...args) { record("rect", { args }); }, line(...args) { record("line", { args }); }, translate(...args) { record("translate", { args }); }, rotate(...args) { record("rotate", { args }); }, push() { record("push"); }, pop() { record("pop"); }, frameRate(value) { state.frameRateValue = value; record("frameRate", { value }); }, noLoop() { state.looping = false; record("noLoop"); }, loop() { state.looping = true; record("loop"); }, random(min = 1, max) { const upper = typeof max === "number" ? max : min; const lower = typeof max === "number" ? min : 0; return lower + Math.random() * (upper - lower); }, millis() { return Date.now(); }, _state: state };
}

function createD3Runtime(logs) {
  function createD3Chain(label, logs) { const chain = { _label: label, append(name) { logs.push({ level: "log", message: `${label}.append(${name})`, timestamp: isoNow() }); return createD3Chain(`${label}.append(${name})`, logs); }, attr() { return chain; }, style() { return chain; }, text() { return chain; }, html() { return chain; }, data() { return chain; }, enter() { return chain; }, exit() { return chain; }, join() { return chain; }, remove() { return chain; }, call() { return chain; }, select() { return createD3Chain(`${label}.select`, logs); }, selectAll() { return createD3Chain(`${label}.selectAll`, logs); }, on() { return chain; }, node() { return { nodeName: "SVG" }; } }; return chain; }
  const linearScale = () => { let domainValues = [0, 1]; let rangeValues = [0, 1]; const scale = (value) => { const [domainStart, domainEnd] = domainValues; const [rangeStart, rangeEnd] = rangeValues; if (domainEnd === domainStart) return rangeStart; const ratio = (value - domainStart) / (domainEnd - domainStart); return rangeStart + ratio * (rangeEnd - rangeStart); }; scale.domain = (values) => { if (Array.isArray(values) && values.length >= 2) { domainValues = [values[0], values[values.length - 1]]; } return scale; }; scale.range = (values) => { if (Array.isArray(values) && values.length >= 2) { rangeValues = [values[0], values[values.length - 1]]; } return scale; }; return scale; };
  const bandScale = () => { const scale = linearScale(); scale.padding = () => scale; scale.bandwidth = () => 24; return scale; };
  return { select: (selector) => createD3Chain(`d3.select(${selector})`, logs), selectAll: (selector) => createD3Chain(`d3.selectAll(${selector})`, logs), scaleLinear: linearScale, scaleBand: bandScale, extent: (values) => [Math.min(...values), Math.max(...values)], max: (values) => Math.max(...values), min: (values) => Math.min(...values), range: (start, stop, step = 1) => { const values = []; for (let value = start; value < stop; value += step) { values.push(value); } return values; }, line: () => { const lineGenerator = () => ""; lineGenerator.x = () => lineGenerator; lineGenerator.y = () => lineGenerator; lineGenerator.curve = () => lineGenerator; return lineGenerator; }, axisBottom: () => createD3Chain("d3.axisBottom", logs), axisLeft: () => createD3Chain("d3.axisLeft", logs), curveLinear: "curveLinear" };
}

function createDocumentStub() { return { body: { appendChild() {}, removeChild() {} }, createElement(tagName) { return { tagName: String(tagName).toUpperCase(), style: {}, children: [] }; } }; }
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
    skillRuntime: { kind: skill.id, adapter: skill.runtime?.adapter },
    __runtimeState: runtimeState
  };

  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;

  if (skill.id === "threejs") {
    const THREE = createThreeNamespace(runtimeState);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    camera.position.set(2.5, 2, 3.5); camera.lookAt(0, 0, 0); renderer.setPixelRatio(1); renderer.setSize(1280, 720);
    sandbox.THREE = THREE; sandbox.scene = scene; sandbox.camera = camera; sandbox.renderer = renderer;
    sandbox.OrbitControls = class OrbitControls { constructor() { this.enabled = true; } update() {} dispose() { this.disposed = true; } };
  }
  if (skill.id === "p5js") { Object.assign(sandbox, createP5Runtime(runtimeState, logs)); }
  if (skill.id === "d3js") { sandbox.d3 = createD3Runtime(logs); }

  const context = createContext(sandbox);

  try {
    if (skill.bootstrapScript) {
      new Script(skill.bootstrapScript, { displayErrors: true }).runInContext(context, { timeout: timeoutMs });
    }
    new Script(code, { displayErrors: true }).runInContext(context, { timeout: timeoutMs });
    if (skill.id === "p5js" && typeof sandbox.setup === "function") sandbox.setup();
    if (skill.id === "p5js" && typeof sandbox.draw === "function") {
      const drawLimit = Math.max(1, Math.min(maxFrames, skill.runtime?.maxFrames ?? 60));
      for (let index = 0; index < drawLimit; index += 1) {
        sandbox.draw(); runtimeState.frameCount += 1;
        if (sandbox._state && sandbox._state.looping === false) break;
      }
    }
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

const runtimeState = { logs: [], renderCount: 0, frameCount: 0, startTime: Date.now(), executionTime: 0, metrics: { drawCalls: 0 } };
const THREE = createThreeNamespace(runtimeState);
console.log('Is EllipseCurve defined?', typeof THREE.EllipseCurve);
try { const curve = new THREE.EllipseCurve(0, 0, 10, 10, 0, 2 * Math.PI, false, 0); console.log('EllipseCurve works', curve); } catch (e) { console.error('Error with EllipseCurve: ', e.message); }