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
function createMaterial(type, options = {}) { 
  const colorObj = { setHSL() { return this; }, setRGB() { return this; }, setHex() { return this; }, set() { return this; } };
  return { type, options, color: colorObj, emissive: colorObj, dispose() { this.disposed = true; } }; 
}

function createMockRenderer(runtimeState) {
  return { type: "WebGLRenderer", domElement: { nodeName: "CANVAS", style: {} }, pixelRatio: 1, size: { width: 0, height: 0 }, setPixelRatio(value) { this.pixelRatio = value; }, setSize(width, height) { this.size = { width, height }; }, render(scene, camera) { runtimeState.renderCount += 1; this.lastRenderedScene = scene; this.lastRenderedCamera = camera; } };
}

function createThreeNamespace(runtimeState) {
  const Vector3 = class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } setX(x) { this.x = x; return this; } setY(y) { this.y = y; return this; } setZ(z) { this.z = z; return this; } clone() { return new Vector3(this.x, this.y, this.z); } copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; } addScalar(s) { this.x += s; this.y += s; this.z += s; return this; } sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; } subScalar(s) { this.x -= s; this.y -= s; this.z -= s; return this; } multiply(v) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; } multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; } divide(v) { this.x /= v.x; this.y /= v.y; this.z /= v.z; return this; } divideScalar(s) { return this.multiplyScalar(1/s); } length() { return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z); } normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; this.z /= l; return this; } cross(v) { const ax=this.x,ay=this.y,az=this.z; this.x=ay*v.z-az*v.y; this.y=az*v.x-ax*v.z; this.z=ax*v.y-ay*v.x; return this; } dot(v) { return this.x*v.x+this.y*v.y+this.z*v.z; } distanceTo(v) { const dx=this.x-v.x,dy=this.y-v.y,dz=this.z-v.z; return Math.sqrt(dx*dx+dy*dy+dz*dz); } clamp() { return this; } applyMatrix4() { return this; } applyEuler() { return this; } applyQuaternion() { return this; } applyAxisAngle() { return this; } lerp() { return this; } };
  const Vector2 = class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } clone() { return new Vector2(this.x, this.y); } copy(v) { this.x = v.x; this.y = v.y; return this; } add(v) { this.x += v.x; this.y += v.y; return this; } sub(v) { this.x -= v.x; this.y -= v.y; return this; } multiplyScalar(s) { this.x *= s; this.y *= s; return this; } divideScalar(s) { this.x /= s; this.y /= s; return this; } length() { return Math.sqrt(this.x*this.x+this.y*this.y); } normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; } distanceTo(v) { const dx=this.x-v.x, dy=this.y-v.y; return Math.sqrt(dx*dx+dy*dy); } };
  const Vector4 = class Vector4 { constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; } };
  const Euler = class Euler { constructor(x = 0, y = 0, z = 0, order = 'XYZ') { this.x = x; this.y = y; this.z = z; this.order = order; } set(x, y, z, order) { this.x = x; this.y = y; this.z = z; this.order = order || this.order; return this; } copy(e) { this.x = e.x; this.y = e.y; this.z = e.z; this.order = e.order; return this; } clone() { return new Euler(this.x, this.y, this.z, this.order); } };
  const Quaternion = class Quaternion { constructor(x=0,y=0,z=0,w=1) { this.x=x;this.y=y;this.z=z;this.w=w; } set(x,y,z,w) { this.x=x;this.y=y;this.z=z;this.w=w; return this; } copy(q) { this.x=q.x;this.y=q.y;this.z=q.z;this.w=q.w; return this; } clone() { return new Quaternion(this.x, this.y, this.z, this.w); } setFromEuler() { return this; } setFromAxisAngle() { return this; } multiply() { return this; } };
  const Matrix4 = class Matrix4 { constructor() { this.elements = new Float32Array(16); this.elements[0]=1;this.elements[5]=1;this.elements[10]=1;this.elements[15]=1; } identity() { return this; } multiply() { return this; } multiplyMatrices() { return this; } makeRotationFromEuler() { return this; } makeRotationX() { return this; } makeRotationY() { return this; } makeRotationZ() { return this; } makeTranslation() { return this; } makeScale() { return this; } setPosition() { return this; } };
  const Color = class Color {
    constructor(r = 1, g = 1, b = 1) {
      if (typeof r === 'number' && arguments.length === 1) {
        this.r = ((r >> 16) & 255) / 255;
        this.g = ((r >> 8) & 255) / 255;
        this.b = (r & 255) / 255;
      } else if (typeof r === 'string') {
        this.r = 1; this.g = 1; this.b = 1;
        // parse hex strings like '#ff0000'
        const hex = r.replace('#', '');
        if (hex.length === 6) {
          this.r = parseInt(hex.slice(0,2),16)/255;
          this.g = parseInt(hex.slice(2,4),16)/255;
          this.b = parseInt(hex.slice(4,6),16)/255;
        }
      } else {
        this.r = r ?? 1; this.g = g ?? 1; this.b = b ?? 1;
      }
    }
    set(r, g, b) {
      if (typeof r === 'number' && g === undefined) {
        this.r = ((r >> 16) & 255) / 255;
        this.g = ((r >> 8) & 255) / 255;
        this.b = (r & 255) / 255;
      } else if (typeof r === 'string') {
        const c = new Color(r); this.r = c.r; this.g = c.g; this.b = c.b;
      } else {
        if (g !== undefined) { this.r = r; this.g = g; this.b = b; }
      }
      return this;
    }
    setScalar(s) { this.r = s; this.g = s; this.b = s; return this; }
    setHex(hex) { this.r = ((hex>>16)&255)/255; this.g = ((hex>>8)&255)/255; this.b = (hex&255)/255; return this; }
    setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
    setHSL(h, s, l) {
      if (s === 0) { this.r = this.g = this.b = l; }
      else {
        const hue2rgb = (p, q, t) => { if (t<0) t+=1; if (t>1) t-=1; if (t<1/6) return p+(q-p)*6*t; if (t<1/2) return q; if (t<2/3) return p+(q-p)*(2/3-t)*6; return p; };
        const q = l<0.5 ? l*(1+s) : l+s-l*s, p = 2*l-q;
        this.r = hue2rgb(p,q,h+1/3); this.g = hue2rgb(p,q,h); this.b = hue2rgb(p,q,h-1/3);
      }
      return this;
    }
    clone() { return new Color(this.r, this.g, this.b); }
    copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
    add(c) { this.r += c.r; this.g += c.g; this.b += c.b; return this; }
    addColors(a, b) { this.r = a.r+b.r; this.g = a.g+b.g; this.b = a.b+b.b; return this; }
    addScalar(s) { this.r += s; this.g += s; this.b += s; return this; }
    sub(c) { this.r = Math.max(0,this.r-c.r); this.g = Math.max(0,this.g-c.g); this.b = Math.max(0,this.b-c.b); return this; }
    multiply(c) { this.r *= c.r; this.g *= c.g; this.b *= c.b; return this; }
    multiplyColors(a, b) { this.r = a.r*b.r; this.g = a.g*b.g; this.b = a.b*b.b; return this; }
    multiplyScalar(s) { this.r *= s; this.g *= s; this.b *= s; return this; }
    lerp(c, alpha) { this.r += (c.r-this.r)*alpha; this.g += (c.g-this.g)*alpha; this.b += (c.b-this.b)*alpha; return this; }
    lerpColors(a, b, alpha) { this.r = a.r+(b.r-a.r)*alpha; this.g = a.g+(b.g-a.g)*alpha; this.b = a.b+(b.b-a.b)*alpha; return this; }
    lerpHSL(c, alpha) { return this.lerp(c, alpha); }
    equals(c) { return c.r===this.r && c.g===this.g && c.b===this.b; }
    getHex() { return ((this.r*255)<<16|(this.g*255)<<8|(this.b*255)); }
    getHexString() { return this.getHex().toString(16).padStart(6,'0'); }
    getHSL(target = {}) { target.h = 0; target.s = 0; target.l = (this.r+this.g+this.b)/3; return target; }
    getStyle() { return `rgb(${Math.round(this.r*255)},${Math.round(this.g*255)},${Math.round(this.b*255)})`; }
    convertSRGBToLinear() { this.r = Math.pow(this.r,2.2); this.g = Math.pow(this.g,2.2); this.b = Math.pow(this.b,2.2); return this; }
    convertLinearToSRGB() { this.r = Math.pow(this.r,1/2.2); this.g = Math.pow(this.g,1/2.2); this.b = Math.pow(this.b,1/2.2); return this; }
    toArray(a = [], offset = 0) { a[offset]=this.r; a[offset+1]=this.g; a[offset+2]=this.b; return a; }
    fromArray(a, offset = 0) { this.r = a[offset]; this.g = a[offset+1]; this.b = a[offset+2]; return this; }
    fromBufferAttribute(attr, index) { this.r = attr.array[index*attr.itemSize]; this.g = attr.array[index*attr.itemSize+1]; this.b = attr.array[index*attr.itemSize+2]; return this; }
  };
  
  const createObject3DNode = (type) => ({
    type, children: [], position: new Vector3(), rotation: new Euler(), scale: new Vector3(1, 1, 1), quaternion: new Quaternion(), userData: {}, visible: true, castShadow: false, receiveShadow: false, name: "", parent: null,
    add(...nodes) { nodes.forEach(n => { if (n) { this.children.push(n); n.parent = this; } }); return this; },
    remove(...nodes) { this.children = this.children.filter(c => !nodes.includes(c)); nodes.forEach(n => { if (n && n.parent === this) n.parent = null; }); return this; },
    clear() { this.children.forEach(c => c.parent = null); this.children = []; return this; },
    lookAt() { return this; },
    rotateX(angle) { this.rotation.x += angle; return this; },
    rotateY(angle) { this.rotation.y += angle; return this; },
    rotateZ(angle) { this.rotation.z += angle; return this; },
    translateX(distance) { this.position.x += distance; return this; },
    translateY(distance) { this.position.y += distance; return this; },
    translateZ(distance) { this.position.z += distance; return this; },
    traverse(callback) { callback(this); this.children.forEach(c => { if (c && typeof c.traverse === 'function') c.traverse(callback); else callback(c); }); },
    updateMatrix() {},
    updateMatrixWorld() {},
    getWorldPosition(target) { const v = target || new Vector3(); return v.set(this.position.x, this.position.y, this.position.z); },
    getWorldDirection(target) { const v = target || new Vector3(); return v.set(0, 0, 1); },
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
  class InstancedMesh extends Object { constructor(geometry, material, count) { super(); Object.assign(this, createObject3DNode("InstancedMesh")); this.geometry = geometry; this.material = material; this.count = count; this.instanceMatrix = { needsUpdate: false }; this.instanceColor = { needsUpdate: false }; this.setMatrixAt = () => {}; this.setColorAt = () => {}; this.getMatrixAt = () => {}; this.getColorAt = () => {}; } }
  
  // Buffer classes
  class BufferGeometry { constructor() { this.attributes = {}; this.index = null; this.groups = []; this.boundingBox = null; this.boundingSphere = null; this.userData = {}; } setAttribute(name, attribute) { this.attributes[name] = attribute; return this; } getAttribute(name) { return this.attributes[name]; } deleteAttribute(name) { delete this.attributes[name]; return this; } setIndex(index) { this.index = index; return this; } computeVertexNormals() {} computeBoundingBox() { this.boundingBox = { min: new Vector3(), max: new Vector3() }; } computeBoundingSphere() { this.boundingSphere = { center: new Vector3(), radius: 1 }; } dispose() {} copy() { return this; } clone() { return new BufferGeometry(); } setFromPoints() { return this; } center() { return this; } rotateX() { return this; } rotateY() { return this; } rotateZ() { return this; } translate() { return this; } scale() { return this; } }
  class BufferAttribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array ? array.length / itemSize : 0; this.needsUpdate = false; } }
  class Float32BufferAttribute extends BufferAttribute {}
  class Uint16BufferAttribute extends BufferAttribute {}
  class Uint32BufferAttribute extends BufferAttribute {}
  class Int8BufferAttribute extends BufferAttribute {}
  class InstancedBufferAttribute extends BufferAttribute {}
  class InterleavedBufferAttribute { constructor() { this.itemSize = 0; } }

  // ── Geometries ──
  // geomClass now extends BufferGeometry so .attributes, .setAttribute(), etc. work.
  const geomClass = (name) => class extends BufferGeometry {
    constructor(...args) {
      super();
      this.type = name;
      this.parameters = {};
      // Pre-populate a minimal position attribute so .getAttribute('position') never returns undefined
      const vertCount = 8; // enough for any primitive
      this.setAttribute('position', new Float32BufferAttribute(new Float32Array(vertCount * 3), 3));
      this.setAttribute('normal', new Float32BufferAttribute(new Float32Array(vertCount * 3), 3));
      this.setAttribute('uv', new Float32BufferAttribute(new Float32Array(vertCount * 2), 2));
    }
  };
  
  // Custom CapsuleGeometry implementation for compatibility
  class CapsuleGeometry extends BufferGeometry {
    constructor(radius = 1, length = 1, capSegments = 4, radialSegments = 8) {
      super();
      this.type = 'CapsuleGeometry';
      this.parameters = { radius, length, capSegments, radialSegments };
      
      // Create a simple capsule using cylinder + sphere caps approximation
      // For the sandbox, we'll use a cylinder geometry placeholder
      const vertCount = Math.max(32, (capSegments * radialSegments + 2) * 3);
      this.setAttribute('position', new Float32BufferAttribute(new Float32Array(vertCount * 3), 3));
      this.setAttribute('normal', new Float32BufferAttribute(new Float32Array(vertCount * 3), 3));
      this.setAttribute('uv', new Float32BufferAttribute(new Float32Array(vertCount * 2), 2));
    }
  }
  
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
  // CapsuleGeometry is defined above as a custom class
  const LatheGeometry = geomClass("LatheGeometry");
  const ExtrudeGeometry = geomClass("ExtrudeGeometry");
  const ShapeGeometry = geomClass("ShapeGeometry");
  const TubeGeometry = geomClass("TubeGeometry");
  const TextGeometry = geomClass("TextGeometry");
  class EdgesGeometry extends BufferGeometry { constructor(geo) { super(); this.type = "EdgesGeometry"; this.parameters = { geometry: geo }; } }
  class WireframeGeometry extends BufferGeometry { constructor(geo) { super(); this.type = "WireframeGeometry"; this.parameters = { geometry: geo }; } }

  // ── Materials ──
  // matClass now returns a real object (not a plain object from createMaterial)
  // so properties like .color, .emissive, .map etc. are always present and mutable.
  const matClass = (name) => class {
    constructor(options = {}) {
      this.type = name;
      this.color = new Color(options.color ?? 0xffffff);
      this.emissive = new Color(0x000000);
      this.transparent = options.transparent ?? false;
      this.opacity = options.opacity ?? 1;
      this.side = options.side ?? 0;
      this.wireframe = options.wireframe ?? false;
      this.depthWrite = options.depthWrite ?? true;
      this.depthTest = options.depthTest ?? true;
      this.blending = options.blending ?? 1;
      this.visible = true;
      this.needsUpdate = false;
      this.map = options.map ?? null;
      this.alphaMap = options.alphaMap ?? null;
      this.envMap = options.envMap ?? null;
      // PBR props
      this.metalness = options.metalness ?? 0;
      this.roughness = options.roughness ?? 1;
      this.emissiveIntensity = options.emissiveIntensity ?? 1;
      // PointsMaterial props
      this.size = options.size ?? 1;
      this.sizeAttenuation = options.sizeAttenuation ?? true;
      // vertexColors
      this.vertexColors = options.vertexColors ?? false;
      // Copy any remaining options
      Object.assign(this, options);
      // Restore color/emissive as Color objects even if options overwrote them
      if (!(this.color instanceof Color)) this.color = new Color(this.color ?? 0xffffff);
      if (!(this.emissive instanceof Color)) this.emissive = new Color(this.emissive ?? 0x000000);
    }
    clone() { return Object.assign(Object.create(Object.getPrototypeOf(this)), this); }
    copy(src) { Object.assign(this, src); return this; }
    dispose() { this.disposed = true; }
  };
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
  class Curve { 
    getPoint() { return new Vector3(); } 
    getPointAt(u) { return this.getPoint(u); } 
    getPoints(n = 50) { return Array.from({ length: n }, () => new Vector3()); }
    getSpacedPoints(n = 50) { return this.getPoints(n); }
    getTangent(t) { return new Vector3(1, 0, 0); }
    getTangentAt(u) { return this.getTangent(u); }
    computeFrenetFrames() { return { tangents: [], normals: [], binormals: [] }; }
  }
  class CurvePath extends Curve { constructor() { super(); this.curves = []; } add(c) { this.curves.push(c); } closePath() {} }
  class Path extends CurvePath { constructor() { super(); } moveTo() { return this; } lineTo() { return this; } quadraticCurveTo() { return this; } bezierCurveTo() { return this; } splineThru() { return this; } arc() { return this; } absarc() { return this; } ellipse() { return this; } absellipse() { return this; } }
  class Shape extends Path { constructor() { super(); this.holes = []; } extractPoints() { return { shape: [], holes: [] }; } }
  class LineCurve extends Curve { constructor(v1, v2) { super(); } }
  class LineCurve3 extends Curve { constructor(v1, v2) { super(); } }
  class EllipseCurve extends Curve { constructor(aX, aY, xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation) { super(); } }
  class ArcCurve extends EllipseCurve { constructor(aX, aY, aRadius, aStartAngle, aEndAngle, aClockwise) { super(aX, aY, aRadius, aRadius, aStartAngle, aEndAngle, aClockwise); } }
  class SplineCurve extends Curve { constructor(points) { super(); } }
  class CatmullRomCurve3 extends Curve { constructor(points) { super(); this.points = points ?? []; } }
  class QuadraticBezierCurve extends Curve {}
  class CubicBezierCurve extends Curve {}
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
    BoxGeometry, SphereGeometry, PlaneGeometry, CylinderGeometry, ConeGeometry, TorusGeometry, TorusKnotGeometry, RingGeometry, CircleGeometry, IcosahedronGeometry, OctahedronGeometry, DodecahedronGeometry, TetrahedronGeometry, CapsuleGeometry, LatheGeometry, ExtrudeGeometry, ShapeGeometry, TubeGeometry, TextGeometry, EdgesGeometry, WireframeGeometry,
    // Materials
    MeshStandardMaterial, MeshBasicMaterial, MeshPhongMaterial, MeshPhysicalMaterial, MeshLambertMaterial, MeshNormalMaterial, MeshDepthMaterial, MeshToonMaterial, MeshMatcapMaterial, PointsMaterial, LineBasicMaterial, LineDashedMaterial, SpriteMaterial, ShaderMaterial, RawShaderMaterial,
    // Lights
    AmbientLight, DirectionalLight, PointLight, SpotLight, HemisphereLight, RectAreaLight,
    // Math
    Vector2, Vector3, Vector4, Euler, Quaternion, Matrix4, Color,
    // Utilities
    WebGLRenderer: function(opts) { const r = createMockRenderer(runtimeState); if (opts?.antialias !== undefined) r.antialias = opts.antialias; r.shadowMap = { enabled: false, type: 0 }; r.outputColorSpace = "srgb"; r.toneMapping = 0; r.toneMappingExposure = 1; r.setClearColor = () => {}; r.getSize = (t) => t ? t.set(1280, 720) : new Vector2(1280, 720); return r; },
    FontLoader: class FontLoader { load(url, onLoad) { if (onLoad) onLoad({ generateShapes: () => [] }); return {}; } },
    TextureLoader, CubeTextureLoader, Raycaster, Clock, Fog, FogExp2,
    Shape, Path, CurvePath, Curve, LineCurve, LineCurve3, EllipseCurve, ArcCurve, SplineCurve, CatmullRomCurve3, QuadraticBezierCurve, CubicBezierCurve, QuadraticBezierCurve3, CubicBezierCurve3,
    MathUtils: { randInt: (low, high) => low + Math.floor(Math.random() * (high - low + 1)), randFloat: (min, max) => min + Math.random() * (max - min), randFloatSpread: (range) => range * (0.5 - Math.random()), degToRad: (deg) => deg * Math.PI / 180, radToDeg: (rad) => rad * 180 / Math.PI, clamp: (val, min, max) => Math.max(min, Math.min(max, val)), lerp: (x, y, t) => (1-t)*x + t*y, mapLinear: (x, a1, a2, b1, b2) => b1 + (x-a1)*(b2-b1)/(a2-a1), seededRandom: (s) => Math.random(), setQuaternionFromProperEuler: () => {} },
    // Constants
    DoubleSide, FrontSide, BackSide, AdditiveBlending, SubtractiveBlending, MultiplyBlending, NormalBlending, CustomBlending, NoBlending, RepeatWrapping, ClampToEdgeWrapping, MirroredRepeatWrapping, NearestFilter, LinearFilter, SRGBColorSpace, LinearSRGBColorSpace, PCFSoftShadowMap, BasicShadowMap, VSMShadowMap
  };
}

