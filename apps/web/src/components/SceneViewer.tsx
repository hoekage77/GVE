import { useCallback, useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { Plus, Minus, RotateCcw, Compass, CheckCircle2, AlertCircle, Sparkles, Pause, Play, Gamepad2, Lock, Unlock, Keyboard, Grid3X3 } from "lucide-react";
import { cn } from "../lib/utils";
import { CURATED_THREEJS_ASSETS } from "../api";

export interface SceneViewerRef {
  zoomIn: () => void;
  zoomOut: () => void;
  resetCamera: () => void;
  toggleOrbit: () => void;
  togglePlayback: () => void;
  toggleGrid: () => void;
}

interface SceneViewerProps {
  code?: string | null;
  skill?: string | null;
  files?: Record<string, string>;
  fileSkills?: Record<string, string>;
  onError?: (error: string) => void;
  onExpand?: () => void;
}

const CDN_VENDOR_FILES: Record<string, string[]> = {
  p5js: ['/vendor/p5/p5.min.js'],
  d3js: ['/vendor/d3/d3.min.js'],
  animejs: ['/vendor/animejs/anime.min.js'],
};

let cdnVendorCache: Record<string, string> | null = null;

async function fetchCdnInlineScripts(paths: string[]): Promise<string> {
  if (!cdnVendorCache) cdnVendorCache = {};
  const cache = cdnVendorCache;
  const results = await Promise.all(
    paths.map(async (path) => {
      if (cache[path]) return cache[path];
      const resp = await fetch(path);
      const text = await resp.text();
      const script = `<script>${text}<\/script>`;
      cache[path] = script;
      return script;
    })
  );
  return results.join('\n');
}

const SCENE_GRID_STORAGE_KEY = "terranet.scene.grid.enabled";

const THREE_VENDOR_FILES = [
  { importName: 'three', path: '/vendor/three/three.module.min.js' },
  { importName: 'three/core', path: '/vendor/three/three.core.min.js' },
  { importName: 'three/addons/controls/OrbitControls.js', path: '/vendor/three/OrbitControls.js' },
  { importName: 'three/addons/loaders/GLTFLoader.js', path: '/vendor/three/GLTFLoader.js' },
  { importName: 'three/addons/loaders/DRACOLoader.js', path: '/vendor/three/DRACOLoader.js' },
  { importName: 'three/addons/loaders/RGBELoader.js', path: '/vendor/three/RGBELoader.js' },
  { importName: 'three/addons/loaders/HDRLoader.js', path: '/vendor/three/HDRLoader.js' },
  { importName: 'three/addons/utils/BufferGeometryUtils.js', path: '/vendor/utils/BufferGeometryUtils.js' },
];

const ADDON_IMPORT_REWRITES: Record<string, [string, string][]> = {
  '/vendor/three/three.module.min.js': [["from\"./three.core.min.js\"", "from\"three/core\""]],
  '/vendor/three/GLTFLoader.js': [["from '../utils/BufferGeometryUtils.js'", "from 'three/addons/utils/BufferGeometryUtils.js'"]],
  '/vendor/three/RGBELoader.js': [["from './HDRLoader.js'", "from 'three/addons/loaders/HDRLoader.js'"]],
};

let threeVendorCache: Record<string, string> | null = null;

async function fetchThreeVendorDataUrls(): Promise<Record<string, string>> {
  if (threeVendorCache) return threeVendorCache;
  const entries = await Promise.all(
    THREE_VENDOR_FILES.map(async ({ importName, path }) => {
      const resp = await fetch(path);
      let text = await resp.text();
      const rewrites = ADDON_IMPORT_REWRITES[path];
      if (rewrites) {
        for (const [from, to] of rewrites) {
          text = text.split(from).join(to);
        }
      }
      const base64 = btoa(unescape(encodeURIComponent(text)));
      return [importName, `data:text/javascript;base64,${base64}`] as const;
    })
  );
  threeVendorCache = Object.fromEntries(entries);
  return threeVendorCache;
}

function getInitialGridEnabled(): boolean {
  if (typeof window === "undefined") {
    return true;
  }

  const stored = window.localStorage.getItem(SCENE_GRID_STORAGE_KEY);
  if (stored === null) {
    return true;
  }

  return stored === "1";
}

function buildSceneHTML(code: string, skill: string, vendorDataUrls?: Record<string, string>, cdnInlineScripts?: string): string {
  const userCodeSource = JSON.stringify(code ?? "");

  const cdnScripts = cdnInlineScripts || '';

  const threejsImportMap = skill === 'threejs' && vendorDataUrls ? `
  <script type="importmap">
    {
      "imports": {
        ${THREE_VENDOR_FILES.map(({ importName }) => `"${importName}": "${vendorDataUrls[importName]}"`).join(',\n        ')}
      }
    }
  </script>` : '';

  // Skill-specific initialization
  const skillInit: Record<string, string> = {
    threejs: `
      // Three.js Scene Setup
      const __container = document.getElementById('scene-container');
      const __scene = new THREE.Scene();
      const __camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
      const __renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      __renderer.setSize(window.innerWidth, window.innerHeight);
      __renderer.setPixelRatio(window.devicePixelRatio);
      __renderer.setClearColor(0x0a0a0a, 1);
      if (window.THREE && window.THREE.SRGBColorSpace) {
        __renderer.outputColorSpace = window.THREE.SRGBColorSpace;
      } else if (window.THREE && window.THREE.sRGBEncoding) {
        __renderer.outputEncoding = window.THREE.sRGBEncoding;
      }
      if (window.THREE && window.THREE.ACESFilmicToneMapping) {
        __renderer.toneMapping = window.THREE.ACESFilmicToneMapping;
      }
      __renderer.toneMappingExposure = 1.0;
      __renderer.shadowMap.enabled = true;
      if (window.THREE && window.THREE.PCFSoftShadowMap) {
        __renderer.shadowMap.type = window.THREE.PCFSoftShadowMap;
      }
      __container.appendChild(__renderer.domElement);

      const __controlsCtor = window.OrbitControls || (window.THREE && window.THREE.OrbitControls) || null;
      if (!window.OrbitControls && __controlsCtor) {
        window.OrbitControls = __controlsCtor;
      }

      window.__GVE_MODEL_LIBRARY = ${JSON.stringify(CURATED_THREEJS_ASSETS)};

      window.resolveGveModelCandidates = function(subject) {
        const text = String(subject || "").toLowerCase();
        const lib = window.__GVE_MODEL_LIBRARY || {};
        if (/bird|eagle|owl|parrot|flamingo|stork/.test(text)) return lib.birds || [];
        if (/human|person|man|woman|character|avatar|robot|brainstem|cesium/.test(text)) return lib.humans || [];
        if (/animal|fox|wolf|cat|dog|horse|creature/.test(text)) return lib.animals || [];
        if (/car|truck|vehicle|buggy/.test(text)) return lib.vehicles || [];
        if (/helmet/.test(text)) return lib.objects || [];
        return [
          ...(lib.humans || []),
          ...(lib.animals || []),
          ...(lib.birds || []),
          ...(lib.vehicles || []),
          ...(lib.objects || [])
        ];
      };

      window.createGveGltfLoader = function() {
        if (!window.THREE || typeof window.THREE.GLTFLoader !== 'function') {
          throw new Error('THREE.GLTFLoader is unavailable in this runtime.');
        }
        const loader = new window.THREE.GLTFLoader();
        if (typeof window.THREE.DRACOLoader === 'function') {
          const dracoLoader = new window.THREE.DRACOLoader();
          dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
          loader.setDRACOLoader(dracoLoader);
        }
        return loader;
      };

      window.__GVE_ENV_MAP_URL = '/vendor/env/venice_sunset_1k.hdr';

      // Compatibility shims for generated code across Three.js versions.
      // Map old r128 API names to r160+ equivalents so generated code works.
      if (window.THREE) {
        if (!window.THREE.sRGBEncoding && window.THREE.SRGBColorSpace) {
          window.THREE.sRGBEncoding = window.THREE.SRGBColorSpace;
        }
        if (!window.THREE.LinearEncoding && window.THREE.LinearSRGBColorSpace) {
          window.THREE.LinearEncoding = window.THREE.LinearSRGBColorSpace;
        }
        if (!window.THREE.ACESFilmicToneMapping) {
          window.THREE.ACESFilmicToneMapping = 4;
        }
        if (!window.THREE.PCFSoftShadowMap) {
          window.THREE.PCFSoftShadowMap = 2;
        }
      }

      if (window.THREE && typeof window.THREE.CapsuleGeometry !== 'function') {
        window.THREE.CapsuleGeometry = function(radius = 0.5, length = 1, capSegments = 8, radialSegments = 16) {
          const __safeRadius = Math.max(0.0001, Number(radius) || 0.5);
          const __safeLength = Math.max(0.0001, Number(length) || 1);
          const __capsuleGroup = new THREE.Group();
          const __cylinder = new THREE.Mesh(new THREE.CylinderGeometry(__safeRadius, __safeRadius, __safeLength, radialSegments, 1, true));
          const __capTop = new THREE.Mesh(new THREE.SphereGeometry(__safeRadius, radialSegments, capSegments, 0, Math.PI * 2, 0, Math.PI / 2));
          const __capBottom = new THREE.Mesh(new THREE.SphereGeometry(__safeRadius, radialSegments, capSegments, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2));
          __capTop.position.y = __safeLength / 2;
          __capBottom.position.y = -__safeLength / 2;
          __capsuleGroup.add(__cylinder, __capTop, __capBottom);
          __capsuleGroup.updateMatrixWorld(true);
          const __fallbackGeometry = new THREE.CylinderGeometry(__safeRadius, __safeRadius, __safeLength + __safeRadius * 2, radialSegments, 1, false);
          return __fallbackGeometry;
        };
      }

      if (window.THREE && window.THREE.TubeGeometry) {
        const __OriginalTubeGeometry = window.THREE.TubeGeometry;
        window.THREE.TubeGeometry = function(path, tubularSegments = 64, radius = 1, radialSegments = 8, closed = false) {
          if (!path || typeof path.getPointAt !== 'function') {
            console.warn('TubeGeometry: path is invalid, falling back to dummy path.');
            path = new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
          }
          const __safeRadius = Math.max(0.0001, Number(radius) || 1);
          const __safeTubularSegments = Math.max(1, Math.floor(Number(tubularSegments) || 64));
          const __safeRadialSegments = Math.max(3, Math.floor(Number(radialSegments) || 8));
          
          try {
            return new __OriginalTubeGeometry(path, __safeTubularSegments, __safeRadius, __safeRadialSegments, closed);
          } catch (e) {
            console.error('TubeGeometry construction failed:', e);
            return new THREE.BoxGeometry(0.1, 0.1, 0.1);
          }
        };
        window.THREE.TubeGeometry.prototype = __OriginalTubeGeometry.prototype;
      }

      if (window.THREE && window.THREE.MeshPhysicalMaterial) {
        const __OriginalPhysicalMaterial = window.THREE.MeshPhysicalMaterial;
        if (!__OriginalPhysicalMaterial.__terranetPatched) {
          const __physicalProbe = new __OriginalPhysicalMaterial();

          const __sanitizePhysicalParameters = function(parameters = {}) {
            const __safeParameters = {};

            for (const [__key, __value] of Object.entries(parameters || {})) {
              if (__key in __physicalProbe || __key in __OriginalPhysicalMaterial.prototype) {
                __safeParameters[__key] = __value;
              }
            }

            return __safeParameters;
          };

          const __PatchedPhysicalMaterial = function(parameters = {}) {
            return new __OriginalPhysicalMaterial(__sanitizePhysicalParameters(parameters));
          };

          __PatchedPhysicalMaterial.prototype = __OriginalPhysicalMaterial.prototype;
          __PatchedPhysicalMaterial.prototype.constructor = __PatchedPhysicalMaterial;
          __PatchedPhysicalMaterial.__terranetPatched = true;
          __PatchedPhysicalMaterial.__original = __OriginalPhysicalMaterial;

          window.THREE.MeshPhysicalMaterial = __PatchedPhysicalMaterial;
        }
      }
      
      // Add basic lighting
      const __ambientLight = new THREE.AmbientLight(0x404040, 0.6);
      __scene.add(__ambientLight);
      const __directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
      __directionalLight.position.set(5, 10, 7);
      __directionalLight.castShadow = true;
      __scene.add(__directionalLight);
      
      // Camera position
      __camera.position.z = 5;

      const __defaultCameraPosition = __camera.position.clone();
      const __controls = __controlsCtor ? new __controlsCtor(__camera, __renderer.domElement) : null;
      if (__controls) {
        __controls.enableDamping = true;
      }

      const __gridHelper = new THREE.GridHelper(24, 24, 0xcbd5e1, 0xe2e8f0);
      __gridHelper.visible = false;
      __scene.add(__gridHelper);

      window.scene = __scene;
      window.camera = __camera;
      window.renderer = __renderer;
      window.controls = __controls;
      window.container = __container;
      window.__terranetGridHelper = __gridHelper;
      
      // Handle resize
      window.addEventListener('resize', () => {
        __camera.aspect = window.innerWidth / window.innerHeight;
        __camera.updateProjectionMatrix();
        __renderer.setSize(window.innerWidth, window.innerHeight);
      });

      window.__terranetSceneControl = {
        zoomIn() {
          __camera.position.multiplyScalar(0.9);
          __camera.updateProjectionMatrix();
        },
        zoomOut() {
          __camera.position.multiplyScalar(1.1);
          __camera.updateProjectionMatrix();
        },
        resetCamera() {
          __camera.position.copy(__defaultCameraPosition);
          if (__controls && typeof __controls.reset === 'function') {
            __controls.reset();
          }
          __camera.updateProjectionMatrix();
        },
        toggleOrbit() {
          if (__controls) {
            __controls.enabled = !__controls.enabled;
            return __controls.enabled;
          }
          return false;
        },
        setGridVisible(visible) {
          if (__gridHelper) {
            __gridHelper.visible = Boolean(visible);
            return __gridHelper.visible;
          }
          return false;
        }
      };
    `,
    p5js: `
      // p5.js will auto-initialize with setup() and draw()
    `,
    d3js: `
      // D3.js container ready
      const container = d3.select('#scene-container');
    `,
    animejs: `
      // Anime.js ready
    `
  };

  const isThreejs = skill === 'threejs';
  const scriptType = isThreejs ? ' type="module"' : '';
  const threejsModulePreamble = isThreejs ? `
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
    import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
    import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
    window.THREE = { ...THREE, GLTFLoader, DRACOLoader, RGBELoader };
    window.OrbitControls = OrbitControls;
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; background: #0a0a0a; }
    #scene-container { width: 100vw; height: 100vh; }
    #error-display {
      position: fixed;
      bottom: 12px;
      left: 12px;
      background: rgba(220, 38, 38, 0.9);
      color: white;
      padding: 8px 16px;
      border-radius: 8px;
      font-family: system-ui, sans-serif;
      font-size: 0.875rem;
      max-width: 80%;
      display: none;
    }
  </style>
  ${threejsImportMap}
  ${cdnScripts}
</head>
<body>
  <div id="scene-container"></div>
  <div id="error-display"></div>
  <script${scriptType}>
    ${threejsModulePreamble}
    window.addEventListener('error', function(e) {
      const errorDisplay = document.getElementById('error-display');
      errorDisplay.textContent = 'Error: ' + e.message;
      errorDisplay.style.display = 'block';
      parent.postMessage({ type: 'scene:error', error: e.message }, '*');
    });

    window.addEventListener('unhandledrejection', function(e) {
      const reason = e.reason && e.reason.message ? e.reason.message : String(e.reason || 'Unhandled promise rejection');
      const errorDisplay = document.getElementById('error-display');
      errorDisplay.textContent = 'Error: ' + reason;
      errorDisplay.style.display = 'block';
      parent.postMessage({ type: 'scene:error', error: reason }, '*');
    });

    function __postToParent(type, payload) {
      try {
        parent.postMessage({ type, ...(payload || {}) }, '*');
      } catch (_error) {
        // Ignore cross-origin serialization errors.
      }
    }

    function __normalizeUniformVector(value, size) {
      if (value === null || value === undefined) {
        return value;
      }

      if (ArrayBuffer.isView(value)) {
        return value;
      }

      if (Array.isArray(value)) {
        return new Float32Array(value);
      }

      if (typeof value === 'object') {
        if (typeof value.toArray === 'function') {
          try {
            const arrayValue = value.toArray();
            if (ArrayBuffer.isView(arrayValue)) {
              return arrayValue;
            }
            if (Array.isArray(arrayValue)) {
              return new Float32Array(arrayValue);
            }
          } catch (_error) {
            // Fall through to component extraction.
          }
        }

        if (size === 2 && typeof value.x === 'number' && typeof value.y === 'number') {
          return new Float32Array([value.x, value.y]);
        }

        if (size === 3) {
          if (typeof value.x === 'number' && typeof value.y === 'number' && typeof value.z === 'number') {
            return new Float32Array([value.x, value.y, value.z]);
          }
          if (typeof value.r === 'number' && typeof value.g === 'number' && typeof value.b === 'number') {
            return new Float32Array([value.r, value.g, value.b]);
          }
        }

        if (size === 4) {
          if (typeof value.x === 'number' && typeof value.y === 'number' && typeof value.z === 'number' && typeof value.w === 'number') {
            return new Float32Array([value.x, value.y, value.z, value.w]);
          }
          if (typeof value.r === 'number' && typeof value.g === 'number' && typeof value.b === 'number' && typeof value.a === 'number') {
            return new Float32Array([value.r, value.g, value.b, value.a]);
          }
        }
      }

      return value;
    }

    function __patchUniformVectorMethod(targetPrototype, methodName, size) {
      if (!targetPrototype || typeof targetPrototype[methodName] !== 'function') {
        return;
      }

      const originalMethod = targetPrototype[methodName];
      if (originalMethod.__terranetPatched) {
        return;
      }

      const wrappedMethod = function(location, value) {
        const normalizedValue = __normalizeUniformVector(value, size);
        return originalMethod.call(this, location, normalizedValue);
      };

      wrappedMethod.__terranetPatched = true;
      targetPrototype[methodName] = wrappedMethod;
    }

    function __patchWebGLUniformVectors() {
      if (window.__terranetUniformPatchApplied) {
        return;
      }

      window.__terranetUniformPatchApplied = true;

      const gl1Proto = window.WebGLRenderingContext && window.WebGLRenderingContext.prototype;
      const gl2Proto = window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype;
      const targets = [gl1Proto, gl2Proto];

      for (const target of targets) {
        __patchUniformVectorMethod(target, 'uniform2fv', 2);
        __patchUniformVectorMethod(target, 'uniform3fv', 3);
        __patchUniformVectorMethod(target, 'uniform4fv', 4);
      }
    }

    __patchWebGLUniformVectors();

    const __nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    let __scenePaused = false;
    let __gameModeEnabled = false;
    let __awaitingPointerLock = false;

    window.requestAnimationFrame = function(callback) {
      return __nativeRequestAnimationFrame(function frameProxy(time) {
        if (!__scenePaused) {
          callback(time);
          return;
        }

        const waitUntilPlay = function(nextTime) {
          if (__scenePaused) {
            __nativeRequestAnimationFrame(waitUntilPlay);
            return;
          }
          callback(nextTime);
        };

        __nativeRequestAnimationFrame(waitUntilPlay);
      });
    };

    function __getInteractiveTarget() {
      if (window.renderer && window.renderer.domElement) {
        return window.renderer.domElement;
      }

      return document.getElementById('scene-container') || document.body;
    }

    function __focusInteractiveTarget() {
      const target = __getInteractiveTarget();
      if (!target) {
        return;
      }

      if (typeof target.tabIndex === 'number' && target.tabIndex < 0) {
        target.tabIndex = 0;
      }

      if (typeof target.focus === 'function') {
        target.focus({ preventScroll: true });
      }
    }

    function __requestPointerLock() {
      const target = __getInteractiveTarget();
      if (!target || typeof target.requestPointerLock !== 'function') {
        return false;
      }

      try {
        target.requestPointerLock();
        return true;
      } catch (_error) {
        return false;
      }
    }

    function __exitPointerLock() {
      if (typeof document.exitPointerLock === 'function') {
        document.exitPointerLock();
      }
    }

    function __setGameMode(enabled) {
      __gameModeEnabled = Boolean(enabled);
      __focusInteractiveTarget();
      __postToParent('scene:game_mode', { enabled: __gameModeEnabled });
      __postToParent('scene:gamepad', {
        connected: typeof navigator.getGamepads === 'function'
          ? Array.from(navigator.getGamepads() || []).some(Boolean)
          : false
      });
    }

    const __blockedKeys = new Set([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);
    window.addEventListener('keydown', function(event) {
      if (!__gameModeEnabled) {
        return;
      }

      if (__blockedKeys.has(event.key)) {
        event.preventDefault();
      }

      __postToParent('scene:key', {
        state: 'down',
        key: event.key,
        code: event.code
      });
    }, { capture: true });

    window.addEventListener('keyup', function(event) {
      if (!__gameModeEnabled) {
        return;
      }

      __postToParent('scene:key', {
        state: 'up',
        key: event.key,
        code: event.code
      });
    }, { capture: true });

    document.addEventListener('pointerlockchange', function() {
      if (document.pointerLockElement) {
        __awaitingPointerLock = false;
        __postToParent('scene:pointer_lock_hint', { message: null });
      }

      __postToParent('scene:pointer_lock', {
        locked: Boolean(document.pointerLockElement)
      });
    });

    document.addEventListener('pointerlockerror', function() {
      __postToParent('scene:pointer_lock_hint', {
        message: 'Click inside the scene canvas and try lock again.'
      });
    });

    document.addEventListener('click', function(event) {
      if (!__awaitingPointerLock) {
        return;
      }

      const target = __getInteractiveTarget();
      if (!target) {
        return;
      }

      const clickedNode = event.target;
      if (!(clickedNode instanceof Node)) {
        return;
      }

      if (!target.contains(clickedNode) && clickedNode !== target) {
        return;
      }

      const locked = __requestPointerLock();
      if (locked) {
        __awaitingPointerLock = false;
        __postToParent('scene:pointer_lock_hint', { message: null });
      }
    }, { capture: true });

    window.addEventListener('gamepadconnected', function() {
      __postToParent('scene:gamepad', { connected: true });
    });

    window.addEventListener('gamepaddisconnected', function() {
      const connected = typeof navigator.getGamepads === 'function'
        ? Array.from(navigator.getGamepads() || []).some(Boolean)
        : false;
      __postToParent('scene:gamepad', { connected });
    });

    window.addEventListener('message', function(event) {
      if (!event.data || event.data.type !== 'scene:control') {
        return;
      }

      const payload = event.data.payload || {};
      const command = payload.command;
      const sceneControl = window.__terranetSceneControl;

      if (command === 'zoom_in' && sceneControl && typeof sceneControl.zoomIn === 'function') {
        sceneControl.zoomIn();
      }

      if (command === 'zoom_out' && sceneControl && typeof sceneControl.zoomOut === 'function') {
        sceneControl.zoomOut();
      }

      if (command === 'reset_camera' && sceneControl && typeof sceneControl.resetCamera === 'function') {
        sceneControl.resetCamera();
      }

      if (command === 'toggle_orbit' && sceneControl && typeof sceneControl.toggleOrbit === 'function') {
        const enabled = sceneControl.toggleOrbit();
        parent.postMessage({ type: 'scene:orbit', enabled }, '*');
      }

      if (command === 'set_grid' && sceneControl && typeof sceneControl.setGridVisible === 'function') {
        const enabled = sceneControl.setGridVisible(Boolean(payload.enabled));
        parent.postMessage({ type: 'scene:grid', enabled }, '*');
      }

      if (command === 'pause') {
        __scenePaused = true;
        parent.postMessage({ type: 'scene:playback', paused: true }, '*');
      }

      if (command === 'play') {
        __scenePaused = false;
        parent.postMessage({ type: 'scene:playback', paused: false }, '*');
      }

      if (command === 'enable_game_mode') {
        __setGameMode(true);
      }

      if (command === 'disable_game_mode') {
        __setGameMode(false);
        __exitPointerLock();
        __awaitingPointerLock = false;
      }

      if (command === 'request_pointer_lock') {
        __focusInteractiveTarget();
        __awaitingPointerLock = true;
        __postToParent('scene:pointer_lock_hint', {
          message: 'Click inside the scene to confirm mouse lock.'
        });
      }

      if (command === 'exit_pointer_lock') {
        __exitPointerLock();
      }

      if (command === 'focus_input') {
        __focusInteractiveTarget();
      }
    });
    
    try {
      ${skillInit[skill] || ''}
      const __userCodeSource = ${userCodeSource};
      const __executeGeneratedCode = new Function(__userCodeSource);
      __executeGeneratedCode.call(window);
    } catch (err) {
      const errorDisplay = document.getElementById('error-display');
      errorDisplay.textContent = 'Error: ' + err.message;
      errorDisplay.style.display = 'block';
      parent.postMessage({ type: 'scene:error', error: err.message }, '*');
    }
  </script>
</body>
</html>`;
}

/* ── Multi-skill composite rendering ── */

const SKILL_Z_LAYERS: Record<string, number> = {
  threejs: 0,
  p5js: 1,
  d3js: 2,
  animejs: 3,
};

const SKILL_CONTAINERS: Record<string, string> = {
  threejs: '<canvas id="three-canvas" style="position:absolute;inset:0;width:100%;height:100%;z-index:0;"></canvas>',
  p5js:    '<div id="p5-container" style="position:absolute;inset:0;width:100%;height:100%;z-index:1;"></div>',
  d3js:    '<svg id="d3-svg" style="position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;"></svg>',
  animejs: '<div id="anime-stage" style="position:absolute;inset:0;width:100%;height:100%;z-index:3;pointer-events:none;"></div>',
};

const SKILL_PREAMBLES: Record<string, string> = {
  threejs: `
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
    import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
    import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
    window.THREE = { ...THREE, GLTFLoader, DRACOLoader, RGBELoader };
    window.OrbitControls = OrbitControls;
  `,
  p5js: `
    import p5 from 'p5';
    window.p5 = p5;
  `,
  d3js: `
    import * as d3 from 'd3';
    window.d3 = d3;
  `,
  animejs: `
    import anime from 'animejs';
    window.anime = anime.default || anime;
  `,
};

function buildCompositeSceneHTML(
  files: Record<string, string>,
  fileSkills: Record<string, string>,
  vendorDataUrls?: Record<string, string>,
  cdnInlineScripts?: string
): string {
  const uniqueSkills = [...new Set(Object.values(fileSkills))].sort(
    (a, b) => (SKILL_Z_LAYERS[a] ?? 99) - (SKILL_Z_LAYERS[b] ?? 99)
  );

  const hasThreejs = uniqueSkills.includes('threejs');
  const threejsImportMap = hasThreejs && vendorDataUrls ? `
  <script type="importmap">
    {
      "imports": {
        ${THREE_VENDOR_FILES.map(({ importName }) => `"${importName}": "${vendorDataUrls[importName]}"`).join(',\n        ')}
      }
    }
  </script>` : '';

  const containerDivs = uniqueSkills
    .map((s) => SKILL_CONTAINERS[s] || `<div id="${s}-layer" style="position:absolute;inset:0;width:100%;height:100%;z-index:${SKILL_Z_LAYERS[s] ?? 99};"></div>`)
    .join('\n  ');

  const moduleScripts = Object.entries(files)
    .map(([path, code]) => {
      const s = fileSkills[path];
      if (!s) return '';
      const preamble = SKILL_PREAMBLES[s] || '';
      return `<script type="module">
${preamble}
try {
  const __userCodeSource = ${JSON.stringify(code)};
  const __executeGeneratedCode = new Function(__userCodeSource);
  __executeGeneratedCode.call(window);
} catch (err) {
  console.error('[GenVis]', err);
  parent.postMessage({ type: 'scene:error', error: err.message }, '*');
}
</script>`;
    })
    .filter(Boolean)
    .join('\n  ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; background: #0a0a0a; }
    #scene-root { position: relative; width: 100vw; height: 100vh; }
  </style>
  ${threejsImportMap}
  ${cdnInlineScripts || ''}
</head>
<body>
  <div id="scene-root">
  ${containerDivs}
  </div>
  ${moduleScripts}
  <script>
    window.GenVisBus = {
      _listeners: {},
      on(evt, fn) { (this._listeners[evt] = this._listeners[evt] || []).push(fn); },
      emit(evt, data) { (this._listeners[evt] || []).forEach(fn => fn(data)); }
    };
    window.addEventListener('error', e => { console.error('[GenVis]', e.error?.message || e.message); parent.postMessage({ type: 'scene:error', error: e.error?.message || e.message }, '*'); });
    window.addEventListener('unhandledrejection', e => { const r = e.reason?.message || String(e.reason); console.error('[GenVis] Unhandled:', r); parent.postMessage({ type: 'scene:error', error: r }, '*'); });
  </script>
</body>
</html>`;
}

const SceneViewer = forwardRef<SceneViewerRef, SceneViewerProps>(({ code, skill, files, fileSkills, onError, onExpand }, ref) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  const [orbitEnabled, setOrbitEnabled] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isGameModeEnabled, setIsGameModeEnabled] = useState(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [isGamepadConnected, setIsGamepadConnected] = useState(false);
  const [isGridEnabled, setIsGridEnabled] = useState(getInitialGridEnabled);
  const [pointerLockHint, setPointerLockHint] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    zoomIn: handleZoomIn,
    zoomOut: handleZoomOut,
    resetCamera: handleResetCamera,
    toggleOrbit: handleToggleOrbit,
    togglePlayback: handleTogglePlayback,
    toggleGrid: handleToggleGrid,
  }));

  // Listen for errors from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'scene:error') {
        const error = event.data.error;
        setRuntimeError(error);
        onError?.(error);
      }

      if (event.data?.type === 'scene:orbit') {
        setOrbitEnabled(Boolean(event.data.enabled));
      }

      if (event.data?.type === 'scene:playback') {
        setIsPlaying(!Boolean(event.data.paused));
      }

      if (event.data?.type === 'scene:game_mode') {
        setIsGameModeEnabled(Boolean(event.data.enabled));
      }

      if (event.data?.type === 'scene:pointer_lock') {
        setIsPointerLocked(Boolean(event.data.locked));
      }

      if (event.data?.type === 'scene:pointer_lock_hint') {
        const message = typeof event.data.message === 'string' ? event.data.message : null;
        setPointerLockHint(message);
      }

      if (event.data?.type === 'scene:gamepad') {
        setIsGamepadConnected(Boolean(event.data.connected));
      }

      if (event.data?.type === 'scene:grid') {
        setIsGridEnabled(Boolean(event.data.enabled));
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onError]);

  // Render scene when code/skill or files change
  useEffect(() => {
    const isMultiSkill = files && fileSkills && Object.keys(files).length > 0;
    const hasSingle = code && skill;
    if (!isMultiSkill && !hasSingle) {
      setIsRendered(false);
      setRuntimeError(null);
      return;
    }
    if (!iframeRef.current) return;

    setIsLoading(true);
    setRuntimeError(null);
    setIsRendered(false);
    setIsPlaying(true);
    setIsGameModeEnabled(false);
    setIsPointerLocked(false);
    setIsGamepadConnected(false);
    setPointerLockHint(null);

    let cancelled = false;

    const renderScene = async () => {
      const iframe = iframeRef.current;
      if (!iframe || cancelled) return;

      let html: string;
      if (isMultiSkill && files && fileSkills) {
        const allSkills = [...new Set(Object.values(fileSkills))];
        const needsThree = allSkills.includes('threejs');
        const vendorDataUrls = needsThree ? await fetchThreeVendorDataUrls() : undefined;
        if (cancelled) return;

        const cdnPaths = allSkills.flatMap((s) => CDN_VENDOR_FILES[s] || []);
        const cdnInlineScripts = cdnPaths.length > 0 ? await fetchCdnInlineScripts(cdnPaths) : undefined;
        if (cancelled) return;

        html = buildCompositeSceneHTML(files, fileSkills, vendorDataUrls, cdnInlineScripts);
      } else {
        const vendorDataUrls = skill === 'threejs' ? await fetchThreeVendorDataUrls() : undefined;
        if (cancelled) return;

        const cdnPaths = skill ? CDN_VENDOR_FILES[skill] : undefined;
        const cdnInlineScripts = cdnPaths ? await fetchCdnInlineScripts(cdnPaths) : undefined;
        if (cancelled) return;

        html = buildSceneHTML(code!, skill!, vendorDataUrls, cdnInlineScripts);
      }

      iframe.srcdoc = html;

      const timer = setTimeout(() => {
        if (!cancelled) {
          setIsLoading(false);
          setIsRendered(true);
        }
      }, 1000);

      return () => clearTimeout(timer);
    };

    const result = renderScene();

    return () => {
      cancelled = true;
      result.then(cleanup => cleanup?.());
    };
  }, [code, skill, files, fileSkills]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(SCENE_GRID_STORAGE_KEY, isGridEnabled ? "1" : "0");
  }, [isGridEnabled]);

  const postControl = useCallback((command: string, payload: Record<string, unknown> = {}) => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow) return;

    frameWindow.postMessage(
      { type: "scene:control", payload: { command, ...payload } },
      "*"
    );
  }, []);

  const handleZoomIn = () => postControl("zoom_in");
  const handleZoomOut = () => postControl("zoom_out");
  const handleResetCamera = () => postControl("reset_camera");
  const handleToggleOrbit = () => {
    postControl("toggle_orbit");
  };

  const handleTogglePlayback = () => {
    postControl(isPlaying ? "pause" : "play");
    setIsPlaying((previous) => !previous);
  };

  const handleToggleGrid = () => {
    const nextEnabled = !isGridEnabled;
    setIsGridEnabled(nextEnabled);
    postControl("set_grid", { enabled: nextEnabled });
  };

  const handleToggleGameMode = () => {
    const nextEnabled = !isGameModeEnabled;
    iframeRef.current?.focus({ preventScroll: true });
    postControl(nextEnabled ? "enable_game_mode" : "disable_game_mode");
    if (nextEnabled) {
      postControl("focus_input");
      setPointerLockHint("Click inside the scene, then press mouse lock.");
    }
    setIsGameModeEnabled(nextEnabled);
    if (!nextEnabled) {
      setIsPointerLocked(false);
      setPointerLockHint(null);
    }
  };

  const handlePointerLockToggle = () => {
    iframeRef.current?.focus({ preventScroll: true });
    if (!isGameModeEnabled) {
      postControl("enable_game_mode");
      setIsGameModeEnabled(true);
    }

    postControl(isPointerLocked ? "exit_pointer_lock" : "request_pointer_lock");

    if (!isPointerLocked) {
      setPointerLockHint("Click inside the scene to confirm mouse lock.");
    } else {
      setPointerLockHint(null);
    }
  };

  const handleFocusInput = () => {
    iframeRef.current?.focus({ preventScroll: true });
    postControl("focus_input");
  };

  const is3D = skill === 'threejs' || (fileSkills && Object.values(fileSkills).includes('threejs'));

  useEffect(() => {
    if (!is3D || !isRendered) {
      return;
    }

    postControl("set_grid", { enabled: isGridEnabled });
  }, [is3D, isRendered, isGridEnabled, postControl]);

  const controlButtonClass =
    "h-7 w-7 rounded-lg border border-white/10 bg-white/5 text-white/65 transition hover:border-white/20 hover:bg-white/10 hover:text-white";

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[28px] border border-white/10 bg-[#050507] shadow-[0_0_0_1px_#000,0_30px_90px_-30px_#000]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_14%,rgba(56,189,248,0.18),transparent_45%),radial-gradient(circle_at_82%_20%,rgba(236,72,153,0.14),transparent_55%)]" />
        <div
          className="absolute inset-0 opacity-35"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.03) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
      </div>

      <div className="relative z-10 flex h-full flex-col">
        <div className="relative flex-1 min-h-0 overflow-hidden">
          {runtimeError ? (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
              <AlertCircle className="mb-3 h-12 w-12 text-red-400/70" />
              <p className="max-w-lg text-sm text-red-200/80">{runtimeError}</p>
            </div>
          ) : !code && (!files || Object.keys(files).length === 0) ? (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/5">
                <Sparkles className="h-7 w-7 text-cyan-300/85" />
              </div>
              <p className="text-sm text-white/80">Scene workspace is ready</p>
              <p className="mt-1 text-xs text-white/45">Generate a scene and it will render here in live preview mode.</p>
            </div>
          ) : (
            <>
              <iframe
                ref={iframeRef}
                className="h-full w-full border-none bg-transparent"
                sandbox="allow-scripts allow-pointer-lock"
                tabIndex={0}
                title="Scene preview"
              />

              {onExpand && (
                <button
                  type="button"
                  onClick={onExpand}
                  className="absolute right-4 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white/70 backdrop-blur-sm transition-all hover:bg-black/70 hover:text-white"
                  title="Open Cinema Mode"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21 21-6-6m6 6v-4.8m0 4.8h-4.8"/><path d="M3 16.2V21m0 0h4.8M3 21l6-6"/><path d="M21 7.8V3m0 0h-4.8M21 3l-6 6"/><path d="M3 7.8V3m0 0h4.8M3 3l6 6"/></svg>
                </button>
              )}

              {isLoading && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#050507]/78 backdrop-blur-sm">
                  <div className="mb-3 h-9 w-9 animate-spin rounded-full border-2 border-white/15 border-t-cyan-300" />
                  <p className="text-sm text-white/75">Rendering scene...</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="shrink-0 bg-black/40 px-3 py-2 backdrop-blur-sm">
          <div className="flex items-center justify-center gap-1.5">
            {is3D && (
              <>
                <button className={controlButtonClass} onClick={handleZoomOut} title="Zoom out">
                  <Minus className="mx-auto h-3.5 w-3.5" />
                </button>
                <button className={controlButtonClass} onClick={handleZoomIn} title="Zoom in">
                  <Plus className="mx-auto h-3.5 w-3.5" />
                </button>
                <button className={controlButtonClass} onClick={handleResetCamera} title="Reset camera">
                  <RotateCcw className="mx-auto h-3.5 w-3.5" />
                </button>
                <button
                  className={cn(
                    controlButtonClass,
                    !isPlaying && "border-sky-400/35 bg-sky-400/12 text-sky-300"
                  )}
                  onClick={handleTogglePlayback}
                  title={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? <Pause className="mx-auto h-3.5 w-3.5" /> : <Play className="mx-auto h-3.5 w-3.5" />}
                </button>
                <button
                  className={cn(controlButtonClass, orbitEnabled && "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200")}
                  onClick={handleToggleOrbit}
                  title="Toggle orbit controls"
                >
                  <Compass className="mx-auto h-3.5 w-3.5" />
                </button>
                <button
                  className={cn(controlButtonClass, isGridEnabled && "border-emerald-400/30 bg-emerald-400/10 text-emerald-200")}
                  onClick={handleToggleGrid}
                  title="Toggle grid"
                >
                  <Grid3X3 className="mx-auto h-3.5 w-3.5" />
                </button>
                <button
                  className={cn(controlButtonClass, isGameModeEnabled && "border-amber-400/30 bg-amber-400/10 text-amber-200")}
                  onClick={handleToggleGameMode}
                  title="Toggle game mode"
                >
                  <Gamepad2 className="mx-auto h-3.5 w-3.5" />
                </button>
                <button
                  className={cn(controlButtonClass, isPointerLocked && "border-cyan-400/35 bg-cyan-400/10 text-cyan-200")}
                  onClick={handlePointerLockToggle}
                  title={isPointerLocked ? "Exit mouse lock" : "Lock mouse"}
                >
                  {isPointerLocked ? <Unlock className="mx-auto h-3.5 w-3.5" /> : <Lock className="mx-auto h-3.5 w-3.5" />}
                </button>
                <button className={controlButtonClass} onClick={handleFocusInput} title="Focus input">
                  <Keyboard className="mx-auto h-3.5 w-3.5" />
                </button>
              </>
            )}

            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-white/60">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
              {isLoading ? "Rendering" : runtimeError ? "Error" : isRendered ? "Ready" : "Idle"}
            </span>
            {isGamepadConnected && (
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/25 bg-sky-400/10 px-2 py-0.5 font-mono text-[11px] text-sky-200">
                <Gamepad2 className="h-3.5 w-3.5" />
                Gamepad
              </span>
            )}
          </div>
        </div>

        {pointerLockHint && (
          <div className="shrink-0 bg-black/25 px-3 py-2">
            <p className="text-[11px] text-amber-200/85">{pointerLockHint}</p>
          </div>
        )}
      </div>
    </div>
  );
});

export default SceneViewer;