function createP5Runtime(runtimeState, logs) {
  const state = { width: 0, height: 0, looping: true, frameRateValue: 60, backgroundColor: null, operations: [] };
  const record = (op, payload = {}) => {
    state.operations.push({ op, payload, timestamp: isoNow() });
    if (op === 'ellipse' || op === 'rect' || op === 'line' || op === 'circle' || op === 'triangle' || op === 'image') {
      runtimeState.renderCount += 1;
    }
  };

  // Build a p5 API object (both procedural and keyworded styles)
  function buildP5Api(self) {
    Object.assign(self, {
      // Canvas
      width: state.width, height: state.height,
      createCanvas(w, h) { state.width = w; state.height = h; self.width = w; self.height = h; record('createCanvas', {w, h}); return { width: w, height: h, nodeName: 'CANVAS', elt: {} }; },
      resizeCanvas(w, h) { state.width = w; state.height = h; self.width = w; self.height = h; },
      createGraphics(w, h) { const g = buildP5Api({}); g.createCanvas(w, h); return g; },
      pixelDensity(d) { return d ?? 1; },
      displayWidth: 1280, displayHeight: 720, windowWidth: 1280, windowHeight: 720,

      // Drawing
      background(...a) { record('background', {a}); },
      fill(...a) { record('fill', {a}); },
      noFill() { record('noFill'); },
      stroke(...a) { record('stroke', {a}); },
      noStroke() { record('noStroke'); },
      strokeWeight(w) { record('strokeWeight', {w}); },
      ellipse(...a) { record('ellipse', {a}); },
      circle(x, y, d) { record('circle', {x, y, d}); },
      rect(...a) { record('rect', {a}); },
      square(x, y, s) { record('square', {x, y, s}); },
      line(...a) { record('line', {a}); },
      point(x, y) { record('point', {x, y}); },
      triangle(...a) { record('triangle', {a}); },
      quad(...a) { record('quad', {a}); },
      arc(...a) { record('arc', {a}); },
      bezier(...a) { record('bezier', {a}); },
      curve(...a) { record('curve', {a}); },
      beginShape() { record('beginShape'); },
      endShape(mode) { record('endShape', {mode}); },
      vertex(x, y, z) { record('vertex', {x, y, z}); },
      curveVertex(x, y) { record('curveVertex', {x, y}); },
      image(img, ...a) { record('image', {a}); },
      imageMode(m) {},

      // Text
      text(str, x, y) { record('text', {str, x, y}); },
      textSize(s) { record('textSize', {s}); },
      textAlign(h, v) {},
      textFont(f) {},
      textWidth(s) { return s.length * 8; },
      textAscent() { return 12; }, textDescent() { return 4; },

      // Transform
      push() { record('push'); }, pop() { record('pop'); },
      translate(...a) { record('translate', {a}); },
      rotate(a) { record('rotate', {a}); },
      rotateX(a) { record('rotateX', {a}); }, rotateY(a) { record('rotateY', {a}); }, rotateZ(a) { record('rotateZ', {a}); },
      scale(...a) { record('scale', {a}); },
      shearX(a) {}, shearY(a) {},
      applyMatrix() {}, resetMatrix() {},

      // Color
      color(...a) { return { r: a[0]||0, g: a[1]||0, b: a[2]||0, toString() { return `rgb(${this.r},${this.g},${this.b})`; } }; },
      red(c) { return c?.r ?? 0; }, green(c) { return c?.g ?? 0; }, blue(c) { return c?.b ?? 0; }, alpha(c) { return 255; },
      lerpColor(a, b, t) { return self.color(a.r+(b.r-a.r)*t, a.g+(b.g-a.g)*t, a.b+(b.b-a.b)*t); },
      colorMode(mode, ...rest) {},
      hue(c) { return 0; }, saturation(c) { return 0; }, brightness(c) { return 0; }, lightness(c) { return 0; },

      // Math / Utils
      random(min = 1, max) { const upper = max !== undefined ? max : min; const lower = max !== undefined ? min : 0; return lower + Math.random() * (upper - lower); },
      randomGaussian(mean = 0, sd = 1) { return mean + sd * (Math.random() * 2 - 1); },
      noise(x, y = 0, z = 0) { return Math.abs(Math.sin(x * 127.1 + y * 311.7 + z * 74.7)) * 0.5 + 0.5; },
      noiseSeed(seed) {},
      randomSeed(seed) {},
      map(val, inMin, inMax, outMin, outMax) { return outMin + (val - inMin) / (inMax - inMin) * (outMax - outMin); },
      constrain(val, lo, hi) { return Math.min(Math.max(val, lo), hi); },
      lerp(a, b, t) { return a + (b - a) * t; },
      dist(x1, y1, x2, y2) { return Math.sqrt((x2-x1)**2+(y2-y1)**2); },
      abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round,
      sqrt: Math.sqrt, sq: (x) => x*x, pow: Math.pow, exp: Math.exp, log: Math.log,
      min: (...a) => Math.min(...(Array.isArray(a[0]) ? a[0] : a)),
      max: (...a) => Math.max(...(Array.isArray(a[0]) ? a[0] : a)),
      sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
      degrees(r) { return r * 180 / Math.PI; },
      radians(d) { return d * Math.PI / 180; },
      norm(val, start, stop) { return (val - start) / (stop - start); },
      PI: Math.PI, TWO_PI: Math.PI*2, HALF_PI: Math.PI/2, QUARTER_PI: Math.PI/4, TAU: Math.PI*2,
      DEGREES: 'DEGREES', RADIANS: 'RADIANS',
      CHORD: 'CHORD', PIE: 'PIE', OPEN: 'OPEN', CLOSE: 'CLOSE',
      CENTER: 'CENTER', LEFT: 'LEFT', RIGHT: 'RIGHT', TOP: 'TOP', BOTTOM: 'BOTTOM', BASELINE: 'BASELINE',
      ROUND: 'ROUND', SQUARE: 'SQUARE', PROJECT: 'PROJECT', MITER: 'MITER', BEVEL: 'BEVEL',
      RGB: 'RGB', HSB: 'HSB', HSL: 'HSL',
      POINTS: 'POINTS', LINES: 'LINES', TRIANGLES: 'TRIANGLES', TRIANGLE_FAN: 'TRIANGLE_FAN', TRIANGLE_STRIP: 'TRIANGLE_STRIP', QUADS: 'QUADS', QUAD_STRIP: 'QUAD_STRIP',
      WEBGL: 'WEBGL', P2D: 'P2D',

      // Input
      mouseX: 0, mouseY: 0, pmouseX: 0, pmouseY: 0, mouseIsPressed: false, key: '', keyCode: 0, keyIsPressed: false,
      mouseButton: 'left', touches: [],
      keyIsDown(code) { return false; },

      // Frame / Loop control
      frameCount: 0, frameRate(v) { if (v !== undefined) state.frameRateValue = v; return state.frameRateValue; },
      deltaTime: 16, focused: true,
      noLoop() { state.looping = false; }, loop() { state.looping = true; }, isLooping() { return state.looping; },
      redraw() { runtimeState.renderCount += 1; },
      millis() { return Date.now(); },

      // Image / pixels
      loadImage(url, cb) { const img = { width: 100, height: 100, pixels: [] }; if (cb) cb(img); return img; },
      createImage(w, h) { return { width: w, height: h, pixels: new Uint8ClampedArray(w*h*4), loadPixels(){}, updatePixels(){}, get(){}, set(){} }; },
      loadPixels() {}, updatePixels() {},
      pixels: [],
      get(x, y) { return self.color(200); },
      set(x, y, c) {},
      copy() {},
      blend() {},
      filter(mode, arg) {},
      tint(...a) {}, noTint() {},

      // DOM
      createDiv(html='') { return { html:(v)=>{}, style:()=>{}, position:()=>{}, size:()=>{}, elt:{} }; },
      createP(html='') { return self.createDiv(html); },
      createSpan(html='') { return self.createDiv(html); },
      createImg(src, alt='') { return { elt:{} }; },
      createInput(val='') { return { value: val, elt:{} }; },
      createButton(label='') { return { mousePressed:(fn)=>{}, elt:{} }; },
      createSlider(min, max, val, step) { return { value: val, elt:{} }; },
      createSelect() { return { option:(v)=>{}, selected:()=>'', elt:{} }; },
      createCheckbox(label, val=false) { return { checked:()=>val, elt:{} }; },
      createColorPicker(c) { return { value:()=>'#ffffff', elt:{} }; },
      createElement(tag, content='') { return { elt:{} }; },
      createFileInput(cb) { return { elt:{} }; },
      removeElements() {},
      select(s) { return null; }, selectAll(s) { return []; },

      // 3D (WEBGL)
      box(w, h, d) { record('box', {w, h, d}); },
      sphere(r, detail) { record('sphere', {r}); },
      cylinder(r, h) { record('cylinder', {r, h}); },
      cone(r, h) { record('cone', {r, h}); },
      torus(r, tube) { record('torus', {r, tube}); },
      plane(w, h) { record('plane', {w, h}); },
      normalMaterial() {}, ambientLight(...a) {}, directionalLight(...a) {}, pointLight(...a) {}, spotLight(...a) {},
      camera(...a) {}, perspective(...a) {}, ortho(...a) {},
      beginCamera() {}, endCamera() {},
      texture(img) {}, ambientMaterial(...a) {}, specularMaterial(...a) {}, shininess(s) {}, emissiveMaterial(...a) {},

      // p5.Vector
      createVector(x=0, y=0, z=0) {
        const v = { x, y, z,
          set(nx,ny,nz){this.x=nx;this.y=ny;this.z=nz??this.z; return this;},
          copy(){return self.createVector(this.x,this.y,this.z);},
          add(o){this.x+=o.x||o;this.y+=o.y||0;this.z+=o.z||0; return this;},
          sub(o){this.x-=o.x||o;this.y-=o.y||0;this.z-=o.z||0; return this;},
          mult(s){this.x*=s;this.y*=s;this.z*=s; return this;},
          div(s){this.x/=s;this.y/=s;this.z/=s; return this;},
          mag(){return Math.sqrt(this.x**2+this.y**2+this.z**2);},
          magSq(){return this.x**2+this.y**2+this.z**2;},
          normalize(){const m=this.mag()||1;return this.div(m);},
          limit(max){const m=this.mag();if(m>max) this.mult(max/m); return this;},
          setMag(m){return this.normalize().mult(m);},
          heading(){return Math.atan2(this.y,this.x);},
          rotate(a){const c=Math.cos(a),s=Math.sin(a);const nx=this.x*c-this.y*s;this.y=this.x*s+this.y*c;this.x=nx; return this;},
          angleBetween(o){return Math.acos((this.x*o.x+this.y*o.y+this.z*o.z)/(this.mag()*o.mag()||1));},
          dot(o){return this.x*(o.x||o)+this.y*(o.y||0)+this.z*(o.z||0);},
          cross(o){return self.createVector(this.y*o.z-this.z*o.y,this.z*o.x-this.x*o.z,this.x*o.y-this.y*o.x);},
          dist(o){return self.createVector(this.x-o.x,this.y-o.y,this.z-o.z).mag();},
          lerp(o,t){return this.add(self.createVector(o.x-this.x,o.y-this.y,o.z-this.z).mult(t));},
          array(){return [this.x,this.y,this.z];},
          toString(){return `[${this.x},${this.y},${this.z}]`;}
        };
        return v;
      },

      // Sound (stubs so p5.sound sketches dont crash)
      loadSound(url, cb) { const s = { play(){}, pause(){}, stop(){}, isPlaying(){return false;}, setVolume(){}, amp(){}, freq(){}, loop(){}, duration(){return 0;} }; if(cb) cb(s); return s; },
      getAudioContext() { return {}; },

      // Misc
      print(...a) { logs.push({ level:'log', message: a.map(String).join(' '), timestamp: isoNow() }); },
      _state: state,
      setup() {}, draw() {}
    });
    return self;
  }

  // Build the global procedural API (spread into sandbox)
  const api = buildP5Api({});

  // p5 constructor for instance mode: new p5(sketch, node)
  api.p5 = function P5Constructor(sketch, node) {
    const instance = buildP5Api({});
    // Run the sketch function with this instance
    if (typeof sketch === 'function') {
      try { sketch(instance); } catch(e) {}
    }
    // Execute setup then draw once
    try { if (typeof instance.setup === 'function') instance.setup(); } catch(e) {}
    try { if (typeof instance.draw === 'function') { instance.draw(); runtimeState.renderCount += 1; } } catch(e) {}
    return instance;
  };

  return api;
}


function createD3Runtime(logs) {
  function createD3Chain(label) {
    const chain = {};
    // Every method returns the chain (or a new chain) for fluent chaining
    const self = () => chain;
    const newChain = (lbl) => createD3Chain(lbl || label);

    // Core selection methods
    chain._label = label;
    chain.select = (s) => newChain(`${label}.select(${s})`);
    chain.selectAll = (s) => newChain(`${label}.selectAll(${s})`);
    chain.append = (name) => { logs.push({ level: 'log', message: `${label}.append(${name})`, timestamp: isoNow() }); return newChain(`${label}.append(${name})`); };
    chain.insert = (name) => newChain(`${label}.insert(${name})`);
    chain.remove = self;
    chain.clone = self;
    chain.merge = () => newChain(`${label}.merge`);
    chain.filter = () => newChain(`${label}.filter`);
    chain.raise = self;
    chain.lower = self;

    // Attribute/style setters (all chainable)
    chain.attr = self;
    chain.style = self;
    chain.property = self;
    chain.classed = self;
    chain.text = self;
    chain.html = self;
    chain.datum = self;

    // Data join
    chain.data = () => newChain(`${label}.data`);
    chain.enter = () => newChain(`${label}.enter`);
    chain.exit = () => newChain(`${label}.exit`);
    chain.join = (enter) => {
      if (typeof enter === 'function') {
        try { enter(newChain(`${label}.join.enter`)); } catch {}
      }
      return newChain(`${label}.join`);
    };

    // Events and controls
    chain.on = self;
    chain.call = (fn, ...args) => { try { fn(chain, ...args); } catch {} return chain; };
    chain.each = (fn) => { try { fn.call({}, {}, 0, []); } catch {} return chain; };
    chain.interrupt = self;
    chain.dispatch = self;

    // Transition — this was the crash point
    chain.transition = (name) => {
      const t = createD3Chain(`${label}.transition(${name || ''})`);
      t.duration = () => t;
      t.delay = () => t;
      t.ease = () => t;
      t.tween = () => t;
      t.attrTween = () => t;
      t.styleTween = () => t;
      t.on = () => t;
      t.end = () => Promise.resolve();
      return t;
    };

    // Queries
    chain.node = () => ({ nodeName: 'SVG', style: {}, getAttribute: () => null, setAttribute() {}, getBoundingClientRect: () => ({ width: 600, height: 400, top: 0, left: 0 }) });
    chain.nodes = () => [];
    chain.size = () => 0;
    chain.empty = () => true;

    return chain;
  }

  // Scale factories
  function makeScale() {
    let domainVals = [0, 1];
    let rangeVals = [0, 1];
    const scale = (v) => {
      const [d0, d1] = domainVals, [r0, r1] = rangeVals;
      if (d1 === d0) return r0;
      return r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
    };
    scale.domain = (v) => { if (v) domainVals = [v[0], v[v.length-1]]; return scale; };
    scale.range = (v) => { if (v) rangeVals = [v[0], v[v.length-1]]; return scale; };
    scale.clamp = () => scale;
    scale.nice = () => scale;
    scale.ticks = (n = 10) => { const step = (domainVals[1]-domainVals[0])/(n-1); return Array.from({length:n},(_,i)=>domainVals[0]+i*step); };
    scale.tickFormat = () => (v) => String(v);
    scale.copy = () => makeScale();
    scale.invert = (v) => v;
    scale.bandwidth = () => 24;
    scale.padding = () => scale;
    scale.paddingInner = () => scale;
    scale.paddingOuter = () => scale;
    scale.align = () => scale;
    scale.rangeRound = (v) => { if (v) rangeVals = [v[0], v[v.length-1]]; return scale; };
    scale.base = () => scale;
    scale.exponent = () => scale;
    scale.interpolate = () => scale;
    scale.unknown = () => scale;
    return scale;
  }

  const noopFn = (...args) => {
    const f = () => '';
    ['x','y','z','x0','x1','y0','y1','angle','startAngle','endAngle','padAngle','innerRadius','outerRadius','cornerRadius','padRadius','centroid','curve','defined','context','digits'].forEach(m => { f[m] = () => f; });
    return f;
  };

  return {
    // Selections
    select: (s) => createD3Chain(`d3.select(${s})`),
    selectAll: (s) => createD3Chain(`d3.selectAll(${s})`),
    selection: () => createD3Chain('d3.selection'),
    create: (name) => createD3Chain(`d3.create(${name})`),

    // Scales
    scaleLinear: makeScale,
    scaleBand: makeScale,
    scaleOrdinal: makeScale,
    scaleLog: makeScale,
    scaleSqrt: makeScale,
    scalePow: makeScale,
    scaleTime: makeScale,
    scaleSequential: makeScale,
    scaleQuantize: makeScale,
    scaleQuantile: makeScale,
    scaleThreshold: makeScale,
    scaleIdentity: makeScale,
    scaleRadial: makeScale,
    scalePoint: makeScale,

    // Axes
    axisBottom: () => createD3Chain('d3.axisBottom'),
    axisTop: () => createD3Chain('d3.axisTop'),
    axisLeft: () => createD3Chain('d3.axisLeft'),
    axisRight: () => createD3Chain('d3.axisRight'),

    // Shapes
    line: noopFn,
    area: noopFn,
    arc: noopFn,
    pie: () => { const f = (data) => data.map((d,i) => ({data:d,value:d,index:i,startAngle:0,endAngle:Math.PI*2/data.length*i,padAngle:0})); ['value','sort','sortValues','startAngle','endAngle','padAngle'].forEach(m=>{f[m]=()=>f;}); return f; },
    symbol: noopFn,
    symbolCircle: 'symbolCircle',
    symbolCross: 'symbolCross',
    symbolDiamond: 'symbolDiamond',
    symbolSquare: 'symbolSquare',
    symbolStar: 'symbolStar',
    symbolTriangle: 'symbolTriangle',
    symbolWye: 'symbolWye',
    linkHorizontal: noopFn,
    linkVertical: noopFn,
    linkRadial: noopFn,
    stack: () => { const f = (data) => []; ['keys','value','order','offset'].forEach(m=>{f[m]=()=>f;}); return f; },

    // Stats / math
    extent: (values, fn) => { const vals = fn ? values.map(fn) : values; return [Math.min(...vals), Math.max(...vals)]; },
    max: (values, fn) => { const vals = fn ? values.map(fn) : values; return Math.max(...vals); },
    min: (values, fn) => { const vals = fn ? values.map(fn) : values; return Math.min(...vals); },
    sum: (values, fn) => (fn ? values.map(fn) : values).reduce((a,b)=>a+b,0),
    mean: (values, fn) => { const vals = fn ? values.map(fn) : values; return vals.reduce((a,b)=>a+b,0)/vals.length; },
    median: (values, fn) => { const vals = (fn ? values.map(fn) : values).slice().sort((a,b)=>a-b); return vals[Math.floor(vals.length/2)]; },
    deviation: () => 0,
    variance: () => 0,
    count: (values) => values.filter(v=>v!=null).length,
    cumsum: (values) => { let s=0; return values.map(v=>s+=v); },
    quantile: (values, p) => { const s=values.slice().sort((a,b)=>a-b); return s[Math.floor(p*(s.length-1))]; },
    bisect: (arr, x) => arr.findIndex(v=>v>=x),
    bisectLeft: (arr, x) => arr.findIndex(v=>v>=x),
    bisectRight: (arr, x) => arr.findIndex(v=>v>x),
    ascending: (a,b) => a<b?-1:a>b?1:0,
    descending: (a,b) => b<a?-1:b>a?1:0,

    // Array utilities
    range: (start, stop, step=1) => { if(stop===undefined){stop=start;start=0;} const r=[]; for(let v=start;v<stop;v+=step) r.push(v); return r; },
    cross: (...args) => [],
    pairs: (arr) => arr.slice(0,-1).map((a,i)=>[a,arr[i+1]]),
    permute: (obj, keys) => keys.map(k=>obj[k]),
    transpose: (matrix) => matrix[0].map((_,i)=>matrix.map(row=>row[i])),
    zip: (...args) => args[0].map((_,i)=>args.map(a=>a[i])),
    shuffle: (arr) => arr,
    sort: (values, compare) => values.slice().sort(compare),
    group: (values, ...keys) => new Map(),
    rollup: (values, reduce, ...keys) => new Map(),
    index: (values, ...keys) => new Map(),
    groups: (values, ...keys) => [],
    rollups: (values, reduce, ...keys) => [],
    flatGroup: (values, ...keys) => [],
    flatRollup: (values, reduce, ...keys) => [],
    bin: () => { const f = (data) => []; ['value','domain','thresholds'].forEach(m=>{f[m]=()=>f;}); return f; },

    // Colors
    color: (s) => ({ r:255,g:255,b:255,opacity:1,toString:()=>s,brighter:()=>this,darker:()=>this }),
    rgb: (r,g,b) => ({ r:r||0,g:g||0,b:b||0,opacity:1,toString:()=>`rgb(${r},${g},${b})` }),
    hsl: (h,s,l) => ({ h:h||0,s:s||0,l:l||0,opacity:1,toString:()=>`hsl(${h},${s},${l})` }),
    interpolate: (a,b) => (t) => t < 0.5 ? a : b,
    interpolateRgb: (a,b) => (t) => a,
    interpolateNumber: (a,b) => (t) => a+(b-a)*t,
    interpolateString: (a,b) => (t) => b,
    interpolateLab: (a,b) => (t) => a,
    interpolateHcl: (a,b) => (t) => a,
    interpolateHsl: (a,b) => (t) => a,
    quantize: (interpolator, n) => Array.from({length:n},(_,i)=>interpolator(i/(n-1))),

    // Color schemes
    schemeCategory10: ['#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd','#8c564b','#e377c2','#7f7f7f','#bcbd22','#17becf'],
    schemeTableau10: ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac'],
    schemeAccent: ['#7fc97f','#beaed4','#fdc086','#ffff99','#386cb0'],
    schemePastel1: ['#fbb4ae','#b3cde3','#ccebc5'],
    interpolateViridis: (t) => `rgb(${Math.round(t*255)},0,${Math.round((1-t)*255)})`,
    interpolateInferno: (t) => `rgb(${Math.round(t*255)},0,${Math.round((1-t)*128)})`,
    interpolateBlues: (t) => `rgb(0,0,${Math.round(t*255)})`,
    interpolateReds: (t) => `rgb(${Math.round(t*255)},0,0)`,
    interpolateCool: (t) => `rgb(${Math.round((1-t)*255)},${Math.round(t*255)},255)`,
    interpolateWarm: (t) => `rgb(255,${Math.round((1-t)*255)},0)`,
    interpolatePlasma: (t) => `rgb(${Math.round(t*255)},${Math.round(t*100)},${Math.round((1-t)*255)})`,

    // Format
    format: (spec) => (v) => typeof v === 'number' ? v.toFixed(2) : String(v),
    formatPrefix: (spec, val) => (v) => String(v),
    timeFormat: (spec) => (d) => d instanceof Date ? d.toLocaleDateString() : String(d),
    timeParse: (spec) => (s) => new Date(s),
    utcFormat: (spec) => (d) => String(d),
    isoFormat: (d) => d instanceof Date ? d.toISOString() : String(d),

    // Time
    now: () => Date.now(),
    timer: (callback, delay=0) => { const id = setTimeout(callback, delay); return { stop: () => clearTimeout(id), restart: () => {} }; },
    timeout: (callback, delay=0) => { const id = setTimeout(callback, delay); return { stop: () => clearTimeout(id) }; },
    interval: (callback, delay=0) => { const id = setInterval(callback, delay); return { stop: () => clearInterval(id), restart: () => {} }; },

    // Hierarchy
    hierarchy: (data) => { const node = { data, children: data.children||[], depth:0, height:0, value:0, sum:()=>node, sort:()=>node, links:()=>[], descendants:()=>[], leaves:()=>[], ancestors:()=>[], each:()=>node, eachBefore:()=>node, eachAfter:()=>node, copy:()=>node }; return node; },
    tree: () => { const f = (root) => root; ['size','nodeSize','separation'].forEach(m=>{f[m]=()=>f;}); return f; },
    cluster: () => { const f = (root) => root; ['size','nodeSize','separation'].forEach(m=>{f[m]=()=>f;}); return f; },
    treemap: () => { const f = (root) => root; ['size','tile','round','padding'].forEach(m=>{f[m]=()=>f;}); return f; },
    pack: () => { const f = (root) => root; ['size','padding','radius'].forEach(m=>{f[m]=()=>f;}); return f; },
    stratify: () => { const f = (data) => ({data,children:[]}); ['id','parentId'].forEach(m=>{f[m]=()=>f;}); return f; },

    // Geo
    geoPath: () => { const f = (d) => ''; f.projection = ()=>f; f.pointRadius=()=>f; f.area=()=>0; f.bounds=()=>[[0,0],[1,1]]; f.centroid=()=>[0,0]; return f; },
    geoProjection: () => { const f = (coords) => [0,0]; ['scale','translate','center','rotate','clipAngle','clipExtent','precision','fitSize','fitExtent'].forEach(m=>{f[m]=()=>f;}); return f; },
    geoMercator: () => { const f = (coords) => [0,0]; ['scale','translate','center','rotate','clipAngle','clipExtent','precision','fitSize','fitExtent'].forEach(m=>{f[m]=()=>f;}); return f; },
    geoOrthographic: () => { const f = (coords) => [0,0]; ['scale','translate','center','rotate','clipAngle','clipExtent','precision','fitSize','fitExtent'].forEach(m=>{f[m]=()=>f;}); return f; },
    geoNaturalEarth1: () => { const f = (coords) => [0,0]; ['scale','translate','center','rotate','clipAngle','clipExtent','precision','fitSize','fitExtent'].forEach(m=>{f[m]=()=>f;}); return f; },
    geoGraticule: () => { const f = () => ({}); ['step','stepMajor','stepMinor','precision','extent','extentMajor','extentMinor'].forEach(m=>{f[m]=()=>f;}); return f; },
    geoCircle: () => { const f = () => ({}); ['center','radius','precision'].forEach(m=>{f[m]=()=>f;}); return f; },

    // Interaction
    drag: () => createD3Chain('d3.drag'),
    zoom: () => createD3Chain('d3.zoom'),
    brush: () => createD3Chain('d3.brush'),
    brushX: () => createD3Chain('d3.brushX'),
    brushY: () => createD3Chain('d3.brushY'),
    pointer: (event) => [0, 0],
    clientPoint: (container, event) => [0, 0],

    // Misc
    csv: async (url, row) => [],
    tsv: async (url, row) => [],
    json: async (url) => ({}),
    text: async (url) => '',
    xml: async (url) => ({}),
    forceSimulation: (nodes=[]) => { const f = { nodes:()=>f, force:()=>f, alpha:()=>f, alphaMin:()=>f, alphaDecay:()=>f, alphaTarget:()=>f, velocityDecay:()=>f, on:()=>f, tick:()=>f, stop:()=>f, restart:()=>f, find:()=>null }; return f; },
    forceManyBody: () => { const f = {}; ['strength','theta','distanceMin','distanceMax'].forEach(m=>{f[m]=()=>f;}); return f; },
    forceLink: (links=[]) => { const f = {}; ['links','id','distance','strength','iterations'].forEach(m=>{f[m]=()=>f;}); return f; },
    forceCenter: (x=0,y=0) => { const f = {}; ['x','y','strength'].forEach(m=>{f[m]=()=>f;}); return f; },
    forceX: (x=0) => { const f = {}; ['x','strength'].forEach(m=>{f[m]=()=>f;}); return f; },
    forceY: (y=0) => { const f = {}; ['y','strength'].forEach(m=>{f[m]=()=>f;}); return f; },
    forceCollide: (r=0) => { const f = {}; ['radius','strength','iterations'].forEach(m=>{f[m]=()=>f;}); return f; },
    forceRadial: (r=0) => { const f = {}; ['radius','strength','x','y'].forEach(m=>{f[m]=()=>f;}); return f; },

    // Curve constants
    curveLinear: 'curveLinear',
    curveBasis: 'curveBasis',
    curveBasisClosed: 'curveBasisClosed',
    curveCardinal: 'curveCardinal',
    curveCatmullRom: 'curveCatmullRom',
    curveMonotoneX: 'curveMonotoneX',
    curveMonotoneY: 'curveMonotoneY',
    curveNatural: 'curveNatural',
    curveStep: 'curveStep',
    curveStepAfter: 'curveStepAfter',
    curveStepBefore: 'curveStepBefore',

    // Easing
    easeLinear: (t)=>t, easeCubic: (t)=>t, easeSin: (t)=>t, easeExp: (t)=>t,
    easeCircle: (t)=>t, easeElastic: (t)=>t, easeBack: (t)=>t, easeBounce: (t)=>t,
    easeQuad: (t)=>t, easePoly: (t)=>t,
    easeLinearIn: (t)=>t, easeLinearOut: (t)=>t, easeLinearInOut: (t)=>t,
    easeCubicIn: (t)=>t, easeCubicOut: (t)=>t, easeCubicInOut: (t)=>t,
  };
}


function createAnimeRuntime(runtimeState, logs, sandbox) {
  const running = [];

  function buildAnimation(params = {}) {
    const startedAt = Date.now();
    const duration = Math.max(0, Number(params.duration ?? 1000));
    const loop = params.loop === true || Number(params.loop) > 1;

    const animation = {
      paused: false,
      finished: Promise.resolve(),
      play() { this.paused = false; return this; },
      pause() { this.paused = true; return this; },
      restart() { this.paused = false; this.seek(0); return this; },
      seek() { return this; },
      reset() { this.paused = false; return this; }
    };

    const tick = () => {
      if (animation.paused) {
        return;
      }

      runtimeState.renderCount += 1;
      const elapsed = Date.now() - startedAt;

      if (loop || elapsed < duration) {
        sandbox.requestAnimationFrame(tick);
      }
    };

    sandbox.requestAnimationFrame(tick);
    running.push(animation);
    return animation;
  }

  const anime = (params = {}) => {
    logs.push({ level: "log", message: `anime() called with duration=${params.duration ?? "default"}`, timestamp: isoNow() });
    return buildAnimation(params);
  };

  anime.timeline = (timelineParams = {}) => {
    const segments = [];
    const timelineAnimation = buildAnimation(timelineParams);

    return {
      ...timelineAnimation,
      add(step = {}) {
        segments.push(step);
        buildAnimation({ ...timelineParams, ...step });
        return this;
      },
      children: segments
    };
  };

  anime.stagger = (value = 100) => () => value;
  anime.random = (min = 0, max = 1) => min + Math.random() * (max - min);
  anime.remove = () => undefined;
  anime.set = () => undefined;
  anime.running = running;

  return anime;
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

  if (skill.id === "threejs") {
    const THREE = createThreeNamespace(runtimeState);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    camera.position.set(2.5, 2, 3.5); camera.lookAt(0, 0, 0); renderer.setPixelRatio(1); renderer.setSize(1280, 720);
    sandbox.THREE = THREE; sandbox.scene = scene; sandbox.camera = camera; sandbox.renderer = renderer;
    // OrbitControls mock — supports both new OrbitControls(...) and new THREE.OrbitControls(...)
    const OrbitControlsMock = class OrbitControls {
      constructor(camera, domElement) {
        this.enabled = true;
        this.enableDamping = false;
        this.dampingFactor = 0.05;
        this.enablePan = true;
        this.enableZoom = true;
        this.enableRotate = true;
        this.minDistance = 0;
        this.maxDistance = Infinity;
        this.target = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
      }
      update() {}
      dispose() { this.disposed = true; }
    };
    sandbox.OrbitControls = OrbitControlsMock;
    THREE.OrbitControls = OrbitControlsMock;

  }
  if (skill.id === "p5js") { Object.assign(sandbox, createP5Runtime(runtimeState, logs)); }
  if (skill.id === "d3js") { sandbox.d3 = createD3Runtime(logs); }
  if (skill.id === "animejs") { sandbox.anime = createAnimeRuntime(runtimeState, logs, sandbox); }

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
